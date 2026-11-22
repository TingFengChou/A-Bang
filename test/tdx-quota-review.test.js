// PR #117 獨立審查的修正：背景讓位時使用者不跟著退回示範、每秒上限不鎖整分、舊資料倒數扣掉經過時間、
// 時刻表不說成即時、空的靜態資料不存檔、記憶體上限、逐條查退路、存檔讀取先看大小、北捷看板被擋、預熱停用條件、逾時
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTdxClient, TdxYield } from '../core/tdx-client.js';
import { createFileStore } from '../core/tdx-store.js';
import { createTransitServices } from '../core/services/transit.js';
import { transitLoaders } from '../core/services/transit-data.js';
import { createMetroServices } from '../core/services/metro.js';
import { createServices, withTdxFallback } from '../core/index.js';
import { speakEn } from '../core/tools/speak-en.js';
import metroCard from '../public/ui/cards/cards/metro.js';
import { tFor } from '../public/ui/cards/i18n/index.js';

const T0 = Date.parse('2026-11-23T02:00:10Z'); // 台灣時間週一 10:00:10
const fast = { concurrent: 3, gapMs: 0, retryMs: 1, waitMs: 0 };
const Z = (zh) => ({ Zh_tw: zh });
const tokenRes = () => new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
function fake(routes, { onCall } = {}) {
  const hits = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return tokenRes();
    hits.push(u);
    onCall?.(u);
    for (const [re, body] of routes) if (re.test(u)) return typeof body === 'function' ? body(u) : new Response(JSON.stringify(body));
    return new Response('[]');
  };
  return { hits, fetchImpl };
}

test('必修 1：使用者併入背景預熱的同一份下載，背景讓位時使用者以前景身分自己下載（不退回示範）', async () => {
  const { hits, fetchImpl } = fake([[/./, [{ id: 1 }]]]);
  // 背景每分鐘 0 次＝背景一定讓位
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5, backgroundPerMinute: 0 } });
  const loader = (o) => tdx.get('/basic/v2/Rail/Metro/Station/TRTC', {}, 60, { ...o, cache: false });
  const bg = tdx.cached('metro-stations-TRTC', 86400, loader, { background: true, force: true });
  const user = tdx.cached('metro-stations-TRTC', 86400, loader);
  await assert.rejects(bg, (e) => e instanceof TdxYield && e.yielded && e.status === 429);
  assert.deepEqual(await user, [{ id: 1 }]);
  assert.equal(hits.length, 1, '只有使用者那一次真的送出');
  // 即時資料（同網址正在下載）也一樣
  const bg2 = tdx.get('/eta', {}, 30, { background: true });
  const user2 = tdx.get('/eta', {}, 30);
  await assert.rejects(bg2, (e) => e.yielded);
  assert.deepEqual(await user2, [{ id: 1 }]);
});

test('必修 1：背景讓位不記成額度用完（quota.at），只有真的 429 才記', async () => {
  const quota = { at: 0 };
  const s = withTdxFallback({ m: async () => { throw new TdxYield(); } }, { m: async () => 'demo' }, quota);
  assert.equal(await s.m(), 'demo');
  assert.equal(quota.at, 0);
});

test('必修 2：背景碰到每秒上限（分鐘額度還有）只讓位，不把整分鎖死；remaining 0 才鎖', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('/token')) return tokenRes();
    n++;
    if (n === 1) return new Response('{}', { status: 429, headers: { 'x-ratelimit-remaining-minute': '3', 'x-ratelimit-limit-minute': '5', 'ratelimit-reset': '40' } });
    if (n === 3) return new Response('{}', { status: 429, headers: { 'x-ratelimit-remaining-minute': '0', 'x-ratelimit-limit-minute': '5', 'ratelimit-reset': '40' } });
    return new Response('[]', { headers: { 'x-ratelimit-remaining-minute': '4', 'x-ratelimit-limit-minute': '5' } });
  };
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5 } });
  await assert.rejects(tdx.get('/bg', {}, 60, { background: true }), (e) => e.yielded);
  assert.ok(tdx.quota().left > 0, JSON.stringify(tdx.quota()));
  assert.deepEqual(await tdx.get('/user'), [], '使用者照常');
  await assert.rejects(tdx.get('/user2'), (e) => e.status === 429 && !e.yielded);
  assert.equal(tdx.quota().left, 0, 'remaining 0：這一分鐘鎖住');
});

const ROUTE = [
  [/Bus\/DisplayStopOfRoute\/City\/Taipei\/307/, [{ RouteUID: 'TPE307', RouteName: Z('307'), Direction: 0, Stops: [{ StopUID: 'S1', StopName: Z('甲'), StopSequence: 1 }, { StopUID: 'S2', StopName: Z('乙'), StopSequence: 2 }] }]],
  [/Bus\/EstimatedTimeOfArrival\/City\/Taipei\?/, [{ RouteUID: 'TPE307', Direction: 0, StopUID: 'S1', EstimateTime: 100, StopStatus: 0 }, { RouteUID: 'TPE307', Direction: 0, StopUID: 'S2', EstimateTime: 30, StopStatus: 0 }]],
];

test('建議 3：快取或舊資料的到站秒數扣掉經過時間（不小於 0），狀態文字跟著改', async () => {
  let now = T0;
  const { fetchImpl } = fake(ROUTE);
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, perMinute: 5 }, now: () => now });
  const { bus } = createTransitServices(tdx, { cities: [] });
  const a = await bus.routeEta({ city: 'Taipei', routeName: '307', shape: false });
  assert.deepEqual(a.directions[0].stops.map((s) => s.etaSec), [100, 30]);
  now += 20_000; // 快取內（30 秒）
  const b = await bus.routeEta({ city: 'Taipei', routeName: '307', shape: false });
  assert.deepEqual(b.directions[0].stops.map((s) => [s.etaSec, s.statusText]), [[80, '即將進站'], [10, '進站中']]);
  await tdx.get('/x1'); await tdx.get('/x2'); // 這分鐘剩 1 次 → 過期後用舊資料
  now += 25_000; // 資料 45 秒前
  const c = await bus.routeEta({ city: 'Taipei', routeName: '307', shape: false });
  assert.equal(c.stale, true);
  assert.equal(c.updatedAt, new Date(T0).toISOString());
  assert.deepEqual(c.directions[0].stops.map((s) => s.etaSec), [55, 0]);
});

test('建議 4：時刻表估算不說成即時——卡片標題、列不脈動、英文狀態與回答', () => {
  const zh = tFor('zh-TW'), en = tFor('en');
  const d = { station: '台北車站', source: 'timetable', trains: [{ line: '板南線', destination: '頂埔', etaMin: 1, status: 'scheduled', scheduled: true }, { line: '板南線', destination: '南港展覽館', etaMin: 4, status: 'scheduled', scheduled: true }] };
  assert.equal(metroCard.title(d, { t: zh }), '台北車站 到站（時刻表估算）');
  assert.equal(metroCard.title(d, { t: en }), '台北車站 arrivals (timetable)');
  assert.equal(metroCard.title({ station: '台北車站', trains: [] }, { t: zh }), '台北車站 即時到站');
  assert.equal(metroCard.announce(d, { t: en }), '板南線 To 頂埔 within ~1 min；板南線 To 南港展覽館 ~4 min');
  // 列：時刻表的不脈動（用最小 DOM）
  const made = [];
  class Node { constructor(tag) { this.tag = tag; this.kids = []; this.attrs = {}; this.style = {}; this.className = ''; made.push(this); } append(...k) { this.kids.push(...k); } setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {} }
  globalThis.Node = Node;
  globalThis.document = { createElement: (t) => new Node(t), createTextNode: (s) => ({ text: s }) };
  try {
    const live = { ...d, trains: [{ line: '淡水信義線', destination: '淡水', etaMin: 0, status: 'arriving' }, ...d.trains] };
    metroCard.body(live, { host: null, t: zh, locale: 'zh-TW' });
    const etas = made.filter((n) => /ab-eta/.test(n.className));
    assert.deepEqual(etas.map((n) => n.className), ['ab-eta soon', 'ab-eta planned', 'ab-eta planned']);
    assert.equal(made.filter((n) => n.className === 'ab-pulse').length, 1, '只有看板上進站中的那一班脈動');
  } finally { delete globalThis.document; delete globalThis.Node; }
  assert.match(speakEn('metro_live_board', { station: '台北車站', trains: d.trains }), /\(timetable\)/);
});

test('建議 5、6：整個縣市的靜態資料回空當失敗、不存檔；逐條查回空不存檔；記憶體有上限', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abang-tdx-'));
  try {
    const writes = [];
    const base = createFileStore(dir);
    const store = { read: base.read, write: async (k, v) => { writes.push(k); return base.write(k, v); } };
    let n = 0;
    const { fetchImpl } = fake([[/Bus\/Station\/City/, []], [/x/, () => new Response(JSON.stringify([++n]))]]);
    const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { ...fast, maxStatics: 2 }, store });
    await assert.rejects(tdx.cached('bus-stations-Taipei', 86400, transitLoaders.busStations(tdx, 'Taipei')), (e) => e.status === 502 && /空的/.test(e.message));
    assert.equal(await tdx.cached('bus-stations-Taipei', 86400, async () => [], { onlyStored: true }), undefined, '沒有留下空資料');
    // 逐條查回空：回傳空的，但不存檔
    assert.deepEqual(await tdx.cached('bus-route-Taipei-999', 86400, async () => []), []);
    assert.deepEqual(writes, []);
    // 記憶體上限 2：第三份進來時淘汰最久沒用的
    const L = (k) => tdx.cached(k, 86400, async (o) => tdx.get(`/x${k}`, {}, 60, { ...o, cache: false }), { persist: false });
    await L('a'); await L('b'); await L('c');
    await L('a');
    assert.equal(n, 4, 'a 被淘汰後重抓');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('建議 7：預熱的縣市清單裡找不到路線時改逐條查，不直接說找不到', async () => {
  const { hits, fetchImpl } = fake(ROUTE);
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: fast });
  await tdx.cached('bus-routes-Taipei', 86400, async () => [{ uid: 'TPE1', name: '1', direction: 0, stops: [{ seq: 1, uid: 'X', name: '某站' }] }]);
  const { bus } = createTransitServices(tdx, { cities: ['Taipei'] });
  const r = await bus.routeEta({ city: 'Taipei', routeName: '307', shape: false });
  assert.equal(r.directions[0].stops.length, 2);
  assert.ok(hits.some((u) => /DisplayStopOfRoute\/City\/Taipei\/307/.test(u)));
});

test('建議 8：存檔先看大小再讀（太大不讀）、讀不到的 key 記住一陣子', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abang-tdx-'));
  try {
    const store = createFileStore(dir, { maxBytes: 200 });
    await writeFile(join(dir, 'big.json'), JSON.stringify({ v: 1, key: 'big', at: 1, data: 'x'.repeat(500) }));
    assert.equal(await store.read('big'), null);
    assert.equal(await store.read('later'), null);
    await writeFile(join(dir, 'later.json'), JSON.stringify({ v: 1, key: 'later', at: 1, data: 1 }));
    assert.equal(await store.read('later'), null, '剛剛讀不到：記住，不再碰磁碟');
    await store.write('later', { at: 2, data: 2 });
    assert.deepEqual(await store.read('later'), { at: 2, data: 2 }, '自己寫入後就讀得到');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const STATIONS = [{ StationID: 'BL12', StationName: Z('台北車站') }];
const TT = [{ LineID: 'BL', StationID: 'BL12', Direction: 1, DestinationStationID: 'BL01', DestinationStationName: Z('頂埔'), ServiceDay: { Monday: true }, Timetables: [{ DepartureTime: '10:05' }] }];
const tooMany = () => new Response('{}', { status: 429, headers: { 'x-ratelimit-remaining-minute': '0', 'ratelimit-reset': '30' } });

test('建議 9：北捷看板被擋且時刻表空 → 不說成即時（走示範）；被擋但有時刻表 → source timetable；看板用舊資料帶 stale', async () => {
  const mk = (routes, now = () => T0) => createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fake(routes).fetchImpl, limit: fast, now }), { now }).metro;
  await assert.rejects(mk([[/Metro\/Station\/TRTC/, STATIONS], [/LiveBoard/, tooMany], [/StationTimeTable/, []]]).liveBoard({ system: 'TRTC', station: '台北車站' }), (e) => e.status === 429);
  // 看板第一次有資料（時刻表也存起來了），之後都被擋
  let now = T0, calls = 0;
  const board = () => (++calls === 1 ? new Response(JSON.stringify([{ LineID: 'BL', StationID: 'BL12', DestinationStationName: Z('頂埔'), EstimateTime: 0 }])) : tooMany());
  const m = mk([[/Metro\/Station\/TRTC/, STATIONS], [/LiveBoard/, board], [/StationTimeTable/, TT]], () => now);
  const first = await m.liveBoard({ system: 'TRTC', station: 'BL12' });
  assert.deepEqual([first.source, first.stale], [undefined, undefined], '看板已涵蓋往頂埔：即時');
  now += 30_000; // 看板過期、被擋：用 30 秒前的看板，帶 stale
  const s = await m.liveBoard({ system: 'TRTC', station: 'BL12' });
  assert.equal(s.stale, true);
  assert.equal(s.trains[0].status, 'arriving');
  now += 60_000; // 舊看板也太舊了、還是被擋：只有時刻表 → source timetable（不是 live）
  const r = await m.liveBoard({ system: 'TRTC', station: '台北車站' });
  assert.equal(r.source, 'timetable');
  assert.deepEqual(r.trains.map((t) => [t.destination, t.etaMin, t.scheduled]), [['頂埔', 4, true]]);
});

test('建議 10：每分鐘上限 ≤ 2 時背景預熱停用並說明', () => {
  const logs = [];
  const svc = createServices({ clientId: 'a', clientSecret: 'b', tdx: { perMinute: 2 } });
  assert.equal(svc.tdxPrewarm({ log: (m) => logs.push(m) }), null);
  assert.match(logs[0], /背景預熱停用/);
});

test('建議 11：讀 body 逾時、token 逾時都回 TdxError 504；token 失敗不扣 API 額度', async () => {
  const timeout = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  const slowBody = async (url) => (String(url).includes('/token') ? tokenRes() : { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.reject(timeout()), text: async () => '' });
  const a = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: slowBody, limit: { ...fast, perMinute: 5 } });
  await assert.rejects(a.get('/x'), (e) => e.name === 'TdxError' && e.status === 504);
  const badToken = async (url) => { if (String(url).includes('/token')) throw timeout(); return new Response('[]'); };
  const b = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: badToken, limit: { ...fast, perMinute: 5 } });
  await assert.rejects(b.get('/x'), (e) => e.status === 504);
  const denied = async (url) => (String(url).includes('/token') ? new Response('no', { status: 401 }) : new Response('[]'));
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: denied, limit: { ...fast, perMinute: 5 } });
  await assert.rejects(c.get('/x'), (e) => e.status === 401);
  assert.equal(b.quota().used, 0);
  assert.equal(c.quota().used, 0);
});
