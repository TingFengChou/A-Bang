// PM 第二輪審查（2026-11-28）：時間詞接「去」、抵達時間已過推到晚上、明天的行程不盯即時到站、末班車的說法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, arriveByOf } from '../core/agent/demo-intent.js';
import { laterTrip, busFollowUp } from '../core/agent/run.js';

const at = (hm, d = 28) => Date.parse(`2026-11-${d}T${hm}:00+08:00`);
const p = (q) => parseIntent(q, { history: [] });

test('時間詞後面接「去」是行程（原本回功能清單）', () => {
  for (const q of ['明天去台北101', '等一下去台北101', '明天早上去台北101', '晚上去西門町', '禮拜六早上九點去動物園', '我要搭末班車回板橋']) assert.equal(p(q).intent, 'trip', q);
  assert.equal(p('明天去台北101').tomorrow, true);
});

test('抵達時間沒說早晚、今天已經過了 → 下午／晚上；說了早上或明天照說的', () => {
  assert.equal(arriveByOf('六點要到台北101', at('15:00')), '18:00');
  assert.equal(arriveByOf('六點要到台北101', at('05:00')), '06:00', '還沒到就是早上');
  assert.equal(arriveByOf('早上六點要到', at('15:00')), '06:00');
  assert.equal(arriveByOf('明天六點要到', at('15:00')), '06:00');
  assert.equal(arriveByOf('晚上八點前到', at('09:00')), '20:00');
});

test('明天、或一小時以後才出發的行程：不盯現在的即時到站', () => {
  const trip = (date, departAt) => ({ date, departAt, best: 'b', options: [{ id: 'b', role: 'bus', follow: { city: 'Taipei', routeName: '601', stop: '民生捷運站' } }] });
  const now = at('10:00');
  assert.equal(laterTrip(trip('2026-11-29', '08:00'), now), true);
  assert.equal(laterTrip(trip('2026-11-28', '13:30'), now), true);
  assert.equal(laterTrip(trip('2026-11-28', '10:20'), now), false);
  assert.equal(busFollowUp(trip('2026-11-29', '08:00'), now), null);
  assert.equal(busFollowUp(trip('2026-11-28', '10:05'), now).args.routeName, '601');
});

test('末班車的說法：307還有車嗎、捷運到幾點、捷運幾點收；YouBike、藥局不被搶走', () => {
  assert.deepEqual([p('307還有車嗎').intent, p('307還有車嗎').route, p('307還有車嗎').last], ['bus_route', '307', true]);
  for (const q of ['捷運到幾點', '捷運幾點收', '捷運還有車嗎']) { assert.equal(p(q).intent, 'metro', q); assert.equal(p(q).last, true, q); }
  assert.equal(p('YouBike還有車嗎').intent, 'youbike');
  assert.equal(p('藥局開到幾點').intent, 'pharmacy');
  assert.equal(p('幾點到台北101').intent, 'trip');
});
