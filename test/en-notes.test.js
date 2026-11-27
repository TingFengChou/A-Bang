// S12c：英文提問的討論串說明用英文（@角色 標籤保留給畫面對應頭像）；接下來可以用英文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enNote } from '../core/agent/en-notes.js';
import { nextSteps } from '../public/js/agent/next-steps.js';
import { runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';

test('enNote：常見說明換英文、@標籤保留、對不上照原文', () => {
  assert.equal(enNote('@地點 先確認「臺北車站」和「台北101」在哪'), '@地點 finding where 臺北車站 and 台北101 are');
  assert.equal(enNote('@天氣 @空品 @路況 看一下外面的狀況'), '@天氣 @空品 @路況 checking weather, air and traffic');
  assert.equal(enNote('@行程 幫你比較幾種走法'), '@行程 comparing ways to get there');
  assert.equal(enNote('@公車 307 現在到哪了'), '@公車 where bus 307 is now');
  assert.equal(enNote('@高鐵 台北到左營的班次'), '@高鐵 trains from 台北 to 左營');
  assert.equal(enNote('@股市 看一下大盤收盤'), '@股市 看一下大盤收盤', '沒有英文規則的照原文');
});

const DAY = Date.parse('2026-11-18T10:00:00+08:00');

test('英文提問：討論串說明英文、不說中文的「聽懂了」；接下來可以英文', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: 'How do I get to Taipei 101?' }] }, (e) => es.push(e), { now: DAY }); // 白天（深夜捷運收班會改推公車，站名是中文）
  const notes = es.filter((e) => e.type === 'agent_note').map((e) => e.text);
  assert.ok(notes.length >= 2);
  for (const n of notes) assert.doesNotMatch(n.replace(/@\S+/g, '').replace(/「.+?」|臺北車站|台北101/g, ''), /[一-鿿]/, n);
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  const steps = nextSteps([{ tool: 'plan_trip', data: trip.data }], null, { lang: 'en' });
  assert.ok(steps.length >= 1 && steps.every((s) => !/[一-鿿]/.test(s.label)), steps.map((s) => s.label).join('|'));
  assert.ok(!steps.some((s) => s.kind === 'ask'), '英文不給會變成中文問句的建議');
});

test('S12d：英文那一輪的工具回報是英文（數字來自資料）、不附中文的「→ 影響」', async () => {
  const { speakEn, SPEAK_EN } = await import('../core/tools/speak-en.js');
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: 'How do I get to Taipei 101?' }] }, (e) => es.push(e), { now: DAY }); // 白天（深夜捷運收班會改推公車，站名是中文）
  const results = es.filter((e) => e.type === 'tool_result' && e.ok);
  assert.ok(results.length >= 3);
  for (const r of results) {
    if (SPEAK_EN[r.tool]) assert.match(r.speak, /^[A-Z]/, `${r.tool}: ${r.speak}`); // 英文句子（地名可以是中文）
    for (const x of [].concat(r.impact || [])) assert.match(x.text, /^[A-Z]/, `${r.tool} 的影響要是英文：${x.text}`);
  }
  assert.equal(speakEn('no_such_tool', {}), null);
  assert.equal(speakEn('weather_now', { rainMm1h: 2, pop3h: 80 }), "It's raining now, 80% chance of rain in the next 3 hours.");
  assert.match(speakEn('plan_trip', { best: 'a', options: [{ id: 'a', role: 'metro', minutes: 23 }, { id: 'b' }] }), /best is MRT \(23 min\)/);
  assert.match(speakEn('plan_trip', { best: 'a', options: [{ id: 'a', role: 'bus', name: '公車 307', minutes: 30 }] }), /best is Bus 307/);
  // 中文那一輪照舊
  const zh = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從臺北車站去台北101' }] }, (e) => zh.push(e));
  assert.ok(zh.filter((e) => e.type === 'tool_result' && e.ok).some((r) => /[一-鿿]/.test(r.speak || '')));
});

test('每個英文回報都能用工具的實際輸出算出來（不丟錯、不回 null）；各種情況', async () => {
  const { SPEAK_EN, speakEn, impactEn } = await import('../core/tools/speak-en.js');
  const { callTool } = await import('../core/tools/index.js');
  const svc = createServices({ forceMock: true });
  const P = { lat: 25.0478, lon: 121.517 };
  const ARGS = {
    find_place: { query: '台北車站' }, plan_trip: { from: '臺北車站', to: '台北101', departAt: '09:00' }, weather_now: P, weather_tomorrow: P, aqi_nearby: P, outing_advice: P,
    youbike_nearby: P, bus_nearby_stations: P, bus_station_eta: { city: 'Taipei', stationId: 'M1000' }, bus_route_eta: { city: 'Taipei', routeName: '307' },
    metro_live_board: { near: '台北車站' }, thsr_timetable: { from: '台北', to: '左營' }, tra_timetable: { from: '臺北', to: '高雄' },
    rail_fare: { system: 'THSR', from: '台北', to: '左營' }, pharmacy_search: { area: '臺北市大安區' }, clinic_search: { area: '臺北市中正區' }, gov_office_nearby: P, passport_waiting: {}, ridehail_link: { to: '台北101', from: '臺北車站' }, traffic_status: { from: '臺北車站', to: '高雄車站' },
    drama_picks: {}, drama_search: { query: '甜寵' }, drama_series: { id: 'demo-night-bus' },
  };
  for (const name of Object.keys(SPEAK_EN)) {
    const r = await callTool(svc, name, ARGS[name]);
    const say = speakEn(name, r.data, r.args);
    assert.match(say, /^[A-Z"0-9]/, `${name}: ${say}`);
  }
  // 公車狀態 1～4、上車站
  for (const [st, want] of [[1, /not departed/], [2, /not stopping/], [3, /last bus/], [4, /no service/]]) assert.match(speakEn('bus_route_eta', { routeName: '307', focus: { stopName: '西門', status: st } }), want);
  assert.equal(speakEn('bus_route_eta', { routeName: '307', focus: { stopName: '西門', status: 0, etaSec: 300 } }), '307 arrives at 西門 in 5 min.');
  // 捷運：預設地點 vs 你
  assert.match(speakEn('metro_live_board', { station: '台北車站', nearest: { from: '西門町', distanceM: 1200 }, trains: [] }), /Nearest MRT station to 西門町 is 台北車站 \(1\.2 km\)/);
  assert.match(speakEn('metro_live_board', { station: '台北車站', nearest: { distanceM: 800 }, trains: [{ etaMin: 3, destination: '南港展覽館' }] }), /to you is 台北車站 \(800 m\): next train to 南港展覽館 in 3 min/);
  // 高鐵：今天都開走了、別天
  const realNow = Date.now; // 固定在台灣時間中午（原本用現在時間，00:00 那一分鐘會失敗）
  Date.now = () => Date.parse('2026-11-18T12:00:00+08:00');
  try {
    assert.match(speakEn('thsr_timetable', { date: '2026-11-18', from: '台北', to: '左營', trains: [{ depart: '00:00', arrive: '01:30' }] }), /All of today's trains have left \(last at 00:00\)/);
  } finally { Date.now = realNow; }
  assert.match(speakEn('thsr_timetable', { date: '2030-01-05', from: '台北', to: '左營', trains: [{ depart: '06:15', arrive: '07:50' }] }), /1 train on Sat, Jan 5; first leaves 06:15/);
  // 路況：市區短程、塞車
  assert.match(speakEn('traffic_status', { covered: false, straightKm: 3 }), /Short trip/);
  assert.match(speakEn('traffic_status', { covered: true, level: 'jam', delayMin: 12 }), /jammed, about 12 min/);
  // 影響：YouBike 車位很緊
  assert.match(impactEn('plan_trip', { options: [{ role: 'bike', bike: { ret: { tight: true, count: 1, name: '市府站', backup: { name: '信義站' } }, rent: {} } }] }).text, /only 1 dock left at 市府站; if full, return at 信義站/);
});

test('S12e：英文問出門建議、藥局；出門建議卡片英文；英文卡片設的到站提醒通知也是英文', async () => {
  const { parseIntent } = await import('../core/agent/demo-intent.js');
  assert.equal(parseIntent('What should I bring today?').intent, 'outing');
  assert.equal(parseIntent('Do I need an umbrella?').intent, 'outing');
  assert.equal(parseIntent('Will it rain tomorrow?').intent, 'weather', '問明天的是預報');
  assert.equal(parseIntent('pharmacy near me').intent, 'pharmacy');
  const es = [];
  await runDemo(createServices({ forceMock: true, demo: { weather: 'rain' } }), { messages: [{ role: 'user', content: 'Do I need an umbrella?' }] }, (e) => es.push(e));
  assert.match(es.find((e) => e.type === 'text').delta, /^Before you head out: .*umbrella/);
  for (const n of es.filter((e) => e.type === 'agent_note')) assert.doesNotMatch(n.text.replace(/@\S+/g, '').replace(/臺北車站/g, ''), /[一-鿿]/, n.text);
  const { arrivalText, nativeBody } = await import('../public/ui/cards/host-web.js');
  assert.equal(arrivalText('307', '西門', 300, 'en'), 'Bus 307 reaches 西門 in about 5 min. Time to go!');
  assert.match(arrivalText('307', '西門', 300), /該出門了/);
  assert.match(nativeBody('307', '西門', 3, new Date(), 'en'), /^Bus 307 reaches 西門 in about 3 min/);
});

test('S12e 審查：穿什麼與明天、出門建議不誤判、買藥；建議中英文只有一份；英文提醒與一直不來', async () => {
  const { parseIntent } = await import('../core/agent/demo-intent.js');
  assert.equal(parseIntent('What should I wear tomorrow?').intent, 'weather');
  assert.equal(parseIntent('Do I need a jacket?').intent, 'outing');
  for (const q of ['Is it safe to go out at night?', 'What do I need for the MRT?', 'going out for dinner, any night market?']) assert.notEqual(parseIntent(q).intent, 'outing', q);
  assert.equal(parseIntent('Where can I buy medicine?').intent, 'pharmacy');
  const { outingItems } = await import('../core/agent/outing.js');
  const cases = [{ weather: { raining: true, rainMm1h: 2, tempC: 33 }, air: { aqi: 160, status: '不健康' } }, { weather: { raining: true, rainMm1h: 0, pop3h: 80 } }, { weather: { pop3h: 40, tempC: 12 }, air: { aqi: 120 }, states: ['kids'] }, { weather: { pop3h: 10, tempC: 24 }, air: { aqi: 40 } }, { air: { aqi: null } }];
  for (const c of cases) for (const x of outingItems(c)) assert.match(x.en, /^[A-Z0-9]/, `${x.text} → ${x.en}`);
  assert.match(outingItems(cases[2]).find((x) => x.kind === 'mask').en, /unhealthy for sensitive groups; kids should wear a mask/);
  assert.equal(outingItems(cases[3])[0].en, '24°C, AQI 40; all good to go out');
  const { nextSteps } = await import('../public/js/agent/next-steps.js');
  const steps = nextSteps([{ tool: 'bus_route_eta', data: { city: 'Taipei', routeName: '307', focus: { stopName: '西門', status: 0, etaSec: 400, direction: 0 } } }], null, { lang: 'en' });
  assert.equal(steps.find((s) => s.kind === 'remind').payload.lang, 'en', '英文的提醒建議：通知也英文');
  const { stuckAsk } = await import('../public/ui/cards/host-web.js');
  assert.equal(stuckAsk({ lang: 'en', trip: { to: '台北101' } }), 'No bus, find another way to 台北101');
  assert.equal(parseIntent('No bus, find another way to Taipei 101').avoid?.[0], 'bus');
});
