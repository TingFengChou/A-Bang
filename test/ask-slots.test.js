// 缺必要欄位就問那個欄位（2026-11-22，「該問就問、不要自己猜」，ADR-0016）：哪一路公車、要去哪裡、從哪裡出發。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, nearDefaultFrom, busNoRoute } from '../core/agent/demo-intent.js';
import { slotAsk, originAsk, resolvePending, recentRoutes, recentPlaces, PENDING_SLOTS } from '../core/agent/ask.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { ev } from '../core/agent/events.js';
import { createServices } from '../core/index.js';
import { createAgentHandler } from '../server/agent.js';
import { matchAnswer } from '../public/ui/agent/ask.js';

const svc = createServices({ forceMock: true });
const pick = (it) => ({ intent: it.intent, from: it.from ?? null, to: it.to ?? null, route: it.route ?? null, needs: it.needs ?? null });

test('解析：問公車沒說哪一路 → bus_route、needs route；有路線、附近站牌照舊', () => {
  for (const q of ['公車還要多久？', '等公車等好久', '公車什麼時候來', '公車怎麼還沒來']) assert.deepEqual(pick(parseIntent(q, {})), { intent: 'bus_route', from: null, to: null, route: null, needs: 'route' }, q);
  assert.equal(parseIntent('307 還要多久', {}).route, '307');
  assert.equal(parseIntent('附近公車站', {}).intent, 'nearby_bus');
  assert.equal(busNoRoute('從西門町坐公車到台北101要多久'), false, '行程不算');
  assert.deepEqual(pick(parseIntent('How long until the bus comes?', {})), { intent: 'bus_route', from: null, to: null, route: null, needs: 'route' });
  assert.equal(parseIntent('How long until bus 307?', {}).route, '307');
});

test('解析：只說起點 → 起點（不是目的地），needs to；想去但沒說哪裡 → needs to；有目的地照舊', () => {
  assert.deepEqual(pick(parseIntent('從台北車站出發', {})), { intent: 'trip', from: '臺北車站', to: null, route: null, needs: 'to' });
  assert.deepEqual(pick(parseIntent('我在板橋，要出發了', {})), { intent: 'trip', from: '板橋車站', to: null, route: null, needs: 'to' });
  assert.deepEqual(pick(parseIntent('我要去', {})), { intent: 'trip', from: null, to: null, route: null, needs: 'to' });
  assert.equal(parseIntent('怎麼去？', {}).needs, 'to');
  assert.deepEqual(pick(parseIntent('從板橋出發去台北101', {})), { intent: 'trip', from: '板橋車站', to: '台北101', route: null, needs: null });
  assert.equal(parseIntent('我在西門町', {}).intent, 'unknown', '只說在哪、沒說要出發：不猜');
  assert.equal(parseIntent('我要出門了，要注意什麼', {}).needs, undefined, '出門建議不算');
  // 判斷層說是行程：「從台北車站出發」也是起點（PR #113 試判斷看出的問題）
  assert.deepEqual(pick(parseIntent('從台北車站出發', { intent: 'trip' })), { intent: 'trip', from: '臺北車站', to: null, route: null, needs: 'to' });
  assert.equal(parseIntent('公車到哪了', { intent: 'bus_route' }).needs, 'route');
  assert.equal(parseIntent('幫我寫一首詩', { intent: 'bus_route' }), null, '沒提到公車：不問路線');
  assert.deepEqual(pick(parseIntent("I'm leaving from Taipei Main Station", {})), { intent: 'trip', from: '臺北車站', to: null, route: null, needs: 'to' });
});

test('預設起點跟目的地很近（< 300 公尺）才算', () => {
  assert.equal(nearDefaultFrom('臺北車站'), true);
  assert.equal(nearDefaultFrom('台北車站'), true);
  assert.equal(nearDefaultFrom('臺北轉運站'), true, '京站就在旁邊');
  assert.equal(nearDefaultFrom('台北101'), false);
  assert.equal(nearDefaultFrom('不在地標庫的地方'), false);
});

test('問句：哪一路公車（最近問過的路線優先）、要去哪裡（最近說過的地點＋常用地點標籤）、從哪裡出發', () => {
  const history = [{ role: 'user', content: '307 還要多久' }, { role: 'assistant', content: '選「公車 601」：省 270 元' }, { role: 'user', content: '去西門町怎麼走' }];
  assert.deepEqual(recentRoutes(history), ['601', '307']);
  assert.deepEqual(recentPlaces(history), ['西門町']);
  const r = slotAsk(parseIntent('公車還要多久？', {}), { history });
  assert.equal(r.ask.question, '哪一路公車？');
  assert.deepEqual(r.ask.options.map((o) => [o.label, o.say]), [['601', '601 公車還要多久？'], ['307', '307 公車還要多久？'], ['看附近有哪些公車', '附近的公車站']]);
  assert.deepEqual(r.ask.pending, { slot: 'route' });
  for (const o of r.ask.options) assert.equal(parseIntent(o.say, {}).intent, o.say === '附近的公車站' ? 'nearby_bus' : 'bus_route', '選項送出的句子規則聽得懂');
  const to = slotAsk(parseIntent('從台北車站出發', {}), { history });
  assert.equal(to.ask.question, '要去哪裡？');
  assert.deepEqual(to.ask.options.map((o) => [o.label, o.saved ?? null]), [['西門町', null], ['回家', '家'], ['去公司', '公司']]);
  assert.equal(to.ask.options[0].say, '從臺北車站到西門町怎麼去？');
  assert.deepEqual(to.ask.pending, { slot: 'to', from: '臺北車站' });
  assert.match(to.short, /從「臺北車站」出發/);
  const o = originAsk('臺北車站');
  assert.equal(o.ask.question, '您從哪裡出發？');
  assert.equal(o.ask.options[0].label, '用我的位置');
  assert.deepEqual(o.ask.pending, { slot: 'from', to: '臺北車站' });
  // 英文
  const en = slotAsk(parseIntent('How long until the bus comes?', {}));
  assert.deepEqual([en.ask.question, en.ask.pending], ['Which bus route?', { slot: 'route', lang: 'en' }]);
  const enTo = slotAsk(parseIntent("I'm leaving from Taipei Main Station", {}));
  assert.deepEqual(enTo.ask.pending, { slot: 'to', from: 'Taipei Main Station', lang: 'en' });
  assert.doesNotMatch(JSON.stringify(enTo.ask), /[一-鿿]/, '英文問句與選項沒有中文');
  assert.equal(originAsk('臺北車站', 'en').ask.question, 'Where are you starting from?');
  // 事件：常用地點選項帶 saved（手機有設定才顯示）
  const e = ev.ask({ id: 'a1', ...to.ask });
  assert.equal(e.options[1].saved, '家');
  assert.equal(ev.ask({ id: 'a2', ...to.ask, options: [{ label: 'x', kind: 'reply', say: 'y', saved: '外星' }] }).options[0].saved, undefined);
});

test('打字回答（pendingAsk）：路線號碼、地名接回原問題；新問題不吞成答案', () => {
  const R = (slot, p, t) => resolvePending({ slot, ...p }, t);
  assert.equal(R('route', {}, '307'), '307 公車還要多久？');
  assert.equal(R('route', {}, '坐 紅31'), '紅31 公車還要多久？');
  assert.equal(R('route', { lang: 'en' }, '307'), 'How long until bus 307?');
  assert.equal(R('route', {}, 'bus 307'), 'How long until bus 307?');
  for (const t of ['明天會下雨嗎', '附近有什麼好吃的', '307 和 601 哪個快？', '好']) assert.equal(R('route', {}, t), null, t);
  assert.equal(R('to', { from: '臺北車站' }, '台北101'), '從臺北車站到台北101怎麼去？');
  assert.equal(R('to', {}, '去西門町'), '怎麼去西門町？');
  assert.equal(R('to', { from: '臺北車站' }, '家'), '從臺北車站到家怎麼去？');
  assert.equal(R('to', { from: 'Taipei Main Station', lang: 'en' }, 'Taipei 101'), 'How do I get from Taipei Main Station to Taipei 101?');
  for (const t of ['明天會下雨嗎', '307 還要多久', '油價多少', '好', '台積電收盤']) assert.equal(R('to', {}, t), null, t);
  assert.equal(R('from', { to: '臺北車站' }, '板橋'), '從板橋車站到臺北車站怎麼去？', '地名換成地標庫的正式名稱');
  assert.equal(R('from', { to: '臺北車站' }, '我在西門町'), '從西門町到臺北車站怎麼去？');
  assert.equal(R('from', { to: '臺北車站' }, '用我的位置'), '怎麼去臺北車站？');
  assert.equal(R('from', {}, '板橋'), null, '沒有目的地：不接');
  for (const t of ['油價多少', '捷運下一班', '這期發票']) assert.equal(R('from', { to: '臺北車站' }, t), null, t);
  for (const k of ['route', 'to', 'from']) assert.ok(Object.hasOwn(PENDING_SLOTS, k));
});

test('請求驗證：pendingAsk 收 route／to／from、地名與 lang；換行與過長擋下', () => {
  const m = [{ role: 'user', content: '307' }];
  assert.equal(validateRequest({ messages: m, pendingAsk: { id: 'a', slot: 'route' } }).messages.at(-1).content, '307 公車還要多久？');
  assert.equal(validateRequest({ messages: [{ role: 'user', content: '台北101' }], pendingAsk: { id: 'a', slot: 'to', from: '臺北車站' } }).messages.at(-1).content, '從臺北車站到台北101怎麼去？');
  assert.throws(() => validateRequest({ messages: m, pendingAsk: { id: 'a', slot: 'to', from: 'a\nb' } }));
  assert.throws(() => validateRequest({ messages: m, pendingAsk: { id: 'a', slot: 'to', from: 'x'.repeat(41) } }));
  assert.throws(() => validateRequest({ messages: m, pendingAsk: { id: 'a', slot: 'route', lang: 'fr' } }));
});

test('前端 matchAnswer：按鈕文字全字相符才當答案；打路線號碼（非選項）交給伺服器的 pendingAsk', () => {
  const ask = slotAsk(parseIntent('公車還要多久？', {}), { history: [{ role: 'user', content: '307 還要多久' }] }).ask;
  assert.equal(matchAnswer(ask, '307')?.say, '307 公車還要多久？');
  assert.equal(matchAnswer(ask, '601'), null, '不是選項：帶 pendingAsk 給伺服器');
  assert.equal(matchAnswer(ask, '明天會下雨嗎'), null);
});

const run = async (body, opts = {}) => { const es = []; await runDemo(svc, body, (e) => es.push(e), opts); return es; };
const msgs = (...xs) => xs.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }));

test('runDemo：缺路線 → 一個 ask、一句回答、不查資料、不請定位；打 307 接回查到站', async () => {
  const es = await run({ messages: msgs('公車還要多久？'), clientTools: ['device_location'] });
  assert.deepEqual(es.map((e) => e.type), ['status', 'ask', 'text', 'done']);
  const ask = es[1];
  assert.equal(ask.about, 'slot:route');
  const next = await run({ messages: msgs('公車還要多久？', es[2].delta, '307'), clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0478, lon: 121.517 } }], pendingAsk: { id: ask.id, ...ask.pending } });
  assert.ok(next.some((e) => e.type === 'tool_start' && e.name === 'bus_route_eta'));
  // edge 模式（手機寫回答）也是直接送那一句（不交給手機改寫）
  const edge = await run({ messages: msgs('公車還要多久？'), clientCaps: { edgeWrite: true, engine: 'gemini-nano' } }, { mode: 'edge' });
  assert.ok(edge.some((e) => e.type === 'text') && !edge.some((e) => e.type === 'answer_draft'));
});

test('runDemo：沒定位、目的地就是預設起點 → 問從哪裡出發；有定位、或目的地遠 → 照常算', async () => {
  const no = await run({ messages: msgs('怎麼去台北車站'), clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: false }] });
  assert.equal(no.find((e) => e.type === 'ask')?.about, 'slot:from');
  assert.ok(!no.some((e) => e.type === 'tool_start'), '不算臺北車站到臺北車站');
  const noClient = await run({ messages: msgs('怎麼去台北車站') });
  assert.equal(noClient.find((e) => e.type === 'ask')?.about, 'slot:from', '不支援定位的客戶端也一樣');
  const yes = await run({ messages: msgs('怎麼去台北車站'), clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.033, lon: 121.565 } }] });
  assert.ok(yes.some((e) => e.type === 'tool_start' && e.name === 'plan_trip'));
  const far = await run({ messages: msgs('怎麼去台北101'), clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: false }] });
  assert.ok(far.some((e) => e.type === 'tool_start' && e.name === 'plan_trip'), '目的地遠：照舊從預設起點算並說明');
});

test('模型模式：缺欄位也由程式先問，不呼叫模型', async () => {
  let starts = 0;
  const provider = { mode: 'local', model: 'fake', start() { starts++; return { next: async () => ({ text: '好', calls: [], stop: 'end' }), addResults() {} }; } };
  const h = createAgentHandler({ svc, env: {}, provider });
  const chunks = [];
  const res = { writableEnded: false, writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; } };
  await h.handle(res, { messages: msgs('從台北車站出發') });
  const es = chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(starts, 0);
  assert.equal(es.find((e) => e.type === 'ask')?.question, '要去哪裡？');
});

// ───── PR #115 獨立審查（約 250 句對照 main）：寧可不問（交回原本流程），也不要誤問或吞掉別的問題 ─────
/** 固定白天（真實時鐘在深夜時公車收班，行程不會選公車） */
const EV3_NOW = Date.parse('2026-11-18T10:00:00+08:00');
const ev3 = async (turns, { loc = true, dj = null, saved } = {}) => {
  const messages = [];
  let pending;
  const out = [];
  for (const say of turns) {
    messages.push({ role: 'user', content: say });
    const es = await run({ messages, clientTools: ['device_location'], clientToolResults: [loc ? { id: 'loc1', ok: true, result: { lat: 25.0478, lon: 121.517 } } : { id: 'loc1', ok: false }], ...(pending && { pendingAsk: pending }), ...(dj && { deviceJudge: dj }), ...(saved && { savedPlaces: saved }) }, { now: EV3_NOW });
    const ask = es.find((e) => e.type === 'ask');
    pending = ask?.pending ? { id: ask.id, ...ask.pending } : undefined;
    out.push(es);
    messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('') || '好' });
  }
  return out;
};
const toolsOf = (es) => es.filter((e) => e.type === 'tool_start' && e.name !== 'find_place').map((e) => e.name);
const askOf = (es) => es.find((e) => e.type === 'ask')?.about || null;
const tripIn = (es) => es.find((e) => e.type === 'tool_start' && e.name === 'plan_trip')?.input;
const fromName = (es) => { const f = tripIn(es)?.from; return f?.name || f; };

test('審查 1：有別的意圖（天氣、油價、票價、怎麼坐、帶什麼）不問路線，模型模式也不攔', async () => {
  for (const [q, tool] of [['等公車等很久，明天會下雨嗎', 'weather_tomorrow'], ['公車還要多久，油價多少', 'fuel_price'], ['公車上好冷，明天還要帶外套嗎', null], ['老人坐公車還要付錢嗎', null], ['坐公車還要帶悠遊卡嗎', null], ['公車到哪裡坐', null], ['公車多久一班', null]]) {
    const [es] = await ev3([q]);
    assert.notEqual(askOf(es), 'slot:route', q);
    if (tool) assert.ok(toolsOf(es).includes(tool), q);
    assert.notEqual(parseIntent(q, {}).needs, 'route', q);
  }
  let starts = 0;
  const provider = { mode: 'local', model: 'fake', start() { starts++; return { next: async () => ({ text: '好', calls: [], stop: 'end' }), addResults() {} }; } };
  const h = createAgentHandler({ svc, env: {}, provider });
  const res = { writableEnded: false, writeHead() {}, write() {}, end() { this.writableEnded = true; } };
  await h.handle(res, { messages: msgs('老人坐公車還要付錢嗎') });
  assert.ok(starts > 0 && h.usage('life').modelCalls > 0, '模型模式：交給模型（不被缺欄位攔下）');
});

test('審查 2：剛選了公車 →「剛剛那班公車還要多久」「那班公車還要等多久」「公車一直不來，還要等多久」直接查那一班', async () => {
  for (const q of ['剛剛那班公車還要多久', '那班公車還要等多久', '公車一直不來，還要等多久']) {
    const [, es] = await ev3(['從西門町到台北101怎麼去', q]);
    const bus = es.find((e) => e.type === 'tool_start' && e.name === 'bus_route_eta');
    assert.ok(bus && bus.input.routeName, q);
    assert.equal(askOf(es), null, q);
  }
  const hist = [{ role: 'user', content: '從西門町到台北101怎麼去' }, { role: 'assistant', content: '選「公車 棕9」：省 270 元' }];
  assert.deepEqual(pick(parseIntent('剛剛那班公車還要多久', { history: hist })), { intent: 'bus_route', from: null, to: null, route: '棕9', needs: null });
  assert.equal(parseIntent('公車一直不來，還要等多久', { history: hist }).route, '棕9');
});

test('審查 3：一句問好幾件事不放沒有路線的公車；「我等公車等好久，要去台北101」照行程（坐公車）', async () => {
  const [a] = await ev3(['307還要多久，公車到哪了']);
  assert.ok(a.filter((e) => e.type === 'tool_start' && e.name === 'bus_route_eta').every((e) => e.input.routeName), '沒有 routeName:null');
  const it = parseIntent('307還要多久，公車到哪了', {});
  assert.ok(!(it.also || []).some((x) => x.intent === 'bus_route' && !x.route));
  const [b] = await ev3(['我等公車等好久，要去台北101']);
  assert.equal(tripIn(b)?.prefs?.mode, 'bus');
  assert.ok(!b.some((e) => e.type === 'tool_start' && e.name === 'bus_route_eta' && !e.input.routeName));
});

test('審查 4：手機判斷是查公車、句子是「搭公車到西門町」→ 照行程跑', async () => {
  const [es] = await ev3(['搭公車到西門町'], { dj: { intent: 'bus_route', states: [], engine: 'gemini-nano' } });
  assert.ok(toolsOf(es).includes('plan_trip'));
  assert.equal(askOf(es), null);
  assert.equal(parseIntent('搭公車到西門町', { intent: 'bus_route' }), null, '判斷層的意圖抽不出必要參數：交回規則');
});

test('審查 5：打字回答只收地名；算了、cancel、謝謝、不用了、不知道、我趕時間、今天好熱、叫車、走路都不收', () => {
  for (const t of ['算了', 'cancel', '謝謝', '不用了', '不知道', '我趕時間', '今天好熱', '叫車', '走路', '好', '不是']) {
    assert.equal(resolvePending({ slot: 'to', from: '臺北車站' }, t), null, `to：${t}`);
    assert.equal(resolvePending({ slot: 'from', to: '臺北車站' }, t), null, `from：${t}`);
  }
  assert.equal(resolvePending({ slot: 'to' }, '公司'), '怎麼去公司？');
});

test('審查 6：打字回答的語言跟句型一致（中文輪打英文地名、英文輪打中文地名）', () => {
  assert.equal(resolvePending({ slot: 'to', from: '臺北車站' }, 'Taipei 101'), '從臺北車站到台北101怎麼去？');
  assert.equal(resolvePending({ slot: 'to', from: '臺北車站' }, 'Ximending'), '從臺北車站到西門町怎麼去？');
  assert.equal(resolvePending({ slot: 'to', from: 'Taipei Main Station', lang: 'en' }, '台北101'), 'How do I get from Taipei Main Station to Taipei 101?');
  assert.equal(resolvePending({ slot: 'from', to: 'Taipei Main Station', lang: 'en' }, '西門町'), 'How do I get from Ximending to Taipei Main Station?');
  for (const q of ['從臺北車站到台北101怎麼去？', 'How do I get from Taipei Main Station to Taipei 101?', 'How do I get from Ximending to Taipei Main Station?']) {
    const it = parseIntent(q, {});
    assert.equal(it.intent, 'trip', q);
    assert.ok(it.from && it.to, q);
  }
});

test('審查 7：只問一次——「那去台北101呢」「改去台北101」不再問；按了「用我的位置」定位又失敗不再給那個選項', async () => {
  for (const q of ['那去台北101呢', '改去台北101']) {
    const [, es] = await ev3(['從台北車站出發', q]);
    assert.ok(!String(askOf(es) || '').startsWith('slot:'), q);
    assert.ok(toolsOf(es).includes('plan_trip'), q);
  }
  const turns = await ev3(['怎麼去台北車站', '怎麼去臺北車站？', '怎麼去臺北車站？'], { loc: false });
  assert.equal(turns[0].find((e) => e.type === 'ask').options[0].label, '用我的位置');
  for (const es of turns.slice(1)) {
    const a = es.find((e) => e.type === 'ask');
    assert.ok(!a || !a.options.some((o) => o.label === '用我的位置'), '第二次起不再給「用我的位置」');
    assert.match(es.find((e) => e.type === 'text').delta, /還是沒拿到[你您]的位置/);
  }
  const en = await ev3(['How do I get to Taipei Main Station?', 'How do I get to Taipei Main Station?', 'Ximending'], { loc: false });
  assert.equal(en[1].find((e) => e.type === 'ask'), undefined, '英文第二次：只回一句');
  assert.equal(fromName(en[2]), '西門町', '打地名就從那裡算');
});

test('審查 8：缺欄位的問題，「不用」「好」「不是」「沒有」「不要」不會選中按鈕', () => {
  const route = slotAsk(parseIntent('公車還要多久？', {})).ask;
  const to = slotAsk(parseIntent('從台北車站出發', {})).ask;
  for (const t of ['不用', '好', '不是', '沒有', '不要', 'yes', 'no']) {
    assert.equal(matchAnswer(route, t), null, t);
    assert.equal(matchAnswer(to, t), null, t);
  }
});

test('審查 9：「我在板橋，要出發了」→「台北101」→「那叫車呢」起點仍是板橋（英文同理）', async () => {
  const t = await ev3(['我在板橋，要出發了', '台北101', '那叫車呢']);
  assert.equal(fromName(t[1]), '板橋車站');
  assert.equal(fromName(t[2]), '板橋車站');
  assert.equal(tripIn(t[2])?.prefs?.mode, 'ridehail');
  const e = await ev3(["I'm leaving from Taipei Main Station", '台北101', 'by taxi instead']);
  assert.equal(fromName(e[2]), '臺北車站');
});

test('審查建議：英文不誤問路線、go home 當目的地、「那坐公車要多久」改坐公車、常用地點與最近的火車站也看預設起點', async () => {
  for (const q of ['Where is the bus station?', 'I am waiting for the bus', 'Is there a bus late at night?']) assert.notEqual(parseIntent(q, {}).needs, 'route', q);
  const home = parseIntent("I'm at Taipei 101, about to go home", { saved: { 家: { name: '家', lat: 25.014, lon: 121.4637 } } });
  assert.deepEqual([home.intent, home.from, home.to], ['trip', '台北101', '家']);
  assert.equal(parseIntent("I'm at Taipei 101, about to go home", {}).intent, 'savedMissing');
  const [, bus] = await ev3(['從西門町到台北101怎麼去', '那坐公車要多久']);
  assert.equal(tripIn(bus)?.prefs?.mode, 'bus');
  assert.equal(nearDefaultFrom({ name: '家', lat: 25.0479, lon: 121.5171 }), true, '常用地點（物件）');
  const [rail] = await ev3(['去最近的火車站'], { loc: false });
  assert.equal(askOf(rail), 'slot:from', '沒定位：最近的火車站就是預設起點那一站，先問起點');
  const [home2] = await ev3(['回家'], { loc: false, saved: { 家: { name: '家', lat: 25.0479, lon: 121.5171 } } });
  assert.equal(askOf(home2), 'slot:from', '家就在預設起點旁邊');
});
