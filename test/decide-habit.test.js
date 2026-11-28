// 個人化（ADR-0010 2026-11-21 習慣）：常選的方式小幅加分（最多 8 分）；明講的狀態、指定方式、不要的方式、抵達時間都優先；
// 不合理的方案（走路 100 分）不會因習慣勝出；plan_trip／REST 驗證；示範與模型模式都由程式帶入手機送來的比例
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, HABIT, habitBonus } from '../core/decide.js';
import { planTrip } from '../core/services/trip.js';
import { resolvePoint } from '../core/services/places.js';
import { createServices } from '../core/index.js';
import { callTool } from '../core/tools/index.js';
import { runDemo, validateRequest, withHabit, execTools } from '../core/agent/run.js';
import { runModel, groundedPrefs } from '../core/agent/model-loop.js';
import { getProfile } from '../core/agents/index.js';
import { validate } from '../public/ui/cards/schema/validate.js';
import { readFile } from 'node:fs/promises';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');
const METRO = { metro: 1 };

async function trip(f, t, prefs = {}, demo = {}) {
  const svc = createServices({ forceMock: true, demo });
  const [from, to] = await Promise.all([resolvePoint(svc.places, f), resolvePoint(svc.places, t)]);
  const r = await planTrip(svc, { from, to, departAt: '09:00', prefs, now: NOW });
  return { ...r, roleOf: (id) => r.options.find((o) => o.id === id)?.role };
}

test('加分上限：常選比例 60% 以上加滿 8 分，比例越低加越少；比最快的慢太多不加', () => {
  assert.equal(HABIT.max, 0.08);
  const o = { role: 'metro', minutes: 30 };
  assert.equal(habitBonus(o, { metro: 0.9 }, 25), 0.08);
  assert.ok(Math.abs(habitBonus(o, { metro: 0.3 }, 25) - 0.04) < 1e-9);
  assert.equal(habitBonus(o, { bus: 1 }, 25), 0);
  assert.equal(habitBonus({ role: 'walk', minutes: 102 }, { walk: 1 }, 27), 0, '走路 102 分（最快 27 分）：不加分');
  assert.ok(habitBonus({ role: 'bike', minutes: 46 }, { bike: 1 }, 27) > 0, '46 分（2 倍內）照加');
});

test('西門町 → 台北101：沒有習慣時公車第一；常搭捷運時捷運勝出，理由說「您想優先搭捷運」', async () => {
  const base = await trip('西門町', '台北101');
  assert.equal(base.roleOf(base.best), 'bus');
  assert.equal(base.habit, undefined);
  const r = await trip('西門町', '台北101', { habit: METRO });
  assert.equal(r.roleOf(r.best), 'metro', r.ranking.reason);
  assert.match(r.ranking.reason, /^選「捷運.*」：[你您]想優先搭捷運/);
  assert.deepEqual([r.habit, r.habitOn], [METRO, true]);
  const m = r.ranking.ranked.find((x) => r.roleOf(x.id) === 'metro');
  assert.ok(Math.abs(m.breakdown.habit - HABIT.max) < 1e-9, '明細列出習慣加分');
  const schema = JSON.parse(await readFile(new URL('../public/ui/cards/schema/trip.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(schema, r), [], '卡片契約');
});

test('台北車站 → 台北101：本來就推捷運——不是因為偏好，理由不說「您想優先搭捷運」（只有偏好讓第一名換掉時才說）', async () => {
  const r = await trip('台北車站', '台北101', { habit: METRO });
  assert.match(r.ranking.reason, /^選「捷運 淡水信義線」：省 \d+ 元/);
  assert.doesNotMatch(r.ranking.reason, /[你您]想優先/);
  const m = r.ranking.ranked.find((x) => r.ranking.ranked[0].id === x.id);
  assert.ok(m.breakdown.habit > 0, '加分照樣算（只是理由不說）');
  const { habitFlipped } = await import('../core/decide.js');
  assert.equal(habitFlipped(m, r.ranking.ranked), false);
  const x = await trip('西門町', '台北101', { habit: METRO });
  assert.equal(habitFlipped(x.ranking.ranked[0], x.ranking.ranked), true);
});

test('差距大時不翻盤：常叫車，台北到高雄仍推台鐵；走路 100 分不會因習慣勝出', async () => {
  const far = await trip('台北車站', '高雄車站', { habit: { ridehail: 1 } });
  assert.equal(far.roleOf(far.best), 'tra');
  assert.doesNotMatch(far.ranking.reason, /[你您]常/);
  const walk = await trip('西門町', '台北101', { habit: { walk: 1 } });
  assert.notEqual(walk.roleOf(walk.best), 'walk');
  const w = walk.ranking.ranked.find((x) => walk.roleOf(x.id) === 'walk');
  assert.equal(w.breakdown.habit, undefined, '走路 102 分：不加分');
  assert.equal(walk.roleOf(walk.ranking.ranked.at(-1).id), 'walk');
});

test('使用者明講狀態時以狀態為準（習慣不加分）；自動判斷的狀態（下雨）不擋習慣', async () => {
  const lug = await trip('西門町', '台北101', { states: ['luggage'], habit: METRO });
  const lug0 = await trip('西門町', '台北101', { states: ['luggage'] });
  assert.equal(lug.roleOf(lug.best), lug0.roleOf(lug0.best));
  assert.equal(lug.ranking.reason, lug0.ranking.reason);
  assert.equal(lug.habitOn, false);
  assert.ok(lug.ranking.ranked.every((x) => x.breakdown.habit === undefined));
  const rain = await trip('西門町', '台北101', { habit: METRO }, { weather: 'rain' });
  assert.equal(rain.habitOn, true, '自動判斷的下雨不算您說的');
});

test('指定方式（mode）、不要的方式（avoid）、抵達時間（arriveBy）優先於習慣', async () => {
  const mode = await trip('西門町', '台北101', { mode: 'bus', habit: METRO });
  assert.equal(mode.roleOf(mode.best), 'bus');
  assert.match(mode.ranking.reason, /^照[你您]說的選「公車/);
  const avoid = await trip('西門町', '台北101', { avoid: ['metro'], habit: METRO });
  assert.notEqual(avoid.roleOf(avoid.best), 'metro');
  assert.ok(avoid.ranking.excluded.some((e) => avoid.roleOf(e.id) === 'metro'));
  // 純函式：會遲到的常選方式照樣排除
  const opts = [{ id: 'a', role: 'metro', name: '捷運', minutes: 30, arriveAt: '09:30', cost: 25 }, { id: 'b', role: 'ridehail', name: '叫車', minutes: 15, arriveAt: '09:15', cost: 250 }];
  const r = decide(opts, { arriveBy: '09:20', habit: METRO });
  assert.equal(r.best.id, 'b');
  assert.match(r.excluded[0].why, /超過/);
});

test('plan_trip 驗證：habit 鍵限定交通方式、值 0～1、總和 ≤ 1.01', async () => {
  const svc = createServices({ forceMock: true });
  const args = (habit) => ({ from: '西門町', to: '台北101', prefs: { habit } });
  for (const bad of [{ rocket: 0.5 }, { metro: 1.2 }, { metro: -0.1 }, { metro: 0.7, bus: 0.5 }, { metro: '0.6' }]) {
    await assert.rejects(callTool(svc, 'plan_trip', args(bad)), (e) => e.name === 'UserError', JSON.stringify(bad));
  }
  const ok = await callTool(svc, 'plan_trip', args({ metro: 0.6, bus: 0.4 }));
  assert.match(ok.text, /習慣（使用者同意過的常選方式，已小幅加分）：捷運 60%、公車 40%/);
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { habit: { metro: 2 } } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { habit: { home: 0.5 } } }), /請求格式錯誤/);
  assert.ok(validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { habit: { metro: 0.6, bus: 0.41 } } }), '四捨五入誤差 0.01 內可以');
});

test('習慣只採用手機送來的：模型帶的 habit 一律換掉或拿掉', () => {
  assert.deepEqual(withHabit({ from: 'a', to: 'b', prefs: { habit: { ridehail: 1 }, mode: 'bus' } }, METRO), { from: 'a', to: 'b', prefs: { mode: 'bus', habit: METRO } });
  assert.deepEqual(withHabit({ from: 'a', to: 'b', prefs: { habit: { ridehail: 1 } } }, null), { from: 'a', to: 'b' });
  assert.deepEqual(groundedPrefs({ habit: { ridehail: 1 } }, {}), {}, 'groundedPrefs 也不留模型的 habit');
});

test('示範模式：userState.habit 帶進 plan_trip、決策事件有 habit；沒送就沒有', async () => {
  const run = async (body) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從西門町去台北101' }], ...body }, (e) => es.push(e), { now: NOW }); return es; };
  const es = await run({ userState: { habit: METRO } });
  const r = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.deepEqual(r.args.prefs.habit, METRO);
  const d = es.find((e) => e.type === 'decision');
  assert.deepEqual([d.habit, d.habitOn], [METRO, true]);
  assert.match(d.reason, /[你您]想優先搭捷運/);
  assert.match(es.find((e) => e.type === 'text').delta, /捷運/);
  const none = await run({});
  assert.equal(none.find((e) => e.type === 'decision').habit, undefined);
});

test('模型模式：模型自己帶的 habit 不採用，用手機送來的', async () => {
  const provider = { mode: 'local', model: 'fake', start() { let n = 0; return { next: async () => (n++ === 0 ? { text: '', calls: [{ id: 'c1', name: 'plan_trip', input: { from: '西門町', to: '台北101', prefs: { habit: { ridehail: 1 } } } }], stop: 'tool', usage: { input: 1, output: 1 } } : { text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const es = [];
  await runModel(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從西門町去台北101' }], userState: { habit: METRO } }, (e) => es.push(e), { provider, judge: null, now: NOW });
  const calls = es.filter((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.deepEqual(c.args.prefs.habit, METRO, '預先查詢與模型呼叫都用手機的比例');
  assert.match(es.find((e) => e.type === 'decision').reason, /[你您]想優先搭捷運/);
});

test('execTools：手機沒送 habit 時，模型帶的也拿掉', async () => {
  const es = [];
  let n = 0;
  const out = await execTools(createServices({ forceMock: true }), [{ name: 'plan_trip', args: { from: '西門町', to: '台北101', prefs: { habit: { ridehail: 1 } } } }], (e) => es.push(e), { profile: getProfile(), nextId: () => `x${++n}` });
  assert.equal(out[0].ok, true);
  assert.equal(es.find((e) => e.type === 'tool_result').args.prefs, undefined);
  assert.equal(es.find((e) => e.type === 'decision').habit, undefined);
});
