// 每個服務問要不要提醒（2026-11-22 產品負責人「查過垃圾車，也可以問需不需要設定提醒」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garbageRemindAt, GARBAGE_LEAD_MIN } from '../public/ui/cards/cards/garbage.js';

const at = (hhmm) => Date.parse(`2026-11-23T${hhmm}:00+08:00`);

test('垃圾車：今天還沒到、離現在超過 11 分才給「前 10 分提醒我」；時間是開始前 10 分（台灣時間）', () => {
  assert.equal(GARBAGE_LEAD_MIN, 10);
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30–19:40' }, at('18:00')), '19:20');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('19:18')), '19:20', '還有 12 分：可以');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('19:20')), null, '不到 11 分：來不及提醒');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('20:00')), null, '過了');
  assert.equal(garbageRemindAt({ collectToday: false, time: '19:30' }, at('18:00')), null, '今天不收');
  assert.equal(garbageRemindAt({ collectToday: true, time: '' }, at('18:00')), null);
});
