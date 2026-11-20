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

test('legShares：分段依真實分鐘比例，太短的段至少 6%；總和 1，前後相接', async () => {
  const { legShares } = await import('../public/ui/cards/cards/trip.js');
  const s = legShares([{ mode: 'walk', minutes: 3 }, { mode: 'bus', minutes: 26 }, { mode: 'walk', minutes: 3 }]);
  assert.deepEqual(s.map((x) => x.mode), ['walk', 'bus', 'walk']);
  assert.equal(s[0].from, 0); assert.equal(s.at(-1).to, 1);
  assert.equal(s[1].from, s[0].to);
  assert.ok(Math.abs((s[1].to - s[1].from) - 26 / 32) < 0.01, '公車那段約 81%');
  const tiny = legShares([{ mode: 'walk', minutes: 1 }, { mode: 'thsr', minutes: 99 }]);
  assert.equal(tiny[0].to, 0.06, '1 分鐘的步行至少 6%，看得到');
  assert.deepEqual(legShares([]), []);
});

test('projector：經緯度投影到平面、保持比例並置中；北在上、東在右；點不夠回 null', async () => {
  const { projector } = await import('../public/ui/cards/route3d.js');
  const pj = projector([[25.0, 121.5], [25.01, 121.5], [25.0, 121.51]], 300, 190, 16);
  const [a, n, e] = [[25.0, 121.5], [25.01, 121.5], [25.0, 121.51]].map(pj.xy);
  assert.ok(n[1] < a[1], '北邊在上面');
  assert.ok(e[0] > a[0], '東邊在右邊');
  for (const [x, y] of [a, n, e]) assert.ok(x >= 16 && x <= 284 && y >= 16 && y <= 174, '都在留白內');
  assert.equal(projector([[25, 121]]), null);
});
