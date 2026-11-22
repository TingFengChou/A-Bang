// PM 的 Q 情境（該問就問、不該問就不問，2026-11-22）：歧義地點、缺起站／迄站、只說類別、沒定位問在哪、公車方向、發票號碼、到站提醒。
// 情境本身在 test/scenarios/life-q.json（test/scenarios.test.js 跑）；這裡測規則的零件、打字回答、手機出題（ADR-0020）與模型模式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { destToken, lookupToken, placeGuess, placeLabel, railStationAnswer, nearestStation, busStopSay, topicSay, railFromAsk, isRoadName, scamPasteAsk } from '../core/agent/clarify.js';
import { askFirst } from '../core/agent/clarify-plan.js';
import { resolvePending, PENDING_SLOTS } from '../core/agent/ask.js';
import { parseIntent, placesInText } from '../core/agent/demo-intent.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { createJudge, JUDGE_INTENTS } from '../core/agent/judge.js';
import { createServices } from '../core/index.js';
import { callTool } from '../core/tools/index.js';
import { keyQuestion } from '../core/decide.js';
import { ev } from '../core/agent/events.js';
import { EDGE_ASK_SLOTS, edgeAskShape } from '../core/edge-ask.js';
import { check } from '../scripts/eval/scenario-check.js';

const svc = createServices({ forceMock: true });
const judge = createJudge();
const NOW = Date.parse('2026-11-20T10:00:00+08:00');
const TPE = { lat: 25.0478, lon: 121.517 };
const KHH = { lat: 22.6273, lon: 120.3014 };
const run = async (body, opts = {}) => { const es = []; await runDemo(svc, body, (e) => es.push(e), { now: NOW, judge, ...opts }); return es; };
const at = (pt) => ({ clientTools: ['device_location'], clientToolResults: [pt ? { id: 'loc1', ok: true, result: pt } : { id: 'loc1', ok: false }] });
const one = (t) => [{ role: 'user', content: t }];
const askOf = (es) => es.find((e) => e.type === 'ask');

test('名字的歧義：完整名稱不問；短名、連鎖、區名找出候選；路名、縣市名、太多候選另外處理', () => {
  assert.deepEqual(destToken('去中山'), { token: '中山', bare: false });
  assert.deepEqual(destToken('中正'), { token: '中正', bare: true });
  assert.equal(destToken('去台北101'), null, '有數字的地名照原本流程');
  assert.equal(lookupToken('板橋').exact, '板橋車站');
  assert.equal(lookupToken('中山路').road, '中山路');
  assert.equal(lookupToken('台中'), null, '縣市名不問（照常去台中車站）');
  assert.deepEqual(lookupToken('長庚醫院').cands.sort(), ['林口長庚紀念醫院', '高雄長庚紀念醫院'].sort());
  assert.ok(lookupToken('松山').cands.includes('臺北松山機場'));
  assert.equal(placeLabel('國立中山大學', '中山'), '中山大學');
  assert.equal(placeLabel('捷運中山站', '中山'), '捷運中山站');
  assert.equal(placeLabel('林口長庚紀念醫院', '長庚'), '林口長庚');
  assert.ok(!placesInText('去中山路').includes('捷運中山站'), '「中山路」不是捷運中山站');
  assert.ok(placesInText('去中山站').includes('捷運中山站'));
  const zs = parseIntent('去中山', { history: [] }).ambig;
  assert.deepEqual([placeGuess(zs, TPE).guess, placeGuess(zs, TPE).ask], ['捷運中山站', false], '人在台北：中山站很明確，不問');
  const khh = placeGuess(zs, KHH);
  assert.equal(khh.guess, '國立中山大學', '人在高雄：猜中山大學');
  assert.equal(khh.ask, true);
  assert.equal(placeGuess(parseIntent('去松山', { history: [] }).ambig, TPE).ask, true, '同城多義：松山車站、松山機場');
});

test('只說類別、要出門、公車方向、捷運站名、中獎了嗎、好：意圖與欄位', () => {
  assert.equal(parseIntent('高鐵', { history: [] }).category, 'thsr');
  assert.equal(parseIntent('公車', { history: [] }).category, 'bus');
  assert.deepEqual([parseIntent('叫車', { history: [] }).needs, parseIntent('叫車', { history: [] }).mode], ['to', 'ridehail']);
  const after = parseIntent('叫車', { history: [{ role: 'user', content: '去台北101' }, { role: 'assistant', content: '選捷運' }] });
  assert.deepEqual([after.intent, after.mode, after.to], ['trip', 'ridehail', '台北101'], '有前一趟：改叫車');
  assert.equal(parseIntent('我要出門', { history: [] }).askTo, true);
  assert.deepEqual(['route', 'toward'].map((k) => parseIntent('307 往板橋的還要多久', { history: [] })[k]), ['307', '板橋']);
  assert.equal(parseIntent('中山站下一班', { history: [] }).station, '中山');
  assert.equal(parseIntent('307 公車在市政府站還要多久', { history: [] }).intent, 'bus_route', '有公車路線：不是捷運');
  assert.deepEqual(parseIntent('淡水線下一班', { history: [] }).places, [], '路線名不是地名');
  assert.equal(parseIntent('我中獎了嗎', { history: [] }).wantCheck, true);
  assert.equal(parseIntent('這期發票號碼是多少？', { history: [] }).wantCheck, undefined, '只問號碼不問');
  assert.equal(parseIntent('好', { history: [] }).ack, true);
  assert.equal(parseIntent('高鐵下一班', { history: [] }).anyTo, true);
  assert.equal(parseIntent('高鐵票價', { history: [] }).fare, true);
});

test('打字回答（pendingAsk）：只收站名、地名、城市、站名、號碼；「算了」「謝謝」「我趕時間」、在問別的都不收', () => {
  const r = (slot, extra, t) => resolvePending({ slot, ...extra }, t);
  assert.equal(r('railFrom', { system: 'THSR', to: '台北' }, '台中'), '高鐵台中到台北多少錢');
  assert.equal(r('railFrom', { system: 'THSR', to: '台中' }, '我從左營出發'), '高鐵左營到台中多少錢');
  assert.equal(r('railFrom', { system: 'THSR', to: '台中', lang: 'en' }, 'Zuoying'), 'How much is the HSR ticket from Zuoying to Taichung?');
  assert.equal(r('railFrom', { system: 'THSR', to: '台中' }, '台中'), null, '起站＝迄站');
  assert.equal(r('railFrom', { system: 'THSR', to: '台中' }, '花蓮'), null, '高鐵沒有花蓮站');
  assert.equal(r('railTo', { system: 'THSR', from: '台北' }, '左營'), '高鐵台北到左營下一班');
  assert.equal(r('railTo', { system: 'THSR', fare: true }, '台中'), '高鐵到台中多少錢');
  assert.equal(r('place', {}, '中山大學'), '怎麼去國立中山大學？');
  assert.equal(r('place', {}, '改去松山機場'), '怎麼去臺北松山機場？');
  assert.equal(r('place', { mode: 'ridehail' }, '台北101'), '叫車去台北101');
  assert.equal(r('to', { mode: 'ridehail' }, '台北101'), '叫車去台北101');
  assert.equal(r('topic', { topic: 'thsr' }, '票價'), '高鐵票價');
  assert.equal(r('topic', { topic: 'bus' }, '附近'), '附近的公車站');
  assert.equal(r('topic', { topic: 'here', to: '台北車站' }, '下一班'), '台北車站捷運下一班');
  assert.equal(r('where', { topic: 'weather' }, '台中'), '台中天氣');
  assert.equal(r('where', { topic: 'weather', tomorrow: true }, '我在板橋'), '板橋明天天氣');
  assert.equal(r('busStop', { route: '307' }, '敦化市場'), '307 公車到「敦化市場」還要多久');
  assert.equal(r('busStop', { route: '307' }, '往板橋'), '307 往板橋的還要多久');
  assert.equal(r('invoiceNo', {}, '12345678'), '發票 12345678 有中獎嗎');
  assert.equal(r('invoiceNo', {}, '565'), '發票 565 有中獎嗎');
  for (const [slot, extra] of [['railFrom', { system: 'THSR', to: '台北' }], ['place', {}], ['topic', { topic: 'thsr' }], ['where', { topic: 'weather' }], ['busStop', { route: '307' }], ['invoiceNo', {}]]) {
    for (const t of ['算了', '謝謝', '不用了', '我趕時間', '台中天氣怎樣？', '好']) assert.equal(r(slot, extra, t), null, `${slot}「${t}」不是答案`);
  }
  assert.equal(railStationAnswer('高鐵左營站'), '左營');
  assert.equal(busStopSay({ route: '9999x' }, '市政府'), null, '路線要像路線號');
  assert.equal(topicSay('nope', '票價'), null);
  assert.ok(['railFrom', 'railTo', 'place', 'topic', 'where', 'busStop', 'invoiceNo'].every((k) => Object.hasOwn(PENDING_SLOTS, k)));
});

test('請求驗證：pendingAsk 的新欄位只收列舉；ask 事件的 navigate 只能是 App 內的頁面', () => {
  const base = { messages: one('台中') };
  assert.equal(validateRequest({ ...base, pendingAsk: { id: 'a', slot: 'railFrom', system: 'THSR', to: '台北', fare: true } }).messages.at(-1).content, '高鐵台中到台北多少錢');
  assert.throws(() => validateRequest({ ...base, pendingAsk: { id: 'a', slot: 'railFrom', system: 'BUS', to: '台北' } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ ...base, pendingAsk: { id: 'a', slot: 'busStop', route: '307; drop' } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ ...base, pendingAsk: { id: 'a', slot: 'topic', topic: 'evil' } }), /請求格式錯誤/);
  assert.throws(() => ev.ask({ id: 'x', question: '?', options: [{ label: 'go', kind: 'action', action: { name: 'navigate', to: 'https://evil.example' } }] }), /App 內的頁面/);
  assert.equal(ev.ask({ id: 'x', question: '?', options: [{ label: 'go', kind: 'action', action: { name: 'navigate', to: '#/agent/antifraud' } }] }).options[0].action.to, '#/agent/antifraud');
});

test('高鐵票價沒說起站：有定位用最近的站（不問）；最近的站就是迄站或沒定位要去台北就先問；沒定位先用台北算再問', async () => {
  assert.equal(nearestStation({ lat: 22.6873, lon: 120.3076 }, 'THSR').name, '左營');
  const near = await run({ messages: one('高鐵到台中多少錢'), ...at({ lat: 22.6873, lon: 120.3076 }) });
  assert.equal(near.find((e) => e.type === 'tool_start')?.input.from, '左營');
  assert.ok(!askOf(near));
  const same = await run({ messages: one('高鐵到台北多少錢'), ...at(TPE) });
  assert.equal(askOf(same).about, 'slot:railFrom');
  assert.ok(!same.some((e) => e.type === 'tool_start'), '先問、不查');
  const guess = await run({ messages: one('高鐵到台中多少錢'), ...at(null) });
  assert.equal(guess.find((e) => e.type === 'tool_start')?.input.from, '臺北');
  assert.deepEqual(askOf(guess).options.slice(0, 2).map((o) => [o.label, !!o.guess]), [['台北', true], ['左營', false]]);
  assert.equal(railFromAsk({ system: 'THSR', to: '台中', guess: '台北' }).ask.options.length, 4);
});

test('關鍵因子：走路 15 分內就到不問；趕時間要快 5 分以上才問', () => {
  const walk = { id: 'w', role: 'walk', name: '步行', minutes: 12, cost: 0, walkMin: 12, transfers: 0, waitMin: 0 };
  const taxi = { id: 'r', role: 'ridehail', name: '叫車', minutes: 8, cost: 100, walkMin: 0, transfers: 0, waitMin: 3 };
  assert.equal(keyQuestion([walk, taxi]), null);
  const bus = { id: 'b', role: 'bus', name: '公車', minutes: 30, cost: 15, walkMin: 6, transfers: 0, waitMin: 5 };
  const fast = { ...taxi, minutes: 26 };
  assert.notEqual(keyQuestion([bus, fast])?.state, 'rush', '只快 4 分：不問趕不趕');
});

test('公車：有定位兩個方向都說；說了方向只看那個方向（對不到照實說）', async () => {
  const both = await callTool(svc, 'bus_route_eta', { routeName: '307', near: TPE });
  assert.ok(both.data.focus.other, '另一個方向');
  assert.match(both.speak, /往 /);
  const all = await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307' });
  const dest = all.data.directions[1].label.replace(/^往\s*/, '');
  const way = await callTool(svc, 'bus_route_eta', { routeName: '307', near: TPE, toward: dest });
  assert.equal(way.data.toward.found, true);
  assert.equal(way.data.focus.direction, all.data.directions[1].direction);
  assert.equal(way.data.focus.other, undefined, '指定方向：不再說另一個');
  const miss = await callTool(svc, 'bus_route_eta', { routeName: '307', near: TPE, toward: '火星' });
  assert.match(miss.speak, /沒有往「火星」的方向/);
});

test('到站提醒：建議公車、規則原本要問帶行李時改問提醒（action watchArrival）；趕時間的題目照舊', async () => {
  const es = await run({ messages: one('去中正紀念堂'), ...at(TPE) });
  const a = askOf(es);
  if (a.about === 'remind:bus') {
    assert.equal(a.options[0].kind, 'action');
    assert.equal(a.options[0].action.name, 'watchArrival');
    assert.equal(a.options[0].action.minutes, 3);
  } else assert.match(a.about, /^state:(?:rush|budget)$/);
  const rush = askOf(await run({ messages: one('從西門町去台北101'), ...at(TPE) }));
  assert.equal(rush.about, 'state:rush');
});

test('模型模式：路名、只說類別、認不得的名字、沒說迄站也由程式先問（不交給模型）', async () => {
  let called = 0;
  const provider = { mode: 'local', model: 'fake', start() { called++; return { next: async () => ({ text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  for (const [t, about] of [['高鐵', 'slot:topic'], ['去中山路', 'slot:place'], ['中正', 'slot:place'], ['高鐵票價', 'slot:railTo']]) {
    const es = [];
    await runModel(svc, { messages: one(t) }, (e) => es.push(e), { provider, judge: null, now: NOW });
    assert.equal(askOf(es)?.about, about, t);
  }
  assert.equal(called, 0, '都沒呼叫模型');
  assert.equal(askFirst(parseIntent('去中山', { history: [] })), null, '要先查的不在這裡問');
});

test('審查：老街不是路名；路名的問題回城市名不收；指定方式的歧義地點、打字回答照樣帶著方式；模型模式人在高雄說「去中山」先問', async () => {
  assert.equal(lookupToken('深坑老街')?.road, undefined);
  assert.equal(resolvePending({ slot: 'place', road: true }, '台中'), null, '問路名附近的地標，回城市名接不回那條路');
  assert.equal(resolvePending({ slot: 'place', road: true }, '台中公園'), '怎麼去臺中公園？');
  const es = await run({ messages: one('騎 YouBike 去中山'), ...at(KHH) });
  const a = askOf(es);
  assert.equal(a.pending.mode, 'bike');
  assert.equal(validateRequest({ messages: one('中山大學'), pendingAsk: { id: a.id, ...a.pending } }).messages.at(-1).content, '騎 YouBike去國立中山大學');
  const provider = { mode: 'local', model: 'fake', start() { throw new Error('不該呼叫模型'); } };
  const m = [];
  await runModel(svc, { messages: one('去中山'), ...at(KHH) }, (e) => m.push(e), { provider, judge: null, now: NOW });
  assert.equal(askOf(m)?.about, 'slot:place');
});

// ───── PR #121 獨立審查的必修與建議（寧可不問、不要猜遠的、不要吞掉別的問題） ─────
/** 多輪：每一輪帶上一輪的 pending（模擬前端打字回答）；'@' 開頭＝按了選項（不帶 pending） */
async function conv(turns, pt = TPE) {
  const s2 = createServices({ forceMock: true });
  const msgs = [], out = [];
  let pending;
  for (const raw of turns) {
    const click = raw.startsWith('@'), t = click ? raw.slice(1) : raw;
    msgs.push({ role: 'user', content: t });
    const es = [];
    await runDemo(s2, { messages: msgs, ...at(pt), ...(pending && !click && { pendingAsk: pending }) }, (e) => es.push(e), { now: NOW, judge });
    const a = askOf(es);
    pending = a?.pending ? { id: a.id, ...a.pending } : undefined;
    out.push(es);
    msgs.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
  }
  return out;
}
const tools = (es) => es.filter((e) => e.type === 'tool_start' && e.name !== 'find_place').map((e) => e.name);
const tripTo = (es) => { const t = es.find((e) => e.type === 'tool_start' && e.name === 'plan_trip')?.input.to; return typeof t === 'string' ? t : t?.name; };

test('審查 1：一般詞不是路名（走路、逛街、馬路、公路、網路、一路、迷路、哪一路）；多輪「走路」＝改走路', async () => {
  for (const w of ['中山路', '忠孝東路', '民生東路', '中正路']) assert.equal(isRoadName(w), true, w);
  for (const t of ['走路', '不想走路', '逛街', '我想去逛街', '帶我去逛街', '馬路', '公路', '高速公路', '網路', '一路', '迷路', '你要坐哪一路？', '哪一路？']) {
    const es = await run({ messages: one(t), ...at(TPE) });
    assert.notEqual(askOf(es)?.about, 'slot:place', `「${t}」不問路名`);
    assert.equal(parseIntent(t, { history: [] }).road, undefined, t);
  }
  const [, walk] = await conv(['去台北101', '走路']);
  assert.equal(walk.find((e) => e.type === 'tool_start' && e.name === 'plan_trip')?.input.prefs?.mode, 'walk', '「走路」接在行程後＝改走路');
});

test('審查 2：子字串與通稱不配地點（運動≠捷運動物園、市場、誠品、博物館）；猜的超過 30 公里只問不先查', async () => {
  for (const t of ['去運動', '運動', '去市場', '去誠品', '去博物館']) {
    const es = await run({ messages: one(t), ...at(TPE) });
    assert.ok(!tools(es).includes('plan_trip'), `「${t}」不排行程`);
    assert.ok(!askOf(es), `「${t}」不問`);
  }
  const far = await run({ messages: one('去長庚醫院'), ...at({ lat: 23.9871, lon: 121.6011 }) }); // 人在花蓮：兩間長庚都在 30 公里外
  assert.ok(!tools(far).includes('plan_trip'), '不先查遠的');
  assert.equal(askOf(far).about, 'slot:place');
  assert.ok(!askOf(far).options.some((o) => o.guess), '沒有猜的');
});

test('審查 3：說了「站」「捷運站」只找車站：直接排、不問；南港站、松山站照 main；模型模式不攔', async () => {
  for (const [t, to] of [['去士林捷運站', '捷運士林站'], ['去北投捷運站', '捷運北投站'], ['去大安站', '捷運大安站'], ['去大安捷運站', '捷運大安站'], ['去南港站', '南港車站'], ['去松山站', '松山車站']]) {
    const es = await run({ messages: one(t), ...at(TPE) });
    assert.equal(tripTo(es), to, t);
    assert.notEqual(askOf(es)?.about, 'slot:place', `「${t}」不問是哪裡`);
  }
  assert.equal(askFirst(parseIntent('去南港站', { history: [] })), null);
  assert.equal(askFirst(parseIntent('去大安站', { history: [] })), null);
});

test('審查 4：你就在那裡的追問要真的查（按選項、打「下一班」都不重問）', async () => {
  const [a1, a2] = await conv(['台北車站', '@台北車站捷運下一班']);
  assert.equal(askOf(a1).about, 'slot:topic');
  assert.deepEqual(tools(a2), ['metro_live_board']);
  const [, b2] = await conv(['台北車站', '@台北車站附近的公車站']);
  assert.deepEqual(tools(b2), ['bus_nearby_stations']);
  const [, c2] = await conv(['台北車站', '下一班']);
  assert.deepEqual(tools(c2), ['metro_live_board'], '打「下一班」＝那一題的答案');
  const XMD = { lat: 25.0421, lon: 121.5081 };
  const [d1, d2] = await conv(['西門町', '下一班'], XMD);
  assert.equal(askOf(d1).about, 'slot:topic');
  assert.deepEqual(tools(d2), ['metro_live_board']);
  const [, e2] = await conv(['西門町', '@西門町附近的 YouBike'], XMD);
  assert.deepEqual(tools(e2), ['youbike_nearby']);
});

test('審查 5：票價使用者說的起站不被定位蓋掉；有說起站就直接查、不問', async () => {
  for (const [t, from] of [['我在台中，高鐵到左營票價', '台中'], ['我在板橋，台鐵到台中多少錢', '板橋'], ['人在新竹，高鐵到台北票價', '新竹'], ['在台中，台鐵到台北多少錢', '臺中'], ['我在左營，高鐵到台北多少錢', '左營']]) {
    const es = await run({ messages: one(t), ...at(TPE) });
    assert.equal(es.find((e) => e.type === 'tool_start' && e.name === 'rail_fare')?.input.from.replace(/臺/g, '台'), from.replace(/臺/g, '台'), t);
    assert.ok(!askOf(es), `「${t}」不問`);
  }
});

test('審查 6：歧義題之後接著改（那叫車呢、我趕時間）不再問是哪一個；改去別的地方照常', async () => {
  const [a1, a2, a3] = await conv(['去南港', '那叫車呢', '我趕時間']);
  assert.equal(askOf(a1).about, 'slot:place');
  for (const es of [a2, a3]) { assert.notEqual(askOf(es)?.about, 'slot:place'); assert.equal(tripTo(es), '南港車站'); }
  const [, k2] = await conv(['去中山', '那叫車呢'], KHH);
  assert.equal(tripTo(k2), '國立中山大學', '人在高雄：接著改也用猜的那個（不是地標庫的第一個）');
  const [, c2] = await conv(['去南港', '改去松山機場']);
  assert.equal(tripTo(c2), '臺北松山機場');
});

test('建議 a～g：附近只有一個候選不問；帶行李要划算才問；「這三站」是數字；防詐帶著句子；英文最近站說明；那台鐵呢；站名才收', async () => {
  for (const t of ['去花博', '去士林', '去中正']) assert.notEqual(askOf(await run({ messages: one(t), ...at(TPE) }))?.about, 'slot:place', t);
  const bus = { id: 'c', role: 'intercity', name: '客運', minutes: 78, cost: 95, walkMin: 14, transfers: 0, waitMin: 5 };
  const taxi = { id: 'r', role: 'ridehail', name: '叫車', minutes: 75, cost: 1885, walkMin: 0, transfers: 0, waitMin: 3 };
  assert.equal(keyQuestion([bus, taxi], {}, ['luggage']), null, '去羅東夜市：叫車多 1790 元，不問帶行李');
  assert.equal(edgeAskShape({ slot: 'railTo', question: '這三站要去哪？', options: ['台中', '左營'] }, { lang: 'zh' }), 'digits');
  assert.equal(edgeAskShape({ slot: 'railTo', question: '你要去哪一站？', options: ['台中', '左營'] }, { lang: 'zh' }), null);
  assert.deepEqual(scamPasteAsk('life', null, '這是詐騙嗎').options[0].action, { name: 'handOff', agent: 'antifraud', text: '這是詐騙嗎' });
  assert.throws(() => ev.ask({ id: 'x', question: '?', options: [{ label: 'go', kind: 'action', action: { name: 'handOff', agent: 'life', text: 'x' } }] }), /防詐/);
  const enFare = await run({ messages: one('How much is the HSR ticket to Taichung?'), ...at(TPE) });
  assert.match(enFare.find((e) => e.type === 'text').delta, /nearest to you/);
  const [, tra] = await conv(['高鐵到台中多少錢', '那台鐵呢']);
  const f = tra.find((e) => e.type === 'tool_start' && e.name === 'rail_fare')?.input;
  assert.equal(f?.system, 'TRA');
  assert.match(f?.to, /[台臺]中/);
  assert.equal(resolvePending({ slot: 'busStop', route: '307' }, '等一下'), null);
  assert.equal(resolvePending({ slot: 'busStop', route: '307' }, '市政府'), '307 公車到「市政府」還要多久');
});

// ───── 手機上的 AI 出題（ADR-0020）：新種類的題目通過驗證就用手機的；亂編的照規則 ─────
test('手機出題的新種類：形狀檢查認得、要切題', () => {
  for (const k of ['railFrom', 'railTo', 'place', 'where', 'topic']) assert.ok(EDGE_ASK_SLOTS.includes(k));
  assert.equal(edgeAskShape({ slot: 'railFrom', question: '你從哪一站出發？', options: ['台中', '左營'] }, { lang: 'zh' }), null);
  assert.equal(edgeAskShape({ slot: 'where', question: '今天天氣好嗎？', options: ['好', '不好'] }, { lang: 'zh' }), 'off-topic');
});

const qset = JSON.parse(await readFile(new URL('./scenarios/life-q.json', import.meta.url), 'utf8'));
const atTW = (hhmm = '10:00') => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T${hhmm}:00+08:00`);
/** 合理的模型：看得出缺什麼就出跟規則一樣的題目（選項是常識：站名、城市、類別） */
function reasonable(text) {
  const en = !/[一-鿿]/.test(text);
  const fare = /高鐵到(.+?)多少錢/.exec(text);
  if (fare) return { slot: 'railFrom', question: '你要從哪一站出發？', options: /台北|臺北/.test(fare[1]) ? ['台中', '左營'] : ['台北', '板橋'] };
  if (/HSR ticket to Taipei/i.test(text)) return { slot: 'railFrom', question: 'Which station are you starting from?', options: ['Taichung', 'Zuoying'] };
  if (/^去中山$/.test(text)) return { slot: 'place', question: '你要去哪個中山？', options: ['中山大學', '捷運中山站'] };
  if (/^去松山$/.test(text)) return { slot: 'place', question: '你要去哪個松山？', options: ['松山車站', '松山機場'] };
  if (/^去長庚醫院$/.test(text)) return { slot: 'place', question: '你要去哪一間長庚？', options: ['林口長庚', '高雄長庚'] };
  if (/^現在天氣如何$/.test(text)) return { slot: 'where', question: '你在哪裡？', options: ['台北', '台中'] };
  if (/^高鐵下一班$/.test(text)) return { slot: 'railTo', question: '你要去哪一站？', options: ['台中', '左營'] };
  if (/^高鐵$/.test(text)) return { slot: 'topic', question: '要查高鐵的什麼？', options: ['下一班', '票價'] };
  if (/^公車$/.test(text)) return { slot: 'topic', question: '要查公車的什麼？', options: ['附近的公車站', '某一路多久到'] };
  return en ? null : null;
}
/** 亂來的模型：編站名、編地名、選項不是候選、誘導 */
const CHAOS = [
  { slot: 'railFrom', question: '你從哪一站出發？', options: ['火星', '月球'] },
  { slot: 'place', question: '你要去哪個地方？', options: ['西門町', '台北101'] },
  { slot: 'where', question: '你在哪裡？', options: ['加LINE', '台中'] },
  { slot: 'topic', question: '要查什麼？', options: ['股票', '紅包'] },
  { slot: 'railTo', question: '你要去哪一站？', options: ['台北', '台北 '] },
];
for (const [name, fake] of [['合理', reasonable], ['亂來', (_t, i) => ({ ...CHAOS[i % CHAOS.length], options: [...CHAOS[i % CHAOS.length].options] })]]) {
  test(`Q 情境＋手機出題「${name}」：全部照舊通過（合理的採用手機題目、亂來的照規則）`, async () => {
    let used = 0, n = 0;
    for (const sc of qset.scenarios.filter((x) => !x.known)) { // known：等產品負責人決定的衝突（Q-7）
      const svc2 = createServices({ forceMock: true });
      const messages = [];
      let pendingAsk;
      for (const [i, t] of sc.turns.entries()) {
        messages.push({ role: 'user', content: t.say });
        const prior = messages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content);
        const q0 = await judge.quick(t.say, prior);
        const ask = fake(t.say, n++);
        const deviceJudge = sc.profile ? undefined : { intent: Object.hasOwn(JUDGE_INTENTS, q0.intent) ? q0.intent : 'unknown', states: [], engine: 'gemini-nano', ...(ask && { ask }) };
        const es = [];
        await runDemo(svc2, { messages, clientTools: ['device_location'], clientToolResults: [sc.location !== false ? { id: 'loc1', ok: true, result: sc.here || qset.here } : { id: 'loc1', ok: false }], ...(pendingAsk && { pendingAsk }), ...(deviceJudge && { deviceJudge }) }, (e) => es.push(e), { judge, now: atTW(sc.at), profileId: sc.profile || 'life' });
        const a = askOf(es);
        pendingAsk = a?.pending ? { id: a.id, ...a.pending } : undefined;
        assert.deepEqual(check(es, t.expect), [], `${sc.id} 第 ${i + 1} 輪「${t.say}」（${name}：${JSON.stringify(ask)}）`);
        if (a?.askSource === 'device') used++;
        if (name === '亂來') assert.notEqual(a?.askSource, 'device', `${sc.id}「${t.say}」亂來的題目不能被採用`);
      }
    }
    if (name === '合理') assert.ok(used >= 8, `合理的手機題目要被採用（${used}）`);
  });
}
