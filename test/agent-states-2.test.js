// A1b 第二批狀態（2026-11-21）：多人同行（叫車每人分攤）、可能下雨（帶傘）、時間很緊
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, shareRide, RAIN_SOON_POP } from '../core/services/trip.js';
import { createServices } from '../core/index.js';
import { parseIntent, partyOf } from '../core/agent/demo-intent.js';
import { demoSummary } from '../core/agent/demo-summary.js';
import { groundedPrefs, prefetchCalls, callKey } from '../core/agent/model-loop.js';
import { callTool } from '../core/tools/index.js';

const TPE = { name: '臺北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const NOW = Date.parse('2026-11-18T09:00:00+08:00');

test('人數：中文、阿拉伯數字、一家幾口、英文；1 人與「人行道」不算', () => {
  for (const [q, n] of [['我們4個人去台北101', 4], ['三個人去西門町', 3], ['一家五口去西門町', 5], ['我們兩位', 2], ['we are 4 people', 4], ['3 of us to Ximending', 3], ['party of six', 6],
    ['我們十二個人', 12], ['十五人', 15], ['二十人', 20], ['我們兩個', 2], ['我跟我媽兩個去台北101', 2], ['2大1小', 3], ['兩大兩小', 4], ['4位大人2位小孩', 6], ['只有我一個人', 1], ['just me', 1]]) assert.equal(partyOf(q), n, q);
  for (const q of ['人行道', '台北101', '工人', '三人行', '2人座', '三人份', '4人份的便當', '2人房', '第3個人', '前3人', '10人以上', '三人座沙發']) assert.equal(partyOf(q), null, q);
  const it = parseIntent('三個人去西門町');
  assert.deepEqual([it.intent, it.to, it.party], ['trip', '西門町', 3]);
  // 接著改：上一輪的行程沿用，只加人數
  const f = parseIntent('我們4個人', { history: [{ role: 'user', content: '從臺北車站去台北101' }, { role: 'assistant', content: '建議捷運。' }] });
  assert.deepEqual([f.intent, f.from, f.to, f.party, f.followUp], ['trip', '臺北車站', '台北101', 4, true]);
  assert.ok(f.changed.includes('party'));
  // 說回一個人：人數清成 1（不再分攤）
  const solo = parseIntent('只有我一個人', { history: [{ role: 'user', content: '我們4個人從臺北車站去台北101' }, { role: 'assistant', content: '建議叫車。' }] });
  assert.deepEqual([solo.intent, solo.to, solo.party], ['trip', '台北101', 1]);
});

test('叫車每人分攤：4 人一輛、5 人兩輛；金額四捨五入到 5 元', () => {
  const o = { id: 'ridehail', role: 'ridehail', cost: 260, costRange: [220, 300], notes: [] };
  const a = shareRide(o, 4);
  assert.deepEqual([a.cost, a.costRange, a.share], [65, [55, 75], { party: 4, cars: 1, total: 260 }]);
  const b = shareRide(o, 5);
  assert.deepEqual([b.share.cars, b.cost], [2, 105]);
  assert.match(b.notes.at(-1), /5 人、2 輛車分攤，每人約 105 元/);
});

test('plan_trip：party → 多人同行狀態、叫車用每人比較、提醒寫明分攤', async () => {
  const svc = createServices({ forceMock: true });
  const one = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  const four = await planTrip(svc, { from: TPE, to: T101, prefs: { party: 4 }, now: NOW });
  const r1 = one.options.find((o) => o.role === 'ridehail');
  const r4 = four.options.find((o) => o.role === 'ridehail');
  assert.ok(r4.cost < r1.cost, '每人分攤比一人付便宜');
  assert.equal(r4.share.total, r1.cost);
  assert.ok(four.states.some((s) => s.key === 'group' && s.source === 'user' && s.detail === '4 人'), '人數是使用者說的');
  assert.equal(four.party, 4);
  assert.ok(four.tips.some((t) => t.kind === 'cost' && /4 人叫車共約 \d+ 元，每人分攤約 \d+ 元/.test(t.text)));
  // 不要叫車、指定坐公車：不說叫車分攤
  for (const prefs of [{ party: 4, avoid: ['ridehail'] }, { party: 4, mode: 'bus' }]) {
    const r = await planTrip(svc, { from: TPE, to: T101, prefs, now: NOW });
    assert.ok(!(r.tips || []).some((t) => t.kind === 'cost'), JSON.stringify(prefs));
  }
  const one1 = await planTrip(svc, { from: TPE, to: T101, prefs: { party: 1 }, now: NOW });
  assert.ok(!one1.states.some((s) => s.key === 'group') && !one1.options.some((o) => o.share), '1 人不分攤');
  const busFour = four.options.find((o) => o.role === 'bus');
  const busOne = one.options.find((o) => o.role === 'bus');
  if (busOne) assert.equal(busFour.cost, busOne.cost, '公車本來就是每人');
});

test('可能下雨：現在沒下、3 小時降雨機率 ≥ 60% → 自動狀態＋帶傘提醒；正在下雨不重複', async () => {
  const svc = createServices({ forceMock: true });
  const now0 = svc.weather.now;
  // 真實服務：60～69% 沒下雨＝可能下雨；≥ 70% 依 weather.js 已算「下雨」（仍提醒帶傘）；雨量站量到雨就不必提醒
  svc.weather.now = async (p) => ({ ...(await now0(p)), raining: false, rainMm1h: 0, pop3h: RAIN_SOON_POP + 5 });
  const r = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.ok(r.states.some((s) => s.key === 'rainSoon' && /降雨機率 65%/.test(s.detail)));
  assert.ok(r.tips.some((t) => t.kind === 'rain' && /記得帶傘/.test(t.text)));
  svc.weather.now = async (p) => ({ ...(await now0(p)), raining: true, rainMm1h: 0, pop3h: 80 });
  const likely = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.ok(likely.states.some((s) => s.key === 'rain') && !likely.states.some((s) => s.key === 'rainSoon'));
  assert.ok(likely.tips.some((t) => t.kind === 'rain'), '機率高但還沒下：仍提醒帶傘');
  svc.weather.now = async (p) => ({ ...(await now0(p)), raining: true, rainMm1h: 3, pop3h: 90 });
  const wet = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.ok(!(wet.tips || []).some((t) => t.kind === 'rain'), '正在下雨不必提醒帶傘');
});

test('時間很緊：最佳方案只早到 10 分內 → tight 與提醒；來得及很多不提醒', async () => {
  const svc = createServices({ forceMock: true });
  const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  // 指定坐捷運，最佳方案固定，才量得準（審查：原本換了最佳方案，斷言沒跑到）
  const base = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', prefs: { mode: 'metro' }, now: NOW });
  const best = base.options.find((o) => o.id === base.best);
  const tight = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', prefs: { mode: 'metro', arriveBy: hhmm(best.arriveMin + 3) }, now: NOW });
  assert.equal(tight.best, base.best);
  assert.deepEqual(tight.tight, { slackMin: 3 });
  assert.ok(tight.tips.some((t) => t.kind === 'tight' && /早到 3 分鐘，建議現在就出發/.test(t.text)));
  const easy = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', prefs: { mode: 'metro', arriveBy: hhmm(best.arriveMin + 60) }, now: NOW });
  assert.equal(easy.tight, undefined);
});

test('總結帶提醒；模型模式人數只採使用者說的', async () => {
  const svc = createServices({ forceMock: true });
  const data = await planTrip(svc, { from: TPE, to: T101, prefs: { party: 4 }, now: NOW });
  const text = demoSummary({ intent: 'trip', from: '臺北車站', to: '台北101', places: [], states: [], party: 4 }, { plan_trip: [{ data }] });
  assert.doesNotMatch(text, /每人分攤/, '分攤金額在卡片上，泡泡不重複');
  const tool = await callTool(svc, 'plan_trip', { from: '臺北車站', to: '台北101', prefs: { party: 4 } });
  assert.match(tool.text, /提醒：4 人叫車共約/, '模型看得到提醒');
  await assert.rejects(callTool(svc, 'plan_trip', { from: '臺北車站', to: '台北101', prefs: { states: ['group'] } }), /格式|states/, '自動狀態不能直接指定');
  // 模型模式：預先查詢帶人數；比對鍵含人數（沒帶人數的呼叫不沿用有人數的結果）
  const [pre] = prefetchCalls({ intent: 'trip', from: '臺北車站', to: '台北101', places: [], states: [], party: 4 }, null, null);
  assert.equal(pre.args.prefs.party, 4);
  assert.notEqual(callKey('plan_trip', { from: '臺北車站', to: '台北101', prefs: { party: 4 } }), callKey('plan_trip', { from: '臺北車站', to: '台北101' }));
  assert.equal(groundedPrefs({ party: 6 }, { party: 4 }).party, 4, '模型改人數 → 用使用者說的');
  assert.equal(groundedPrefs({ party: 6 }, {}).party, undefined, '使用者沒說人數 → 模型不能自己加');
  const en = demoSummary({ intent: 'trip', lang: 'en', from: '臺北車站', to: '台北101', places: [], states: [], party: 4 }, { plan_trip: [{ data: { ...data, best: 'ridehail' } }] });
  assert.match(en, /per person \(4 people\)/);
});
