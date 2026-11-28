// 決策圖比較細節（設計第二輪）：前兩名的白話差距、節點名稱不硬切
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainDiff, shortName } from '../public/ui/agent/decision-graph.js';

test('白話差距：快、省、少走、少等；差不到 2 不說；英文', () => {
  const a = { minutes: 25, cost: 15, walkMin: 6, waitMin: 3 };
  const b = { minutes: 32, cost: 220, walkMin: 9, waitMin: 2 };
  assert.equal(plainDiff(a, b), '快 7 分、省 205 元、少走 3 分');
  assert.equal(plainDiff(b, a), '慢 7 分、多花 205 元、多走 3 分');
  assert.equal(plainDiff(a, b, true), '7 min faster, NT$205 cheaper, 3 min less walking');
  assert.equal(plainDiff({ minutes: 20, cost: 15 }, { minutes: 21, cost: 16 }), '');
});

test('節點名稱：短的照原樣；有括號先拿掉；還太長才截', () => {
  assert.equal(shortName('公車 601'), '公車 601');
  assert.equal(shortName('叫車（Uber）'), '叫車', '8 個字：拿掉括號');
  assert.equal(shortName('捷運（板南線轉淡水信義線）'), '捷運');
  assert.equal(shortName('YouBike（微笑單車 2.0）'), 'YouBike');
  assert.equal(shortName('捷運 淡水信義線'), '捷運 淡水信…');
});

test('fitName：依字寬截（中文 1、英數 0.6，上限 5）——YouBike、公車 紅30 放得下；長的才截（設計第三輪 #3）', async () => {
  const { fitName } = await import('../public/ui/agent/decision-graph.js');
  assert.equal(fitName('YouBike'), 'YouBike');
  assert.equal(fitName('公車 紅30'), '公車 紅30');
  assert.equal(fitName('叫車（Uber）'), '叫車');
  assert.equal(fitName('國道客運示範 B'), '國道客運…');
  assert.equal(fitName('捷運 淡水信義線'), '捷運 淡…');
});
