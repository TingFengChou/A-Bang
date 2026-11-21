// 模型模式（M5-05，ADR-0012）：以本機假 API 測 Claude（SDK＋SSE）與地端模型（OpenAI 相容）的工具迴圈、
// agent_note 轉換、錯誤、5 輪上限、裝置定位、預算降級與模式選擇。不連外、不需要金鑰。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { runModel, FALLBACK, dropNulls, modelText, MODEL_LIST_MAX } from '../core/agent/model-loop.js';
import { createClaudeProvider } from '../core/agent/claude.js';
import { createLocalProvider, stripThink, LocalModelError } from '../core/agent/local.js';
import { pickProvider } from '../core/agent/provider.js';
import { createAgentHandler } from '../server/agent.js';
import { createServices } from '../core/index.js';
import { MAX_TOOL_ROUNDS } from '../core/agent/run.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');
const svc = createServices({ forceMock: true });
const types = (es) => es.map((e) => e.type);

// ── 假 API 伺服器：依序回應 script；記錄每次請求 ──
let server, BASE;
const state = { script: [], reqs: [], headers: [] };
const reset = (script) => { state.script = script; state.reqs = []; state.headers = []; };

/** Claude SSE：text（選填）＋ tool_use 區塊 */
function claudeEvents({ text, tools = [], stop = tools.length ? 'tool_use' : 'end_turn' }) {
  const out = [{ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } }];
  let i = 0;
  if (text) {
    out.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: i });
    i++;
  }
  for (const t of tools) {
    out.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: t.id, name: t.name, input: {} } },
      { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(t.input ?? {}) } }, { type: 'content_block_stop', index: i });
    i++;
  }
  out.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: 'message_stop' });
  return out;
}

before(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    state.reqs.push(body);
    state.headers.push(req.headers);
    const step = state.script.shift() ?? { text: '（腳本用完）' };
    const spec = typeof step === 'function' ? step(body) : step;
    if (spec.status) {
      res.writeHead(spec.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }));
    }
    if (req.url.startsWith('/v1/messages')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of claudeEvents(spec)) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      return res.end();
    }
    // OpenAI 相容 /v1/chat/completions
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: spec.message, finish_reason: spec.finish ?? (spec.message.tool_calls ? 'tool_calls' : 'stop') }], usage: { prompt_tokens: 50, completion_tokens: 10 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const claude = () => createClaudeProvider({ model: 'claude-haiku-5-5', client: new Anthropic({ apiKey: 'test-key', baseURL: BASE, maxRetries: 0 }) });
const local = (o = {}) => createLocalProvider({ url: `${BASE}/v1/`, model: 'test-local', ...o });
async function run(provider, content, body = {}) {
  const events = [];
  await runModel(svc, { messages: [{ role: 'user', content }], ...body }, (e) => events.push(e), { provider, now: NOW });
  return events;
}

// ── Claude ──

test('Claude：工具前的文字 → agent_note、工具事件與 decision、最後一輪文字 → text、done 帶 token', async () => {
  reset([
    { text: '@地點 先確認兩個地點', tools: [{ id: 'tu1', name: 'find_place', input: { query: '西門町' } }, { id: 'tu2', name: 'find_place', input: { query: '台北101' } }] },
    { text: '@行程 幫你比較幾種走法', tools: [{ id: 'tu3', name: 'plan_trip', input: { from: '西門町', to: '台北101' } }] },
    { text: '建議搭捷運，大約 20 分鐘。要我幫你開導航嗎？' },
  ]);
  const es = await run(claude(), '從西門町到台北 101 怎麼去？', { userState: { picked: ['budget'] } });
  // 起訖點都知道 → 程式先比較（plan_trip），想省錢 → 決策選公車 → 阿幫自動盯上車站（L-14：不靠模型記得要查）；
  // 模型之後用同樣條件呼叫 plan_trip 沿用結果（不再出現第二張卡片）
  assert.deepEqual(types(es), ['status', 'tool_start', 'tool_result', 'decision', 'agent_note', 'tool_start', 'tool_result', 'agent_note', 'tool_start', 'tool_start', 'tool_result', 'tool_result', 'agent_note', 'discussion_end', 'text', 'done']);
  assert.match(es[4].text, /^@公車 你選了公車，我幫你盯/);
  assert.equal(es[6].tool, 'bus_route_eta');
  assert.equal(es[6].card, 'bus-route');
  assert.ok(es[6].data.focus, '卡片聚焦上車站');
  assert.equal(es.filter((e) => e.type === 'decision').length, 1);
  assert.deepEqual(es.find((e) => e.type === 'discussion_end').tools.sort(), ['bus_route_eta', 'find_place', 'plan_trip']);
  assert.deepEqual([es[0].mode, es[0].model], ['claude', 'claude-haiku-5-5']);
  assert.equal(es[7].text, '@地點 先確認兩個地點');
  assert.ok(es.filter((e) => e.type === 'tool_result').every((e) => e.ok && e.speak));
  // 使用者點選的狀態一律交給 plan_trip（模型沒帶也會補上）
  assert.ok(es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').args.prefs.states.includes('budget'));
  assert.ok(es.find((e) => e.type === 'decision').states.some((s) => s.key === 'budget' && s.source === 'picked'));
  assert.equal(es.at(-2).delta, '建議搭捷運，大約 20 分鐘。要我幫你開導航嗎？');
  assert.deepEqual(es.at(-1).usage, { modelCalls: 3, inputTokens: 300, outputTokens: 60 });

  // 請求內容：工具由 registry 產生（無 $schema）、最後一個工具與 system 有快取斷點、回填只有文字摘要
  const [r0, r1] = state.reqs;
  assert.match(JSON.stringify(state.reqs[2]), /內部備註，不要照抄.+上車站即時到站已查好.+走到這個上車站約 \d+ 分.+到站前 3 分提醒我/, '盯到站的結果（含走到上車站的時間）接在 plan_trip 結果後面給模型');
  assert.equal(r0.model, 'claude-haiku-5-5');
  assert.ok(r0.tools.some((t) => t.name === 'plan_trip' && t.input_schema.type === 'object' && !('$schema' in t.input_schema)));
  assert.ok(!r0.tools.some((t) => t.name === 'device_location'), '客戶端沒說支援定位就不提供');
  assert.deepEqual(r0.tools.at(-1).cache_control, { type: 'ephemeral' });
  assert.match(r0.system[0].text, /平台政策[\s\S]*budget/);
  assert.equal(r0.output_config.effort, 'low');
  assert.equal(r1.messages[1].role, 'assistant');
  assert.ok(r1.messages[1].content.some((b) => b.type === 'tool_use' && b.id === 'tu1'));
  const results = r1.messages[2].content;
  assert.deepEqual(results.map((b) => b.tool_use_id), ['tu1', 'tu2']);
  assert.ok(results.every((b) => b.type === 'tool_result' && typeof b.content === 'string' && !b.is_error));
});

test('Claude：工具錯誤與不在白名單 → tool_result ok=false，回填 is_error，模型再回答', async () => {
  reset([
    { tools: [{ id: 'a', name: 'bus_route_eta', input: {} }, { id: 'b', name: 'metro_stations', input: { system: 'TRTC' } }] },
    { text: '抱歉，需要你告訴我路線號碼。' },
  ]);
  const es = await run(claude(), '公車到哪了');
  const rs = es.filter((e) => e.type === 'tool_result');
  assert.deepEqual(rs.map((e) => e.ok), [false, false]);
  assert.ok(!es.some((e) => e.type === 'agent_note'), '沒有前導文字就不送 agent_note');
  const back = state.reqs[1].messages.at(-1).content;
  assert.ok(back.every((b) => b.is_error === true));
  assert.match(back[1].content, /不能使用 metro_stations/);
  assert.equal(es.find((e) => e.type === 'text').delta, '抱歉，需要你告訴我路線號碼。');
});

test(`Claude：最多 ${MAX_TOOL_ROUNDS} 輪工具，之後改用固定總結`, async () => {
  reset(Array.from({ length: 10 }, (_, i) => ({ text: '再查一下', tools: [{ id: `r${i}`, name: 'find_place', input: { query: '台北車站' } }] })));
  const es = await run(claude(), '一直查');
  assert.equal(es.filter((e) => e.type === 'tool_start').length, MAX_TOOL_ROUNDS);
  assert.equal(state.reqs.length, MAX_TOOL_ROUNDS + 1);
  assert.equal(es.find((e) => e.type === 'text').delta, FALLBACK.rounds);
});

test('Claude：device_location → client_tool_call 後結束；帶定位重送時把座標回填給模型', async () => {
  const body = { clientTools: ['device_location'] };
  // 沒說起點的行程：程式在問模型之前就先請 App 定位（不靠模型記得呼叫）
  reset([{ text: '你從哪裡出發？' }]);
  const pre = await run(claude(), '我想去台北101', body);
  assert.deepEqual(types(pre), ['status', 'agent_note', 'client_tool_call', 'done']);
  assert.equal(state.reqs.length, 0, '還沒定位先不問模型');
  // 其他問題由模型自己決定要不要定位
  reset([{ text: '@定位 先看看你在哪', tools: [{ id: 'loc', name: 'device_location', input: {} }] }]);
  const first = await run(claude(), '附近有什麼好玩的', body);
  assert.deepEqual(types(first), ['status', 'agent_note', 'client_tool_call', 'done']);
  assert.equal(first[2].id, 'loc1');
  assert.ok(state.reqs[0].tools.some((t) => t.name === 'device_location'));

  reset([{ tools: [{ id: 'loc', name: 'device_location', input: {} }] }, { text: '你在台北車站附近。' }]);
  const again = await run(claude(), '我想去台北101', { ...body, clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0478, lon: 121.517 } }] });
  assert.ok(!again.some((e) => e.type === 'client_tool_call'));
  const back = state.reqs[1].messages.at(-1).content[0];
  assert.match(back.content, /你的位置/);
  assert.match(back.content, /25\.0478/);

  // 拒絕定位：回填 is_error，請模型改問起點
  reset([{ tools: [{ id: 'loc', name: 'device_location', input: {} }] }, { text: '你從哪裡出發呢？' }]);
  await run(claude(), '我想去台北101', { ...body, clientToolResults: [{ id: 'loc1', ok: false }] });
  assert.equal(state.reqs[1].messages.at(-1).content[0].is_error, true);
});

test('Claude：refusal 與 max_tokens 截斷時不執行工具，給固定說明', async () => {
  reset([{ text: '', stop: 'refusal' }]);
  assert.equal((await run(claude(), '？')).find((e) => e.type === 'text').delta, FALLBACK.refusal);
  reset([{ tools: [{ id: 'x', name: 'find_place', input: { query: '台' } }], stop: 'max_tokens' }]);
  const es = await run(claude(), '？');
  assert.ok(!es.some((e) => e.type === 'tool_start'));
  assert.equal(es.find((e) => e.type === 'text').delta, FALLBACK.truncated);

  reset([{ text: '從西門町搭', stop: 'max_tokens' }]);
  assert.equal((await run(claude(), '？')).find((e) => e.type === 'text').delta, `從西門町搭…（${FALLBACK.truncated}）`);
});

test('Claude：API 錯誤往上丟（APIError）；handler 轉成通用錯誤事件、可重試，log 只記錯誤類型', async () => {
  reset([{ status: 500 }]);
  await assert.rejects(run(claude(), '你好'), (e) => e instanceof Anthropic.APIError && e.status === 500);

  reset([{ status: 500 }]);
  const logs = [];
  const h = createAgentHandler({ svc, env: {}, provider: claude(), log: (o) => logs.push(o) });
  const es = await handle(h, '你好');
  const err = es.find((e) => e.type === 'error');
  assert.equal(err.retryable, true);
  assert.doesNotMatch(err.message, /boom|500/);
  assert.equal(es.at(-1).type, 'done');
  assert.equal(logs[0].mode, 'claude');
  assert.match(logs[0].error, /500/);
  assert.ok(!JSON.stringify(logs).includes('你好'), 'log 不記對話內容');
});

/** 用假的 res 呼叫 handler，回傳事件 */
async function handle(h, content) {
  const chunks = [];
  const res = { writableEnded: false, writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; } };
  await h.handle(res, { messages: [{ role: 'user', content }] });
  return chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
}

test('預算：全站每日模型呼叫用完 → 降級示範模式並說明', async () => {
  reset([{ text: '你好，我是阿幫。' }]);
  const h = createAgentHandler({ svc, env: { AGENT_DAILY_BUDGET: '1' }, provider: claude() });
  assert.deepEqual(h.mode, { mode: 'claude', model: 'claude-haiku-5-5' });
  const a = await handle(h, '你好');
  assert.equal(a[0].mode, 'claude');
  assert.equal(h.usage().modelCalls, 1);
  const b = await handle(h, '307 到哪了？我在臺北車站');
  assert.equal(b[0].mode, 'demo');
  assert.match(b[1].text, /額度用完/);
  assert.equal(state.reqs.length, 1, '降級後不再呼叫模型');
});

// ── 地端模型（OpenAI 相容） ──

test('地端：tool_calls 迴圈、<think> 不外露、回填 role=tool、Authorization 只在設定時帶', async () => {
  reset([
    { message: { role: 'assistant', content: '<think>想一下</think>@地點 找台北車站', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_place', arguments: '{"query":"台北車站"}' } }] } },
    { message: { role: 'assistant', content: '<think>好</think>台北車站在中正區。' } },
  ]);
  const es = await run(local({ apiKey: 'local-key' }), '台北車站在哪');
  assert.deepEqual(types(es), ['status', 'agent_note', 'tool_start', 'tool_result', 'discussion_end', 'text', 'done']);
  assert.deepEqual([es[0].mode, es[0].model], ['local', 'test-local']);
  assert.equal(es[1].text, '@地點 找台北車站');
  assert.equal(es.find((e) => e.type === 'text').delta, '台北車站在中正區。');
  const [r0, r1] = state.reqs;
  assert.equal(r0.model, 'test-local');
  assert.equal(r0.messages[0].role, 'system');
  assert.ok(r0.tools.every((t) => t.type === 'function' && t.function.parameters.type === 'object'));
  assert.equal(r1.messages.at(-2).tool_calls[0].function.arguments, '{"query":"台北車站"}');
  assert.deepEqual([r1.messages.at(-1).role, r1.messages.at(-1).tool_call_id], ['tool', 'c1']);
  assert.equal(state.headers[0].authorization, 'Bearer local-key');

  reset([{ message: { role: 'assistant', content: '你好' } }]);
  await run(local(), '你好');
  assert.equal(state.headers[0].authorization, undefined);
});

test('地端：參數不是 JSON → 不執行該工具，回填錯誤讓模型修正', async () => {
  reset([
    { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_place', arguments: '{query:台北' } }] } },
    { message: { role: 'assistant', content: '請再說一次地名。' } },
  ]);
  const es = await run(local(), '幫我找一個地方'); // 不是行程（只打地名會由程式先比較行程）
  assert.ok(!es.some((e) => e.type === 'tool_start'));
  assert.match(state.reqs[1].messages.at(-1).content, /不是有效的 JSON/);
});

test('地端：連線失敗或 HTTP 錯誤 → LocalModelError（訊息不含網址）', async () => {
  reset([{ status: 503 }]);
  await assert.rejects(run(local(), '你好'), (e) => e instanceof LocalModelError && /503/.test(e.message));
  await assert.rejects(run(createLocalProvider({ url: 'http://127.0.0.1:9/v1', model: 'm', timeoutMs: 2000 }), '你好'),
    (e) => e instanceof LocalModelError && !e.message.includes('127.0.0.1'));
});

test('dropNulls：模型送的 null／空字串視為沒給（地端小模型常見）', () => {
  assert.deepEqual(dropNulls({ from: '西門町', prefs: { arriveBy: null, states: ['rain', null] }, departAt: ' ' }), { from: '西門町', prefs: { states: ['rain'] } });
  assert.equal(dropNulls(3), 3);
});

test('地端：設定 reasoningEffort 時帶 reasoning_effort（Ollama 的推理模型可關閉思考）', async () => {
  reset([{ message: { role: 'assistant', content: '你好' } }, { message: { role: 'assistant', content: '你好' } }]);
  await run(local({ reasoningEffort: 'none' }), '你好');
  assert.equal(state.reqs[0].reasoning_effort, 'none');
  await run(local(), '你好');
  assert.ok(!('reasoning_effort' in state.reqs[1]));
});

test('stripThink：移除思考區塊（含只剩結尾標籤的情況）', () => {
  assert.equal(stripThink('<think>a\nb</think> 答案'), '答案');
  assert.equal(stripThink('前面的思考</think>答案'), '答案');
  assert.equal(stripThink(null), '');
});

// ── 模式選擇 ──

test('pickProvider：DEMO_MODE 優先、自動偵測、指定模式、設定錯誤時啟動就報錯', () => {
  const dm = { defaultModel: 'claude-haiku-5-5' };
  assert.equal(pickProvider({}, dm), null);
  assert.equal(pickProvider({ DEMO_MODE: '1', ANTHROPIC_API_KEY: 'k' }, dm), null);
  const c = pickProvider({ ANTHROPIC_API_KEY: 'k', LOCAL_LLM_URL: 'http://localhost:11434/v1', LOCAL_LLM_MODEL: 'm' }, dm);
  assert.deepEqual([c.mode, c.model], ['claude', 'claude-haiku-5-5']);
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' }, dm).model, 'claude-sonnet-5-5');
  const l = pickProvider({ LOCAL_LLM_URL: 'http://localhost:11434/v1', LOCAL_LLM_MODEL: 'breeze' }, dm);
  assert.deepEqual([l.mode, l.model], ['local', 'breeze']);
  assert.equal(pickProvider({ AGENT_PROVIDER: 'local', ANTHROPIC_API_KEY: 'k', LOCAL_LLM_URL: 'http://x/v1', LOCAL_LLM_MODEL: 'm' }, dm).mode, 'local');
  assert.equal(pickProvider({ AGENT_PROVIDER: 'demo', ANTHROPIC_API_KEY: 'k' }, dm), null);
  assert.throws(() => pickProvider({ AGENT_PROVIDER: 'gpt' }, dm), /AGENT_PROVIDER/);
  assert.throws(() => pickProvider({ AGENT_PROVIDER: 'claude' }, dm), /ANTHROPIC_API_KEY/);
  assert.throws(() => pickProvider({ AGENT_PROVIDER: 'local', LOCAL_LLM_URL: 'http://x' }, dm), /LOCAL_LLM_MODEL/);
  assert.throws(() => pickProvider({ LOCAL_LLM_URL: 'file:///etc/passwd', LOCAL_LLM_MODEL: 'm' }, dm), /http／https/);
});

test('modelText：有卡片的清單只回前幾筆並註明已用卡片顯示；沒有卡片照原文', () => {
  const items = Array.from({ length: 20 }, (_, i) => `- 藥局 ${i + 1}｜(02)1234｜地址`);
  const long = modelText({ card: 'pharmacy', speak: '找到 20 家。', text: items.join('\n') });
  assert.equal(long.split('\n').filter((l) => l.startsWith('- ')).length, MODEL_LIST_MAX);
  assert.match(long, /^找到 20 家。/);
  assert.match(long, /共 20 筆.+已用卡片顯示.+不要逐條列出/);
  const short = modelText({ card: 'fuel', speak: 'x', text: '中油牌價：\n- 92：31.2\n- 95：32.7' });
  assert.match(short, /^中油牌價：\n- 92：31\.2\n- 95：32\.7\n（以上已用卡片顯示/);
  assert.equal(modelText({ card: null, text: '- a\n- b' }), '- a\n- b', '沒有卡片（例如訂票連結）不改');
  assert.equal(modelText({ card: 'fuel' }), FALLBACK.empty);
});

test('發票：模型把「這期」放進 number → 視為只查中獎號碼（不報錯）', async () => {
  const { callTool } = await import('../core/tools/index.js');
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'invoice_lottery', { number: '這期' });
  assert.equal(r.data.check, undefined);
  assert.match(r.speak, /特別獎/);
  await assert.rejects(callTool(svc, 'invoice_lottery', { number: '12' }), /8 位數字/);
});

test('同一輪同一個目的地只出一張行程卡：模型換起點寫法或條件再查也沿用（模型模式情境 S2-5、P3-1、P3-9）', async () => {
  reset([
    { tools: [{ id: 'd1', name: 'plan_trip', input: { from: '西門町', to: { name: '台北101' } } }] },
    { text: '建議搭捷運。' },
  ]);
  const es = await run(claude(), '從西門町到台北101怎麼去？');
  assert.equal(es.filter((e) => e.type === 'decision').length, 1, '只有程式先查的那一張');
  assert.match(JSON.stringify(state.reqs[1]), /已查好/);
});

test('常用地點附近（「垃圾車幾點會到我家這邊」）：用家的座標先查，不先要定位（P3-2）', async () => {
  reset([{ text: '你家附近的垃圾車資訊在卡片上。' }]);
  const home = { lat: 25.0597, lon: 121.5440 };
  const es = await run(claude(), '今天垃圾車幾點會到我家這邊', { client: { location: true }, savedPlaces: { 家: { name: '我家', ...home } } });
  assert.ok(!es.some((e) => e.type === 'client_tool_call'), '不必先定位');
  const g = es.find((e) => e.type === 'tool_result' && e.tool === 'garbage_truck_nearby');
  assert.ok(g, '先查了垃圾車');
  assert.deepEqual([g.args.lat, g.args.lon], [home.lat, home.lon]);
});

test('同一輪：模型給對的地名、錯的座標（小模型常見）也不出第二張行程卡', async () => {
  reset([
    { tools: [{ id: 'd3', name: 'plan_trip', input: { from: '西門町', to: { lat: 25.0478, lon: 121.517, name: '台北101' } } }] },
    { text: '好。' },
  ]);
  const es = await run(claude(), '從西門町到台北101怎麼去？');
  assert.equal(es.filter((e) => e.type === 'decision').length, 1);
});
