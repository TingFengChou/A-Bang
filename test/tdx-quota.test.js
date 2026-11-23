// TDX 免費額度（每分鐘 5 次）下的資料策略：額度排程、舊快取、靜態資料存檔與讀回、背景預熱不搶使用者、一趟行程的 TDX 次數、北捷時刻表估算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTdxClient, createQuotaGate, endpointCategory } from '../core/tdx-client.js';
import { createFileStore, fileNameOf } from '../core/tdx-store.js';
import { startTdxPrewarm } from '../core/tdx-prewarm.js';
import { createTransitServices, railWarmSteps } from '../core/services/transit.js';
import { transitWarmSteps } from '../core/services/transit-data.js';
import { createMetroServices, metroWarmSteps, upcomingFromTimetable, normStationTimetable } from '../core/services/metro.js';
import { createServices } from '../core/index.js';
import { planTrip } from '../core/services/trip.js';
import { measure } from '../core/metrics.js';

const T0 = Date.parse('2026-11-23T02:00:10Z'); // 台灣時間週一 10:00:10
const token = () => new Response(JSON.stringify({ access_token: 'SECRET-TOKEN', expires_in: 86400 }));
const fast = { concurrent: 3, gapMs: 0, retryMs: 1, waitMs: 0 };
const upstreamTotal = (m) => Object.values(m.upstream || {}).reduce((a, b) => a + b, 0);

/** 假 TDX：依網址回資料，記下真的打了哪些（不含 token） */
function fakeTdx(routes, { headers = () => ({}) } = {}) {
  const hits = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return token();
    hits.push(u);
    const h = headers(hits.length);
    for (const [re, body] of routes) if (re.test(u)) return new Response(JSON.stringify(typeof body === 'function' ? body(u) : body), { headers: h });
    return new Response('[]', { headers: h });
  };
  return { hits, fetchImpl };
}

test('端點類別：只留固定字，不含縣市、路線、站名、參數', () => {
  assert.equal(endpointCategory('/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei/307'), 'Bus/EstimatedTimeOfArrival/City');
  assert.equal(endpointCategory('/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei/%E7%B4%8530'), 'Bus/EstimatedTimeOfArrival/City');
  assert.equal(endpointCategory('/basic/v2/Rail/Metro/LiveBoard/TRTC'), 'Rail/Metro/LiveBoard');
  assert.equal(endpointCategory('/basic/v2/Rail/THSR/DailyTimetable/OD/1000/to/1070/2026-11-18'), 'Rail/THSR/DailyTimetable/OD');
  assert.equal(endpointCategory('/advanced/v2/Bike/Availability/NearBy?$spatialFilter=nearby(25,121,500)'), 'Bike/Availability/NearBy');
});

test('額度排程：這一分鐘用完就直接回 429（不白打），下一分鐘再放行', async () => {
  let now = T0;
  const { hits, fetchImpl } = fakeTdx([[/./, [1]]]);
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5 }, now: () => now });
  for (let i = 0; i < 5; i++) await c.get(`/x${i}`);
  await assert.rejects(c.get('/x5'), (e) => e.status === 429 && /每分鐘 5 次/.test(e.message));
  assert.equal(hits.length, 5, '第 6 次沒有送出');
  assert.equal(c.stats().refused, 1);
  now += 60_000;
  assert.deepEqual(await c.get('/x5'), [1]);
  assert.equal(c.stats().sent, 6);
});

test('額度排程：照 TDX 回應標頭校正（剩 0 次就停、幾秒後重置）', async () => {
  let now = T0;
  const { hits, fetchImpl } = fakeTdx([[/./, [1]]], { headers: () => ({ 'x-ratelimit-limit-minute': '5', 'x-ratelimit-remaining-minute': '0', 'ratelimit-reset': '20' }) });
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast, now: () => now });
  await c.get('/a'); // 伺服器說這分鐘剩 0 次（例如另一台機器用掉了）
  await assert.rejects(c.get('/b'), (e) => e.status === 429 && /約 20 秒後/.test(e.message));
  assert.equal(hits.length, 1);
  now += 21_000;
  await c.get('/b');
  assert.equal(hits.length, 2);
});

test('額度閘門：背景工作每分鐘最多 3 次、有使用者在排隊時先讓', () => {
  const now = T0;
  const g = createQuotaGate({ perMinute: 5, backgroundPerMinute: 3, now: () => now });
  assert.ok(g.take({ background: true }) && g.take({ background: true }) && g.take({ background: true }));
  assert.equal(g.take({ background: true }), false, '背景第 4 次不行');
  assert.ok(g.take() && g.take(), '留給使用者的 2 次');
  assert.equal(g.take(), false);
  // 下一分鐘：只問 backgroundOk() 也要重置用量（2026-11-22 實測：預熱在伺服器裡卡在第一分鐘）
  let t = now;
  const g3 = createQuotaGate({ perMinute: 5, backgroundPerMinute: 3, now: () => t });
  g3.take({ background: true }); g3.take({ background: true }); g3.take({ background: true });
  assert.equal(g3.backgroundOk(), false);
  t += 60_000;
  assert.equal(g3.backgroundOk(), true);
  const g2 = createQuotaGate({ perMinute: 5, now: () => now });
  g2.userWaiting(1);
  assert.equal(g2.backgroundOk(), false, '使用者在排隊');
  g2.userWaiting(-1);
  assert.equal(g2.backgroundOk(), true);
});

test('同一網址同時只打一次（整個縣市的到站資料，所有路線共用）', async () => {
  const { hits, fetchImpl } = fakeTdx([[/./, async () => [1]]]);
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast });
  const [{ result, metrics }] = await Promise.all([measure(() => Promise.all([c.get('/eta', {}, 30), c.get('/eta', {}, 30), c.get('/eta', {}, 30)])), c.get('/eta', {}, 30)]);
  assert.equal(result.length, 3);
  assert.equal(hits.length, 1);
  assert.equal(upstreamTotal(metrics), 1);
});

test('額度快用完：即時資料用 60 秒內的舊快取（標示資料時間），不退回示範；被擋 429 也先用舊的', async () => {
  let now = T0, n = 0;
  const { fetchImpl } = fakeTdx([[/eta/, () => [{ v: ++n }]], [/./, [0]]]);
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5 }, now: () => now });
  const first = await c.getMeta('/eta', {}, 30, { staleSec: 60 });
  assert.deepEqual([first.data[0].v, first.stale, first.at], [1, false, T0]);
  await c.get('/o1'); await c.get('/o2'); await c.get('/o3'); // 這分鐘剩 1 次
  now += 40_000; // 過了 30 秒 TTL、還在 60 秒內
  const { result, metrics } = await measure(() => c.getMeta('/eta', {}, 30, { staleSec: 60 }));
  assert.deepEqual([result.data[0].v, result.stale, result.at], [1, true, T0], '用舊的，資料時間是原本取得的時間');
  assert.equal(metrics.stale, true);
  assert.equal(c.quota().left, 1, '最後一次留給沒有快取的請求');
  await c.get('/o4'); // 用掉最後一次
  now += 5_000; // 45 秒前的資料（同一分鐘）
  assert.equal((await c.getMeta('/eta', {}, 30, { staleSec: 60 })).stale, true, '額度用完（不送出）也先用舊的');
  now += 10_000; // 下一分鐘（額度重置）：重新取
  const fresh = await c.getMeta('/eta', {}, 30, { staleSec: 60 });
  assert.deepEqual([fresh.data[0].v, fresh.stale], [2, false]);
});

test('存檔：只存正規化結果（不含 token、金鑰、網址參數），重啟後先讀檔不打 TDX；格式不符的舊檔不讀', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abang-tdx-'));
  try {
    const { hits, fetchImpl } = fakeTdx([[/Station/, [{ StationID: 'BL12', StationName: { Zh_tw: '台北車站' } }]]]);
    const store = createFileStore(dir);
    const c1 = createTdxClient({ clientId: 'ID-123', clientSecret: 'SECRET-xyz', fetchImpl, limit: fast, store });
    const loader = async (o) => (await c1.get('/basic/v2/Rail/Metro/Station/TRTC', { $select: 'StationID,StationName' }, 60, { ...o, cache: false })).map((s) => ({ id: s.StationID, name: s.StationName.Zh_tw }));
    assert.deepEqual(await c1.cached('metro-stations-TRTC', 86400, loader), [{ id: 'BL12', name: '台北車站' }]);
    await new Promise((r) => setTimeout(r, 20)); // 寫檔是背景做的
    const files = await readdir(dir);
    assert.deepEqual(files, ['metro-stations-TRTC.json']);
    const txt = await readFile(join(dir, files[0]), 'utf8');
    for (const bad of ['SECRET', 'ID-123', '$select', 'tdx.transportdata.tw', 'Bearer']) assert.ok(!txt.includes(bad), bad);
    // 重啟：新的 client 讀檔，不打 TDX
    const c2 = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast, store: createFileStore(dir) });
    const { result, metrics } = await measure(() => c2.cached('metro-stations-TRTC', 86400, () => { throw new Error('不該下載'); }));
    assert.deepEqual(result, [{ id: 'BL12', name: '台北車站' }]);
    assert.equal(metrics.upstream, undefined);
    assert.equal(hits.length, 1);
    // 中文 key 轉成安全檔名；格式不符（舊版、壞檔）不讀
    assert.match(fileNameOf('bus-route-Taipei-紅30'), /^bus-route-Taipei-_30\.[0-9a-f]{10}\.json$/);
    await writeFile(join(dir, 'old.json'), JSON.stringify({ v: 0, key: 'old', at: 1, data: 1 }));
    assert.equal(await store.read('old'), null);
    await writeFile(join(dir, 'bad.json'), '{oops');
    assert.equal(await store.read('bad'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('靜態資料過期：先用舊的、背景更新；onlyStored 沒有就回 undefined（不在使用者這一次下載大檔）', async () => {
  let now = T0, n = 0;
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeTdx([]).fetchImpl, limit: fast, now: () => now });
  const loader = async () => ++n;
  assert.equal(await c.cached('k', 100, loader, { onlyStored: true }), undefined);
  assert.equal(await c.cached('k', 100, loader), 1);
  now += 200_000;
  assert.equal(await c.cached('k', 100, loader), 1, '先回舊的');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await c.cached('k', 100, loader), 2, '背景已更新');
});

// ── 一趟行程的 TDX 次數（西門町 → 台北101）──
const Z = (zh) => ({ Zh_tw: zh });
const P = (lat, lon) => ({ PositionLat: lat, PositionLon: lon });
const XIMEN = { name: '西門町', lat: 25.0421, lon: 121.5081 }, T101 = { name: '台北101', lat: 25.0339, lon: 121.5645 };
const TAIPEI = [
  [/Bus\/Station\/City\/Taipei/, [
    { StationUID: 'TPE1', StationID: '1', StationName: Z('西門'), StationPosition: P(25.0425, 121.5076), LocationCityCode: 'TPE', Stops: [{ RouteUID: 'TPE307', RouteName: Z('307') }] },
    { StationUID: 'TPE2', StationID: '2', StationName: Z('台北101'), StationPosition: P(25.0336, 121.5638), LocationCityCode: 'TPE', Stops: [{ RouteUID: 'TPE307', RouteName: Z('307') }] }]],
  [/Bus\/DisplayStopOfRoute\/City\/Taipei\?/, [{ RouteUID: 'TPE307', RouteName: Z('307'), Direction: 0, Stops: [
    { StopUID: 'TPE11', StopName: Z('西門'), StopSequence: 1, StopPosition: P(25.0425, 121.5076) },
    { StopUID: 'TPE12', StopName: Z('中途'), StopSequence: 2, StopPosition: P(25.038, 121.535) },
    { StopUID: 'TPE13', StopName: Z('台北101'), StopSequence: 3, StopPosition: P(25.0336, 121.5638) }] }]],
  [/Bus\/Route\/City\/Taipei\?/, [{ RouteUID: 'TPE307', RouteName: Z('307'), DepartureStopNameZh: '撫遠街', DestinationStopNameZh: '板橋前站' }]],
  [/Bus\/EstimatedTimeOfArrival\/City\/Taipei\?/, [{ RouteUID: 'TPE307', Direction: 0, StopUID: 'TPE11', EstimateTime: 420, StopStatus: 0 }]],
  [/Bike\/Station\/City\/Taipei/, [
    { StationUID: 'TPE5001', StationName: Z('YouBike2.0_西門'), StationPosition: P(25.0423, 121.5079), ServiceType: 2, BikesCapacity: 30 },
    { StationUID: 'TPE5002', StationName: Z('YouBike2.0_台北101'), StationPosition: P(25.0337, 121.5641), ServiceType: 2, BikesCapacity: 30 }]],
  [/Bike\/Availability\/City\/Taipei/, [
    { StationUID: 'TPE5001', ServiceStatus: 1, AvailableRentBikes: 10, AvailableReturnBikes: 10 },
    { StationUID: 'TPE5002', ServiceStatus: 1, AvailableRentBikes: 10, AvailableReturnBikes: 10 }]],
  [/Rail\/TRA\/Station/, [{ StationID: '1010', StationName: Z('萬華'), StationPosition: P(25.0334, 121.5001) }, { StationID: '1020', StationName: Z('松山'), StationPosition: P(25.0493, 121.5778) }]], // 短程又不順路：台鐵照樣列（估算，不查時刻表）
  [/Metro\/Station\/TYMC/, [{ StationID: 'A1', StationName: Z('臺北車站'), StationPosition: P(25.049, 121.515) }]], // 整個系統的車站不可能是空的（空的當失敗，不存）
  ...['TMRT', 'KRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'KLRT'].map((op) => [new RegExp(`Metro/Station/${op}\\b`), [{ StationID: 'X1', StationName: Z(`${op}站`), StationPosition: P(22.6, 120.3) }]]), // 其他系統：遠在南部（不影響台北的行程）
  [/Metro\/Station\/TRTC/, [{ StationID: 'BL11', StationName: Z('西門'), StationPosition: P(25.0421, 121.5081) }, { StationID: 'R03', StationName: Z('台北101／世貿'), StationPosition: P(25.0331, 121.5654) }]],
];

function liveSvc(tdx) {
  const base = createServices({ forceMock: true });
  return { ...base, mode: 'live', ...createTransitServices(tdx, { cities: ['Taipei'] }), ...createMetroServices(tdx) };
}
const warm = async (tdx) => { for (const s of [...transitWarmSteps(tdx, ['Taipei']), ...metroWarmSteps(tdx), ...railWarmSteps(tdx)]) await s.run({ background: false }).catch(() => {}); };

test('一趟行程（西門町→台北101）：靜態資料預熱後只打 2 次 TDX（公車到站、YouBike 車數各一次整個縣市）；30 秒內再問 0 次；重啟讀檔也是 2 次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abang-tdx-'));
  try {
    let now = T0;
    const { hits, fetchImpl } = fakeTdx(TAIPEI);
    const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast, store: createFileStore(dir), now: () => now });
    await warm(tdx);
    const before = hits.length;
    const svc = liveSvc(tdx);
    const { result, metrics } = await measure(() => planTrip(svc, { from: XIMEN, to: T101, now: T0 }));
    assert.deepEqual(metrics.upstream, { 'Bus/EstimatedTimeOfArrival/City': 1, 'Bike/Availability/City': 1 });
    assert.equal(hits.length - before, 2);
    assert.ok(result.options.some((o) => o.id === 'bus-307'), '公車是真實資料');
    assert.ok(result.options.some((o) => o.role === 'bike'));
    assert.ok(result.options.some((o) => o.role === 'metro'));
    assert.ok(!hits.some((u) => /NearBy/.test(u)), '預熱過的縣市不打 NearBy');
    // 30 秒內第二個人問：全部用快取
    now += 10_000;
    const again = await measure(() => planTrip(svc, { from: XIMEN, to: T101, now }));
    assert.equal(again.metrics.upstream, undefined);
    // 重啟：記憶體清空，靜態資料讀檔
    await new Promise((r) => setTimeout(r, 30));
    const { hits: h2, fetchImpl: f2 } = fakeTdx(TAIPEI);
    const tdx2 = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: f2, limit: fast, store: createFileStore(dir), now: () => now });
    const after = await measure(() => planTrip(liveSvc(tdx2), { from: XIMEN, to: T101, now }));
    assert.equal(upstreamTotal(after.metrics), 2, JSON.stringify(after.metrics.upstream));
    assert.equal(h2.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('沒預熱（冷快取）時照舊逐條查：附近站牌問 NearBy、路線站序逐條查並存檔', async () => {
  const { hits, fetchImpl } = fakeTdx([
    [/Bus\/Station\/NearBy/, (u) => (/25\.04/.test(u) ? TAIPEI[0][1].slice(0, 1) : TAIPEI[0][1].slice(1))],
    [/Bus\/DisplayStopOfRoute\/City\/Taipei\/307/, TAIPEI[1][1]],
    ...TAIPEI.slice(3),
  ]);
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast });
  const { bus } = createTransitServices(tdx, { cities: ['Taipei'] });
  const trips = await bus.directTrips({ from: XIMEN, to: T101 });
  assert.equal(trips[0].routeName, '307');
  assert.equal(trips[0].board.etaSec, 420);
  assert.ok(hits.some((u) => /Station\/NearBy/.test(u)));
  // 整個範圍的站牌都要（台北車站 500 公尺內超過 30 個；以前只取 30 個，遠一點站牌的路線漏掉）
  assert.ok(hits.filter((u) => /Station\/NearBy/.test(u)).every((u) => /top=150\b/.test(decodeURIComponent(u))), hits.join('\n'));
  assert.ok(!hits.some((u) => /Bus\/Shape/.test(u)), 'plan_trip 不查路線形狀');
});

test('本機站牌資料沒涵蓋（站位在沒預熱的縣市）時改問 TDX NearBy', async () => {
  const { hits, fetchImpl } = fakeTdx([
    [/Bus\/Station\/City\/Taipei/, [{ StationUID: 'TPE9', StationID: '9', StationName: Z('基隆火車站'), StationPosition: P(25.1316, 121.7400), LocationCityCode: 'KEE', Stops: [] }]],
    [/Bus\/Station\/NearBy/, []],
  ]);
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast });
  await transitWarmSteps(tdx, ['Taipei'])[0].run({});
  const { bus } = createTransitServices(tdx, { cities: ['Taipei'] });
  await bus.nearbyStations({ lat: 25.1318, lon: 121.7402 });
  assert.ok(hits.some((u) => /Station\/NearBy/.test(u)), '基隆自己的路線沒預熱：問 TDX');
});

test('背景預熱不搶使用者：每分鐘最多用 3 次，留 2 次給使用者；已存檔的跳過', async () => {
  const now = T0;
  const { hits, fetchImpl } = fakeTdx([[/./, [{ StationUID: 'TPE1', StationPosition: P(25, 121), Stops: [] }]]]);
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5, backgroundPerMinute: 3 }, now: () => now });
  await tdx.cached('pre-done', 100, async () => 1); // 已有新鮮資料的步驟
  const steps = [{ key: 'pre-done', ttl: 100, run: () => { throw new Error('不該重抓'); } },
    ...['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: `s-${k}`, ttl: 100, run: (o) => tdx.cached(`s-${k}`, 100, (x) => tdx.get(`/basic/v2/Bus/Station/City/${k}`, {}, 60, x), { ...o, force: true }) }))];
  const w = startTdxPrewarm(tdx, steps, { pollMs: 5 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(hits.length, 3, '這分鐘背景只用 3 次');
  // 使用者還有 2 次
  await tdx.get('/user1'); await tdx.get('/user2');
  assert.equal(hits.length, 5);
  await assert.rejects(tdx.get('/user3'), (e) => e.status === 429);
  w.stop();
});

// ── 北捷：看板只有進站中的站，其他依時刻表估 ──
const TT = [
  { LineID: 'BL', StationID: 'BL12', Direction: 0, DestinationStationID: 'BL23', DestinationStationName: { Zh_tw: '南港展覽館', En: 'Taipei Nangang Exhibition Center' }, ServiceDay: { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true }, Timetables: [{ DepartureTime: '09:58' }, { DepartureTime: '10:04' }, { DepartureTime: '10:10' }] },
  { LineID: 'BL', StationID: 'BL12', Direction: 1, DestinationStaionID: 'BL01', DestinationStationName: Z('頂埔'), ServiceDay: { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true }, Timetables: [{ DepartureTime: '10:02' }] },
  { LineID: 'BL', StationID: 'BL12', Direction: 1, DestinationStaionID: 'BL01', DestinationStationName: Z('頂埔'), ServiceDay: { Saturday: true, Sunday: true }, Timetables: [{ DepartureTime: '10:01' }] },
  { LineID: 'R', StationID: 'R10', Direction: 0, DestinationStationID: 'R28', DestinationStationName: Z('淡水'), ServiceDay: { Sunday: true, Monday: true }, Timetables: [{ DepartureTime: '00:36' }, { DepartureTime: '23:50' }] },
];

test('時刻表估下一班：依星期幾、每個方向最近一班、凌晨看前一天的末班', () => {
  const table = normStationTimetable(TT);
  assert.deepEqual(table[1].destId, 'BL01', 'DestinationStaionID（TDX 原文拼錯）也讀得到');
  const at10 = upcomingFromTimetable(table, T0); // 週一 10:00
  assert.deepEqual(at10.map((t) => [t.destination, t.etaMin]).sort(), [['南港展覽館', 4], ['頂埔', 2]]);
  assert.equal(at10.find((t) => t.destination === '南港展覽館').destinationEn, 'Taipei Nangang Exhibition Center');
  // 週一 00:20：週日的營運日還有 00:36 往淡水
  assert.deepEqual(upcomingFromTimetable(table, Date.parse('2026-11-22T16:20:00Z')).map((t) => [t.destination, t.etaMin]), [['淡水', 16]]);
  assert.deepEqual(upcomingFromTimetable(table, Date.parse('2026-11-23T05:00:00Z')), [], '一小時內沒有班次');
});

test('北捷看板沒有這一站（只有進站中的站）：改用時刻表估，照實標示；有進站中的車時兩者合併', async () => {
  const board = [{ LineID: 'BL', LineName: Z('板南線'), StationID: 'BL12', DestinationStationName: Z('頂埔'), EstimateTime: 0, UpdateTime: '2026-11-23T10:00:05+08:00' }];
  let liveRows = [];
  const { hits, fetchImpl } = fakeTdx([
    [/Metro\/Station\/TRTC/, [{ StationID: 'BL12', StationName: Z('台北車站'), StationPosition: P(25.0462, 121.5174) }, { StationID: 'R10', StationName: Z('臺北車站') }]],
    [/Metro\/LiveBoard\/TRTC/, () => liveRows],
    [/Metro\/StationTimeTable\/TRTC/, TT],
  ]);
  const { metro } = createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast }), { now: () => T0 });
  const r = await metro.liveBoard({ system: 'TRTC', station: '台北車站' });
  assert.equal(r.source, 'timetable');
  assert.match(r.note, /北捷即時到站在開放資料只有「進站中」/);
  assert.deepEqual(r.trains.map((t) => [t.line, t.destination, t.etaMin, t.status, t.scheduled]), [['板南線', '頂埔', 2, 'scheduled', true], ['板南線', '南港展覽館', 4, 'scheduled', true]]);
  assert.ok(hits.some((u) => u.includes('StationTimeTable/TRTC') && u.includes("$filter=StationID eq 'BL12' or StationID eq 'R10'")));
  // 工具：說「依時刻表約」，卡片契約過、帶 note
  const { callTool } = await import('../core/tools/index.js');
  const { validate } = await import('../public/ui/cards/schema/validate.js');
  const svc = { ...createServices({ forceMock: true }), mode: 'live', ...createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast }), { now: () => T0 }) };
  const t = await callTool(svc, 'metro_live_board', { system: 'TRTC', station: '台北車站' });
  assert.equal(t.speak, '台北車站依時刻表約 2 分鐘後有往頂埔的車。');
  assert.match(t.text, /時刻表/);
  const schema = JSON.parse(await readFile(new URL('../public/ui/cards/schema/metro.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(schema, t.data), []);
  // 看板有進站中的車：那個方向用看板，其他方向用時刻表
  liveRows = board;
  const m = await createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast }), { now: () => T0 }).metro.liveBoard({ system: 'TRTC', station: 'BL12' });
  assert.equal(m.source, 'mixed');
  assert.deepEqual(m.trains.map((t) => [t.destination, t.status]), [['頂埔', 'arriving'], ['南港展覽館', 'scheduled']]);
});
