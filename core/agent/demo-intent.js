// 示範模式意圖解析（M5-03，AGENT.md §5）：沒有 API Key 時，以規則判斷意圖、地點與使用者狀態，
// 產生「分段的工具呼叫計畫」；由 run.js 執行並發出與 Claude 模式相同的事件流。不加人工延遲。
import { LANDMARKS, normPlace } from '../services/places.js';
import { nowTW } from '../util.js';

// ── 使用者狀態關鍵字（AGENT.md §5） ──
const STATE_WORDS = [
  ['rush', /趕|來不及|快一點|最快/],
  ['luggage', /行李|大包小包/],
  ['budget', /省錢|便宜|最省/],
  ['lessWalk', /不想走|少走|長輩|老人家|腳痛|輕鬆/],
  ['rain', /下雨|雨天|雨很大/],
];
const BUS_ROUTE = /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?:\s*(?:號|路)?\s*(?:公車|到哪|來了|還要|什麼時候|幾分))/;
const RAIL_WORD = /高鐵|台鐵|臺鐵|火車|自強|區間|莒光/;
// 生活服務（M10）：依序比對，先比的優先（「發票」先於其他）。天氣在行程之後才比（「下雨了，從 A 到 B」是行程）
const LIFE_WORDS = [
  ['invoice', /發票|對獎|中獎號碼/],
  ['fuel', /油價|汽油|柴油|95\s*無鉛|92\s*無鉛/],
  ['quake', /地震|震度|震央/],
  ['pharmacy', /藥局|藥房|領藥|拿藥/],
  ['garbage', /垃圾車|倒垃圾|收垃圾/],
  ['aqi', /空氣品質|空品|AQI|PM\s*2\.?5|空汙|空污|霧霾/i],
];
const WEATHER_WORD = /天氣|氣溫|溫度|幾度|會不會下雨|有沒有下雨|帶傘/;
/** 「臺北市大安區」「大安區」→ 藥局搜尋的地區 */
const AREA = /((?:[一-龥]{2}[市縣])?[一-龥]{1,2}[區鄉鎮])/;
// 22 縣市（可省略「市／縣」：「花蓮地震」；比對時臺／台視為相同）
const COUNTY = /((?:臺|台)北|新北|桃園|(?:臺|台)中|(?:臺|台)南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|(?:臺|台)東|澎湖|金門|連江)[市縣]?/;
const countyOf = (s) => COUNTY.exec(s)?.[0];
const INVOICE_NO = /(?:^|\D)(\d{8}|\d{3})(?!\d)/;

// 地標名稱與別名，長的優先（「台北車站」先於「台北」）
// 車站另加去掉「高鐵／捷運」與「車站／站」的短名（「左營」→ 高鐵左營站）；同長度時完整名稱優先
const short = (k) => normPlace(k).replace(/^(高鐵|捷運)/, '').replace(/(車站|站)$/, '');
const PLACE_KEYS = LANDMARKS.items
  .flatMap((x) => [x.name, ...x.aliases].flatMap((k) => [
    { key: normPlace(k), name: x.name, full: true },
    ...(x.kind === 'station' ? [{ key: short(k), name: x.name, full: false }] : []),
  ]))
  .filter((k) => k.key.length >= 2)
  .sort((a, b) => b.key.length - a.key.length || b.full - a.full);

/** 文字中出現的地標（依出現順序、不重疊、同一地標只算一次） */
export function placesInText(text) {
  const s = normPlace(text);
  const taken = new Array(s.length).fill(false);
  const hits = [];
  for (const { key, name } of PLACE_KEYS) {
    let i = s.indexOf(key);
    while (i >= 0) {
      if (!taken.slice(i, i + key.length).some(Boolean) && !hits.some((h) => h.name === name)) {
        for (let j = i; j < i + key.length; j++) taken[j] = true;
        hits.push({ name, index: i });
      }
      i = s.indexOf(key, i + 1);
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => h.name);
}

/** 「8 點前」「8:30 前」「早上 8 點半前」→ 'HH:mm' */
export function arriveByOf(text) {
  const m = /(\d{1,2})\s*(?:[點:：時])\s*(半|\d{1,2})?\s*分?\s*(?:以前|之前|前)/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === '半' ? 30 : Number(m[2] || 0);
  if (/下午|晚上/.test(text) && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 生活服務意圖與參數（沒有符合回 null） */
function lifeIntent(s) {
  const hit = LIFE_WORDS.find(([, re]) => re.test(s));
  if (!hit) return null;
  const intent = hit[0];
  if (intent === 'invoice') return { intent, number: INVOICE_NO.exec(s)?.[1] };
  if (intent === 'quake') return { intent, county: countyOf(s) };
  if (intent === 'pharmacy') return { intent, area: AREA.exec(s)?.[1] || countyOf(s) };
  return { intent };
}

/**
 * 解析一句話。
 * @returns {{ intent: 'trip'|'bus_route'|'youbike'|'nearby_bus'|'metro'|'rail'|'weather'|'aqi'|'quake'|'pharmacy'|'garbage'|'fuel'|'invoice'|'unknown',
 *            places: string[], states: string[], arriveBy: string|null, tomorrow: boolean, route?: string, system?: 'THSR'|'TRA', from?: string, to?: string,
 *            station?: string, number?: string, county?: string, area?: string }}
 */
export function parseIntent(text) {
  const s = String(text || '').trim();
  const places = placesInText(s);
  const states = STATE_WORDS.filter(([, re]) => re.test(s)).map(([k]) => k);
  const arriveBy = arriveByOf(s);
  const tomorrow = /明天|明早/.test(s);
  const base = { places, states, arriveBy, tomorrow };

  if (RAIL_WORD.test(s)) {
    const m = /([一-龥]{2,3}?)\s*(?:到|→|去|往)\s*([一-龥]{2,3}?)(?=下一班|幾點|的|班|車|站|[\s？?。，,！!]|$)/.exec(s.replace(RAIL_WORD, ' '));
    if (m) return { ...base, intent: 'rail', system: /高鐵/.test(s) ? 'THSR' : 'TRA', from: m[1], to: m[2] };
  }
  if (/捷運/.test(s)) {
    const m = /捷運\s*([一-龥]{2,6}?)站/.exec(s);
    if (m) return { ...base, intent: 'metro', station: m[1] };
  }
  const life = lifeIntent(s);
  if (life) return { ...base, ...life };
  const route = BUS_ROUTE.exec(s)?.[1];
  if (route && !/從.+到/.test(s)) return { ...base, intent: 'bus_route', route };
  if (/youbike|ubike|微笑單車|單車|腳踏車/i.test(s)) return { ...base, intent: 'youbike' };
  if (/附近/.test(s) && /公車|站牌/.test(s)) return { ...base, intent: 'nearby_bus' };
  if (/從.+(到|去)|怎麼去|怎麼走|要到|前到|想去|要去|帶我去|去.+怎麼/.test(s) && places.length) {
    const [from, to] = places.length >= 2 ? places : [null, places[0]];
    return { ...base, intent: 'trip', from, to };
  }
  if (WEATHER_WORD.test(s)) return { ...base, intent: 'weather' };
  return { ...base, intent: 'unknown' };
}

export const DEFAULT_FROM = '臺北車站'; // 示範：沒說起點也拿不到裝置定位時，先從這裡算
export const DEFAULT_AREA = '臺北市中正區'; // 示範：查藥局沒說地區時（臺北車站所在的區）

/** 以座標查「附近」的意圖：工具與點名 */
const NEARBY = {
  youbike: ['youbike_nearby', '@YouBike 附近還有車嗎'],
  nearby_bus: ['bus_nearby_stations', '@公車 附近有哪些站牌'],
  weather: ['weather_now', '@天氣 看一下現在的天氣'],
  aqi: ['aqi_nearby', '@空品 附近測站的空氣品質'],
  garbage: ['garbage_truck_nearby', '@垃圾車 附近的清運點和時間'],
};
const isNearby = (it) => Object.hasOwn(NEARBY, it.intent);

/** 需要使用者所在位置嗎（行程沒起點；附近類查詢沒地點） */
export const needsLocation = (it) => (it.intent === 'trip' && !it.from) || (isNearby(it) && !it.places[0]);

/**
 * 意圖 → 分段計畫。每段 `(results) => ({ note, calls })`，results 是之前各段的 callTool 結果（依名稱）。
 * 同一段的 calls 平行執行。
 * @returns {Array<(r: Record<string, any[]>) => ({ note: string, calls: Array<{ name: string, args: object }> } | null)>}
 */
export function demoSteps(it, now = Date.now()) {
  const point = (r, i) => r.find_place?.[i]?.data?.[0];
  const ll = (p) => p && { lat: p.lat, lon: p.lon };
  switch (it.intent) {
    case 'trip': {
      // 起點：說了地名 → 查地標；沒說但有裝置定位（M5-07）→ 直接用座標；都沒有 → 示範預設
      const fp = !it.from && it.fromPoint;
      const from = it.from || DEFAULT_FROM;
      const pts = (r) => (fp ? [fp, point(r, 0)] : [point(r, 0), point(r, 1)]);
      const asArg = (p) => (p === fp ? { lat: p.lat, lon: p.lon, name: p.name } : p.name);
      const date = it.tomorrow ? nowTW(now + 864e5).date : null;
      // 明天且有指定抵達時間：示範以抵達前 4 小時（最早 05:00）出發估算；沒有指定則明天 06:00
      const dep = date && (it.arriveBy ? `${String(Math.max(5, Number(it.arriveBy.slice(0, 2)) - 4)).padStart(2, '0')}:00` : '06:00');
      const userStates = it.states;
      return [
        () => (fp
          ? { note: `@地點 確認「${it.to}」在哪`, calls: [{ name: 'find_place', args: { query: it.to } }] }
          : { note: `@地點 先確認「${from}」和「${it.to}」在哪`, calls: [{ name: 'find_place', args: { query: from } }, { name: 'find_place', args: { query: it.to } }] }),
        (r) => { const [a, b] = pts(r); return a && b ? { note: '@天氣 @路況 看一下外面的狀況', calls: [{ name: 'weather_now', args: ll(a) }, { name: 'traffic_status', args: { from: ll(a), to: ll(b) } }] } : null; },
        (r) => { const [a, b] = pts(r); return a && b ? { note: '@行程 幫你比較幾種走法', calls: [{ name: 'plan_trip', args: {
          from: asArg(a), to: asArg(b), // 地名：卡片標題顯示地名；定位：帶座標與「你的位置」
          ...(dep && { departAt: `${date}T${dep}` }),
          ...((userStates.length || it.arriveBy) && { prefs: { ...(userStates.length && { states: userStates }), ...(it.arriveBy && { arriveBy: it.arriveBy }) } }),
        } }] } : null; },
      ];
    }
    case 'bus_route':
      return [
        ...(it.places[0] ? [() => ({ note: `@地點 「${it.places[0]}」在哪個縣市`, calls: [{ name: 'find_place', args: { query: it.places[0] } }] })] : []),
        (r) => ({ note: `@公車 ${it.route} 現在到哪了`, calls: [{ name: 'bus_route_eta', args: { city: point(r, 0)?.city || 'Taipei', routeName: it.route } }] }),
      ];
    case 'youbike':
    case 'nearby_bus':
    case 'weather':
    case 'aqi':
    case 'garbage': {
      const place = it.places[0] || DEFAULT_FROM;
      const [tool, note] = NEARBY[it.intent];
      if (!it.places[0] && it.fromPoint) return [() => ({ note, calls: [{ name: tool, args: ll(it.fromPoint) }] })]; // 用裝置定位
      return [
        () => ({ note: `@地點 找「${place}」的位置`, calls: [{ name: 'find_place', args: { query: place } }] }),
        (r) => (point(r, 0) ? { note, calls: [{ name: tool, args: ll(point(r, 0)) }] } : null),
      ];
    }
    case 'metro':
      return [() => ({ note: `@捷運 ${it.station}站下一班`, calls: [{ name: 'metro_live_board', args: { system: 'TRTC', station: it.station } }] })];
    case 'rail': {
      const name = it.system === 'THSR' ? 'thsr_timetable' : 'tra_timetable';
      const date = it.tomorrow ? nowTW(now + 864e5).date : undefined;
      return [() => ({ note: `@${it.system === 'THSR' ? '高鐵' : '台鐵'} ${it.from}到${it.to}的班次`, calls: [{ name, args: { from: it.from, to: it.to, ...(date && { date }) } }] })];
    }
    case 'quake':
      return [() => ({ note: '@地震 最近的地震報告', calls: [{ name: 'earthquake_recent', args: { ...(it.county && { county: it.county }), limit: 5 } }] })];
    case 'pharmacy': {
      const area = it.area || DEFAULT_AREA;
      return [() => ({ note: `@藥局 ${area}的健保藥局`, calls: [{ name: 'pharmacy_search', args: { area } }] })];
    }
    case 'fuel':
      return [() => ({ note: '@油價 中油這週的牌價', calls: [{ name: 'fuel_price', args: {} }] })];
    case 'invoice':
      return [() => ({ note: it.number ? '@發票 幫你對獎' : '@發票 最新一期中獎號碼', calls: [{ name: 'invoice_lottery', args: { ...(it.number && { number: it.number }) } }] })];
    default:
      return [];
  }
}

/** 示範模式的總結（取自工具結果，不經模型） */
export function demoSummary(it, results, suggestions = []) {
  if (it.intent === 'unknown') return `我可以幫你查交通（公車、捷運、台鐵、高鐵、YouBike、從 A 到 B 怎麼去）和生活資訊（天氣、空品、地震、藥局、垃圾車、油價、發票）。試試看：${suggestions.slice(0, 3).map((q) => `「${q}」`).join('、')}`;
  const last = Object.values(results).flat().filter(Boolean).at(-1);
  if (!last) return '這次沒查到資料，換個說法或加上地名試試看。';
  if (it.intent === 'trip') {
    const trip = results.plan_trip?.[0];
    const pre = it.from || it.fromPoint ? '' : `（你沒說從哪出發，我先用「${DEFAULT_FROM}」算。）`;
    return trip ? `${pre}${trip.data.ranking.reason}${trip.data.best ? ' 要我幫你開導航嗎？' : ''}` : `${pre}找不到這兩個地點，換個說法試試看。`;
  }
  // 沒說地點時用了示範預設，先講清楚
  const pre = isNearby(it) && !it.places[0] && !it.fromPoint ? `（你沒說在哪，我先查「${DEFAULT_FROM}」附近。）`
    : it.intent === 'pharmacy' && !it.area ? `（你沒說哪一區，我先查「${DEFAULT_AREA}」。）` : '';
  return `${pre}${last.speak || '查好了，結果在下面的卡片。'}`;
}
