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

test('公車街景：公車依站數停在路上（停靠／一站／太遠停在左邊），座標與 Blender 輸出的 scene.json 相同', async () => {
  const { SCENE, busX, busShift } = await import('../public/ui/cards/bus-scene.js');
  const { readFile } = await import('node:fs/promises');
  assert.deepEqual(SCENE, JSON.parse(await readFile(new URL('../public/img/scene/scene.json', import.meta.url), 'utf8')));
  assert.equal(busX(0), SCENE.busStopAt, '就在你這站：停在站牌前');
  assert.ok(busX(1) < busX(0) && busX(2) < busX(1), '越遠越左');
  assert.equal(busX(9), busX(3), '太遠就停在畫面左邊（文字寫實際站數）');
  const [dx] = busShift(busX(9));
  assert.ok(SCENE.busLabel[0] + (dx / 100) * SCENE.w > 0, '最遠時車頂的字仍在畫面內');
});

test('公車街景說明：分鐘單獨標出；只有 1 分鐘內才說「就在你這站」（還有 0 站不代表車在你這站）', async () => {
  const { sceneSay } = await import('../public/ui/cards/bus-scene.js');
  assert.deepEqual(sceneSay({ routeName: '601', away: 2, etaSec: 420, etaText: '7 分' }), { head: '601・還有 2 站', eta: '7 分', near: false });
  assert.deepEqual(sceneSay({ routeName: '601', away: 0, etaSec: 40, etaText: '即將進站' }), { head: '601・就在你這站', eta: '即將進站', near: true });
  assert.deepEqual(sceneSay({ routeName: '601', away: 0, etaSec: 600, etaText: '10 分' }), { head: '601', eta: '10 分', near: false }, '上一站沒資料：不說就在你這站');
  assert.deepEqual(sceneSay({ routeName: '601', away: null, etaSec: null, etaText: '尚未發車' }), { head: '601', eta: '尚未發車', near: false });
});

// T8：天氣氛圍依台灣時間分日夜（不看裝置時區）；下雨、降雨機率高優先
test('sceneOf：雨、雲、台灣時間 18～6 點是夜晚', async () => {
  const { sceneOf } = await import('../public/ui/cards/gauge.js');
  assert.equal(sceneOf({ raining: true, observedAt: '2026-11-21T12:00:00+08:00' }), 'rain');
  assert.equal(sceneOf({ pop3h: 60, observedAt: '2026-11-21T12:00:00+08:00' }), 'cloud');
  assert.equal(sceneOf({ observedAt: '2026-11-21T12:00:00+08:00' }), 'sun');
  assert.equal(sceneOf({ observedAt: '2026-11-21T18:00:00+08:00' }), 'night');
  assert.equal(sceneOf({ observedAt: '2026-11-21T05:59:00+08:00' }), 'night');
  assert.equal(sceneOf({ observedAt: '2026-11-21T06:00:00+08:00' }), 'sun');
  assert.equal(sceneOf({ observedAt: '2026-11-21T11:00:00Z' }), 'night', 'UTC 11 點＝台灣 19 點');
  assert.equal(sceneOf({ observedAt: 'bad' }), 'sun', '時間看不懂：當白天');
});
