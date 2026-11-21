// 個人化：記住常選的交通方式（只在手機、只記方式與時間、上限 50 次、60 天半衰期）；不默默套用——問過、說「好」才加分（ADR-0016）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// 瀏覽器的 window 事件（卡片、到站提醒送 abang:choice）
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const H = await import('../public/js/habits.js');
const { questionHash, questionAskedRecently, markQuestion, QUESTION_MAX } = H;
const { HABITS_KEY, noteChoice, noteDecision, habitShare, habitCandidate, habitRequest, habitSummary, habitWhy, setHabitsOn, habitsOn, clearHabits, applyStore, markAsked, revokeHabit, revokeUsual, usualStates, HABIT_MAX_PICKS, HABIT_SAME_MS } = H;
beforeEach(() => mem.clear());

const DAY = 864e5, T0 = Date.parse('2026-11-21T08:00:00+08:00');
/** 每次隔 1 小時記一次（避開 30 分鐘內同一方式只算一次） */
const pick = (roles, start = T0) => roles.forEach((m, i) => noteChoice(m, start + i * 3600e3));
const SIX = ['metro', 'metro', 'metro', 'metro', 'metro', 'metro'];

test('記錄只記不用：選再多次，沒說「好」之前不送比例、只送「可以問」的候選', () => {
  pick(['metro', 'metro', 'bus', 'metro']);
  assert.equal(habitCandidate(T0 + DAY), null, '不到 5 次：不問');
  pick(['metro', 'metro'], T0 + 5 * 3600e3);
  assert.equal(habitShare(T0 + DAY), null, '未確認：不加分');
  assert.deepEqual(habitCandidate(T0 + DAY), { mode: 'metro', count: 5 });
  assert.deepEqual(habitRequest(T0 + DAY), { habitAsk: { mode: 'metro', count: 5 } });
});

test('比例不到 6 成不問（混著搭）', () => {
  pick(['metro', 'bus', 'metro', 'bus', 'metro', 'bus', 'metro', 'bus', 'metro', 'bus']);
  assert.equal(habitCandidate(T0 + DAY), null);
});

test('說「好」→ 送比例（只有同意的方式）、不再問；撤銷 → 不送、90 天內不問', () => {
  pick([...SIX, 'bus']);
  const r = applyStore('habit:yes:metro', T0 + DAY);
  assert.match(r.say, /優先推捷運/);
  assert.deepEqual(Object.keys(r.habit), ['metro'], '公車沒同意：不送');
  assert.ok(r.habit.metro > 0.8);
  assert.equal(habitCandidate(T0 + DAY), null);
  revokeHabit('metro', T0 + 2 * DAY);
  assert.equal(habitShare(T0 + 2 * DAY), null);
  assert.equal(habitCandidate(T0 + 30 * DAY), null, '撤銷後 90 天內不問');
  assert.equal(habitCandidate(T0 + 93 * DAY)?.mode, 'metro', '90 天後可以再問');
});

test('說「不用」→ 90 天內不問；問了沒回答 → 3 天內不再問', () => {
  pick(SIX);
  applyStore('habit:no:metro', T0 + DAY);
  assert.equal(habitShare(T0 + DAY), null);
  assert.equal(habitCandidate(T0 + 10 * DAY), null);
  mem.clear();
  pick(SIX);
  markAsked('metro', T0 + DAY);
  assert.equal(habitCandidate(T0 + 2 * DAY), null);
  assert.equal(habitCandidate(T0 + 5 * DAY).mode, 'metro');
});

test('常叫車：問原因。趕時間／常帶東西／不想走路 → 說過的預設狀況；喜歡叫車 → 叫車加分；不一定 → 不加分、不再問', () => {
  const rides = ['ridehail', 'ridehail', 'ridehail', 'ridehail', 'ridehail'];
  pick(rides);
  assert.equal(habitCandidate(T0 + DAY).mode, 'ridehail');
  const r = applyStore('ride:luggage', T0 + DAY);
  assert.deepEqual([r.state, usualStates()], [undefined, ['luggage']], '存起來但不自動套用（會改變建議時先問）');
  assert.match(r.say, /常帶東西/);
  assert.equal(habitShare(T0 + DAY), null, '說了原因：叫車本身不加分');
  assert.equal(habitCandidate(T0 + 200 * DAY), null, '答過就不再問');
  assert.deepEqual(habitRequest(T0 + DAY), { usual: ['luggage'] });
  revokeUsual('luggage');
  assert.deepEqual(usualStates(), []);

  mem.clear(); pick(rides);
  assert.deepEqual(Object.keys(applyStore('ride:love', T0 + DAY).habit), ['ridehail']);
  mem.clear(); pick(rides);
  const d = applyStore('ride:depends', T0 + DAY);
  assert.equal(d.habit, undefined);
  assert.equal(habitShare(T0 + DAY), null);
  assert.equal(habitCandidate(T0 + 365 * DAY), null);
  assert.equal(applyStore('ride:rocket').ok, false, '不認得的答案不存');
  assert.equal(applyStore('habit:yes:home').ok, false);
});

test('只記交通方式與時間：不認得的方式不記、額外的資料（地點）不會被存', () => {
  assert.equal(noteChoice('spaceship', T0), false);
  noteChoice('metro', T0);
  globalThis.dispatchEvent(new CustomEvent('abang:choice', { detail: { role: 'bus', lat: 25.04, lon: 121.5, stop: '台北車站' } }));
  const raw = JSON.parse(mem.get(HABITS_KEY));
  assert.deepEqual(raw.picks.map((p) => p.m), ['metro', 'bus'], '卡片送來的事件也記（只記方式）');
  assert.ok(raw.picks.every((p) => Object.keys(p).sort().join() === 'm,t'), mem.get(HABITS_KEY));
  assert.doesNotMatch(mem.get(HABITS_KEY), /25\.04|121\.5|台北車站/);
});

test('上限最近 50 次；30 分鐘內同一種方式只算一次', () => {
  for (let i = 0; i < 70; i++) noteChoice(i < 20 ? 'bus' : 'metro', T0 + i * 3600e3);
  const raw = JSON.parse(mem.get(HABITS_KEY));
  assert.equal(raw.picks.length, HABIT_MAX_PICKS);
  assert.ok(raw.picks.every((p) => p.m === 'metro'), '最舊的 20 次公車被擠掉');
  mem.clear();
  assert.equal(noteChoice('metro', T0), true);
  assert.equal(noteChoice('metro', T0 + HABIT_SAME_MS - 1), false, '同一趟按導航又按叫車：不重複算');
  assert.equal(noteChoice('bus', T0 + 60e3), true, '不同方式照記');
  assert.equal(noteChoice('metro', T0 + HABIT_SAME_MS + 1), true);
});

test('時間衰減：60 天前選的只算半次；180 天以前的不算', () => {
  pick(['bus', 'bus', 'bus', 'bus', 'bus'], T0 - 60 * DAY);
  pick(['metro', 'metro', 'metro', 'metro', 'metro'], T0);
  applyStore('habit:yes:metro', T0); applyStore('habit:yes:bus', T0);
  const h = habitShare(T0 + 5 * 3600e3);
  assert.ok(Math.abs(h.metro - 0.66) < 0.015 && Math.abs(h.bus - 0.33) < 0.015, JSON.stringify(h));
  assert.ok(Object.values(h).reduce((a, b) => a + b, 0) <= 1);
  mem.clear();
  pick(['bus', 'bus', 'bus', 'bus', 'bus'], T0 - 200 * DAY);
  assert.equal(habitCandidate(T0), null, '太舊的不算');
});

test('關閉：不記、不問、不加分；清除後關掉的仍是關的', () => {
  pick(SIX);
  applyStore('habit:yes:metro', T0 + DAY);
  setHabitsOn(false);
  assert.equal(habitsOn(), false);
  assert.equal(habitShare(T0 + DAY), null);
  assert.equal(habitCandidate(T0 + DAY), null);
  assert.equal(noteChoice('bus', T0 + 2 * DAY), false);
  clearHabits();
  assert.equal(habitsOn(), false, '清除不會偷偷又打開');
  assert.equal(habitSummary(T0).total, 0);
  assert.deepEqual(habitSummary(T0).confirmed, [], '同意也一起清');
  setHabitsOn(true);
  clearHabits();
  assert.equal(mem.has(HABITS_KEY), false, '開著時清除＝整個鍵刪掉');
  assert.equal(habitsOn(), true, '預設開（只記不用）');
});

test('決策事件：指定方式且建議就是它才算選了', () => {
  const d = { mode: 'metro', best: 'm1', options: [{ id: 'm1', role: 'metro' }, { id: 'b1', role: 'bus' }] };
  assert.equal(noteDecision(d, T0), true);
  assert.equal(noteDecision({ ...d, mode: 'thsr' }, T0 + DAY), false);
  assert.equal(noteDecision({ ...d, mode: undefined }, T0 + DAY), false, '沒指定方式（阿幫推薦的）不算');
});

test('為什麼：最近 30 天選幾次', () => {
  pick(['metro', 'metro', 'metro', 'bus', 'metro', 'metro']);
  assert.equal(habitWhy('metro', T0 + DAY), '最近 30 天選捷運 5 次');
  assert.deepEqual(habitSummary(T0 + DAY).counts, { metro: 5, bus: 1 });
});

test('壞掉的資料不會讓 App 出錯：當作沒有紀錄、預設開', () => {
  mem.set(HABITS_KEY, '{not json');
  assert.equal(habitShare(T0), null);
  assert.equal(habitsOn(), true);
  mem.set(HABITS_KEY, JSON.stringify({ picks: [{ m: 'metro', t: 'x' }, { m: 'rocket', t: 1 }, null], confirmed: { home: 1 }, usual: ['sleepy'] }));
  assert.equal(habitSummary(T0).total, 0);
  assert.deepEqual([habitSummary(T0).confirmed, usualStates()], [[], []]);
});

test('關鍵問題：同一段起訖同一題 24 小時內不再問；只存雜湊（不存地點）、最多 50 筆', () => {
  const key = 'rush@25.04,121.51>25.03,121.56';
  assert.equal(questionAskedRecently(key, T0), false);
  markQuestion(key, T0);
  assert.equal(questionAskedRecently(key, T0 + 3600e3), true);
  assert.equal(questionAskedRecently('luggage@25.04,121.51>25.03,121.56', T0 + 3600e3), false, '不同題照問');
  assert.equal(questionAskedRecently('rush@25.05,121.52>25.03,121.56', T0 + 3600e3), false, '換地點照問');
  assert.equal(questionAskedRecently(key, T0 + 24 * 3600e3 + 1), false, '隔天再問');
  assert.doesNotMatch(mem.get(HABITS_KEY), /25\.0|121\./, '不存座標');
  assert.match(questionHash(key, 'aa'), /^[0-9a-f]{8}$/);
  // 有鹽：拿家、公司的座標去試，算不出手機上存的雜湊（每支手機的鹽不同，清除時一起清）
  const raw = JSON.parse(mem.get(HABITS_KEY));
  assert.match(raw.salt, /^[0-9a-f]{16}$/);
  assert.ok(!(questionHash(key) in raw.seenQ), '沒有鹽的雜湊對不上');
  assert.ok(questionHash(key, raw.salt) in raw.seenQ);
  assert.notEqual(questionHash(key, 'a'), questionHash(key, 'b'));
  for (let i = 0; i < 70; i++) markQuestion(`k${i}`, T0 + i);
  assert.equal(Object.keys(JSON.parse(mem.get(HABITS_KEY)).seenQ).length, QUESTION_MAX);
  markQuestion('new', T0 + 25 * 3600e3);
  assert.equal(Object.keys(JSON.parse(mem.get(HABITS_KEY)).seenQ).length, 1, '過期的清掉');
  const salt = JSON.parse(mem.get(HABITS_KEY)).salt;
  clearHabits();
  markQuestion(key, T0);
  assert.notEqual(JSON.parse(mem.get(HABITS_KEY)).salt, salt, '清除後換新的鹽');
});
