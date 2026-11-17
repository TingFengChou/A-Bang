// 天氣（M3-08）：氣象署形狀 fixture、降雨判斷、預報解析、授權碼不外洩、示範情境、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherServices, parseStations, parsePop3h, isRaining } from '../core/services/weather.js';
import { createCwaClient } from '../core/cwa-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const W = (lat, lon) => ({ Coordinates: [{ CoordinateName: 'TWD67', StationLatitude: 0, StationLongitude: 0 }, { CoordinateName: 'WGS84', StationLatitude: lat, StationLongitude: lon }] });
const AUTO = { success: 'true', records: { Station: [
  { StationName: '遠方', GeoInfo: { ...W(24.1, 120.6), CountyName: '臺中市', TownName: '西區' }, ObsTime: { DateTime: '2026-11-17T21:00:00+08:00' }, WeatherElement: { AirTemperature: 22, Now: { Precipitation: 0 } } },
  { StationName: '壞資料', GeoInfo: { ...W(25.047, 121.517), TownName: '中正區' }, WeatherElement: { AirTemperature: -99, Now: { Precipitation: -99 } } },
] } };
const MANNED = { success: 'true', records: { Station: [
  { StationName: '臺北', GeoInfo: { ...W(25.0377, 121.5149), CountyName: '臺北市', TownName: '中正區' }, ObsTime: { DateTime: '2026-11-17T21:00:00+08:00' }, WeatherElement: { Weather: '陰', AirTemperature: 18.4, Now: { Precipitation: 1.5 } } },
] } };
const FORECAST = { success: 'true', records: { Locations: [{ Location: [
  { LocationName: '大安區', WeatherElement: [{ ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '20' }] }] }] },
  { LocationName: '中正區', WeatherElement: [{ ElementName: '溫度', Time: [] }, { ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '90' }] }] }] },
] }] } };

function svcWith({ forecast = FORECAST, manned = MANNED } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/O-A0001-001')) return new Response(JSON.stringify(AUTO));
    if (u.includes('/O-A0003-001')) return manned ? new Response(JSON.stringify(manned)) : new Response('x', { status: 500 });
    if (u.includes('/F-D0047-089')) return forecast ? new Response(JSON.stringify(forecast)) : new Response('x', { status: 500 });
    return new Response('nf', { status: 404 });
  };
  return { urls, weather: createWeatherServices(createCwaClient({ apiKey: 'SECRET-KEY', fetchImpl })).weather };
}

test('isRaining：有雨量或 3 小時降雨機率 ≥ 70', () => {
  assert.deepEqual([isRaining(0.5, 0), isRaining(0, 70), isRaining(0, 69), isRaining(null, null)], [true, true, false, false]);
});

test('parseStations 取 WGS84、-99 視為沒有資料', () => {
  const s = parseStations(AUTO);
  assert.deepEqual([s[0].lat, s[0].lon], [24.1, 120.6]);
  assert.deepEqual([s[1].tempC, s[1].rainMm1h], [null, null]);
});

test('parsePop3h 依鄉鎮名稱找 3 小時降雨機率；找不到回 null', () => {
  assert.equal(parsePop3h(FORECAST, '中正區'), 90);
  assert.equal(parsePop3h(FORECAST, '信義區'), null);
  assert.equal(parsePop3h(null, '中正區'), null);
});

test('now：取最近且有資料的測站、合併預報、授權碼只在請求網址', async () => {
  const { weather, urls } = svcWith();
  const r = await weather.now({ lat: 25.0478, lon: 121.517 });
  assert.deepEqual([r.station, r.town, r.tempC, r.rainMm1h, r.pop3h, r.raining], ['臺北', '中正區', 18.4, 1.5, 90, true]);
  assert.equal(r.summary, '陰，18.4°C，3 小時降雨機率 90%');
  assert.ok(urls.some((u) => u.includes('F-D0047-089') && u.includes(encodeURIComponent('中正區'))));
  assert.ok(urls.every((u) => u.includes('Authorization=SECRET-KEY')));
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

test('now：預報與局屬站失敗仍回觀測；座標錯誤', async () => {
  const { weather } = svcWith({ forecast: null, manned: null });
  const r = await weather.now({ lat: 24.15, lon: 120.65 });
  assert.deepEqual([r.station, r.pop3h, r.raining], ['遠方', null, false]);
  await assert.rejects(weather.now({ lat: 0, lon: 0 }), /台灣範圍/);
});

test('示範情境與 weather_now tool：mode 看氣象授權碼、來源與提示正確', async () => {
  const clear = await callTool(createServices({ forceMock: true }), 'weather_now', { lat: 25.0478, lon: 121.517 });
  assert.deepEqual([clear.mode, clear.data.raining], ['demo', false]);
  assert.match(clear.speak, /現在沒下雨，\d+°C，接下來 3 小時降雨機率 10%/);
  const rain = await callTool(createServices({ forceMock: true, demo: { weather: 'rain' } }), 'weather_now', { lat: 25.0478, lon: 121.517 });
  assert.equal(rain.data.raining, true);
  assert.match(rain.speak, /現在下雨，接下來 3 小時降雨機率 80%/);
  // 有 TDX 金鑰但沒有氣象授權碼：交通 live、天氣仍是 demo
  const mixed = createServices({ clientId: 'a', clientSecret: 'b' });
  assert.deepEqual([mixed.mode, mixed.weatherMode], ['live', 'demo']);
});
