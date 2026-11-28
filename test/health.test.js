// 健康與運動（ADR-0018）：core/health-nudge.js 的門檻、時段比例、天氣好、散步地點、文案、一天一次；
// public/js/health.js 的預設關閉、示範資料、權限被拒、外掛回報整理；健康資料不送伺服器（靜態檢查＋agent 請求內容）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVE, GOOD, WALK, twDate, twMinutes, dayProgress, normalizeHealth, movement, weatherGood, walkSpots, pickWalkSpot, nudgeFor, dayRecord, homeAllowed, agentAllowed, EXERCISE_Q, progressSay } from '../core/health-nudge.js';
import { apparentTemp, parseStations, buildWeather } from '../core/services/weather.js';
import landmarks from '../core/data/landmarks.json' with { type: 'json' };

/** 台灣時間 2026-11-22 hh:mm */
const at = (hhmm, date = '2026-11-22') => Date.parse(`${date}T${hhmm}:00+08:00`);
const TODAY = '2026-11-22';
const days = (today, past = []) => ({ source: 'health-connect', days: [...past.map(([date, steps, exerciseMin]) => ({ date, steps, exerciseMin })), { date: TODAY, ...today }] });
const NICE = { weather: { raining: false, rainMm1h: 0, pop3h: 10, tempC: 24, feelsC: 25 }, air: { aqi: 35, status: '良好' } };
const DAAN = { lat: 25.03, lon: 121.5357 };
const SPOTS = walkSpots(landmarks);

test('台灣時間：日期與一天中的分鐘；清醒時段比例（07:00～22:00）', () => {
  assert.equal(twDate(at('00:30')), TODAY);
  assert.equal(twDate(at('23:59')), TODAY);
  assert.equal(twMinutes(at('14:30')), 14 * 60 + 30);
  assert.equal(dayProgress(at('06:00')), 0);
  assert.equal(dayProgress(at('14:30')), 0.5);
  assert.equal(dayProgress(at('23:00')), 1);
});

test('動得少：步數低於「到現在應有步數」的 60%（目標 6,000 按時段比例）', () => {
  const now = at('14:30'); // 應有 3,000 步，60% 是 1,800
  const h = (steps) => normalizeHealth(days({ steps, exerciseMin: null }), now);
  assert.equal(movement(h(1799), now).expectedSteps, 3000);
  assert.equal(movement(h(1799), now).stepsLow, true);
  assert.equal(movement(h(1800), now).stepsLow, false, '剛好 60% 不算少');
  assert.equal(movement(h(1799), now).low, true);
  assert.equal(movement(h(2500), now).low, false);
  // 一大早（應有步數不到 600）不判斷步數
  const early = at('07:40'); // 應有 220 步
  assert.equal(movement(normalizeHealth(days({ steps: 0, exerciseMin: null }), early), early).stepsLow, false);
  assert.equal(MOVE.STEP_GOAL, 6000);
  assert.equal(MOVE.STEP_PACE, 0.6);
});

test('動得少：步數少「而且」近 7 天運動也未達 150 分的進度；沒有運動紀錄時只看步數', () => {
  const now = at('22:00'); // 今天整天：應有 6,000 步，60% 是 3,600
  const full = [['2026-11-16', 6000, 20], ['2026-11-17', 6000, 20], ['2026-11-18', 6000, 20], ['2026-11-19', 6000, 20], ['2026-11-20', 6000, 20], ['2026-11-21', 6000, 20]];
  const mv = movement(normalizeHealth(days({ steps: 3000, exerciseMin: 20 }, full), now), now);
  assert.equal(mv.weekMin, 140);
  assert.equal(mv.expectedWeekMin, 150);
  assert.equal(mv.exerciseLow, true);
  assert.equal(mv.low, true, '步數少、運動也不夠 → 動得少');
  assert.equal(movement(normalizeHealth(days({ steps: 5000, exerciseMin: 20 }, full), now), now).low, false, '運動不夠但步數不少：不推');
  const moved = [['2026-11-16', 3000, 60], ['2026-11-17', 3000, 60]];
  assert.equal(movement(normalizeHealth(days({ steps: 1000, exerciseMin: 0 }, moved), now), now).low, false, '步數少但運動有達進度：不推');
  // 近 7 天完全沒有運動紀錄（都沒有或都是 0）：只看步數
  const none = movement(normalizeHealth(days({ steps: 3000, exerciseMin: 0 }, [['2026-11-20', 3000, 0]]), now), now);
  assert.deepEqual([none.weekMin, none.low], [null, true]);
  // 只有今天的資料：進度只算今天那一份
  const one = movement(normalizeHealth(days({ steps: 3000, exerciseMin: 22 }), now), now);
  assert.equal(one.expectedWeekMin, Math.round(150 / 7));
  assert.equal(one.exerciseLow, false);
  assert.equal(one.low, false, '今天運動 22 分已達一天的進度');
  // 今天步數達標：就算運動分鐘不夠也算達標（不推）
  const met = movement(normalizeHealth(days({ steps: 6000, exerciseMin: 0 }, full), now), now);
  assert.deepEqual([met.met, met.low], [true, false]);
  // 近 7 天運動 150 分：達標
  const wk = movement(normalizeHealth(days({ steps: 1000, exerciseMin: 30 }, full), now), now);
  assert.deepEqual([wk.weekMin, wk.met, wk.low], [150, true, false]);
});

test('天氣好：沒下雨、降雨 < 30%、體感 15～31°C、AQI ≤ 100、06:00～19:30（邊界）', () => {
  const now = at('15:00');
  const w = (weather, air = NICE.air, t = now) => weatherGood({ weather: { ...NICE.weather, ...weather }, air }, t);
  assert.equal(w({}).ok, true);
  assert.deepEqual(w({ pop3h: 29 }).reasons, []);
  assert.deepEqual(w({ pop3h: 30 }).reasons, ['pop']);
  assert.deepEqual(w({ raining: true, pop3h: null }).reasons, ['no-weather', 'rain'], '不知道降雨機率又標下雨：當作在下雨');
  assert.deepEqual(w({ raining: true, rainMm1h: 0, pop3h: 80 }).reasons, ['pop'], '降雨機率高不是「現在在下雨」（生活資料審查 #2）');
  assert.deepEqual(w({ rainMm1h: 0.5 }).reasons, ['rain']);
  assert.deepEqual(w({ feelsC: 15 }).reasons, []);
  assert.deepEqual(w({ feelsC: 31 }).reasons, []);
  assert.deepEqual(w({ feelsC: 31.5 }).reasons, ['hot']);
  assert.deepEqual(w({ feelsC: 14.9 }).reasons, ['cold']);
  assert.deepEqual(w({ feelsC: null, tempC: 33 }).reasons, ['hot'], '沒有體感溫度用氣溫');
  assert.deepEqual(w({}, { aqi: 100 }).reasons, []);
  assert.deepEqual(w({}, { aqi: '101' }).reasons, ['air']);
  assert.deepEqual(w({}, null).reasons, ['no-air'], '沒查到空品就不推');
  assert.deepEqual(weatherGood({ weather: null, air: NICE.air }, now).reasons, ['no-weather']);
  assert.deepEqual(w({ pop3h: null }).reasons, ['no-weather']);
  assert.equal(w({}, NICE.air, at('06:00')).ok, true);
  assert.deepEqual(w({}, NICE.air, at('05:59')).reasons, ['dark']);
  assert.equal(w({}, NICE.air, at('19:30')).ok, true);
  assert.deepEqual(w({}, NICE.air, at('19:31')).reasons, ['dark']);
  assert.deepEqual([GOOD.POP_LT, GOOD.FEELS_MIN, GOOD.FEELS_MAX, GOOD.AQI_MAX], [30, 15, 31, 100]);
});

test('體感溫度：氣溫、濕度、風速（缺資料回 null）；氣象站解析濕度與風速', () => {
  assert.equal(apparentTemp(24, 65, 2), 25);
  assert.ok(apparentTemp(32, 80, 1) > 38, '濕熱時體感更高');
  assert.equal(apparentTemp(24, null, 2), null);
  assert.equal(apparentTemp(24, 120, 2), null);
  const [st] = parseStations({ records: { Station: [{ StationName: '大安森林', GeoInfo: { TownName: '大安區', CountyName: '臺北市', Coordinates: [{ CoordinateName: 'WGS84', StationLatitude: 25.03, StationLongitude: 121.53 }] }, WeatherElement: { AirTemperature: 24, RelativeHumidity: 65, WindSpeed: 2 } }] } });
  assert.deepEqual([st.humidity, st.windMs], [65, 2]);
  assert.equal(buildWeather(st, null, 10, 25.03, 121.53).feelsC, 25);
  assert.equal(buildWeather({ ...st, humidity: null }, null, 10, 25.03, 121.53).feelsC, null);
});

test('散步地點：內建地標庫的 walk 欄位；最近、走路 10～25 分的；太近太遠都不給', () => {
  assert.ok(SPOTS.length >= 20, `散步地點 ${SPOTS.length} 個`);
  for (const s of SPOTS) {
    assert.ok(['park', 'riverside', 'trail'].includes(s.walk), s.name);
    assert.ok(s.lat > 21 && s.lat < 27 && s.lon > 118 && s.lon < 123, s.name);
  }
  // 台北車站：走路 10～25 分內最近的是二二八和平紀念公園（約 10 分）
  const p = pickWalkSpot(SPOTS, { lat: 25.0478, lon: 121.517 });
  assert.ok(p.walkMin >= WALK.MIN && p.walkMin <= WALK.MAX, `${p.name} ${p.walkMin} 分`);
  assert.match(p.nav.google, /travelmode=walking/);
  assert.ok(!p.nav.google.includes('origin'), '導航只帶目的地');
  // 就在大安森林公園裡：公園太近（1 分）不算，其他都超過 25 分 → 沒有（只給一句建議）
  assert.equal(pickWalkSpot(SPOTS, DAAN), null);
  // 西門町：最近、10～25 分內的那一個
  const w = pickWalkSpot(SPOTS, { lat: 25.0421, lon: 121.5081 });
  assert.equal(w.name, '二二八和平紀念公園');
  assert.equal(pickWalkSpot(SPOTS, { lat: 23.5, lon: 121.3 }), null, '山裡附近沒有：只給一句建議');
  assert.equal(pickWalkSpot(SPOTS, null), null);
});

test('文案：天氣好又動得少 → 去走走（地點＋時間）；沒有地點只給一句；達標給鼓勵；沒問就不說', () => {
  const now = at('16:00'); // 應有 3,600 步，2,100 不到 60%
  const health = normalizeHealth(days({ steps: 2100, exerciseMin: 0 }), now);
  const pos = { lat: 25.0262, lon: 121.5435 }; // 大安區
  const n = nudgeFor({ health, ...NICE, pos, spots: [{ name: '大安森林公園', en: 'Daan Forest Park', lat: 25.03, lon: 121.5357, walk: 'park' }] }, now);
  assert.equal(n.kind, 'go');
  assert.match(n.text, /^天氣好、AQI 35，今天才走 2,100 步；走到大安森林公園約 \d+ 分。$/);
  assert.match(n.en, /Nice weather and AQI 35, and you've only walked 2,100 steps today\. Daan Forest Park is about a \d+-min walk\./);
  assert.ok(!/運動/.test(n.text), '沒有運動紀錄：不提運動 0 分鐘');
  const none = nudgeFor({ health, ...NICE, pos: null, spots: SPOTS }, now);
  assert.equal(none.text, '天氣好、AQI 35，今天才走 2,100 步；附近走走 20 分鐘也好。');
  // 有運動紀錄、也沒達進度：一起說
  const withEx = normalizeHealth(days({ steps: 2100, exerciseMin: 0 }, [['2026-11-20', 5000, 10], ['2026-11-21', 4000, 5]]), now);
  assert.equal(nudgeFor({ health: withEx, ...NICE }, now).text, '天氣好、AQI 35，今天才走 2,100 步，這 7 天運動 15 分鐘；附近走走 20 分鐘也好。');
  // 下雨：沒問就不說；自己問就說原因
  const rain = { ...NICE, weather: { ...NICE.weather, pop3h: 60 } };
  assert.equal(nudgeFor({ health, ...rain }, now).kind, 'none');
  const asked = nudgeFor({ health, ...rain, asked: true }, now);
  assert.equal(asked.kind, 'wait');
  assert.match(asked.text, /今天才走 2,100 步，不過接下來 3 小時降雨機率 60%/);
  // 達標
  const done = nudgeFor({ health: normalizeHealth(days({ steps: 7300, exerciseMin: 0 }), now), ...NICE }, now);
  assert.deepEqual([done.kind, done.text], ['cheer', '今天走了 7,300 步，達標了，很棒！']);
  // 進度不錯、沒問：不說
  const fine = normalizeHealth(days({ steps: 4000, exerciseMin: null }), now);
  assert.equal(nudgeFor({ health: fine, ...NICE }, now).kind, 'none');
  assert.equal(nudgeFor({ health: fine, ...NICE, asked: true }, now).kind, 'ok');
  // 讀不到步數：沒問不說；自己問說原因
  assert.equal(nudgeFor({ health: null, ...NICE }, now).kind, 'none');
  assert.match(nudgeFor({ health: null, ...NICE, asked: true }, now).text, /讀不到[你您]的步數/);
  // 晚上不推
  assert.equal(nudgeFor({ health: normalizeHealth(days({ steps: 900, exerciseMin: 0 }), at('20:30')), ...NICE }, at('20:30')).kind, 'none');
});

test('一天一次：首頁小卡按「今天不用」到明天再說；問阿幫一天主動提一次，自己問一定回答', () => {
  const now = at('10:00');
  let rec = dayRecord(null, now);
  assert.equal(homeAllowed(rec), true);
  assert.equal(agentAllowed(rec), true);
  rec = { ...rec, agent: true };
  assert.equal(agentAllowed(rec), false, '今天提過了');
  assert.equal(agentAllowed(rec, true), true, '自己問一定回答');
  rec = { ...rec, off: true };
  assert.equal(homeAllowed(rec), false);
  // 隔天：重來
  const tomorrow = dayRecord(rec, at('08:00', '2026-11-23'));
  assert.deepEqual(tomorrow, { d: '2026-11-23' });
  assert.equal(homeAllowed(tomorrow) && agentAllowed(tomorrow), true);
  // 紀錄只有日期與旗標（不含步數）
  assert.deepEqual(Object.keys(dayRecord({ d: TODAY, off: true, agent: true, steps: 100 }, now)).sort(), ['agent', 'd', 'off']);
});

test('正規化：只留日期、步數、運動分鐘；最近 7 天；奇怪的數字當沒有', () => {
  const now = at('12:00');
  const h = normalizeHealth({ source: 'health-connect', extra: 'x', days: [
    { date: '2026-11-10', steps: 1000, exerciseMin: 1 }, // 超過 7 天
    { date: '2026-11-20', steps: '3500', exerciseMin: -5, heartRate: 70, dataOrigin: 'com.fit' },
    { date: TODAY, steps: 2100.4, exerciseMin: 12 },
    { date: '2026-11-23', steps: 9, exerciseMin: 9 }, // 未來
    { date: 'bad', steps: 1 },
  ] }, now);
  assert.deepEqual(h, { source: 'health-connect', demo: false, days: [{ date: '2026-11-20', steps: 3500, exerciseMin: 0 }, { date: TODAY, steps: 2100, exerciseMin: 12 }] }, '有運動紀錄的來源：沒紀錄的那天是 0');
  assert.equal(normalizeHealth({ days: [{ date: TODAY, steps: 10 }] }, now).days[0].exerciseMin, null, '完全沒有運動紀錄：不知道');
  assert.equal(normalizeHealth({ days: 'x' }), null);
  assert.equal(normalizeHealth({ days: [], source: 'evil' }).source, 'unknown');
});

test('自己問運動的句子（「捷運動物園」不算）', () => {
  for (const q of ['我要不要去運動', '適合散步嗎', '想出去走走', '今天適合慢跑嗎', 'Should I go for a walk?']) assert.ok(EXERCISE_Q.test(q), q);
  for (const q of ['我想搭捷運動物園', '可以坐捷運動物園嗎', '可以去體育館看運動比賽嗎', '我想買運動鞋', '捷運動物園站怎麼去', '會下雨嗎？', '從台北車站走路到101', 'is the bus running', '運動中心怎麼去', '去運動公園的公車', '走走停停的公車', 'walk to Taipei 101']) assert.ok(!EXERCISE_Q.test(q), q);
});

// ───── public/js/health.js ─────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, get length() { return store.size; } };
const H = await import('../public/js/health.js');
beforeEach(() => { store.clear(); delete globalThis.Capacitor; H._resetHealth(); globalThis.fetch = async () => ({ ok: true, json: async () => landmarks }); });

/** 假外掛 AbangHealth：permission 依序回傳 */
function fakeNative({ status = { available: true, permission: 'prompt', source: 'health-connect' }, request = { available: true, permission: 'granted', source: 'health-connect' }, summary = null, platform = 'android' } = {}) {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n) => n === 'AbangHealth',
    nativePromise: async (plugin, method, args) => { calls.push(method); if (method === 'status') return status; if (method === 'requestPermission') return request; if (method === 'summary') return summary || { source: 'health-connect', days: [{ date: twDate(), steps: 100, exerciseMin: 0 }] }; if (method === 'openSettings') return { args }; return {}; },
  };
  return calls;
}

test('預設關閉；關閉時不讀步數、不建議', async () => {
  assert.equal(H.healthEnabled(), false);
  const calls = fakeNative();
  assert.equal(await H.healthSummary(), null);
  assert.equal(await H.homeNudge(NICE), null);
  assert.equal(await H.agentNudge(NICE, { asked: true }), null);
  assert.deepEqual(calls, [], '關著時連外掛都不叫');
  H.setHealthEnabled(true);
  assert.equal(store.get(H.HEALTH_KEY), 'on');
  H.setHealthEnabled(false);
  assert.equal(store.has(H.HEALTH_KEY), false);
});

test('網頁版：示範資料（介面相同、標示範），今天的步數低於目標一半', async () => {
  const st = await H.healthStatus();
  assert.deepEqual([st.where, st.state, st.source], ['demo', 'ready', 'demo']);
  const s = H.demoSummary(at('15:00'));
  assert.equal(s.days.length, 7);
  const mv = movement(normalizeHealth(s, at('15:00')), at('15:00'));
  assert.equal(mv.low, true);
  H.setHealthEnabled(true);
  const v = await H.healthSummary();
  assert.equal(v.demo, true);
});

test('外掛回報整理：被拒、還沒問、沒有 Health Connect（可以裝）、HealthKit 沒開通、舊版 App 沒外掛', () => {
  assert.equal(H.healthState({ available: true, permission: 'denied' }, 'app', 'android').state, 'denied');
  assert.equal(H.healthState({ available: true, permission: 'denied' }, 'app', 'android').canOpen, true);
  assert.equal(H.healthState({ available: true, permission: 'prompt' }, 'app', 'android').state, 'need-permission');
  assert.equal(H.healthState({ available: true, permission: 'asked', source: 'healthkit' }, 'app', 'ios').state, 'ready', 'iPhone 不告訴 App 讀取權限：問過就當可以讀');
  const ni = H.healthState({ available: false, reason: 'not-installed' }, 'app', 'android');
  assert.deepEqual([ni.state, ni.canInstall], ['unavailable', true]);
  assert.match(H.HEALTH_WHY[ni.reason], /Health Connect/);
  assert.equal(H.healthState({ available: false, reason: 'no-entitlement' }, 'app', 'ios').reason, 'no-entitlement');
  assert.equal(H.healthState({ available: false, reason: '???' }, 'app', 'ios').reason, 'failed');
  assert.equal(H.healthState(null, 'app', 'ios').state, 'unavailable');
});

test('拒絕權限：開關不打開、不讀資料；舊版 App 沒外掛不拿示範資料冒充', async () => {
  const calls = fakeNative({ request: { available: true, permission: 'denied', source: 'health-connect' } });
  const st = await H.requestHealthPermission();
  assert.equal(st.state, 'denied');
  assert.equal(H.healthEnabled(), false);
  assert.deepEqual(calls, ['requestPermission']);
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, nativePromise: async () => ({}) };
  const old = await H.healthStatus();
  assert.deepEqual([old.where, old.state, old.reason], ['app', 'unavailable', 'no-plugin']);
});

test('問阿幫：一天主動提一次、按「今天不用」就不提；首頁小卡也收起（隔天再說）', async () => {
  fakeNative({ status: { available: true, permission: 'granted' }, summary: { source: 'health-connect', days: [{ date: TODAY, steps: 1500, exerciseMin: 0 }] } });
  H.setHealthEnabled(true);
  const now = at('15:00');
  const d = { ...NICE, pos: { lat: 25.0478, lon: 121.517 } };
  assert.equal((await H.agentNudge(d, { asked: true }, now))?.kind, 'go', '自己問：回答');
  assert.equal(await H.agentNudge(d, {}, now + 60_000), null, '自己問過、建議過了：今天不再主動提');
  store.delete(H.HEALTH_DAY_KEY);
  const first = await H.agentNudge(d, {}, now);
  assert.equal(first?.kind, 'go');
  assert.equal(await H.agentNudge(d, {}, now + 60_000), null, '今天提過了');
  assert.equal((await H.agentNudge(d, { asked: true }, now))?.kind, 'go', '自己問一定回答');
  assert.equal((await H.homeNudge(d, now))?.kind, 'go');
  H.dismissToday(now);
  assert.equal(await H.homeNudge(d, now), null);
  assert.equal(await H.agentNudge(d, {}, now), null);
  assert.equal((await H.agentNudge(d, { asked: true }, now))?.kind, 'go', '按了今天不用，自己問還是回答');
  assert.deepEqual(Object.keys(JSON.parse(store.get(H.HEALTH_DAY_KEY))).sort(), ['agent', 'd', 'off'], '只記日期與旗標');
  for (const v of store.values()) assert.ok(!/1500|steps/.test(v), '步數不存進手機儲存');
  // 隔天早上：又可以提
  H._resetHealth();
  fakeNative({ status: { available: true, permission: 'granted' }, summary: { source: 'health-connect', days: [{ date: '2026-11-23', steps: 1000, exerciseMin: 0 }] } });
  assert.equal((await H.homeNudge(d, at('14:00', '2026-11-23')))?.kind, 'go');
});

test('散步建議只用您在的地方：用了手機定位，或離您 3 公里內（問高雄天氣不拿來建議）', () => {
  const taipei = { lat: 25.0478, lon: 121.517 };
  assert.equal(H.nearMe({ lat: 22.62, lon: 120.30 }, taipei), false, '問高雄天氣');
  assert.equal(H.nearMe({ lat: 25.1677, lon: 121.4455 }, taipei), false, '定位了、但問的是淡水那邊');
  assert.equal(H.nearMe({ lat: 25.05, lon: 121.52 }, taipei), true);
  assert.equal(H.nearMe({ lat: 25.05, lon: 121.52 }, null), false, '不知道您在哪：不用');
  assert.equal(H.nearMe(null, taipei), false);
});

test('這一輪的天氣空品：出門建議、現在天氣、空品；明天的天氣不算', () => {
  const r = H.turnWeather([{ tool: 'outing_advice', data: { weather: NICE.weather, air: NICE.air }, args: { lat: 25.04, lon: 121.51 } }]);
  assert.deepEqual([r.relevant, r.weather.pop3h, r.air.aqi, r.pos.lat], [true, 10, 35, 25.04]);
  assert.equal(H.turnWeather([{ tool: 'weather_tomorrow', data: { pop: 10 } }]).relevant, false);
  assert.equal(H.turnWeather([{ tool: 'aqi_nearby', data: { nearest: { aqi: 20 } }, args: {} }]).air.aqi, 20);
  assert.equal(H.turnWeather([{ tool: 'plan_trip', data: {} }]).relevant, false, '規劃行程不提');
});

// ───── 健康資料不送伺服器 ─────
test('健康資料不送伺服器：前端健康模組不呼叫阿幫 API；agent 請求、伺服器、模型提示都沒有健康欄位', async () => {
  for (const f of ['public/js/health.js', 'public/js/health-ui.js', 'core/health-nudge.js']) {
    const src = (await readFile(new URL(`../${f}`, import.meta.url), 'utf8')).replace(/\/\/.*$/gm, '');
    assert.ok(!/\/api\/|runAgent|callTool|sendBeacon|XMLHttpRequest|console\.log/.test(src), `${f} 不連阿幫的 API、不寫 log`);
    assert.ok(!/fetch\((?!'\/core\/landmarks\.json')/.test(src), `${f} 只讀內建地標庫`);
  }
  // 問阿幫的請求：runAgent 那一行不帶健康資料；補的那一句不進 history
  const agent = await readFile(new URL('../public/js/pages/agent.js', import.meta.url), 'utf8');
  const call = agent.split('\n').find((l) => l.includes('await runAgent('));
  assert.ok(call && !/health|step|步數/i.test(call), 'runAgent 的請求沒有健康欄位');
  const fn = agent.slice(agent.indexOf('async function addHealthSay'), agent.indexOf('/** 「阿幫問你」的答案')); // 註解沒改稱呼
  assert.ok(fn && !/history\.push|saveChat|runAgent|send\(/.test(fn), '補的那一句不進對話紀錄、不送出');
  // 伺服器、agent、habits（userState）都沒有健康欄位
  for (const f of ['core/agent/prompt.js', 'core/agent/run.js', 'core/agent/model-loop.js', 'server/agent.js', 'public/js/habits.js', 'public/js/agent/client.js']) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/health|exerciseMin|步數/i.test(src), `${f} 沒有健康欄位`);
  }
});

test('沒有定位：首頁不拿台北車站備用的天氣建議散步', async () => {
  fakeNative({ status: { available: true, permission: 'granted' }, summary: { source: 'health-connect', days: [{ date: TODAY, steps: 1500, exerciseMin: 0 }] } });
  H.setHealthEnabled(true);
  const now = at('15:00');
  assert.equal(await H.homeNudge({ ...NICE, pos: null }, now), null);
  assert.equal((await H.homeNudge({ ...NICE, pos: { lat: 25.0478, lon: 121.517 } }, now))?.kind, 'go');
});

test('進度文案照實說：步數少但運動有跟上、讀不到步數＋運動落後、步數正常', () => {
  const now = at('22:00');
  const ok = (h) => progressSay(movement(normalizeHealth(h, now), now))[0];
  const ex = [['2026-11-16', 3000, 60], ['2026-11-17', 3000, 60]];
  assert.equal(ok(days({ steps: 1000, exerciseMin: 0 }, ex)), '今天走得比較少（1,000 步），不過這 7 天運動 120 分鐘，有跟上進度');
  assert.equal(ok(days({ steps: null, exerciseMin: 0 }, [['2026-11-20', null, 10]])), '今天讀不到步數；這 7 天運動 10 分鐘，還沒到這週的進度');
  assert.equal(ok(days({ steps: null, exerciseMin: null })), '今天讀不到步數');
  assert.equal(ok(days({ steps: 5000, exerciseMin: null })), '今天走了 5,000 步，進度不錯');
  // 自己問、天氣好：不說錯「進度不錯」
  const h = normalizeHealth(days({ steps: null, exerciseMin: 0 }, [['2026-11-20', null, 10]]), at('15:00'));
  const n = nudgeFor({ health: h, ...NICE, asked: true }, at('15:00'));
  assert.equal(n.kind, 'ok');
  assert.match(n.text, /^今天讀不到步數；這 7 天運動 10 分鐘，還沒到這週的進度；天氣也好/);
});

test('Android 7 不閃退：外掛類別不碰 java.time 與 Health Connect（都在 Android 9 以上才呼叫的 HealthConnectReader）', async () => {
  const dir = new URL('../android/app/src/main/java/tw/abang/app/', import.meta.url);
  const plugin = await readFile(new URL('AbangHealthPlugin.java', dir), 'utf8');
  assert.ok(!/import java\.time|import androidx\.health|import kotlin/.test(plugin), '外掛類別沒有 import java.time、Health Connect、kotlin');
  for (const m of plugin.matchAll(/^\s*(?:private |public |protected )?static\s+(?:final\s+)?([\w<>, ?]+?)\s+\w+\s*=/gm)) assert.ok(['String', 'int'].includes(m[1]), `外掛類別的 static 欄位只有字串與整數常數：${m[0].trim()}`);
  assert.match(plugin, /MIN_SDK = 28/);
  assert.match(plugin, /if \(Build\.VERSION\.SDK_INT < MIN_SDK\) return "os"/);
  const reader = await readFile(new URL('HealthConnectReader.java', dir), 'utf8');
  for (const m of reader.matchAll(/^\s*(?:private |public |protected )?static\s+(?:final\s+)?([\w<>, ?]+?)\s+\w+\s*=/gm)) assert.equal(m[1], 'String', `讀取類別也沒有會在初始化時跑的 static 欄位：${m[0].trim()}`);
  assert.match(reader, /ZoneId\.of\("Asia\/Taipei"\)/);
  assert.match(reader, /aggregateGroupByDuration/);
  assert.match(H.HEALTH_WHY.os, /Android 9 以上/);
});

test('MyDrama 運動活動頁（ADR-0019 D-05）：建議去走走、有設定連結、沒關短劇提示才給；連結從開 App 的狀態來，不帶健康資料', async () => {
  const { dramaExercise } = await import('../public/js/health-ui.js');
  const partner = { exercise: 'example-drama://unlock', store: { ios: 'https://example.com/i', android: null } };
  assert.deepEqual(dramaExercise({ kind: 'go' }, { partner, hintOn: true }), { label: '看 MyDrama 活動頁', app: 'example-drama://unlock', store: partner.store });
  assert.equal(dramaExercise({ kind: 'go' }, { partner, hintOn: true, lang: 'en' }).label, 'MyDrama activity page');
  assert.equal(dramaExercise({ kind: 'go' }, { partner: { exercise: null }, hintOn: true }), null, '沒設定就不顯示');
  assert.equal(dramaExercise({ kind: 'go' }, { partner: null, hintOn: true }), null);
  assert.equal(dramaExercise({ kind: 'cheer' }, { partner, hintOn: true }), null, '只有建議去走走時');
  assert.equal(dramaExercise({ kind: 'go' }, { partner, hintOn: false }), null, '設定關掉短劇提示就不給');
  assert.equal(dramaExercise({ kind: 'go' }, { partner: { exercise: 'javascript://x' }, hintOn: true }), null, '不安全的連結不給');
  // 伺服器：/api/v1/status 一律帶合作連結（跟健康狀態無關），沒設定是 null
  const { restRoutes, partnerLinks } = await import('../server/rest.js');
  const { createMockDramaServices } = await import('../core/services/drama-mock.js');
  assert.deepEqual(partnerLinks(createMockDramaServices({ links: { exercise: 'example-drama://unlock' } })), { exercise: 'example-drama://unlock', store: null });
  assert.deepEqual(partnerLinks({}), { exercise: null, store: null });
  const { createServices } = await import('../core/index.js');
  const st = restRoutes(createServices({ forceMock: true }))['/api/v1/status'].handler({});
  assert.deepEqual(st.partner, { exercise: null, store: null });
  // 開活動頁只用固定連結：health-ui 的 openApp 只帶 app 與 store
  const src = await readFile(new URL('../public/js/health-ui.js', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/openApp\(\{([^}]*)\}\)/g)];
  assert.equal(calls.length, 2);
  for (const m of calls) assert.equal(m[1].replace(/\s/g, ''), 'app:drama.app,store:drama.store');
});
