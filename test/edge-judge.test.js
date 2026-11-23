// 裝置端 AI 判斷（ADR-0014）：前端降級鏈（public/js/edge-judge.js）、伺服器採用規則（judge.js）、請求驗證（run.js）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EDGE_INTENTS, EDGE_STATES, EDGE_ENGINES, normalizeJudge, edgeJudge, edgeStatus, edgePrewarm, _resetEdge } from '../public/js/edge-judge.js';
import { runModel, INTENT_TOOLS } from '../core/agent/model-loop.js';
import { JUDGE_INTENTS, JUDGE_STATES, DEVICE_ENGINES, createJudge } from '../core/agent/judge.js';
import { validateRequest, runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';

/** 假的 Capacitor（只實作 AbangEdgeAI 外掛）；impl(method, args) 回 Promise */
function fakeCap(impl) {
  const calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: (plugin, method, args) => { calls.push({ plugin, method, args }); return impl(method, args); } };
  return calls;
}
afterEach(() => { delete globalThis.Capacitor; delete globalThis.localStorage; _resetEdge(); });

test('意圖、狀態、引擎與伺服器（judge.js）和 iOS 外掛（Swift）一致', async () => {
  assert.deepEqual(EDGE_INTENTS, Object.keys(JUDGE_INTENTS));
  assert.deepEqual(EDGE_STATES, JUDGE_STATES);
  for (const e of EDGE_ENGINES) assert.ok(DEVICE_ENGINES.includes(e), e);
  const swift = String(await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url)));
  const list = (name) => JSON.parse(swift.match(new RegExp(`let ${name} = (\\[[^\\]]*\\])`))[1]);
  assert.deepEqual(list('edgeIntents'), EDGE_INTENTS);
  assert.deepEqual(list('edgeStates'), EDGE_STATES);
  const java = String(await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url)));
  assert.match(java, /@CapacitorPlugin\(name = "AbangEdgeAI"\)/);
  assert.match(java, /"gemini-nano"/);
});

test('normalizeJudge：iOS 物件、Android JSON 字串（前後有字也行）、不認得的值一律不用', () => {
  assert.deepEqual(normalizeJudge({ intent: 'trip', states: ['rush', 'rush', 'fly'] }, 'apple'), { intent: 'trip', states: ['rush'], engine: 'apple' });
  assert.deepEqual(normalizeJudge('好的：{"intent":"weather","states":[]} 以上', 'gemini-nano'), { intent: 'weather', states: [], engine: 'gemini-nano' });
  assert.equal(normalizeJudge('{"intent":"order_pizza","states":[]}', 'gemini-nano'), null, '不在列舉裡的意圖');
  assert.equal(normalizeJudge('不是 JSON', 'gemini-nano'), null);
  assert.equal(normalizeJudge({ intent: 'trip', states: [] }, 'other-engine'), null, '不認得的引擎');
  assert.equal(normalizeJudge(null, 'apple'), null);
  assert.deepEqual(normalizeJudge('{"intent":"aqi","states":[]}\n{"intent":"trip","states":[]}', 'gemini-nano'), { intent: 'aqi', states: [], engine: 'gemini-nano' }, '兩個物件取第一個');
  assert.deepEqual(normalizeJudge({ intent: 'trip', states: 'rush' }, 'apple'), { intent: 'trip', states: [], engine: 'apple' }, 'states 不是陣列就當空');
});

test('edgeJudge：網頁版、關閉、外掛錯誤、逾時都回 null；成功時只帶意圖、狀態、引擎', async () => {
  assert.equal(await edgeJudge('去台北101'), null, '網頁版沒有 Capacitor');
  assert.deepEqual(await edgeStatus(), { available: false, reason: 'web' });

  const calls = fakeCap(async (m) => (m === 'judge' ? { engine: 'apple', result: { intent: 'trip', states: ['luggage'] } } : {}));
  assert.deepEqual(await edgeJudge('帶行李去松山機場', ['a', 'b', 'c']), { intent: 'trip', states: ['luggage'], engine: 'apple' });
  const args = calls.find((c) => c.method === 'judge').args;
  assert.deepEqual(args.history, ['b', 'c'], '只送最後 2 句前文');
  assert.ok(args.instructions.includes('bus_route') && args.intents.length === 16);

  fakeCap(() => Promise.reject(new Error('unavailable: disabled')));
  assert.equal(await edgeJudge('去台北101'), null, '外掛回錯誤');
  fakeCap(() => new Promise(() => {}));
  const t0 = Date.now();
  assert.equal(await edgeJudge('去台北101', [], { timeout: 50 }), null, '逾時不等');
  assert.ok(Date.now() - t0 < 1000);

  fakeCap(async () => ({ engine: 'apple', result: { intent: 'trip', states: [] } }));
  globalThis.localStorage = { getItem: (k) => (k === 'abang.edgeAI' ? 'off' : null) };
  assert.equal(await edgeJudge('去台北101'), null, '使用者關閉裝置端 AI');
});

test('判斷層採用裝置提示：A 沒把握時用裝置的意圖、不呼叫伺服器模型；伺服器有模型時以伺服器模型為準', async () => {
  const fake = (r) => async () => r;
  let llmCalls = 0;
  const llm = async () => { llmCalls++; return { intent: 'bus_route', states: [] }; };
  const device = { intent: 'metro', states: ['rush'], engine: 'gemini-nano' };
  const unsure = fake({ intent: 'bus_route', confidence: 0.5, states: ['rush'] });

  const j1 = await createJudge({ embed: unsure })('那班車還要等多久', [], { device });
  assert.equal(j1.intent, 'metro');
  assert.equal(j1.source, 'device');
  assert.equal(j1.engine, 'gemini-nano');
  assert.deepEqual(j1.states, ['rush'], '狀態＝規則 ∪（A ∩ 裝置）');

  const sure = await createJudge({ embed: fake({ intent: 'stock', confidence: 0.95, states: [] }) })('台積電多少', [], { device: { ...device, intent: 'fuel' } });
  assert.equal(sure.intent, 'stock', 'A 有把握時用 A');

  const j2 = await createJudge({ embed: unsure, llm })('那班車還要等多久', [], { device });
  assert.equal(llmCalls, 1);
  assert.equal(j2.intent, 'bus_route', '伺服器有模型（B）時完整版用 B');
  const q = await createJudge({ embed: unsure, llm }).quick('那班車還要等多久', [], { device });
  assert.equal(q.intent, 'metro', '快速版仍用裝置提示（不花伺服器模型）');
  assert.equal(llmCalls, 1);

  const rulesOnly = await createJudge()('那班車還要等多久', [], { device });
  assert.equal(rulesOnly.source, 'device', '伺服器沒有分類器時用規則＋裝置');
});

test('腦袋審查 #3：規則有明確關鍵字（「板南線下一班幾分」是捷運）時，手機或伺服器模型說別的也照規則', async () => {
  const llm = async () => ({ intent: 'bus_route', states: [] });
  const j = await createJudge({ llm })('板南線下一班幾分', [], { device: { intent: 'trip', states: [], engine: 'gemini-nano' } });
  assert.deepEqual([j.intent, j.source], ['metro', 'rules']);
  const k = await createJudge({ llm })('板南線下一班幾分', []);
  assert.deepEqual([k.intent, k.source], ['metro', 'rules']);
});

test('請求驗證：deviceJudge 只收列舉值；示範模式（伺服器沒有判斷層）也會採用並在 status 標出來源', async () => {
  const base = { messages: [{ role: 'user', content: '今天空氣好嗎' }] };
  assert.throws(() => validateRequest({ ...base, deviceJudge: { intent: 'hack', states: [], engine: 'apple' } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ ...base, deviceJudge: { intent: 'aqi', states: ['admin'], engine: 'apple' } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ ...base, deviceJudge: { intent: 'aqi', states: [], engine: 'gpt' } }), /請求格式錯誤/);
  assert.ok(validateRequest({ ...base, deviceJudge: { intent: 'aqi', states: [], engine: 'apple' } }));

  const es = [];
  await runDemo(createServices({ forceMock: true }), { ...base, clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0478, lon: 121.517 } }], deviceJudge: { intent: 'aqi', states: [], engine: 'apple' } }, (e) => es.push(e), { judge: null });
  const st = es.find((e) => e.type === 'status');
  assert.deepEqual(st.judge, { intent: 'aqi', source: 'device', engine: 'apple' });
  assert.ok(es.some((e) => e.type === 'tool_start' && e.name === 'aqi_nearby'));
});

test('斷路器：上一題原生端還沒跑完就不等也不排隊、晚到的結果丟掉；外掛說不可用就不再試；prewarm 失敗不丟錯', async () => {
  let release;
  const calls = fakeCap((m) => (m === 'judge' ? new Promise((r) => { release = () => r({ engine: 'apple', result: { intent: 'trip', states: [] } }); }) : Promise.reject(new Error('x'))));
  edgePrewarm(); // reject 不會變成未處理的錯誤
  assert.equal(await edgeJudge('去台北101', [], { timeout: 30 }), null, '冷啟動逾時');
  assert.equal(await edgeJudge('改坐公車', [], { timeout: 30 }), null, '上一題還在跑：不呼叫');
  assert.equal(calls.filter((c) => c.method === 'judge').length, 1);
  release();
  await new Promise((r) => setTimeout(r, 0));
  const p = edgeJudge('會下雨嗎', [], { timeout: 1000 });
  release();
  assert.deepEqual(await p, { intent: 'trip', states: [], engine: 'apple' }, '跑完後恢復呼叫（拿到的是這一題的結果）');

  _resetEdge();
  const c2 = fakeCap(() => Promise.reject(new Error('unavailable: disabled')));
  assert.equal(await edgeJudge('去台北101'), null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(await edgeJudge('去台北101'), null);
  assert.equal(c2.length, 1, '不可用之後不再呼叫外掛');
});

test('模型模式帶 deviceJudge：伺服器沒有判斷層時用裝置意圖縮小地端模型的工具；防詐 agent 忽略裝置判斷', async () => {
  const svc = createServices({ forceMock: true });
  const seen = {};
  const provider = { mode: 'local', model: 'fake', start({ tools }) { seen.tools = tools.map((t) => t.name); return { next: async () => ({ text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const es = [];
  await runModel(svc, { messages: [{ role: 'user', content: '板南線下一班幾分' }], deviceJudge: { intent: 'metro', states: [], engine: 'gemini-nano' } }, (e) => es.push(e), { provider, judge: null });
  const given = seen.tools.filter((n) => n !== 'device_location');
  assert.ok(given.includes('metro_live_board') && given.every((n) => INTENT_TOOLS.metro.includes(n)), given.join());
  assert.deepEqual(es.find((e) => e.type === 'status').judge, { intent: 'metro', source: 'device', engine: 'gemini-nano' });

  const fr = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '這則簡訊說我中獎了 http://x.y' }], deviceJudge: { intent: 'trip', states: [], engine: 'apple' } }, (e) => fr.push(e), { profileId: 'antifraud', judge: null });
  assert.equal(fr.find((e) => e.type === 'status').judge, undefined, '防詐 agent 不用判斷層');
});

test('伺服器沒有分類器（A）時：意圖用裝置、狀態只看規則', async () => {
  const j = await createJudge()('這附近空氣好嗎，我在趕時間', [], { device: { intent: 'aqi', states: ['badAir', 'luggage'], engine: 'apple' } });
  assert.equal(j.intent, 'aqi');
  assert.ok(!j.states.includes('luggage'), '裝置單獨說的狀態不採用');
  assert.ok(j.states.includes('rush'), '規則抓到的狀態照用');
});

test('伺服器 log：記判斷來源與收到的手機引擎，不記對話內容', async () => {
  const { createAgentHandler } = await import('../server/agent.js');
  const logs = [];
  const h = createAgentHandler({ svc: createServices({ forceMock: true }), env: {}, provider: null, log: (o) => logs.push(o) });
  const res = { writableEnded: false, writeHead() {}, write() {}, end() { this.writableEnded = true; } };
  await h.handle(res, { messages: [{ role: 'user', content: '今天油價多少' }], deviceJudge: { intent: 'fuel', states: [], engine: 'gemini-nano' } });
  assert.equal(logs[0].judge, 'device');
  assert.equal(logs[0].device, 'gemini-nano');
  assert.ok(!JSON.stringify(logs).includes('油價'), 'log 不記對話內容');
});
