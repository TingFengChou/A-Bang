// 動態「下一句」建議（產品回饋 2026-11-21：輸入提示都一樣 → 依情境猜使用者接下來想問什麼；UX.md §3.2、AGENT.md §5.4）。
// 1. 情境（suggestContext）：只在手機上組、不送伺服器、不含座標與個資——頁面、最近一兩輪的問題與結果摘要、時段、
//    常用地點的「標籤」、進行中的提醒、手機上的 AI。
// 2. 產生：手機上的 AI（edge-judge.js edgeSuggest）猜 3～4 句 → 伺服器 /api/v1/suggest/check 只驗證「句子」（parseIntent，不呼叫模型）
//    → 丟掉查不到的、跟畫面上已回答的重複的；網頁版、AI 不可用、逾時或驗證後不足 3 句 → 情境規則（ruleAsks）補。
// 3. 排序（rankAsks）：程式計分——跟目前情境直接相關、有即時資料（App 取得到的）排前面；模型只負責提出候選句。
import { sameAsk, shownAsks, normAsk, LIVE_INTENTS } from '../../../core/suggest.js';

/** 手機上的 AI 產生的句子：最多等這麼久（逾時改用規則，畫面先保留舊的建議） */
export const SUGGEST_WAIT_MS = 1500;

// ───── 情境 ─────
const PARTS = { morning: '早上', day: '白天', evening: '傍晚', late: '深夜' };
/** 時段：早上 5–10、白天 10–17、傍晚 17–22、深夜 22–5；週六日是假日 */
export function timeOf(now = Date.now()) {
  const d = new Date(now);
  const h = d.getHours();
  const part = h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'late';
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return { part, weekend, hour: h, min: d.getMinutes(), dow: d.getDay(), label: `${weekend ? '假日' : '平日'}${PARTS[part]} ${h} 點` };
}

/** 去掉像座標的數字（使用者把座標打進問題裡也不放進情境） */
const scrub = (s, n = 40) => String(s || '').replace(/-?\d{1,3}\.\d{3,}/g, '…').replace(/\s+/g, ' ').trim().slice(0, n);
const here = (name) => (!name || /你的位置|現在位置|^現在|^目前/.test(name) ? '' : scrub(name, 20));
const routeOf = (name) => /^公車\s*([紅藍綠棕橘小幹]?\d{1,4}[區副]?)/.exec(String(name || ''))?.[1] || null;

/** 一輪的結果 → 一句摘要（只取名稱與數字，不取座標） */
export function resultFacts(results = [], decision = null) {
  const out = [];
  const by = (t) => results.filter((r) => r.tool === t).at(-1)?.data;
  const trip = by('plan_trip');
  if (trip) {
    const best = (decision?.options || trip.options || []).find((o) => o.id === (decision?.best || trip.best));
    out.push(`行程 ${here(trip.from?.name) || '你的位置'}→${here(trip.to?.name)}${best?.name ? `，建議${scrub(best.name, 16)}` : ''}`);
  }
  const bus = by('bus_route_eta');
  if (bus) out.push(`公車 ${scrub(bus.routeName, 8)}${bus.focus?.stopName ? ` 在${scrub(bus.focus.stopName, 16)}${bus.focus.etaSec != null ? ` ${Math.round(bus.focus.etaSec / 60)} 分到` : ''}` : ''}`);
  const w = by('weather_now') || trip?.weather;
  if (w) out.push(`天氣 ${w.raining ? '正在下雨' : '沒下雨'}${w.tempC != null ? ` ${w.tempC}°C` : ''}${w.pop3h != null ? `、降雨機率 ${w.pop3h}%` : ''}`);
  const aqi = by('aqi_nearby')?.nearest?.aqi ?? trip?.air?.aqi;
  if (aqi != null) out.push(`AQI ${aqi}`);
  const named = { youbike_nearby: 'YouBike', bus_nearby_stations: '附近公車站', metro_live_board: '捷運到站', thsr_timetable: '高鐵時刻', tra_timetable: '台鐵時刻', weather_tomorrow: '明天天氣', outing_advice: '出門建議', earthquake_recent: '地震', pharmacy_search: '藥局', garbage_truck_nearby: '垃圾車', fuel_price: '油價', invoice_lottery: '發票', stock_quote: '股市收盤' };
  for (const r of results) if (named[r.tool] && !out.includes(named[r.tool])) out.push(named[r.tool]);
  return out.join('；').slice(0, 160);
}

/**
 * 組情境（只在手機上；不含座標、常用地點只放標籤）。
 * @param {{ turns?: Array<{ q: string, results?: any[], decision?: any, lang?: string|null }>, page?: object|null, now?: number,
 *   saved?: string[], watching?: { routeName: string, stop: string }|null, riding?: object|null, reminders?: number,
 *   nowData?: { weather?: object|null, aqi?: object|null }|null, edge?: string|null }} o
 */
export function suggestContext({ turns = [], page = null, now = Date.now(), saved = [], watching = null, riding = null, reminders = 0, nowData = null, edge = null } = {}) {
  const last = turns.at(-1) || null;
  const res = last?.results || [];
  const trip = res.filter((r) => r.tool === 'plan_trip').at(-1)?.data || null;
  const busData = res.filter((r) => r.tool === 'bus_route_eta').at(-1)?.data || null;
  const w = res.filter((r) => r.tool === 'weather_now').at(-1)?.data || trip?.weather || nowData?.weather || null;
  const aqi = res.filter((r) => r.tool === 'aqi_nearby').at(-1)?.data?.nearest?.aqi ?? trip?.air?.aqi ?? nowData?.aqi?.nearest?.aqi ?? null;
  const best = trip && (last.decision?.options || trip.options || []).find((o) => o.id === (last.decision?.best || trip.best));
  return {
    lang: last?.lang === 'en' ? 'en' : null,
    time: timeOf(now),
    page: page ? { kind: page.kind || null, label: scrub(String(page.context || '').replace(/^使用者正在看/, ''), 40), route: page.route ? scrub(page.route, 10) : null, stop: page.stop ? scrub(page.stop, 20) : null, href: page.href || null } : null,
    turns: turns.slice(-2).map((t) => ({ q: scrub(t.q, 60), facts: resultFacts(t.results, t.decision) })),
    trip: trip ? { from: here(trip.from?.name), to: here(trip.to?.name), best: best?.name ? scrub(best.name, 20) : null, bestRole: best?.role || null, route: routeOf(best?.name) } : null,
    bus: busData ? { route: scrub(busData.routeName, 10), stop: busData.focus?.stopName ? scrub(busData.focus.stopName, 20) : null } : null,
    weather: w ? { raining: !!w.raining, pop3h: Number.isFinite(w.pop3h) ? w.pop3h : null, tempC: Number.isFinite(w.tempC) ? w.tempC : null } : null,
    aqi: Number.isFinite(aqi) ? aqi : null,
    saved: saved.filter((k) => ['家', '公司', '學校'].includes(k)),
    watching: watching ? { route: scrub(watching.routeName, 10), stop: scrub(watching.stop, 20) } : null,
    riding: !!riding,
    reminders: Number(reminders) || 0,
    shown: last ? shownAsks(last.results || [], last.decision || null) : [],
    recent: turns.slice(-3).map((t) => normAsk(scrub(t.q, 60))),
    edge: edge || null,
  };
}

/** 給手機上的模型看的情境（繁中、精簡；英文那一輪另外要求用英文寫） */
export function contextText(ctx) {
  const L = [`現在：${ctx.time.label}`];
  if (ctx.page?.label) L.push(`使用者正在看：${ctx.page.label}`);
  for (const t of ctx.turns) L.push(`剛剛問：${t.q}${t.facts ? `\n查到：${t.facts}` : ''}`);
  if (!ctx.turns.length && ctx.weather) L.push(`外面：${ctx.weather.raining ? '正在下雨' : `降雨機率 ${ctx.weather.pop3h ?? '—'}%`}${ctx.aqi != null ? `、AQI ${ctx.aqi}` : ''}`);
  if (ctx.saved.length) L.push(`設定了常用地點：${ctx.saved.join('、')}（可以說「回家」「去公司」）`);
  if (ctx.watching) L.push(`進行中：${ctx.watching.route} 到站提醒`);
  if (ctx.riding) L.push('進行中：下車提醒（正在坐公車）');
  return L.join('\n').slice(0, 600);
}

// ───── 情境規則（網頁版、手機上的 AI 不可用或不足 3 句時） ─────
/** 每一句都是阿幫查得到、單獨看得懂的話；ask 是同 parseIntent 的形狀（test/suggest.test.js 用 parseIntent 逐句比對） */
const A = (q, ask, extra = {}) => ({ label: extra.label || q, q, ask, src: 'rule', rel: extra.rel || 0, domain: extra.domain || domainOf(ask.intent) });
export const DOMAIN = { trip: 'transit', bus_route: 'transit', metro: 'transit', youbike: 'transit', nearby_bus: 'transit', rail: 'transit', weather: 'life', aqi: 'life', outing: 'life', quake: 'life', pharmacy: 'life', garbage: 'life', invoice: 'money', fuel: 'money', stock: 'money' };
const domainOf = (intent) => DOMAIN[intent] || 'life';

/**
 * 依情境產生候選句（還沒排序；可能跟畫面重複，pickSuggestions 會丟掉）。
 * @returns {Array<{ label: string, q: string, ask: object, src: 'rule', rel: number, domain: string }>}
 */
export function ruleAsks(ctx) {
  const out = [];
  const { part, weekend, hour, min, dow } = ctx.time;
  const wet = !!(ctx.weather && (ctx.weather.raining || ctx.weather.pop3h >= 60));
  const has = (k) => ctx.saved.includes(k);
  if (ctx.lang === 'en') { // 英文那一輪：只給英文規則認得的幾句（core/agent/demo-intent.js englishIntent）
    out.push(A('Will it rain tomorrow?', { intent: 'weather', tomorrow: true }, { rel: wet ? 2 : 0 }), A('Next MRT train?', { intent: 'metro' }, { rel: ctx.trip?.bestRole === 'metro' ? 2 : 0 }), A('Any YouBike nearby?', { intent: 'youbike' }), A('How is the air quality?', { intent: 'aqi' }));
    return out;
  }
  const t = ctx.trip;
  if (t?.to) { // 剛查了行程：接下來最可能的是路上的即時資料、回程、目的地附近
    if (wet) out.push(A(`下雨了，${t.from ? `從${t.from}到${t.to}` : `去${t.to}`}少走路怎麼去？`, { intent: 'trip', from: t.from, to: t.to, states: ['lessWalk', 'rain'] }, { label: '下雨，少淋雨的走法', rel: 3 }));
    if (t.bestRole === 'metro') out.push(A('捷運現在多久一班？', { intent: 'metro' }, { rel: 2 }));
    if (t.route) out.push(A(`${t.route} 公車還要多久？`, { intent: 'bus_route', route: t.route }, { rel: 2 }));
    if (t.from) out.push(A(`從${t.to}到${t.from}怎麼去？`, { intent: 'trip', from: t.to, to: t.from }, { label: part === 'evening' || part === 'late' ? '晚上回程怎麼走？' : '回程怎麼走？', rel: 2 }));
    else if (has('家')) out.push(A(`從${t.to}回家怎麼走？`, { intent: 'trip', from: t.to, to: '家' }, { label: '回家怎麼走？', rel: 2 }));
    out.push(A(`${t.to}附近還有 YouBike 嗎？`, { intent: 'youbike', places: [t.to] }, { rel: 1 }));
    if (part === 'late') out.push(A('捷運幾點收班？', { intent: 'metro' }, { rel: 1 }));
  }
  if (ctx.bus || ctx.page?.kind === 'bus') { // 剛查公車或正在看公車頁
    out.push(A('附近還有哪些公車？', { intent: 'nearby_bus' }, { rel: 2 }));
    if (wet) out.push(A('出門要帶傘嗎？', { intent: 'outing' }, { rel: 1 }));
  }
  const pk = ctx.page?.kind;
  if (pk === 'weather' || pk === 'aqi') out.push(A('出門要帶傘嗎？', { intent: 'outing' }, { rel: 2 }), A(pk === 'aqi' ? '明天會下雨嗎？' : '今天空氣好嗎？', pk === 'aqi' ? { intent: 'weather', tomorrow: true } : { intent: 'aqi' }, { rel: 2 }));
  if (pk === 'metro' || pk === 'rail') out.push(A('捷運幾點收班？', { intent: 'metro' }, { rel: 1 }));
  if (pk === 'nearby') out.push(A('附近 YouBike 還有車嗎？', { intent: 'youbike' }, { rel: 2 }));
  if (ctx.watching) out.push(A(`${ctx.watching.route} 到哪了？`, { intent: 'bus_route', route: ctx.watching.route }, { rel: 2 }));
  // 時段
  if (part === 'morning') {
    out.push(has('公司') && !weekend ? A('去公司怎麼走最快？', { intent: 'trip', to: '公司', states: ['rush'] }) : A('捷運下一班幾分？', { intent: 'metro' }));
    out.push(A(wet ? '今天出門要帶傘嗎？' : '出門要注意什麼？', { intent: 'outing' }, { rel: wet ? 1 : 0 }));
    out.push(A('附近 YouBike 還有車嗎？', { intent: 'youbike' }));
  } else if (part === 'day') {
    out.push(A('去台北 101', { intent: 'trip', to: '台北101' }), A('今天空氣好嗎？', { intent: 'aqi' }, { rel: ctx.aqi > 100 ? 2 : 0 }), A('附近 YouBike 還有車嗎？', { intent: 'youbike' }));
    if (!weekend && (hour > 13 || (hour === 13 && min >= 30))) out.push(A('台積電今天收盤多少？', { intent: 'stock', query: '台積電' }));
  } else if (part === 'evening') {
    out.push(has('家') ? A('回家怎麼走？', { intent: 'trip', to: '家' }) : A('附近有哪些公車站？', { intent: 'nearby_bus' }));
    out.push(A(wet ? '明天還會下雨嗎？' : '明天會下雨嗎？', { intent: 'weather', tomorrow: true }), A('垃圾車幾點來？', { intent: 'garbage' }));
  } else {
    out.push(A('捷運幾點收班？', { intent: 'metro' }));
    if (has('家')) out.push(A('回家怎麼走最快？', { intent: 'trip', to: '家', states: ['rush'] }));
    out.push(A('附近的藥局有開嗎？', { intent: 'pharmacy' }), A('明天會下雨嗎？', { intent: 'weather', tomorrow: true }));
  }
  if (weekend && part !== 'late') out.push(A('出門要注意什麼？', { intent: 'outing' }));
  if (wet && !t) out.push(A('明天還會下雨嗎？', { intent: 'weather', tomorrow: true }, { rel: 1 }));
  // 消費（首頁每個領域都要有一句；問阿幫頁排在後面）
  out.push(dow === 0 || dow === 1 ? A('這週油價多少？', { intent: 'fuel' }) : A('這期發票中了嗎？', { intent: 'invoice' }));
  return out;
}

// ───── 排序與挑選 ─────
const TIME_FIT = { morning: ['outing', 'metro', 'trip', 'weather', 'bus_route'], day: ['trip', 'youbike', 'aqi', 'stock'], evening: ['trip', 'garbage', 'weather', 'nearby_bus'], late: ['metro', 'trip', 'pharmacy', 'weather'] };
const PAGE_FIT = { bus: ['bus_route', 'nearby_bus'], nearby: ['nearby_bus', 'youbike'], weather: ['weather', 'outing', 'aqi'], aqi: ['aqi', 'outing', 'weather'], metro: ['metro'], rail: ['rail', 'trip'], quake: ['quake'], pharmacy: ['pharmacy'], garbage: ['garbage'], fuel: ['fuel'], invoice: ['invoice'], stock: ['stock'] };
/** 情境裡的地名、路線（候選句提到就是「直接相關」） */
const entities = (ctx) => [ctx.trip?.to, ctx.trip?.from, ctx.trip?.route, ctx.bus?.route, ctx.page?.route, ctx.watching?.route].filter(Boolean).map(normAsk);
const mentions = (ask, ents) => [ask.to, ask.from, ask.route, ask.station, ...(ask.places || [])].some((x) => x && ents.includes(normAsk(x)));
/** 跟結果一起出現的下一步意圖（例：建議坐捷運 → 捷運下一班） */
const relatedIntents = (ctx) => [ctx.trip && 'trip', ctx.trip?.bestRole === 'metro' && 'metro', (ctx.trip?.route || ctx.bus) && 'bus_route', ctx.weather?.raining && 'weather'].filter(Boolean);

/** 分數：直接相關（提到情境的地名路線 +3、規則標的相關度、頁面 +2）＞時段 +1＞有即時資料 +1 */
export function scoreAsk(c, ctx) {
  const ask = c.ask || {};
  let s = c.rel || 0;
  if ((ctx.turns.length || ctx.page) && mentions(ask, entities(ctx))) s += 3;
  if (relatedIntents(ctx).includes(ask.intent)) s += 1;
  if (ctx.page?.kind && PAGE_FIT[ctx.page.kind]?.includes(ask.intent)) s += 2;
  if (TIME_FIT[ctx.time.part].includes(ask.intent)) s += 1;
  if (LIVE_INTENTS.includes(ask.intent)) s += 1;
  return s;
}

/** 依分數排序（同分照原本順序：模型自己的排序、規則的順序） */
export function rankAsks(cands, ctx) {
  return cands.map((c, i) => ({ c, i, s: scoreAsk(c, ctx) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

/** 丟掉查不到的（沒有 ask）、跟畫面上已回答的、剛問過的、頁面列已有的、彼此重複的 */
export function dropDup(cands, ctx, { pageChips = [] } = {}) {
  const out = [];
  const pc = pageChips.map(normAsk);
  for (const c of cands) {
    if (!c?.label) continue;
    if (c.ask && ctx.shown.some((s) => sameAsk(c.ask, s))) continue;
    if (ctx.recent.includes(normAsk(c.q || c.label)) || pc.includes(normAsk(c.label)) || pc.includes(normAsk(c.q || ''))) continue;
    if (out.some((x) => normAsk(x.label) === normAsk(c.label) || (c.ask && x.ask && sameAsk(c.ask, x.ask) && sameAsk(x.ask, c.ask)))) continue;
    out.push(c);
  }
  return out;
}

/**
 * 最後要顯示的：動作（到站提醒、開公車頁、決策圖加狀態；最多 2 個）＋問句。
 * 手機上的 AI 驗證後有 3 句以上就用它的；不足 3 句（或沒有）用規則補在後面。
 * @param {{ actions?: any[], edge?: any[]|null, rules?: any[], ctx: object, pageChips?: string[], max?: number }} o
 */
export function pickSuggestions({ actions = [], edge = null, rules = [], ctx, pageChips = [], max = 4 }) {
  const acts = [...actions.filter((a) => a.kind === 'remind' || a.kind === 'navigate'), ...actions.filter((a) => a.kind === 'state')].slice(0, 2);
  const need = Math.max(3, max - acts.length);
  const fromEdge = dropDup(rankAsks(edge || [], ctx), ctx, { pageChips });
  const asks = fromEdge.length >= 3 ? fromEdge.slice(0, need) : dropDup([...fromEdge, ...rankAsks(rules, ctx)], ctx, { pageChips }).slice(0, need);
  return { actions: acts, asks, items: orderSuggest({ actions: acts, asks }, ctx) };
}

/** 公車、捷運相關的情境：在公車／捷運頁，或這一輪剛查過公車到站（提醒類動作排第一） */
export const transitMoment = (ctx) => ['bus', 'metro'].includes(ctx.page?.kind) || !!ctx.bus;
/**
 * 畫面上的順序（產品負責人 2026-11-21 定案）：公車、捷運情境下提醒類動作（到站提醒、上車後提醒我下車、下車前提醒我）排第一；
 * 其他情境猜的問句在前（第一句也是 placeholder），動作在後。決策圖加狀態一律在問句後面。
 */
export function orderSuggest({ actions = [], asks = [] }, ctx) {
  const remind = actions.filter((a) => a.kind === 'remind' || a.kind === 'navigate');
  const rest = actions.filter((a) => !remind.includes(a));
  return transitMoment(ctx) ? [...remind, ...asks, ...rest] : [...asks, ...remind, ...rest];
}

/**
 * 首頁範例問題：依時段與「現在」的天氣空品，每個領域一句（交通、生活、消費）＋防詐。
 * @returns {Array<{ q: string, domain: string, intent: string }>}
 */
export function homeAsks(ctx) {
  const ranked = rankAsks(ruleAsks({ ...ctx, turns: [], trip: null, bus: null, page: null }), ctx);
  const pick = (d) => ranked.find((c) => c.domain === d);
  const FALLBACK = { transit: A('去台北 101', { intent: 'trip', to: '台北101' }), life: A('會下雨嗎？', { intent: 'weather' }), money: A('這期發票中了嗎？', { intent: 'invoice' }) };
  return ['transit', 'life', 'money'].map((d) => { const c = pick(d) || FALLBACK[d]; return { q: c.q, domain: d, intent: c.ask.intent }; });
}

// ───── 手機上的 AI 產生的句子 → 驗證 ─────
/**
 * 手機上的 AI 猜的句子送去驗證（只送句子），留下查得到的；常用地點要手機有設定才算。
 * @param {string[]} qs
 * @param {{ check: (asks: string[]) => Promise<Array<{ q: string, ok: boolean, needSaved?: string, ask?: object }>>, saved?: string[] }} o
 * @returns {Promise<Array<{ label: string, q: string, ask: object, src: 'edge' }>>}
 */
export async function validateAsks(qs, { check, saved = [] }) {
  if (!qs?.length) return [];
  let rows;
  try { rows = await check(qs.slice(0, 8)); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && typeof r.q === 'string' && r.ask && (r.ok || (r.needSaved && saved.includes(r.needSaved))))
    .map((r) => ({ label: r.q, q: r.q, ask: r.ask, src: 'edge', rel: 0, domain: domainOf(r.ask.intent) }));
}
