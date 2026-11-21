// 個人化：記住常選的交通方式（只在手機、只記方式與時間、上限 50 次、60 天半衰期、5 次才生效）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// 瀏覽器的 window 事件（卡片、到站提醒送 abang:choice）
const bus = new EventTarget();
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const H = await import('../public/js/habits.js');
const { HABITS_KEY, noteChoice, noteDecision, habitShare, habitSummary, habitWhy, setHabitsOn, habitsOn, clearHabits, HABIT_MAX_PICKS, HABIT_MIN_PICKS, HABIT_SAME_MS } = H;
beforeEach(() => mem.clear());

const DAY = 864e5, T0 = Date.parse('2026-11-21T08:00:00+08:00');
/** 每次隔 1 小時記一次（避開 30 分鐘內同一方式只算一次） */
const pick = (roles, start = T0) => roles.forEach((m, i) => noteChoice(m, start + i * 3600e3));

test('選不到 5 次不生效；5 次以上回比例（小數 2 位、總和 ≤ 1）', () => {
  pick(['metro', 'metro', 'bus', 'metro']);
  assert.equal(habitShare(T0 + DAY), null, '4 次：不生效');
  pick(['metro'], T0 + 5 * 3600e3);
  const h = habitShare(T0 + DAY);
  assert.equal(HABIT_MIN_PICKS, 5);
  assert.deepEqual(Object.keys(h), ['metro', 'bus']);
  assert.ok(Math.abs(h.metro - 0.8) < 0.015 && Math.abs(h.bus - 0.2) < 0.015, JSON.stringify(h));
  assert.ok(Object.values(h).reduce((a, b) => a + b, 0) <= 1);
});

test('只記交通方式與時間：不認得的方式不記、額外的資料（地點）不會被存', () => {
  assert.equal(noteChoice('spaceship', T0), false);
  noteChoice('metro', T0);
  // 就算有人把座標塞進事件，也只存 { m, t }
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
  // 5 次公車在 60 天前、5 次捷運是今天 → 捷運 2/3、公車 1/3
  pick(['bus', 'bus', 'bus', 'bus', 'bus'], T0 - 60 * DAY);
  pick(['metro', 'metro', 'metro', 'metro', 'metro'], T0);
  const h = habitShare(T0 + 5 * 3600e3);
  assert.ok(Math.abs(h.metro - 0.66) < 0.015 && Math.abs(h.bus - 0.33) < 0.015, JSON.stringify(h));
  mem.clear();
  pick(['bus', 'bus', 'bus', 'bus', 'bus'], T0 - 200 * DAY);
  assert.equal(habitShare(T0), null, '太舊的不算（也不夠 5 次）');
});

test('關閉：不記也不送；清除後關掉的仍是關的', () => {
  pick(['metro', 'metro', 'metro', 'metro', 'metro']);
  assert.ok(habitShare(T0 + DAY));
  setHabitsOn(false);
  assert.equal(habitsOn(), false);
  assert.equal(habitShare(T0 + DAY), null, '關閉時不送比例');
  assert.equal(noteChoice('bus', T0 + 2 * DAY), false, '關閉時不記');
  clearHabits();
  assert.equal(habitsOn(), false, '清除不會偷偷又打開');
  assert.equal(habitSummary(T0).total, 0);
  setHabitsOn(true);
  clearHabits();
  assert.equal(mem.has(HABITS_KEY), false, '開著時清除＝整個鍵刪掉');
  assert.equal(habitsOn(), true, '預設開');
});

test('決策事件：指定方式且建議就是它才算選了（指定的方式沒有可行方案不算）', () => {
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
  mem.set(HABITS_KEY, JSON.stringify({ picks: [{ m: 'metro', t: 'x' }, { m: 'rocket', t: 1 }, null] }));
  assert.equal(habitSummary(T0).total, 0);
});
