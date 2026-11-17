// Tool registry：定義完整性、參數驗證、執行結果格式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTools, getTool, listPacks, describeTool, callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { UserError } from '../core/util.js';

const svc = createServices({ forceMock: true });

test('每個 tool 都有 pack、tier、描述與 JSON Schema', () => {
  const tools = listTools();
  assert.equal(tools.length, 15);
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/);
    assert.ok(t.description.length > 10, t.name);
    assert.ok(['L1', 'L2', 'L3'].includes(t.tier), t.name);
    const d = describeTool(t);
    assert.equal(d.inputSchema.type, 'object', t.name);
  }
  assert.deepEqual(listPacks(), ['transit', 'weather']);
  assert.equal(listTools({ packs: ['nope'] }).length, 0);
});

test('callTool 回傳統一格式', async () => {
  const r = await callTool(svc, 'thsr_timetable', { from: '台北', to: '左營', date: '2026-12-01' });
  assert.equal(r.name, 'thsr_timetable');
  assert.equal(r.card, 'timetable');
  assert.equal(r.mode, 'demo');
  assert.ok(r.data.trains.length > 0);
  assert.match(r.text, /高鐵 台北 → 左營（2026-12-01）/);
  assert.ok(r.text.length <= 1600);
  assert.match(r.speak, /最早 \d{2}:\d{2} 出發/);
});

test('每個 tool 都有 speak（討論串用的一句話）', async () => {
  for (const t of listTools()) assert.equal(typeof t.speak, 'function', t.name);
  const yb = await callTool(svc, 'youbike_nearby', { lat: 25.0478, lon: 121.517 });
  assert.match(yb.speak, /還有 \d+ 台|暫時都沒有車/);
  assert.ok(yb.speak.length < 80);
});

test('rail_fare：示範模式兩系統、speak 用成人單程最低與最高', async () => {
  const t = await callTool(svc, 'rail_fare', { system: 'THSR', from: '台北', to: '左營' });
  const adult = t.data.fares.filter((f) => f.adultOneWay);
  assert.ok(adult.length >= 2 && t.data.fares[0].adultOneWay);
  assert.ok(adult.every((f) => f.cabin && Number.isInteger(f.price)));
  assert.equal(t.speak, `台北到左營高鐵成人單程 ${adult[0].price.toLocaleString('en-US')} 元起（最高 ${adult.at(-1).price.toLocaleString('en-US')} 元）。`);
  const r = await callTool(svc, 'rail_fare', { system: 'TRA', from: '臺北', to: '花蓮' });
  assert.ok(r.data.fares.every((f) => f.trainType && !f.cabin));
  assert.match(r.text, /^台鐵 臺北 → 花蓮 票價：/);
  await assert.rejects(callTool(svc, 'rail_fare', { system: 'THSR', from: '台北', to: '花蓮' }), /找不到高鐵車站/);
});

test('參數驗證：型別、範圍、未知 tool', async () => {
  await assert.rejects(callTool(svc, 'youbike_nearby', { lat: '25', lon: 121.5 }), (e) => e instanceof UserError && /lat/.test(e.message));
  await assert.rejects(callTool(svc, 'youbike_nearby', { lat: 0, lon: 0 }), UserError);
  await assert.rejects(callTool(svc, 'thsr_timetable', { from: '台北', to: '左營', date: '12/01' }), /YYYY-MM-DD/);
  await assert.rejects(callTool(svc, 'no_such_tool', {}), /沒有這個 tool/);
  assert.equal(getTool('no_such_tool'), null);
});
