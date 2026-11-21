// 回答也在手機上寫（ADR-0017）：程式護欄 core/edge-write.js、請求 clientCaps 驗證、伺服器不呼叫模型、answer_draft 與事實清單、
// 防詐不改寫、前端 public/js/edge-write.js（外掛改寫、逾時、統計、回答上方那一行）、思考動畫的「在手機上寫回答」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRewrite, cleanRewrite, numbersIn, keyNumbers, worthRewriting, writePrompt, WRITE_INSTRUCTIONS } from '../core/edge-write.js';
import { runDemo, validateRequest, wantsEdgeWrite } from '../core/agent/run.js';
import { answerFacts } from '../core/agent/answer-facts.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { createServices } from '../core/index.js';
import { createAgentHandler } from '../server/agent.js';
import { thinkStart, thinkStep, thinkText } from '../public/js/agent/thinking.js';

const D = '選「公車 601」：省 270 元、不用等車。 601 約 7 分後到「民生捷運站(1號出口)」，走過去約 3 分。這可能是末班，早點出門；趕不上就叫車或騎 YouBike。';
const F = { intent: 'trip', demo: false, points: ['比了 5 種方式，建議公車 601。'], trip: { departAt: '08:00', best: { name: '公車 601', minutes: 32, cost: 15, arriveAt: '08:32' }, others: [{ name: '捷運', minutes: 30, cost: 25, arriveAt: '08:30' }] } };
const GOOD = '坐公車 601 最划算，省 270 元又不用等車！601 約 7 分後到「民生捷運站(1號出口)」，走過去約 3 分；這可能是末班，早點出門喔。';
const chk = (c, o = {}) => checkRewrite(c, { draft: D, facts: F, lang: 'zh', ...o });

// ───── 護欄 ─────
test('護欄：數字、時間、名稱都對的改寫通過', () => {
  const r = chk(GOOD);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, GOOD);
  assert.equal(chk(`「${GOOD}」`).text, GOOD, '整句被引號包住：拿掉');
  assert.ok(chk('坐公車 601 省 270 元、不用等車，約 32 分、08:32 到；601 約 7 分後到站，走過去約 3 分，這可能是末班。').ok, '事實清單裡的數字（32 分、08:32）可以用');
});

test('護欄：多出數字、漏掉關鍵數字、時間被改 → 不用', () => {
  assert.deepEqual(chk(GOOD.replace('約 7 分', '約 4 分')), { ok: false, reason: 'number', detail: '4' });
  assert.deepEqual(chk(GOOD.replace('，走過去約 3 分', '')), { ok: false, reason: 'missing', detail: '3' });
  assert.equal(chk(GOOD.replace('270', '2700')).reason, 'number');
  const d2 = '高鐵下一班 08:30 從台北開，09:15 到台中，票價 1,350 元。';
  const ok2 = (c) => checkRewrite(c, { draft: d2, facts: {}, lang: 'zh' });
  assert.ok(ok2('下一班高鐵 8:30 從台北出發、9:15 到台中，票價 1350 元。').ok, '8:30＝08:30、1350＝1,350');
  assert.ok(ok2('下一班高鐵 ０８：３０ 從台北出發、09:15 到台中，票價 1350 元。').ok, '全形數字也認得');
  assert.deepEqual(ok2('下一班高鐵 08:35 從台北出發、09:15 到台中，票價 1350 元。'), { ok: false, reason: 'time', detail: '8:35' });
  assert.equal(ok2('下一班高鐵 8 點半從台北出發、09:15 到台中，票價 1350 元。').reason, 'number', '把時間改成「8 點半」：8 不在資料裡');
  assert.equal(ok2('下一班高鐵從台北出發、09:15 到台中，票價 1350 元。').reason, 'missing', '漏了出發時間');
  assert.deepEqual(ok2('下一班高鐵 08:30 從台北開，09:15 到台中，票價 1350 元，再等兩分鐘就進站。'), { ok: false, reason: 'count', detail: '兩分鐘' }, '國字寫的數量也算多出來的數字');
  assert.ok(ok2('下一班高鐵 08:30 從台北開，09:15 到台中，票價 1350 元，這是下一班。').ok, '「下一班」不是數量');
});

test('護欄：說已經叫車、訂票、付款（ADR-0011）或投資建議 → 不用', () => {
  assert.equal(chk(`已經幫你叫好車了！${GOOD}`).reason, 'action');
  assert.equal(chk(`${GOOD}票我幫你訂好了。`).reason, 'action');
  assert.equal(chk(`${GOOD}已付款完成。`).reason, 'action');
  const s = '台積電 11/18 收 2175，漲 5（0.23%）。';
  assert.equal(checkRewrite('台積電 11/18 收 2175，漲 5（0.23%），建議你可以買進。', { draft: s }).reason, 'advice');
  assert.ok(checkRewrite('台積電 11/18 收盤 2175，漲 5（0.23%）。', { draft: s }).ok);
});

test('護欄：重要提醒（示範、末班）、引號裡的名稱、格式、長度', () => {
  assert.deepEqual(chk(GOOD.replace('這可能是末班，', '')), { ok: false, reason: 'keep', detail: 'last' });
  const demo = '（示範資料）公車 601 約 32 分到。';
  assert.equal(checkRewrite('公車 601 約 32 分到喔。', { draft: demo }).reason, 'keep');
  assert.ok(checkRewrite('這是示範資料：公車 601 約 32 分到喔。', { draft: demo }).ok);
  assert.deepEqual(chk(GOOD.replace('民生捷運站(1號出口)', '中山站(1號出口)')), { ok: false, reason: 'name', detail: '中山站(1號出口)' });
  assert.equal(chk(`${GOOD} 用 plan_trip 查的。`).reason, 'format');
  assert.equal(chk(`${GOOD} https://evil.example/x`).reason, 'format');
  assert.equal(chk('好').reason, 'empty');
  assert.equal(chk(GOOD.repeat(3)).reason, 'long');
  assert.equal(chk(`${GOOD} Have fun.`).reason, 'lang', '中文那一輪多出資料裡沒有的英文');
});

test('護欄：英文那一輪', () => {
  const d = 'From Ximending (西門町) to Taipei 101 (台北101), I compared 5 options. Best: Bus 601, about 32 min, NT$15, arriving 08:32.';
  const en = (c) => checkRewrite(c, { draft: d, facts: F, lang: 'en' });
  assert.ok(en('Bus 601 is your best bet from Ximending (西門町) to Taipei 101 (台北101): about 32 min for NT$15, arriving 08:32. I compared 5 options.').ok);
  assert.equal(en('Bus 601 from Ximending to Taipei 101 (台北車站): about 32 min, NT$15, arriving 08:32, out of 5 options.').reason, 'lang', '多出資料裡沒有的中文');
  assert.equal(en('Bus 601 from Ximending to Taipei 101: about 32 min, NT$15, arriving 08:32 (5 options); it comes in five minutes.').reason, 'count');
  assert.equal(en("I've booked Bus 601 for you: Taipei 101, about 32 min, NT$15, arriving 08:32, 5 options.").reason, 'action');
  assert.equal(en('Bus 601 to Taipei 101 takes about 32 min, NT$15, arriving 08:40 (5 options).').reason, 'time');
});

test('護欄：防詐 agent 一律不改寫', () => {
  const d = '這則訊息有詐騙特徵：要你點連結補運費。先不要照做，有疑問撥 165。';
  assert.deepEqual(checkRewrite(d, { draft: d, agent: 'antifraud' }), { ok: false, reason: 'agent' });
});

test('數字擷取、關鍵數字、清理、要不要改寫、給模型的輸入', () => {
  assert.deepEqual(numbersIn('2026-11-16 起：92 31.2、末班 22:32，1,350 元'), { times: ['22:32'], numbers: ['2026', '11', '16', '92', '31.2', '1350'] });
  assert.deepEqual(keyNumbers(D).numbers, ['601', '270', '7', '3'], '名稱括號裡的出口編號不算關鍵數字');
  assert.equal(cleanRewrite('改寫：坐公車 601。'), '坐公車 601。');
  assert.equal(cleanRewrite('「民生站」到了，再到「市府站」'), '「民生站」到了，再到「市府站」', '不是整句被包住就不拆');
  assert.equal(worthRewriting(D), true);
  assert.equal(worthRewriting('x'.repeat(300)), false);
  assert.equal(worthRewriting('1、2、3、4、5、6、7、8、9、10、11、12'), false);
  const p = writePrompt(D, F, 'zh');
  assert.match(p, /^草稿：選「公車 601」/);
  assert.match(p, /- 公車 601\n/);
  assert.match(WRITE_INSTRUCTIONS.zh, /不能改、不能少/);
  assert.match(WRITE_INSTRUCTIONS.en, /never say you booked/i);
});

// ───── 請求與伺服器 ─────
const msg = (q) => ({ messages: [{ role: 'user', content: q }] });
const CAPS = { clientCaps: { edgeWrite: true, engine: 'gemini-nano' } };

test('clientCaps：zod 驗證（只收布林與已知引擎，不收其他欄位）', () => {
  assert.deepEqual(validateRequest({ ...msg('hi'), ...CAPS }).clientCaps, CAPS.clientCaps);
  for (const bad of [{ edgeWrite: 'yes', engine: 'apple' }, { edgeWrite: true, engine: 'gpt' }, { edgeWrite: true, engine: 'apple', tools: ['x'] }, { edgeWrite: true }]) {
    assert.throws(() => validateRequest({ ...msg('hi'), clientCaps: bad }), /請求格式錯誤：clientCaps/);
  }
  assert.equal(wantsEdgeWrite({ clientCaps: { edgeWrite: true } }, 'life'), true);
  assert.equal(wantsEdgeWrite({ clientCaps: { edgeWrite: true } }, 'antifraud'), false);
  assert.equal(wantsEdgeWrite({}, 'life'), false);
});

const NOW = Date.parse('2026-11-18T08:00:00+08:00');
async function run(q, opts = {}, body = CAPS) {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { ...msg(q), ...body }, (e) => es.push(e), { now: NOW, mode: 'edge', ...opts });
  return es;
}

test('edge：送 answer_draft（程式版總結＋事實清單）、不送 text；事實清單不含座標', async () => {
  const es = await run('從西門町到台北 101 怎麼去？');
  assert.equal(es[0].mode, 'edge');
  assert.ok(!es.some((e) => e.type === 'text'));
  const d = es.find((e) => e.type === 'answer_draft');
  assert.deepEqual(es.slice(-2).map((e) => e.type), ['answer_draft', 'done']);
  assert.match(d.text, /^選「/);
  assert.equal(d.lang, 'zh');
  assert.equal(d.facts.intent, 'trip');
  assert.equal(d.facts.demo, true);
  assert.ok(d.facts.trip.best.name && Number.isFinite(d.facts.trip.best.minutes));
  const json = JSON.stringify(d.facts);
  assert.ok(!/"(lat|lon|from|to)"/.test(json), json);
  assert.ok(!/\d{2,3}\.\d{3,}/.test(json), `沒有座標：${json}`);
  assert.ok(checkRewrite(d.text, { draft: d.text, facts: d.facts }).ok, '程式版總結本身一定過得了護欄');
  // 同一題沒帶 clientCaps：照原本送 text
  const plain = await run('從西門町到台北 101 怎麼去？', { mode: 'demo' }, {});
  assert.equal(plain.find((e) => e.type === 'text').delta, d.text);
  assert.ok(!plain.some((e) => e.type === 'answer_draft'));
});

test('edge：英文那一輪 lang=en；安全情境照樣直接送 text（不交給手機改寫）', async () => {
  const en = await run('How do I get from Ximending to Taipei 101?');
  assert.equal(en.find((e) => e.type === 'answer_draft').lang, 'en');
  const safe = await run('我不想活了');
  assert.ok(safe.some((e) => e.type === 'text') && !safe.some((e) => e.type === 'answer_draft'));
});

test('edge：聽不懂時不退回伺服器模型，用 ask 給 2～4 個查得到的選項（按了送出的句子規則都聽得懂）', async () => {
  for (const [q, lang] of [['幫我寫一首關於秋天的詩', 'zh'], ['tell me a joke', 'en']]) {
    const es = await run(q);
    const a = es.find((e) => e.type === 'ask');
    assert.ok(a, q);
    assert.equal(a.about, 'unknown');
    assert.ok(a.options.length >= 2 && a.options.length <= 4);
    for (const o of a.options) {
      assert.equal(o.kind, 'reply');
      assert.notEqual(parseIntent(o.say).intent, 'unknown', `${o.label}：${o.say}`);
    }
    const d = es.find((e) => e.type === 'answer_draft');
    assert.equal(d.lang, lang);
    assert.ok(es.indexOf(a) < es.indexOf(d), '問句在回答前面');
    assert.ok(d.text.length <= 120 && !/試試看：「/.test(d.text), '選項在上面，回答只留一句短的（不再列一串例句）');
  }
  const thanks = await run('謝謝');
  assert.ok(!thanks.some((e) => e.type === 'ask'), '道謝不是聽不懂');
  const web = await run('幫我寫一首關於秋天的詩', { mode: 'demo' }, {});
  assert.ok(!web.some((e) => e.type === 'ask'), '網頁版（沒帶 clientCaps）照舊');
  assert.match(web.find((e) => e.type === 'text').delta, /^我可以幫你查交通/);
});

test('edge：防詐 agent 不改寫（照樣送 text，模式不是 edge）', async () => {
  const es = await run('你的包裹地址不完整，請點 https://tw388.xyz/p 補運費', { profileId: 'antifraud' });
  assert.equal(es[0].mode, 'demo');
  assert.ok(es.some((e) => e.type === 'text') && !es.some((e) => e.type === 'answer_draft'));
});

test('edge：判斷層不呼叫伺服器模型（完整版不跑，快速版定案）', async () => {
  let full = 0;
  const judge = Object.assign(async () => { full++; return { intent: 'trip', states: [], confidence: null, source: 'llm' }; }, { quick: async () => ({ intent: 'trip', states: [], confidence: null, source: 'rules' }) });
  await run('從西門町到台北 101 怎麼去？', { judge });
  assert.equal(full, 0);
  await run('從西門町到台北 101 怎麼去？', { judge, mode: 'demo' }, {});
  assert.equal(full, 1, '沒有 edge 時照舊');
});

test('handler：帶 edgeWrite 時不呼叫 provider（不論 LOCAL_LLM／Claude）、送 answer_draft；沒帶照舊用模型', async () => {
  let starts = 0;
  const provider = { mode: 'local', model: 'fake', start() { starts++; return { next: async () => ({ text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const logs = [];
  const h = createAgentHandler({ svc: createServices({ forceMock: true }), env: {}, provider, log: (o) => logs.push(o) });
  const call = async (body, agentId) => {
    const chunks = [];
    const res = { writableEnded: false, writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; } };
    await h.handle(res, body, agentId ? { agentId } : {});
    return chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  };
  const es = await call({ ...msg('從西門町到台北 101 怎麼去？'), ...CAPS });
  assert.equal(starts, 0, '伺服器沒有呼叫任何模型');
  assert.equal(h.usage('life').modelCalls, 0);
  assert.ok(es.some((e) => e.type === 'answer_draft') && !es.some((e) => e.type === 'text'));
  assert.equal(logs.at(-1).mode, 'edge');
  await call(msg('從西門町到台北 101 怎麼去？'));
  assert.ok(starts >= 1, '網頁版（沒帶 clientCaps）照舊用伺服器的模型');
  const before = starts;
  await call({ ...msg('這個網址安全嗎 https://tw388.xyz/p'), ...CAPS }, 'antifraud');
  assert.ok(starts > before, '防詐 agent 不交給手機寫，照舊');
});

// ───── 思考動畫 ─────
test('思考動畫：收到 answer_draft → 「在手機上寫回答」，回答出來就收起', () => {
  let s = thinkStep(thinkStart(), { type: 'tool_start', id: 't1', role: '行程' });
  s = thinkStep(s, { type: 'tool_result', id: 't1' });
  s = thinkStep(s, { type: 'answer_draft', text: 'x' });
  assert.equal(s.phase, 'write');
  assert.equal(thinkText(s).stage, '在手機上寫回答');
  assert.equal(thinkText(s, 'en').stage, 'Writing the answer on your phone');
  assert.equal(thinkStep(s, { type: 'text', delta: 'y' }).phase, 'end');
});

// ───── 前端（public/js/edge-write.js）：假的 Capacitor 外掛 ─────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const W = await import('../public/js/edge-write.js');
function fakeCap({ status = { available: true, engine: 'gemini-nano', reason: 'ok', write: true }, write } = {}) {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method, args) => { calls.push({ plugin, method, args }); return method === 'status' ? Promise.resolve(status) : method === 'write' ? write(args) : Promise.reject(new Error('no')); },
  };
  W._resetEdgeWrite();
  return calls;
}
const DRAFT = { type: 'answer_draft', text: D, facts: F, lang: 'zh' };

test('前端：外掛可用且支援 write 才帶 clientCaps；開關關掉、網頁版、舊版外掛不帶', async () => {
  delete globalThis.Capacitor;
  W._resetEdgeWrite();
  assert.equal(await W.edgeWriteCaps(), null, '網頁版');
  fakeCap();
  assert.deepEqual(await W.edgeWriteCaps(), { edgeWrite: true, engine: 'gemini-nano' });
  fakeCap({ status: { available: true, engine: 'apple', reason: 'ok' } });
  assert.equal(await W.edgeWriteCaps(), null, '舊版外掛沒有 write');
  fakeCap();
  W.setEdgeWriteEnabled(false);
  assert.equal(await W.edgeWriteCaps(), null, '使用者關掉');
  W.setEdgeWriteEnabled(true);
  store.set('abang.edgeAI', 'off');
  assert.equal(await W.edgeWriteCaps(), null, '裝置端 AI 整個關掉');
  store.delete('abang.edgeAI');
});

test('前端：手機改寫通過 → 用改寫；數字被改 → 程式版；逾時 → 程式版；統計只記數字', async () => {
  store.clear();
  const calls = fakeCap({ write: async () => ({ engine: 'gemini-nano', ms: 640, text: GOOD }) });
  const ok = await W.edgeWrite(DRAFT, { engine: 'gemini-nano' });
  assert.deepEqual({ by: ok.by, text: ok.text, ms: ok.ms }, { by: 'edge', text: GOOD, ms: 640 });
  const sent = calls.find((c) => c.method === 'write').args;
  assert.equal(sent.draft, D);
  assert.match(sent.prompt, /草稿：/);
  assert.equal(sent.lang, 'zh');
  assert.equal(W.writeLine(ok), '這次的回答由手機上的 Gemini Nano 寫。', '只有寫回答、沒有手機判斷');
  assert.equal(W.writeLine(ok, null, { judged: true }), '手機上的 Gemini Nano 聽懂你的問題，也寫了這次的回答。', '判斷與寫回答合成一行');
  assert.equal(W.writeLine(ok, 'en', { judged: true }), 'Gemini Nano on your phone understood your question and wrote this answer.');
  assert.equal(W.writeLine({ ...ok, engine: 'apple' }, null, { judged: true }), '手機上的 Apple Intelligence 聽懂你的問題，也寫了這次的回答。', 'iPhone 照實寫');

  fakeCap({ write: async () => ({ engine: 'gemini-nano', ms: 500, text: GOOD.replace('約 7 分', '約 4 分') }) });
  const bad = await W.edgeWrite(DRAFT, { engine: 'gemini-nano' });
  assert.deepEqual({ by: bad.by, reason: bad.reason, text: bad.text }, { by: 'program', reason: 'check', text: D });
  assert.equal(W.writeLine(bad, null, { judged: true }), '手機上的 Gemini Nano 聽懂你的問題；回答用阿幫的固定說法（沒通過檢查）。');
  assert.equal(W.writeLine(bad), '這次的回答用阿幫的固定說法（沒通過檢查）。');

  fakeCap({ write: () => new Promise((r) => setTimeout(() => r({ engine: 'gemini-nano', text: GOOD }), 200)) });
  const slow = await W.edgeWrite(DRAFT, { engine: 'gemini-nano', timeout: 30 });
  assert.deepEqual({ by: slow.by, reason: slow.reason, text: slow.text }, { by: 'program', reason: 'timeout', text: D });
  assert.equal(W.writeLine(slow, null, { judged: true }), '手機上的 Gemini Nano 聽懂你的問題；回答用阿幫的固定說法（逾時）。');
  assert.equal(W.writeLine(slow, 'en', { judged: true }), "Gemini Nano on your phone understood your question; the answer uses Abang's standard wording (timed out).");
  assert.equal(W.writeLine(slow, 'en'), "This answer uses Abang's standard wording (timed out).");
  await new Promise((r) => setTimeout(r, 220));

  fakeCap({ write: async () => { throw new Error('write failed'); } });
  assert.equal((await W.edgeWrite(DRAFT)).reason, 'failed');
  assert.equal((await W.edgeWrite({ ...DRAFT, text: 'x'.repeat(300) })).reason, 'skip', '太長不改寫');
  assert.equal((await W.edgeWrite(DRAFT, { agent: 'antifraud' })).by, 'program', '防詐不改寫');

  const st = W.edgeWriteStats();
  assert.deepEqual({ today: st.today, lastMs: st.lastMs, tried: st.tried, passed: st.passed }, { today: 2, lastMs: 500, tried: 2, passed: 1 });
  assert.ok(!/601|民生/.test(store.get(W.WRITE_STATS_KEY)), '統計不含句子');
  delete globalThis.Capacitor;
});

test('事實清單：英文那一輪用英文的小幫手句子', async () => {
  const es = await run('How do I get from Ximending to Taipei 101?');
  const f = es.find((e) => e.type === 'answer_draft').facts;
  assert.equal(f.lang, 'en');
  assert.ok(f.points.some((p) => /AQI/.test(p)));
  assert.deepEqual(answerFacts({ intent: 'weather' }, {}), { intent: 'weather', lang: 'zh', demo: false, points: [] });
});
