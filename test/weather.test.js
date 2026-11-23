// 天氣（M3-08）：氣象署形狀 fixture、降雨判斷、預報解析、授權碼不外洩、示範情境、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeatherServices, parseStations, parseRainGauges, nearestGauge, parsePop3h, parseTomorrow, isRaining, townForecastId, TOWN_FORECAST } from '../core/services/weather.js';
import { createCwaClient, CwaError } from '../core/cwa-client.js';
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
    if (/\/F-D0047-0\d\d\?/.test(u)) return forecast ? new Response(JSON.stringify(forecast)) : new Response('x', { status: 500 });
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

test('parsePop3h：同名鄉鎮以縣市區分（臺北市與基隆市都有中正區）', () => {
  const two = { records: { Locations: [
    { LocationsName: '基隆市', Location: [{ LocationName: '中正區', WeatherElement: [{ ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '90' }] }] }] }] },
    { LocationsName: '臺北市', Location: [{ LocationName: '中正區', WeatherElement: [{ ElementName: '3小時降雨機率', Time: [{ ElementValue: [{ ProbabilityOfPrecipitation: '20' }] }] }] }] },
  ] } };
  assert.equal(parsePop3h(two, '中正區', Date.now(), '台北市'), 20);
  assert.equal(parsePop3h(two, '中正區', Date.now(), '基隆市'), 90);
  assert.equal(parsePop3h(two, '中正區', Date.now(), '新竹市'), null);
});

test('cwa-client：授權碼無效、連線失敗都不把授權碼帶進錯誤', async () => {
  const bad = createCwaClient({ apiKey: 'SECRET-KEY', fetchImpl: async () => new Response('no', { status: 401 }) });
  await assert.rejects(bad.get('O-A0001-001'), (e) => e instanceof CwaError && /授權碼無效/.test(e.message));
  const down = createCwaClient({ apiKey: 'SECRET-KEY', fetchImpl: async (url) => { throw new TypeError('fetch failed', { cause: new Error(`connect to ${url}`) }); } });
  await assert.rejects(down.get('O-A0001-001'), (e) => {
    assert.ok(e instanceof CwaError);
    assert.ok(!JSON.stringify({ m: e.message, s: e.stack, c: String(e.cause ?? '') }).includes('SECRET'));
    return true;
  });
});

test('now：取最近且有資料的測站、合併預報、授權碼只在請求網址', async () => {
  const { weather, urls } = svcWith();
  const r = await weather.now({ lat: 25.0478, lon: 121.517 });
  assert.deepEqual([r.station, r.town, r.tempC, r.rainMm1h, r.rainStation, r.pop3h, r.raining], ['臺北', '中正區', 18.4, 1.5, '臺北雨量', 90, true]);
  assert.equal(r.summary, '陰，18.4°C，3 小時降雨機率 90%');
  // 臺北市的鄉鎮預報是 F-D0047-061（089 是全臺各縣市層級，用鄉鎮名稱篩一律空的）
  assert.ok(urls.some((u) => u.includes('/F-D0047-061?') && u.includes(encodeURIComponent('中正區'))));
  assert.ok(!urls.some((u) => u.includes('F-D0047-089')));
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

test('parseTomorrow：明天（台灣時間）的降雨機率取最高、溫度取最低與最高、天氣現象；同名鄉鎮看縣市；沒有明天的資料回 null', async () => {
  const { parseTomorrow } = await import('../core/services/weather.js');
  const now = Date.parse('2026-11-21T02:00:00Z'); // 台灣 11/21 10:00 → 明天 11/22
  const el = (name, times) => ({ ElementName: name, Time: times });
  const t = (start, v) => ({ StartTime: start, EndTime: start, ElementValue: [v] });
  const loc = (county, town, pops) => ({ LocationsName: county, Location: [{ LocationName: town, WeatherElement: [
    el('3小時降雨機率', pops.map(([s, p]) => t(s, { ProbabilityOfPrecipitation: String(p) }))),
    el('溫度', [t('2026-11-22T06:00:00+08:00', { Temperature: '18' }), t('2026-11-22T15:00:00+08:00', { Temperature: '26' }), t('2026-11-21T15:00:00+08:00', { Temperature: '30' })]),
    el('天氣現象', [t('2026-11-22T06:00:00+08:00', { Weather: '多雲短暫雨' })]),
  ] }] });
  const json = { records: { Locations: [
    loc('臺北市', '中正區', [['2026-11-21T21:00:00+08:00', 90], ['2026-11-22T00:00:00+08:00', 20], ['2026-11-22T12:00:00+08:00', 60]]),
    loc('基隆市', '中正區', [['2026-11-22T12:00:00+08:00', 10]]),
  ] } };
  assert.deepEqual(parseTomorrow(json, '中正區', now, '臺北市'), { date: '2026-11-22', pop: 60, dayPop: 60, minT: 18, maxT: 26, wx: '多雲短暫雨' });
  assert.equal(parseTomorrow(json, '中正區', now, '基隆市').pop, 10, '同名鄉鎮看縣市');
  assert.equal(parseTomorrow(json, '大安區', now, '臺北市'), null);
  assert.equal(parseTomorrow({ records: {} }, '中正區', now), null);
});

test('weather_tomorrow（示範）：說明天日期、溫度範圍、降雨機率；雨天提醒帶傘', async () => {
  const { createServices } = await import('../core/index.js');
  const { callTool } = await import('../core/tools/index.js');
  const r = await callTool(createServices({ forceMock: true, demo: { weather: 'rain' } }), 'weather_tomorrow', { lat: 25.0478, lon: 121.517 });
  assert.match(r.speak, /^明天 \d{1,2}\/\d{1,2}（[日一二三四五六]） 那一帶.+\d+～\d+°C，降雨機率 70%，記得帶傘。$/);
});

test('parseTomorrow：沒有時區的時間一律當台灣時間（主機是 UTC 也一樣）；小寫欄位、DataTime；白天降雨機率 dayPop（半夜的雨不提醒帶傘）', async () => {
  const { parseTomorrow, twParse } = await import('../core/services/weather.js');
  assert.equal(twParse('2026-11-21 21:00:00'), Date.parse('2026-11-21T21:00:00+08:00'));
  assert.equal(twParse('2026-11-21T13:00:00Z'), Date.parse('2026-11-21T13:00:00Z'));
  const now = Date.parse('2026-11-21T02:00:00Z');
  const json = { records: { locations: [{ locationsName: '臺北市', location: [{ locationName: '大安區', weatherElement: [
    { elementName: '3小時降雨機率', time: [
      { startTime: '2026-11-21 21:00:00', elementValue: [{ value: '90' }] }, // 今晚（不是明天）
      { startTime: '2026-11-22 03:00:00', elementValue: [{ value: '80' }] }, // 明天半夜
      { startTime: '2026-11-22 12:00:00', elementValue: [{ value: '20' }] },
    ] },
    { elementName: '溫度', time: [{ dataTime: '2026-11-22 09:00:00', elementValue: [{ value: '21' }] }] },
  ] }] }] } };
  const d = parseTomorrow(json, '大安區', now, '臺北市');
  assert.deepEqual([d.pop, d.dayPop, d.minT, d.maxT], [80, 20, 21, 21]);
  const { weatherTomorrow } = await import('../core/tools/weather.js');
  assert.match(weatherTomorrow.speak({ ...d, county: '臺北市', town: '大安區' }), /^明天 11\/22（日） 臺北市大安區，21～21°C，降雨機率 80%。$/, '白天 20%：不提醒帶傘');
});

// ── 2026-11-22 真實資料修正：鄉鎮預報要用各縣市的資料集（F-D0047-089 是縣市層級） ──
const REAL_065 = JSON.parse(readFileSync(new URL('./fixtures/cwa-F-D0047-065-sanmin.json', import.meta.url), 'utf8'));

test('townForecastId：22 縣市對到各自的 3 天鄉鎮預報資料集，臺／台視為相同；不認得回 null', () => {
  assert.equal(Object.keys(TOWN_FORECAST).length, 22);
  assert.deepEqual(['臺北市', '台北市', '高雄市', '新北市', '臺中市', '金門縣', '連江縣'].map(townForecastId),
    ['F-D0047-061', 'F-D0047-061', 'F-D0047-065', 'F-D0047-069', 'F-D0047-073', 'F-D0047-085', 'F-D0047-081']);
  assert.equal(new Set(Object.values(TOWN_FORECAST)).size, 22);
  assert.ok(!Object.values(TOWN_FORECAST).includes('F-D0047-089'));
  assert.deepEqual([townForecastId(''), townForecastId(null), townForecastId('火星市')], [null, null, null]);
});

test('真實樣本（F-D0047-065 高雄市三民區）：現在的 3 小時降雨機率、明天的摘要', () => {
  assert.equal(parsePop3h(REAL_065, '三民區', Date.parse('2026-11-22T13:00:00+08:00'), '高雄市'), 10);
  assert.equal(parsePop3h(REAL_065, '三民區', Date.parse('2026-11-22T16:00:00+08:00'), '高雄市'), 20);
  assert.deepEqual(parseTomorrow(REAL_065, '三民區', Date.parse('2026-11-22T13:00:00+08:00'), '高雄市'),
    { date: '2026-11-23', pop: 20, dayPop: 10, minT: 21, maxT: 28, wx: '多雲' });
});

test('tomorrow／now 打測站所在縣市的資料集；縣市不認得時明天回 502、現在的 pop3h 為 null', async () => {
  const STN = (county) => ({ success: 'true', records: { Station: [{ StationName: '三民', GeoInfo: { ...W(22.6467, 120.3089), CountyName: county, TownName: '三民區' }, ObsTime: { DateTime: '2026-11-22T14:00:00+08:00' }, WeatherElement: { Weather: '多雲', AirTemperature: 25.8 } }] } });
  const mk = (county) => {
    const urls = [];
    const fetchImpl = async (url) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/O-A0001-001')) return new Response(JSON.stringify(STN(county)));
      if (u.includes('/F-D0047-065?')) return new Response(JSON.stringify(REAL_065));
      if (u.includes('/F-D0047-')) return new Response(JSON.stringify({ success: 'true', records: { Locations: [{ LocationsName: '台灣', Location: [] }] } }));
      return new Response('x', { status: 500 });
    };
    return { urls, weather: createWeatherServices(createCwaClient({ apiKey: 'SECRET-KEY', fetchImpl })).weather };
  };
  const ok = mk('高雄市');
  const t = await ok.weather.tomorrow({ lat: 22.639, lon: 120.302 }, Date.parse('2026-11-22T13:00:00+08:00'));
  assert.deepEqual([t.town, t.county, t.date, t.pop, t.minT, t.maxT, t.wx], ['三民區', '高雄市', '2026-11-23', 20, 21, 28, '多雲']);
  await ok.weather.now({ lat: 22.639, lon: 120.302 }); // pop3h 的值看執行當下的時間（上一個測試已用固定時間驗證）
  assert.equal(ok.urls.filter((u) => u.includes('/F-D0047-065?')).length, 1, 'tomorrow 與 now 共用一份預報快取');
  const bad = mk('');
  await assert.rejects(bad.weather.tomorrow({ lat: 22.639, lon: 120.302 }), (e) => e instanceof CwaError && e.status === 502);
  assert.equal((await bad.weather.now({ lat: 22.639, lon: 120.302 })).pop3h, null);
  assert.ok(!bad.urls.some((u) => u.includes('/F-D0047-')), '不認得縣市就不打預報');
});

test('現在天氣：最近的測站沒有氣溫（只有天氣描述）時，用 15 公里內最近、有氣溫的站；描述借 10 公里內的站（產品負責人：手機首頁的天氣沒有溫度）', async () => {
  const { pickNowStation, TEMP_STATION_M } = await import('../core/services/weather.js');
  const at = { lat: 23.1, lon: 120.3 };
  const s = (name, dLat, tempC, weather) => ({ name, town: `${name}區`, county: '臺南市', lat: at.lat + dLat, lon: at.lon, tempC, weather });
  const descOnly = s('善化', 0.013, null, '陰'); // 約 1.4 公里
  const tempOnly = s('自動站', 0.03, 24.2, null); // 約 3.3 公里
  const far = s('遠站', 0.2, 22, '晴'); // 約 22 公里
  assert.deepEqual(pick(pickNowStation([descOnly, tempOnly, far], at.lat, at.lon)), ['自動站', 24.2, '陰'], '溫度用有氣溫的站、描述借最近的');
  assert.deepEqual(pick(pickNowStation([descOnly, far], at.lat, at.lon)), ['善化', null, '陰'], '15 公里內沒有氣溫的站：仍用最近的（溫度不知道）');
  assert.ok(TEMP_STATION_M === 15_000);
  const both = s('局屬站', 0.05, 25, '晴');
  assert.deepEqual(pick(pickNowStation([both, tempOnly], at.lat, at.lon)), ['自動站', 24.2, '晴'], '描述借 10 公里內最近有描述的站');
  function pick(x) { return [x.name, x.tempC, x.weather]; }
});

test('附近 15 公里內都沒有測站回報氣溫：摘要、英文、首頁小卡都照實說（產品負責人：沒有臨近的要明確說明）', async () => {
  const { buildWeather, NO_TEMP_ZH } = await import('../core/services/weather.js');
  const { SPEAK_EN } = await import('../core/tools/speak-en.js');
  const { nowItems } = await import('../public/js/home-now.js');
  const w = buildWeather({ name: '善化', town: '善化區', county: '臺南市', lat: 23.13, lon: 120.3, tempC: null, weather: '陰' }, null, 10, 23.12, 120.3);
  assert.equal(w.summary, `陰，${NO_TEMP_ZH}，3 小時降雨機率 10%`);
  assert.match(SPEAK_EN.weather_now(w), /No weather station within 15 km reported the temperature/);
  const [card] = nowItems({ weather: w });
  assert.deepEqual([card.main, card.sub.split('・')[0]], ['天氣', '附近沒有氣溫資料']);
  const ok = nowItems({ weather: { ...w, tempC: 23.4 } })[0];
  assert.equal(ok.main, '23°C');
  assert.ok(!ok.sub.includes('氣溫資料'));
});
