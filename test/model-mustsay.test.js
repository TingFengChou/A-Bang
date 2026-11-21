// 模型模式：模型漏講的重點由程式補上（模型模式情境評測 S10、S12-11）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mustSay } from '../core/agent/model-loop.js';

test('照你說的改交通方式：模型沒說就補在開頭', () => {
  const trip = { ranking: { reason: '照你說的選「捷運」，約 23 分。' }, options: [] };
  assert.equal(mustSay('捷運約 23 分會到。', trip), '照你說的選「捷運」，約 23 分。 捷運約 23 分會到。');
  assert.equal(mustSay('照你說的改捷運，約 23 分。', trip), '照你說的改捷運，約 23 分。', '已經說了就不重複');
  assert.equal(mustSay('叫車最快。', { ranking: { reason: '叫車 78 分最高。' }, options: [] }), '叫車最快。', '沒有指定方式不加');
});

test('深夜：公車收班或接近末班，模型沒說就補一句', () => {
  assert.match(mustSay('建議叫車，約 25 分', { ranking: {}, skipped: [{ role: 'bus', why: '公車已收班' }], options: [] }), /建議叫車，約 25 分。公車已收班。$/);
  assert.match(mustSay('建議坐公車。', { ranking: {}, options: [{ lastBus: true }] }), /末班快到了/);
  assert.equal(mustSay('公車末班已過，建議叫車。', { ranking: {}, skipped: [{ role: 'bus', why: '公車已收班' }], options: [] }), '公車末班已過，建議叫車。', '已經提到不重複');
  assert.equal(mustSay('白天坐公車就好。', { ranking: {}, options: [] }), '白天坐公車就好。');
  assert.equal(mustSay('沒有行程', null), '沒有行程');
});
