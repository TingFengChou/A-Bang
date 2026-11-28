// 出門前檢核表（T-CHECKLIST，2026-11-28 Antigravity 第七輪）：去政府辦事的應備文件勾了哪幾項，只存在手機
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { checklistGet, checklistSet, CHECKLIST_KEY } = await import('../public/ui/cards/host-web.js');

test('勾了哪幾項記在手機；只存編號；全部取消就刪掉那一份', () => {
  checklistSet('A-1', new Set([0, 2]));
  assert.deepEqual([...checklistGet('A-1')], [0, 2]);
  const raw = JSON.parse(mem.get(CHECKLIST_KEY));
  assert.deepEqual(Object.keys(raw['A-1']).sort(), ['at', 'done'], '不存文件內容');
  checklistSet('A-1', new Set());
  assert.equal(JSON.parse(mem.get(CHECKLIST_KEY))['A-1'], undefined);
  assert.deepEqual([...checklistGet('沒有這份')], []);
});

test('30 天沒動就清掉、最多 20 份（留最近的）、壞掉的資料不出錯', () => {
  mem.set(CHECKLIST_KEY, JSON.stringify({ old: { done: [1], at: Date.now() - 31 * 864e5 } }));
  assert.deepEqual([...checklistGet('old')], []);
  mem.clear();
  for (let i = 0; i < 25; i++) checklistSet(`S${i}`, new Set([0]));
  assert.equal(Object.keys(JSON.parse(mem.get(CHECKLIST_KEY))).length, 20);
  mem.set(CHECKLIST_KEY, '{壞掉');
  assert.deepEqual([...checklistGet('x')], []);
});
