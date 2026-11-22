// 以 TDX 回應格式的假資料驗證「真實版」正規化邏輯（不需網路與金鑰）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitServices } from '../core/services/transit.js';
import { createTdxClient } from '../core/tdx-client.js';

const Z = (s) => ({ Zh_tw: s, En: '' });
const fixtures = [
  [/Bus\/DisplayStopOfRoute/, [
    { RouteName: Z('307'), Direction: 0, Stops: [
      { StopUID: 'TPE1', StopName: Z('撫遠街'), StopSequence: 1, StopPosition: { PositionLat: 25.0712, PositionLon: 121.5627 } },
      { StopUID: 'TPE2', StopName: Z('臺北車站'), StopSequence: 2, StopPosition: { PositionLat: 25.0462, PositionLon: 121.5173 } },
      { StopUID: 'TPE3', StopName: Z('板橋前站'), StopSequence: 3 }] },
    { RouteName: Z('307'), Direction: 1, Stops: [{ StopUID: 'TPE9', StopName: Z('板橋前站'), StopSequence: 1 }, { StopUID: 'TPE8', StopName: Z('撫遠街'), StopSequence: 2 }] },
  ]],
  [/Bus\/Shape\/City\/Taipei\/307/, [
    { RouteName: Z('307'), Direction: 1, Geometry: 'LINESTRING(121.4600 25.0140, 121.5173 25.0462)' },
    { RouteName: Z('307'), Direction: 0, Geometry: 'MULTILINESTRING((121.5627 25.0712, 121.5400 25.0600), (121.5400 25.0600, 121.5173 25.0462, 121.4600 25.0140))' }]],
  [/Bus\/EstimatedTimeOfArrival\/City\/Taipei\/PassThrough/, [
    { RouteName: Z('307'), Direction: 0, EstimateTime: 400, StopStatus: 0 },
    { RouteName: Z('262'), Direction: 1, StopStatus: 3 },
    { RouteName: Z('0東'), Direction: 0, EstimateTime: 30, StopStatus: 0 }]],
  [/Bus\/EstimatedTimeOfArrival/, [
    { StopUID: 'TPE1', Direction: 0, EstimateTime: 45, StopStatus: 0, PlateNumb: 'KKA-1234' },
    { StopUID: 'TPE2', Direction: 0, EstimateTime: 600, StopStatus: 0, PlateNumb: '-1' },
    { StopUID: 'TPE3', Direction: 0, StopStatus: 1 }]],
  [/Bus\/Route\/City\/Taipei\/307/, [{ RouteName: Z('307'), DepartureStopNameZh: '撫遠街', DestinationStopNameZh: '板橋前站' }]],
  [/Bus\/Station\/NearBy/, [
    { StationUID: 'TPE55', StationID: '55', StationName: Z('臺北車站(忠孝)'), StationPosition: { PositionLat: 25.0462, PositionLon: 121.5173 }, Stops: [{ RouteName: Z('307') }, { RouteName: Z('307') }, { RouteName: Z('262') }] },
    { StationUID: 'NWT66', StationID: '66', StationName: Z('遠站'), StationPosition: { PositionLat: 25.05, PositionLon: 121.52 }, Stops: [] }]],
  [/Bike\/Station\/NearBy/, [{ StationUID: 'TPE500101', StationName: Z('YouBike2.0_捷運台北車站M8'), StationAddress: Z('忠孝西路'), StationPosition: { PositionLat: 25.0479, PositionLon: 121.5171 }, BikesCapacity: 40, ServiceType: 2 }]],
  [/Bike\/Availability/, [{ StationUID: 'TPE500101', ServiceStatus: 1, AvailableRentBikes: 12, AvailableReturnBikes: 28, AvailableRentBikesDetail: { GeneralBikes: 9, ElectricBikes: 3 }, UpdateTime: '2026-11-17T21:00:00+08:00' }]],
  [/THSR\/Station/, [{ StationID: '1000', StationName: Z('台北') }, { StationID: '1070', StationName: Z('左營') }]],
  [/THSR\/DailyTimetable\/OD\/1000\/to\/1070\/2026-11-18/, [
    { DailyTrainInfo: { TrainNo: '0803' }, OriginStopTime: { DepartureTime: '08:00' }, DestinationStopTime: { ArrivalTime: '09:45' } },
    { DailyTrainInfo: { TrainNo: '0603' }, OriginStopTime: { DepartureTime: '06:30' }, DestinationStopTime: { ArrivalTime: '08:00' } }]],
  [/THSR\/ODFare\/1000\/to\/1070/, [{ OriginStationID: '1000', DestinationStationID: '1070', Fares: [
    { TicketType: 1, FareClass: 1, CabinClass: 2, Price: 2390 },
    { TicketType: 1, FareClass: 1, CabinClass: 1, Price: 1490 },
    { TicketType: 1, FareClass: 3, CabinClass: 1, Price: 745 },
    { TicketType: 9, FareClass: 1, CabinClass: 1, Price: 1000 },
    { TicketType: 1, FareClass: 1, CabinClass: 3, Price: null }] }]],
  [/v3\/Rail\/TRA\/ODFare\/1000\/to\/7000/, { ODFares: [
    { TrainType: 3, TrainTypeName: Z('自強'), Fares: [{ TicketType: 1, FareClass: 1, Price: 440 }, { TicketType: 1, FareClass: 3, Price: 220 }] },
    { TrainType: 6, Fares: [{ TicketType: 1, FareClass: 1, Price: 283 }] }] }],
  [/v3\/Rail\/TRA\/Station/, { Stations: [{ StationID: '1000', StationName: Z('臺北') }, { StationID: '7000', StationName: Z('花蓮') }] }],
  [/TRA\/DailyTrainTimetable\/OD\/1000\/to\/7000/, { TrainTimetables: [{
    TrainInfo: { TrainNo: '408', TrainTypeName: Z('自強(普悠瑪)'), EndingStationName: Z('臺東') },
    StopTimes: [{ StationID: '1000', DepartureTime: '23:30', ArrivalTime: '23:28' }, { StationID: '7000', ArrivalTime: '01:40', DepartureTime: '01:42' }] }] }],
];

const calls = [];
const fakeFetch = async (url, opts) => {
  calls.push(String(url));
  if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
  assert.equal(opts.headers.authorization, 'Bearer T');
  const hit = fixtures.find(([re]) => re.test(decodeURIComponent(url)));
  if (!hit) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify(hit[1]));
};
const svc = createTransitServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch }));

test('routeEta 合併站序與到站時間', async () => {
  const r = await svc.bus.routeEta({ city: '台北市', routeName: '307' });
  assert.equal(r.directions.length, 2);
  assert.equal(r.directions[0].label, '往 板橋前站');
  assert.equal(r.directions[1].label, '往 撫遠街');
  const [a, b, c] = r.directions[0].stops;
  assert.deepEqual([a.statusText, a.plate], ['進站中', 'KKA-1234']);
  assert.deepEqual([b.statusText, b.plate], ['10 分', null]);
  assert.equal(c.statusText, '尚未發車');
  assert.ok(calls.some((u) => decodeURIComponent(u).includes("RouteName/Zh_tw eq '307'")));
});

test('routeEta 站點帶座標（StopPosition），缺座標的站不帶 lat/lon', async () => {
  const r = await svc.bus.routeEta({ city: 'Taipei', routeName: '307' });
  const [a, b, c] = r.directions[0].stops;
  assert.deepEqual([a.lat, a.lon], [25.0712, 121.5627]);
  assert.deepEqual([b.lat, b.lon], [25.0462, 121.5173]);
  assert.equal('lat' in c, false);
});

test('routeEta shape 取去程 WKT 並攤平成 [lat, lon]', async () => {
  const r = await svc.bus.routeEta({ city: 'Taipei', routeName: '307' });
  assert.deepEqual(r.shape, [[25.0712, 121.5627], [25.06, 121.54], [25.0462, 121.5173], [25.014, 121.46]]);
});

test('routeEta 形狀端點失敗或格式不明時省略 shape，到站資料照常', async () => {
  // 自己回 token，不經 fakeFetch，避免影響「token 只取一次」的計數
  const wrap = (shapeRes) => async (url, opts) => {
    const u = decodeURIComponent(url);
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    return /Bus\/Shape/.test(u) ? shapeRes() : fakeFetch(url, opts);
  };
  const noShape = wrap(() => new Response('boom', { status: 500 }));
  const badShape = wrap(() => new Response(JSON.stringify([{ Direction: 0, Geometry: 'POINT(121.5 25)' }])));
  for (const f of [noShape, badShape]) {
    const s2 = createTransitServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: f }));
    const r = await s2.bus.routeEta({ city: 'Taipei', routeName: '307' });
    assert.equal(r.shape, undefined);
    assert.equal(r.directions[0].stops.length, 3);
  }
});

test('token 只取一次（快取）', () => {
  assert.equal(calls.filter((u) => u.includes('/token')).length, 1);
});

test('nearbyStations 由 UID 推縣市、路線去重、依距離排序', async () => {
  const s = await svc.bus.nearbyStations({ lat: 25.0478, lon: 121.517 });
  assert.equal(s[0].city, 'Taipei');
  assert.equal(s[1].city, 'NewTaipei');
  assert.deepEqual(s[0].routes, ['307', '262']);
  assert.ok(s[0].distance < s[1].distance);
});

test('stationEta 依到站時間排序，無時間者在後', async () => {
  const r = await svc.bus.stationEta({ city: 'TPE', stationId: '55' });
  assert.deepEqual(r.map((x) => x.routeName), ['0東', '307', '262']);
  assert.equal(r[2].statusText, '末班車已過');
});

test('bike.nearby 合併站點與即時車數', async () => {
  const [b] = await svc.bike.nearby({ lat: 25.0478, lon: 121.517 });
  assert.equal(b.name, '捷運台北車站M8');
  assert.deepEqual([b.rent, b.general, b.electric, b.returnSlots, b.type], [12, 9, 3, 28, 'YouBike 2.0']);
});

test('高鐵時刻：中文站名解析、依出發時間排序', async () => {
  const r = await svc.rail.thsrTimetable({ from: '臺北', to: '左營', date: '2026-11-18' });
  assert.deepEqual(r.trains.map((t) => t.trainNo), ['0603', '0803']);
  assert.equal(r.trains[1].minutes, 105);
});

test('台鐵時刻：v3 格式、跨日行車時間、車種去括號', async () => {
  const r = await svc.rail.traTimetable({ from: '台北', to: '花蓮', date: '2026-11-18' });
  assert.deepEqual(r.trains[0], { trainNo: '408', type: '自強', depart: '23:30', arrive: '01:40', minutes: 130, terminal: '臺東' });
});

test('高鐵票價：代碼轉中文、成人單程在前、無效價格略過、未知代碼保留', async () => {
  const r = await svc.rail.thsrFare({ from: '台北', to: '左營' });
  assert.deepEqual([r.system, r.from, r.to], ['THSR', '台北', '左營']);
  assert.deepEqual(r.fares.map((f) => [f.cabin, f.fareClass, f.ticketType, f.price, f.adultOneWay]), [
    ['標準車廂', '成人', '單程票', 1490, true],
    ['商務車廂', '成人', '單程票', 2390, true],
    ['標準車廂', '孩童', '單程票', 745, false],
    ['標準車廂', '成人', '代碼 9', 1000, false],
  ]);
  assert.ok(calls.some((u) => u.includes('/THSR/ODFare/1000/to/1070')));
});

test('台鐵票價：v3 各車種展開；沒有車種名稱時顯示代碼', async () => {
  const r = await svc.rail.traFare({ from: '台北', to: '花蓮' });
  assert.deepEqual(r.fares.map((f) => [f.trainType, f.fareClass, f.price]), [
    ['車種代碼 6', '成人', 283], ['自強', '成人', 440], ['自強', '孩童', 220],
  ]);
  await assert.rejects(svc.rail.traFare({ from: '台北', to: '臺北' }), /起訖站不可相同/);
});

test('錯誤處理：未知縣市 / 車站 / 座標', async () => {
  await assert.rejects(svc.bus.routeEta({ city: '火星', routeName: '1' }), /無法辨識縣市/);
  await assert.rejects(svc.rail.thsrTimetable({ from: '花蓮', to: '左營' }), /找不到高鐵車站/);
  await assert.rejects(svc.bike.nearby({ lat: 0, lon: 0 }), /台灣範圍/);
});
