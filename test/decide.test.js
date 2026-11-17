// 決策引擎：使用者狀態改變排序、硬限制、理由句
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STATES } from '../core/decide.js';

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

test('想省錢（cost ×5，2026-11-18 調整）：市區短程貴的叫車不會勝過公車', async () => {
  const { decide } = await import('../core/decide.js');
  const opts = [
    { id: 'ride', name: '叫車', minutes: 24, waitMin: 6, walkMin: 0, cost: 255, exposure: 0, effort: 0, delayRisk: 0.4 },
    { id: 'bus', name: '公車', minutes: 34, waitMin: 5, walkMin: 6, cost: 15, exposure: 0.2, effort: 0.2, delayRisk: 0.4 },
  ];
  assert.equal(decide(opts).best.id, 'ride');
  assert.equal(decide(opts, { states: ['budget'] }).best.id, 'bus');
});
