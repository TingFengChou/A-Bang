// 動態第三批背後的資料：空品儀表角度、天氣氛圍、公車站間滑動（只滑位置有變的車）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeAngle, sceneOf } from '../public/ui/cards/gauge.js';
import { snapshot, slide } from '../public/ui/cards/slide.js';

test('gaugeAngle：六級各 30°、級內線性，超出 500 停在最右，沒有值指 0', () => {
  assert.deepEqual([0, 50, 100, 150, 200, 300, 500, 900].map(gaugeAngle), [0, 30, 60, 90, 120, 150, 180, 180]);
  assert.equal(gaugeAngle(58), 34.3, '普通的前段');
  assert.equal(gaugeAngle(null), 0);
});

test('sceneOf：下雨＞可能下雨＞夜晚（台灣時間）＞白天', () => {
  assert.equal(sceneOf({ raining: true, pop3h: 90 }), 'rain');
  assert.equal(sceneOf({ raining: false, pop3h: 60 }), 'cloud');
  assert.equal(sceneOf({ raining: false, pop3h: 10, observedAt: '2026-11-20T12:00:00Z' }), 'night', '台灣 20 點');
  assert.equal(sceneOf({ raining: false, pop3h: 10, observedAt: '2026-11-20T04:00:00Z' }), 'sun', '台灣 12 點');
  assert.equal(sceneOf({}), 'sun');
});

test('slide：同一台車（車牌）位置變了才從舊位置滑過來；新出現的車不滑', () => {
  const bus = (plate, top, calls) => ({ dataset: { plate }, getBoundingClientRect: () => ({ top, left: 10 }), animate: (k) => calls.push([plate, k[0].transform]) });
  const calls = [];
  const before = snapshot({ querySelectorAll: () => [bus('A', 100, calls), bus('B', 300, calls)] });
  const n = slide({ querySelectorAll: () => [bus('A', 160, calls), bus('B', 300, calls), bus('C', 500, calls)] }, before);
  assert.equal(n, 1);
  assert.deepEqual(calls, [['A', 'translate(0px, -60px) scale(1.15)']]);
  assert.equal(slide(null, before), 0);
});
