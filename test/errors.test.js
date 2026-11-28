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

test('上游錯誤：丟錯的地方明確標了 publicMsg 才給使用者看，不含網址、上游回應、設定名稱（架構第三輪 #6）', async () => {
  const { shown } = await import('../core/util.js');
  const { createTdxClient } = await import('../core/tdx-client.js');
  const { createOpenDataClient } = await import('../core/opendata-client.js');
  assert.equal(publicMessage(shown(new TdxError(503, '捷運車站資料暫時查不到，請稍後再試'))), '捷運車站資料暫時查不到，請稍後再試');
  assert.equal(publicMessage(shown(new TdxError(500, LEAK), '交通資料暫時無法取得')), '交通資料暫時無法取得');
  assert.equal(publicMessage(new TdxError(500, LEAK)), INTERNAL_ERROR_MSG, '沒標照舊通用');
  // TDX：上游回應內容只進 log
  const body = 'secret-upstream-body https://tdx.example/?token=abc';
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', limit: { concurrent: 3, gapMs: 0, retryMs: 1, waitMs: 0 }, fetchImpl: async (u) => (String(u).includes('/token') ? new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 })) : new Response(body, { status: 500 })) });
  const e = await tdx.get('/basic/v2/Bus/Route/City/Taipei', {}).catch((x) => x);
  assert.match(e.message, /secret-upstream-body/, 'log 看得到細節');
  assert.equal(publicMessage(e), '交通資料（TDX）現在連不上，這次查不到；急的話可以先看官方的交通 App。');
  // 開放資料：說是哪個資料、要不要等；解析錯誤的細節不給
  const od = createOpenDataClient({ fetchImpl: async () => new Response('<html>oops', { status: 200 }), now: () => 0 });
  const bad = await od.get('https://x.example/p.json', { ttlSec: 60, label: '健保藥局資料', as: 'json' }).catch((x) => x);
  assert.equal(publicMessage(bad), '健保藥局資料的資料格式有變，阿幫暫時讀不到。');
  assert.doesNotMatch(publicMessage(bad), /oops|Unexpected|x\.example/);
  const down = createOpenDataClient({ fetchImpl: async () => { throw new Error('ECONNREFUSED 10.0.0.1:443'); }, now: () => 0 });
  const de = await down.get('https://x.example/q', { ttlSec: 60, label: '油價' }).catch((x) => x);
  assert.equal(publicMessage(de), '油價現在連不上，這次查不到。');
});

test('給使用者看的上游錯誤：沒有重置時間就不說「請稍後再試」（Antigravity 第四輪文案原則）', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['core/util.js', 'core/tdx-client.js', 'core/opendata-client.js', 'core/cwa-client.js', 'core/services/weather.js', 'core/tools/metro.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /請稍後再試/, f);
  }
});

test('降級文案總檢（第十三輪）：使用者看得到的字不說「稍後再試／再問／再查」，給現在就能做的事', async () => {
  const { readFileSync } = await import('node:fs');
  const files = ['core/tdx-client.js', 'core/tools/transit.js', 'core/services/trip.js', 'core/agent/demo-summary.js', 'server/agent.js',
    'public/js/voice-i18n.js', 'public/js/health.js', 'public/js/location-help.js', 'public/js/pages/bus-i18n.js', 'public/js/pages/rail.js',
    'public/js/pages/settings.js', 'public/js/pages/agent.js', 'public/ui/cards/i18n/zh-TW.js'];
  for (const f of files) {
    const code = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); // 註解不算
    assert.doesNotMatch(code, /稍後再?(試|問|查)|稍後'|等一下再問/, f);
  }
});
