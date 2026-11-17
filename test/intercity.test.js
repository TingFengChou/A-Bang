// 國道客運（M3-07）：站牌配對、時刻表、含路況的抵達、示範模式、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoutes, tripsFromSchedule, buildTrips, departMinutes, delayRiskOf, createIntercityServices } from '../core/services/intercity.js';
import { createTdxClient } from '../core/tdx-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const Z = (s) => ({ Zh_tw: s, En: '' });
const stop = (uid, seq, name, lat, lon) => ({ StopUID: uid, StopSequence: seq, StopName: Z(name), StopPosition: { PositionLat: lat, PositionLon: lon } });
const TPE = { lat: 25.0491, lon: 121.5172 }; // 台北轉運站
const HSZ = { lat: 24.8016, lon: 120.9716 }; // 新竹車站
const ROUTES = [
  { RouteUID: 'R1', RouteName: Z('1610'), SubRouteName: Z('台北－新竹'), Direction: 0, Stops: [
    stop('A', 1, '臺北轉運站', 25.0490, 121.5170), stop('B', 2, '林口', 25.07, 121.36), stop('C', 3, '新竹轉運站', 24.8020, 120.9720)] },
  { RouteUID: 'R1', RouteName: Z('1610'), SubRouteName: Z('新竹－台北'), Direction: 1, Stops: [
    stop('C2', 1, '新竹轉運站', 24.8020, 120.9720), stop('A2', 2, '臺北轉運站', 25.0490, 121.5170)] },  // 反方向
  { RouteUID: 'R2', RouteName: Z('2011'), SubRouteName: Z('台北－台中'), Direction: 0, Stops: [
    stop('X', 1, '臺北轉運站', 25.0490, 121.5170), stop('Y', 2, '台中', 24.137, 120.686)] },          // 不到新竹
  { RouteUID: 'R3', RouteName: Z('9999'), Direction: 0, Stops: [stop('P', 1, '無座標', null, null)] },
];
const SCHEDULE = [{ RouteUID: 'R1', Direction: 0, Timetables: [
  { TripID: 't1', ServiceDay: { Tuesday: 1 }, StopTimes: [{ StopUID: 'A', DepartureTime: '18:00' }, { StopUID: 'C', ArrivalTime: '19:20' }] },
  { TripID: 't2', ServiceDay: { Tuesday: 1 }, StopTimes: [{ StopSequence: 1, DepartureTime: '18:40' }] },           // 沒有下車時間 → 估算
  { TripID: 't3', ServiceDay: { Tuesday: 0 }, StopTimes: [{ StopUID: 'A', DepartureTime: '18:50' }] },             // 週二不開
  { TripID: 't4', ServiceDay: { Tuesday: 1 }, StopTimes: [{ StopUID: 'A', DepartureTime: '17:00' }, { StopUID: 'C', ArrivalTime: '18:10' }] }, // 已過
  { TripID: 't5', StopTimes: [{ StopUID: 'A', DepartureTime: '23:30' }, { StopUID: 'C', ArrivalTime: '00:40' }] },  // 跨日
] }];
const NOW = Date.parse('2026-11-17T17:30:00+08:00'); // 週二

test('matchRoutes：起訖附近都有站且方向正確才算；同路線只留一筆', () => {
  const m = matchRoutes(ROUTES, TPE, HSZ);
  assert.deepEqual(m.map((x) => [x.routeName, x.direction, x.board.name, x.alight.name]), [['1610', 0, '臺北轉運站', '新竹轉運站']]);
  assert.ok(m[0].walkFromM < 100 && m[0].walkToM < 100);
  assert.deepEqual(matchRoutes(ROUTES, HSZ, { lat: 22.6394, lon: 120.3025 }), []);
});

test('tripsFromSchedule：依星期篩、以 StopUID 或站序對時間', () => {
  const [m] = matchRoutes(ROUTES, TPE, HSZ);
  const t = tripsFromSchedule(SCHEDULE[0], m, 2);
  assert.deepEqual(t.map((x) => [x.depart, x.arrive]), [['18:00', '19:20'], ['18:40', null], ['17:00', '18:10'], ['23:30', '00:40']]);
});

test('buildTrips：篩出發時間、排序、估算抵達、跨日、加延誤', () => {
  const [m] = matchRoutes(ROUTES, TPE, HSZ);
  const cands = tripsFromSchedule(SCHEDULE[0], m, 2).map((x) => ({ ...x, m }));
  const t = buildTrips(cands, { departMin: 17 * 60 + 30, straightM: 60000, traffic: { level: 'jam', delayMin: 20 } });
  assert.deepEqual(t.map((x) => [x.depart, x.arrive, x.minutes, x.arriveWithDelay, !!x.estimated]), [
    ['18:00', '19:20', 80, '19:40', false],
    ['18:40', '19:47', 67, '20:07', true],   // 60 km × 1.3 ÷ 70 km/h ≈ 67 分
    ['23:30', '00:40', 70, '01:00', false],
  ]);
  assert.equal(buildTrips(cands, { departMin: 0, straightM: 60000, traffic: { delayMin: 0 } })[0].arriveWithDelay, undefined);
});

test('departMinutes 與 delayRiskOf', () => {
  assert.equal(departMinutes('07:05'), 425);
  assert.equal(departMinutes(undefined, NOW), 17 * 60 + 30);
  assert.equal(departMinutes('2026-11-17T09:15:00+08:00'), 555);
  assert.throws(() => departMinutes('明天'), /departAt 格式/);
  assert.deepEqual(['jam', 'slow', 'smooth', null].map(delayRiskOf), [0.9, 0.5, 0.2, 0.4]);
});

test('trips（TDX fixture）：只查配對到的路線、路況失敗仍回班次', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    urls.push(u);
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    if (u.includes('/StopOfRoute/InterCity')) return new Response(JSON.stringify(ROUTES));
    if (u.includes('/Schedule/InterCity')) return new Response(JSON.stringify(SCHEDULE));
    return new Response('not found', { status: 404 });
  };
  const failingTraffic = { status: async () => { throw new Error('boom'); } };
  const { intercity } = createIntercityServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl }), { traffic: failingTraffic });
  const r = await intercity.trips({ from: TPE, to: HSZ, now: NOW });
  assert.ok(urls.some((u) => u.includes("$filter=RouteUID eq 'R1'") && !u.includes('R2')));
  assert.deepEqual([r.system, r.date, r.departAt, r.traffic.level, r.delayRisk], ['BUS', '2026-11-17', '17:30', null, 0.4]);
  assert.deepEqual(r.trains.map((t) => t.depart), ['18:00', '18:40', '23:30']);
  assert.equal(r.trains[0].fare, null);
});

test('示範模式與 intercity_bus tool：塞車時抵達含延誤、近距離沒有班次', async () => {
  const svc = createServices({ forceMock: true, demo: { traffic: 'jam' } });
  const r = await callTool(svc, 'intercity_bus', { from: '台北轉運站', to: '新竹車站', departAt: '18:10' });
  assert.equal(r.card, 'timetable');
  assert.equal(r.data.system, 'BUS');
  assert.equal(r.data.traffic.level, 'jam');
  assert.ok(r.data.trains.length > 0 && r.data.trains.every((t) => t.arriveWithDelay && t.depart >= '18:10'));
  assert.match(r.speak, /^下一班.+ \d{2}:\d{2} 出發，預計 \d{2}:\d{2} 到（路上塞車中，多 \d+ 分）。$/);
  const near = await callTool(svc, 'intercity_bus', { from: '台北車站', to: '台北101' });
  assert.deepEqual(near.data.trains, []);
  assert.match(near.speak, /沒有直達的國道客運/);
  await assert.rejects(callTool(svc, 'intercity_bus', { from: '台北車站', to: '新竹車站', departAt: '6點' }), /HH:mm/);
});
