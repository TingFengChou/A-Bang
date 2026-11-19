// 阿幫・防詐（M7-01／05）：示範意圖、事件流、L2 輸出護欄（示範與模型模式）、handler 以 agent id 計量
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { parseAntifraud } from '../core/agent/demo-antifraud.js';
import { applyOutputGuardrails } from '../core/agent/guardrails.js';
import { getProfile } from '../core/agents/index.js';
import { buildSystemPrompt } from '../core/agent/prompt.js';
import { createAgentHandler } from '../server/agent.js';

const svc = createServices({ forceMock: true });
const ask = (content) => ({ messages: [{ role: 'user', content }] });
async function run(fn) { const es = []; await fn((e) => es.push(e)); return es; }

test('示範意圖：可疑內容、只有網址、寄件號碼、是真的嗎', () => {
  assert.equal(parseAntifraud('您的包裹地址不完整，請點擊 https://x.top 補運費').intent, 'message');
  assert.deepEqual(parseAntifraud('這個網址安全嗎？ tw388.xyz').urls, ['tw388.xyz']);
  assert.equal(parseAntifraud('簡訊是 +63 912 345 6789 寄來的').sender, '+63 912 345 6789');
  assert.equal(parseAntifraud('解除分期付款是真的嗎？').query, '解除分期付款');
});

test('建議問題都產生完整事件流，且總結不保證安全、都有 165', async () => {
  const p = getProfile('antifraud');
  const want = ['scam_check_message', 'scam_check_message', 'scam_lookup_url', 'sms_sender_check', 'scam_myth_search'];
  for (const [i, q] of p.suggestions.entries()) {
    const es = await run((emit) => runDemo(svc, ask(q), emit, { profileId: 'antifraud' }));
    assert.deepEqual(es.map((e) => e.type).filter((t) => ['status', 'agent_note', 'tool_start', 'tool_result', 'discussion_end', 'text', 'done'].includes(t)),
      ['status', 'agent_note', 'tool_start', 'tool_result', 'discussion_end', 'text', 'done'], q);
    assert.equal(es.find((e) => e.type === 'tool_start').name, want[i], q);
    assert.equal(es.find((e) => e.type === 'tool_result').ok, true, q);
    const text = es.find((e) => e.type === 'text').delta;
    assert.match(text, /165/, q);
    assert.doesNotMatch(text.replace(/不代表一定安全/g, ''), /安全/, q);
  }
  const hi = await run((emit) => runDemo(svc, ask(p.suggestions[0]), emit, { profileId: 'antifraud' }));
  assert.equal(hi.find((e) => e.type === 'tool_result').card, 'scam-risk');
});

test('輸出護欄：保證安全的句子整句改寫並送 guardrail；否定句與生活 agent 不動', () => {
  const p = getProfile('antifraud');
  const g = applyOutputGuardrails(p, '這個網址是安全的，可以放心點開。我查過了。');
  assert.equal(g.text, '沒有發現已知的詐騙特徵，但不代表一定安全。我查過了。\n有疑問請撥打 165 反詐騙諮詢專線（免付費）查證。');
  assert.deepEqual(g.hits, [{ tier: 'L2', rule: 'no-safety-claim' }]);
  assert.deepEqual(applyOutputGuardrails(p, '沒有發現已知的詐騙特徵，但不代表一定安全。請撥 165。').hits, []);
  assert.equal(applyOutputGuardrails(p, '這網站安全嗎？要注意資訊安全性。請撥 165。').hits.length, 0);
  assert.equal(applyOutputGuardrails(getProfile('life'), '這條路很安全').text, '這條路很安全');
});

test('模型模式：模型說「安全」也會被改寫，送 guardrail 事件；system prompt 帶防詐護欄', async () => {
  const provider = { mode: 'local', model: 'fake', start: () => ({ next: async () => ({ text: '放心，這是安全的網站。', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }) };
  const es = await run((emit) => runModel(svc, ask('tw388.xyz 可以點嗎'), emit, { provider, profileId: 'antifraud' }));
  assert.deepEqual(es.find((e) => e.type === 'guardrail'), { type: 'guardrail', tier: 'L2', rule: 'no-safety-claim' });
  assert.doesNotMatch(es.find((e) => e.type === 'text').delta.replace(/不代表一定安全/g, ''), /安全|放心/);
  const sys = buildSystemPrompt(getProfile('antifraud'));
  assert.match(sys, /絕對不要說「安全」/);
  assert.doesNotMatch(sys, /plan_trip/);
});

test('handler：防詐 agent 以自己的 id 計量與限流', async () => {
  const h = createAgentHandler({ svc, env: {}, provider: null });
  const chunks = [];
  const res = { writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; }, writableEnded: false };
  await h.handle(res, ask('老師說保證獲利 30%'), { agentId: 'antifraud' });
  assert.equal(h.usage('antifraud').requests, 1);
  assert.equal(h.usage('life').requests, 0);
  assert.ok(chunks.join('').includes('"profile":"antifraud"'));
});
