// 捷運（M3-04）：TDX 形狀 fixture 驗證正規化、示範模式與 tools
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetroServices, metroStatusText, metroStatusCode } from '../core/services/metro.js';
import { createTdxClient } from '../core/tdx-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const Z = (s) => ({ Zh_tw: s, En: '' });
const P = (lat, lon) => ({ PositionLat: lat, PositionLon: lon });
const STATIONS = [
  { StationID: 'BL12', StationName: Z('台北車站'), StationPosition: P(25.0462, 121.5174) },
  { StationID: 'R10', StationName: Z('臺北車站'), StationPosition: P(25.0462, 121.5174) },  // 臺／台 不同寫法仍合併
  { StationID: 'BL18', StationName: Z('市政府'), StationPosition: P(25.041, 121.5654) },
  { StationID: 'X1', StationName: Z('無座標站') },
];
const BOARD = [
  { LineID: 'R', LineName: Z('淡水信義線'), StationID: 'R10', DestinationStationName: Z('淡水'), EstimateTime: 4, UpdateTime: '2026-11-17T21:00:10+08:00' },
  { LineID: 'BL', LineName: Z('板南線'), StationID: 'BL12', TripHeadSign: '往頂埔', DestinationStationName: Z('頂埔'), EstimateTime: 0, UpdateTime: '2026-11-17T21:00:20+08:00' },
  { LineNO: 'BL', StationID: 'BL12', TripHeadSign: '南港展覽館' },
];

const urls = [];
const fakeFetch = async (url) => {
  const u = decodeURIComponent(String(url));
  urls.push(u);
  if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
  if (/Metro\/Station\/TRTC/.test(u)) return new Response(JSON.stringify(STATIONS));
  if (/Metro\/LiveBoard\/TRTC/.test(u)) return new Response(JSON.stringify(BOARD));
  if (/Metro\/(Station|LiveBoard)\/KRTC/.test(u)) return new Response('[]');
  // 回應包在物件裡（v3 形式）也要能解析
  if (/Metro\/Station\/TMRT/.test(u)) return new Response(JSON.stringify({ Stations: STATIONS }));
  if (/Metro\/LiveBoard\/TMRT/.test(u)) return new Response(JSON.stringify({ LiveBoards: BOARD }));
  return new Response('not found', { status: 404 });
};
const { metro } = createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch }));

test('stations：同名多線合併、座標可缺', async () => {
  const s = await metro.stations({ system: 'trtc' });
  assert.deepEqual(s.map((x) => x.name), ['台北車站', '市政府', '無座標站']);
  assert.deepEqual(s[0].ids, ['BL12', 'R10']);
  assert.equal(s[0].lat, 25.0462);
  assert.equal('lat' in s[2], false);
});

test('liveBoard：查同站所有代碼、依分鐘排序、目的地備援 TripHeadSign', async () => {
  const r = await metro.liveBoard({ system: 'TRTC', station: '臺北車站' });
  assert.equal(r.station, '台北車站');
  // 看板整個系統一次取（所有車站共用一份快取，不依站另查）
  assert.ok(urls.some((u) => /Metro\/LiveBoard\/TRTC\?\$format=JSON$/.test(u)), urls.join('\n'));
  assert.deepEqual(r.trains.map((t) => [t.line, t.destination, t.etaMin, t.status]), [
    ['板南線', '頂埔', 0, 'arriving'],
    ['淡水信義線', '淡水', 4, 'minutes'],
    ['板南線', '南港展覽館', null, 'unknown'], // 看板沒有路線名稱時用代碼對照
  ]);
  assert.equal(r.updatedAt, '2026-11-17T21:00:20+08:00');
});

test('stations／liveBoard：回應包在物件裡也能解析', async () => {
  assert.equal((await metro.stations({ system: 'TMRT' })).length, 3);
  assert.equal((await metro.liveBoard({ system: 'TMRT', station: '台北車站' })).trains.length, 3);
});

test('liveBoard：代碼查站、錯誤訊息', async () => {
  assert.equal((await metro.liveBoard({ system: 'TRTC', station: 'bl18' })).station, '市政府');
  // 轉乘站的第二條線代碼也查得到
  assert.equal((await metro.liveBoard({ system: 'TRTC', station: 'r10' })).station, '台北車站');
  await assert.rejects(metro.liveBoard({ system: 'TRTC', station: '火星' }), /台北捷運找不到「火星」站/);
  await assert.rejects(metro.stations({ system: 'MRT' }), /不支援的捷運系統/);
  await assert.rejects(metro.liveBoard({ system: 'KRTC', station: '美麗島' }), /TDX 回了空的高雄捷運車站/); // 整個系統的車站是空的：當上游失敗（不存檔）
});

test('metroStatusText', () => {
  assert.deepEqual([0, 1, 2, null].map((m) => metroStatusText({ status: metroStatusCode(m), etaMin: m })), ['進站中', '即將進站', '2 分', '—']);
});

test('示範模式：四個系統都有站與看板，終點站不顯示往自己的車', async () => {
  const svc = createServices({ forceMock: true });
  for (const system of ['TRTC', 'TYMC', 'TMRT', 'KRTC']) {
    const st = await svc.metro.stations({ system });
    assert.ok(st.length >= 5, system);
    const b = await svc.metro.liveBoard({ system, station: st[0].name });
    assert.ok(b.trains.length > 0, system);
    assert.ok(b.trains.every((t) => t.etaMin >= 0 && t.etaMin <= 5), system);
  }
  const end = await svc.metro.liveBoard({ system: 'TRTC', station: '淡水' });
  assert.deepEqual(end.trains.map((t) => t.destination), ['象山']);
});

test('metro tools：card、speak、nav', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_live_board', { system: 'KRTC', station: '美麗島' });
  assert.equal(r.card, 'metro');
  assert.equal(r.data.trains.length, 4); // 紅線、橘線各兩個方向
  assert.match(r.speak, /^美麗島(往.+的車(進站中|即將進站)|最快 \d 分鐘後有往.+的車)。$/);
  assert.match(r.data.nav.google, /maps\/dir/);
  const s = await callTool(svc, 'metro_stations', { system: 'TYMC' });
  assert.match(s.speak, /桃園機場捷運共有 6 個車站/);
  assert.ok(s.data.every((x) => x.nav));
  await assert.rejects(callTool(svc, 'metro_stations', { system: 'XYZ' }), /參數錯誤/);
});

// 2026-11-23 使用者回報「捷運到站找不到三鶯線」：前端選單漏了新北捷運與輕軌
test('捷運到站頁的系統選單＝後端 METRO_SYSTEMS（新北捷運三鶯線、各條輕軌都要有）', async () => {
  const { METRO_SYSTEMS } = await import('../core/services/metro.js');
  const { METRO } = await import('../public/js/pages/service.js');
  assert.deepEqual(METRO.map(([k]) => k).sort(), Object.keys(METRO_SYSTEMS).sort());
  assert.match(METRO.find(([k]) => k === 'NTMC')[1], /三鶯線/);
});

test('看板查不到（404、上游錯誤）：改用時刻表並照實標示；時刻表也沒有才丟錯（退回示範）', async () => {
  const T0 = Date.parse('2026-11-23T10:01:00+08:00'); // 星期一
  const ST = [{ StationID: 'LB08', StationName: Z('鶯歌車站'), StationPosition: P(24.954, 121.353) }];
  const TT = [{ LineID: 'LB', StationID: 'LB08', Direction: 0, DestinationStationID: 'LB01', DestinationStationName: { Zh_tw: '頂埔', En: 'Dingpu' }, ServiceDay: { Monday: true }, Timetables: [{ DepartureTime: '10:05' }, { DepartureTime: '10:15' }] }];
  const mk = (board, table) => {
    const fetchImpl = async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
      if (/Metro\/Station\/NTMC/.test(u)) return new Response(JSON.stringify(ST));
      if (/LiveBoard\/NTMC/.test(u)) return board();
      if (/StationTimeTable\/NTMC/.test(u)) return table();
      return new Response('not found', { status: 404 });
    };
    const now = () => T0;
    return createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, now }), { now }).metro;
  };
  const notFound = () => new Response('not found', { status: 404 });
  const tt = () => new Response(JSON.stringify(TT));
  for (const board of [notFound, () => new Response('oops', { status: 500 })]) {
    const r = await mk(board, tt).liveBoard({ system: 'NTMC', station: '鶯歌' });
    assert.equal(r.source, 'timetable');
    assert.match(r.note, /依時刻表估算/);
    assert.doesNotMatch(r.note, /進站中/, '看板查不到：不說成「看板只有進站中」');
    assert.deepEqual(r.trains.map((t) => [t.line, t.lineEn, t.destination, t.etaMin, t.scheduled]), [['三鶯線', 'Sanying Line', '頂埔', 4, true]]);
  }
  await assert.rejects(mk(notFound, notFound).liveBoard({ system: 'NTMC', station: '鶯歌' }), (e) => e.status === 404);
  // 看板 404：10 分鐘內不再查看板（每分鐘只有幾次額度）
  let boardCalls = 0;
  const m = mk(() => { boardCalls++; return notFound(); }, tt);
  await m.liveBoard({ system: 'NTMC', station: '鶯歌' });
  const again = await m.liveBoard({ system: 'NTMC', station: '鶯歌' });
  assert.equal(boardCalls, 1);
  assert.equal(again.source, 'timetable');
});

test('示範資料：每個捷運系統都有幾個站可以查到站', async () => {
  const { createMockMetroServices } = await import('../core/services/metro-mock.js');
  const { METRO_SYSTEMS } = await import('../core/services/metro.js');
  const { metro: m } = createMockMetroServices();
  for (const op of Object.keys(METRO_SYSTEMS)) {
    const s = await m.stations({ system: op });
    assert.ok(s.length >= 4, `${op} 只有 ${s.length} 站`);
    const b = await m.liveBoard({ system: op, station: s[3].name });
    assert.ok(b.trains.length > 0, op);
  }
});

test('看板單位：淡海、安坑輕軌 EstimateTime 是秒；新北捷運看板只有進站中，另一方向用時刻表補', async () => {
  const T0 = Date.parse('2026-11-23T10:01:00+08:00');
  const mk = (op, st, board, table = []) => {
    const fetchImpl = async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
      if (u.includes(`Metro/Station/${op}`)) return new Response(JSON.stringify(st));
      if (u.includes(`LiveBoard/${op}`)) return new Response(JSON.stringify(board));
      if (u.includes(`StationTimeTable/${op}`)) return new Response(JSON.stringify(table));
      return new Response('not found', { status: 404 });
    };
    const now = () => T0;
    return createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, now }), { now }).metro;
  };
  const lrt = mk('NTALRT', [{ StationID: 'K04', StationName: Z('耕莘安康院區') }], [
    { LineID: 'K', StationID: 'K04', DestinationStationName: Z('雙城'), EstimateTime: 60 },
    { LineID: 'K', StationID: 'K04', DestinationStationName: Z('十四張'), EstimateTime: 720 },
  ]);
  const r = await lrt.liveBoard({ system: 'NTALRT', station: '耕莘安康院區' });
  assert.deepEqual(r.trains.map((t) => [t.destination, t.etaMin]), [['雙城', 1], ['十四張', 12]], '720 秒＝12 分，不是 720 分');
  const ntmc = mk('NTMC', [{ StationID: 'Y16', StationName: Z('板橋') }],
    [{ LineID: 'Y', StationID: 'Y16', DestinationStationName: Z('大坪林'), EstimateTime: 0 },
      { LineID: 'Y', StationID: 'Y16', DestinationStationName: Z('新北產業園區'), TripHeadSign: '往新北產業園區' }], // 實測：沒有 EstimateTime 的列
    [{ LineID: 'Y', StationID: 'Y16', Direction: 1, DestinationStationID: 'Y20', DestinationStationName: Z('新北產業園區'), ServiceDay: { Monday: true }, Timetables: [{ DepartureTime: '10:07' }] }]);
  const b = await ntmc.liveBoard({ system: 'NTMC', station: '板橋' });
  assert.deepEqual(b.trains.map((t) => [t.destination, t.etaMin, Boolean(t.scheduled)]), [['大坪林', 0, false], ['新北產業園區', 6, true]]);
  assert.equal(b.source, 'mixed');
  assert.match(b.note, /^新北捷運/);
});
