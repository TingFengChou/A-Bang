// 示範模式意圖（M5-03）：地點擷取、抵達時間、狀態關鍵字、意圖分類；每個建議問題的計畫都能用示範資料完整執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, placesInText, arriveByOf, demoSteps, demoSummary, DEFAULT_FROM } from '../core/agent/demo-intent.js';
import { getProfile } from '../core/agents/index.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');

test('placesInText：依出現順序、長的優先、車站短名', () => {
  assert.deepEqual(placesInText('從西門町到台北 101'), ['西門町', '台北101']);
  assert.deepEqual(placesInText('明天要到左營'), ['高鐵左營站']);
  assert.deepEqual(placesInText('今天天氣如何'), []);
});

test('arriveByOf：點、點半、冒號、下午', () => {
  assert.deepEqual(['8 點前', '10點半前要到', '9:15 之前', '下午 3 點前', '25 點前', '沒有時間'].map(arriveByOf), ['08:00', '10:30', '09:15', '15:00', null, null]);
});

test('parseIntent：意圖、起訖、路線、狀態', () => {
  const c = (q) => parseIntent(q, NOW);
  assert.deepEqual(['intent', 'from', 'to'].map((k) => c('從西門町到台北 101 怎麼去？')[k]), ['trip', '西門町', '台北101']);
  assert.deepEqual(['intent', 'from', 'to', 'arriveBy', 'tomorrow'].map((k) => c('明天 8 點前要到左營')[k]), ['trip', null, '高鐵左營站', '08:00', true]);
  assert.deepEqual(['intent', 'route', 'places'].map((k) => c('307 到哪了？我在臺北車站')[k]), ['bus_route', '307', ['臺北車站']]);
  assert.deepEqual(['intent', 'system', 'from', 'to'].map((k) => c('高鐵台北到台中下一班幾點？')[k]), ['rail', 'THSR', '台北', '台中']);
  assert.equal(c('台北車站附近還有 YouBike 嗎？').intent, 'youbike');
  assert.equal(c('台北車站附近的公車站牌').intent, 'nearby_bus');
  assert.deepEqual(['intent', 'station'].map((k) => c('捷運市政府站下一班')[k]), ['metro', '市政府']);
  assert.deepEqual(c('帶著行李從板橋車站到桃園機場，很趕').states, ['rush', 'luggage']);
  assert.deepEqual(c('下雨了，從台北車站去松山車站怎麼走？').states, ['rain']);
  assert.equal(c('今天天氣如何').intent, 'unknown');
});

/** 依計畫逐段執行（同段平行），回傳依 tool 名稱分組的結果 */
async function runPlan(svc, steps) {
  const results = {};
  const notes = [];
  for (const step of steps) {
    const s = step(results);
    if (!s) break;
    notes.push(s.note);
    const out = await Promise.all(s.calls.map((c) => callTool(svc, c.name, c.args)));
    s.calls.forEach((c, i) => { (results[c.name] ||= []).push(out[i]); });
  }
  return { results, notes };
}

test('每個建議問題的計畫都能用示範資料完整執行，最後有卡片', async () => {
  const svc = createServices({ forceMock: true });
  const want = { trip: 'trip', bus_route: 'bus-route', youbike: 'youbike', rail: 'timetable', nearby_bus: 'nearby', metro: 'metro' };
  for (const q of getProfile().suggestions) {
    const it = parseIntent(q, NOW);
    assert.notEqual(it.intent, 'unknown', q);
    const { results, notes } = await runPlan(svc, demoSteps(it, NOW));
    const last = Object.values(results).flat().at(-1);
    assert.equal(last.card, want[it.intent], q);
    assert.ok(notes.every((n) => n.length <= 30 && n.startsWith('@')), `${q}：${notes}`);
    assert.ok(demoSummary(it, results).length > 5, q);
  }
});

test('行程：使用者狀態與抵達時間帶進 plan_trip；明天用隔天日期；沒起點用預設', async () => {
  const svc = createServices({ forceMock: true });
  const it = parseIntent('明天 8 點前要到左營，帶著行李', NOW);
  const { results } = await runPlan(svc, demoSteps(it, NOW));
  const trip = results.plan_trip[0];
  assert.deepEqual(trip.args.prefs, { states: ['luggage'], arriveBy: '08:00' });
  assert.equal(trip.data.date, '2026-11-19');
  assert.equal(trip.data.from.name, '臺北車站');
  assert.match(demoSummary(it, results), new RegExp(`沒說從哪出發.+${DEFAULT_FROM}`));
});

test('unknown：回覆可以問的範例', () => {
  const s = demoSummary(parseIntent('今天天氣如何'), {}, getProfile().suggestions);
  assert.match(s, /可以幫你查.+試試看：「/);
});
