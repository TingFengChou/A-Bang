// 動態「下一句」建議（UX.md §3.2、AGENT.md §5.4）：情境不含座標、驗證丟掉查不到與重複的、規則補足貼情境、排序。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../core/agent/demo-intent.js';
import { checkAsks, checkRequest } from '../core/agent/suggest-check.js';
import { answerable, sameAsk, slimAsk, shownAsks } from '../core/suggest.js';
import { suggestContext, contextText, ruleAsks, rankAsks, pickSuggestions, validateAsks, homeAsks, timeOf, resultFacts, orderSuggest } from '../public/js/agent/suggest.js';
import { normalizeSuggest, edgeSuggest, edgeJudge, cancelSuggest, edgeTrips, EDGE_BUSY_GRACE_MS, _resetEdge } from '../public/js/edge-judge.js';
import { readFile } from 'node:fs/promises';
import { nextSteps } from '../public/js/agent/next-steps.js';

const at = (hhmm, day = '2026-11-18') => new Date(`${day}T${hhmm}:00+08:00`).getTime(); // 2026-11-18 是週三
const COORD = /\d{2,3}\.\d{3,}/;
const trip = (o = {}) => ({ tool: 'plan_trip', card: 'trip', data: { from: { name: '西門町', lat: 25.0421, lon: 121.5079 }, to: { name: '台北101', lat: 25.0339, lon: 121.5645 }, best: 'metro', states: [], options: [{ id: 'metro', role: 'metro', name: '捷運（板南線）' }, { id: 'bus-601', role: 'bus', name: '公車 601' }], weather: { raining: false, pop3h: 10, tempC: 22 }, air: { aqi: 58 }, ...o } });
const weather = (raining) => ({ tool: 'weather_now', card: 'weather', data: { station: '信義', tempC: 18, raining, pop3h: raining ? 90 : 10, lat: 25.03, lon: 121.56 } });
const turn = (q, results, extra = {}) => ({ q, results, decision: null, lang: null, ...extra });

test('情境：只在手機上組，不含座標；常用地點只放標籤；最近兩輪的問題與結果摘要', () => {
  const ctx = suggestContext({
    turns: [turn('25.0478,121.517 附近天氣', [weather(false)]), turn('從西門町到台北101怎麼去？', [trip(), weather(true), { tool: 'aqi_nearby', data: { nearest: { aqi: 58, site: '萬華', lat: 25.04, lon: 121.5 } } }])],
    page: { kind: 'weather', context: '使用者正在看「天氣」頁' }, now: at('18:20'), saved: ['家', '公司', '別人家'],
  });
  const text = contextText(ctx);
  assert.doesNotMatch(JSON.stringify(ctx), COORD, '情境物件沒有座標');
  assert.doesNotMatch(text, COORD, '給模型的文字沒有座標');
  assert.deepEqual(ctx.saved, ['家', '公司'], '只有標籤，不認得的不放');
  assert.match(text, /平日傍晚 18 點/);
  assert.match(text, /使用者正在看：「天氣」頁/);
  assert.match(text, /剛剛問：從西門町到台北101怎麼去？\n查到：行程 西門町→台北101，建議捷運（板南線）；天氣 正在下雨 18°C、降雨機率 90%；AQI 58/);
  assert.equal(ctx.weather.raining, true, '下雨用這一輪的天氣');
  assert.equal(ctx.trip.bestRole, 'metro');
  assert.match(text, /常用地點：家、公司/);
  assert.doesNotMatch(text, /別人家/);
});

test('時段：早上、白天、傍晚、深夜；週末是假日', () => {
  assert.equal(timeOf(at('07:30')).part, 'morning');
  assert.equal(timeOf(at('14:00')).part, 'day');
  assert.equal(timeOf(at('19:00')).part, 'evening');
  assert.equal(timeOf(at('23:40')).part, 'late');
  assert.equal(timeOf(at('03:00')).part, 'late');
  assert.equal(timeOf(at('10:00', '2026-11-21')).weekend, true);
});

test('驗證端點：查得到才 ok；unknown、缺欄位、後天、投資建議都丟掉；常用地點回 needSaved', () => {
  const r = checkAsks(['捷運現在多久一班？', '晚上回程怎麼走？', '這班還有幾站到？', '後天會下雨嗎？', '該買台積電嗎？', '從台北101回家怎麼走？', '台北101附近還有 YouBike 嗎？', '這週油價漲還跌？']);
  assert.deepEqual(r.map((x) => x.ok), [true, false, false, false, false, false, true, false], '油價漲跌：只有這週牌價，答不了');
  assert.deepEqual(r[0].ask, { intent: 'metro' });
  assert.equal(r[5].needSaved, '家');
  assert.deepEqual(r[5].ask, { intent: 'trip', to: '家', from: '台北101', states: [] });
  assert.deepEqual(r[6].ask, { intent: 'youbike', places: ['台北101'] });
  assert.ok(r.every((x) => !x.ask || !COORD.test(JSON.stringify(x.ask))), '回傳沒有座標');
  assert.throws(() => checkAsks('不是陣列'), /陣列/);
  assert.throws(() => checkAsks(Array(9).fill('天氣')), /陣列/);
  assert.equal(checkAsks(['x'.repeat(61)])[0].ok, false, '太長不解析');
  assert.equal(checkAsks([42])[0].ok, false);
});

test('手機上的 AI 給 5 句：丟掉查不到的與畫面上已回答的，剩 3 句；不足 3 句用規則補', async () => {
  const ctx = suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip()])], now: at('14:00') });
  const five = ['捷運現在多久一班？', '台北101附近有藥局嗎？', '從台北101到西門町怎麼去？', '從西門町到台北101怎麼去？', '晚上回程怎麼走？'];
  let sent = null;
  const check = async (asks) => { sent = asks; return checkAsks(asks); };
  const valid = await validateAsks(normalizeSuggest(five.map((x, i) => `${i + 1}. ${x}`).join('\n')), { check });
  assert.deepEqual(sent, five, '只送句子（去掉編號），不送情境');
  assert.equal(valid.length, 4, '查不到的（晚上回程）先丟掉');
  const { asks, actions } = pickSuggestions({ edge: valid, rules: ruleAsks(ctx), ctx });
  assert.deepEqual(actions, []);
  assert.equal(asks.length, 3);
  assert.ok(asks.every((a) => a.src === 'edge'), '3 句以上就用手機上的 AI 的');
  assert.ok(!asks.some((a) => a.q === '從西門町到台北101怎麼去？'), '跟畫面上的行程重複的丟掉');
  // 驗證後只剩 1 句：規則補在後面
  const one = await validateAsks(['晚上回程怎麼走？', '捷運現在多久一班？'], { check });
  const mixed = pickSuggestions({ edge: one, rules: ruleAsks(ctx), ctx });
  assert.equal(mixed.asks[0].src, 'edge');
  assert.ok(mixed.asks.length >= 3 && mixed.asks.slice(1).every((a) => a.src === 'rule'), mixed.asks.map((a) => a.label).join('|'));
  assert.ok(!mixed.asks.slice(1).some((a) => a.ask?.intent === 'metro'), '規則跟手機的那句重複的也丟掉');
  // 常用地點：手機有設定才算
  assert.equal((await validateAsks(['回家怎麼走？'], { check, saved: [] })).length, 0);
  assert.equal((await validateAsks(['回家怎麼走？'], { check, saved: ['家'] })).length, 1);
  // 驗證失敗（離線）：一句都不用（交給規則）
  assert.deepEqual(await validateAsks(['捷運現在多久一班？'], { check: async () => { throw new Error('offline'); } }), []);
});

test('規則補足貼情境：查完行程後跟首次進入不同；下雨、深夜、公車頁、早上有公司、英文', () => {
  const first = ruleAsks(suggestContext({ now: at('14:00') })).map((a) => a.label);
  const after = rankAsks(ruleAsks(suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip()])], now: at('14:00') })), suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip()])], now: at('14:00') })).map((a) => a.label);
  assert.notDeepEqual(after.slice(0, 3), first.slice(0, 3));
  assert.ok(after.slice(0, 4).includes('捷運現在多久一班？'), `建議坐捷運：捷運下一班排前面 ${after}`);
  // 下雨：少淋雨的走法排第一
  const wetCtx = suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip({ weather: { raining: true, pop3h: 90 } })])], now: at('14:00') });
  const wet = rankAsks(ruleAsks(wetCtx), wetCtx);
  assert.equal(wet[0].label, '下雨，少淋雨的走法');
  assert.equal(wet[0].q, '下雨了，從西門町到台北101少走路怎麼去？');
  // 深夜
  const late = ruleAsks(suggestContext({ now: at('23:30') })).map((a) => a.q);
  assert.ok(late.includes('捷運幾點收班？') && late.includes('附近的藥局有開嗎？'), late.join('|'));
  // 公車頁（浮動阿幫從公車頁打開）
  const bus = ruleAsks(suggestContext({ page: { kind: 'bus', route: '307', stop: '捷運西門站', context: '使用者正在看公車 307' }, now: at('14:00') }));
  assert.ok(bus.some((a) => a.q === '附近還有哪些公車？'));
  // 早上、有設定公司、平日
  assert.equal(ruleAsks(suggestContext({ now: at('08:00'), saved: ['公司'] })).find((a) => a.domain === 'transit').q, '去公司怎麼走最快？');
  assert.notEqual(ruleAsks(suggestContext({ now: at('08:00', '2026-11-21'), saved: ['公司'] })).find((a) => a.domain === 'transit').q, '去公司怎麼走最快？', '週末不建議去公司');
  // 英文那一輪：全部英文
  const en = ruleAsks(suggestContext({ turns: [turn('How do I get to Taipei 101?', [trip()], { lang: 'en' })], now: at('14:00') }));
  assert.ok(en.length && en.every((a) => !/[一-鿿]/.test(a.label)));
});

test('每一句規則都是阿幫查得到的（parseIntent），規則帶的意圖與解析結果一致', () => {
  const ctxs = [];
  for (const hhmm of ['03:00', '07:30', '11:00', '14:00', '18:30', '23:30']) {
    for (const day of ['2026-11-18', '2026-11-22', '2026-11-23']) {
      for (const saved of [[], ['家', '公司']]) {
        ctxs.push(suggestContext({ now: at(hhmm, day), saved }));
        ctxs.push(suggestContext({ now: at(hhmm, day), saved, turns: [turn('從西門町到台北101怎麼去？', [trip(), weather(true)])] }));
        ctxs.push(suggestContext({ now: at(hhmm, day), saved, turns: [turn('去台北101', [trip({ from: { name: '你的位置' }, best: 'bus-601' })])] }));
        ctxs.push(suggestContext({ now: at(hhmm, day), saved, watching: { routeName: '307', stop: '捷運西門站' }, page: { kind: 'bus', route: '307', stop: '捷運西門站' } }));
        for (const kind of ['weather', 'aqi', 'metro', 'rail', 'nearby']) ctxs.push(suggestContext({ now: at(hhmm, day), saved, page: { kind } }));
        ctxs.push(suggestContext({ now: at(hhmm, day), turns: [turn('How do I get to Taipei 101?', [trip()], { lang: 'en' })] }));
      }
    }
  }
  const seen = new Set();
  for (const ctx of ctxs) {
    for (const a of ruleAsks(ctx)) {
      if (seen.has(a.q)) continue;
      seen.add(a.q);
      const it = parseIntent(a.q, {});
      if (it.intent === 'savedMissing') { assert.ok(ctx.saved.includes(it.missing), `${a.q}：要有設定${it.missing}才建議`); continue; }
      assert.ok(answerable(it), `${a.q} → ${it.intent}`);
      const slim = slimAsk(it);
      assert.ok(sameAsk(a.ask, slim) && sameAsk(slim, a.ask), `${a.q}：規則 ${JSON.stringify(a.ask)} ≠ 解析 ${JSON.stringify(slim)}`);
    }
  }
  assert.ok(seen.size >= 20, `規則句數 ${seen.size}`);
  // 「接下來可以」的問句（next-steps.js）帶的意圖也與解析一致
  for (const s of nextSteps([trip(), weather(false)], null).concat(nextSteps([weather(false)], null), nextSteps([{ tool: 'aqi_nearby', data: {} }], null))) {
    if (s.kind !== 'ask' || !s.ask) continue;
    const slim = slimAsk(parseIntent(s.payload, {}));
    assert.ok(sameAsk(s.ask, slim), `${s.payload}：${JSON.stringify(s.ask)} ≠ ${JSON.stringify(slim)}`);
  }
});

test('排序：跟情境直接相關、有即時資料的在前；畫面上已回答的、剛問過的丟掉', () => {
  const ctx = suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip(), weather(false)])], now: at('14:00') });
  const cands = [
    { label: '這期發票中了嗎？', q: '這期發票中了嗎？', ask: { intent: 'invoice' } },
    { label: '台北101附近有藥局嗎？', q: '台北101附近有藥局嗎？', ask: { intent: 'pharmacy', places: ['台北101'] } },
    { label: '捷運現在多久一班？', q: '捷運現在多久一班？', ask: { intent: 'metro' } },
    { label: '附近天氣如何？', q: '附近天氣如何？', ask: { intent: 'weather' } },
    { label: '從西門町到台北101怎麼去？', q: '從西門町到台北101怎麼去？', ask: { intent: 'trip', from: '西門町', to: '台北101' } },
  ];
  const r = rankAsks(cands, ctx).map((c) => c.label);
  assert.equal(r.at(-1), '這期發票中了嗎？', '沒有即時資料、跟情境無關的最後');
  assert.ok(r.indexOf('台北101附近有藥局嗎？') < r.indexOf('這期發票中了嗎？'));
  const { asks } = pickSuggestions({ edge: cands, ctx, max: 6 });
  assert.ok(!asks.some((a) => a.label === '附近天氣如何？'), '天氣卡片已經在畫面上');
  assert.ok(!asks.some((a) => a.label === '從西門町到台北101怎麼去？'), '剛問過、行程已在畫面上');
  // 動作（到站提醒、開公車頁、決策圖加狀態）最多 2 個在前面
  const acts = [{ label: '我很趕', kind: 'state' }, { label: '想省錢', kind: 'state' }, { label: '到站前 3 分提醒我', kind: 'remind' }];
  assert.deepEqual(pickSuggestions({ actions: acts, rules: ruleAsks(ctx), ctx }).actions.map((a) => a.label), ['到站前 3 分提醒我', '我很趕']);
});

test('畫面上已回答的：行程、天氣、公車、股票', () => {
  const shown = shownAsks([trip(), { tool: 'bus_route_eta', data: { routeName: '307' } }, { tool: 'stock_quote', data: { quotes: [{ name: '台積電', code: '2330' }] } }], { states: [{ key: 'rain', on: true }] });
  const dup = (it) => shown.some((s) => sameAsk(it, s));
  assert.ok(dup({ intent: 'trip', from: '西門町', to: '臺北101' }), '臺／台相同');
  assert.ok(!dup({ intent: 'trip', from: '台北101', to: '西門町' }), '回程不是重複');
  assert.ok(!dup({ intent: 'trip', from: '西門町', to: '台北101', states: ['lessWalk', 'rain'] }), '多了少走路：新的問題');
  assert.ok(dup({ intent: 'weather', places: ['台北101'] }), '行程卡已有天氣');
  assert.ok(!dup({ intent: 'weather', tomorrow: true }), '明天的天氣不是');
  assert.ok(dup({ intent: 'bus_route', route: '307' }) && !dup({ intent: 'bus_route', route: '601' }));
  assert.ok(dup({ intent: 'stock', query: '2330' }) && !dup({ intent: 'stock', query: '聯發科' }));
  assert.match(resultFacts([trip()]), /^行程 西門町→台北101，建議捷運/);
});

test('首頁範例：交通、生活、消費各一句，依時段與天氣變（早上 vs 深夜、下雨）', () => {
  const morning = homeAsks(suggestContext({ now: at('07:30') }));
  const late = homeAsks(suggestContext({ now: at('23:30') }));
  assert.deepEqual(morning.map((x) => x.domain), ['transit', 'life', 'money']);
  assert.deepEqual(late.map((x) => x.domain), ['transit', 'life', 'money']);
  assert.notDeepEqual(morning.map((x) => x.q), late.map((x) => x.q));
  assert.equal(late[0].q, '捷運幾點收班？');
  const wet = homeAsks(suggestContext({ now: at('19:00'), nowData: { weather: { raining: true, pop3h: 90 } } }));
  assert.equal(wet[1].q, '明天還會下雨嗎？');
  for (const x of [...morning, ...late, ...wet]) assert.ok(answerable(parseIntent(x.q, {})), x.q);
});

test('手機模型回傳整理：編號、引號、重複、太長、JSON 都處理', () => {
  assert.deepEqual(normalizeSuggest('1. 捷運現在多久一班？\n2、「台北101附近有藥局嗎？」\n- 捷運現在多久一班？\n{"x":1}\n短\n' + '很'.repeat(41)), ['捷運現在多久一班？', '台北101附近有藥局嗎？']);
  assert.deepEqual(normalizeSuggest(['明天會下雨嗎？', '  附近 YouBike 還有車嗎？ ']), ['明天會下雨嗎？', '附近 YouBike 還有車嗎？']);
  assert.deepEqual(normalizeSuggest({ questions: ['明天會下雨嗎？'] }), ['明天會下雨嗎？']);
  assert.deepEqual(normalizeSuggest(null), []);
});

test('排列：公車／捷運頁或剛查過公車到站時提醒類動作排第一；其他情境猜的問句在前', () => {
  const remind = { label: '到站前 3 分提醒我', kind: 'remind' }, alight = { label: '上車後提醒我下車', kind: 'navigate' }, state = { label: '我很趕', kind: 'state' };
  const asks = [{ label: '附近還有哪些公車？' }, { label: '捷運幾點收班？' }];
  const labels = (ctx) => orderSuggest({ actions: [state, remind, alight], asks }, ctx).map((x) => x.label);
  const busTurn = suggestContext({ turns: [turn('307 到哪了', [{ tool: 'bus_route_eta', data: { routeName: '307', focus: { stopName: '捷運西門站', etaSec: 300, status: 0 } } }])], now: at('14:00') });
  assert.deepEqual(labels(busTurn), ['到站前 3 分提醒我', '上車後提醒我下車', '附近還有哪些公車？', '捷運幾點收班？', '我很趕']);
  for (const kind of ['bus', 'metro']) assert.equal(labels(suggestContext({ page: { kind }, now: at('14:00') }))[0], '到站前 3 分提醒我', kind);
  const tripTurn = suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip()])], now: at('14:00') });
  assert.deepEqual(labels(tripTurn), ['附近還有哪些公車？', '捷運幾點收班？', '到站前 3 分提醒我', '上車後提醒我下車', '我很趕']);
  assert.equal(labels(suggestContext({ page: { kind: 'weather' }, now: at('14:00') }))[0], '附近還有哪些公車？');
  // pickSuggestions 一起給排好的順序
  assert.equal(pickSuggestions({ actions: [remind], rules: ruleAsks(busTurn), ctx: busTurn }).items[0].label, '到站前 3 分提醒我');
});

test('驗證端點的 log 只記數量，不記句子', () => {
  const logs = [];
  const data = checkRequest({ asks: ['從我家巷口到台北101怎麼去？', '晚上回程怎麼走？'] }, { log: (m, o) => logs.push([m, o]) });
  assert.equal(data.length, 2);
  assert.deepEqual(logs, [['suggest check', { count: 2, ok: data.filter((x) => x.ok).length, needSaved: 0 }]]);
  assert.doesNotMatch(JSON.stringify(logs), /台北101|回程|巷口/);
});

test('judge 優先：建議產生中送出問題 → 先請手機取消 suggest，judge 不排在後面，猜的結果丟掉', async () => {
  const calls = [];
  let release;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === 'suggest') return new Promise((res, rej) => { release = rej; setTimeout(() => res({ engine: 'gemini-nano', result: '捷運現在多久一班？' }), 5000); });
      if (method === 'cancelSuggest') { release?.(new Error('cancelled')); return Promise.resolve({ cancelled: true }); }
      if (method === 'judge') return Promise.resolve({ engine: 'gemini-nano', ms: 30, result: '{"intent":"trip","states":[]}' });
      return Promise.resolve({});
    },
  };
  try {
    const pending = edgeSuggest('現在：平日白天 14 點', { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 10));
    const t0 = Date.now();
    const j = await edgeJudge('從西門町到台北101怎麼去');
    assert.deepEqual(j, { intent: 'trip', states: [], engine: 'gemini-nano' });
    assert.ok(Date.now() - t0 < 500, 'judge 沒有等 suggest');
    assert.deepEqual(calls, ['suggest', 'cancelSuggest', 'judge'], '取消先送到原生端');
    assert.equal(await pending, null, '被取消的建議不用');
    assert.equal(cancelSuggest(), false, '沒有在跑的就不送');
    // 取消後可以再猜（不會因為上一次被擋）
    globalThis.Capacitor.nativePromise = (plugin, method) => (method === 'suggest' ? Promise.resolve({ engine: 'gemini-nano', result: '1. 明天會下雨嗎？' }) : Promise.resolve({}));
    assert.deepEqual(await edgeSuggest('現在：平日白天 14 點'), { asks: ['明天會下雨嗎？'], engine: 'gemini-nano' });
  } finally {
    delete globalThis.Capacitor;
    _resetEdge();
  }
});

test('取消建議後 3 秒內的忙碌類錯誤：不跳斷路器（這一題交給伺服器），之後照常在手機上判斷；原生端同樣不暫停', async () => {
  assert.equal(EDGE_BUSY_GRACE_MS, 3000);
  for (const m of ['busy', 'cancelled', 'unavailable: busy', 'rateLimited', 'concurrentRequests']) assert.equal(edgeTrips(m, 500), false, m);
  assert.equal(edgeTrips('unavailable: busy', 3500), true, '過了 3 秒仍說不可用：照舊跳斷路器');
  assert.equal(edgeTrips('unavailable', 500), true, '真的不可用（不是忙碌）：照舊');
  assert.equal(edgeTrips('judge failed', 500), false);
  // 流程：建議產生中送出 → 原生端回 busy → 這題 null（伺服器判斷）；下一題照常呼叫手機
  const calls = [];
  let judgeN = 0;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === 'suggest') return new Promise(() => {});
      if (method === 'judge') return ++judgeN === 1 ? Promise.reject(new Error('unavailable: busy')) : Promise.resolve({ engine: 'gemini-nano', result: '{"intent":"weather","states":[]}' });
      return Promise.resolve({});
    },
  };
  try {
    edgeSuggest('現在：平日白天 14 點', { timeout: 50 });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await edgeJudge('從西門町到台北101怎麼去'), null, '這一題交給伺服器');
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await edgeJudge('明天會下雨嗎'), { intent: 'weather', states: [], engine: 'gemini-nano' }, '沒有因為讓位就停用手機上的 AI');
    assert.deepEqual(calls, ['suggest', 'cancelSuggest', 'judge', 'judge']);
  } finally {
    delete globalThis.Capacitor;
    _resetEdge();
  }
  // 原生端：BUSY／CANCELLED 在 3 秒內不暫停 10 分鐘、回 busy；iOS 同樣
  const java = String(await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url)));
  assert.match(java, /BUSY_GRACE_MS = 3000/);
  assert.match(java, /code == GenAiException\.ErrorCode\.BUSY \|\| code == GenAiException\.ErrorCode\.CANCELLED/);
  assert.match(java, /if \(busyAfterCancel\(g\.getErrorCode\(\), since\)\) return BUSY_CODE[^\n]*\n\s*pausedUntil =/, '忙碌先回、不設 pausedUntil');
  assert.match(java, /call\.reject\(code\.startsWith\(BUSY_CODE\) \? "busy" : "judge failed"\)/);
  const swift = String(await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url)));
  assert.match(swift, /static let busyGrace: TimeInterval = 3/);
  assert.match(swift, /call\.reject\(self\.busyAfterCancel\(error\) \? "busy" : "judge failed"\)/);
});

test('外掛三個任務共用斷路器與優先順序：judge ＞ write ＞ suggest（寫之前先取消猜，寫的時候不猜；寫說不可用就都不再用）', async () => {
  const { edgeWrite, _resetEdgeWrite } = await import('../public/js/edge-write.js');
  const { edgeTripped } = await import('../public/js/edge-judge.js');
  const draft = { type: 'answer_draft', lang: 'zh', facts: {}, text: '選「公車 601」：省 270 元、不用等車。 601 約 7 分後到「民生捷運站(1號出口)」，走過去約 3 分。這可能是末班，早點出門；趕不上就叫車或騎 YouBike。' };
  const calls = [];
  let finishWrite;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === 'suggest') return new Promise(() => {});
      if (method === 'write') return new Promise((res, rej) => { finishWrite = rej; });
      return Promise.resolve({});
    },
  };
  try {
    edgeSuggest('現在：平日白天 14 點', { timeout: 50 });
    await new Promise((r) => setTimeout(r, 5));
    const writing = edgeWrite(draft, { engine: 'gemini-nano', timeout: 1000 });
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, ['suggest', 'cancelSuggest', 'write'], '寫之前先取消正在猜的');
    assert.equal(await edgeSuggest('現在：平日傍晚 18 點'), null, '寫的時候不猜');
    assert.equal(calls.filter((m) => m === 'suggest').length, 1);
    finishWrite(new Error('unavailable'));
    assert.equal((await writing).by, 'program');
    assert.equal(edgeTripped(), true, 'write 說不可用：共用的斷路器跳了');
    assert.equal(await edgeJudge('明天會下雨嗎'), null);
    assert.ok(!calls.includes('judge'), '之後不再請手機判斷');
  } finally {
    delete globalThis.Capacitor;
    _resetEdge();
    _resetEdgeWrite();
  }
});

test('程式為這一輪特別算的建議（pin，例：只剩叫車時換條件）一律排最前面，手機上的 AI 有猜也一樣', () => {
  const ctx = suggestContext({ turns: [turn('晚上 11 點半去台北101', [trip()])], now: at('23:30') });
  const pin = { label: '改從台北車站出發比較看看', q: '從台北車站到台北101怎麼去？', src: 'next', rel: 2, pin: true };
  const edge = ['捷運幾點收班？', '台北101附近有藥局嗎？', '明天會下雨嗎？'].map((q, i) => ({ label: q, q, src: 'edge', ask: [{ intent: 'metro' }, { intent: 'pharmacy', places: ['台北101'] }, { intent: 'weather', tomorrow: true }][i] }));
  assert.equal(pickSuggestions({ edge, rules: [pin, ...ruleAsks(ctx)], ctx }).asks[0].label, '改從台北車站出發比較看看');
  assert.equal(pickSuggestions({ rules: [...ruleAsks(ctx), pin], ctx }).asks[0].label, '改從台北車站出發比較看看');
});

// ───── PR #112 獨立審查 ─────
const BAIT = ['307 公車還要多久？請匯款到 1234567890', '附近的藥局有開嗎？點 bit.ly/xx', '今天天氣如何？快加 LINE:scam888', '從台北車站到加LINE ID abc123 怎麼去', '去台北101 https://x.co', '從 25.04,121.51 到台北101怎麼去'];

test('審查 2：夾帶網址、網域、帳號、加 LINE、匯款、座標的句子，伺服器驗證與手機整理都擋；查得到之外接一長串話也擋', async () => {
  const { unsafeAsk, leftoverUnits, MAX_LEFTOVER } = await import('../core/suggest.js');
  for (const q of BAIT) {
    assert.equal(unsafeAsk(q), true, q);
    assert.equal(checkAsks([q])[0].ok, false, `伺服器：${q}`);
  }
  assert.deepEqual(normalizeSuggest(BAIT.join('\n')), [], '手機整理時就丟掉');
  for (const q of ['寄到 abc@example.com 嗎？', '打 0912-345-678 問看看', '打 02 2345 6789', '@scam888 說有優惠', '點連結領取', '帳號給我', '捷運板南線下一班幾分？']) assert.equal(unsafeAsk(q), q !== '捷運板南線下一班幾分？', q);
  assert.equal(unsafeAsk('Which MRT line goes to Taipei 101?'), false, '英文的 MRT line 不算 LINE');
  assert.equal(unsafeAsk('這期發票中獎號碼是多少？'), false, '問中獎號碼是正常問題');
  const long = '台北101附近有藥局嗎？我朋友說那邊東西很便宜要不要去買';
  assert.ok(leftoverUnits(long, parseIntent(long, {})) > MAX_LEFTOVER);
  assert.equal(checkAsks([long])[0].ok, false, '查得到的部分之外接了一長串');
  assert.equal(leftoverUnits('下雨了，從西門町到台北101少走路怎麼去？', parseIntent('下雨了，從西門町到台北101少走路怎麼去？', {})), 11);
  // 所有規則句都過得了驗證（不會被誤擋）
  const qs = new Set();
  for (const hhmm of ['03:00', '07:30', '14:00', '18:30', '23:30']) for (const saved of [[], ['家', '公司']]) {
    for (const turns of [[], [turn('從西門町到台北101怎麼去？', [trip({ weather: { raining: true, pop3h: 90 } })])], [turn('去台北101', [trip({ from: { name: '你的位置' }, best: 'bus-601' })])]]) {
      for (const a of ruleAsks(suggestContext({ now: at(hhmm), saved, turns, watching: { routeName: '307', stop: '捷運西門站' } }))) qs.add(a.q);
    }
  }
  for (const q of qs) { const r = checkAsks([q])[0]; assert.ok(r.ok || r.needSaved, `規則句被擋：${q}`); }
});

test('審查 4：座標樣式（小數 2 位以上成對）不進情境', async () => {
  const { scrub } = await import('../public/js/agent/suggest.js');
  assert.equal(scrub('從 25.04,121.51 到台北101怎麼去'), '從 … 到台北101怎麼去');
  assert.equal(scrub('25.0478 121.517 附近'), '… 附近');
  const ctx = suggestContext({ turns: [turn('從 25.04,121.51 到台北101怎麼去', [trip()])], now: at('14:00') });
  assert.doesNotMatch(JSON.stringify(ctx) + contextText(ctx), /25\.04|121\.51/);
});

test('審查 1：正在判斷（judge）時不猜；suggest 回不可用只停 suggest，judge 照常（不跳共用斷路器）', async () => {
  const calls = [];
  let judgeDone;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === 'judge') return new Promise((res) => { judgeDone = () => res({ engine: 'gemini-nano', result: '{"intent":"weather","states":[]}' }); });
      if (method === 'suggest') return Promise.reject(new Error('unavailable'));
      return Promise.resolve({});
    },
  };
  try {
    const j = edgeJudge('明天會下雨嗎');
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await edgeSuggest('現在：平日白天 14 點'), null);
    assert.ok(!calls.includes('suggest'), 'judge 跑的時候不猜');
    judgeDone();
    await j;
    assert.equal(await edgeSuggest('現在：平日白天 14 點'), null, 'suggest 不可用');
    assert.equal(await edgeSuggest('現在：平日白天 15 點'), null, '之後不再猜');
    assert.equal(calls.filter((m) => m === 'suggest').length, 1);
    const { edgeTripped } = await import('../public/js/edge-judge.js');
    assert.equal(edgeTripped(), false, '只停 suggest，不停 judge／write');
    globalThis.Capacitor.nativePromise = (plugin, method) => { calls.push(method); return Promise.resolve(method === 'judge' ? { engine: 'gemini-nano', result: '{"intent":"aqi","states":[]}' } : {}); };
    assert.deepEqual(await edgeJudge('空氣好嗎'), { intent: 'aqi', states: [], engine: 'gemini-nano' });
  } finally {
    delete globalThis.Capacitor;
    _resetEdge();
  }
});

test('審查 1、9：原生端 suggest 的錯誤不設暫停、取消記號在呼叫模型前檢查、自己逾時記取消時間；iOS 結束時清掉同一個 task', async () => {
  const java = String(await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url)));
  const sug = java.slice(java.indexOf('public void suggest('), java.indexOf('static String suggestErrorCode'));
  assert.doesNotMatch(sug, /errorCode\(e\)|pausedUntil =/, 'suggest 不用會暫停的 errorCode');
  assert.match(sug, /suggestErrorCode\(e\)/);
  assert.ok(sug.indexOf('suggestToken.get() != my') < sug.indexOf('model().generateContent'), '呼叫模型前先看有沒有被取消');
  assert.match(sug, /TimeoutException te\) \{ f\.cancel\(true\); suggestCancelledAt = System\.currentTimeMillis\(\);/);
  const stop = java.slice(java.indexOf('private boolean stopSuggest()'), java.indexOf('public void suggest('));
  assert.match(stop, /suggestToken\.incrementAndGet\(\);[\s\S]*if \(had\) suggestCancelledAt/, '不論 future 設好沒有都記');
  const swift = String(await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url)));
  assert.match(swift, /guard self\.suggestValid\(token\) else \{ call\.reject\("cancelled"\)/);
  assert.match(swift, /defer \{ self\.suggestDone\(id\) \}/);
  assert.match(swift, /if suggestID == id \{ suggestTask = nil \}/);
  assert.match(swift, /guard let list else \{ self\.noteSuggestTimeout\(\)/);
});

test('審查 3：點建議算不算接著這一輪問（follow）；審查 6：送出後先拿掉同一句與綁上一輪的動作', async () => {
  const { isFollow, pruneAfterSend } = await import('../public/js/agent/suggest.js');
  const ctx = suggestContext({ turns: [turn('從西門町到台北101怎麼去？', [trip()])], now: at('14:00') });
  assert.equal(isFollow({ src: 'next' }, ctx), true);
  assert.equal(isFollow({ src: 'rule', pin: true }, ctx), true);
  assert.equal(isFollow({ src: 'rule', rel: 2 }, ctx), true, '從這一輪結果推的規則句');
  assert.equal(isFollow({ src: 'rule', rel: 0 }, ctx), false, '依時段的一般建議是新話題');
  assert.equal(isFollow({ src: 'edge', ask: { intent: 'youbike', places: ['台北101'] } }, ctx), true, '猜句提到這一輪的地名');
  assert.equal(isFollow({ src: 'edge', ask: { intent: 'invoice' } }, ctx), false);
  assert.equal(isFollow({ src: 'next' }, suggestContext({ now: at('14:00') })), false, '還沒問：沒有可以接的');
  assert.ok(pickSuggestions({ rules: ruleAsks(ctx), ctx }).asks.every((a) => typeof a.follow === 'boolean'));
  const btn = (kind, q, text) => ({ dataset: { kind, q }, textContent: text, removed: false, remove() { this.removed = true; } });
  const list = [btn('ask', '從台北101到西門町怎麼去？', '回程怎麼走？'), btn('ask', '捷運現在多久一班？', '捷運現在多久一班？'), btn('remind', '', '到站前 3 分提醒我'), btn('state', '', '我很趕'), btn('navigate', '', '上車後提醒我下車')];
  pruneAfterSend({ querySelectorAll: () => list }, '從臺北101到西門町怎麼去？');
  assert.deepEqual(list.map((b) => b.removed), [true, false, true, true, true]);
  // agent.js：動作記成操作過這一輪、問句帶 follow、確認句寫在那一輪、清除時一起重設
  const src = String(await readFile(new URL('../public/js/pages/agent.js', import.meta.url)));
  assert.match(src, /rounds\.touch\(view\?\.round\)/);
  assert.match(src, /send\(s\.q \|\| s\.payload, \{ follow: s\.follow \?\? s\.src !== 'rule' \}\)/);
  assert.match(src, /\(view\?\.round \|\| log\)\.append\(el\('p', 'agent-sys'/);
  assert.match(src, /rounds\.clear\(\); clearLinks\(\); turnsLog\.length = 0; lastView = null; edgeMemo = \{ text: '', asks: null \}/);
  assert.ok(src.indexOf('turnsLog.push(') < src.indexOf('rounds.end(round)'), '記下這一輪在 rounds.end 之前');
  assert.match(src, /if \(!busy\) refreshSuggest\(\)/, '審查 5：送出中換頁不換建議');
  assert.match(src, /const onWatch = \(\) => \{ if \(busy\) return;/);
});

test('審查 7：英文那一輪句子上限 60 字；英文公車頁打開的對話建議用英文', () => {
  const en = 'Is there a YouBike station near Taipei 101 with free bikes?';
  assert.ok(en.length > 40 && en.length <= 60);
  assert.deepEqual(normalizeSuggest([en], 6, { lang: 'en' }), [en]);
  assert.deepEqual(normalizeSuggest([en]), [], '中文那一輪仍是 40');
  const ctx = suggestContext({ page: { kind: 'bus', route: '307', stop: '捷運西門站', lang: 'en' }, now: at('14:00') });
  assert.equal(ctx.lang, 'en');
  assert.ok(ruleAsks(ctx).every((a) => !/[一-鿿]/.test(a.label)));
});

test('時段一律用台灣時間（與 core/util.js nowTW 一致，不受執行環境時區影響；CI 是 UTC）', async () => {
  const { twClock } = await import('../core/suggest.js');
  const { nowTW } = await import('../core/util.js');
  for (const iso of ['2026-11-18T07:30:00+08:00', '2026-11-18T23:59:00+08:00', '2026-11-22T00:10:00+08:00', '2026-11-21T16:30:00Z']) {
    const t = new Date(iso).getTime();
    const c = twClock(t), n = nowTW(t);
    assert.equal(`${String(c.hour).padStart(2, '0')}:${String(c.min).padStart(2, '0')}`, n.hhmm, iso);
    assert.equal(c.dow, n.weekday, iso);
  }
  // UTC 週六 16:30＝台灣週日 00:30：深夜、假日
  assert.deepEqual(timeOf(new Date('2026-11-21T16:30:00Z').getTime()), { part: 'late', weekend: true, hour: 0, min: 30, dow: 0, label: '假日深夜 0 點' });
});
