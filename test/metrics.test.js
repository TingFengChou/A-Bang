// 計量（M3-13）：callTool 回傳 metrics；TDX／CWA 呼叫數、快取命中、筆數；同時進行的呼叫互不干擾；MCP 放在 _meta
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { measure, countRecords, recordFetch } from '../core/metrics.js';
import { createTdxClient } from '../core/tdx-client.js';
import { createCwaClient } from '../core/cwa-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { createMcpServer } from '../mcp/create-server.js';

test('countRecords：陣列、包裝物件、CWA records', () => {
  assert.deepEqual([countRecords([1, 2, 3]), countRecords({ Sections: [1, 2] }), countRecords({ records: { Station: [1, 2, 3, 4] } }), countRecords({ a: 1 }), countRecords(null)], [3, 2, 4, 1, 0]);
  recordFetch({ cacheHit: false, data: [1] }); // 不在 measure 範圍內：不丟錯
});

test('TDX：第一次上游、第二次快取；同時進行的 measure 各自計算', async () => {
  const fetchImpl = async (url) => (String(url).includes('/token')
    ? new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }))
    : new Response(JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }])));
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
  const first = await measure(() => tdx.get('/x', {}, 60));
  assert.deepEqual({ ...first.metrics, ms: 0 }, { calls: 1, cacheHits: 0, cacheHit: false, scanned: 3, ms: 0 });
  const [a, b] = await Promise.all([
    measure(async () => { await tdx.get('/x', {}, 60); await tdx.get('/x', {}, 60); }),
    measure(() => tdx.get('/y', {}, 60)),
  ]);
  assert.deepEqual([a.metrics.calls, a.metrics.cacheHits, a.metrics.cacheHit], [2, 2, true]);
  assert.deepEqual([b.metrics.calls, b.metrics.cacheHits, b.metrics.scanned], [1, 0, 3]);
});

test('CWA：呼叫與快取都計量', async () => {
  const cwa = createCwaClient({ apiKey: 'K', fetchImpl: async () => new Response(JSON.stringify({ success: 'true', records: { Station: [1, 2] } })) });
  const { metrics } = await measure(async () => { await cwa.get('O-A0001-001'); await cwa.get('O-A0001-001'); });
  assert.deepEqual([metrics.calls, metrics.cacheHits, metrics.scanned], [2, 1, 4]);
});

test('callTool 回傳 metrics；示範模式沒有上游呼叫', async () => {
  const r = await callTool(createServices({ forceMock: true }), 'find_place', { query: '台北101' });
  assert.deepEqual([r.metrics.calls, r.metrics.scanned, r.metrics.cacheHit], [0, 0, false]);
  assert.ok(Number.isInteger(r.metrics.ms) && r.metrics.ms >= 0);
});

test('MCP：metrics 放在結果 _meta，不進 structuredContent', async () => {
  const server = createMcpServer(createServices({ forceMock: true }));
  const [x, y] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await Promise.all([server.connect(x), client.connect(y)]);
    const r = await client.callTool({ name: 'find_place', arguments: { query: '台北101' } });
    assert.equal(r._meta['abang/metrics'].calls, 0);
    assert.equal(r.structuredContent.metrics, undefined);
  } finally { await client.close(); await server.close(); }
});
