// 行程中出狀況，主動給 B 方案（P1-5 v2，2026-11-28 Antigravity 第六輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bPlan, STALE_MIN } from '../core/b-plan.js';

const NOW = Date.parse('2026-11-30T10:00:00+08:00');
const opt = (id, role, name, minutes, arriveMin, extra = {}) => ({ id, role, name, minutes, arriveMin, arriveAt: `${String(Math.floor(arriveMin / 60)).padStart(2, '0')}:${String(arriveMin % 60).padStart(2, '0')}`, waitMin: 4, walkMin: 6, cost: 30, exposure: 0.1, effort: 0.2, delayRisk: 0, ...extra });
const TRIP = {
  to: { name: '台北101' }, best: 'bus-601', states: [],
  options: [
    opt('bus-601', 'bus', '公車 601', 32, 632, { cost: 15 }),
    opt('metro', 'metro', '捷運（板南線轉淡水信義線）', 32, 632, { cost: 25 }),
    opt('ridehail', 'ridehail', '叫車（Uber）', 27, 627, { cost: 300, walkMin: 0 }),
  ],
};
const at = (min) => NOW + min * 60e3;

test('公車一直不來：排除那條，用同一份 decide.js 重算；捷運說幾點到、比原本晚幾分；按鈕用最新資料重查（指定方式）', () => {
  const b = bPlan({ data: TRIP, at: NOW }, { routeName: '601', now: at(10) });
  assert.equal(b.role, 'metro');
  assert.equal(b.text, '601 一直沒來。可以改坐捷運（板南線轉淡水信義線），大約 10:42 到（比原本晚 10 分；依剛才查的資料）。');
  assert.equal(b.lateMin, 10);
  assert.deepEqual([b.label, b.ask], ['改坐捷運', '改坐捷運去台北101']);
  assert.match(bPlan({ data: TRIP, at: NOW }, { routeName: '601', now: at(2) }).text, /時間差不多/, '差 3 分以內說差不多');
});

test('會變的（叫車、YouBike、公車）不說幾點到，只說可以改、按了用最新資料查', () => {
  const rush = { ...TRIP, states: [{ key: 'rush', source: 'user' }] };
  const b = bPlan({ data: rush, at: NOW }, { routeName: '601', now: at(5) });
  assert.equal(b.role, 'ridehail');
  assert.equal(b.text, '601 一直沒來。可以改叫車，按了我用最新的資料幫您查。');
  assert.equal(b.arrive, undefined);
  assert.equal(b.ask, '改叫車去台北101');
});

test(`資料太舊（超過 ${STALE_MIN} 分）、沒有別的方案：不硬算，照舊問要不要用最新資料找`, () => {
  const old = bPlan({ data: TRIP, at: NOW }, { routeName: '601', now: at(STALE_MIN + 1) });
  assert.equal(old.stale, true);
  assert.equal(old.ask, '不要坐公車，改別的方式去台北101');
  const only = bPlan({ data: { ...TRIP, options: [TRIP.options[0]] }, at: NOW }, { routeName: '601', now: at(5) });
  assert.equal(only.stale, true);
  assert.equal(bPlan(null, { routeName: '601' }), null);
  assert.equal(bPlan({ data: TRIP }, { routeName: '601', now: at(1) }).stale, true, '不知道多舊也不硬算');
});

test('鐵路、客運那班已經開走就不列；還趕得上的照班表說幾點到', () => {
  const rail = {
    to: { name: '台中' }, best: 'bus-1', states: [],
    options: [
      opt('bus-1', 'bus', '公車 1', 150, 750, { cost: 300 }),
      opt('thsr', 'thsr', '高鐵', 60, 665, { cost: 700, leaveAt: '10:05' }),
      opt('tra', 'tra', '台鐵自強', 140, 760, { cost: 375, leaveAt: '10:30' }),
    ],
  };
  const b = bPlan({ data: rail, at: NOW }, { routeName: '1', now: at(10) });
  assert.equal(b.role, 'tra', '高鐵 10:05 那班已經開走');
  assert.equal(b.arrive, '12:40', '台鐵照班表的抵達時間');
  assert.match(b.text, /比原本晚 10 分/);
});

test('英文：不混中文方案名', () => {
  const b = bPlan({ data: TRIP, at: NOW }, { routeName: '601', now: at(8), lang: 'en' });
  assert.equal(b.text, "Bus 601 isn't coming. You could take the MRT instead, arriving about 10:40, about 8 min later than planned (based on the earlier search).");
  assert.ok(!/[一-鿿]/.test(b.text + b.label + b.ask.replace('台北101', '')));
});
