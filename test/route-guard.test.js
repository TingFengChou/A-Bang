// 架構第三輪 #1：亂填的公車路線名稱、站位 ID 不能把 TDX 每分鐘 5 次額度用光
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitServices, createUnlistedGate } from '../core/services/transit.js';
import { createTdxClient } from '../core/tdx-client.js';
import { transitWarmSteps } from '../core/services/transit-data.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { restRoutes } from '../server/rest.js';
import { UserError } from '../core/util.js';

const Z = (s) => ({ Zh_tw: s, En: '' });
const ROUTES = [{ RouteName: Z('307'), Direction: 0, Stops: [{ StopUID: 'TPE1', StopName: Z('撫遠街'), StopSequence: 1 }] }];

async function tdxWithCount() {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    calls.push(u);
    if (/Bus\/(?:Display)?StopOfRoute\/City\/Taipei(?:\?|$)/.test(u)) return new Response(JSON.stringify(ROUTES)); // 整個縣市的路線清單（預熱）
    if (/Bus\/EstimatedTimeOfArrival/.test(u)) return new Response('[]');
    return new Response('[]');
  };
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  await transitWarmSteps(tdx, ['Taipei']).find((x) => x.key.startsWith('bus-routes-')).run(); // 背景預熱存好整個縣市的路線清單
  return { calls, svc: createTransitServices(tdx) };
}

test('預熱清單外的名稱：每分鐘最多逐條查 1 次、查不到的記住，不會把 TDX 額度用光（新路線仍查得到，建議 7）', async () => {
  const { calls, svc } = await tdxWithCount();
  await svc.bus.routeEta({ city: 'Taipei', routeName: '307' }); // 清單裡有的照常查
  const before = calls.length;
  const nf = (e) => e instanceof UserError && /找不到路線「X\d」/.test(e.message);
  await assert.rejects(svc.bus.routeEta({ city: 'Taipei', routeName: 'X1' }), nf);
  const once = calls.slice(before);
  assert.ok(once.some((u) => /StopOfRoute\/City\/Taipei\/X1/.test(u)), '第一次逐條查站序');
  assert.ok(!once.some((u) => /Shape/.test(u)), '站序查不到就不查形狀');
  const after = calls.length;
  for (const r of ['X1', 'X2', 'X3']) await assert.rejects(svc.bus.routeEta({ city: 'Taipei', routeName: r }), nf);
  assert.equal(calls.length, after, `同名記住、一分鐘內別的名稱不查：${calls.slice(after).join(' | ')}`);
});

test('createUnlistedGate：每分鐘 1 次、查不到的記 10 分鐘、記的筆數有上限', () => {
  let t = 0;
  const g = createUnlistedGate({ now: () => t, maxMissed: 2 });
  assert.equal(g.allow('a'), true);
  assert.equal(g.allow('b'), false, '一分鐘內第二個');
  t = 61_000;
  g.missed('a');
  assert.equal(g.allow('a'), false, '查不到的記住');
  assert.equal(g.allow('b'), true);
  t = 61_000 + 600_001 + 60_000;
  assert.equal(g.allow('a'), true, '10 分鐘後可以再查');
  g.missed('x'); g.missed('y'); g.missed('z');
  t += 60_001;
  assert.equal(g.allow('x'), true, '超過上限時最早記的先刪');
});

test('工具輸入：路線名稱、關鍵字最多 20 字，站位 ID 只有英數字', async () => {
  const svc = createServices({ forceMock: true });
  const long = '3'.repeat(21);
  for (const [name, args] of [['bus_route_eta', { city: 'Taipei', routeName: long }], ['bus_search_routes', { city: 'Taipei', keyword: long }], ['bus_station_eta', { city: 'Taipei', stationId: "1' or 1=1" }]]) {
    await assert.rejects(callTool(svc, name, args), UserError, name);
  }
  assert.ok((await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307' })).data, '正常的照舊');
});

test('REST（不經 zod）也檢查：路線名稱太長、站位 ID 格式不對 → UserError', async () => {
  const routes = restRoutes(createServices({ forceMock: true }));
  const call = (path, p) => routes[path].handler(p);
  assert.throws(() => call('/api/v1/bus/eta', { city: 'Taipei', route: '3'.repeat(21) }), UserError);
  assert.throws(() => call('/api/v1/bus/eta', { city: 'Taipei' }), UserError);
  assert.throws(() => call('/api/v1/bus/station-eta', { city: 'Taipei', station: '../x' }), UserError);
  assert.throws(() => call('/api/v1/bus/routes', { city: 'Taipei', keyword: 'x'.repeat(21) }), UserError);
  assert.ok((await call('/api/v1/bus/eta', { city: 'Taipei', route: '307' })).directions.length);
  assert.ok(Array.isArray(await call('/api/v1/bus/routes', { city: 'Taipei' })), '沒給關鍵字照舊');
});

test('縣市只認自己的寫法：constructor、__proto__ 不是縣市（V8-1）', async () => {
  const { resolveCity } = await import('../core/cities.js');
  for (const x of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(resolveCity(x), null, x);
  assert.equal(resolveCity('Taipei').city, 'Taipei');
  assert.equal(resolveCity('TPE').city, 'Taipei');
});

test('路線搜尋：預熱的路線清單在本機篩、不打 TDX；清單外的站位 ID 每分鐘最多查 1 次（V8-1）', async () => {
  const calls = [];
  const META = [{ RouteUID: 'TPE1', RouteName: Z('307'), DepartureStopNameZh: '撫遠街', DestinationStopNameZh: '板橋前站' }, { RouteUID: 'TPE2', RouteName: Z('紅30'), DepartureStopNameZh: 'A', DestinationStopNameZh: 'B' }];
  const STATIONS = [{ StationUID: 'TPE55', StationID: '55', StationName: Z('臺北車站'), StationPosition: { PositionLat: 25.04, PositionLon: 121.51 }, Stops: [] }];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    calls.push(u);
    if (/Bus\/Route\/City\/Taipei(?:\?|$)/.test(u) && !u.includes('contains(')) return new Response(JSON.stringify(META));
    if (/Bus\/Station\/City\/Taipei/.test(u)) return new Response(JSON.stringify(STATIONS));
    return new Response('[]');
  };
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  for (const k of ['bus-route-meta-', 'bus-stations-']) await transitWarmSteps(tdx, ['Taipei']).find((x) => x.key.startsWith(k)).run();
  const svc = createTransitServices(tdx);
  const before = calls.length;
  assert.deepEqual((await svc.bus.searchRoutes({ city: 'Taipei', keyword: '30' })).map((r) => r.routeName), ['307', '紅30']);
  assert.deepEqual(await svc.bus.searchRoutes({ city: 'Taipei', keyword: 'zz亂打' }), []);
  assert.equal(calls.length, before, `搜尋沒有打 TDX：${calls.slice(before).join(' | ')}`);
  await svc.bus.stationEta({ city: 'Taipei', stationId: '55' }); // 清單裡有的照常
  await svc.bus.stationEta({ city: 'Taipei', stationId: 'X1' }); // 清單外：第一次查（查不到記住）
  const after = calls.length;
  for (const id of ['X1', 'X2', 'X3']) await assert.rejects(svc.bus.stationEta({ city: 'Taipei', stationId: id }), UserError);
  assert.equal(calls.length, after, '同一個記住、一分鐘內別的 ID 不查');
});
