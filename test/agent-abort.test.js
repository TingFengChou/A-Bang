// 架構第二輪 #1：一輪問阿幫的總時間上限、使用者斷線中止、一次最多幾個工具
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAgentHandler, TURN_TIMEOUT_MSG } from '../server/agent.js';
import { runModel, MAX_CALLS_PER_ROUND } from '../core/agent/model-loop.js';
import { createServices } from '../core/index.js';

const svc = createServices({ forceMock: true });
const ask = (q) => ({ messages: [{ role: 'user', content: q }] });
/** 假的串流回應：可以模擬斷線 */
function fakeRes() {
  const res = new EventEmitter();
  res.chunks = []; res.writableEnded = false;
  res.writeHead = () => {}; res.write = (c) => { res.chunks.push(c); }; res.end = () => { res.writableEnded = true; };
  res.events = () => res.chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return res;
}

test('整輪超過上限：送「查太久了」＋done、log 記 TurnTimeout，之後不再送事件', async () => {
  const logs = [];
  let calls = 0;
  const provider = { mode: 'local', model: 'fake', start: () => ({ next: async () => { calls++; await new Promise((r) => setTimeout(r, 80)); return { text: '', calls: [{ id: `c${calls}`, name: 'weather_now', input: { lat: 25.04, lon: 121.51 } }], stop: 'tool', usage: { input: 1, output: 1 } }; }, addResults() {} }) };
  const h = createAgentHandler({ svc, env: { AGENT_TURN_MS: '50' }, provider, log: (o) => logs.push(o) });
  const res = fakeRes();
  await h.handle(res, ask('天氣怎樣'));
  const es = res.events();
  const err = es.find((e) => e.type === 'error');
  assert.equal(err?.message, TURN_TIMEOUT_MSG);
  assert.equal(es.at(-1).type, 'done');
  assert.equal(es.filter((e) => e.type === 'done').length, 1);
  assert.equal(logs.at(-1).error, 'TurnTimeout');
  assert.ok(calls <= 2, `模型最多再被呼叫一次（${calls}）`);
});

test('使用者斷線：不再開始新的模型呼叫，log 記 ClientClosed', async () => {
  const logs = [];
  let calls = 0;
  const res = fakeRes();
  const provider = { mode: 'local', model: 'fake', start: () => ({ next: async () => { calls++; if (calls === 1) setImmediate(() => res.emit('close')); await new Promise((r) => setTimeout(r, 10)); return { text: '', calls: [{ id: `c${calls}`, name: 'weather_now', input: { lat: 25.04, lon: 121.51 } }], stop: 'tool', usage: { input: 1, output: 1 } }; }, addResults() {} }) };
  const h = createAgentHandler({ svc, env: {}, provider, log: (o) => logs.push(o) });
  await h.handle(res, ask('天氣怎樣'));
  assert.equal(logs.at(-1).error, 'ClientClosed');
  assert.equal(calls, 1);
});

test(`模型一次要求超過 ${MAX_CALLS_PER_ROUND} 個工具：多的回錯誤、不查`, async () => {
  let round = 0, sent = null;
  const provider = { mode: 'local', model: 'fake', start: () => ({
    next: async () => (round++ === 0
      ? { text: '', calls: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: 'weather_now', input: { lat: 25 + i / 100, lon: 121.51 } })), stop: 'tool', usage: { input: 1, output: 1 } }
      : { text: '好了', calls: [], stop: 'end', usage: { input: 1, output: 1 } }),
    addResults(_t, r) { sent = r; },
  }) };
  const es = [];
  await runModel(svc, ask('天氣怎樣'), (e) => es.push(e), { provider });
  assert.equal(es.filter((e) => e.type === 'tool_start' && e.name === 'weather_now').length, MAX_CALLS_PER_ROUND);
  assert.equal(sent.filter((x) => x.isError && /一次最多查/.test(x.content)).length, 6 - MAX_CALLS_PER_ROUND);
});
