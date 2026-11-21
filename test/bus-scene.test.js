// 公車街景更有變化（2026-11-21）：時段、中間的小站牌、等車的人、這班開走、投影與 Blender 相同、讀屏說法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dayPhase, stopMarks, waitingPeople, seeded, project, markAt, farLayer, nearLayer, lightsLayer, busOverlay, STOP_X, PER_STOP } from '../public/ui/cards/bus-scene-art.js';
import { SCENE, busX, departed, sceneSay } from '../public/ui/cards/bus-scene.js';
import { tFor } from '../public/ui/cards/i18n/index.js';

test('dayPhase：台灣時間白天 6:00～16:59、傍晚 17:00～18:29、夜晚 18:30～5:59', () => {
  const at = (hm) => dayPhase(new Date(`2026-11-21T${hm}:00+08:00`));
  assert.equal(at('05:59'), 'night');
  assert.equal(at('06:00'), 'day');
  assert.equal(at('12:00'), 'day');
  assert.equal(at('16:59'), 'day');
  assert.equal(at('17:00'), 'dusk');
  assert.equal(at('18:29'), 'dusk');
  assert.equal(at('18:30'), 'night');
  assert.equal(at('23:10'), 'night');
  assert.equal(dayPhase(Date.parse('2026-11-21T13:00:00Z')), 'night', '毫秒也可以；UTC 13 點＝台灣 21 點');
  assert.equal(dayPhase(new Date('壞掉')), 'day', '時間壞掉當白天');
});

test('stopMarks：最多兩個中間小站牌；公車還沒開到的（k ≤ 還有幾站）清楚，開過的變淡；推估不出來都不標', () => {
  assert.deepEqual(stopMarks(5).map((m) => [m.k, m.ahead]), [[1, true], [2, true]], '很遠：兩個都還沒開到');
  assert.deepEqual(stopMarks(1).map((m) => m.ahead), [true, false], '還有 1 站：第 2 站已開過');
  assert.deepEqual(stopMarks(0).map((m) => m.ahead), [false, false]);
  assert.deepEqual(stopMarks(null).map((m) => m.ahead), [false, false]);
  assert.equal(stopMarks(9).length, 2);
  // 小站牌就在公車「還有 k 站」時停的位置前面（車頭剛好到站牌前）
  for (const m of stopMarks(2)) {
    assert.equal(m.x, STOP_X - PER_STOP * m.k);
    assert.ok(m.x > busX(m.k) && m.x - busX(m.k) < 4.5, `第 ${m.k} 站在公車前面一點`);
  }
  // 標籤在畫面內、在上方說明列下面（不重疊）
  for (const m of stopMarks(2)) {
    const [l, t] = markAt(m.x);
    assert.ok(l > 0 && l < 90 && t > 25 && t < 70, `${l}, ${t}`);
  }
});

test('waitingPeople：1～3 個，同一站同一班每次都一樣，換一班會換人；站在你這站的人行道上', () => {
  const a = waitingPeople('敦化市場|0');
  assert.deepEqual(waitingPeople('敦化市場|0'), a, '刷新不亂跳');
  const counts = new Set();
  const looks = new Set();
  for (let i = 0; i < 40; i++) {
    const p = waitingPeople(`站${i}|0`);
    counts.add(p.length);
    looks.add(JSON.stringify(p.map((x) => x.shirt)));
    for (const x of p) {
      assert.ok(x.x > STOP_X && x.x < STOP_X + 3.2, '在站牌與候車亭前');
      assert.ok(x.y > 1.9 && x.y < 2.6, '在人行道上（路是 y < 1.4）');
      assert.ok(x.h >= 1.1 && x.h <= 1.8);
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3]);
  assert.ok(looks.size > 20, '各站不一樣');
  assert.notDeepEqual(waitingPeople('敦化市場|1'), a, '下一班換一批人');
});

test('seeded：同一個字串同一串數字，0～1', () => {
  const r1 = seeded('x'), r2 = seeded('x'), r3 = seeded('y');
  const s1 = [r1(), r1(), r1()];
  assert.deepEqual([r2(), r2(), r2()], s1);
  assert.notDeepEqual([r3(), r3(), r3()], s1);
  assert.ok(s1.every((v) => v >= 0 && v < 1));
});

test('project：跟 Blender 的正交相機一樣（scene.json 的站牌、車頂、每單位位移）', async () => {
  const meta = JSON.parse(await readFile(new URL('../public/img/scene/scene.json', import.meta.url), 'utf8'));
  const near = (a, b, tol = 0.6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  assert.ok(near(project(7, 1.75, 4.0), meta.sign), `站牌 ${project(7, 1.75, 4.0)}`);
  assert.ok(near(project(0, -0.9, 3.6), meta.busLabel), `車頂 ${project(0, -0.9, 3.6)}`);
  const [x0, y0] = project(0, -0.9, 0), [x1, y1] = project(1, -0.9, 0);
  assert.ok(near([x1 - x0, y1 - y0], meta.unit, 0.15));
  assert.deepEqual(SCENE.sign, meta.sign);
});

test('圖層：依站名固定、換站不同；白天沒有燈，夜晚有路燈光暈與車窗燈；SVG 裡沒有站名', () => {
  assert.equal(farLayer('西門', stopMarks(null)), farLayer('西門', stopMarks(null)));
  assert.notEqual(nearLayer('西門'), nearLayer('市府'));
  assert.equal((farLayer('西門', stopMarks(null)).match(/class="ab-sign"/g) || []).length, 2, '兩個中間小站牌');
  assert.equal(lightsLayer('西門', 'day'), '');
  assert.match(lightsLayer('西門', 'night'), /radialGradient id="ab-glow-night"/);
  assert.match(busOverlay('day'), /class="ab-door"/);
  assert.doesNotMatch(busOverlay('day'), /ffe49a/, '白天車窗不亮');
  assert.match(busOverlay('night'), /ffe49a/, '夜晚車窗亮');
  assert.doesNotMatch(busOverlay('dusk'), /ffe49a/, '傍晚只開車頭燈');
  for (const s of [farLayer('<b>站', stopMarks(1)), nearLayer('<b>站'), lightsLayer('<b>站', 'night')]) assert.doesNotMatch(s, /<b>|站/);
});

test('departed：就在附近的這班開走才算（站數變多、沒車了、到站時間突然變長）；遠的車資料跳動不算', () => {
  assert.equal(departed({ away: 0, near: true, eta: 30 }, { away: 3, etaSec: 600 }), true, '換成下一班（還有 3 站）');
  assert.equal(departed({ away: 0, near: true, eta: 30 }, { away: null }), true, '末班開走：沒有下一班');
  assert.equal(departed({ away: 1, eta: 200 }, { away: 2, etaSec: 500 }), true);
  assert.equal(departed({ away: 0, near: true, eta: 30 }, { away: 0, etaSec: 900 }), true, '前一站沒資料：到站時間從 30 秒變 15 分');
  assert.equal(departed({ away: 0, near: true, eta: 50 }, { away: 0, etaSec: 20 }), false, '還在進站');
  assert.equal(departed({ away: 1, eta: 200 }, { away: 0, etaSec: 40 }), false, '越來越近');
  assert.equal(departed({ away: 3, eta: 600 }, { away: 4, etaSec: 700 }), false, '遠的車資料跳動');
  assert.equal(departed({ away: undefined }, { away: 0 }), false, '第一次');
});

test('街景字典：中英都有「還有 N 站」、路上沒有車、坐車中的「你」；英文單複數', () => {
  const zh = tFor(null), en = tFor('en');
  assert.equal(zh('scene.mark', { n: 2 }), '還有 2 站');
  assert.equal(en('scene.mark', { n: 1 }), '1 stop');
  assert.equal(en('scene.mark', { n: 2 }), '2 stops');
  assert.equal(zh('scene.empty'), '目前路上沒有這班車');
  assert.equal(en('scene.empty'), 'No bus on the way right now');
  assert.equal(zh('scene.you'), '你');
  assert.equal(en('scene.you'), 'You');
  // sceneSay 不變（說明列）
  assert.equal(sceneSay({ routeName: '307', away: 2, etaSec: 400, etaText: '7 分' }).head, '307・還有 2 站');
});
