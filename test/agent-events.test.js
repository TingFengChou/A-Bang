// Agent 事件（M5-02）：必要欄位、registry 帶入 title／role／pack／tier、decision 來自 plan_trip、NDJSON、狀態合併
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, toNdjson, mergeStates, EVENT_TYPES, TOOL_ROLES } from '../core/agent/events.js';
import { listTools, callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

test('每個 tool 都有討論串角色；事件型別齊全', () => {
  for (const t of listTools()) assert.ok(TOOL_ROLES[t.name], t.name);
  assert.equal(EVENT_TYPES.length, 11);
});

test('建立函式：必要欄位、registry 帶入、文字截斷', () => {
  assert.deepEqual(ev.status({ mode: 'demo', profile: 'life' }), { type: 'status', mode: 'demo', profile: 'life' });
  assert.throws(() => ev.status({ profile: 'life' }), /缺少 mode/);
  const s = ev.toolStart({ id: 't1', name: 'weather_now', input: { lat: 25, lon: 121 } });
  assert.deepEqual([s.title, s.role, s.pack, s.tier, s.server], ['現在天氣', '天氣', 'weather', 'L1', 'abang']);
  assert.equal(ev.agentNote('x'.repeat(100)).text.length, 60);
  assert.deepEqual(ev.toolResult({ id: 't1', error: '找不到' }), { type: 'tool_result', id: 't1', ok: false, error: '找不到' });
  assert.deepEqual(ev.error({ message: '太頻繁', retryable: true, retryAfterSec: 30 }), { type: 'error', message: '太頻繁', retryable: true, retryAfterSec: 30 });
  assert.equal(toNdjson(ev.done()), '{"type":"done"}\n');
});

test('tool_result 與 decision 來自真實 callTool 結果', async () => {
  const svc = createServices({ forceMock: true, demo: { weather: 'rain' } });
  const r = await callTool(svc, 'plan_trip', { from: '台北車站', to: '台北101', departAt: '09:00' });
  const tr = ev.toolResult({ id: 't9', result: r });
  assert.deepEqual([tr.ok, tr.card, tr.v, tr.tool, tr.speak], [true, 'trip', 1, 'plan_trip', r.speak]);
  assert.ok(Number.isInteger(tr.metrics.ms));
  const d = ev.decision(r.data);
  assert.deepEqual([d.best, d.states[0].key, d.reason], [r.data.best, 'rain', r.data.ranking.reason]);
  assert.ok(d.options.every((o) => 'minutes' in o && 'cost' in o), 'options 帶決策欄位');
});

test('mergeStates：auto 優先、同 key 去重、保留來源', () => {
  const s = mergeStates({ auto: [{ key: 'rain', from: 'weather_now' }], user: ['luggage', 'rain'], picked: ['budget', 'luggage'] });
  assert.deepEqual(s.map((x) => [x.key, x.source]), [['rain', 'auto'], ['luggage', 'user'], ['budget', 'picked']]);
});
