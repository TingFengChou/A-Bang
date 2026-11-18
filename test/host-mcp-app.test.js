// MCP Apps host（M4-04，CARDS.md §3）：以假的 App 驗證介面轉接；DOM 部分（確認框、連結框）由 E2E 覆蓋
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpAppHost, payloadOf } from '../public/ui/cards/host-mcp-app.js';

function fakeApp(caps = {}, { callResult, openResult = {} } = {}) {
  const calls = [];
  return {
    calls,
    getHostCapabilities: () => caps,
    callServerTool: async (p) => { calls.push(['callServerTool', p]); return callResult; },
    sendMessage: async (p) => { calls.push(['sendMessage', p]); return {}; },
    updateModelContext: async (p) => { calls.push(['updateModelContext', p]); return {}; },
    openLink: async (p) => { calls.push(['openLink', p]); return openResult; },
  };
}

test('payloadOf：回傳 structuredContent（卡片 tool 即 CardPayload）；isError 用 tool 的文字當錯誤訊息', () => {
  const p = { card: 'youbike', mode: 'demo', data: {} };
  assert.equal(payloadOf({ content: [], structuredContent: p }), p);
  assert.throws(() => payloadOf({ isError: true, content: [{ type: 'text', text: '找不到高鐵車站「火星」' }] }), /找不到高鐵車站/);
  assert.throws(() => payloadOf({ content: [{ type: 'text', text: '只有文字' }] }), /只有文字/);
  assert.deepEqual(payloadOf({ content: [], structuredContent: { data: { url: 'https://x' } } }), { data: { url: 'https://x' } }); // rail_booking_link 沒有卡片
  assert.throws(() => payloadOf(undefined), /沒有卡片/);
});

test('callTool 走 callServerTool；ask／setContext 只在 host 支援時送出', async () => {
  const p = { card: 'metro', mode: 'demo', data: {} };
  const app = fakeApp({ message: {}, updateModelContext: {} }, { callResult: { content: [], structuredContent: p } });
  const host = createMcpAppHost(app, { root: {}, confirm: async () => true });
  assert.equal(host.kind, 'mcp-app');
  assert.equal(await host.callTool('metro_live_board', { station: '台北車站' }), p);
  host.ask('307 往板橋下一班？');
  host.setContext('使用者在看「臺北車站」站');
  assert.deepEqual(app.calls.map(([m]) => m), ['callServerTool', 'sendMessage', 'updateModelContext']);
  assert.deepEqual(app.calls[0][1], { name: 'metro_live_board', arguments: { station: '台北車站' } });
  assert.deepEqual(app.calls[1][1], { role: 'user', content: [{ type: 'text', text: '307 往板橋下一班？' }] });

  const bare = fakeApp({});
  const h2 = createMcpAppHost(bare, { root: {}, confirm: async () => true });
  h2.ask('x'); h2.setContext('y');
  assert.equal(bare.calls.length, 0);
});

test('openLink：只開 https；L2 先確認，取消就不開；host 支援時用 app.openLink', async () => {
  const answers = [];
  const app = fakeApp({ openLinks: {} });
  const host = createMcpAppHost(app, { root: {}, confirm: async (text) => { answers.push(text); return answers.length > 1; } });
  await host.openLink('javascript:alert(1)');
  await host.openLink('https://irs.thsrc.com.tw/', { confirm: '要前往高鐵訂票網站嗎？' }); // 第一次取消
  assert.equal(app.calls.length, 0);
  await host.openLink('https://irs.thsrc.com.tw/', { confirm: '要前往高鐵訂票網站嗎？' }); // 第二次確認
  await host.openLink('https://maps.google.com/?q=1');
  assert.deepEqual(app.calls.map(([, p]) => p.url), ['https://irs.thsrc.com.tw/', 'https://maps.google.com/?q=1']);
  assert.deepEqual(answers, ['要前往高鐵訂票網站嗎？', '要前往高鐵訂票網站嗎？']);
});
