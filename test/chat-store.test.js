// 問阿幫的對話留在手機：只存文字、最近 10 則、12 小時後清掉
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { saveChat, loadChat, clearChat, CHAT_TTL_MS, CHAT_MAX } = await import('../public/js/chat-store.js');
beforeEach(() => mem.clear());

test('只存使用者與阿幫的文字、最近 10 則、每則最多 500 字', () => {
  const msgs = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第 ${i} 則`, extra: { lat: 25 } }));
  msgs.push({ role: 'system', content: '不存' }, { role: 'user', content: 'x'.repeat(800) });
  saveChat(msgs, 1000);
  const v = loadChat(2000);
  assert.equal(v.messages.length, CHAT_MAX);
  assert.ok(v.messages.every((m) => Object.keys(m).join() === 'role,content'), '不存其他欄位（座標等）');
  assert.equal(v.messages.at(-1).content.length, 500);
  assert.ok(!v.messages.some((m) => m.role === 'system'));
});

test('12 小時後過期並清掉；壞掉的資料當作沒有；清除', () => {
  saveChat([{ role: 'user', content: '去台北 101' }], 0);
  assert.ok(loadChat(CHAT_TTL_MS - 1));
  assert.equal(loadChat(CHAT_TTL_MS + 1), null);
  assert.equal(mem.has('abang.chat'), false, '過期就清掉');
  mem.set('abang.chat', '{"at":1,"messages":[{"role":"hacker","content":1}]}');
  assert.equal(loadChat(2), null);
  saveChat([{ role: 'user', content: 'hi' }], 0);
  clearChat();
  assert.equal(loadChat(1), null);
  saveChat([], 0);
  assert.equal(mem.has('abang.chat'), false, '沒有對話就不存');
});
