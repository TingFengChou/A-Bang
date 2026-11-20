// Agent 事件（M5-02，AGENT.md §3.1）：型別、建立函式與 NDJSON 序列化。Claude 模式與示範模式共用同一套事件。
// 建立函式只組欄位並檢查必要欄位，不做假延遲；數字一律由呼叫端傳入真實資料（ADR-0009）。
import { getTool } from '../tools/index.js';

export const EVENT_TYPES = ['status', 'agent_note', 'tool_start', 'tool_result', 'discussion_end', 'decision', 'guardrail', 'client_tool_call', 'text', 'done', 'error'];

/** 小幫手角色（討論串中被 @ 點名的名字） */
export const TOOL_ROLES = {
  find_place: '地點', plan_trip: '行程', bus_route_eta: '公車', bus_nearby_stations: '公車', bus_station_eta: '公車', bus_search_routes: '公車',
  youbike_nearby: 'YouBike', metro_live_board: '捷運', metro_stations: '捷運', thsr_timetable: '高鐵', tra_timetable: '台鐵', rail_stations: '車站',
  rail_fare: '票價', intercity_bus: '客運', traffic_status: '路況', weather_now: '天氣', rail_booking_link: '訂票', ridehail_link: '叫車',
  aqi_nearby: '空品', earthquake_recent: '地震', pharmacy_search: '藥局', garbage_truck_nearby: '垃圾車', fuel_price: '油價', invoice_lottery: '發票', invoice_check_batch: '發票', stock_quote: '股市',
  scam_check_message: '防詐', scam_lookup_url: '網址', scam_myth_search: '闢謠', sms_sender_check: '號碼',
};

const need = (type, obj, keys) => {
  for (const k of keys) if (obj[k] === undefined) throw new Error(`事件 ${type} 缺少 ${k}`);
  return { type, ...obj };
};

export const ev = {
  status: ({ mode, model, profile }) => need('status', { mode, ...(model && { model }), profile }, ['mode', 'profile']),
  agentNote: (text) => need('agent_note', { text: String(text).slice(0, 60) }, ['text']),
  /** tool_start：title／role／pack／tier 由 registry 帶入 */
  toolStart: ({ id, name, input, server = 'abang' }) => {
    const t = getTool(name);
    return need('tool_start', { id, name, title: t?.title ?? name, role: TOOL_ROLES[name] ?? '小幫手', server, pack: t?.pack ?? null, tier: t?.tier ?? null, input: input ?? {} }, ['id', 'name']);
  },
  /** tool_result：成功時帶 speak／card／data／metrics；失敗時 ok=false＋error（只放可公開的訊息） */
  toolResult: ({ id, result, error }) => (error
    ? need('tool_result', { id, ok: false, error }, ['id'])
    : need('tool_result', { id, ok: true, speak: result.speak ?? null, card: result.card ?? null, ...(result.v && { v: result.v }), tool: result.name, args: result.args, mode: result.mode, data: result.data, metrics: result.metrics }, ['id'])),
  discussionEnd: ({ tools, servers = ['abang'] }) => need('discussion_end', { tools, servers }, ['tools']),
  /** decision：由 plan_trip 的資料組成（含 options 決策欄位，讓前端切換狀態時不必再呼叫伺服器）；signals＝各資料來源的一句重點（決策圖的資料膠囊） */
  decision: (trip) => need('decision', {
    signals: tripSignals(trip),
    states: trip.states, arriveBy: trip.arriveBy ?? null, ...(trip.arriveByMin != null && { arriveByMin: trip.arriveByMin }), best: trip.best,
    options: trip.options, ranked: trip.ranking.ranked, excluded: trip.ranking.excluded, weights: trip.ranking.weights, reason: trip.ranking.reason,
  }, ['states', 'options', 'ranked', 'excluded', 'reason']),
  guardrail: ({ tier, rule }) => need('guardrail', { tier, rule }, ['tier', 'rule']),
  clientToolCall: ({ id, name, input = {} }) => need('client_tool_call', { id, name, input }, ['id', 'name']),
  text: (delta) => need('text', { delta: String(delta) }, ['delta']),
  done: (usage) => ({ type: 'done', ...(usage && { usage }) }),
  error: ({ message, retryable = false, retryAfterSec }) => need('error', { message, retryable, ...(retryAfterSec != null && { retryAfterSec }) }, ['message']),
};

/**
 * 決策圖的資料膠囊：每個資料來源一句真實重點（例：天氣「27°C」或「下雨」、空品「AQI 58」、路況「塞 49 分」）。
 * @returns {Record<string, string>} 角色 → 文字
 */
export function tripSignals(trip) {
  const out = {};
  if (trip.straightKm != null) out['地點'] = `${trip.straightKm} 公里`;
  const w = trip.weather;
  if (w) out['天氣'] = w.raining ? '下雨' : w.pop3h >= 50 ? `雨 ${w.pop3h}%` : (/(-?\d+)°C/.exec(w.summary || '')?.[0] || '天氣');
  if (trip.air?.aqi != null) out['空品'] = `AQI ${trip.air.aqi}`;
  const t = trip.traffic;
  if (t) out['路況'] = !t.covered ? '市區' : t.level === 'jam' ? `塞 ${t.delayMin ?? '?'} 分` : t.level === 'slow' ? '車多' : '順暢';
  return out;
}

/** 一個事件 → NDJSON 的一行 */
export const toNdjson = (e) => `${JSON.stringify(e)}\n`;

/**
 * 狀態合併（AGENT.md §3.2）：user（模型或關鍵字從對話判斷）∪ auto（工具推得）∪ picked（使用者點選），同 key 只留第一個來源。
 * @returns {Array<{ key: string, source: 'auto'|'user'|'picked', from?: string, detail?: string }>}
 */
export function mergeStates({ user = [], auto = [], picked = [] } = {}) {
  const out = [];
  const add = (s) => { if (!out.some((x) => x.key === s.key)) out.push(s); };
  for (const s of auto) add({ ...s, source: 'auto' });
  for (const k of user) add({ key: k, source: 'user' });
  for (const k of picked) add({ key: k, source: 'picked' });
  return out;
}
