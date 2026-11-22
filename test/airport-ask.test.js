// 「去機場」沒說哪個機場（ADR-0016 該問就問）：有位置先用最近的機場算並問、沒位置只問、說了明確的機場或航廈不問。
// 情境在 test/scenarios/life-q.json（Q-28～Q-35）；這裡測零件、打字回答與模型模式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportGuess, airportAsk, airportAnswer, AIRPORT_GUESS_M } from '../core/agent/clarify.js';
import { planAsk, askFirst } from '../core/agent/clarify-plan.js';
import { resolvePending } from '../core/agent/ask.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { createServices } from '../core/index.js';

const svc = createServices({ forceMock: true });
const NOW = Date.parse('2026-11-20T10:00:00+08:00');
const TPE = { lat: 25.0478, lon: 121.517 };
const ZHONGLI = { lat: 24.9537, lon: 121.2256 };
const TXG = { lat: 24.1373, lon: 120.6869 };
const KHH = { lat: 22.6273, lon: 120.3014 };
const CHIAYI = { lat: 23.4801, lon: 120.4491 };
const one = (t) => [{ role: 'user', content: t }];
const at = (pt) => ({ clientTools: ['device_location'], clientToolResults: [pt ? { id: 'loc1', ok: true, result: pt } : { id: 'loc1', ok: false }] });
const run = async (body) => { const es = []; await runDemo(svc, body, (e) => es.push(e), { now: NOW, judge: null }); return es; };

test('沒說哪個機場的說法都聽得懂；說了明確的機場、航廈、機場捷運不算', () => {
  for (const s of ['去機場', '我要去機場', '怎麼去機場？', '到機場怎麼走', '機場', '載我去機場', 'How do I get to the airport?', 'Take me to the airport', 'to the airport']) {
    const it = parseIntent(s);
    assert.equal(it.intent, 'trip', s);
    assert.equal(it.airport, true, s);
    assert.equal(it.to, null, s);
  }
  assert.equal(parseIntent('叫車去機場').mode, 'ridehail');
  assert.equal(parseIntent('Taxi to the airport').mode, 'ridehail');
  assert.equal(parseIntent('我在板橋，要去機場').from, '板橋車站');
  for (const [s, to] of [['去桃園機場', '臺灣桃園國際機場'], ['去第二航廈', '臺灣桃園國際機場'], ['去松山機場', '臺北松山機場'], ['到小港機場', '高雄國際機場']]) {
    const it = parseIntent(s);
    assert.equal(it.to, to, s);
    assert.ok(!it.airport, s);
  }
  assert.notEqual(parseIntent('機場捷運下一班').airport, true);
  assert.notEqual(parseIntent('Airport MRT to Taipei').airport, true);
});

test('最近的機場：台北松山、桃園一帶桃園、台中清泉崗、高雄小港；最多 3 個、最近的放第一；太遠或沒位置不猜', () => {
  assert.equal(airportGuess(TPE).guess, '臺北松山機場');
  assert.equal(airportGuess(TPE).order[1], '臺灣桃園國際機場');
  assert.equal(airportGuess(ZHONGLI).guess, '臺灣桃園國際機場');
  assert.equal(airportGuess(TXG).guess, '臺中國際機場');
  assert.equal(airportGuess(KHH).guess, '高雄國際機場');
  for (const p of [TPE, ZHONGLI, TXG, KHH]) assert.ok(airportGuess(p).order.length <= 3);
  assert.equal(airportGuess(CHIAYI).guess, null, `嘉義離最近的主要機場超過 ${AIRPORT_GUESS_M / 1000} 公里：只問`);
  assert.ok(airportGuess(CHIAYI).order.length >= 2);
  const none = airportGuess(null);
  assert.equal(none.guess, null);
  assert.deepEqual(none.order, ['臺灣桃園國際機場', '臺北松山機場', '高雄國際機場']);
  // 英文那一輪只列有英文名稱的機場（選項的句子規則要聽得懂）
  assert.ok(airportGuess(KHH, { en: true }).order.every((n) => n !== '臺南機場'));
});

test('問句與選項：短名、猜的標第一個、按了送出完整的一句（規則聽得懂）、打字回答由 place slot 接回', () => {
  const a = airportAsk(airportGuess(TPE).order, { guess: true });
  assert.equal(a.ask.question, '要去哪個機場？');
  assert.equal(a.ask.options[0].label, '松山機場');
  assert.equal(a.ask.options[0].guess, true);
  assert.ok(a.ask.options.slice(1).every((o) => !o.guess));
  assert.equal(a.ask.options[1].label, '桃園機場');
  assert.deepEqual(a.ask.pending, { slot: 'place', airport: true });
  for (const o of a.ask.options) assert.equal(parseIntent(o.say).to, airportGuess(TPE).order[a.ask.options.indexOf(o)], o.say);
  const ride = airportAsk(['臺北松山機場'], { mode: 'ridehail' });
  assert.equal(ride.ask.options[0].say, '叫車去臺北松山機場');
  assert.equal(ride.ask.pending.mode, 'ridehail');
  const en = airportAsk(airportGuess(TPE, { en: true }).order, { guess: true, lang: 'en' });
  assert.equal(en.ask.question, 'Which airport?');
  assert.equal(en.ask.options[0].label, 'Songshan Airport');
  assert.equal(parseIntent(en.ask.options[0].say).to, '臺北松山機場');
  // 打字回答：短名就是那個機場（「桃園」不是桃園車站）；不是答案就照原句
  for (const [t, name] of [['桃園', '臺灣桃園國際機場'], ['小港', '高雄國際機場'], ['松山的', '臺北松山機場'], ['清泉崗', '臺中國際機場'], ['第二航廈', '臺灣桃園國際機場'], ['Taoyuan', '臺灣桃園國際機場']]) assert.equal(airportAnswer(t), name, t);
  assert.equal(airportAnswer('謝謝'), null);
  assert.equal(resolvePending({ id: 'a', slot: 'place', airport: true }, '桃園'), '怎麼去臺灣桃園國際機場？');
  assert.equal(resolvePending({ id: 'a', slot: 'place', airport: true, mode: 'ridehail' }, '小港'), '叫車去高雄國際機場');
  assert.equal(resolvePending({ id: 'a', slot: 'place', airport: true }, '算了'), null);
  assert.equal(resolvePending({ id: 'a', slot: 'place', airport: true }, '明天天氣如何？'), null);
  // pendingAsk 收 airport（validateRequest 改寫成完整的一句）
  const req = validateRequest({ messages: one('桃園'), pendingAsk: { id: 'ask-t1', slot: 'place', airport: true } });
  assert.equal(req.messages.at(-1).content, '怎麼去臺灣桃園國際機場？');
});

test('planAsk：有位置先查並問、沒位置只問、接著改條件不再問', () => {
  const it = { ...parseIntent('去機場'), fromPoint: KHH };
  const p = planAsk(it);
  assert.ok(p.after && !p.stop);
  assert.equal(it.to, '高雄國際機場');
  assert.equal(p.after({}).ask.options[0].guess, true);
  const noLoc = parseIntent('去機場');
  const q = planAsk(noLoc);
  assert.ok(q.stop);
  assert.equal(noLoc.to, null);
  assert.ok(q.stop.ask.options.every((o) => !o.guess));
  const far = { ...parseIntent('去機場'), fromPoint: CHIAYI };
  assert.ok(planAsk(far).stop, '最近的機場太遠：只問');
  const fu = { ...parseIntent('去機場'), fromPoint: TPE, followUp: true };
  assert.equal(planAsk(fu), null);
  assert.equal(fu.to, '臺北松山機場');
  // 說了起點（「我在板橋，要去機場」）：用起點找最近的機場
  const fromSaid = parseIntent('我在板橋，要去機場');
  assert.ok(planAsk(fromSaid).after);
  assert.equal(fromSaid.to, '臺北松山機場');
});

test('示範模式：有定位排到最近的機場並問；拒絕定位只問（不查）', async () => {
  const es = await run({ messages: one('去機場'), ...at(TXG) });
  const trip = es.find((e) => e.type === 'tool_result' && (e.tool || e.name) === 'plan_trip');
  assert.ok(trip, '應該排行程');
  assert.match(String(trip.data?.to?.name || ''), /[台臺]中國際機場/);
  const ask = es.find((e) => e.type === 'ask');
  assert.equal(ask.question, '要去哪個機場？');
  assert.equal(ask.options[0].label, '台中清泉崗機場');
  assert.equal(ask.options[0].guess, true);
  const no = await run({ messages: one('去機場'), ...at(null) });
  assert.ok(!no.some((e) => e.type === 'tool_start'), '沒定位不查');
  assert.equal(no.filter((e) => e.type === 'ask').length, 1);
  assert.ok(!no.filter((e) => e.type === 'text').map((e) => e.delta).join('').includes('我可以幫你查'), '不列功能清單');
});

test('模型模式：去哪個機場由程式先問，不呼叫模型', async () => {
  const provider = { mode: 'local', model: 'fake', start() { throw new Error('不該呼叫模型'); } };
  const es = [];
  await runModel(svc, { messages: one('去機場') }, (e) => es.push(e), { provider, judge: null, now: NOW });
  const ask = es.find((e) => e.type === 'ask');
  assert.equal(ask?.question, '要去哪個機場？');
  assert.deepEqual(ask.options.map((o) => o.label), ['桃園機場', '松山機場', '高雄小港機場']);
  assert.equal(askFirst(parseIntent('去桃園機場')), null);
});
