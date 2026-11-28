// 「阿幫的腦袋」現場試判斷（#/ai）：資料夠不夠（slot）、資料來源狀態、trial 事件、四段組裝、英文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices, withTdxFallback } from '../core/index.js';
import { TdxError } from '../core/tdx-client.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { createAgentHandler } from '../server/agent.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { slotReport, sourceReport, trialInfo, INTENT_SLOTS, INTENT_SOURCES, TDX_LIMIT_WINDOW_MS } from '../core/agent/trial.js';
import { EVENT_TYPES } from '../core/agent/events.js';
import { summarizeRun, runTrial, trialSuggest, reportJson, TRIAL_SECTIONS, TRIAL_PRESETS, NEXT_MAX, TRIAL_HISTORY } from '../public/js/ai-trial.js';
import { ZH, EN, aiT } from '../public/js/pages/ai-i18n.js';
import { thinkStart, thinkStep, thinkText } from '../public/js/agent/thinking.js';

const svc = createServices({ forceMock: true });
const it = (q, intent) => parseIntent(q, intent ? { intent } : {});

test('資料夠不夠：行程有目的地就夠；起點沒說用定位補、時間沒說用現在', () => {
  const r = slotReport(it('我快遲到了，怎麼去台北車站'));
  assert.equal(r.intent, 'trip');
  assert.equal(r.enough, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.slots.map((s) => [s.key, s.have, s.value ?? s.fill]), [['to', true, '臺北車站'], ['from', false, 'location'], ['when', false, 'now']]);
  assert.equal(r.location, true, '會先請手機定位');
  const full = slotReport(it('明天早上8點從台北車站到板橋'));
  assert.equal(full.location, false);
  assert.deepEqual(full.slots.map((s) => s.value), ['板橋車站', '臺北車站', '明天 08:00 出發']);
});

test('資料夠不夠：問公車沒說哪一路 → 缺路線（needs route）；規則聽不懂、判斷層說查公車 → 照查公車列欄位', () => {
  const r = slotReport(it('公車還要多久？'));
  assert.deepEqual([r.intent, r.target, r.needs, r.enough, r.location], ['bus_route', 'bus_route', 'route', false, false]);
  assert.deepEqual(r.missing, ['route']);
  const judgedOnly = slotReport({ intent: 'unknown', places: [], states: [] }, { judged: 'bus_route' });
  assert.equal(judgedOnly.target, 'bus_route');
  assert.deepEqual(judgedOnly.missing, ['route']);
  const none = slotReport({ intent: 'unknown', places: [], states: [] });
  assert.equal(none.target, 'unknown');
  assert.deepEqual(none.slots, []);
  assert.equal(none.enough, false);
  const origin = slotReport(it('從台北車站出發'));
  assert.deepEqual([origin.intent, origin.needs, origin.missing], ['trip', 'to', ['to']]);
  assert.equal(origin.slots.find((x) => x.key === 'from').value, '臺北車站', '只說起點：那是起點');
});

test('資料夠不夠：固定說明（防詐）算夠；後天天氣、投資建議擋下；常用地點沒設定不夠', () => {
  const scam = slotReport(it('這是詐騙嗎？有人要我加LINE投資'));
  assert.equal(scam.intent, 'scamAsk');
  assert.equal(scam.fixed, true);
  assert.equal(scam.enough, true);
  for (const q of ['謝謝', '對不起', '重來']) {
    const r = slotReport(it(q), { judged: 'trip' });
    assert.deepEqual([r.fixed, r.enough, r.target], [true, true, 'unknown'], `${q}：不說聽不懂，也不照判斷層列欄位`);
  }
  const later = slotReport(it('後天會下雨嗎'));
  assert.equal(later.blocked, 'later');
  assert.equal(later.enough, false);
  const saved = slotReport(it('8點前要到公司'));
  assert.equal(saved.intent, 'savedMissing');
  assert.deepEqual(saved.missing, []);
  assert.equal(saved.slots[0].value, '公司');
  assert.equal(saved.enough, false);
  for (const k of Object.keys(INTENT_SOURCES)) assert.ok(Object.hasOwn(INTENT_SLOTS, k), k);
});

test('資料夠不夠：英文提問的欄位文字是英文', () => {
  const r = slotReport({ ...parseIntent('8點前到台北101', { now: Date.parse('2026-11-21T06:00:00+08:00') }), intent: 'trip' }, { lang: 'en' }); // 固定早上：8 點過了會推到晚上
  assert.equal(r.slots.find((s) => s.key === 'when').value, 'arrive by 08:00');
  const rail = slotReport({ intent: 'trip', places: [], states: [], nearRail: 'THSR' }, { lang: 'en' });
  assert.equal(rail.slots[0].value, 'nearest HSR station');
});

test('資料來源：示範模式照實說原因；TDX 額度剛用完改示範；沒有金鑰', () => {
  assert.deepEqual(sourceReport(svc, 'trip'), [{ id: 'transit', mode: 'demo', reason: 'forced' }, { id: 'weather', mode: 'demo', reason: 'forced' }, { id: 'aqi', mode: 'demo', reason: 'forced' }]);
  assert.deepEqual(sourceReport(svc, 'scamAsk'), []);
  const now = Date.now();
  const live = { mode: 'live', weatherMode: 'demo', aqiMode: 'demo', quakeMode: 'demo', openDataMode: 'live', antifraudMode: 'live', dramaMode: 'demo', tdxLimitedAt: () => now - 90_000 };
  // 2 分鐘內曾用完額度：仍是真實資料（這一輪實際是不是示範看工具結果），只附「N 分鐘前曾用完」
  assert.deepEqual(sourceReport(live, 'trip', { now }), [{ id: 'transit', mode: 'live', reason: 'tdx-limit', minutesAgo: 1 }, { id: 'weather', mode: 'demo', reason: 'no-key' }, { id: 'aqi', mode: 'demo', reason: 'no-key' }]);
  assert.equal(TDX_LIMIT_WINDOW_MS, 120_000);
  assert.deepEqual(sourceReport({ ...live, tdxLimitedAt: () => now - TDX_LIMIT_WINDOW_MS - 1 }, 'bus_route', { now }), [{ id: 'transit', mode: 'live', reason: 'live' }]);
  assert.deepEqual(sourceReport({ ...live, openDataMode: 'demo' }, 'aqi', { now }), [{ id: 'aqi', mode: 'demo', reason: 'no-download' }]);
  assert.deepEqual(sourceReport(live, 'drama'), [{ id: 'drama', mode: 'demo', reason: 'no-source' }]);
  assert.equal(svc.tdxLimitedAt(), null);
});

test('TDX 額度用完（429）：改用示範時記下時間（試判斷的資料來源用）', async () => {
  const quota = { at: 0 };
  const s = withTdxFallback({ bus: { routeEta: async () => { throw new TdxError(429, 'x'); } } }, { bus: { routeEta: async () => ({ demo: true }) } }, quota);
  assert.deepEqual(await s.bus.routeEta(), { demo: true });
  assert.ok(quota.at > 0 && Date.now() - quota.at < 1000);
});

test('請求：clientCaps.trial 可以不帶 engine（網頁版）；一般請求仍要 engine；其他欄位 400', () => {
  const m = [{ role: 'user', content: '天氣' }];
  assert.deepEqual(validateRequest({ messages: m, clientCaps: { edgeWrite: true, trial: true } }).clientCaps, { edgeWrite: true, trial: true });
  assert.throws(() => validateRequest({ messages: m, clientCaps: { edgeWrite: true } }), /engine/);
  assert.throws(() => validateRequest({ messages: m, clientCaps: { edgeWrite: true, trial: false } }));
  assert.throws(() => validateRequest({ messages: m, clientCaps: { edgeWrite: true, trial: true, lat: 25 } }));
  assert.throws(() => validateRequest({ messages: m, clientCaps: { edgeWrite: false, trial: true } }), /engine/, '沒有 edgeWrite 的 trial 仍要 engine');
  assert.ok(EVENT_TYPES.includes('trial'));
});

const run = async (body) => { const ev = []; await runDemo(svc, body, (e) => ev.push(e), { mode: 'edge' }); return ev; };
const ask = (q, extra = {}) => ({ messages: [{ role: 'user', content: q }], clientTools: ['device_location'], clientCaps: { edgeWrite: true, trial: true }, ...extra });

test('trial 事件：判斷完、請定位前送一次；帶定位結果的重送不再送；回答仍是 answer_draft（不呼叫模型）', async () => {
  const first = await run(ask('我快遲到了，怎麼去台北101'));
  const types = first.map((e) => e.type);
  assert.ok(types.indexOf('trial') > types.indexOf('status') && types.indexOf('trial') < types.indexOf('client_tool_call'), types.join());
  const tr = first.find((e) => e.type === 'trial');
  assert.equal(tr.enough, true);
  assert.equal(tr.location, true);
  assert.equal(tr.judge.source, 'rules');
  const again = await run(ask('我快遲到了，怎麼去台北101', { clientToolResults: [{ id: 'loc1', ok: false }] }));
  assert.equal(again.filter((e) => e.type === 'trial').length, 0);
  assert.match(again.find((e) => e.type === 'answer_draft').text, /沒拿到你的位置/);
  assert.equal(again.filter((e) => e.type === 'text').length, 0);
  // 沒帶 trial：不送
  const plain = await run({ messages: [{ role: 'user', content: '天氣' }], clientCaps: { edgeWrite: true, engine: 'gemini-nano' } });
  assert.equal(plain.filter((e) => e.type === 'trial').length, 0);
});

test('trial 事件：手機判斷是查公車 → 缺路線；安全情境照實標；英文那一輪 lang en', async () => {
  const bus = (await run(ask('公車還要多久？', { deviceJudge: { intent: 'bus_route', states: [], engine: 'gemini-nano' } }))).find((e) => e.type === 'trial');
  assert.equal(bus.judge.source, 'device');
  assert.deepEqual(bus.missing, ['route']);
  const evs = await run(ask('我想死'));
  assert.equal(evs.find((e) => e.type === 'trial').safety, 'selfHarm');
  const en = (await run(ask('How do I get to Taipei 101?'))).find((e) => e.type === 'trial');
  assert.equal(en.lang, 'en');
  assert.equal(en.intent, 'trip');
  assert.deepEqual(trialInfo(svc, it('天氣')).judge, { intent: 'weather', states: [], source: 'rules' }, '沒有判斷層：用規則');
});

test('summarizeRun：工具、決策、問句、草稿、請定位、安全情境', () => {
  const s = summarizeRun([
    { type: 'status', mode: 'edge', lang: 'en', judge: { intent: 'trip', source: 'rules' } },
    { type: 'trial', intent: 'trip', slots: [], sources: [] },
    { type: 'client_tool_call', id: 'loc1', name: 'device_location' },
    { type: 'tool_start', id: 't1', name: 'weather_now', title: '天氣', role: '天氣' },
    { type: 'tool_result', id: 't1', ok: true, tool: 'weather_now', speak: '晴', mode: 'demo', data: { raining: false } },
    { type: 'tool_start', id: 't2', name: 'aqi_nearby', role: '空品' },
    { type: 'tool_result', id: 't2', ok: false, error: '查不到' },
    { type: 'ask', id: 'a', question: '趕嗎？', options: [{ label: '趕', kind: 'state', state: 'rush', guess: true }], pending: { slot: 'state', state: 'rush' } },
    { type: 'answer_draft', text: '草稿', facts: {}, lang: 'en' },
    { type: 'guardrail', rule: 'safety:selfHarm' },
  ]);
  assert.equal(s.lang, 'en');
  assert.equal(s.askedLocation, true);
  assert.deepEqual(s.tools.map((x) => [x.name, x.ok]), [['weather_now', true], ['aqi_nearby', false]]);
  assert.equal(s.results.length, 1);
  assert.deepEqual(s.ask.options, [{ label: '趕', kind: 'state', guess: true }]);
  assert.equal(s.draft.text, '草稿');
  assert.equal(s.safety, 'selfHarm');
});

/** 假的 agent：照真的 runDemo 跑（edge 模式），請定位時用 locate（試判斷回 null） */
const fakeAgent = (bodies) => async (body, onEvent, { locate }) => {
  bodies.push(body);
  let results = [];
  for (let i = 0; i < 3; i++) {
    const ev = [];
    await runDemo(svc, { ...body, clientTools: ['device_location'], ...(results.length && { clientToolResults: results }) }, (e) => ev.push(e), { mode: 'edge' });
    for (const e of ev) onEvent(e);
    if (!ev.some((e) => e.type === 'client_tool_call')) return;
    const loc = await locate();
    onEvent({ type: 'client_tool_result', id: 'loc1', name: 'device_location', ok: !!loc }); // 跟 runAgent 一樣（不含座標）
    results = [{ id: 'loc1', ok: !!loc, ...(loc && { result: loc }) }];
  }
};

test('runTrial（網頁版）：四段依序；第 1 段用伺服器規則並說原因；不送定位；只送這一句', async () => {
  const bodies = [], order = [], steps = [];
  const rep = await runTrial('我快遲到了，怎麼去台北101', {
    device: { active: false, reason: 'web' },
    judge: async () => assert.fail('網頁版不呼叫手機判斷'),
    agent: fakeAgent(bodies),
    write: async () => assert.fail('網頁版不在手機上寫'),
    suggest: (o) => trialSuggest({ ...o, canEdge: () => false, edgeSuggest: async () => assert.fail(), check: async () => assert.fail() }),
  }, (k) => order.push(k), (e) => steps.push(e.type));
  assert.deepEqual(order, TRIAL_SECTIONS);
  const S = rep.sections;
  assert.deepEqual([S.judge.by, S.judge.why, S.judge.network], ['server', 'web', true]);
  assert.equal(S.judge.intent, 'trip');
  assert.equal(S.data.enough, true);
  assert.equal(S.answer.askedLocation, true);
  assert.match(S.answer.draft, /沒拿到你的位置/);
  assert.deepEqual(S.answer.rewrite, { by: 'none', reason: 'web' });
  assert.ok(S.answer.tools.some((x) => x.name === 'plan_trip'));
  assert.equal(S.next.suggest.source, 'rules');
  assert.ok(S.next.suggest.asks.length > 0 && S.next.suggest.asks.length <= NEXT_MAX);
  assert.equal(S.next.network, false, '規則建議不用網路');
  // 送出的請求：只有這一句（沒有定位座標、常用地點、習慣）
  for (const b of bodies) {
    assert.deepEqual(Object.keys(b).sort(), ['clientCaps', 'messages']);
    assert.deepEqual(b.clientCaps, { edgeWrite: true, trial: true });
  }
  assert.ok(!JSON.stringify(bodies).match(/lat|lon/));
  assert.deepEqual(steps.filter((x) => ['device', 'suggest'].includes(x)), ['device', 'suggest'], '動畫：判斷 → … → 猜下一句');
  assert.ok(steps.includes('tool_start'));
  assert.match(reportJson(rep), /"q": "我快遲到了，怎麼去台北101"/);
});

test('runTrial（手機）：手機判斷帶給伺服器；改寫通過與沒通過都列出；手機猜的句子驗證後標來源', async () => {
  const bodies = [];
  const deps = (writeKind) => ({
    device: { active: true, engine: 'gemini-nano', write: true },
    judge: async (q) => ({ intent: /公車/.test(q) ? 'bus_route' : 'trip', states: [], engine: 'gemini-nano' }),
    judgeMs: () => 300,
    agent: fakeAgent(bodies),
    write: async (d) => (writeKind === 'ok' ? { by: 'edge', text: `報你知，${d.text}`, engine: 'gemini-nano', ms: 400 } : { by: 'program', reason: 'check', detail: 'number', why: '9 分', candidate: '亂寫 9 分', engine: 'gemini-nano', ms: 380 }),
    suggest: (o) => trialSuggest({ ...o, canEdge: () => true, edgeSuggest: async () => ({ asks: ['307 公車還要多久？', '明天會下雨嗎？', '從台北車站到台北101怎麼去？'], engine: 'gemini-nano' }),
      check: async (asks) => asks.map((q) => ({ q, ok: true, ask: parseIntent(q, {}) })) }),
  });
  const ok = await runTrial('我快遲到了，怎麼去台北101', deps('ok'));
  const S = ok.sections;
  assert.deepEqual([S.judge.by, S.judge.ms, S.judge.network], ['device', 300, false]);
  assert.equal(S.judge.server.source, 'device', '伺服器採用了手機的判斷');
  assert.deepEqual(bodies[0].deviceJudge, { intent: 'trip', states: [], engine: 'gemini-nano' });
  assert.deepEqual(bodies[0].clientCaps, { edgeWrite: true, trial: true, engine: 'gemini-nano' });
  assert.equal(S.data.enough, true);
  assert.equal(S.answer.askedLocation, true);
  assert.equal(S.answer.rewrite.ok, true);
  assert.equal(S.answer.final, S.answer.rewrite.text);
  assert.equal(S.next.suggest.source, 'edge');
  assert.equal(S.next.suggest.asks[0].src, 'edge', '手機猜的在前（不足 3 句時規則補在後面）');
  assert.equal(S.next.network, true);
  // 資料不夠：缺路線 → 第 4 段是「哪一路公車？」，伺服器直接給固定的一句（不交給手機改寫）
  const bus = await runTrial('公車還要多久？', deps('ok'));
  assert.deepEqual(bus.sections.data.missing, ['route']);
  assert.deepEqual([bus.sections.next.ask.about, bus.sections.next.ask.question], ['slot:route', '哪一路公車？']);
  assert.equal(bus.sections.answer.direct, true);
  assert.deepEqual(bus.sections.answer.rewrite, { by: 'none', reason: 'direct' });
  assert.equal(bus.sections.answer.tools.length, 0, '缺路線：不查資料');
  const bad = await runTrial('我快遲到了，怎麼去台北101', deps('bad'));
  assert.deepEqual([bad.sections.answer.rewrite.ok, bad.sections.answer.rewrite.check, bad.sections.answer.rewrite.text], [false, 'number', '亂寫 9 分']);
  assert.equal(bad.sections.answer.final, bad.sections.answer.draft, '沒通過：最後顯示程式版');
});

test('runTrial：手機判斷失敗 → 第 1 段改用伺服器並說「failed」；手機不能寫 → no-write', async () => {
  const rep = await runTrial('明天會下雨嗎', {
    device: { active: true, engine: 'apple', write: false },
    judge: async () => null,
    agent: fakeAgent([]),
    write: async () => assert.fail(),
    suggest: async () => ({ source: 'rules', asks: [], guessed: [], checked: false }),
  });
  assert.deepEqual([rep.sections.judge.by, rep.sections.judge.why, rep.sections.judge.intent], ['server', 'failed', 'weather']);
  assert.deepEqual(rep.sections.answer.rewrite, { by: 'none', reason: 'no-write' });
});

test('runTrial（英文）：第 3 段的程式版是英文', async () => {
  const rep = await runTrial('Will it rain tomorrow?', { device: { active: false, reason: 'web' }, judge: async () => null, agent: fakeAgent([]), write: async () => null, suggest: async () => ({ source: 'rules', asks: [] }) });
  assert.equal(rep.sections.answer.lang, 'en');
  assert.match(rep.sections.answer.draft, /^Tomorrow/); // 地名照中文原名（括號）
  assert.equal(rep.sections.data.lang, 'en');
});

test('字典與動畫：試判斷的鍵中英都有；測試句 5 句（含資料不夠、英文、防詐）；思考動畫多「猜下一句」', () => {
  for (const k of [...TRIAL_PRESETS, ...TRIAL_SECTIONS.map((x) => `trial.sec.${x}`), 'trial.copy', 'trial.json', 'think.suggest']) { assert.ok(ZH[k], k); assert.ok(EN[k], k); }
  for (const k of Object.values(INTENT_SLOTS).flat().map(([key]) => key)) assert.ok(ZH[`slot.${k}`] && EN[`slot.${k}`], k);
  for (const f of new Set(Object.values(INTENT_SLOTS).flat().map((x) => x[2]).filter(Boolean))) assert.ok(ZH[`fill.${f}`] && EN[`fill.${f}`], f);
  for (const r of ['live', 'forced', 'no-key', 'no-download', 'tdx-limit', 'no-source']) assert.ok(ZH[`srcmode.${r}`] && EN[`srcmode.${r}`], r);
  const qs = TRIAL_PRESETS.map((k) => ZH[k]);
  assert.equal(qs.length, 5);
  assert.equal(parseIntent(ZH['trial.p4'], {}).intent, 'scamAsk');
  assert.equal(parseIntent(ZH['trial.p3'], {}).lang, 'en');
  assert.equal(slotReport(parseIntent(ZH['trial.p2'], {})).enough, false, '資料不夠的測試句');
  const s = thinkStep(thinkStep(thinkStart(), { type: 'device', result: null }), { type: 'suggest' });
  assert.equal(s.phase, 'suggest');
  assert.equal(thinkText(s, null).stage, '在猜你接下來想問什麼');
  assert.equal(thinkText(s, 'en').stage, aiT('en')('think.suggest'));
});

test('handler：帶 trial 時不呼叫任何伺服器模型（modelCalls 0）、log 記 trial: true、不記句子；防詐 agent 不送 trial 事件', async () => {
  let starts = 0;
  const provider = { mode: 'local', model: 'fake', start() { starts++; return { next: async () => ({ text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const logs = [];
  const h = createAgentHandler({ svc, env: {}, provider, log: (o) => logs.push(o) });
  const call = async (body, agentId) => {
    const chunks = [];
    const res = { writableEnded: false, writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; } };
    await h.handle(res, body, agentId ? { agentId } : {});
    return chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  };
  const es = await call(ask('從西門町到台北101怎麼去'));
  assert.equal(starts, 0);
  assert.equal(h.usage('life').modelCalls, 0);
  assert.ok(es.some((e) => e.type === 'trial') && es.some((e) => e.type === 'answer_draft'));
  assert.equal(logs.at(-1).mode, 'edge');
  assert.equal(logs.at(-1).trial, true);
  assert.ok(!JSON.stringify(logs).includes('西門町'), 'log 不記句子');
  const af = await call({ messages: [{ role: 'user', content: '這個網址安全嗎 https://tw388.xyz/p' }], clientCaps: { edgeWrite: true, trial: true, engine: 'gemini-nano' } }, 'antifraud');
  assert.equal(af.filter((e) => e.type === 'trial').length, 0, '防詐 agent 不送 trial');
  assert.ok(!logs.at(-1).trial);
  const ev = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '這是詐騙嗎' }], clientCaps: { edgeWrite: true, trial: true } }, (e) => ev.push(e), { profileId: 'antifraud', mode: 'edge' });
  assert.equal(ev.filter((e) => e.type === 'trial').length, 0);
});

test('edge-write（前端）：改寫沒過護欄時回被擋的改寫 candidate（最多 400 字）與原因 why（最多 60 字）', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const W = await import('../public/js/edge-write.js');
  const D = '選「公車 601」：省 270 元、不用等車。 601 約 7 分後到「民生捷運站」，走過去約 3 分。';
  const F = { intent: 'trip', demo: false, points: [], trip: { departAt: '08:00', best: { name: '公車 601', minutes: 32, cost: 15, arriveAt: '08:32' }, others: [] } };
  const setWrite = (text) => {
    globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: (p, m) => (m === 'write' ? Promise.resolve({ engine: 'gemini-nano', ms: 300, text }) : Promise.resolve({ available: true, engine: 'gemini-nano', write: true })) };
    W._resetEdgeWrite();
  };
  try {
    setWrite(D.replace('7 分', '9 分'));
    const bad = await W.edgeWrite({ text: D, facts: F, lang: 'zh' }, { engine: 'gemini-nano' });
    assert.deepEqual([bad.by, bad.reason, bad.detail], ['program', 'check', 'number']);
    assert.equal(bad.text, D, '回答仍用程式版');
    assert.equal(bad.candidate, D.replace('7 分', '9 分'));
    assert.ok(bad.why && bad.why.length <= 60);
    setWrite(`${'很長的改寫 9 分。'.repeat(80)}`);
    const long = await W.edgeWrite({ text: D, facts: F, lang: 'zh' }, { engine: 'gemini-nano' });
    assert.equal(long.reason, 'check');
    assert.equal(long.candidate.length, 400);
    setWrite(D);
    const ok = await W.edgeWrite({ text: D, facts: F, lang: 'zh' }, { engine: 'gemini-nano' });
    assert.equal(ok.by, 'edge');
    assert.ok(!('candidate' in ok));
  } finally {
    delete globalThis.Capacitor;
  }
});

test('runTrial：跟問阿幫一樣帶前文、由手機定位（2026-11-22「地點、時間不應該要問」）；定位到了就不說「沒拿到你的位置」', async () => {
  const bodies = [];
  const prior = [{ role: 'user', content: '台北天氣如何' }, { role: 'assistant', content: '台北現在晴。' }, { role: 'system', content: 'x' }];
  const rep = await runTrial('怎麼去台北101', {
    device: { active: false, reason: 'web' },
    judge: async () => assert.fail(),
    agent: fakeAgent(bodies),
    write: async () => assert.fail(),
    history: () => prior,
    locate: async () => ({ lat: 25.0478, lon: 121.517, accuracy: 20 }),
    suggest: (o) => trialSuggest({ ...o, canEdge: () => false, edgeSuggest: async () => assert.fail(), check: async () => assert.fail() }),
  });
  assert.deepEqual(bodies[0].messages, [prior[0], prior[1], { role: 'user', content: '怎麼去台北101' }], '前文只帶使用者與阿幫的話');
  const S = rep.sections;
  assert.equal(S.answer.located, true);
  assert.equal(S.answer.turns, 1);
  assert.doesNotMatch(S.answer.final, /沒拿到你的位置/);
  assert.equal(S.next.location, false, '定位到了：不再說要問你在哪');
  assert.ok(TRIAL_HISTORY >= 4);
});
