// 捷運（M3-04）：TDX 形狀 fixture 驗證正規化、示範模式與 tools
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetroServices, metroStatusText } from '../core/services/metro.js';
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
  assert.ok(urls.some((u) => u.includes("StationID eq 'BL12' or StationID eq 'R10'")));
  assert.deepEqual(r.trains.map((t) => [t.line, t.destination, t.etaMin, t.status]), [
    ['板南線', '頂埔', 0, '進站中'],
    ['淡水信義線', '淡水', 4, '4 分'],
    ['BL', '南港展覽館', null, '—'],
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
  await assert.rejects(metro.liveBoard({ system: 'KRTC', station: '美麗島' }), /高雄捷運找不到/);
});

test('metroStatusText', () => {
  assert.deepEqual([0, 1, 2, null].map(metroStatusText), ['進站中', '即將進站', '2 分', '—']);
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
