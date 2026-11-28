// 判斷看得到（2026-11-21）：plan_trip 用到的天氣、空品、路況逐項說明（considered）、討論串 data_note、決策圖資料欄、只有一種方式的說明
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherConsidered, airConsidered, trafficConsidered, consideredOf, missingModes, singleNote, AIR_MAX_M } from '../core/services/trip-considered.js';
import { planTrip, LIMITS } from '../core/services/trip.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { impactOf } from '../core/agent/impact.js';
import { ev } from '../core/agent/events.js';
import { nextSteps } from '../public/js/agent/next-steps.js';
import { dataNodes } from '../public/ui/agent/decision-graph.js';

const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const WANHUA = { name: '您的位置', lat: 25.0349, lon: 121.4997 };
const TAOYUAN = { name: '您的位置', lat: 24.99, lon: 121.31 };
const NOW = Date.parse('2026-11-18T09:00:00+08:00');
const LATE = Date.parse('2026-11-18T23:30:00+08:00');

test('天氣：晴＝不影響、下雨＝rain、可能下雨＝rainSoon、查不到照實說；不是今天的行程說「現在」', () => {
  const sunny = weatherConsidered({ weather: '多雲（示範）', tempC: 24, pop3h: 10, raining: false });
  assert.deepEqual([sunny.text, sunny.say, sunny.effect, sunny.tone, sunny.value], ['多雲 24°C，3 小時降雨 10%', '不用避雨', 'none', 'good', '24°C']);
  const rain = weatherConsidered({ weather: '陰有雨', tempC: 19, pop3h: 80, raining: true, rainMm1h: 2.5 });
  assert.deepEqual([rain.effect, rain.tone, rain.value], ['rain', 'bad', '下雨']);
  assert.match(rain.text, /1 小時雨量 2.5 毫米/);
  assert.match(rain.say, /少走路、少騎車/);
  assert.equal(weatherConsidered({ weather: '多雲', tempC: 22, pop3h: 65, raining: false }).effect, 'rainSoon');
  const none = weatherConsidered(null);
  assert.deepEqual([none.available, none.value, none.text], [false, '查不到', '這附近查不到天氣資料']);
  const later = weatherConsidered({ weather: '多雲', tempC: 22, pop3h: 10 }, { today: false });
  assert.match(later.text, /^現在/);
  assert.match(later.say, /出發時可能不同/);
});

test('空品：AQI ≤ 100 不影響、> 100 ＝ badAir；測站太遠或沒數值＝查不到（示範標明範圍）', () => {
  const ok = airConsidered({ nearest: { site: '萬華', aqi: 58, status: '普通', distanceM: 1200 } });
  assert.deepEqual([ok.text, ok.say, ok.effect, ok.value], ['萬華測站 AQI 58（普通）', '騎車、走路都可以', 'none', 'AQI 58']);
  const bad = airConsidered({ nearest: { site: '萬華', aqi: 128, status: '對敏感族群不健康', distanceM: 1200 } });
  assert.deepEqual([bad.effect, bad.tone, bad.say], ['badAir', 'bad', '少待戶外：走路、騎車扣分']);
  const far = airConsidered({ nearest: { site: '大里', aqi: 128, status: '對敏感族群不健康', distanceM: 239000 } }, { demo: true });
  assert.deepEqual([far.available, far.effect, far.value], [false, 'none', '查不到']);
  assert.match(far.text, /25 公里內沒有空品測站，最近的「大里」在 239 公里外（示範資料只有雙北、桃園、台中的測站）/);
  assert.equal(airConsidered({ nearest: { site: 'X', aqi: null, distanceM: 10 } }).available, false);
  assert.equal(airConsidered(null).text, '附近查不到空品資料');
});

test('路況：國道順暢、車多（只影響分數）、塞車＝traffic、市區短程、查不到', () => {
  assert.deepEqual(['say', 'effect'].map((k) => trafficConsidered({ covered: true, level: 'smooth', delayMin: 0 })[k]), ['不用避開塞車', 'none']);
  const jam = trafficConsidered({ covered: true, level: 'jam', delayMin: 18, segments: [{ road: '國道1號', speedKmh: 92, limitKmh: 100 }, { road: '國道1號', speedKmh: 30, limitKmh: 100 }] });
  assert.deepEqual([jam.text, jam.say, jam.effect], ['國道 1號塞車，多 18 分', '叫車、客運可能慢', 'traffic']);
  assert.equal(trafficConsidered({ covered: true, level: 'slow', delayMin: 5 }).effect, 'score');
  assert.equal(trafficConsidered({ covered: false }).text, '市區短程：沒有即時路況資料');
  assert.equal(trafficConsidered(null).available, false);
  assert.deepEqual(consideredOf({ weather: null, aqi: null, traffic: null }).map((c) => c.role), ['天氣', '空品', '路況']);
});

test('plan_trip（示範）：considered 三項、標示示範；下雨與空品差的影響和自動狀態一致', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: WANHUA, to: T101, now: NOW });
  assert.deepEqual(r.considered.map((c) => [c.role, c.available, c.demo]), [['天氣', true, true], ['空品', true, true], ['路況', true, true]]);
  assert.match(r.considered[1].text, /萬華測站 AQI \d+/);
  assert.equal(r.single, undefined, '市區有好幾種方式');
  const wet = await planTrip(createServices({ forceMock: true, demo: { weather: 'rain', air: 'bad' } }), { from: WANHUA, to: T101, now: NOW });
  const eff = Object.fromEntries(wet.considered.map((c) => [c.source, c.effect]));
  assert.deepEqual([eff.weather, eff.air], ['rain', 'badAir']);
  for (const k of ['rain', 'badAir']) assert.ok(wet.states.some((s) => s.key === k && s.source === 'auto'), `${k} 也是自動狀態`);
  const tool = await import('../core/tools/index.js').then((m) => m.callTool(createServices({ forceMock: true }), 'plan_trip', { from: '萬華車站', to: '台北101' }));
  assert.match(tool.text, /判斷用到的資料：天氣「.+」→ 不用避雨（示範資料）；空品「/, '模型看到的文字也有每個來源的影響');
});

test('空品測站超過 25 公里：不加空品不佳狀態、air 為 null（真實與示範同一個上限）', async () => {
  assert.equal(AIR_MAX_M, 25000);
  const svc = createServices({ forceMock: true, demo: { air: 'bad' } });
  const r = await planTrip(svc, { from: { name: '墾丁', lat: 21.95, lon: 120.79 }, to: { name: '恆春', lat: 22.0, lon: 120.75 }, now: NOW });
  assert.equal(r.air, null);
  assert.ok(!r.states.some((s) => s.key === 'badAir'));
  assert.equal(r.considered[1].available, false);
  assert.equal(impactOf('aqi_nearby', { nearest: { aqi: 150, distanceM: 239000 } }).tone, 'neutral', '另外查的空品也一樣不列入');
});

test('只有一種方式：說明太遠與沒有趕得上的班次（示範標明），建議改明天早上或從台北車站出發', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: TAOYUAN, to: T101, departAt: '23:30', now: LATE });
  assert.deepEqual(r.options.map((o) => o.role), ['ridehail']);
  assert.match(r.single.text, /^只找到叫車一種方式：距離 26.1 公里，走路、YouBike、公車都太遠/);
  assert.doesNotMatch(r.single.text, /客運/, '客運沒資料就不提（產品負責人 2026-11-22）');
  assert.match(r.single.text, /示範資料/);
  assert.deepEqual(r.single.suggest.map((s) => s.ask), ['明天早上 8 點去台北101', '從台北車站到台北101怎麼去'], '台鐵不限距離後（2026-11-22）：23:30 以後趕不上台鐵，建議改明天');
  assert.match(impactOf('plan_trip', r)[0].text, /^只找到叫車一種方式/);
  // 白天同一段路：有客運，不是只有一種
  const day = await planTrip(createServices({ forceMock: true }), { from: TAOYUAN, to: T101, departAt: '10:00', now: NOW });
  assert.ok(day.options.length > 1 && !day.single);
});

test('missingModes／singleNote：太遠、太近不算、附近沒有站、真實資料不加示範說明', () => {
  const m = missingModes({ straight: 65000, roles: { ridehail: { id: 'ridehail' }, thsr: { none: { kind: 'noService', why: 'x' } }, tra: { none: { kind: 'none', why: '起點或目的地 25 公里內沒有車站' } }, intercity: 'failed' }, limits: LIMITS });
  assert.deepEqual(m.map((x) => [x.role, x.kind]), [['walk', 'far'], ['bike', 'far'], ['bus', 'far'], ['metro', 'far'], ['thsr', 'noService'], ['tra', 'none']], '客運沒有方案就不列');
  const s = singleNote({ options: [{ role: 'ridehail', name: '叫車' }], missingList: m, straight: 65000, departMin: 23 * 60, demo: false, toName: '台北101', fromName: '您的位置' });
  assert.equal(s.text, '只找到叫車一種方式：距離 65 公里，走路、YouBike、公車、捷運都太遠；高鐵 23:00 以後今天沒有趕得上的班次；台鐵：起點或目的地 25 公里內沒有車站');
  assert.deepEqual(s.suggest.map((x) => x.label), ['改成明天早上出發'], '真實資料不建議改從台北車站');
  assert.equal(singleNote({ options: [{}, {}], missingList: [], straight: 1 }), null);
});

test('討論串：示範模式 plan_trip 後送天氣、空品、路況各一個 data_note（在行程結論前、帶影響與示範標記）', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '去台北 101' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: WANHUA.lat, lon: WANHUA.lon } }] }, (e) => es.push(e)); // 現在時間：行程比較也用現在判斷是不是今天
  const start = es.find((e) => e.type === 'tool_start' && e.name === 'plan_trip');
  const notes = es.filter((e) => e.type === 'data_note');
  assert.deepEqual(notes.map((n) => n.role), ['天氣', '空品', '路況']);
  assert.ok(notes.every((n) => n.parent === start.id && n.mode === 'demo' && n.impact.text));
  assert.match(notes[0].text, /°C，3 小時降雨 \d+%/);
  assert.equal(notes[0].impact.text, '不用避雨');
  const iResult = es.findIndex((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.ok(es.indexOf(notes[2]) < iResult, '資料在行程結論前面');
  const d = es.find((e) => e.type === 'decision');
  assert.equal(d.considered.length, 3, '決策圖資料欄有三個來源');
  // 英文那一輪用英文欄位
  const en = ev.dataNote({ parent: 't1', item: d.considered[0], lang: 'en' });
  assert.match(en.text, /°C/);
  assert.equal(en.impact.text, 'No need to avoid rain');
});

test('決策圖資料欄 dataNodes：considered 在前（值、影響、查不到），其他小幫手在後、行程不算', () => {
  const decision = { considered: [{ role: '天氣', value: '24°C', valueEn: '24°C', effect: 'none', available: true }, { role: '空品', value: '查不到', valueEn: 'N/A', effect: 'none', available: false }, { role: '路況', value: '塞 18 分', valueEn: '+18 min', effect: 'traffic', available: true }] };
  const n = dataNodes(decision, ['地點', '行程', '天氣']);
  assert.deepEqual(n.map((x) => x.role), ['天氣', '空品', '路況', '地點']);
  assert.deepEqual([n[2].value, n[2].effect, n[1].available], ['塞 18 分', 'traffic', false]);
  assert.equal(dataNodes(decision, [], true)[2].value, '+18 min');
  assert.deepEqual(dataNodes({}, ['定位']).map((x) => x.role), ['定位'], '舊版事件沒有 considered 也能畫');
});

test('接下來可以：只有一種方式時先給換條件的建議（送出那一句）', () => {
  const single = { text: '只找到叫車一種方式', suggest: [{ label: '改從台北車站出發比較看看', ask: '從台北車站到台北101怎麼去' }] };
  const steps = nextSteps([{ tool: 'plan_trip', data: { from: { name: '您的位置' }, to: { name: '台北101' }, states: [], single } }], { states: [], single });
  assert.deepEqual(steps[0], { label: '改從台北車站出發比較看看', kind: 'ask', payload: '從台北車站到台北101怎麼去', pin: true }); // pin：動態建議也排最前面（agent/suggest.js）
});

test('TDX 額度用完改用示範資料（#105 withTdxFallback）：路況那一行標示範並照實說', async () => {
  const { withTdxFallback } = await import('../core/index.js');
  const { TdxError } = await import('../core/tdx-client.js');
  const { createMockTrafficServices } = await import('../core/services/traffic-mock.js');
  const base = createServices({ forceMock: true });
  const live = { traffic: { status: async () => { throw new TdxError(429, 'rate limit'); } } };
  const svc = { ...base, mode: 'live', weatherMode: 'live', aqiMode: 'live', ...withTdxFallback(live, createMockTrafficServices()) };
  const r = await planTrip(svc, { from: TAOYUAN, to: T101, now: NOW });
  const t = r.considered.find((c) => c.source === 'traffic');
  assert.deepEqual([t.demo, t.fallback, t.available, t.effect, t.value], [true, 'tdx-limit', false, 'none', '查不到']);
  assert.equal(t.text, 'TDX 額度用完，這次查不到國道路況', '示範的路況不拿來判斷（ADR-0010 2026-11-22）');
  assert.ok(!r.states.some((s) => s.key === 'traffic'), '不因示範的塞車加狀態');
  assert.equal(r.traffic, null);
  assert.equal(ev.dataNote({ parent: 't1', item: t }).mode, 'demo');
  assert.equal(r.considered.find((c) => c.source === 'weather').demo, true, '天氣服務本身是示範（mock 帶 demo）');
});

test('建議帶著使用者說的起點：「從西門町到台北101」→ 明天早上 8 點從西門町到台北101；您的位置不帶', () => {
  const missingList = [{ role: 'intercity', kind: 'noService', why: 'x' }];
  const base = { options: [{ role: 'ridehail', name: '叫車' }], missingList, straight: 26000, departMin: 23 * 60 + 30, toName: '台北101' };
  const said = singleNote({ ...base, demo: true, fromName: '西門町' });
  assert.deepEqual(said.suggest.map((s) => s.ask), ['明天早上 8 點從西門町到台北101', '從台北車站到台北101怎麼去']);
  assert.equal(singleNote({ ...base, demo: true, fromName: '您的位置' }).suggest[0].ask, '明天早上 8 點去台北101');
});

test('真實模式但這次 TDX 額度用完改用示範資料：只有一種方式的說明照實標示，不當成真的沒有班次', async () => {
  const { withTdxFallback } = await import('../core/index.js');
  const { TdxError } = await import('../core/tdx-client.js');
  const { measure, currentFallback } = await import('../core/metrics.js');
  const base = createServices({ forceMock: true });
  const limit = async () => { throw new TdxError(429, 'rate limit'); };
  const live = { intercity: { trips: limit }, rail: { thsrStations: limit, traStations: limit } };
  const mock = { intercity: base.intercity, rail: base.rail };
  const svc = { ...base, mode: 'live', weatherMode: 'live', aqiMode: 'live', ...withTdxFallback(live, mock) };
  const { result: r, metrics } = await measure(() => planTrip(svc, { from: TAOYUAN, to: T101, departAt: '23:30', now: LATE }));
  assert.equal(metrics.fallback, true);
  assert.doesNotMatch(r.single.text, /客運/, '示範的客運不推，也不提（客運沒資料就不列）');
  assert.ok((r.single.text.match(/TDX/g) || []).length <= 1, `額度用完最多說一次：${r.single.text}`);
  assert.ok(!r.options.some((o) => /示範/.test(o.name)));
  assert.doesNotMatch(r.single.text, /設定金鑰後/);
  assert.ok(!r.single.suggest.some((s) => /台北車站/.test(s.label)), '不是示範模式：不建議改從台北車站');
  assert.ok(r.single.suggest.some((s) => s.label === '過一分鐘再問一次'), '額度每分鐘重置：建議稍後再問');
  assert.equal(currentFallback(), false, '計量範圍外沒有旗標');
  // 沒有 fallback 的真實模式：不加說明
  assert.doesNotMatch(singleNote({ options: [{ role: 'ridehail' }], missingList: [], straight: 26000, departMin: 0, demo: false, toName: '台北101' }).text, /示範|TDX/);
});
