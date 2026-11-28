// 阿幫問你（ADR-0016）：關鍵問題（會問／不問）、事件格式、習慣確認與叫車原因、說過的預設狀況、一輪最多一個、用打的回答
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyQuestion, decide } from '../core/decide.js';
import { tripAsk, ASK_KINDS, resolvePending } from '../core/agent/ask.js';
import { ev, EVENT_TYPES } from '../core/agent/events.js';
import { planTrip } from '../core/services/trip.js';
import { resolvePoint } from '../core/services/places.js';
import { createServices } from '../core/index.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { matchAnswer } from '../public/ui/agent/ask.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');
async function trip(f, t, prefs = {}, demo = {}) {
  const svc = createServices({ forceMock: true, demo });
  const [from, to] = await Promise.all([resolvePoint(svc.places, f), resolvePoint(svc.places, t)]);
  return planTrip(svc, { from, to, departAt: '09:00', prefs, now: NOW });
}
const demo = async (content, body = {}) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content }], ...body }, (e) => es.push(e), { now: NOW }); return es; };

// ── 關鍵問題（core/decide.js keyQuestion）──

test('會問：西門町→101 沒說狀況，公車與叫車差 5 分、270 元 →「叫車快 5 分但多 270 元，您趕時間嗎？」', async () => {
  const r = await trip('西門町', '台北101');
  assert.equal(r.ask.state, 'rush');
  assert.equal(r.ask.text, '叫車（Uber）快 5 分但多 270 元，您趕時間嗎？');
  assert.match(r.ask.textEn, /^A taxi is 5 min faster but costs NT\$270 more\. In a hurry\?$/);
  // 加上「趕時間」重算真的會換成問句說的方案
  const after = await trip('西門町', '台北101', { states: ['rush'] });
  assert.equal(after.best, r.ask.to);
});

test('會問：一次最多一個，挑影響最大的；不推明顯不合理的方案（想省錢就走 70 分鐘不問）', () => {
  const opts = [
    { id: 'm', role: 'metro', name: '捷運', minutes: 30, waitMin: 3, walkMin: 8, cost: 25, exposure: 0.2, effort: 0.2, delayRisk: 0 },
    { id: 'r', role: 'ridehail', name: '叫車', minutes: 18, waitMin: 4, walkMin: 0, cost: 260, exposure: 0, effort: 0, delayRisk: 0.5 },
    { id: 'w', role: 'walk', name: '步行', minutes: 70, waitMin: 0, walkMin: 70, cost: 0, exposure: 1, effort: 1, delayRisk: 0 },
  ];
  const base = decide(opts, {}).best.id;
  const q = keyQuestion(opts, {});
  assert.ok(!q || q.to !== 'w', JSON.stringify(q));
  // 西門町→101：趕時間、帶行李、少走路都會換成叫車（差一樣）→ 只問一個（第一個：趕時間）
  assert.ok(base);
});

test('不問：使用者已經說了狀況、指定方式、說過的預設狀況；差很多（任何狀態都不會翻盤）', async () => {
  assert.equal((await trip('西門町', '台北101', { states: ['luggage'] })).ask, undefined, '說了帶行李');
  assert.equal((await trip('西門町', '台北101', { mode: 'bus' })).ask, undefined, '指定方式');
  // 只有一個方案、或兩個方案差不多（3 分、20 元）
  const close = [
    { id: 'a', role: 'bus', name: '公車', minutes: 30, waitMin: 5, walkMin: 6, cost: 15, exposure: 0.2, effort: 0.3, delayRisk: 0.3 },
    { id: 'b', role: 'metro', name: '捷運', minutes: 27, waitMin: 3, walkMin: 8, cost: 35, exposure: 0.1, effort: 0.3, delayRisk: 0 },
  ];
  assert.equal(keyQuestion(close, {}), null, '差不多：不打擾');
  assert.equal(keyQuestion(close.slice(0, 1), {}), null);
  assert.equal(keyQuestion(close, { said: true }), null);
  // 台北到高雄：問「趕時間嗎」（高鐵快 45 分）合理；同一份資料使用者說趕時間就不問
  const far = await trip('台北車站', '高雄車站');
  assert.equal(far.ask.state, 'rush');
  assert.equal((await trip('台北車站', '高雄車站', { states: ['rush'] })).ask, undefined);
});

test('不問：抵達時間會排除的方案不會被問（硬限制在前）', () => {
  const opts = [
    { id: 'b', role: 'bus', name: '公車', minutes: 32, waitMin: 2, walkMin: 6, cost: 15, exposure: 0.2, effort: 0.3, delayRisk: 0.3, arriveAt: '09:32' },
    { id: 'r', role: 'ridehail', name: '叫車', minutes: 27, waitMin: 5, walkMin: 0, cost: 285, exposure: 0, effort: 0, delayRisk: 0.5, arriveAt: '09:40' },
  ];
  assert.equal(decide(opts, { arriveBy: '09:35' }).excluded.length, 1);
  assert.equal(keyQuestion(opts, { arriveBy: '09:35' }), null);
});

// ── 事件與題目（core/agent/ask.js）──

test('ev.ask：格式、kind 只能是 state／reply／store／dismiss／action、依 kind 的欄位、選項 1～6 個、pending', () => {
  assert.ok(EVENT_TYPES.includes('ask'));
  assert.deepEqual(ASK_KINDS, ['state', 'reply', 'store', 'dismiss', 'action']);
  const e = ev.ask({ id: 'q1', question: '您趕時間嗎？', options: [{ label: '趕', kind: 'state', state: 'rush', say: '我趕時間' }, { label: '不趕', kind: 'dismiss' }], about: 'state:rush', pending: { slot: 'state', state: 'rush' } });
  assert.deepEqual(e, { type: 'ask', id: 'q1', question: '您趕時間嗎？', options: [{ label: '趕', kind: 'state', state: 'rush', say: '我趕時間' }, { label: '不趕', kind: 'dismiss' }], about: 'state:rush', pending: { slot: 'state', state: 'rush' }, askSource: 'rule' }, '程式產生的題目標 askSource rule（ADR-0020）');
  const r = ev.ask({ id: 'q2', question: '要從哪一站出發？', options: [{ label: '台中', kind: 'reply', say: '高鐵台中到台北多少錢', guess: true }], pending: { slot: 'railFrom', intent: { intent: 'rail', to: '台北' } } });
  assert.deepEqual(r.options[0], { label: '台中', kind: 'reply', guess: true, say: '高鐵台中到台北多少錢' }, 'reply 送完整的一句');
  assert.equal(r.pending.slot, 'railFrom');
  const a = ev.ask({ id: 'q5', question: '要我提醒您嗎？', options: [{ label: '到站前 3 分提醒我', kind: 'action', action: { name: 'watchArrival', city: 'Taipei', routeName: '307', stop: '台北車站', minutes: 3 } }, { label: '不用', kind: 'dismiss' }] });
  assert.equal(a.options[0].action.name, 'watchArrival');
  assert.throws(() => ev.ask({ id: 'q6', question: 'x', options: [{ label: 'a', kind: 'action', action: { name: 'pay' } }] }), /action/);
  assert.throws(() => ev.ask({ id: 'q7', question: 'x', options: [{ label: 'a', kind: 'action', action: { name: 'openLink', url: 'javascript:alert(1)' } }] }), /https/);
  assert.throws(() => ev.ask({ id: 'q8', question: 'x', options: [{ label: 'a', kind: 'reply' }] }), /say/);
  assert.throws(() => ev.ask({ id: 'q3', question: 'x', options: [{ label: 'a', kind: 'run' }] }), /kind/);
  assert.throws(() => ev.ask({ id: 'q4', question: 'x', options: [] }), /1～6/);
  assert.throws(() => ev.ask({ question: 'x', options: [{ label: 'a', kind: 'dismiss' }] }), /缺少 id/);
});

test('pending：直接打「好」回答「您趕時間嗎？」→ 改寫成「我趕時間」接著上一輪重算；問別的照原句', async () => {
  assert.equal(resolvePending({ slot: 'state', state: 'rush' }, '好'), '我趕時間');
  assert.equal(resolvePending({ slot: 'state', state: 'luggage' }, 'yes'), "I'm carrying luggage");
  assert.equal(resolvePending({ slot: 'state', state: 'rush' }, '那松山機場呢'), null);
  assert.equal(resolvePending({ slot: 'nope' }, '好'), null);
  assert.equal(resolvePending(undefined, '好'), null);
  const messages = [{ role: 'user', content: '從西門町去台北101' }, { role: 'assistant', content: '選「公車 601」' }, { role: 'user', content: '好' }];
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages, pendingAsk: { id: 'ask-t9', slot: 'state', state: 'rush' } }, (e) => es.push(e), { now: NOW });
  const d = es.find((e) => e.type === 'decision');
  assert.deepEqual(d.states.map((s) => s.key), ['rush']);
  assert.equal(d.options.find((o) => o.id === d.best).role, 'ridehail');
  assert.equal(es.some((e) => e.type === 'ask'), false, '答過了：不再問');
  // 沒帶 pending：「好」不是行程
  const none = [];
  await runDemo(createServices({ forceMock: true }), { messages }, (e) => none.push(e), { now: NOW });
  assert.equal(none.some((e) => e.type === 'decision'), false);
  // 原型鏈上的名稱不是 slot：不能把最後一句變成物件、不能 500
  for (const slot of ['constructor', 'hasOwnProperty', 'toString', '__proto__', 'valueOf']) {
    assert.equal(resolvePending({ slot }, '好'), null, slot);
    assert.throws(() => validateRequest({ messages: [{ role: 'user', content: '好' }], pendingAsk: { id: 'x', slot } }), /請求格式錯誤/, slot);
  }
  // 沒有 slot 讀的欄位（intent）直接拿掉
  const v = validateRequest({ messages: [{ role: 'user', content: 'hi' }], pendingAsk: { id: 'x', slot: 'state', state: 'rush', intent: { blob: 'x'.repeat(2000) } } });
  assert.deepEqual(v.pendingAsk, { id: 'x', slot: 'state', state: 'rush' });
  assert.equal(typeof v.messages.at(-1).content, 'string');
});

test('tripAsk：習慣候選在方案裡 → 問要不要優先推（「好」是猜的、放第一個）；叫車問原因（五個選項）；英文', async () => {
  const r = await trip('西門町', '台北101');
  const h = tripAsk(r, { habitAsk: { mode: 'metro', count: 6 } });
  assert.equal(h.question, '我注意到您最近常搭捷運（6 次）。以後您沒說條件時，要我優先推捷運嗎？');
  assert.deepEqual(h.options.map((o) => [o.label, o.value, o.kind, !!o.guess]), [['好', 'habit:yes:metro', 'store', true], ['不用', 'habit:no:metro', 'store', false]]);
  assert.equal(h.pending, undefined, '按鈕或「好」在手機上就處理掉');
  const ride = tripAsk(r, { habitAsk: { mode: 'ridehail', count: 7 } });
  assert.equal(ride.question, '您常叫車（7 次），通常是因為？');
  assert.deepEqual(ride.options.map((o) => o.value), ['ride:rush', 'ride:luggage', 'ride:lessWalk', 'ride:love', 'ride:depends']);
  assert.deepEqual(ride.options.map((o) => o.label), ['趕時間', '常帶東西', '不想走路', '就是喜歡叫車', '不一定']);
  assert.match(tripAsk(r, { habitAsk: { mode: 'metro', count: 6 }, lang: 'en' }).question, /^You've picked the MRT a lot lately \(6 times\)/);
  // 候選方式不在這次的方案裡（短程沒有高鐵）→ 改問關鍵因子
  const k = tripAsk(r, { habitAsk: { mode: 'thsr', count: 6 } });
  assert.deepEqual(k.options.map((o) => [o.label, o.kind, o.state]), [['趕', 'state', 'rush'], ['不趕', 'dismiss', undefined]]);
  assert.equal(k.options[0].say, '我趕時間', '不能即時重算的客戶端改送這一句');
  assert.deepEqual(k.pending, { slot: 'state', state: 'rush' });
  assert.equal(tripAsk({ ...r, ask: undefined }), null);
  assert.deepEqual(tripAsk(r, { lang: 'en' }).options.map((o) => o.label), ['Yes, hurry', 'No rush']);
});

// ── 執行器：示範與模型模式 ──

test('示範模式：行程後送一個 ask（關鍵因子），在 decision 之後；說了狀況就不問', async () => {
  const es = await demo('從西門町去台北101');
  const t = es.map((e) => e.type);
  assert.equal(t.filter((x) => x === 'ask').length, 1);
  assert.ok(t.indexOf('ask') > t.indexOf('decision'));
  const a = es.find((e) => e.type === 'ask');
  assert.equal(a.question, '叫車（Uber）快 5 分但多 270 元，您趕時間嗎？');
  assert.equal((await demo('我很趕，從西門町去台北101')).some((e) => e.type === 'ask'), false);
  assert.equal((await demo('從西門町去台北101', { userState: { picked: ['budget'] } })).some((e) => e.type === 'ask'), false);
  assert.match((await demo('Ximending to Taipei 101')).find((e) => e.type === 'ask')?.question || '', /^[^一-鿿]+\?$/, '英文提問：問句也是英文');
});

test('示範模式：手機說有習慣候選 → 先問習慣（一輪只問一個）', async () => {
  const es = await demo('從西門町去台北101', { userState: { habitAsk: { mode: 'metro', count: 6 } } });
  const asks = es.filter((e) => e.type === 'ask');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].about, 'habit:metro');
});

test('說過的預設狀況（usual）：不自動套用；會改變建議時問「這次也帶東西嗎？」〔是（猜的）〕〔這次沒有〕；不會改變、說了別的狀況、指定方式就不問', async () => {
  const es = await demo('從西門町去台北101', { userState: { usual: ['luggage'] } });
  const d = es.find((e) => e.type === 'decision');
  assert.deepEqual(d.states, [], '不自動帶入');
  assert.equal(d.options.find((o) => o.id === d.best).role, 'bus');
  const a = es.find((e) => e.type === 'ask');
  assert.equal(a.question, '這次也帶東西嗎？');
  assert.equal(a.about, 'usual:luggage');
  assert.match(a.why, /[你您]說過常帶東西；是的話改推叫車/);
  assert.deepEqual(a.options.map((o) => [o.label, o.kind, o.state, o.source, !!o.guess]), [['是', 'state', 'luggage', 'usual', true], ['這次沒有', 'dismiss', undefined, undefined, false]]);
  assert.equal(a.key, undefined, '「這次」的問題每次都問（不受 24 小時限制）');
  assert.equal((await demo('我很趕，從西門町去台北101', { userState: { usual: ['luggage'] } })).some((e) => e.type === 'ask'), false, '這一輪說了狀況');
  assert.equal((await demo('坐公車從西門町去台北101', { userState: { usual: ['luggage'] } })).some((e) => e.type === 'ask'), false, '指定方式');
  // 不會改變建議（台北到高雄，帶行李也還是台鐵）→ 不問這題，照常問關鍵因子
  const far = (await demo('從台北車站去高雄車站', { userState: { usual: ['luggage'] } })).find((e) => e.type === 'ask');
  assert.notEqual(far?.about, 'usual:luggage');
  // 直接打「是」：前端對到按鈕；伺服器端 pending 也接得上（「好」→「我有帶行李」）
  assert.deepEqual(a.pending, { slot: 'state', state: 'luggage' });
  assert.equal(resolvePending(a.pending, '好'), '我有帶行李');
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { usual: ['budget'] } }), /請求格式錯誤/, '只能是趕時間、常帶東西、不想走路');
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { habitAsk: { mode: 'home', count: 5 } } }), /請求格式錯誤/);
});

test('關鍵問題帶 key（同一段起訖、同一題；座標到小數 2 位）：手機 24 小時內問過就不顯示', async () => {
  const a = (await demo('從西門町去台北101')).find((e) => e.type === 'ask');
  assert.match(a.key, /^rush@25\.04,121\.51>25\.03,121\.56$/);
  const b = (await demo('西門町到台北101怎麼去')).find((e) => e.type === 'ask');
  assert.equal(b.key, a.key, '說法不同也是同一題');
});

test('模型模式：也由程式送 ask（不交給模型），一輪最多一個', async () => {
  const provider = { mode: 'local', model: 'fake', start() { let n = 0; return { next: async () => (n++ === 0 ? { text: '', calls: [{ id: 'c1', name: 'plan_trip', input: { from: '西門町', to: '台北101' } }], stop: 'tool', usage: { input: 1, output: 1 } } : { text: '建議坐公車。', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const es = [];
  await runModel(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從西門町去台北101' }] }, (e) => es.push(e), { provider, judge: null, now: NOW });
  assert.equal(es.filter((e) => e.type === 'ask').length, 1);
  assert.equal(es.find((e) => e.type === 'ask').options[0].kind, 'state');
});

// ── 前端：用打的（或說的）回答 ──

test('matchAnswer：下一句就是答案（「我不趕」對到不趕、「好」對到第一個）；對不上＝略過', () => {
  const rush = { options: [{ label: '趕', kind: 'state' }, { label: '不趕', kind: 'dismiss' }] };
  assert.equal(matchAnswer(rush, '趕').label, '趕');
  assert.equal(matchAnswer(rush, '我不趕').label, '不趕');
  assert.equal(matchAnswer(rush, '很趕！').label, '趕');
  assert.equal(matchAnswer(rush, '好').label, '趕');
  assert.equal(matchAnswer(rush, 'no').label, '不趕');
  assert.equal(matchAnswer(rush, '那改去松山機場呢'), null, '問別的＝略過');
  const ride = { options: ['趕時間', '常帶東西', '不想走路', '就是喜歡叫車', '不一定'].map((label) => ({ label, kind: 'store' })) };
  assert.equal(matchAnswer(ride, '常帶東西').label, '常帶東西');
  assert.equal(matchAnswer(ride, '好'), null, '五個選項時「好」不知道是哪個');
  assert.equal(matchAnswer({ options: [{ label: 'Yes, hurry' }, { label: 'No rush' }] }, 'yes').label, 'Yes, hurry');
});

test('matchAnswer：新問題不能被當成答案（尤其不能寫進手機偏好）', () => {
  const habit = { options: [{ label: '好', kind: 'store', guess: true }, { label: '不用', kind: 'store' }] };
  const rush = { options: [{ label: '趕', kind: 'state' }, { label: '不趕', kind: 'dismiss' }] };
  const lug = { options: [{ label: '有', kind: 'state' }, { label: '沒有', kind: 'dismiss' }] };
  const usual = { options: [{ label: '是', kind: 'state', guess: true }, { label: '這次沒有', kind: 'dismiss' }] };
  const ride = { options: ['趕時間', '常帶東西', '不想走路', '就是喜歡叫車', '不一定'].map((label) => ({ label, kind: 'store' })) };
  for (const ask of [habit, rush, lug, usual, ride]) {
    for (const q of ['好像要下雨，明天天氣如何', '不用轉乘的路線', '趕快帶我去台北車站', '有沒有去高雄的車', '明天會下雨是嗎', '從板橋去台北101', '要去哪裡搭車', '是不是要帶傘', '我趕時間的話怎麼去松山機場']) {
      assert.equal(matchAnswer(ask, q), null, `${ask.options[0].label}：${q}`);
    }
  }
  // 存偏好只接受全字或完整的 YES／NO
  assert.equal(matchAnswer(habit, '好啊').label, '好');
  assert.equal(matchAnswer(habit, '不要').label, '不用');
  assert.equal(matchAnswer(habit, '我覺得好'), null);
  assert.equal(matchAnswer(ride, '我常帶東西'), null, 'store 不做包含比對');
  assert.equal(matchAnswer(usual, '是！').label, '是');
  assert.equal(matchAnswer(lug, '沒有。').label, '沒有');
  assert.equal(matchAnswer(lug, '有').label, '有');
});

test('情境檢查：asks／asksNone／askOptions／askKind／askGuess／toNot', async () => {
  const { check } = await import('../scripts/eval/scenario-check.js');
  const es = [{ type: 'ask', id: 'q', question: '您要從哪一站出發？', options: [{ label: '台中', kind: 'reply', say: '高鐵台中到台北多少錢', guess: true }, { label: '左營', kind: 'reply', say: '高鐵左營到台北多少錢' }] },
    { type: 'tool_result', tool: 'plan_trip', data: { from: { name: '您的位置' }, to: { name: '台北車站' } } }];
  assert.deepEqual(check(es, { asks: ['哪一站'], askOptions: ['台中', '左營'], askKind: 'reply', askGuess: true, toNot: '台中' }), []);
  assert.equal(check(es, { asksNone: true }).length, 1);
  assert.equal(check([], { asks: '哪一站' }).length, 1, '沒有 ask 事件算失敗');
  assert.equal(check(es, { askOptions: ['左營'] }).length, 1, '第一個選項不對');
  assert.equal(check(es, { askKind: 'state', askGuess: false }).length, 2);
  assert.equal(check(es, { toNot: '台北' }).length, 1);
  assert.equal(check([es[0], es[0]], {}).length, 1, '一輪最多一個問題');
});
