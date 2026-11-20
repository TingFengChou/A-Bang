// A1b 第二批狀態（2026-11-21）：多人同行（叫車每人分攤）、可能下雨（帶傘）、時間很緊
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, shareRide, RAIN_SOON_POP } from '../core/services/trip.js';
import { createServices } from '../core/index.js';
import { parseIntent, partyOf, demoSummary } from '../core/agent/demo-intent.js';
import { groundedPrefs } from '../core/agent/model-loop.js';

const TPE = { name: '臺北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const NOW = Date.parse('2026-11-18T09:00:00+08:00');

test('人數：中文、阿拉伯數字、一家幾口、英文；1 人與「人行道」不算', () => {
  for (const [q, n] of [['我們4個人去台北101', 4], ['三個人去西門町', 3], ['一家五口去西門町', 5], ['我們兩位', 2], ['we are 4 people', 4], ['3 of us to Ximending', 3], ['party of six', 6]]) assert.equal(partyOf(q), n, q);
  for (const q of ['一個人去台北101', '人行道', '台北101', '工人', '三人行']) assert.equal(partyOf(q), null, q);
  const it = parseIntent('三個人去西門町');
  assert.deepEqual([it.intent, it.to, it.party], ['trip', '西門町', 3]);
  // 接著改：上一輪的行程沿用，只加人數
  const f = parseIntent('我們4個人', { history: [{ role: 'user', content: '從臺北車站去台北101' }, { role: 'assistant', content: '建議捷運。' }] });
  assert.deepEqual([f.intent, f.from, f.to, f.party, f.followUp], ['trip', '臺北車站', '台北101', 4, true]);
  assert.ok(f.changed.includes('party'));
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
  assert.ok(four.states.some((s) => s.key === 'group' && s.detail === '4 人'));
  assert.equal(four.party, 4);
  assert.ok(four.tips.some((t) => /4 人叫車每人約 \d+ 元（全部約 \d+ 元）/.test(t)));
  const busFour = four.options.find((o) => o.role === 'bus');
  const busOne = one.options.find((o) => o.role === 'bus');
  if (busOne) assert.equal(busFour.cost, busOne.cost, '公車本來就是每人');
});

test('可能下雨：現在沒下、3 小時降雨機率 ≥ 60% → 自動狀態＋帶傘提醒；正在下雨不重複', async () => {
  const svc = createServices({ forceMock: true });
  const now0 = svc.weather.now;
  svc.weather.now = async (p) => ({ ...(await now0(p)), raining: false, pop3h: RAIN_SOON_POP + 10 });
  const r = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.ok(r.states.some((s) => s.key === 'rainSoon' && /降雨機率 70%/.test(s.detail)));
  assert.ok(r.tips.some((t) => /記得帶傘/.test(t)));
  svc.weather.now = async (p) => ({ ...(await now0(p)), raining: true, pop3h: 90 });
  const wet = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.ok(!wet.states.some((s) => s.key === 'rainSoon'), '已經在下雨用 rain');
  assert.ok(wet.states.some((s) => s.key === 'rain'));
});

test('時間很緊：最佳方案只早到 10 分內 → tight 與提醒；來得及很多不提醒', async () => {
  const svc = createServices({ forceMock: true });
  const base = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', now: NOW });
  const best = base.options.find((o) => o.id === base.best);
  const [h, m] = best.arriveAt.split(':').map(Number);
  const by = (add) => { const t = h * 60 + m + add; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const tight = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', prefs: { arriveBy: by(3) }, now: NOW });
  if (tight.best === base.best) {
    assert.equal(tight.tight.slackMin, 3);
    assert.ok(tight.tips.some((t) => /時間很緊.*早 3 分/.test(t)));
  } else assert.ok(tight.tight == null || tight.tight.slackMin < 10);
  const easy = await planTrip(svc, { from: TPE, to: T101, departAt: '09:00', prefs: { arriveBy: by(60) }, now: NOW });
  assert.equal(easy.tight, undefined);
});

test('總結帶提醒；模型模式人數只採使用者說的', async () => {
  const svc = createServices({ forceMock: true });
  const data = await planTrip(svc, { from: TPE, to: T101, prefs: { party: 4 }, now: NOW });
  const text = demoSummary({ intent: 'trip', from: '臺北車站', to: '台北101', places: [], states: [], party: 4 }, { plan_trip: [{ data }] });
  assert.match(text, /4 人叫車每人約/);
  assert.equal(groundedPrefs({ party: 6 }, { party: 4 }).party, 4, '模型改人數 → 用使用者說的');
  assert.equal(groundedPrefs({ party: 6 }, {}).party, undefined, '使用者沒說人數 → 模型不能自己加');
  const en = demoSummary({ intent: 'trip', lang: 'en', from: '臺北車站', to: '台北101', places: [], states: [], party: 4 }, { plan_trip: [{ data: { ...data, best: 'ridehail' } }] });
  assert.match(en, /per person \(4 people\)/);
});
