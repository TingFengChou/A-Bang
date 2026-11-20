// S15 公車一直不來（2026-11-21）：比第一次預估晚 10 分以上、或連續未發車 → 建議改其他方式（沿用起訖點、排除公車）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stuckReason, LATE_SEC, NOT_RUNNING_POLLS } from '../public/ui/cards/host-web.js';
import { parseIntent } from '../core/agent/demo-intent.js';

const T0 = Date.parse('2026-11-21T10:00:00+08:00');
const min = (n) => n * 60_000;

test('照預估倒數：不算一直不來；晚 10 分以上：late', () => {
  const w = {};
  assert.equal(stuckReason(w, { status: 0, etaSec: 600 }, T0), null, '第一次只記下基準');
  assert.equal(stuckReason(w, { status: 0, etaSec: 300 }, T0 + min(5)), null, '照預估在倒數');
  assert.equal(stuckReason(w, { status: 0, etaSec: 540 }, T0 + min(8)), null, '晚 7 分：還不算');
  assert.equal(stuckReason(w, { status: 0, etaSec: 120 + LATE_SEC }, T0 + min(8)), 'late', '應該剩 2 分卻還要 12 分');
});

test('連續未發車／末班已過才算；中間恢復就重算', () => {
  const w = {};
  for (let i = 1; i < NOT_RUNNING_POLLS; i++) assert.equal(stuckReason(w, { status: 1, etaSec: null }, T0 + i), null);
  assert.equal(stuckReason(w, { status: 0, etaSec: 600 }, T0 + 10), null, '恢復＝重算');
  for (let i = 1; i < NOT_RUNNING_POLLS; i++) stuckReason(w, { status: 3, etaSec: null }, T0 + 20 + i);
  assert.equal(stuckReason(w, { status: 3, etaSec: null }, T0 + 30), 'notRunning');
});

test('那班開走換成下一班（到站時間跳回大數字）不算延誤', () => {
  const w = {};
  stuckReason(w, { status: 0, etaSec: 120 }, T0);
  assert.equal(stuckReason(w, { status: 0, etaSec: 900 }, T0 + min(3)), null);
});

test('卡片按「改其他方式」送出的話：沿用上一段行程、排除公車；同一句又提到公車＝不要', () => {
  const h = [{ role: 'user', content: '從臺北車站去台北101' }, { role: 'assistant', content: '建議公車。' }];
  const a = parseIntent('不要坐公車了，改別的方式', { history: h });
  assert.deepEqual([a.intent, a.from, a.to, a.avoid, a.mode], ['trip', '臺北車站', '台北101', ['bus'], undefined]);
  const b = parseIntent('公車一直沒來，不要坐公車了，改別的方式', { history: h });
  assert.deepEqual([b.avoid, b.mode], [['bus'], undefined]);
  assert.deepEqual(parseIntent('不要叫車，改坐公車', { history: h }).mode, 'bus', '不同方式：照舊');
});
