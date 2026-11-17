// 天氣（M3-08）：氣象署形狀 fixture、降雨判斷、預報解析、授權碼不外洩、示範情境、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherServices, parseStations, parseRainGauges, nearestGauge, parsePop3h, isRaining } from '../core/services/weather.js';
import { createCwaClient } from '../core/cwa-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const W = (lat, lon) => ({ Coordinates: [{ CoordinateName: 'TWD67', StationLatitude: 0, StationLongitude: 0 }, { CoordinateName: 'WGS84', StationLatitude: lat, StationLongitude: lon }] });
const AUTO = { success: 'true', records: { Station: [
  { StationName: '遠方', GeoInfo: { ...W(24.1, 120.6), CountyName: '臺中市', TownName: '西區' }, ObsTime: { DateTime: '2026-11-17T21:00:00+08:00' }, WeatherElement: { AirTemperature: 22, Now: { Precipitation: 35 } } },
  { StationName: '壞資料', GeoInfo: { ...W(25.047, 121.517), TownName: '中正區' }, WeatherElement: { AirTemperature: -99, Now: { Precipitation: -99 } } },
] } };
const MANNED = { success: 'true', records: { Station: [
  { StationName: '臺北', GeoInfo: { ...W(25.0377, 121.5149), CountyName: '臺北市', TownName: '中正區' }, ObsTime: { DateTime: '2026-11-17T21:00:00+08:00' }, WeatherElement: { Weather: '陰', AirTemperature: 18.4, Now: { Precipitation: 1.5 } } },
] } };
const RAIN = { success: 'true', records: { Station: [
  { StationName: '公館', GeoInfo: W(25.0145, 121.5345), RainfallElement: { Past1hr: { Precipitation: 0 }, Now: { Precipitation: 40 } } },
  { StationName: '臺北雨量', GeoInfo: W(25.038, 121.515), RainfallElement: { Past1hr: { Precipitation: 1.5 }, Now: { Precipitation: 12 } } },
  { StationName: '壞雨量', GeoInfo: W(25.0478, 121.517), RainfallElement: { Past1hr: { Precipitation: -998 } } },
] } };
const FORECAST = { success: 'true', records: { Locations: [{ Location: [
  { LocationName: '大安區', WeatherElement: [{ ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '20' }] }] }] },
  { LocationName: '中正區', WeatherElement: [{ ElementName: '溫度', Time: [] }, { ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '90' }] }] }] },
] }] } };

function svcWith({ forecast = FORECAST, manned = MANNED, rain = RAIN } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/O-A0001-001')) return new Response(JSON.stringify(AUTO));
    if (u.includes('/O-A0003-001')) return manned ? new Response(JSON.stringify(manned)) : new Response('x', { status: 500 });
    if (u.includes('/O-A0002-001')) return rain ? new Response(JSON.stringify(rain)) : new Response('x', { status: 500 });
    if (u.includes('/F-D0047-089')) return forecast ? new Response(JSON.stringify(forecast)) : new Response('x', { status: 500 });
    return new Response('nf', { status: 404 });
  };
  return { urls, weather: createWeatherServices(createCwaClient({ apiKey: 'SECRET-KEY', fetchImpl })).weather };
}

test('isRaining：有雨量或 3 小時降雨機率 ≥ 70', () => {
  assert.deepEqual([isRaining(0.5, 0), isRaining(0, 70), isRaining(0, 69), isRaining(null, null)], [true, true, false, false]);
});

test('parseStations 取 WGS84、-99 視為沒有資料、不帶當日累積雨量', () => {
  const s = parseStations(AUTO);
  assert.deepEqual([s[0].lat, s[0].lon], [24.1, 120.6]);
  assert.equal(s[1].tempC, null);
  assert.ok(!('rainMm1h' in s[0]));
});

test('parseRainGauges 取 Past1hr（不是當日累積 Now）、異常值濾掉；nearestGauge 只取 5 公里內', () => {
  const g = parseRainGauges(RAIN);
  assert.deepEqual(g.map((x) => [x.name, x.rainMm1h]), [['公館', 0], ['臺北雨量', 1.5]]);
  assert.equal(nearestGauge(g, 25.0478, 121.517).name, '臺北雨量');
  assert.equal(nearestGauge(g, 24.15, 120.65), null);
  assert.deepEqual(parseRainGauges(null), []);
});

test('parsePop3h 依鄉鎮名稱找 3 小時降雨機率；找不到回 null', () => {
  assert.equal(parsePop3h(FORECAST, '中正區'), 90);
  assert.equal(parsePop3h(FORECAST, '信義區'), null);
  assert.equal(parsePop3h(null, '中正區'), null);
  // 第一個時段已結束（快取造成）→ 取下一個還沒結束的；全部結束 → null
  const slots = { records: { Locations: [{ Location: [{ LocationName: '中正區', WeatherElement: [{ ElementName: '3小時降雨機率', Time: [
    { StartTime: '2026-11-17T18:00:00+08:00', EndTime: '2026-11-17T21:00:00+08:00', ElementValue: [{ ProbabilityOfPrecipitation: '10' }] },
    { StartTime: '2026-11-17T21:00:00+08:00', EndTime: '2026-11-18T00:00:00+08:00', ElementValue: [{ ProbabilityOfPrecipitation: '80' }] },
  ] }] }] }] } };
  assert.equal(parsePop3h(slots, '中正區', Date.parse('2026-11-17T20:00:00+08:00')), 10);
  assert.equal(parsePop3h(slots, '中正區', Date.parse('2026-11-17T22:30:00+08:00')), 80);
  assert.equal(parsePop3h(slots, '中正區', Date.parse('2026-11-18T01:00:00+08:00')), null);
});

test('now：取最近且有資料的測站、合併預報、授權碼只在請求網址', async () => {
  const { weather, urls } = svcWith();
  const r = await weather.now({ lat: 25.0478, lon: 121.517 });
  assert.deepEqual([r.station, r.town, r.tempC, r.rainMm1h, r.rainStation, r.pop3h, r.raining], ['臺北', '中正區', 18.4, 1.5, '臺北雨量', 90, true]);
  assert.equal(r.summary, '陰，18.4°C，3 小時降雨機率 90%');
  assert.ok(urls.some((u) => u.includes('F-D0047-089') && u.includes(encodeURIComponent('中正區'))));
  assert.ok(urls.every((u) => u.includes('Authorization=SECRET-KEY')));
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

test('now：預報、局屬站、雨量站失敗仍回觀測；當日累積雨量不算下雨；座標錯誤', async () => {
  const { weather } = svcWith({ forecast: null, manned: null, rain: null });
  const r = await weather.now({ lat: 24.15, lon: 120.65 });
  assert.deepEqual([r.station, r.rainMm1h, r.rainStation, r.pop3h, r.raining], ['遠方', null, null, null, false]);
  // 附近沒有雨量站：氣象站當日累積 35 mm 也不能算「現在下雨」
  const far = await svcWith({ forecast: null }).weather.now({ lat: 24.15, lon: 120.65 });
  assert.deepEqual([far.rainMm1h, far.raining], [null, false]);
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
