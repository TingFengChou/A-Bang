// 示範模式意圖解析（M5-03，AGENT.md §5）：沒有 API Key 時，以規則判斷意圖、地點與使用者狀態，
// 產生「分段的工具呼叫計畫」；由 run.js 執行並發出與 Claude 模式相同的事件流。不加人工延遲。
import { LANDMARKS, normPlace } from '../services/places.js';
import { NEXT_STEP } from '../tools/trip.js';
import { outingSay } from './outing.js';
import { nowTW } from '../util.js';

// ── 使用者狀態關鍵字（AGENT.md §5） ──
const STATE_WORDS = [
  ['rush', /趕|來不及|快一點|最快/],
  ['luggage', /行李|大包小包/],
  ['budget', /省錢|便宜|最省/],
  ['lessWalk', /不想走|少走|腳痛|輕鬆/],
  ['elder', /長輩|老人家|阿公|阿嬤|爺爺|奶奶|外公|外婆|年紀大/],
  ['kids', /小孩|小朋友|孩子|嬰兒|寶寶|推車|娃娃車/],
  ['mobility', /輪椅|行動不便|拐杖|身障|腳受傷|骨折/],
  ['rain', /下雨|雨天|雨很大/],
  ['badAir', /空氣(很|好|有點|太)?(差|髒|不好)/],
];
const BUS_ROUTE = /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?:\s*(?:號|路)?\s*(?:公車|到哪|來了|還要|什麼時候|幾分))/;
const RAIL_WORD = /高鐵|台鐵|臺鐵|火車|自強|區間|莒光/;
// 生活服務（M10）：依序比對，先比的優先（「發票」先於其他）。天氣在行程之後才比（「下雨了，從 A 到 B」是行程）
const LIFE_WORDS = [
  ['invoice', /發票|對獎|中獎號碼/],
  ['fuel', /油價|汽油|柴油|95\s*無鉛|92\s*無鉛/],
  ['stock', /股價|股票|股市|[台臺]股|大盤|加權指數|櫃買|收盤|漲停|跌停|\bETF\b|\d{4}\s*(?:漲|跌)/i],
  ['quake', /地震|震度|震央/],
  ['pharmacy', /藥局|藥房|領藥|拿藥/],
  ['garbage', /垃圾車|倒垃圾|收垃圾/],
  ['aqi', /空氣品質|空品|空氣(?:好|差|不好|怎樣|如何)|AQI|PM\s*2\.?5|空汙|空污|霧霾|要不要戴口罩/i],
];
/** 出門建議的問法 */
const OUTING = /出門.{0,6}(?:注意|要帶|帶什麼|穿什麼|怎麼穿|帶傘|適合)|(?:今天|等一下|待會).{0,6}(?:注意什麼|要帶什麼|穿什麼)|要穿什麼|穿什麼出門/;
const WEATHER_WORD = /天氣|氣溫|溫度|幾度|下雨|帶傘|雨傘|會冷|會熱|颱風|出太陽/;
// 使用者指定交通方式（「坐公車去」「改叫車」）：plan_trip prefs.mode；「不要叫車」的叫車不算
const MODE_WORDS = [['bus', /公車|巴士/], ['bike', /youbike|ubike|單車|腳踏車/i], ['walk', /走路|步行|走過去/], ['ridehail', /叫車|計程車|小黃|uber|汽車|開車/i],
  ['thsr', /高鐵/], ['tra', /台鐵|臺鐵|火車/], ['intercity', /客運/]];
/** 使用者說不要的交通方式（「不要叫車」「不想坐公車」「別走路」）→ ['ridehail', …] */
const NOT_MODE = /(不要|不想|別|不用|不坐|不搭)\s*(坐|搭|改|騎|叫)?\s*$/;
export function avoidOf(s) {
  const out = [];
  for (const [mode, re] of MODE_WORDS) {
    const g = new RegExp(re.source, `${re.flags}g`);
    for (let m = g.exec(s); m; m = g.exec(s)) if (NOT_MODE.test(s.slice(Math.max(0, m.index - 5), m.index)) && !out.includes(mode)) out.push(mode);
  }
  return out;
}

export function modeOf(s) {
  let best = null;
  for (const [mode, re] of MODE_WORDS) {
    const g = new RegExp(re.source, `${re.flags}g`);
    for (let m = g.exec(s); m; m = g.exec(s)) {
      if (NOT_MODE.test(s.slice(Math.max(0, m.index - 5), m.index))) continue; // 「不想騎單車」「不要叫車」不是要
      if (!best || m.index > best.i) best = { mode, i: m.index };
    }
  }
  return best?.mode ?? null;
}
/** 前面最近一次的行程（起訖點、狀態），給「改坐公車」這種接著改的句子沿用 */
function lastTrip(history) {
  // 逐輪往後疊：第 1 輪行程、第 2 輪「改坐公車」、第 3 輪「我趕時間」→ 起訖點、交通方式、狀態都沿用（PR #30 審查）
  // 單趟累積：每一則把目前累積的行程（prev）交給 parseIntent，不再遞迴重算前文（PR #35 審查：原本是指數成長）
  let cur = null;
  history.forEach((m, i) => {
    if (m.role !== 'user') return;
    const it = parseIntent(String(m.content), { history: history.slice(0, i), prev: cur });
    if (it.reset) cur = null; // 「重來」：之前的行程不再沿用
    else if (it.intent === 'trip') cur = it;
  });
  return cur;
}
// 改交通方式要有明確的改換字眼（「坐」「搭」「騎」單獨出現不算：「搭 307 到哪了」是查公車）
const CHANGE_WORD = /改|換|那.*呢|還是|不要|不坐|不搭/;
/** 「重來」：清掉前面的行程（之後只說目的地就從現在位置算） */
const RESET = /^(?:重來|重新開始|從頭開始|從頭來|從頭|清除|清掉|算了)(?:吧|啦)?[。！!.]?$/;
/** 接著改目的地（「改去松山機場」「那去松山機場呢」「換到西門町」） */
const CHANGE_TO = /(?:改|換|那|還是)\s*(?:成)?\s*(?:去|到|往)/;
/** 只說起點（「我其實從板橋出發」「改從板橋」）：地標庫沒有也採用 */
const FROM_START = /(?:^|[其改])?(從)\s*([^\s，,。、到去往]{2,12}?)\s*(出發|過去)?\s*[。！!]?$/;
/** 不是地名的「從…」（從明天、從頭、從來、從現在、從這裡） */
const NOT_PLACE = /^(?:明天|今天|昨天|頭|來|現在|這裡|這邊|那裡|剛剛|以前|小)|開始|不坐|不搭|算/;
/** 地標庫沒有的起點：句尾有「出發」或「改從／其實從」才採用 */
function fromStartOf(s) {
  const m = FROM_START.exec(s);
  if (!m || NOT_PLACE.test(m[2])) return null;
  return m[3] || /(?:改|其實|我是|是)從/.test(s) ? m[2] : null;
}
/** 阿幫上一輪在問起點（「你從哪裡出發？」）→ 使用者只回地名＝起點 */
const ASKED_ORIGIN = /從哪(裡|兒)?出發|你(現在)?在哪|起點是/;
/** 句中明講的起點（「從桃園高鐵站到台北101」）：地標庫沒有也要用它，不能被手機定位蓋掉 */
const FROM_TEXT = /從\s*([^\s，,。、到去往]{2,12}?)\s*(?:到|去|往)/;

/** 整句只有地名（加上語氣詞、狀態詞）：當成「要去那裡」 */
function onlyPlace(s, places) {
  let rest = normPlace(s); // 地名可能是別名（「松山機場」→ 臺北松山機場）：用比對時的字去掉
  for (const { key, name } of PLACE_KEYS) if (places.includes(name)) rest = rest.split(key).join('');
  for (const [, re] of STATE_WORDS) rest = rest.replace(new RegExp(re.source, 'g'), '');
  return !rest.replace(/[我要想去到往帶很有點一下吧嗎呢啦了的，,。.!！?？\s]/g, '');
}
/** 「臺北市大安區」「大安區」→ 藥局搜尋的地區 */
const AREA = /((?:[一-龥]{2}[市縣])?[一-龥]{1,2}[區鄉鎮])/;
// 22 縣市（可省略「市／縣」：「花蓮地震」；比對時臺／台視為相同）
const COUNTY = /((?:臺|台)北|新北|桃園|(?:臺|台)中|(?:臺|台)南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|(?:臺|台)東|澎湖|金門|連江)[市縣]?/;
const countyOf = (s) => COUNTY.exec(s)?.[0];
const INVOICE_NO = /(?:^|\D)(\d{8}|\d{3})(?!\d)/;
// 股市：去掉口語與行情字眼，剩下的就是股票名稱或代號（「台積電和 0050 今天收盤多少」→「台積電、0050」）
const STOCK_FILLER = /今天|昨天|今日|現在|目前|最新|最近|股價|股票|股市|[台臺]股|大盤|加權指數|櫃買指數|指數|收盤價?|行情|報價|價格|走勢|表現|漲停|跌停|漲|跌|多少錢?|一股|每股|一張|幾塊|幾元|怎麼樣|如何|查詢|查一下|查|幫我|請問|看一下|看看|看|一下|要不要|該不該|可不可以|可以|能不能|值得|推薦|建議|會不會|明牌|進場|出場|買點|賣點|買|賣|有沒有|還|該|會|嗎|呢|吧|啊|了|的|我|\bETF\b/gi;
export const stockQueryOf = (s) => String(s).replace(STOCK_FILLER, '、').split(/[、,，;；\s？?。！!和跟與及]+/).filter((w) => (/^\d/.test(w) ? /^\d{4}/.test(w) : w.length >= 2)).slice(0, 5).join('、');
const STOCK_ADVICE = /該不該|要不要買|可以買|能買|值得買|該買|該賣|推薦|明牌|會漲|會跌|進場|出場|買點|賣點/;
export const NO_ADVICE = '阿幫不提供投資建議，只能報開放資料的收盤數字：';

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

/** 兩個地點的起訖：「從 X」「X 出發」是起點，「去／到／往 Y」是終點；看不出來照出現順序（「X 到 Y」） */
function orderFromTo(s, places) {
  const at = (p) => s.indexOf(p);
  const from = places.find((p) => at(p) >= 0 && (new RegExp(`從\\s*$`).test(s.slice(0, at(p))) || /^\s*出發/.test(s.slice(at(p) + p.length))));
  const to = places.find((p) => p !== from && at(p) >= 0 && /(?:去|到|往|抵達)\s*$/.test(s.slice(0, at(p))));
  if (from && to) return [from, to];
  if (from) return [from, places.find((p) => p !== from)];
  if (to && !/^(?:到|去|往)/.test(s.trim())) return [places.find((p) => p !== to), to];
  return places.slice(0, 2);
}

/** 中文數字（一～五十九、兩）→ 數字；阿拉伯數字照轉；看不懂回 NaN */
export function zhNum(t) {
  if (/^\d+$/.test(t)) return Number(t);
  const D = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = /^([一二三四五]?)(十?)([一二兩三四五六七八九]?)$/.exec(t);
  if (!m || !t) return NaN;
  if (!m[2]) return m[1] && m[3] ? NaN : D[m[1] || m[3]] ?? NaN; // 「三」「九」
  return (m[1] ? D[m[1]] : 1) * 10 + (m[3] ? D[m[3]] : 0); // 「十」「十二」「二十五」
}

/**
 * 抵達時間 → 'HH:mm'：「8 點前」「8:30 前」「早上 8 點半前」「九點半前」「下午兩點前到」「早上10點到」「10點要到」。
 * 只認「前」或「到／抵達」（「10點出發」是出發時間，不算）。下午、晚上、傍晚的 1～11 點加 12。
 */
export function arriveByOf(text) {
  const N = '\\d{1,2}|[一二兩三四五六七八九十]{1,3}';
  const m = new RegExp(`(${N})\\s*(?:[點:：時])\\s*(半|${N})?\\s*分?\\s*(?:以前|之前|前|(?:要|會|得)?(?:到|抵達))`).exec(text);
  if (!m) return null;
  let h = zhNum(m[1]);
  const min = m[2] === '半' ? 30 : m[2] ? zhNum(m[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (/下午|晚上|傍晚/.test(text) && h < 12) h += 12;
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
  if (intent === 'stock') return { intent, query: stockQueryOf(s) || undefined, advice: STOCK_ADVICE.test(s) };
  return { intent };
}

// 追問（「那聯發科呢？」「0056 呢」）：短句、沒有其他意圖時，沿用前面的股市提問
const FOLLOW_UP = /^(?:那|那麼|還有|再查|再看|換|也查)?\s*([^\s？?，,。！!]{2,12}?)\s*(?:呢|勒|咧|的呢|也查)?\s*[？?]?$/;
// 要有追問的語氣（「那…」「…呢」）或本身是代號，「謝謝」「好」不算
const FOLLOW_MARK = /^(?:那|那麼|還有|再查|再看|換|也查)|(?:呢|勒|咧)\s*[？?]?$|^\d{4,6}[A-Za-z]?\s*[？?]?$/;
const isFollowUp = (s) => FOLLOW_UP.test(s) && FOLLOW_MARK.test(s);
/** 往回找使用者上一個「不是追問」的提問；是股市就回 true */
function followsStock(history = []) {
  for (const m of history.filter((x) => x.role === 'user').reverse()) {
    const it = parseIntent(m.content);
    if (it.intent === 'stock') return true;
    if (it.intent !== 'unknown' || !isFollowUp(String(m.content).trim())) return false;
  }
  return false;
}

/**
 * 解析一句話；ctx.history（之前的訊息）用來接追問。
 * @returns {{ intent: 'trip'|'bus_route'|'youbike'|'nearby_bus'|'metro'|'rail'|'weather'|'aqi'|'quake'|'pharmacy'|'garbage'|'fuel'|'invoice'|'stock'|'unknown',
 *            places: string[], states: string[], arriveBy: string|null, tomorrow: boolean, route?: string, system?: 'THSR'|'TRA', from?: string, to?: string,
 *            station?: string, number?: string, county?: string, area?: string, query?: string, advice?: boolean }}
 */
export function parseIntent(text, ctx) {
  const s = String(text || '').trim();
  const history = (ctx && typeof ctx === 'object' && ctx.history) || [];
  const places = placesInText(s);
  const states = STATE_WORDS.filter(([, re]) => re.test(s)).map(([k]) => k);
  const arriveBy = arriveByOf(s);
  const tomorrow = /明天|明早/.test(s);
  const base = { places, states, arriveBy, tomorrow };
  // 判斷層（judge.js）已決定意圖：照那個意圖抽參數；抽不出必要參數時回 null，呼叫端改用規則自己的判斷
  if (ctx?.intent) return slotsFor(ctx.intent, s, base);

  // 接著上一輪（先於其他判斷：「改騎 YouBike」「改坐高鐵」也是改行程）改條件（「改坐公車」「那叫車呢」「我趕時間」）：沿用上一輪的起訖點與狀態重算
  const mode = modeOf(s);
  const sPos = s.replace(/(?:不要|不想|別|不用|不坐|不搭)\s*(?:坐|搭|騎|叫)?\s*(?:高鐵|台鐵|臺鐵|火車|客運)/g, ''); // 「不要坐高鐵」是改行程（排除），不是查高鐵
  const otherQuery = RAIL_WORD.test(sPos) || BUS_ROUTE.test(s) || WEATHER_WORD.test(s) || lifeIntent(s); // 查高鐵、公車路線、天氣等不是改行程
  if (RESET.test(s)) return { ...base, intent: 'unknown', reset: true };
  let tripMemo;
  const tripBefore = () => (tripMemo !== undefined ? tripMemo : (tripMemo = ctx && 'prev' in ctx ? ctx.prev : lastTrip(history)));
  const before = history.length && !otherQuery ? tripBefore() : null; // 結構化上下文（A3）：前面累積的行程條件
  // 接著改起點或目的地（只有一個地名＋提示詞；起點可以是地標庫沒有的地名，例「板橋」）：其他條件沿用
  if (before) {
    const keep = { ...before, states: [...new Set([...before.states, ...states])], ...(arriveBy && { arriveBy }), intent: 'trip', followUp: true };
    // 「從這裡出發」「從我現在的位置」→ 起點改回現在位置
    if (/從\s*(?:這裡|這邊|我這|我現在|現在的?位置)/.test(s) && !CHANGE_TO.test(s) && before.from) return { ...keep, from: null, changed: ['from'] };
    const fromText = fromStartOf(s);
    if (!CHANGE_TO.test(s) && (fromText || (places.length === 1 && /從\s*\S|出發/.test(s) && !NOT_PLACE.test(s.replace(/^.*?從\s*/, ''))))) {
      const p = places.length === 1 ? places[0] : fromText;
      if (p && p !== before.to) return { ...keep, from: p, changed: ['from', ...(arriveBy ? ['arriveBy'] : [])] };
    }
    if (places.length === 1 && CHANGE_TO.test(s) && places[0] !== before.from) return { ...keep, to: places[0], changed: ['to', ...(arriveBy ? ['arriveBy'] : [])] };
  }
  const prev = !places.length ? before : null;
  const avoid = avoidOf(s);
  if (prev && ((mode && CHANGE_WORD.test(s)) || (states.length && s.length <= 12) || avoid.length || arriveBy)) {
    // 說不要的方式累積（「不要叫車」後「也不要走路」）；改成某方式時從不要的清單拿掉
    const avoidAll = [...new Set([...(prev.avoid || []), ...avoid])].filter((m) => m !== mode); // 這句明講要坐的不算不要
    const useMode = mode || (avoidAll.includes(prev.mode) ? null : prev.mode); // 上一輪指定的方式被說不要了 → 取消指定
    const { mode: _m, avoid: _a, ...rest } = prev;
    return {
      ...rest, states: [...new Set([...prev.states, ...states])], intent: 'trip',
      ...(useMode && { mode: useMode }),
      ...(avoidAll.length && { avoid: avoidAll }), ...((arriveBy || prev.arriveBy) && { arriveBy: arriveBy || prev.arriveBy }), followUp: true,
      changed: [...(mode ? ['mode'] : []), ...(avoid.length ? ['avoid'] : []), ...(arriveBy ? ['arriveBy'] : []), ...(states.length ? ['states'] : [])],
    };
  }
  // 阿幫剛問「你從哪裡出發？」，使用者只回地名 → 那是起點，目的地沿用上一輪
  const lastBot = [...history].reverse().find((m) => m.role === 'assistant');
  if (places.length === 1 && lastBot && ASKED_ORIGIN.test(String(lastBot.content)) && onlyPlace(s, places)) {
    const asked = tripBefore();
    if (asked?.to && asked.to !== places[0]) return { ...asked, from: places[0], intent: 'trip', followUp: true, changed: ['from'] };
  }

  if (RAIL_WORD.test(s)) {
    const m = /([一-龥]{2,3}?)\s*(?:到|→|去|往)\s*([一-龥]{2,3}?)(?=下一班|幾點|的|班|車|站|[\s？?。，,！!]|$)/.exec(s.replace(RAIL_WORD, ' '));
    if (m) return { ...base, intent: 'rail', system: /高鐵/.test(s) ? 'THSR' : 'TRA', from: m[1], to: m[2] };
  }
  if (/捷運/.test(s)) {
    const m = /捷運\s*([一-龥]{2,6}?)站/.exec(s);
    if (m) return { ...base, intent: 'metro', station: m[1] };
  }
  // 問捷運下一班但沒說站（「板南線下一班幾分」「捷運還要等多久」）→ 用現在位置最近的站（needsLocation）
  // 句子裡有地標（「台北車站捷運下一班」）→ 找那裡最近的站（near），不用現在位置
  if ((/捷運|MRT/i.test(s) || METRO_LINE.test(s)) && METRO_ASK.test(s) && !/站/.test(s.replace(/車站/g, ''))) return { ...base, intent: 'metro', station: null, line: METRO_LINE.exec(s)?.[0] || null, ...(places[0] && { near: places[0] }) };
  // 出門建議（S13）：天氣＋空品一起看（「今天出門要注意什麼」「出門要帶傘嗎」「要穿什麼」）
  if (OUTING.test(s) && !places.length) return { ...base, intent: 'outing' };
  const life = lifeIntent(s);
  if (life) return { ...base, ...life };
  const route = BUS_ROUTE.exec(s)?.[1];
  if (route && !/從.+到/.test(s)) return { ...base, intent: 'bus_route', route };
  if (/youbike|ubike|微笑單車|單車|腳踏車/i.test(s) && !(places.length && /去|到|往/.test(s))) return { ...base, intent: 'youbike' }; // 「騎 YouBike 去 X」是行程
  if (/附近/.test(s) && /公車|站牌/.test(s)) return { ...base, intent: 'nearby_bus' };
  // 行程：只說目的地（「去台北101」「想省錢，去松山機場」，甚至只打地名）→ 起點用現在位置（needsLocation）
  if (places.length && (/從.+(到|去)|出發\s*(?:去|到|往)|怎麼去|怎麼走|要到|前到|想去|要去|帶我去|去.+怎麼|(?:^|[，,、\s])(?:去|到|往)\s*\S|(?:坐|搭|騎|用|開車|走路|推|帶).{0,8}(?:去|到|往)/.test(s) || onlyPlace(s, places))) {
    const [from, to] = places.length >= 2 ? orderFromTo(s, places) : [FROM_TEXT.exec(s)?.[1] ?? null, places[0]]; // 明講的起點優先
    return { ...base, intent: 'trip', from, to, ...(mode && { mode }) };
  }
  if (WEATHER_WORD.test(s)) return { ...base, intent: 'weather' };
  // 前面在聊股市時，「我該買台積電嗎？」沒有股市字眼也接著查（並說明不提供投資建議）
  if (STOCK_ADVICE.test(s) && followsStock(history)) return { ...base, intent: 'stock', query: stockQueryOf(s) || undefined, advice: true, followUp: true };
  const follow = isFollowUp(s) && FOLLOW_UP.exec(s);
  if (follow && followsStock(history)) return { ...base, intent: 'stock', query: stockQueryOf(follow[1]) || follow[1], advice: false, followUp: true };
  return { ...base, intent: 'unknown' };
}

/**
 * 指定意圖下抽參數（給判斷層用）：例如判斷層說是公車，就找路線號碼；找不到必要參數回 null。
 * @returns {ReturnType<typeof parseIntent>|null}
 */
function slotsFor(intent, s, base) {
  switch (intent) {
    case 'rail': {
      const m = /([一-龥]{2,3}?)\s*(?:到|→|去|往|回)\s*([一-龥]{2,3}?)(?=下一班|幾點|的|班|車|站|要|有|[\s？?。，,！!]|$)/.exec(s.replace(RAIL_WORD, ' '));
      return m && !/[我要坐搭想你在]/.test(m[1]) ? { ...base, intent, system: /高鐵/.test(s) ? 'THSR' : 'TRA', from: m[1], to: m[2] } : null; // 「我要坐火車去花蓮」沒有起站
    }
    case 'metro': {
      const m = /(?:捷運|MRT)?\s*([一-龥]{2,6}?)站/i.exec(s);
      return m ? { ...base, intent, station: m[1] } : { ...base, intent, station: null, line: METRO_LINE.exec(s)?.[0] || null, ...(base.places?.[0] && { near: base.places[0] }) }; // 沒說站：最近的站
    }
    case 'bus_route': {
      const route = BUS_ROUTE.exec(s)?.[1] || /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?!\d)/.exec(s)?.[1];
      return route ? { ...base, intent, route } : null;
    }
    case 'trip': {
      if (!base.places.length) return null;
      const [from, to] = base.places.length >= 2 ? base.places : [null, base.places[0]];
      return { ...base, intent, from, to };
    }
    case 'invoice': return { ...base, intent, number: INVOICE_NO.exec(s)?.[1] };
    case 'quake': return { ...base, intent, county: countyOf(s) };
    case 'pharmacy': return { ...base, intent, area: AREA.exec(s)?.[1] || countyOf(s) };
    case 'stock': return { ...base, intent, query: stockQueryOf(s) || undefined, advice: STOCK_ADVICE.test(s) || undefined };
    case 'youbike': case 'nearby_bus': case 'weather': case 'aqi': case 'garbage': case 'fuel': case 'unknown':
      return { ...base, intent };
    default: return null;
  }
}

export const DEFAULT_FROM = '臺北車站'; // 示範：沒說起點也拿不到裝置定位時，先從這裡算
export const DEFAULT_AREA = '臺北市中正區';
export const INVOICE_WALLET_HINT = '要不要把發票存到「我的發票」？可以直接掃發票左邊的 QR code，號碼只存在你的手機，開獎後打開阿幫就自動幫你對獎（首頁 → 發票對獎）。'; // 示範：查藥局沒說地區時（臺北車站所在的區）

/** 捷運路線名（台北、桃園、台中、高雄）與「下一班」類問法 */
const METRO_LINE = /(?:板南|淡水信義|淡水|信義|松山新店|松山|新店|中和新蘆|新蘆|文湖|環狀|萬大|機場|綠|紅|橘|藍|棕|黃)線/;
const METRO_ASK = /下一班|幾分|多久|還要等|到站|來了沒|什麼時候來/;

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
export const needsLocation = (it) => (it.intent === 'trip' && !it.from) || ((isNearby(it) || it.intent === 'bus_route') && !it.places[0]) || (it.intent === 'metro' && !it.station && !it.near) || (it.intent === 'outing' && !it.places[0]);

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
        (r) => { const [a, b] = pts(r); return a && b ? { note: '@天氣 @空品 @路況 看一下外面的狀況', calls: [{ name: 'weather_now', args: ll(a) }, { name: 'aqi_nearby', args: ll(a) }, { name: 'traffic_status', args: { from: ll(a), to: ll(b) } }] } : null; },
        (r) => { const [a, b] = pts(r); return a && b ? { note: '@行程 幫你比較幾種走法', calls: [{ name: 'plan_trip', args: {
          from: asArg(a), to: asArg(b), // 地名：卡片標題顯示地名；定位：帶座標與「你的位置」
          ...(dep && { departAt: `${date}T${dep}` }),
          ...((userStates.length || it.arriveBy || it.mode || it.avoid?.length) && { prefs: { ...(userStates.length && { states: userStates }), ...(it.arriveBy && { arriveBy: it.arriveBy }), ...(it.mode && { mode: it.mode }), ...(it.avoid?.length && { avoid: it.avoid }) } }),
        } }] } : null; },
      ];
    }
    case 'bus_route':
      return [
        ...(it.places[0] ? [() => ({ note: `@地點 「${it.places[0]}」在哪個縣市`, calls: [{ name: 'find_place', args: { query: it.places[0] } }] })] : []),
        // 說了地點 → 離那裡最近的站；沒說 → 離你（裝置定位）最近的站；都沒有 → 全線
        (r) => {
          const p = point(r, 0);
          const near = p ? { lat: p.lat, lon: p.lon, name: p.name } : it.fromPoint ? ll(it.fromPoint) : null;
          return { note: `@公車 ${it.route} 現在到哪了${near ? '，離你最近的站多久到' : ''}`, calls: [{ name: 'bus_route_eta', args: { ...(p ? { city: p.city } : near ? {} : { city: 'Taipei' }), routeName: it.route, ...(near && { near }) } }] };
        },
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
    case 'outing': { // 天氣＋空品一起查（同一個位置）
      const at = it.fromPoint ? ll(it.fromPoint) : null;
      if (at) return [() => ({ note: '@天氣 @空品 出門前幫你看一下', calls: [{ name: 'weather_now', args: at }, { name: 'aqi_nearby', args: at }] })];
      return [
        () => ({ note: `@地點 找「${DEFAULT_FROM}」的位置`, calls: [{ name: 'find_place', args: { query: DEFAULT_FROM } }] }),
        (r) => (point(r, 0) ? { note: '@天氣 @空品 出門前幫你看一下', calls: [{ name: 'weather_now', args: ll(point(r, 0)) }, { name: 'aqi_nearby', args: ll(point(r, 0)) }] } : null),
      ];
    }
    case 'metro':
      if (!it.station) { // 沒說站：句子裡的地標或現在位置最近的捷運站（拿不到位置就用預設地點）；說了路線只找這條線
        const near = it.near || (it.fromPoint ? ll(it.fromPoint) : DEFAULT_FROM);
        const where = it.near ? `「${it.near}」` : it.fromPoint ? '離你' : `「${DEFAULT_FROM}」`;
        return [() => ({ note: `@捷運 找${where}最近的${it.line || ''}站，看下一班`, calls: [{ name: 'metro_live_board', args: { near, ...(it.line && { line: it.line }) } }] })];
      }
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
    case 'stock':
      return [() => ({ note: it.query ? `@股市 查「${it.query}」的收盤行情` : '@股市 看一下大盤收盤', calls: [{ name: 'stock_quote', args: { ...(it.query && { query: it.query }) } }] })];
    case 'invoice':
      return [() => ({ note: it.number ? '@發票 幫你對獎' : '@發票 最新一期中獎號碼', calls: [{ name: 'invoice_lottery', args: { ...(it.number && { number: it.number }) } }] })];
    default:
      return [];
  }
}

const MODE_SAY = { walk: '走路', bike: 'YouBike', bus: '公車', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' };
const MODE_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車' };
const STATE_SAY = { rush: '趕時間', luggage: '帶行李', budget: '想省錢', lessWalk: '少走路', rain: '下雨', badAir: '空氣差', traffic: '塞車', elder: '帶長輩', kids: '帶小孩', mobility: '行動不便' };
/**
 * 接著改的那一輪，討論串第一句說清楚沿用什麼、改了什麼（PR #35 設計審查）：「沿用：西門町 → 台北101｜改：不要叫車」
 * @returns {string|null}
 */
export function contextNote(it) {
  if (!it?.followUp || it.intent !== 'trip' || !it.to || !it.changed?.length) return null;
  const say = { from: `起點${it.from || '你的位置'}`, to: `目的地${it.to}`, arriveBy: `${it.arriveBy} 前到`, mode: MODE_DO[it.mode] || '換方式', avoid: `不要${(it.avoid || []).map((m) => MODE_SAY[m]).join('、')}`, states: (it.states || []).map((k) => STATE_SAY[k]).filter(Boolean).join('、') };
  const changed = it.changed.map((k) => say[k]).filter(Boolean).join('、');
  return `沿用：${it.from || '你的位置'} → ${it.to}｜改：${changed}`.slice(0, 60);
}

/** 示範模式的總結（取自工具結果，不經模型） */
export function demoSummary(it, results, suggestions = []) {
  if (it.intent === 'outing') {
    const pre = it.fromPoint ? '' : it.noLocation ? `（沒拿到你的位置，先看「${DEFAULT_FROM}」附近。）` : `（你沒說在哪，我先看「${DEFAULT_FROM}」附近。）`;
    return `${pre}${outingSay({ weather: results.weather_now?.at(-1)?.data, air: results.aqi_nearby?.at(-1)?.data?.nearest })}`;
  }
  if (it.reset) return '好，重新開始。想去哪裡、想查什麼？沒說起點的話，我用你現在的位置。';
  if (it.intent === 'unknown') return `我可以幫你查交通（公車、捷運、台鐵、高鐵、YouBike、從 A 到 B 怎麼去）和生活資訊（天氣、空品、地震、藥局、垃圾車、油價、發票、股市收盤）。試試看：${suggestions.slice(0, 3).map((q) => `「${q}」`).join('、')}`;
  const last = Object.values(results).flat().filter(Boolean).at(-1);
  if (!last) return '這次沒查到資料，換個說法或加上地名試試看。';
  if (it.intent === 'trip') {
    const trip = results.plan_trip?.[0];
    const pre = it.from || it.fromPoint ? '' : it.noLocation ? `（沒拿到你的位置，先從「${DEFAULT_FROM}」算；告訴我從哪出發就重算。）` : `（你沒說從哪出發，我先用「${DEFAULT_FROM}」算。）`;
    // 選了公車：阿幫已自動盯上車站（run.js busFollowUp）→ 講公車多久到、主動問要不要到站提醒
    const bus = results.bus_route_eta?.at(-1)?.data?.focus && results.bus_route_eta.at(-1);
    if (trip && bus) {
      const walk = trip.data.options.find((o) => o.id === trip.data.best)?.follow?.walkMin;
      const f = bus.data.focus;
      const miss = walk && f.status === 0 && f.etaSec != null && f.etaSec < walk * 60; // 走過去要比車到還久
      return `${pre}${trip.data.ranking.reason} ${bus.speak.replace(/。$/, '')}${walk ? `，走過去約 ${walk} 分` : ''}${miss ? '，這班可能趕不上。要我在下一班快到時提醒你嗎？' : '。要我在公車快到站時提醒你嗎？'}按卡片上的「到站前 3 分提醒我」。`;
    }
    // 下一步依建議方式（叫車按官方連結、步行導航…；不再一律問「要我幫你開導航嗎」）
    const role = trip?.data.options.find((o) => o.id === trip.data.best)?.role;
    return trip ? `${pre}${trip.data.ranking.reason}${NEXT_STEP[role] ? ` 下一步：${NEXT_STEP[role]}。` : ''}` : `${pre}找不到這兩個地點，換個說法試試看。`;
  }
  // 沒說地點時用了示範預設，先講清楚
  const pre = (isNearby(it) || (it.intent === 'metro' && !it.station && !it.near)) && !it.places[0] && !it.fromPoint
    ? (it.noLocation ? `（沒拿到你的位置，先查「${DEFAULT_FROM}」附近；告訴我地點就重查。）` : `（你沒說在哪，我先查「${DEFAULT_FROM}」附近。）`)
    : it.intent === 'pharmacy' && !it.area ? `（你沒說哪一區，我先查「${DEFAULT_AREA}」。）`
    : it.intent === 'stock' && it.advice ? NO_ADVICE : '';
  // 發票：主動提議存到「我的發票」，開獎後自動對獎（號碼只存在手機）
  const post = it.intent === 'invoice' ? ` ${INVOICE_WALLET_HINT}` : '';
  return `${pre}${last.speak || '查好了，結果在下面的卡片。'}${post}`;
}
