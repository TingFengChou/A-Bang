// 行程卡「提醒我出門」的時間規則：台灣時間、只限今天、出門時間在 1 分鐘後；不受裝置時區與午夜影響
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRemind } from '../public/ui/cards/cards/trip.js';

const at = (iso) => Date.parse(iso);

test('canRemind：今天、1 分鐘後才可以', () => {
  const now = at('2026-11-19T10:00:00+08:00');
  assert.equal(canRemind('10:30', '2026-11-19', now), true);
  assert.equal(canRemind('10:30', undefined, now), true, '沒有日期視為今天');
  assert.equal(canRemind('10:01', '2026-11-19', now), false, '1 分鐘內不提醒');
  assert.equal(canRemind('09:30', '2026-11-19', now), false, '已經過了');
  assert.equal(canRemind('10:30', '2026-11-20', now), false, '明天的行程不提醒');
  assert.equal(canRemind(null, '2026-11-19', now), false);
  assert.equal(canRemind('10點', '2026-11-19', now), false);
});

test('canRemind：以台灣時間判斷（UTC 23:49 是台灣隔天 07:49）', () => {
  const now = at('2026-11-18T23:49:00Z');
  assert.equal(canRemind('08:19', '2026-11-19', now), true);
  assert.equal(canRemind('00:19', '2026-11-19', now), false, '台灣時間已過');
  assert.equal(canRemind('08:19', '2026-11-18', now), false, 'UTC 的日期不是台灣的今天');
});

test('canRemind：台灣深夜，跨午夜的出門時間是明天，不提醒', () => {
  const now = at('2026-11-19T23:50:00+08:00');
  assert.equal(canRemind('23:55', '2026-11-19', now), true);
  assert.equal(canRemind('00:20', '2026-11-19', now), false);
});

test('出發倒數：今天、90 分鐘內才顯示；過了 15 分不再顯示；台灣時間比較（第十四輪）', async () => {
  const { leaveCountdown } = await import('../public/ui/cards/cards/trip.js');
  const at = (h, m) => Date.UTC(2026, 11, 1, h - 8, m); // 2026-12-01 台灣時間
  assert.deepEqual(leaveCountdown('08:30', '2026-12-01', at(8, 0)), { diff: 30, status: 'ok' });
  assert.deepEqual(leaveCountdown('08:30', '2026-12-01', at(8, 27)), { diff: 3, status: 'now' });
  assert.deepEqual(leaveCountdown('08:30', '2026-12-01', at(8, 40)), { diff: -10, status: 'late' });
  assert.equal(leaveCountdown('08:30', '2026-12-01', at(8, 46)), null, '過了 15 分');
  assert.equal(leaveCountdown('10:31', '2026-12-01', at(9, 0)), null, '超過 90 分：用「提醒我出門」');
  assert.equal(leaveCountdown('08:30', '2026-12-02', at(8, 0)), null, '不是今天');
  assert.equal(leaveCountdown(undefined, '2026-12-01', at(8, 0)), null);
  assert.deepEqual(leaveCountdown('00:10', undefined, at(0, 5)), { diff: 5, status: 'now' }, '沒有日期當今天');
});
