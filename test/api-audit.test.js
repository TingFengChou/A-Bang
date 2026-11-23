// 對外介面稽核（2026-11-23）：REST 標示示範資料、日期驗證與 TDX 網址、必填參數、防詐規則與護欄、tool schema、限流 IP、模型出錯的防詐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restRoutes, runRoute } from '../server/rest.js';
import { withTdxFallback, createServices } from '../core/index.js';
import { createMockTransitServices } from '../core/services/transit-mock.js';
import { createTransitServices, findStation } from '../core/services/transit.js';
import { T } from '../core/tools/define.js';
import { callTool, listTools, describeTool } from '../core/tools/index.js';
import { isDate, UserError } from '../core/util.js';
import { parseAntifraud, antifraudSteps, antifraudSummary } from '../core/agent/demo-antifraud.js';
import { applyOutputGuardrails, NO_ADVICE_NOTE } from '../core/output-guards.js';
import { getProfile } from '../core/agents/index.js';
import { clientIp } from '../server/rate-limit.js';
import { redact } from '../server/log.js';
import { checkSender } from '../core/scam-check.js';
import { SERVER_INFO } from '../mcp/create-server.js';
import { createAgentHandler } from '../server/agent.js';
import { toolDefs } from '../core/agent/model-loop.js';

const tdx429 = () => Object.assign(new Error('TDX 每分鐘額度用完'), { name: 'TdxError', status: 429 });
const demoSvc = () => createServices({ forceMock: true });

// ── 1. REST 改用示範資料時照實標 demo ──
test('REST：TDX 額度用完改用示範資料時 mode 是 demo、帶 fallback', async () => {
  const mock = createMockTransitServices();
  const rail = withTdxFallback({ thsrStations: async () => [], thsrTimetable: async () => { throw tdx429(); } }, mock.rail);
  const svc = { mode: 'live', rail };
  const routes = restRoutes(svc);
  const r = await runRoute(svc, routes['/api/v1/thsr/timetable'], { from: '左營', to: '台北' });
  assert.equal(r.mode, 'demo');
  assert.equal(r.fallback, 'tdx-limit');
  assert.equal(r.data.demo, true);
  // 沒改用示範資料：照服務的模式
  const ok = await runRoute(svc, routes['/api/v1/thsr/stations'], {});
  assert.deepEqual([ok.mode, 'fallback' in ok], ['live', false]);
});

test('REST：下車提醒內部呼叫的 tool 改用示範資料時也標 demo', async () => {
  const mock = createMockTransitServices();
  const bus = withTdxFallback({ routeEta: async () => { throw tdx429(); } }, mock.bus);
  const svc = { mode: 'live', bus };
  const now = Date.now();
  const r = await runRoute(svc, restRoutes(svc)['/api/v1/bus/alight'], { city: 'Taipei', route: '307', board: 'A', dest: 'B', boardAt: String(now), rideSec: '600', now: String(now) });
  assert.equal(r.mode, 'demo');
});

// ── 2. 日期驗證、TDX 網址路徑編碼 ──
test('日期：YYYY-MM-DD 且是真的日期', () => {
  assert.equal(isDate('2026-11-23'), true);
  assert.equal(isDate('2028-02-29'), true);
  for (const bad of ['2026-13-45', '2026-02-30', '2027-02-29', '../../../../v2/Bus/Route/City/Taipei?$top=1', '2026-1-1', '', null, '2026-11-23x']) assert.equal(isDate(bad), false, String(bad));
  assert.equal(T.date.safeParse('2026-13-45').success, false);
  assert.equal(T.date.safeParse(undefined).success, true);
  assert.equal(T.date.safeParse('2026-11-23').success, true);
});

test('日期：tool 與 REST 擋掉不合法的日期（400），不送到 TDX', async () => {
  const svc = demoSvc();
  await assert.rejects(callTool(svc, 'thsr_timetable', { from: '台北', to: '左營', date: '2026-13-45' }), UserError);
  const routes = restRoutes(svc);
  await assert.rejects(runRoute(svc, routes['/api/v1/thsr/timetable'], { from: '台北', to: '左營', date: '../../../../v2/Bus/Route/City/Taipei?$top=1' }), (e) => e instanceof UserError && /date/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/tra/timetable'], { from: '台北', to: '板橋', date: '2026-02-30' }), UserError);
});

test('日期：服務層也擋，網址路徑段都編碼', async () => {
  const paths = [];
  const tdx = {
    get: async (path) => {
      paths.push(path);
      if (/THSR\/Station/.test(path)) return [{ StationID: '1000', StationName: { Zh_tw: '台北' } }, { StationID: '1070', StationName: { Zh_tw: '左營' } }];
      if (/TRA\/Station/.test(path)) return { Stations: [{ StationID: '1000', StationName: { Zh_tw: '臺北' } }, { StationID: '1020', StationName: { Zh_tw: '板橋' } }] };
      return /TRA/.test(path) ? { TrainTimetables: [] } : [];
    },
  };
  const { rail } = createTransitServices(tdx);
  await assert.rejects(rail.thsrTimetable({ from: '台北', to: '左營', date: '../../../../v2/Bus/Route/City/Taipei?$top=1' }), UserError);
  await assert.rejects(rail.traTimetable({ from: '台北', to: '板橋', date: '2026-13-45' }), UserError);
  assert.ok(!paths.some((p) => /Bus\/Route|\.\.|\?/.test(p)), paths.join('\n'));
  await rail.thsrTimetable({ from: '台北', to: '左營', date: '2026-11-23' });
  assert.ok(paths.includes('/basic/v2/Rail/THSR/DailyTimetable/OD/1000/to/1070/2026-11-23'));
});

// ── 4. 必填與數字參數 ──
test('REST：缺必填參數回 400，說要加哪個參數', async () => {
  const svc = demoSvc();
  const routes = restRoutes(svc);
  await assert.rejects(runRoute(svc, routes['/api/v1/bus/eta'], { city: 'Taipei' }), (e) => e instanceof UserError && /route/.test(e.message) && /缺少/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/bus/station-eta'], { city: 'Taipei' }), (e) => e instanceof UserError && /station/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/thsr/timetable'], { from: '左營' }), (e) => e instanceof UserError && /\bto\b/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/thsr/timetable'], { from: '左營', to: '  ' }), UserError, '空白也算沒填');
  await assert.rejects(runRoute(svc, routes['/api/v1/bus/nearby'], { lat: '25.04', lon: '121.5', radius: 'abc' }), (e) => e instanceof UserError && /radius/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/bus/nearby'], { lat: 'x', lon: '121.5' }), (e) => e instanceof UserError && /lat/.test(e.message));
  await assert.rejects(runRoute(svc, routes['/api/v1/bike/nearby'], { lat: '25.04', lon: '121.5', radius: '12.5' }), UserError, '半徑要整數');
  // 合法的照常
  const ok = await runRoute(svc, routes['/api/v1/bus/nearby'], { lat: '25.04', lon: '121.5', radius: '300' });
  assert.equal(ok.mode, 'demo');
  assert.ok(Array.isArray(ok.data));
  const tt = await runRoute(svc, routes['/api/v1/thsr/timetable'], { from: '左營', to: '台北', date: '' });
  assert.match(tt.data.date, /^\d{4}-\d{2}-\d{2}$/, '空的日期＝今天');
});

test('findStation：空站名不比對（includes("") 會配到第一站）', () => {
  const list = [{ id: '1', name: '南港' }, { id: '2', name: '台北' }];
  assert.throws(() => findStation(list, '', '高鐵'), UserError);
  assert.throws(() => findStation(list, '  ', '高鐵'), UserError);
  assert.throws(() => findStation(list, undefined, '高鐵'), UserError);
  assert.equal(findStation(list, '台北', '高鐵').id, '2');
});

test('示範服務：半徑上限與真實服務相同（1000 公尺）', async () => {
  const { bus, bike } = createMockTransitServices();
  for (const st of await bus.nearbyStations({ lat: 25.0478, lon: 121.517, radius: 50000 })) assert.ok(st.distance < 1500, `${st.distance}`);
  for (const st of await bike.nearby({ lat: 25.0478, lon: 121.517, radius: 50000 })) assert.ok(st.distance < 1500, `${st.distance}`);
});

// ── 3. 防詐：號碼＋一段話 ──
test('防詐示範：號碼後面還有話時也比對內容，回報較高的風險', async () => {
  const svc = demoSvc();
  const text = '0912345678 打來說是檢察官要我監管帳戶';
  const it = parseAntifraud(text);
  const calls = antifraudSteps(it)[0]().calls.map((c) => c.name);
  assert.deepEqual(calls.sort(), ['scam_check_message', 'sms_sender_check']);
  const results = {};
  for (const c of antifraudSteps(it)[0]().calls) (results[c.name] ||= []).push(await callTool(svc, c.name, c.args));
  assert.equal(results.scam_check_message[0].data.level, 'high');
  const s = antifraudSummary(it, results);
  assert.match(s, /^先不要照做/);
  assert.match(s, /個人手機號碼/);
  // 只有號碼：照舊只查號碼
  const only = parseAntifraud('0912345678 傳來的簡訊是詐騙嗎');
  assert.deepEqual(antifraudSteps(only)[0]().calls.map((c) => c.name), ['sms_sender_check']);
});

// ── 5. 輸出護欄 ──
test('輸出護欄（防詐）：安心點開、直接付款、不會有問題、英文 safe 都換掉；正當的提醒不動', () => {
  const p = getProfile('antifraud');
  for (const bad of ['可以安心點開。', '不用擔心，可以直接點連結付款。', '不會有問題的。', 'This link is safe.', "It's legit, go ahead.", '沒有任何風險。']) {
    const g = applyOutputGuardrails(p, `${bad}請撥 165。`);
    assert.deepEqual(g.hits, [{ tier: 'L2', rule: 'no-safety-claim' }], bad);
    assert.ok(!g.text.includes(bad.replace(/。$/, '')), g.text);
  }
  for (const ok of ['不要點連結，也不要直接付款。', '先別直接匯款，請撥 165 查證。', '打 165 查證比較安心。', "This doesn't mean it's safe. Call 165.", '這不代表一定安全，請撥 165。', '千萬不要直接輸入密碼。', '別擔心，我們一步一步來：先撥 165。', '請直接輸入官方網址，不要點簡訊裡的連結。', '你想知道有沒有風險？請撥 165。']) {
    assert.deepEqual(applyOutputGuardrails(p, ok).hits, [], ok);
  }
});

test('輸出護欄（finance）：漲跌預測、進場時機、跟在問句後的「不會，會跌」都換掉；一般行情不動', () => {
  const p = getProfile('life');
  for (const bad of ['台積電明天會漲。', '台積電應該會反彈。', '現在是進場的好時機。']) {
    const g = applyOutputGuardrails(p, bad);
    assert.equal(g.text, NO_ADVICE_NOTE, bad);
  }
  const qa = applyOutputGuardrails(p, '這檔股價會上漲嗎？不會，會跌');
  assert.equal(qa.text, NO_ADVICE_NOTE);
  for (const ok of ['加權指數 11/18 收 40194.91，漲 102.8 點。', '明天會下雨，記得帶傘。', '油價下週一調整。', '建議搭捷運，比較不會淋雨。', '不會，捷運還有車。', '現在是下班時間，車會比較多。']) {
    assert.deepEqual(applyOutputGuardrails(p, ok), { text: ok, hits: [] }, ok);
  }
});

// ── 6. 有預設值的參數不是必填 ──
test('tool schema：有預設值的參數不列為必填（OpenAPI、/api/v1/tools、模型）', () => {
  const req = (name) => describeTool(listTools().find((t) => t.name === name)).inputSchema.required || [];
  assert.ok(!req('earthquake_recent').includes('limit'));
  assert.ok(!req('garbage_truck_nearby').includes('radius'));
  assert.deepEqual(req('garbage_truck_nearby').sort(), ['lat', 'lon']);
  assert.ok(!req('drama_picks').includes('limit'));
  assert.ok(req('drama_search').includes('query'));
  // 模型工具定義同一份
  const defs = toolDefs(getProfile('life'));
  const g = defs.find((d) => d.name === 'garbage_truck_nearby');
  assert.ok(g && !g.schema.required.includes('radius'));
  assert.equal(g.schema.type, 'object');
});

// ── 7. 限流 IP ──
test('限流 IP：TRUST_PROXY=1 用最右邊（代理加上的）位址，偽造的最左邊不算；可設信任幾層', () => {
  const req = (xff) => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.1' } });
  const old = process.env.TRUST_PROXY;
  try {
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9');
    assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9');
    process.env.TRUST_PROXY = '2';
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.9, 10.1.1.1')), '203.0.113.9');
    assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9', '比信任層數少：用最右邊');
    process.env.TRUST_PROXY = '3';
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9', '比信任層數少：不用可偽造的最左邊');
    process.env.TRUST_PROXY = '0';
    assert.equal(clientIp(req('6.6.6.6')), '10.0.0.1');
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req('6.6.6.6')), '10.0.0.1');
  } finally {
    if (old === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = old;
  }
});

// ── 8. 防詐：模型出錯時改用規則 ──
const ndjsonRes = () => {
  const lines = [];
  return { lines, writableEnded: false, writeHead() {}, write(s) { lines.push(...String(s).trim().split('\n').map((l) => JSON.parse(l))); }, end() { this.writableEnded = true; } };
};
test('防詐：模型出錯時這一輪改用規則比對回答，說明 AI 暫時無法使用', async () => {
  const provider = { mode: 'claude', model: 'fake', start: () => ({ next: async () => { throw Object.assign(new Error('overloaded'), { name: 'InternalServerError', status: 529 }); }, addResults() {} }) };
  const logs = [];
  const h = createAgentHandler({ svc: demoSvc(), env: {}, provider, log: (o) => logs.push(o) });
  const res = ndjsonRes();
  await h.handle(res, { messages: [{ role: 'user', content: '0912345678 打來說是檢察官要我監管帳戶' }] }, { agentId: 'antifraud' });
  const types = res.lines.map((e) => e.type);
  assert.ok(!types.includes('error'), types.join(','));
  assert.equal(types.filter((t) => t === 'status').length, 1, '不重複送 status');
  assert.ok(res.lines.some((e) => e.type === 'agent_note' && /AI 模型暫時/.test(e.text)), JSON.stringify(res.lines.filter((e) => e.type === 'agent_note')));
  assert.match(res.lines.find((e) => e.type === 'text').delta, /先不要照做/);
  assert.equal(types.at(-1), 'done');
  assert.equal(logs[0].mode, 'rules-fallback');
});

test('生活：模型出錯時說是 AI 模型暫時無法回應（不怪資料來源）', async () => {
  const provider = { mode: 'claude', model: 'fake', start: () => ({ next: async () => { throw Object.assign(new Error('boom'), { name: 'APIConnectionError' }); }, addResults() {} }) };
  const h = createAgentHandler({ svc: demoSvc(), env: {}, provider });
  const res = ndjsonRes();
  await h.handle(res, { messages: [{ role: 'user', content: '你好，阿幫可以做什麼' }] }, { agentId: 'life' });
  const err = res.lines.find((e) => e.type === 'error');
  assert.ok(err, JSON.stringify(res.lines.map((e) => e.type)));
  assert.match(err.message, /AI 模型暫時無法回應/);
  assert.doesNotMatch(err.message, /資料來源/);
});

// ── 小項目 ──
test('MCP 版本讀 package.json；log 遮掉所有金鑰；0800 是免付費電話', () => {
  assert.equal(SERVER_INFO.version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  const env = { MOENV_API_KEY: 'moenv-secret-123', JEV_API_KEY: 'jev-secret-4567' };
  assert.equal(redact('a moenv-secret-123 b jev-secret-4567', env), 'a [redacted] b [redacted]');
  assert.equal(checkSender('0800-000-123').kind, '免付費電話');
  assert.equal(checkSender('0809-012-345').kind, '免付費電話');
  assert.equal(checkSender('02-2345-6789').kind, '市話號碼');
});

test('finance 護欄不誤換油價、票價、氣溫（生活阿幫也套用）', async () => {
  const { OUTPUT_GUARDS, NO_ADVICE_NOTE } = await import('../core/output-guards.js');
  const g = OUTPUT_GUARDS.finance[0].apply;
  for (const t of ['中油宣布下週汽油將調漲 0.1 元。', '92 無鉛下週可能會漲 0.2 元。', '明天氣溫會上升。']) assert.equal(g(t), t, t);
  assert.equal(g('台積電明天會漲。'), NO_ADVICE_NOTE);
  assert.equal(g('大盤指數下週可能會漲。'), NO_ADVICE_NOTE);
});
