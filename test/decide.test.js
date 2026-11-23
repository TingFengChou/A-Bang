// 決策引擎：使用者狀態改變排序、硬限制、理由句
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STATES, effMinutes, feltMinutes } from '../core/decide.js';

const XIMEN_101 = [
  { id: 'bike', name: 'YouBike', minutes: 28, waitMin: 0, walkMin: 3, cost: 10, exposure: 1, effort: 0.8 },
  { id: 'bus', name: '公車', minutes: 34, waitMin: 12, walkMin: 8, cost: 15, exposure: 0.2, effort: 0.1 },
  { id: 'walk', name: '步行', minutes: 65, waitMin: 0, walkMin: 65, cost: 0, exposure: 1, effort: 1 },
];

test('沒有特別狀態：最快的 YouBike 勝出', () => {
  const r = decide(XIMEN_101);
  assert.equal(r.best.id, 'bike');
  assert.match(r.reason, /^選「YouBike」/);
  assert.ok(Math.abs(Object.values(r.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('下雨：改搭公車，理由提到下雨', () => {
  const r = decide(XIMEN_101, { states: ['rain'] });
  assert.equal(r.best.id, 'bus');
  assert.match(r.reason, /因為正在下雨/);
});

test('空品不佳：少待戶外、少騎車，改搭公車；理由說空品', () => {
  const r = decide(XIMEN_101, { states: ['badAir'] });
  assert.equal(r.best.id, 'bus');
  assert.match(r.reason, /因為空氣品質不佳/);
  assert.match(r.reason, /少待在戶外/);
  assert.equal(r.ranked.at(-1).id, 'walk');
  assert.match(decide(XIMEN_101, { states: ['badAir', 'rain'] }).reason, /比較不會淋雨/, '下雨時仍說淋雨');
});

test('帶行李、少走路：公車', () => {
  assert.equal(decide(XIMEN_101, { states: ['luggage'] }).best.id, 'bus');
  assert.equal(decide(XIMEN_101, { states: ['lessWalk'] }).best.id, 'bus');
});

test('趕時間：YouBike（不用等車）', () => {
  const r = decide(XIMEN_101, { states: ['rush'] });
  assert.equal(r.best.id, 'bike');
});

test('硬限制：會遲到的方案被排除', () => {
  const r = decide([
    { id: 't0630', name: '高鐵 06:30', minutes: 90, arriveAt: '08:00', cost: 1490 },
    { id: 't0700', name: '高鐵 07:00', minutes: 95, arriveAt: '08:35', cost: 1490 },
  ], { arriveBy: '08:00' });
  assert.equal(r.best.id, 't0630');
  assert.equal(r.excluded[0].id, 't0700');
  assert.match(r.reason, /高鐵 07:00會遲到已排除/);
});

test('塞車：走軌道，不搭會塞車的客運或叫車', () => {
  const opts = [
    { id: 'thsr', name: '高鐵＋接駁', minutes: 65, cost: 306, delayRisk: 0, arriveAt: '09:45' },
    { id: 'tra', name: '台鐵自強', minutes: 75, cost: 177, delayRisk: 0, arriveAt: '09:55' },
    { id: 'coach', name: '國道客運', minutes: 100, cost: 140, delayRisk: 1, arriveAt: '10:20' },
    { id: 'ride', name: 'Uber', minutes: 80, cost: 2100, delayRisk: 1, arriveAt: '10:00' },
  ];
  const r = decide(opts, { states: ['traffic'], arriveBy: '10:00' });
  assert.ok(['thsr', 'tra'].includes(r.best.id));
  assert.equal(r.excluded[0].id, 'coach');
  assert.equal(r.ranked.at(-1).id, 'ride');
  assert.equal(decide(opts, { states: ['traffic', 'budget'], arriveBy: '10:00' }).best.id, 'tra');
});

test('未知狀態會被忽略；全部排除時有說明', () => {
  assert.equal(decide(XIMEN_101, { states: ['nope'] }).best.id, 'bike');
  const r = decide([{ id: 'a', name: 'A', minutes: 10, arriveAt: '09:00' }], { arriveBy: '08:00' });
  assert.equal(r.best, null);
  assert.match(r.reason, /趕不上/);
  assert.ok(Object.keys(STATES).length >= 5);
});

test('arriveByMin：以分鐘比較，跨午夜的抵達不會被字串比較放過', async () => {
  const { decide } = await import('../core/decide.js');
  const opts = [
    { id: 'a', name: 'A', minutes: 30, arriveAt: '22:30', arriveMin: 1350 },
    { id: 'b', name: 'B', minutes: 300, arriveAt: '03:00', arriveMin: 1620 },
  ];
  const r = decide(opts, { arriveBy: '23:30', arriveByMin: 1410 });
  assert.deepEqual(r.excluded.map((o) => o.id), ['b']);
  assert.deepEqual(decide(opts, { arriveBy: '23:30' }).excluded.map((o) => o.id), []); // 只有字串時維持舊行為
});

test('想省錢（cost ×3，2026-11-21 調整）：市區短程貴的叫車不會勝過公車', async () => {
  const { decide } = await import('../core/decide.js');
  const opts = [
    { id: 'ride', role: 'ridehail', name: '叫車', minutes: 24, waitMin: 6, walkMin: 0, cost: 255, exposure: 0, effort: 0, delayRisk: 0.4 },
    { id: 'bus', role: 'bus', name: '公車', minutes: 34, waitMin: 5, walkMin: 6, cost: 15, exposure: 0.2, effort: 0.2, delayRisk: 0.4 },
  ];
  // 2026-11-22 花錢換時間要划算：沒有狀況時原本推叫車（快 10 分、多 240 元），現在推公車；帶行李才推叫車
  assert.equal(decide(opts).best.id, 'bus');
  assert.equal(decide(opts, { states: ['luggage'] }).best.id, 'ride');
  assert.equal(decide(opts, { states: ['budget'] }).best.id, 'bus');
});

// 深夜等首班（trip.js longWait，2026-11-23 交通健檢）：01:00 台北→新竹，台鐵 06:02 才開、07:27 到；叫車 02:33 就到
const NIGHT_HSINCHU = [
  { id: 'tra', role: 'tra', name: '台鐵莒光', minutes: 96, waitMin: 10, walkMin: 2, cost: 160, exposure: 0.1, effort: 0.3, delayRisk: 0, arriveMin: 447 },
  { id: 'ridehail', role: 'ridehail', name: '叫車（Uber）', minutes: 93, waitMin: 6, walkMin: 0, cost: 2365, exposure: 0, effort: 0, delayRisk: 0, arriveMin: 153 },
];
test('等很久才有車（longWait）：決策照真正要等的時間比（＝抵達時間），不當成只等 10 分', () => {
  // 沒標 longWait（舊行為）：台鐵只「等 10 分」又便宜，推 07:27 才到的台鐵
  assert.equal(decide(NIGHT_HSINCHU).best.id, 'tra');
  const opts = NIGHT_HSINCHU.map((o) => (o.id === 'tra' ? { ...o, longWait: { min: 301, extra: 291, first: '06:02' } } : o));
  assert.equal(effMinutes(opts[0]), 387);
  assert.equal(effMinutes(opts[1]), 93, '沒有 longWait 的方案不變');
  assert.ok(feltMinutes(opts[0]) > feltMinutes(NIGHT_HSINCHU[0]) + 500, '多等的時間也算進體感時間（等車加倍）');
  const r = decide(opts);
  assert.equal(r.best.id, 'ridehail');
  assert.match(r.reason, /比台鐵莒光快 294 分/);
  // 想省錢的人可以選等首班（照分數，不硬排除）
  assert.equal(decide(opts, { states: ['budget'] }).best.id, 'tra');
});
