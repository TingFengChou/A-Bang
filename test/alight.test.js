// 下車提醒（2026-11-21）：知道車牌時等目的站下一班就是我這台且 ≤ 2 分；不知道車牌就用上車時估的乘車時間
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { alightDue, rideEstimate, alightText, watchAlight, pollAlight, alightWatch, stopAlight, ALIGHT_SEC } = await import('../public/js/alight.js');

const T0 = Date.parse('2026-11-21T10:00:00+08:00');
const stops = (destEta, destPlate, extra = {}) => [
  { stopName: '西門', etaSec: 30, status: 0, plate: 'AAA-1' },
  { stopName: '台北車站', etaSec: 200, status: 0, plate: 'BBB-2' },
  { stopName: '市政府', etaSec: destEta, status: 0, plate: destPlate, ...extra },
];
beforeEach(() => { stopAlight(); store.clear(); });

test('知道車牌：目的站下一班是別台（前一班）不提醒；是我這台且 ≤ 2 分才提醒', () => {
  const w = { dest: '市政府', plate: 'AAA-1', boardAt: T0, rideSec: 900 };
  assert.equal(alightDue(w, stops(60, 'ZZZ-9'), T0 + 60_000).due, false, '前一班快到了，不是我這台');
  assert.deepEqual(alightDue(w, stops(400, 'AAA-1'), T0 + 300_000), { due: false, etaSec: 400, by: 'plate' });
  assert.deepEqual(alightDue(w, stops(ALIGHT_SEC, 'AAA-1'), T0 + 600_000), { due: true, etaSec: ALIGHT_SEC, by: 'plate' });
});

test('不知道車牌：照上車時估的乘車時間；坐超過一半且目的站 ≤ 2 分也提醒', () => {
  const w = { dest: '市政府', plate: null, boardAt: T0, rideSec: 900 };
  assert.equal(alightDue(w, stops(800, null), T0 + 60_000).due, false);
  assert.equal(alightDue(w, stops(100, null), T0 + 200_000).due, false, '才坐 3 分多：目的站 ≤ 2 分的是前一班');
  assert.equal(alightDue(w, stops(100, null), T0 + 500_000).by, 'time', '坐超過一半');
  assert.equal(alightDue(w, stops(null, null, { status: 1 }), T0 + (900 - ALIGHT_SEC) * 1000).due, true, '時間到');
});

test('乘車時間估算與提醒文字', () => {
  assert.equal(rideEstimate(stops(900, 'x'), '西門', '市政府'), 870);
  assert.equal(rideEstimate(stops(10, 'x'), '西門', '市政府'), 180, '時間差對不上（前一台）：站數 × 90 秒');
  assert.equal(rideEstimate(stops(900, 'x'), '西門', '不存在'), null);
  assert.equal(rideEstimate(stops(900, 'x'), '市政府', '西門'), null, '下車站要在上車站之後');
  assert.equal(alightText('市政府', 120), '約 2 分後到「市政府」，準備下車');
  assert.equal(alightText('市政府', 30), '快到「市政府」了，準備下車！');
});

test('watchAlight：記在手機、提醒後結束；使用者取消', async () => {
  let destEta = 600;
  const callTool = async () => ({ data: { directions: [{ direction: 0, stops: stops(destEta, 'AAA-1') }] } });
  await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: '西門', dest: '市政府', plate: 'AAA-1', rideSec: 870, boardAt: Date.now() }, callTool);
  assert.equal(alightWatch().dest, '市政府');
  assert.ok(store.get('abang.alightWatch'), '記在手機（App 重開恢復）');
  destEta = 90;
  await pollAlight(callTool);
  assert.equal(alightWatch(), null, '提醒後結束');
  assert.equal(store.get('abang.alightWatch'), undefined);
  await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: '西門', dest: '市政府', plate: null, rideSec: 870 }, async () => ({ data: { directions: [{ stops: stops(800, null) }] } }));
  stopAlight();
  assert.equal(alightWatch(), null);
});
