// Agent profile 與 system prompt（M5-01）：zod 驗證、registry 交叉檢查、組裝順序
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, getProfile, PROFILES } from '../core/agents/index.js';
import { buildSystemPrompt, PLATFORM_POLICY } from '../core/agent/prompt.js';
import life from '../core/agents/life.json' with { type: 'json' };

test('life profile 通過驗證，工具都在 registry 且工具包相符', () => {
  const p = getProfile('life');
  assert.equal(p.id, 'life');
  assert.ok(p.tools.includes('plan_trip') && p.tools.includes('ridehail_link'));
  assert.deepEqual(Object.keys(PROFILES), ['life']);
  assert.throws(() => getProfile('nope'), /沒有這個 agent/);
});

test('validateProfile：未知欄位、不存在的 tool、pack 不符都擋下', () => {
  assert.throws(() => validateProfile({ ...life, extra: 1 }));
  assert.throws(() => validateProfile({ ...life, tools: [...life.tools, 'no_such_tool'] }), /沒有這個 tool/);
  assert.throws(() => validateProfile({ ...life, packs: ['transit', 'weather'] }), /ridehail 不在 packs/);
  assert.throws(() => validateProfile({ ...life, packs: [...life.packs, 'nope'] }), /沒有這個工具包/);
  assert.throws(() => validateProfile({ ...life, tools: [...life.tools, 'find_place'] }), /重複/);
});

test('buildSystemPrompt：平台政策 → 工具包護欄 → 角色 → 情境，帶日期與脈絡', () => {
  const s = buildSystemPrompt(getProfile(), { now: Date.parse('2026-11-18T08:30:00+08:00'), context: '使用者在看 307 的「撫遠街」站' });
  const order = ['## 平台政策', '## 工具包護欄', '## 角色', '## 情境'].map((h) => s.indexOf(h));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), order.join(','));
  assert.ok(s.includes(PLATFORM_POLICY[0]));
  assert.match(s, /ridehail_link，L2/);
  assert.match(s, /今天：2026-11-18（台灣時間 08:30）/);
  assert.match(s, /撫遠街/);
  assert.ok(buildSystemPrompt(getProfile(), { context: 'x'.repeat(500) }).length < s.length + 300, '脈絡截斷');
});
