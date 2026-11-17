// 以 TDX 回應格式的假資料驗證「真實版」正規化邏輯（不需網路與金鑰）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransitServices } from '../core/services/transit.js';
import { createTdxClient } from '../core/tdx-client.js';

const Z = (s) => ({ Zh_tw: s, En: '' });
const fixtures = [
  [/Bus\/DisplayStopOfRoute/, [
    { RouteName: Z('307'), Direction: 0, Stops: [
      { StopUID: 'TPE1', StopName: Z('撫遠街'), StopSequence: 1 },
      { StopUID: 'TPE2', StopName: Z('臺北車站'), StopSequence: 2 },
      { StopUID: 'TPE3', StopName: Z('板橋前站'), StopSequence: 3 }] },
    { RouteName: Z('307'), Direction: 1, Stops: [{ StopUID: 'TPE9', StopName: Z('板橋前站'), StopSequence: 1 }] },
  ]],
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
  [/Bike\/Availability\/NearBy/, [{ StationUID: 'TPE500101', ServiceStatus: 1, AvailableRentBikes: 12, AvailableReturnBikes: 28, AvailableRentBikesDetail: { GeneralBikes: 9, ElectricBikes: 3 }, UpdateTime: '2026-11-17T21:00:00+08:00' }]],
  [/THSR\/Station/, [{ StationID: '1000', StationName: Z('台北') }, { StationID: '1070', StationName: Z('左營') }]],
  [/THSR\/DailyTimetable\/OD\/1000\/to\/1070\/2026-11-18/, [
    { DailyTrainInfo: { TrainNo: '0803' }, OriginStopTime: { DepartureTime: '08:00' }, DestinationStopTime: { ArrivalTime: '09:45' } },
    { DailyTrainInfo: { TrainNo: '0603' }, OriginStopTime: { DepartureTime: '06:30' }, DestinationStopTime: { ArrivalTime: '08:00' } }]],
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

test('錯誤處理：未知縣市 / 車站 / 座標', async () => {
  await assert.rejects(svc.bus.routeEta({ city: '火星', routeName: '1' }), /無法辨識縣市/);
  await assert.rejects(svc.rail.thsrTimetable({ from: '花蓮', to: '左營' }), /找不到高鐵車站/);
  await assert.rejects(svc.bike.nearby({ lat: 0, lon: 0 }), /台灣範圍/);
});
