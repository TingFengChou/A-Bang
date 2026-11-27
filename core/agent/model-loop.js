// 模型模式的一輪對話（M5-05，AGENT.md §4、ADR-0012）：Claude 與地端模型共用。
// 模型在呼叫工具前的文字 → agent_note；沒有工具呼叫的那輪文字 → text；工具一律走 execTools（與示範模式相同的事件）。
import { safetyCheck } from './safety.js';
import { describeTool, getTool } from '../tools/index.js';
import { getProfile } from '../agents/index.js';
import { buildSystemPrompt } from './prompt.js';
import { ev } from './events.js';
import { validateRequest, judgeCalls, execTools, deviceLocation, guardedText, hideToolNames, judgeInfo, runDemo, asideState, withAskCheck, LOCATION_CALL_ID, MAX_TOOL_ROUNDS } from './run.js';
import { judgeNote, outingNote, moreStatesNote } from './impact.js';
import { slotAsk, deviceAskTracker, deviceSlotAsk } from './ask.js';
import { askFirst } from './clarify-plan.js';
import { scamPasteAsk } from './clarify.js';
import { lineCode } from '../tools/metro.js';
import { normName, nowTW } from '../util.js';
import { parseIntent, needsLocation, DEFAULT_FROM, contextNote, tripDepartAt, demoSummary, isEnglish, nightNote, rainAsked } from './demo-intent.js';
import { resolvePoint } from '../services/places.js';
import { BUS_OFF } from '../services/trip.js';
import { deviceIntent, deviceActionReply } from './device-turn.js';

/**
 * @typedef {{ name: string, description: string, schema: object }} ToolDef
 * @typedef {{ id: string, name: string, input: object, bad?: string }} ModelCall bad：參數不是有效 JSON（原字串）
 * @typedef {{ text: string, calls: ModelCall[], stop: 'end'|'tool'|'max_tokens'|'refusal'|'other', usage: { input: number, output: number } }} ModelTurn
 * @typedef {{ id: string, content: string, isError?: boolean }} ToolResultMsg
 * @typedef {{ mode: 'claude'|'local', model: string,
 *   start(o: { system: string, tools: ToolDef[], messages: Array<{ role: string, content: string }> }):
 *     { next(): Promise<ModelTurn>, addResults(turn: ModelTurn, results: ToolResultMsg[]): void } }} Provider
 */

/** 裝置端工具（ADR-0008）：客戶端支援時才提供給模型 */
export const DEVICE_LOCATION_TOOL = {
  name: 'device_location',
  description: '取得使用者裝置目前的位置（緯度、經度）。只在需要使用者所在位置、而使用者沒說起點或所在地時使用。',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

export const FALLBACK = {
  rounds: '我查了好幾輪資料，結果都在上面的卡片；想再縮小範圍可以換個問法。',
  truncated: '回答太長被截斷了，換個簡短一點的問法試試看。',
  refusal: '這個問題我沒辦法協助；我可以幫你查公車、捷運、台鐵、高鐵、YouBike，或規劃從 A 到 B 怎麼去。',
  empty: '查好了，結果在上面的卡片。',
  noLocation: '使用者沒有提供位置。請改問使用者從哪裡出發（或人在哪裡），不要猜。',
};

/** 有卡片的工具，回給模型的清單最多幾筆（完整結果已在卡片上） */
export const MODEL_LIST_MAX = 6;

/** 模型（Claude／地端）呼叫失敗：標記起來，伺服器才分得出是模型出錯、不是資料來源（server/agent.js 防詐改用規則回答） */
export function asModelError(e) {
  const err = e instanceof Error ? e : new Error(String(e));
  try { err.fromModel = true; } catch { /* 凍結的錯誤物件：照原樣丟 */ }
  return err;
}
export const isModelError = (e) => e?.fromModel === true;
/** 拒絕定位時先用預設起點，模型要照這句說明 */
export const NO_LOCATION_NOTE = `［內部備註］沒拿到使用者的位置，起點先用「${DEFAULT_FROM}」；回答時先說「沒拿到你的位置，先從${DEFAULT_FROM}算」，並請他說從哪出發就重算。`;
const NEARBY_TOOL = { weather: 'weather_now', aqi: 'aqi_nearby', youbike: 'youbike_nearby', nearby_bus: 'bus_nearby_stations', garbage: 'garbage_truck_nearby', pharmacy: 'pharmacy_search' };
/** 捷運沒說站：用現在位置找最近的站（metro_live_board 的 near） */
const METRO_NEAR = 'metro_live_board';
/** 由程式先查的工具（見 runModel）：起訖點已知的行程、有現在位置時的附近類與捷運最近站 */
/** 說了地點時，先找地點再查的工具（與示範模式相同） */
const PLACE_TOOL = { weather: 'weather_now', aqi: 'aqi_nearby', garbage: 'garbage_truck_nearby', youbike: 'youbike_nearby', nearby_bus: 'bus_nearby_stations', pharmacy: 'pharmacy_search' };
export function prefetchCalls(it, j, here, placePt = null) {
  const at = here && { lat: here.lat, lon: here.lon };
  if (placePt && PLACE_TOOL[it.intent]) { // 「那裡會下雨嗎」「板橋車站附近的藥局」：地點＋那裡的資料
    const tool = it.intent === 'weather' && it.tomorrow ? 'weather_tomorrow' : PLACE_TOOL[it.intent];
    return it.intent === 'weather' && it.later ? [] : [{ name: 'find_place', args: { query: it.places[0] } }, { name: tool, args: { lat: placePt.lat, lon: placePt.lon } }];
  }
  // 公車路線（含「那 299 咧」「剛剛那班」）：離你最近的站多久到；一句兩件事順便看天氣
  if (it.intent === 'bus_route' && it.route && !it.places?.length) return [{ name: 'bus_route_eta', args: { routeName: it.route, ...(at && { near: { ...at, name: here.name } }) } }, ...(it.alsoWeather && at ? [{ name: 'weather_now', args: at }] : [])];
  // 高鐵／台鐵說了起訖站：直接查班次（「明天早上台北到台中的高鐵」）
  if (it.intent === 'rail' && !it.fare && it.from && it.to) return [{ name: it.system === 'THSR' ? 'thsr_timetable' : 'tra_timetable', args: { from: it.from, to: it.to, ...(it.tomorrow && { date: nowTW(Date.now() + 864e5).date }) } }];
  // 行程：起訖點都知道（明講的起點，或沒說＝現在位置）就由程式先比較，不靠模型記得呼叫 plan_trip
  //（地端模型接著改「改坐公車」時常不再查、說「叫車」時直接產生叫車連結，2026-11-21 情境評測）
  // 沒說起點也拿不到位置（拒絕定位）：先從示範預設起點算，並告訴模型要說明（與示範模式一致）
  if (it.intent === 'trip' && (it.to || it.toSaved)) {
    const mode = it.mode || j?.mode; // 與 groundedPrefs 相同：規則沒抓到、判斷層聽懂的方式也算使用者說的
    const prefs = { ...(it.arriveBy && { arriveBy: it.arriveBy }), ...(mode && { mode }), ...(it.avoid?.length && { avoid: it.avoid }), ...(it.states?.length && { states: it.states }), ...(it.party && { party: it.party }) };
    const from = it.fromSaved || it.from || (at ? { ...at, name: here.name } : DEFAULT_FROM); // 常用地點（家、公司）直接用座標
    return [{ name: 'plan_trip', args: { from, to: it.toSaved || it.to, ...(Object.keys(prefs).length && { prefs }) }, ...(!it.from && !at && { note: NO_LOCATION_NOTE }) }];
  }
  if (it.intent === 'metro' && !it.station && (it.near || at)) return [{ name: METRO_NEAR, args: { near: it.near || { ...at, name: here.name }, ...(it.line && { line: it.line }) } }];
  // 高鐵／台鐵沒說起站：句中地名或現在位置最近的車站（拿不到位置用預設地點，與示範模式一致）
  if (it.intent === 'rail' && !it.fare && !it.from && it.to) {
    const near = it.near || (at ? { ...at, name: here.name } : DEFAULT_FROM);
    return [{ name: it.system === 'THSR' ? 'thsr_timetable' : 'tra_timetable', args: { to: it.to, near, ...(it.tomorrow && { date: nowTW(Date.now() + 864e5).date }) }, ...(!it.near && !at && { note: NO_LOCATION_NOTE }) }];
  }
  if (it.intent === 'outing') { // 出門建議：天氣＋空品一張卡；說了地點查那裡、沒拿到位置先看預設地點（與示範模式一致）
    const st = [...(it.states || []), ...(j?.states || [])]; // 判斷層聽出的同行者也算
    const who = st.includes('kids') ? 'kids' : st.includes('elder') ? 'elder' : null;
    const where = it.places?.[0] ? { place: it.places[0] } : at ? at : { place: DEFAULT_FROM };
    return [{ name: 'outing_advice', args: { ...where, ...(who && { with: who }) }, ...(!it.places?.[0] && !at && { note: NO_LOCATION_NOTE.replace('起點先用', '先看').replace('先從', '先看').replace('算」，並請他說從哪出發就重算', '附近」，並請他說在哪就重查') }) }];
  }
  if (it.intent === 'pharmacy' && it.area) return [{ name: 'pharmacy_search', args: { area: it.area } }]; // 說了哪一區：查那一區（不用位置）
  if (!at) return [];
  if (it.places?.length) return [];
  const intent = NEARBY_TOOL[it.intent] ? it.intent : NEARBY_TOOL[j?.intent] ? j.intent : null;
  if (intent === 'weather' && it.later) return []; // 後天以後：沒有工具查得到，交給模型說明
  if (intent === 'weather' && it.tomorrow) return [{ name: 'weather_tomorrow', args: at }]; // 問明天：預報
  return intent ? [{ name: NEARBY_TOOL[intent], args: at }] : [];
}

/**
 * 預先查詢的比對鍵：plan_trip 看起點、目的地（去空白、台／臺）、交通方式、抵達時間（狀態由判斷層定）；
 * 附近類工具看座標（約 100 公尺內算同一處；模型沒給座標＝現在位置）。其他工具不沿用。
 */
export function callKey(name, args = {}, here = null) {
  if (name === 'plan_trip') {
    // 起點也要比（規則抽到的起點若跟模型的不同，不能沿用；PR #34 審查）
    const pt = (v) => (typeof v === 'string' ? normName(v.replace(/\s/g, '')) : v ? `${(+v.lat).toFixed(3)},${(+v.lon).toFixed(3)}` : '');
    return `plan_trip|${pt(args.from)}|${pt(args.to)}|${args.prefs?.mode || ''}|${args.prefs?.arriveBy || ''}|${[...(args.prefs?.avoid || [])].sort().join(',')}|${args.prefs?.party || ''}`;
  }
  if (name === 'thsr_timetable' || name === 'tra_timetable') { // 時刻表：起訖站＋日期（預先查詢用最近車站時，以實際起站另存一把鑰匙）
    return args.from && args.to ? `${name}|${normName(args.from)}|${normName(args.to)}|${args.date || ''}` : null;
  }
  if (name === METRO_NEAR) { // 沒給站名＝最近的站（看 near，沒給 near＝現在位置）；有站名不沿用
    if (args.station) return null;
    const p = args.near && typeof args.near === 'object' ? args.near : here;
    const where = typeof args.near === 'string' ? args.near.replace(/\s/g, '') : p ? `${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}` : null;
    return where ? `${name}|${where}|${lineCode(args.line) || ''}` : null;
  }
  if (name === 'outing_advice' && args.place) return `${name}|${normName(String(args.place).replace(/\s/g, ''))}`;
  if (Object.values(NEARBY_TOOL).includes(name) || name === 'weather_tomorrow' || name === 'outing_advice') { // 出門建議：模型再查同一點就沿用（不再出第二張卡）
    const lat = args.lat ?? here?.lat, lon = args.lon ?? here?.lon;
    return lat == null ? null : `${name}|${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;
  }
  return null;
}

/**
 * 模型給的 plan_trip prefs → 只留使用者說過的抵達時間、交通方式、不要的方式（規則從這句或前文抽到的；判斷層的 mode）。
 * 狀態也只採判斷層或規則的（沒有判斷層時模型自加的狀態也丟掉；有判斷層時 execTools 另以 judgedStates 為準）。
 * 習慣（habit）一律丟掉：只採用手機送來的 userState.habit（execTools 帶入）。
 */
export function groundedPrefs(prefs = {}, it = {}, j = null) {
  const { arriveBy: _arriveBy, mode: _mode, states: _states, avoid: _avoid, party: _party, habit: _habit, ...rest } = prefs; // habit 由 execTools 從手機帶入
  const said = { arriveBy: it.arriveBy || null, mode: it.mode || j?.mode || null, states: j?.states || it.states || [], avoid: it.avoid || [], party: it.party || null };
  return { ...rest, ...(said.arriveBy && { arriveBy: said.arriveBy }), ...(said.mode && { mode: said.mode }), ...(said.avoid.length && { avoid: said.avoid }), ...(said.states.length && { states: said.states }), ...(said.party && { party: said.party }) };
}

/** 兩點在 400 公尺內（同一個目的地） */
export const sameSpot = (a, b) => Number.isFinite(a?.lat) && Number.isFinite(b?.lat) && Math.abs(a.lat - b.lat) < 0.004 && Math.abs(a.lon - b.lon) < 0.004;

/** 地名相同（「松山機場」與「臺北松山機場」算同一個；只比 3 個字以上的名字） */
export const sameName = (a, b) => {
  const n = (v) => normName(String((typeof v === 'string' ? v : v?.name) || '').replace(/\s/g, ''));
  const x = n(a), y = n(b);
  if (x.length < 3 || y.length < 3) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length / long.length >= 0.6; // 「台北車站」與「台北車站東三門」不算同一個
};

/** 地端模型模式改由規則回答的意圖（資料查一次、照實報數字） */
export const RULE_ANSWERS = new Set(['fuel', 'invoice', 'stock', 'quake', 'drama', 'traffic', 'gov']); // drama：找短劇（排行、類型搜尋）規則就聽得懂；traffic：國道路況（起訖由規則抽，沒有起訖先問，S7）
/**
 * 地端模型模式改由規則回答的情況（P4、P5 模型模式）：查一次就報數字的生活資料、說了站名的捷運下一班、
 * 一句問好幾件事（規則已經拆好）、沒說哪一站的「去火車站」、禮貌話、只有標點。
 * 規則聽得懂、而小模型常常漏查或答非所問的，才交給規則；其他照常由模型回答。
 */
export function ruleFirst(it, text = '') {
  if (!it) return false;
  if (RULE_ANSWERS.has(it.intent)) return true;
  if (it.thanks || it.sorry || it.help) return true; // 問阿幫能做什麼：規則列出能查的東西，不交給模型（模型常順著前文接著排行程）
  if (!/[\p{L}\p{N}]/u.test(String(text))) return true; // 只有標點、空白或表情符號
  if (it.also?.length) return true;
  if (it.intent === 'trip' && it.nearRail && !it.to) return true;
  if (it.intent === 'metro' && it.station) return true;
  return false;
}

/** 行程的座標比對鍵（起訖點座標到小數 3 位＋方式＋抵達時間） */
export const tripKey = (from, to, prefs = {}) => (Number.isFinite(from?.lat) && Number.isFinite(to?.lat)
  ? `plan_trip@${from.lat.toFixed(3)},${from.lon.toFixed(3)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}|${prefs?.mode || ''}|${prefs?.arriveBy || ''}|${[...(prefs?.avoid || [])].sort().join(',')}|${prefs?.party || ''}` : null);

/** 選公車後自動盯的到站結果，接在 plan_trip 結果後面給模型（卡片已顯示；請模型主動問要不要到站提醒） */
export const followUpText = (f, walkMin) => (!f ? '' : BUS_OFF[f.data?.focus?.status]
  // 保底：盯到的是今天不會來（今日未營運、末班已過、交管不停靠）→ 不推這班、不問到站提醒
  ? `\n［內部備註，不要照抄這段文字］上車站即時到站已查好：${f.speak}這班公車不會來：回答時照實說「公車 ${f.data.routeName} ${BUS_OFF[f.data.focus.status].why}」，不要建議坐這班、不要問到站提醒；改推行程結果裡排除這班公車後分數最高的方案（大眾運輸優先，照 ranking 的順序，跳過這班），不要推被標「太久」「不划算」的步行或叫車。`
  : f ? `\n［內部備註，不要照抄這段文字］上車站即時到站已查好：${f.speak}${walkMin != null ? `從起點走到這個上車站約 ${walkMin} 分（不是全程步行時間）。` : ''}已用公車卡片即時顯示；回答時用自己的話說公車多久到上車站；若走到站牌的時間比車到還久，說這班可能趕不上；並問使用者要不要在卡片上按「到站前 3 分提醒我」。` : '');
const ITEM = /^\s*-\s/;

/**
 * 回填給模型的工具結果文字（AGENT.md §4）：有卡片的工具，清單只留前幾筆並註明「已用卡片顯示」，
 * 讓模型只講重點、不逐條重抄（地端小模型尤其會照抄，回答又長又慢）。沒有卡片的工具照原文。
 * @param {{ text?: string, speak?: string|null, card?: string|null }} result callTool() 的結果
 */
export function modelText(result) {
  const text = result.text || result.speak || FALLBACK.empty;
  if (!result.card || !result.text) return text;
  const lines = text.split('\n');
  const total = lines.filter((l) => ITEM.test(l)).length;
  if (total <= MODEL_LIST_MAX) return `${text}\n（以上已用卡片顯示給使用者；回答只講重點，不要逐條重複）`;
  let kept = 0;
  const out = lines.filter((l) => !ITEM.test(l) || kept++ < MODEL_LIST_MAX);
  return [result.speak, ...out, `…（共 ${total} 筆，這裡只列前 ${MODEL_LIST_MAX} 筆；完整清單已用卡片顯示給使用者，回答不要逐條列出）`].filter(Boolean).join('\n');
}

/** 模型常把沒填的選填欄位送成 null 或空字串（尤其地端小模型）；一律視為沒給，交給 zod 用預設值 */
export function dropNulls(v) {
  const blank = (x) => x === null || (typeof x === 'string' && !x.trim());
  if (Array.isArray(v)) return v.filter((x) => !blank(x)).map(dropNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => !blank(x)).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

/**
 * 判斷層有把握時，地端模型只看這個意圖會用到的工具（實驗：30 個工具小模型容易選錯、提示詞也長）。
 * trip 與 unknown 不縮減。Claude 等大模型照常看全部工具。
 */
export const INTENT_TOOLS = {
  gov: ['gov_service_info'],
  bus_route: ['bus_route_eta', 'bus_search_routes', 'bus_station_eta', 'bus_nearby_stations', 'find_place'],
  youbike: ['youbike_nearby', 'find_place'],
  nearby_bus: ['bus_nearby_stations', 'bus_station_eta', 'find_place'],
  metro: ['metro_live_board', 'metro_route', 'metro_stations', 'find_place'],
  rail: ['thsr_timetable', 'tra_timetable', 'rail_stations', 'rail_fare', 'rail_booking_link'],
  weather: ['weather_now', 'weather_tomorrow', 'outing_advice', 'find_place'],
  aqi: ['aqi_nearby', 'outing_advice', 'find_place'],
  quake: ['earthquake_recent'],
  pharmacy: ['pharmacy_search'],
  garbage: ['garbage_truck_nearby', 'find_place'],
  fuel: ['fuel_price'],
  invoice: ['invoice_lottery'],
  stock: ['stock_quote'],
  traffic: ['traffic_status', 'find_place'],
  drama: ['drama_picks', 'drama_search', 'drama_series'],
  // 2026-11-23 新意圖（阿幫會的每一件事都有意圖）
  intercity: ['intercity_bus', 'plan_trip', 'find_place'],
  ridehail: ['ridehail_link', 'plan_trip', 'find_place'],
  booking: ['rail_booking_link', 'thsr_timetable', 'tra_timetable', 'rail_stations', 'rail_fare'],
  place: ['find_place', 'plan_trip'],
  outing: ['outing_advice', 'weather_now', 'aqi_nearby', 'find_place'],
  exercise: ['outing_advice', 'weather_now', 'aqi_nearby', 'find_place'],
};
/** 不查資料、程式固定回答的意圖（判斷層有把握、規則聽不懂時）：詐騙請到防詐檢查、提醒與設定說在哪裡設、緊急求助先給電話 */
export const FIXED_REPLY_INTENTS = ['scam', 'reminder', 'settings', 'emergency'];

/** profile 的工具 → 模型看的工具定義（registry 產生，ADR-0002）；only＝只給這些（判斷層縮減） */
export function toolDefs(profile, { deviceLocation: withLocation = false, only } = {}) {
  const names = only ? profile.tools.filter((n) => only.includes(n)) : profile.tools;
  const defs = (names.length ? names : profile.tools).map((n) => {
    const d = describeTool(getTool(n));
    const { $schema, ...schema } = d.inputSchema; // eslint-disable-line no-unused-vars
    return { name: d.name, description: `${d.title}：${d.description}`, schema };
  });
  return withLocation ? [...defs, DEVICE_LOCATION_TOOL] : defs;
}

/** 「要幫你叫車嗎？」「要幫你訂票嗎？」這類追問（地端小模型常在 YouBike、票價、班次後面亂加，真實資料健檢） */
const OFFER = /^(?:請問)?(?:你|您)?(?:還)?(?:要不要|需要|要)(?:我|阿幫)?(?:幫(?:你|您))?(?:(?:叫|預約)(?:一台|一輛)?(?:計程)?車|叫\s*uber|(?:預)?訂(?:購)?(?:高鐵|台鐵|臺鐵|火車)?(?:車)?票|買(?:車)?票)(?:嗎|呢)?[？?]?$/i;
/**
 * 拿掉不相關的叫車、訂票追問：只有這一輪就是叫車（建議或指定叫車）才留叫車；只有使用者要訂票、或建議高鐵台鐵才留訂票。
 * 句子照標點切，整句是追問才拿掉；全部都是追問就不動（不留空白回答）。
 */
export function dropStrayOffers(text, trip = null, it = null) {
  const best = trip?.options?.find((o) => o.id === trip.best);
  const rideOk = it?.mode === 'ridehail' || best?.role === 'ridehail';
  const bookOk = (it?.intent === 'rail' && it.book) || ['thsr', 'tra'].includes(best?.role);
  const parts = String(text).split(/(?<=[。！？!?])/);
  const keep = parts.filter((p) => { const t = p.trim(); if (!OFFER.test(t)) return true; return /車(?!票)|uber/i.test(t) && !/票/.test(t) ? rideOk : bookOk; });
  return keep.join('').trim() ? keep.join('').trim() : text;
}

/**
 * 模型漏講的重點由程式補上（地端小模型常省略；模型模式情境 S10、S12-11）：
 * 照你說的改了交通方式 → 開頭先說「照你說的選…」；深夜公車收班或接近末班 → 補一句。
 */
export function mustSay(text, trip, it = null) {
  if (!text) return text;
  let out = dropStrayOffers(text, trip, it);
  // 訂票（「幫我訂明天的高鐵票」）：阿幫只給官方連結（ADR-0011；P2-10）
  if (it?.intent === 'rail' && it.book && !/官方/.test(out)) out = `${out}${/[。！？]$/.test(out) ? '' : '。'}訂票請按卡片上的官方訂票連結，在${it.system === 'THSR' ? '高鐵' : '台鐵'}官網或 App 完成（阿幫不代訂、不付款）。`;
  if (it?.intent === 'weather' && it.tomorrow && !/明天|明日|明早|明晚/.test(out)) out = `明天的天氣：${out}`; // 問明天要講明天（S1-3：小模型常只說「會下雨」）
  // 明天（或後天）出發的行程、模型沒說是哪一天：開頭補上（P5-2 模型模式；「改成明天早上8點出發」）
  const days = it?.departDays ?? (it?.tomorrow ? 1 : 0);
  if (it?.intent === 'trip' && days > 0 && !/明天|後天|明早|明晚|明日/.test(out)) out = `${days === 2 ? '後天' : '明天'}${it.departTime ? ` ${it.departTime}` : ''} 出發：${out}`;
  if (!trip) return out;
  const picked = trip.options?.find((o) => o.id === trip.best)?.name;
  // 程式排序時用了使用者指定的方式（ranking.reason 這樣開頭）、模型沒說到 → 開頭補一句（不帶分數）
  if (picked && /^照你說的/.test(trip.ranking?.reason || '') && !/(照|依|按)你(所)?說|你說要/.test(out)) out = out.includes(picked) ? `照你說的，${out}` : `照你說的選「${picked}」。${out}`; // 已講到方案名稱：只加「照你說的，」
  // 建議叫車：付款在叫車 App（阿幫不代付；P2-10）
  const rideShown = trip.best === 'ridehail' || (it?.mode === 'ridehail' && !trip.modeUnavailable && trip.options?.some((o) => o.role === 'ridehail')); // 卡片上真的有叫車
  if (rideShown && !/付款在叫車|叫車 ?App.{0,8}付款/.test(out)) out = `${out}${/[。！？]$/.test(out) ? '' : '。'}${/「叫車」|叫車 ?App|官方 ?App/.test(out) ? '' : '按卡片上的「叫車」用官方 App 叫車，'}付款在叫車 App 完成（阿幫不代付）。`; // 模型已經說了按叫車：只補付款（不重複，2026-11-21 實機）
  const dated = it?.intent === 'trip' && Boolean(it.departTime || it.tomorrow); // 使用者說了幾點／明天：不重複「00:10 出發」，也不講合成的出發時間
  const night = nightNote(trip, { bare: dated });
  // 深夜一句（plan_trip 的 night）：第一句就說（使用者才知道公車、捷運為什麼不在）；舊資料只有 skipped 時補在後面
  if (night && !/收班|末班/.test(out)) {
    const lead = /^(明天|後天)[^：]*出發：/.exec(out)?.[0] || ''; // 「明天 00:10 出發：」後面接深夜那句
    out = trip.night?.text ? `${lead}${night}${out.slice(lead.length)}` : `${out}${/[。！？]$/.test(out) ? '' : '。'}${night}`;
  }
  return out;
}

/**
 * @param {object} svc createServices() 的結果
 * @param {object} body /api/v1/agent 的請求（會驗證）
 * @param {(e: object) => void} emit
 * @param {{ provider: Provider, profileId?: string, now?: number, onModelCall?: () => void }} opts
 */
export async function runModel(svc, body, emit0, { provider, profileId = 'life', now = Date.now(), onModelCall = () => {}, judge }) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  // 手機上的 AI 提議的題目（ADR-0020）：模型模式也由程式驗證後採用；done 帶 askCheck
  const dask = profile.id === 'life' ? deviceAskTracker(req.deviceJudge?.ask, isEnglish(req.messages.at(-1).content) ? 'en' : 'zh') : null;
  const emit = withAskCheck(emit0, dask);
  const picked = req.userState?.picked || [];
  const canLocate = !!req.clientTools?.includes(DEVICE_LOCATION_TOOL.name);
  // 判斷層：先用快速版（A＋規則，幾毫秒）說聽懂了什麼，不用等 loading；完整版（含模型）定案狀態與工具範圍
  const jc = judgeCalls(judge, req, profile);
  const last = req.messages.at(-1).content;
  // 地端小模型的英文不穩（漏英文地名、句型亂，模型模式情境 S12 九個沒過）：英文提問改用規則回答（與示範模式同一套英文總結；Claude 照常）
  if (provider.mode === 'local' && isEnglish(last)) return runDemo(svc, body, emit0, { profileId, now, judge, mode: 'rules' });
  // 查一個數字就答的生活資料（油價、發票、股市收盤、地震）：規則聽得懂就由規則查、程式回答（地端小模型常不查或漏講日期、縣市，P4 模型模式 4 個沒過）
  if (provider.mode === 'local' && profile.id === 'life' && !safetyCheck(last, { profileId: profile.id }) && ruleFirst(parseIntent(last, { history: req.messages.slice(0, -1), saved: req.savedPlaces, now }), last)) return runDemo(svc, body, emit0, { profileId, now, judge, mode: 'rules' });
  const q0 = jc ? await jc.quick() : null;
  emit(ev.status({ mode: provider.mode, model: provider.model, profile: profile.id, judge: judgeInfo(q0), lang: isEnglish(last) ? 'en' : 'zh' }));
  // 安全情境（S18）：自傷或緊急狀況不交給模型自由回答，固定給求助電話（與示範模式相同）
  const safe = safetyCheck(last, { profileId: profile.id }); // 安全情境在請定位之前就回答，不會有帶定位的重送
  if (safe) { emit(ev.guardrail({ tier: 'L0', rule: `safety:${safe.kind}`, calls: safe.calls })); emit(ev.text(safe.reply)); emit(ev.done()); return; }
  // 規則先解析一次（含常用地點）：重來、聽懂了什麼、沒設定常用地點都用同一個結果
  const rulesIt = parseIntent(last, { history: req.messages.slice(0, -1), saved: req.savedPlaces, now });
  if (!req.clientToolResults?.length && rulesIt.reset) emit(ev.contextReset());
  if (rulesIt.intent === 'savedMissing' || (profile.id === 'life' && ((rulesIt.intent === 'weather' && rulesIt.later) || (rulesIt.intent === 'limits' || rulesIt.intent === 'access' || rulesIt.intent === 'scamAsk')))) { // 要阿幫代按、代付：固定說明只給官方連結（ADR-0011） // 「回家」但沒設定家、問後天以後的天氣：不給模型猜（模型會拿現在的天氣充數），直接照實說
    if (rulesIt.intent === 'scamAsk') emit(ev.ask({ id: 'ask-m1', ...scamPasteAsk('life', rulesIt.lang, last, { pasted: !!rulesIt.pasted }) })); // 生活阿幫被問詐騙：請他到防詐貼上（PM Q-23）
    emit(ev.text(demoSummary(rulesIt, {})));
    emit(ev.done());
    return;
  }
  // 加到行事曆、分享（ADR-0021）：程式回答＋動作選項（與示範模式相同；不交給模型）
  const dRules = profile.id === 'life' ? deviceIntent(rulesIt) : null;
  if (dRules) { const r = deviceActionReply(dRules, req, rulesIt.lang); if (r.ask) emit(ev.ask({ id: 'ask-m1', ...r.ask })); emit(ev.text(r.text)); emit(ev.done()); return; }
  // 缺必要欄位（哪一路公車、要去哪裡）：程式問一句，不交給模型猜（ADR-0016，與示範模式相同）
  const ruleGap = profile.id === 'life' && (slotAsk(rulesIt, { lang: rulesIt.lang, history: req.messages.slice(0, -1) }) || askFirst(rulesIt, { history: req.messages.slice(0, -1), at: req.clientTools?.includes(DEVICE_LOCATION_TOOL.name) ? deviceLocation(req) || null : null })); // 路名、只說類別、認不得的名字、沒說迄站（PM Q 情境）也先問
  const gap = ruleGap && (deviceSlotAsk(dask, ruleGap.ask.about.replace(/^slot:/, ''), ruleGap, { history: req.messages.slice(0, -1), context: req.context }) || ruleGap); // 手機的題目通過驗證就用它（ADR-0020）
  if (gap) { emit(ev.ask({ id: 'ask-m1', ...gap.ask })); emit(ev.text(gap.short)); emit(ev.done()); return; }
  // 帶定位結果重送的是同一輪（客戶端接在同一個討論串）：「聽懂了什麼」上一次已經說過，不重複
  const heard = !req.clientToolResults?.length && (contextNote(rulesIt) || (rulesIt.intent === 'outing' ? outingNote([...(rulesIt.states || []), ...(q0?.states || [])]) : q0 && judgeNote(q0)));
  if (heard && rulesIt.lang !== 'en') emit(ev.agentNote(heard)); // 「聽懂了」是中文：英文提問不說
  const j = jc ? await jc.full(q0) : null;
  // 「會下雨嗎」是在問（P2-4）：判斷層聽成「正在下雨」就拿掉
  if (j?.states?.includes('rain') && !rulesIt.states?.includes('rain') && rainAsked(last)) j.states = j.states.filter((x) => x !== 'rain');
  const more = !req.clientToolResults?.length && moreStatesNote(q0, j);
  if (more && rulesIt.lang !== 'en') emit(ev.agentNote(more));
  const sure = j && (j.source === 'llm' || j.source === 'device' || (j.confidence ?? 0) >= 0.8); // 模型判斷（伺服器 B 或手機上的模型，ADR-0014）或 A 有把握
  // 詐騙、提醒、設定、緊急求助：規則聽不懂但判斷層有把握時，程式固定回答（不交給模型自由發揮；跟示範模式同一套說法）
  if (profile.id === 'life' && sure && rulesIt.intent === 'unknown' && deviceIntent(j)) { const r = deviceActionReply(j.intent, req, rulesIt.lang); if (r.ask) emit(ev.ask({ id: 'ask-m1', ...r.ask })); emit(ev.text(r.text)); emit(ev.done({ modelCalls: 0, inputTokens: 0, outputTokens: 0 })); return; } // 判斷層聽出加行事曆／分享、規則沒聽出來
  if (profile.id === 'life' && sure && rulesIt.intent === 'unknown' && FIXED_REPLY_INTENTS.includes(j.intent)) {
    const fit = parseIntent(last, { history: req.messages.slice(0, -1), intent: j.intent, saved: req.savedPlaces, now }) || rulesIt;
    if (fit.intent === 'scamAsk') emit(ev.ask({ id: 'ask-m1', ...scamPasteAsk('life', fit.lang, last, { pasted: !!fit.pasted }) }));
    emit(ev.text(demoSummary(fit, {})));
    emit(ev.done({ modelCalls: 0, inputTokens: 0, outputTokens: 0 }));
    return;
  }
  // 這句（或接著改的上一輪）沒說起點 → 起點是現在位置（下面呼叫 plan_trip 時由程式帶入）
  const hereIsOrigin = rulesIt.intent === 'trip' && !rulesIt.from && !rulesIt.fromSaved;
  // 需要現在位置（沒說起點的行程、沒說地點的天氣／YouBike／附近公車／垃圾車／公車到站）→ 問模型之前就先請 App 定位，
  // 再把位置直接告訴模型（地端模型常常不呼叫 device_location，直接反問「你在哪裡」）
  const NEARBY_INTENTS = ['weather', 'aqi', 'youbike', 'nearby_bus', 'garbage', 'bus_route', 'pharmacy'];
  const namedArea = rulesIt.intent === 'pharmacy' && rulesIt.area; // 「大安區的藥局」：不用位置
  // 「垃圾車幾點會到我家這邊」：用常用地點的座標（手機送來的），不用現在位置、也不必先定位（P3-2）
  const atSaved = rulesIt.savedAt && Number.isFinite(rulesIt.fromPoint?.lat) && [...NEARBY_INTENTS, 'outing'].includes(rulesIt.intent);
  const wantHere = canLocate && !namedArea && !atSaved && (hereIsOrigin || (!rulesIt.places?.length && (needsLocation(rulesIt) || NEARBY_INTENTS.includes(j?.intent) || j?.intent === 'trip')));
  const here = atSaved ? { lat: rulesIt.fromPoint.lat, lon: rulesIt.fromPoint.lon, name: rulesIt.lang === 'en' ? 'your saved place' : `你的${rulesIt.savedAt}` } : canLocate ? deviceLocation(req) : null;
  if (wantHere && here === undefined) {
    emit(ev.agentNote(rulesIt.lang === 'en' ? '@定位 checking where you are' : '@定位 先看看你在哪裡'));
    emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
    emit(ev.done({ modelCalls: 0, inputTokens: 0, outputTokens: 0 }));
    return;
  }
  const locationHint = atSaved ? `使用者問的是他的常用地點「${rulesIt.savedAt}」附近，座標 ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}：天氣、空品、YouBike、附近公車、垃圾車、藥局都用這個 lat/lon；不是他現在的位置，也不要再問他在哪裡。` : here ? `使用者現在在 ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}（手機定位）。使用者沒說起點或地點時就用這個位置：plan_trip 的 from 用 { lat, lon, name: "你的位置" }，天氣、空品、YouBike、附近公車、垃圾車用這個 lat/lon；不要再問他在哪裡。` : '';
  // 地端小模型只給這個意圖用得到的工具：規則聽得懂就照規則（P2：判斷層把「來得及去台北車站嗎」聽成查高鐵）
  //   行程：工具不縮減，但拿掉查時刻表（程式已經比較好路線，模型自己去查高鐵班次會答非所問）
  const only0 = provider.mode !== 'local' ? undefined
    : rulesIt.intent === 'trip' ? (!/^(thsr|tra)$/.test(rulesIt.mode || '') ? profile.tools.filter((x) => !/_timetable$/.test(x)) : undefined)
      : INTENT_TOOLS[rulesIt.intent] || (sure ? INTENT_TOOLS[j.intent] : undefined);
  const only = only0 && rulesIt.intent === 'outing' && !only0.includes('outing_advice') ? [...only0, 'outing_advice'] : only0;

  let n = 0;
  const nextId = () => `t${++n}`;
  const used = new Set();
  let lastTrip = null; // 這一輪最後一次比較的行程（總結補上程式知道、模型漏講的重點）
  const ask = { done: false, habitAsk: req.userState?.habitAsk, usual: req.userState?.usual, device: dask }; // 阿幫問你：這一輪最多一個（ADR-0016；device：手機提議的狀態題，ADR-0020）
  const aside = asideState(req, profile, now, svc); // 等車推短劇（ADR-0019）：這一輪最多一次（排行先並行拿）
  // 有現在位置時，程式先用它查好（不靠模型）：地端模型常常只查了目的地就反問「你從哪裡出發」。
  //   沒說起點的行程 → plan_trip（起點＝現在位置）；沒說地點的天氣／空品／YouBike／附近公車／垃圾車 → 對應工具（現在位置）
  // 結果照常出現在討論串與卡片，再交給模型轉述（AGENT.md §5.2.1）
  // 出發時間＝現在（測試與示範時鐘可指定；深夜末班車判斷）
  // 說了地點的附近查詢（「那裡會下雨嗎」「那板橋車站那邊呢」）：程式先找到地點再查（與示範模式一樣，不靠模型記得先 find_place）
  const placePt = rulesIt.places?.[0] && PLACE_TOOL[rulesIt.intent] && !(rulesIt.intent === 'pharmacy' && rulesIt.area) ? await resolvePoint(svc.places, rulesIt.places[0]).catch(() => null) : null;
  const pre = prefetchCalls(rulesIt, j, here || null, placePt).map((c) => (c.name === 'plan_trip' && !c.args.departAt ? { ...c, args: { ...c.args, departAt: tripDepartAt(rulesIt, now) } } : c)); // 與示範模式同一個出發時間（明天用明天早上）
  let prefetched = '';
  const placeDone = new Map(); // 使用者說了地點（「那邊有 YouBike 嗎」）時程式已查好的附近資料：模型改用現在位置再查也沿用（P4-6）
  const turnTrips = []; // 這一輪已經出過的行程卡（同起點、同目的地、同方式只出一張：模型換個說法再查也沿用）
  const preDone = new Map(); // 呼叫鍵（工具＋關鍵參數）→ 給模型的文字：模型用相同參數再呼叫時沿用，不重複產生卡片與決策圖；參數不同照常執行
  if (pre.length) {
    const out = await execTools(svc, pre, emit, { profile, nextId, picked, lang: rulesIt.lang, habit: req.userState?.habit, car: req.userState?.car === true, ask, now, aside, ...(j && { judgedStates: j.states }) });
    const texts = out.map((o, i) => {
      used.add(pre[i].name);
      if (o.followUp || o.watched) used.add('bus_route_eta');
      // 查詢失敗也告訴模型原因（請照實轉述），模型才不會一直重查同一個工具
      const text = o.ok ? (pre[i].note ? `${pre[i].note}\n` : '') + modelText(o.result) + followUpText(o.followUp, o.followWalkMin) : `（${pre[i].name} 查詢失敗：${o.error}。請照實告訴使用者，不要再呼叫同一個工具。）`;
      preDone.set(callKey(pre[i].name, pre[i].args), text);
      if (placePt && o.ok && pre[i].name !== 'find_place') placeDone.set(pre[i].name, text); // 說了地點的附近查詢
      if (o.ok && /^(thsr|tra)_timetable$/.test(pre[i].name)) { // 模型用實際起站再查時沿用（有寫日期、沒寫日期都算）
        for (const date of [undefined, o.result.data.date]) preDone.set(callKey(pre[i].name, { from: o.result.data.from, to: o.result.data.to, date }), text);
      }
      if (o.ok && pre[i].name === 'plan_trip') { lastTrip = o.result.data; turnTrips.push({ from: o.result.data.from, to: o.result.data.to, mode: pre[i].args.prefs?.mode || null, text }); }
      if (o.ok && pre[i].name === 'plan_trip') preDone.set(tripKey(o.result.data.from, o.result.data.to, pre[i].args.prefs), text); // 地名寫法不同（台北松山機場／松山機場）也算同一趟
      return text;
    });
    prefetched = texts.join('\n\n');
  }
  const conv = provider.start({
    system: buildSystemPrompt(profile, { now, context: req.context, picked, locationHint, prefetched }),
    tools: toolDefs(profile, { deviceLocation: canLocate, only }),
    messages: req.messages,
  });
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const en = isEnglish(last);
  const finish = (text, fromModel = false) => {
    if (used.size) emit(ev.discussionEnd({ tools: [...used] }));
    emit(ev.text(guardedText(profile, fromModel && !en ? mustSay(text, lastTrip, rulesIt) : text, emit))); // 程式補重點只補模型寫的中文回答（不補到英文、退回說明） // L2 輸出護欄（防詐：不保證安全、固定附 165）
    emit(ev.done(usage));
  };

  for (let round = 0; ; round++) {
    onModelCall();
    const turn = await conv.next().catch((e) => { throw asModelError(e); });
    usage.modelCalls++;
    usage.inputTokens += turn.usage.input;
    usage.outputTokens += turn.usage.output;
    const text = turn.text.trim();
    if (turn.stop === 'refusal') return finish(FALLBACK.refusal);
    if (!turn.calls.length) {
      if (turn.stop === 'max_tokens') return finish(text ? `${text}…（${FALLBACK.truncated}）` : FALLBACK.truncated);
      return text ? finish(text, true) : finish(FALLBACK.empty);
    }
    if (turn.stop === 'max_tokens') return finish(FALLBACK.truncated); // 工具參數可能被截斷，不執行
    if (round >= MAX_TOOL_ROUNDS) return finish(FALLBACK.rounds); // 第 6 輪還要查 → 不再呼叫工具
    if (text) emit(ev.agentNote(hideToolNames(text))); // 中間的話也不露出工具英文名稱

    /** @type {Map<string, { content: string, isError?: boolean }>} */
    const results = new Map();
    // 裝置定位：還沒有結果 → 請客戶端定位後重送（與示範模式相同的協定，AGENT.md §3.4）
    const locCalls = turn.calls.filter((c) => c.name === DEVICE_LOCATION_TOOL.name);
    if (locCalls.length) {
      const loc = canLocate ? deviceLocation(req) : null;
      if (loc === undefined) {
        emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
        emit(ev.done(usage));
        return;
      }
      for (const c of locCalls) results.set(c.id, loc ? { content: JSON.stringify(loc) } : { content: FALLBACK.noLocation, isError: true });
    }
    for (const c of turn.calls) if (!results.has(c.id) && c.bad !== undefined) results.set(c.id, { content: `參數不是有效的 JSON：${c.bad}`, isError: true });

    // 起點交給程式（不交給模型）：使用者沒說起點（「去台北 101」、接著改而上一輪也沒說）→ plan_trip 的起點一律是手機定位。
    // 地端小模型常把目的地也填成起點（台北101 → 台北101），這裡直接改掉；還沒定位就先請客戶端定位。
    const trips = turn.calls.filter((c) => c.name === 'plan_trip' && !results.has(c.id));
    // 使用者說過起點（這句或前文，例：「從西門町去台北101」→「改坐公車」→「我很趕」）：起點照他說的，模型不能換成現在位置
    if (trips.length && rulesIt.intent === 'trip' && (rulesIt.from || rulesIt.fromSaved)) for (const c of trips) c.input = { ...c.input, from: rulesIt.fromSaved || rulesIt.from };
    if (trips.length && rulesIt.intent === 'trip' && rulesIt.toSaved) for (const c of trips) c.input = { ...c.input, to: rulesIt.toSaved }; // 「回家」：目的地是存在手機的家
    if (trips.length && hereIsOrigin) {
      const loc = here;
      if (loc === undefined) {
        emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
        emit(ev.done(usage));
        return;
      }
      for (const c of trips) {
        // 拒絕定位：與預先查詢相同，先從預設起點算（模型照備註說明、請使用者說起點）
        c.input = { ...c.input, from: loc ? { lat: loc.lat, lon: loc.lon, name: loc.name } : DEFAULT_FROM };
      }
    }

    // 轉述受程式約束（A2）：抵達時間、交通方式只採使用者說過的（規則抽到的），模型自己加的丟掉
    //（地端模型曾自加 arriveBy，結果「所有方式都趕不上指定時間」，2026-11-21 實機）
    for (const c of turn.calls) {
      if (c.name !== 'plan_trip' || !c.input) continue;
      for (const k of ['from', 'to']) { // 小模型常給 { name: "松山機場" } 沒有座標：當地名（才比得出是同一趟）
        const v = c.input[k];
        if (v && typeof v === 'object' && !(Number.isFinite(v.lat) && Number.isFinite(v.lon)) && typeof v.name === 'string' && v.name.trim()) c.input = { ...c.input, [k]: v.name.trim() };
      }
      const prefs = groundedPrefs(c.input.prefs || {}, rulesIt, j); // 模型沒給 prefs 也補上使用者說過的（與預先查詢一致）
      c.input = { ...c.input, ...(Object.keys(prefs).length ? { prefs } : {}) };
      if (!Object.keys(prefs).length) delete c.input.prefs;
    }

    // 已由程式依現在位置查好的工具：模型再呼叫就沿用結果（避免同一張卡片、決策圖出現兩次）
    for (const c of turn.calls) {
      if (results.has(c.id)) continue;
      let k = callKey(c.name, c.input, here);
      // 行程：文字不同時比座標（地名寫法不同、加了「站」）
      if (c.name === 'plan_trip' && !(k && preDone.has(k)) && c.input?.to) {
        const [f, t] = await Promise.all([c.input.from, c.input.to].map((x) => (x ? resolvePoint(svc.places, x).catch(() => null) : null)));
        if (f && t) k = tripKey(f, t, c.input.prefs);
      }
      if (k && preDone.has(k)) results.set(c.id, { content: `（已查好，結果同上）\n${preDone.get(k)}` });
      else if (placeDone.has(c.name)) results.set(c.id, { content: `（使用者問的是「${placePt.name || rulesIt.places[0]}」那裡，已查好，結果同上；不是他現在的位置）\n${placeDone.get(c.name)}` });
      // 同一輪、同一個目的地已經有行程卡：模型換了起點寫法或條件再查也不出第二張（使用者這一句只問一趟；要改條件會再說）
      else if (c.name === 'plan_trip' && turnTrips.length && c.input?.to) {
        const [f, t] = await Promise.all([c.input.from, c.input.to].map((x) => (x ? resolvePoint(svc.places, x).catch(() => null) : null)));
        // 小模型有時給對的地名、錯的座標：地名相同也算；起點或指定的方式不同（「從板橋呢」「坐公車還是叫車」）照常查
        const same = (x, pt, ref) => sameSpot(pt, ref) || sameName(x, ref);
        // 起訖點是同一個地方（「台北101 → 台北101」，小模型接回程時常見）：不是新的一趟
        if (sameSpot(f, t) || (c.input.from && sameName(c.input.from, c.input.to))) { results.set(c.id, { content: `（起點和終點是同一個地方，不用再查；這一趟已查好，結果同上）\n${turnTrips.at(-1).text}` }); continue; }
        const hit = turnTrips.find((p) => same(c.input.to, t, p.to) && (!c.input.from || same(c.input.from, f, p.from)) && (c.input.prefs?.mode || null) === p.mode);
        if (hit) results.set(c.id, { content: `（這一趟已查好，結果同上；不要再查）\n${hit.text}` });
      }
    }

    const run = turn.calls.filter((c) => !results.has(c.id));
    const out = await execTools(svc, run.map((c) => ({ name: c.name, args: dropNulls(c.input) })), emit, { profile, nextId, picked, lang: rulesIt.lang, habit: req.userState?.habit, car: req.userState?.car === true, ask, now, aside, ...(j && { judgedStates: j.states }) });
    run.forEach((c, i) => {
      const o = out[i];
      used.add(c.name);
      if (o.ok && c.name === 'plan_trip') { lastTrip = o.result.data; turnTrips.push({ from: o.result.data.from, to: o.result.data.to, mode: c.input?.prefs?.mode || null, text: modelText(o.result) }); preDone.set(tripKey(o.result.data.from, o.result.data.to, c.input?.prefs), modelText(o.result)); } // 模型再用相同條件呼叫也沿用（不出現兩張行程卡；條件不同照常查）
      if (o.followUp || o.watched) used.add('bus_route_eta'); // 選公車後自動盯到站也算一個工具（watched：盯到今天不會來而重排）
      // 回填模型的只有文字摘要（清單截短），不放整包 data（AGENT.md §4）
      results.set(c.id, o.ok ? { content: modelText(o.result) + followUpText(o.followUp, o.followWalkMin) } : { content: o.error, isError: true });
    });
    conv.addResults(turn, turn.calls.map((c) => ({ id: c.id, ...results.get(c.id) })));
  }
}
