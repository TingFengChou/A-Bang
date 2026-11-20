// 同行者與行動能力狀態（A1）、出門建議（S13）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STATES } from '../core/decide.js';
import { outingAdvice, outingSay } from '../core/agent/outing.js';
import { parseIntent, needsLocation } from '../core/agent/demo-intent.js';

const OPTS = [
  { id: 'bike', role: 'bike', name: 'YouBike', minutes: 12, cost: 10, walkMin: 3, waitMin: 0, exposure: 1, effort: 0.8 },
  { id: 'walk', role: 'walk', name: '步行', minutes: 25, cost: 0, walkMin: 25, waitMin: 0, exposure: 1, effort: 0.6 },
  { id: 'bus', role: 'bus', name: '公車 601', minutes: 20, cost: 15, walkMin: 6, waitMin: 5, exposure: 0.3, effort: 0.2 },
  { id: 'taxi', role: 'ridehail', name: '叫車', minutes: 10, cost: 250, walkMin: 0, waitMin: 3, exposure: 0, effort: 0 },
];

test('elder／kids 排除 YouBike；mobility 排除 YouBike 與步行；原因寫明、決策圖標「不適合」', () => {
  for (const k of ['elder', 'kids']) {
    const r = decide(OPTS, { states: [k] });
    assert.deepEqual(r.excluded.map((e) => e.id), ['bike'], k);
    assert.equal(r.excluded[0].why, `${STATES[k].label}不建議騎 YouBike`);
    assert.match(r.reason, new RegExp(`${STATES[k].label}不建議騎 YouBike`));
  }
  const m = decide(OPTS, { states: ['mobility'] });
  assert.deepEqual(m.excluded.map((e) => e.id).sort(), ['bike', 'walk']);
  assert.ok(['bus', 'taxi'].includes(m.best.id));
  assert.ok(STATES.mobility.boost.walkMin >= 3);
});

test('規則：長輩、小孩、輪椅的說法；「帶阿嬤」「推嬰兒車去…」是行程', () => {
  assert.deepEqual(parseIntent('帶阿嬤從西門町去台北101').states, ['elder']);
  assert.deepEqual(parseIntent('推嬰兒車去台北101').states, ['kids']);
  assert.deepEqual(parseIntent('我坐輪椅，要去台北101').states, ['mobility']);
  assert.equal(parseIntent('推嬰兒車去台北101').intent, 'trip');
  assert.ok(!parseIntent('我想少走一點去台北101').states.includes('elder'));
});

test('出門建議：下雨、降雨機率、冷熱、空品；資料正常時說安心出門；沒有資料不亂說', () => {
  assert.deepEqual(outingAdvice({ weather: { raining: true, pop3h: 90, tempC: 33 }, air: { aqi: 160, status: '不健康' } }), ['現在正在下雨，記得帶傘', '33°C 很熱，注意防曬、多喝水', '空氣品質不健康（AQI 160），盡量少待戶外、戴口罩']);
  assert.deepEqual(outingAdvice({ weather: { pop3h: 60, tempC: 14 } }), ['接下來 3 小時降雨機率 60%，帶把傘', '14°C 偏涼，帶件外套']);
  assert.match(outingSay({ weather: { pop3h: 10, tempC: 24 }, air: { aqi: 40, status: '良好' } }), /都還不錯，安心出門/);
  assert.equal(outingSay({}), '這次沒查到天氣和空品資料，晚點再試。');
});

test('出門建議的問法；需要位置；說了地名的不是出門建議', () => {
  for (const q of ['今天出門要注意什麼？', '出門要帶傘嗎', '今天要穿什麼']) {
    const it = parseIntent(q);
    assert.equal(it.intent, 'outing', q);
    assert.ok(needsLocation(it), q);
  }
  assert.notEqual(parseIntent('明天去台北101會下雨嗎').intent, 'outing');
});

test('使用者明講的方式優先於「不適合」（加提醒）；新狀態不再疊加少走路；行動不便沒有可行方案時建議叫車', () => {
  const r = decide(OPTS, { states: ['elder'], mode: 'bike' });
  assert.equal(r.best.id, 'bike');
  assert.match(r.reason, /照你說的選「YouBike」.*帶長輩要多注意安全/);
  assert.ok(!r.excluded.some((e) => e.id === 'bike'));
  const a = decide(OPTS, { states: ['elder', 'lessWalk'] }), b = decide(OPTS, { states: ['elder'] });
  assert.deepEqual(a.weights, b.weights, 'elder 已包含少走路');
  const short = decide(OPTS.filter((o) => ['walk', 'bike', 'ridehail'].includes(o.role)), { states: ['mobility'], avoid: ['ridehail'] });
  assert.equal(short.best, null);
  assert.match(short.reason, /無障礙計程車/);
});

test('討論串第一句：帶長輩說會避開 YouBike；行動不便說避開 YouBike 和長距離步行', async () => {
  const { judgeNote } = await import('../core/agent/impact.js');
  assert.match(judgeNote({ intent: 'trip', states: ['elder'] }), /^你帶著長輩，我會避開YouBike，我先看天氣/);
  assert.match(judgeNote({ intent: 'trip', states: ['mobility'] }), /我會避開YouBike和長距離步行/);
  assert.doesNotMatch(judgeNote({ intent: 'trip', states: ['rush'] }), /避開/);
});

test('出門建議：最多 3 點；帶小孩時空品針對小孩', () => {
  const a = outingAdvice({ weather: { raining: true, tempC: 34 }, air: { aqi: 160, status: '不健康' }, states: [] });
  assert.ok(a.length <= 3);
  assert.match(outingAdvice({ air: { aqi: 70, status: '普通' }, states: ['kids'] })[0], /小孩比較敏感/);
});

test('深夜（S10）：00:00～05:00 公車不列入並說收班；23:00 後提醒接近末班；示範時鐘只在示範模式有效', async () => {
  const { createServices } = await import('../core/index.js');
  const { planTrip } = await import('../core/services/trip.js');
  const svc = createServices({ forceMock: true });
  const from = { name: '西門町', lat: 25.0421, lon: 121.5081 }, to = { name: '台北101', lat: 25.0339, lon: 121.5645 };
  const night = await planTrip(svc, { from, to, departAt: '2026-11-21T00:30' });
  assert.ok(!night.options.some((o) => o.role === 'bus'));
  assert.match(night.skipped.find((x) => x.role === 'bus').why, /深夜多數公車已收班/);
  const late = await planTrip(svc, { from, to, departAt: '2026-11-21T23:20' });
  assert.ok(late.options.find((o) => o.role === 'bus')?.lastBus);
  const day = await planTrip(svc, { from, to, departAt: '2026-11-21T10:00' });
  assert.ok(!day.options.find((o) => o.role === 'bus')?.lastBus);
  const { demoClock } = await import('../server/agent.js');
  const t = demoClock({ DEMO_MODE: '1', DEMO_CLOCK: '23:30' })();
  assert.equal(new Date(t + 8 * 3600e3).toISOString().slice(11, 16), '23:30');
  const real = demoClock({ DEMO_CLOCK: '23:30' })();
  assert.ok(Math.abs(real - Date.now()) < 1000, '不是示範模式：用真的時間');
});

test('深夜：真實資料看到站狀態（末班已過才不列入）；明天的行程不當成深夜；公車最佳時說可能是末班', async () => {
  const { createServices } = await import('../core/index.js');
  const { planTrip } = await import('../core/services/trip.js');
  const { tripDepartAt, parseIntent } = await import('../core/agent/demo-intent.js');
  const svc = createServices({ forceMock: true });
  const from = { name: '西門町', lat: 25.0421, lon: 121.5081 }, to = { name: '台北101', lat: 25.0339, lon: 121.5645 };
  const live = { ...svc, mode: 'live', bus: { ...svc.bus, directTrips: async (a) => (await svc.bus.directTrips(a)).map((t) => ({ ...t, board: { ...t.board, status: 3 } })) } };
  const r = await planTrip(live, { from, to, departAt: '2026-11-21T14:00' });
  assert.match(r.skipped.find((x) => x.role === 'bus').why, /末班已過/);
  const okLive = await planTrip({ ...svc, mode: 'live' }, { from, to, departAt: '2026-11-21T00:30' });
  assert.ok(okLive.options.some((o) => o.role === 'bus'), '真實資料不只看時間');
  const at0030 = Date.parse('2026-11-21T00:30:00+08:00');
  assert.equal(tripDepartAt(parseIntent('明天早上回板橋'), at0030), '2026-11-22T06:00');
  assert.equal(tripDepartAt(parseIntent('回板橋'), at0030), '2026-11-21T00:30');
  for (const role of ['bike', 'ridehail']) assert.ok((await planTrip(svc, { from, to, departAt: '2026-11-21T00:30' })).options.some((o) => o.role === role), `${role} 深夜照列`);
});

test('decision 事件帶 skipped（決策圖畫出沒列入的方式與原因）；「重來」送 context_reset', async () => {
  const { runDemo } = await import('../core/agent/run.js');
  const { createServices } = await import('../core/index.js');
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從西門町去台北101' }] }, (e) => es.push(e), { now: Date.parse('2026-11-21T00:30:00+08:00') });
  const d = es.find((e) => e.type === 'decision');
  assert.ok(d.skipped?.some((x) => x.role === 'bus' && /收班/.test(x.why)));
  const r = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從西門町去台北101' }, { role: 'assistant', content: '好' }, { role: 'user', content: '重來' }] }, (e) => r.push(e));
  assert.ok(r.some((e) => e.type === 'context_reset'));
});
