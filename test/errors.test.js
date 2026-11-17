// 錯誤對外訊息：UserError 回原訊息；上游或程式錯誤只回通用訊息，不洩漏上游回應或檔案路徑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { UserError, publicMessage, INTERNAL_ERROR_MSG } from '../core/util.js';
import { TdxError } from '../core/tdx-client.js';
import { createServices } from '../core/index.js';
import { createMcpServer } from '../mcp/create-server.js';

const LEAK = 'TDX API 錯誤 500：<html>/Users/someone/secret/path</html>';

test('publicMessage：UserError 原樣、其他一律通用訊息', () => {
  assert.equal(publicMessage(new UserError('找不到車站')), '找不到車站');
  assert.equal(publicMessage(new TdxError(500, LEAK)), INTERNAL_ERROR_MSG);
  assert.equal(publicMessage(new Error('ENOENT: /Users/x/node_modules/y')), INTERNAL_ERROR_MSG);
});

test('MCP：上游錯誤回 isError＋通用訊息，細節不給 client', async () => {
  const svc = createServices({ forceMock: true });
  svc.weather = { now: async () => { throw new TdxError(500, LEAK); } };
  const server = createMcpServer(svc);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  const origError = console.error;
  console.error = () => {}; // 伺服器 log 照常，但測試輸出不要噪音
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: 'weather_now', arguments: { lat: 25.0478, lon: 121.517 } });
    assert.equal(r.isError, true);
    assert.equal(r.content[0].text, INTERNAL_ERROR_MSG);
    const bad = await client.callTool({ name: 'thsr_timetable', arguments: { from: '火星', to: '左營' } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /找不到高鐵車站/);
  } finally {
    console.error = origError;
    await client.close();
    await server.close();
  }
});
