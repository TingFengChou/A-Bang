// 動態「下一句」建議的共用純函式（手機與伺服器同一份；伺服器以 /core/suggest.js 提供給前端，App 打包時一起帶）。
// 一句話阿幫查不查得到（answerable）、兩句是不是在問同一件事（sameAsk）、畫面上已經回答了什麼（shownAsks）。
// 輸入是 core/agent/demo-intent.js parseIntent 的結果形狀（伺服器驗證時）或規則自己帶的同形狀物件（手機上的規則）。

/** 比對用：臺／台視為相同、去括號與空白、「車站」與「站」結尾不分 */
export const normAsk = (s) => String(s || '').replace(/臺/g, '台').replace(/（.*?）|\(.*?\)/g, '').replace(/\s+/g, '').replace(/車?站$/, '').toLowerCase();

/** 阿幫有資料可以回答的意圖（demo-intent.js；access、scamAsk、limits、reset 這類是說明，不算） */
export const ANSWERABLE = ['trip', 'bus_route', 'youbike', 'nearby_bus', 'metro', 'rail', 'weather', 'aqi', 'quake', 'pharmacy', 'garbage', 'fuel', 'invoice', 'stock', 'outing'];
/** 有即時資料的（排序時優先：App 取得到的即時資料） */
export const LIVE_INTENTS = ['trip', 'bus_route', 'metro', 'youbike', 'nearby_bus', 'rail', 'weather', 'aqi', 'outing'];

/**
 * 這一句阿幫查得到嗎：意圖不是 unknown、需要的欄位齊全（沒說的位置可以用定位補）。
 * 常用地點沒設定（savedMissing）不在這裡算：手機知道自己設了哪些（needSaved）。
 */
export function answerable(it) {
  if (!it || !ANSWERABLE.includes(it.intent) || it.later) return false; // later：後天、週末，天氣只查得到今明兩天
  if (it.intent === 'trip') return !!(it.to || it.nearRail || it.toSaved);
  if (it.intent === 'bus_route') return !!it.route;
  if (it.intent === 'rail') return !!(it.to || it.from);
  if (it.intent === 'stock') return !it.advice; // 問該不該買：不提供投資建議
  if (it.intent === 'fuel') return !it.trend; // 漲跌：開放資料只有這週的牌價，答不了
  return true;
}

/** 只留比對與排序要用的欄位（伺服器回給手機的就是這些；沒有座標） */
export function slimAsk(it) {
  const o = { intent: it.intent };
  for (const k of ['from', 'to', 'route', 'station', 'line', 'query', 'nearRail', 'missing']) if (typeof it[k] === 'string' && it[k]) o[k] = it[k].slice(0, 40);
  if (it.places?.length) o.places = it.places.slice(0, 2).map((p) => String(p).slice(0, 40));
  if (it.states?.length) o.states = [...it.states];
  if (it.tomorrow) o.tomorrow = true;
  if (it.fare) o.fare = true;
  if (it.lang === 'en') o.lang = 'en';
  return o;
}

const place0 = (x) => normAsk(x.places?.[0]);
/**
 * 候選句 a 問的跟 b（另一句、或畫面上已經回答的）是同一件事嗎。
 * b 是畫面上的答案時，b.at 可以列好幾個地點（'' 表示「附近／你的位置」）。
 */
export function sameAsk(a, b) {
  if (!a || !b || a.intent !== b.intent) return false;
  const n = normAsk;
  switch (a.intent) {
    case 'trip': // 同起訖；多說的狀態畫面上都有了才算重複（「下雨了，少走路怎麼去」是新的問題）
      return n(a.to || a.nearRail) === n(b.to || b.nearRail) && n(a.from) === n(b.from) && (a.states || []).every((s) => (b.states || []).includes(s));
    case 'bus_route': return n(a.route) === n(b.route);
    case 'rail': return n(a.to) === n(b.to) && (!a.from || !b.from || n(a.from) === n(b.from)) && !!a.fare === !!b.fare;
    case 'metro': return !a.station || !b.station || n(a.station) === n(b.station);
    case 'stock': return n(a.query) === n(b.query) || (b.queries || []).map(n).includes(n(a.query));
    case 'weather': if (!!a.tomorrow !== !!b.tomorrow) return false; // falls through：地點比對同下
    default: {
      const at = b.at ? b.at.map(n) : [place0(b)];
      return at.includes(place0(a));
    }
  }
}

const here = (name) => (!name || /你的位置|現在位置|^現在|^目前/.test(name) ? '' : name);
/**
 * 這一輪畫面上已經回答的（工具結果 → 同 parseIntent 的形狀），用來丟掉重複的建議。
 * @param {Array<{ tool: string, data: any }>} results
 * @param {{ states?: Array<{ key: string, on?: boolean }> }|null} [decision]
 */
export function shownAsks(results = [], decision = null) {
  const out = [];
  const trip = results.filter((r) => r.tool === 'plan_trip').at(-1)?.data;
  const tripAt = trip ? [here(trip.to?.name), here(trip.from?.name)] : [];
  if (trip) {
    const states = (decision?.states || trip.states || []).filter((s) => s.on !== false).map((s) => s.key);
    out.push({ intent: 'trip', from: here(trip.from?.name), to: trip.to?.name || '', states });
    if (trip.weather) out.push({ intent: 'weather', at: tripAt });
  }
  for (const { tool, data: d = {} } of results) {
    if (tool === 'bus_route_eta') out.push({ intent: 'bus_route', route: d.routeName });
    else if (tool === 'weather_now') out.push({ intent: 'weather', at: ['', ...tripAt] });
    else if (tool === 'weather_tomorrow') out.push({ intent: 'weather', tomorrow: true, at: ['', ...tripAt] });
    else if (tool === 'aqi_nearby') out.push({ intent: 'aqi', at: ['', ...tripAt] });
    else if (tool === 'outing_advice') out.push({ intent: 'outing', at: [''] }, { intent: 'weather', at: [''] }, { intent: 'aqi', at: [''] });
    else if (tool === 'youbike_nearby') out.push({ intent: 'youbike', at: ['', ...tripAt] });
    else if (tool === 'bus_nearby_stations') out.push({ intent: 'nearby_bus', at: ['', ...tripAt] });
    else if (tool === 'metro_live_board') out.push({ intent: 'metro', station: d.station?.name || d.station || '' });
    else if (tool === 'thsr_timetable' || tool === 'tra_timetable') out.push({ intent: 'rail', from: d.from?.name || d.from || '', to: d.to?.name || d.to || '' });
    else if (tool === 'stock_quote') out.push({ intent: 'stock', queries: (d.quotes || []).flatMap((q) => [q.name, q.code]) });
    else if (tool === 'invoice_lottery') out.push({ intent: 'invoice', at: [''] });
    else if (tool === 'fuel_price') out.push({ intent: 'fuel', at: [''] });
    else if (tool === 'earthquake_recent') out.push({ intent: 'quake', at: [''] });
    else if (tool === 'pharmacy_search') out.push({ intent: 'pharmacy', at: [''] });
    else if (tool === 'garbage_truck_nearby') out.push({ intent: 'garbage', at: [''] });
  }
  return out;
}
