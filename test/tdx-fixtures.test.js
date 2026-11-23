// M1-03：用 TDX 真實回應（2026-11-23 以 scripts/record-fixtures.js 錄製，每端點前 5 筆，不含金鑰）檢查正規化與實際欄位相符。
// 重新錄製：node scripts/record-fixtures.js（每分鐘 5 次額度，預設每次間隔 13 秒）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTransitServices, routeShape, railLoaders } from '../core/services/transit.js';
import { normRouteStops, stopOfRoutePath, DISPLAY_STOP_CITIES } from '../core/services/transit-data.js';
import { createTrafficServices, eventsAlong } from '../core/services/traffic.js';
import { normIntercityStops, matchRoutes, tripsFromSchedule, buildTrips } from '../core/services/intercity.js';
import { normStationTimetable } from '../core/services/metro.js';
import { AIRPORT_EXPRESS } from '../core/services/trip.js';
import { intercityBus } from '../core/tools/intercity.js';
import { parseWkt } from '../core/geo.js';
import { toMin } from '../core/util.js';
import { createTdxClient } from '../core/tdx-client.js';

const fx = (id) => JSON.parse(readFileSync(new URL(`./fixtures/tdx-${id}.json`, import.meta.url), 'utf8'));
const inTaiwan = ([lat, lon]) => lat > 21.8 && lat < 26.5 && lon > 119.2 && lon < 122.2;

/** 假 TDX：網址（解碼後）對 [正規式, 回應] 清單；回應是函式時回 Response 本身 */
function fakeTdx(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    calls.push(u);
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    const hit = routes.find(([re]) => re.test(u));
    if (!hit) return new Response('not found', { status: 404 });
    return typeof hit[1] === 'function' ? hit[1]() : new Response(JSON.stringify(hit[1]));
  };
  return { tdx: createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl }), calls };
}

// ───── 公車 ─────
test('Bus Shape（台北 307）：Geometry 是 LINESTRING（有空格），經緯度順序正確、去程優先', () => {
  const rows = fx('bus-shape-taipei-307');
  assert.ok(rows.every((r) => /^LINESTRING \(/.test(r.Geometry)));
  for (const r of rows) assert.ok(parseWkt(r.Geometry)[0].length > 100);
  const path = routeShape(rows);
  assert.ok(path.length >= 2 && path.every(inTaiwan));
  const dir0 = rows.find((r) => r.Direction === 0);
  assert.deepEqual(path[0], parseWkt(dir0.Geometry)[0][0]); // 取去程（Direction 0），第一點不被抽掉
});

test('routeEta：真實到站與形狀（台北 307）——StopStatus 0／1／4 的文字、沒有 NextBusTime 時「尚未發車」', async () => {
  const eta = fx('bus-route-eta-taipei-307');
  // 站序用到站資料裡的站（DisplayStopOfRoute 307 未錄；欄位形狀同 tdx-bus-display-stop-of-route-taipei）
  const byDir = [0, 1].map((d) => ({ RouteUID: eta[0].RouteUID, RouteName: eta[0].RouteName, Direction: d,
    Stops: eta.filter((e) => e.Direction === d).map((e, i) => ({ StopUID: e.StopUID, StopName: e.StopName, StopSequence: i + 1 })) }));
  const { tdx } = fakeTdx([
    [/Bus\/DisplayStopOfRoute\/City\/Taipei\/307/, byDir],
    [/Bus\/Shape\/City\/Taipei\/307/, fx('bus-shape-taipei-307')],
    [/Bus\/EstimatedTimeOfArrival\/City\/Taipei\?/, eta],
  ]);
  const r = await createTransitServices(tdx, { cities: [] }).bus.routeEta({ city: 'Taipei', routeName: '307' });
  const stops = r.directions.flatMap((d) => d.stops);
  assert.equal(stops.length, eta.length);
  for (const s of stops) {
    const e = eta.find((x) => x.StopName.Zh_tw === s.stopName);
    if (e.StopStatus === 0) assert.ok(s.etaSec != null && /分|進站中|即將/.test(s.statusText), s.statusText);
    if (e.StopStatus === 1) assert.equal(s.statusText, '尚未發車');
  }
  assert.ok(r.shape.length >= 2);
});

test('DisplayStopOfRoute（臺北市整市）：每站都有 StopPosition、一個路線一個方向一筆', () => {
  const rows = fx('bus-display-stop-of-route-taipei');
  const dirs = normRouteStops(rows);
  assert.equal(dirs.length, rows.length);
  for (const d of dirs) {
    assert.ok([0, 1].includes(d.direction));
    assert.ok(d.stops.length && d.stops.every((s) => inTaiwan([s.lat, s.lon]) && s.uid && s.name));
  }
});

test('高雄等縣市：DisplayStopOfRoute 回 400，改用 StopOfRoute（每個子路線一筆，重複列取站最多的）', async () => {
  assert.equal(stopOfRoutePath('Kaohsiung'), '/basic/v2/Bus/StopOfRoute/City/Kaohsiung');
  assert.equal(stopOfRoutePath('Taipei'), '/basic/v2/Bus/DisplayStopOfRoute/City/Taipei');
  assert.deepEqual([...DISPLAY_STOP_CITIES].sort(), ['NewTaipei', 'Taichung', 'Tainan', 'Taipei', 'Taoyuan']);
  const rows = fx('bus-stop-of-route-kaohsiung');
  assert.ok(rows.every((r) => 'SubRouteUID' in r));
  const dirs = normRouteStops(rows);
  assert.equal(dirs.length, new Set(rows.map((r) => `${r.RouteUID}|${r.Direction}`)).size);
  // 同一路線同方向兩個子路線（支線）：各留一筆；同一子路線重複的列：留站多的
  const long = rows[0];
  const branch = { ...long, SubRouteUID: `${long.SubRouteUID}X`, Stops: long.Stops.slice(0, 3) };
  assert.equal(normRouteStops([branch, long]).length, 2);
  const dup = normRouteStops([{ ...long, Stops: long.Stops.slice(0, 3) }, long]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].stops.length, long.Stops.length);
  // routeEta 走 StopOfRoute
  const route = long.RouteName.Zh_tw;
  const { tdx, calls } = fakeTdx([
    [/Bus\/DisplayStopOfRoute\/City\/Kaohsiung/, () => new Response('{"Message":"City: \'Kaohsiung\' is not accepted"}', { status: 400 })],
    [/Bus\/StopOfRoute\/City\/Kaohsiung\//, rows.filter((r) => r.RouteName.Zh_tw === route)],
    [/Bus\/EstimatedTimeOfArrival\/City\/Kaohsiung\?/, []],
  ]);
  const r = await createTransitServices(tdx, { cities: [] }).bus.routeEta({ city: 'Kaohsiung', routeName: route, shape: false });
  assert.ok(r.directions.length >= 1 && r.directions[0].stops.every((s) => inTaiwan([s.lat, s.lon])));
  assert.ok(!calls.some((u) => u.includes('DisplayStopOfRoute')));
});

test('Bus Station NearBy（台北車站）：座標、縣市、路線去重、依距離排序', async () => {
  const { tdx } = fakeTdx([[/Bus\/Station\/NearBy/, fx('bus-station-nearby')]]);
  const s = await createTransitServices(tdx, { cities: [] }).bus.nearbyStations({ lat: 25.0478, lon: 121.517 });
  assert.equal(s.length, 5);
  assert.ok(s.every((x) => x.city === 'Taipei' && x.routes.length && new Set(x.routes).size === x.routes.length));
  assert.ok(s.every((x, i) => i === 0 || s[i - 1].distance <= x.distance));
});

// ───── 國道路況 ─────
function freewaySvc(events = fx('freeway-road-event')) {
  const { tdx, calls } = fakeTdx([
    [/Road\/Traffic\/SectionShape\/Freeway/, fx('freeway-section-shape')],
    [/Road\/Traffic\/Section\/Freeway/, fx('freeway-section')],
    [/Road\/Traffic\/Live\/Freeway/, fx('freeway-live')],
    [/Traffic\/RoadEvent\/LiveEvent\/Freeway/, events],
  ]);
  return { traffic: createTrafficServices(tdx).traffic, calls };
}

test('國道路況：真實 SectionShapes／Sections／LiveTraffics 包裝與欄位（國 1 基隆端往南）', async () => {
  const { traffic, calls } = freewaySvc();
  const r = await traffic.status({ from: { lat: 25.1224, lon: 121.7353 }, to: { lat: 25.0478, lon: 121.517 } });
  assert.equal(r.covered, true);
  const ids = fx('freeway-section-shape').SectionShapes.map((s) => s.SectionID);
  assert.ok(r.segments.length >= 3 && r.segments.every((s) => ids.includes(s.id)));
  assert.equal(r.segments[0].id, '0001'); // 依行進方向排序
  assert.equal(r.segments[0].name, '國道1號(基隆端到基隆)');
  assert.deepEqual([r.segments[0].road, r.segments[0].limitKmh, r.segments[0].lengthKm], ['國道1號', 100, 1.1]);
  const live = fx('freeway-live').LiveTraffics.find((l) => l.SectionID === '0001');
  assert.equal(r.segments[0].speedKmh, live.TravelSpeed);
  assert.equal(r.updatedAt, fx('freeway-live').LiveTraffics[0].DataCollectTime);
  assert.ok(['smooth', 'slow', 'jam'].includes(r.level));
  assert.deepEqual(r.events, []); // 錄到的事件都不在這一段
  assert.ok(calls.some((u) => u.includes('/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway')));
  assert.ok(!calls.some((u) => u.includes('/Live/News/')));
});

test('道路事件：Live/News 沒有路名與位置；RoadEvent 依 POINT 位置與方向篩選', () => {
  const news = fx('freeway-news').Newses;
  assert.ok(news.every((n) => !('Description' in n) && !/國道/.test(n.Title))); // 以前依路名篩一律對不到
  const ev = fx('freeway-road-event');
  const sanchong = ev.LiveEvents.find((e) => /三重/.test(JSON.stringify(e.Location)));
  assert.equal(sanchong.Location.FreeExpressHighway.Direction, '北向');
  const [lon, lat] = /POINT\((\S+) (\S+)\)/.exec(sanchong.Positions).slice(1).map(Number);
  const path = [[lat - 0.002, lon + 0.001], [lat + 0.002, lon - 0.001]];
  assert.deepEqual(eventsAlong(ev, [{ path, dir: 'N' }]).map((e) => e.title), [sanchong.Description]);
  assert.equal(eventsAlong(ev, [{ path, dir: 'N' }])[0].time, sanchong.PublishTime);
  assert.deepEqual(eventsAlong(ev, [{ path, dir: 'S' }]), []); // 對向車道
  assert.deepEqual(eventsAlong(ev, [{ path: path.map(([a, b]) => [a + 0.02, b]), dir: 'N' }]), []); // 2 公里外
  assert.equal(eventsAlong(ev, [{ path, dir: 'S' }, { path, dir: 'N' }]).length, 1); // 附近兩個方向的路段都有：有同方向的就算
  // 一段線的事件（施工路段）：任何一點在沿途就算
  const span = { LiveEvents: [{ ...sanchong, Positions: `LINESTRING(${lon + 0.05} ${lat}, ${lon} ${lat})` }] };
  assert.equal(eventsAlong(span, [{ path, dir: 'N' }]).length, 1);
});

// ───── 國道客運 ─────
test('公路客運：真實站序與時刻表——ServiceDay 是 0／1、有些班次 StopTimes 只有起站', () => {
  const stops = normIntercityStops(fx('intercity-stop-of-route'));
  const schedule = fx('intercity-schedule');
  const at = (name, dir) => {
    const s = stops.find((r) => r.Direction === dir).Stops.find((x) => x.StopName.Zh_tw === name);
    return { lat: s.StopPosition.PositionLat, lon: s.StopPosition.PositionLon };
  };
  assert.ok(schedule.flatMap((r) => r.Timetables).every((t) => [0, 1].includes(t.ServiceDay.Monday)));
  // 回程：每站都有時間
  const [back] = matchRoutes(stops, at('長榮', 1), at('大竹消防隊', 1));
  assert.deepEqual([back.routeName, back.direction, back.board.name, back.alight.name], ['0968', 1, '長榮', '大竹消防隊']);
  const full = schedule.find((s) => s.SubRouteUID === back.subRouteUid && s.Direction === 1);
  const t = tripsFromSchedule(full, back, 1);
  assert.ok(t.length && t.every((x) => x.depart && x.arrive && !x.fromOrigin));
  // 去程：時刻表只有起站 → 由起站時間沿站牌距離估到上車站的時間（不會比起站早），抵達用估的
  const [go] = matchRoutes(stops, at('上大竹', 0), at('庫倫街口', 0));
  assert.equal(go.board.seq, 3);
  assert.deepEqual(go.along.map(([q]) => q), [1, 2, 3]);
  assert.ok(go.along[2][1] > 0);
  const originOnly = schedule.find((s) => s.SubRouteUID === go.subRouteUid && s.Direction === 0);
  assert.ok(originOnly.Timetables.every((x) => x.StopTimes.length === 1));
  const g = tripsFromSchedule(originOnly, go, 1);
  const monday = originOnly.Timetables.filter((x) => x.ServiceDay.Monday === 1).map((x) => x.StopTimes[0].DepartureTime);
  assert.deepEqual(g.map((x) => x.fromStop), monday.map((time) => ({ name: '大竹消防隊', time })));
  for (const [i, x] of g.entries()) {
    const lag = toMin(x.depart) - toMin(monday[i]);
    assert.ok(lag >= 0 && lag <= 10, `${x.depart} vs ${monday[i]}`); // 上大竹離起站約 2 公里
  }
  const [trip] = buildTrips(g.map((x) => ({ ...x, m: go })), { departMin: toMin(g[0].depart), straightM: 5000, traffic: null });
  assert.deepEqual([trip.depart, trip.departEstimated, trip.departFrom, trip.estimated], [g[0].depart, true, g[0].fromStop, true]);
  assert.match(intercityBus.speak({ trains: [trip], traffic: {} }), /^下一班0968 約 \d{2}:\d{2} 到上大竹（大竹消防隊 \d{2}:\d{2} 開），預計/);
  // 起站已經開走、但還沒到上車站：仍列出（以估的上車時間篩）
  assert.equal(buildTrips(g.map((x) => ({ ...x, m: go })), { departMin: toMin(monday[0]) + 1, straightM: 5000, traffic: null })[0].depart, g[0].depart);
});

test('公路客運票價端點存在：RouteFare/InterCity 的 StageFares（尚未串接）', () => {
  const [f] = fx('intercity-route-fare');
  const st = f.StageFares[0];
  assert.ok(st.OriginStage.StopID && st.DestinationStage.StopID && Number.isFinite(st.Fares[0].Price));
});

// ───── 捷運 ─────
test('北捷站別時刻表（台北車站 BL12）：ServiceDay 是布林、平日與假日分開、假日那份 NationalHolidays: true', () => {
  const rows = fx('metro-station-timetable-trtc-bl12');
  const t = normStationTimetable(rows);
  assert.equal(t.length, rows.length);
  for (const [i, r] of t.entries()) {
    assert.equal(typeof r.holiday, 'boolean');
    assert.equal(r.holiday, rows[i].ServiceDay.NationalHolidays);
    assert.ok(r.times.length && r.times.every((x) => /^\d{2}:\d{2}$/.test(x)));
    assert.ok(r.destId && r.dest && r.lineId === 'BL');
  }
  const weekday = t.find((r) => r.days[1]), weekend = t.find((r) => r.days[0]);
  assert.deepEqual([weekday.holiday, weekday.days[0], weekend.holiday, weekend.days[1]], [false, false, true, false]);
});

test('機場捷運 S2STravelTime：直達車（TrainType 2）台北車站 → 第一／第二航廈與 AIRPORT_EXPRESS 相差 2 分內', () => {
  const express = fx('metro-s2s-travel-time-tymc').find((r) => r.TrainType === 2);
  const min = (to) => express.TravelTimes.find((x) => x.FromStationID === 'A1' && x.ToStationID === to).RunTime / 60;
  assert.ok(Math.abs(min('A12') - AIRPORT_EXPRESS.stops.機場第一航廈) <= 2, `A12 ${min('A12')} 分`);
  assert.ok(Math.abs(min('A13') - AIRPORT_EXPRESS.stops.機場第二航廈) <= 2, `A13 ${min('A13')} 分`);
});

// ───── 高鐵、台鐵車站 ─────
test('高鐵、台鐵車站：StationPosition 有效；台鐵 v3 包在 Stations、StationClass 是字串', async () => {
  const get = (data) => ({ get: async () => data });
  const thsr = await railLoaders.thsrStations(get(fx('thsr-station')))({});
  assert.ok(thsr.length === 5 && thsr.every((s) => s.id && s.name && inTaiwan([s.lat, s.lon])));
  const traRaw = fx('tra-station');
  assert.ok(Array.isArray(traRaw.Stations) && traRaw.Stations.every((s) => typeof s.StationClass === 'string'));
  const tra = await railLoaders.traStations(get(traRaw))({});
  assert.ok(tra.length === 5 && tra.every((s) => s.id && s.name && inTaiwan([s.lat, s.lon])));
});
