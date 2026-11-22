// Agent 事件（M5-02，AGENT.md §3.1）：型別、建立函式與 NDJSON 序列化。Claude 模式與示範模式共用同一套事件。
// 建立函式只組欄位並檢查必要欄位，不做假延遲；數字一律由呼叫端傳入真實資料（ADR-0009）。
import { getTool } from '../tools/index.js';
import { ASK_KINDS, ASK_ACTIONS } from './ask.js';
import { isAppLink, isStoreLink } from '../drama-say.js';

export const EVENT_TYPES = ['status', 'agent_note', 'tool_start', 'tool_result', 'data_note', 'discussion_end', 'decision', 'ask', 'aside', 'guardrail', 'client_tool_call', 'text', 'answer_draft', 'trial', 'done', 'error'];

/** 小幫手角色（討論串中被 @ 點名的名字） */
export const TOOL_ROLES = {
  find_place: '地點', plan_trip: '行程', bus_route_eta: '公車', bus_nearby_stations: '公車', bus_station_eta: '公車', bus_search_routes: '公車',
  youbike_nearby: 'YouBike', metro_live_board: '捷運', metro_stations: '捷運', thsr_timetable: '高鐵', tra_timetable: '台鐵', rail_stations: '車站',
  rail_fare: '票價', intercity_bus: '客運', traffic_status: '路況', weather_now: '天氣', weather_tomorrow: '天氣', outing_advice: '天氣', rail_booking_link: '訂票', ridehail_link: '叫車',
  aqi_nearby: '空品', earthquake_recent: '地震', pharmacy_search: '藥局', garbage_truck_nearby: '垃圾車', fuel_price: '油價', invoice_lottery: '發票', invoice_check_batch: '發票', stock_quote: '股市',
  scam_check_message: '防詐', scam_lookup_url: '網址', scam_myth_search: '闢謠', sms_sender_check: '號碼',
  drama_picks: '短劇', drama_search: '短劇', drama_series: '短劇',
};

const need = (type, obj, keys) => {
  for (const k of keys) if (obj[k] === undefined) throw new Error(`事件 ${type} 缺少 ${k}`);
  return { type, ...obj };
};

export const ev = {
  status: ({ mode, model, profile, judge, lang }) => need('status', { mode, ...(model && { model }), profile, ...(judge && { judge }), ...(lang && { lang: lang === 'en' ? 'en' : 'zh' }) }, ['mode', 'profile']), // lang：這一輪用哪種語言回答（S12g：前端照這個，不自己猜） // judge：判斷層結果（意圖、來源、信心；不含對話內容）
  agentNote: (text) => need('agent_note', { text: String(text).slice(0, 60) }, ['text']),
  /** tool_start：title／role／pack／tier 由 registry 帶入 */
  toolStart: ({ id, name, input, server = 'abang' }) => {
    const t = getTool(name);
    return need('tool_start', { id, name, title: t?.title ?? name, role: TOOL_ROLES[name] ?? '小幫手', server, pack: t?.pack ?? null, tier: t?.tier ?? null, input: input ?? {} }, ['id', 'name']);
  },
  /** tool_result：成功時帶 speak／card／data／metrics；失敗時 ok=false＋error（只放可公開的訊息） */
  toolResult: ({ id, result, error, impact }) => (error
    ? need('tool_result', { id, ok: false, error }, ['id'])
    : need('tool_result', { id, ok: true, speak: result.speak ?? null, card: result.card ?? null, ...(result.v && { v: result.v }), tool: result.name, args: result.args, mode: result.mode, data: result.data, metrics: result.metrics, ...(impact && { impact }) }, ['id'])), // impact：這筆資料對決策的影響（core/agent/impact.js）
  /**
   * data_note：工具內部用到的一項資料（plan_trip 查的天氣、空品、路況）＋對這次判斷的影響，由程式產生（trip-considered.js，不經模型）。
   * parent＝那次工具呼叫的 id（客戶端排在它的發言前面）；mode＝demo 時標「示範資料」；英文那一輪用英文欄位。
   */
  dataNote: ({ parent, item, lang = null }) => {
    const en = lang === 'en';
    return need('data_note', {
      parent, role: item.role, source: item.source, available: item.available, mode: item.demo ? 'demo' : 'live',
      text: en ? item.textEn : item.text, impact: { tone: item.tone, text: en ? item.sayEn : item.say },
      effect: item.effect,
    }, ['parent', 'role', 'text']);
  },
  discussionEnd: ({ tools, servers = ['abang'] }) => need('discussion_end', { tools, servers }, ['tools']),
  /** decision：由 plan_trip 的資料組成（含 options 決策欄位，讓前端切換狀態時不必再呼叫伺服器）；signals＝各資料來源的一句重點（決策圖的資料膠囊） */
  decision: (trip) => need('decision', {
    signals: tripSignals(trip),
    signalsEn: tripSignals(trip, 'en'), // 英文那一輪的資料膠囊（S12f）
    states: trip.states, arriveBy: trip.arriveBy ?? null, ...(trip.arriveByMin != null && { arriveByMin: trip.arriveByMin }), ...(trip.mode && { mode: trip.mode }), ...(trip.avoid && { avoid: trip.avoid }), ...(trip.skipped?.length && { skipped: trip.skipped }), ...(trip.missing?.length && { missing: trip.missing }), ...(trip.night && { night: trip.night }), ...(trip.habit && { habit: trip.habit, habitOn: !!trip.habitOn }), ...(trip.ask && { ask: trip.ask }), best: trip.best,
    considered: trip.considered || [], ...(trip.single && { single: trip.single }), // 決策圖「資料」欄（每個來源一個節點）；只有一種方式時的說明與建議
    options: trip.options, ranked: trip.ranking.ranked, excluded: trip.ranking.excluded, weights: trip.ranking.weights, reason: trip.ranking.reason,
  }, ['states', 'options', 'ranked', 'excluded', 'reason']),
  /**
   * ask：阿幫問你（ADR-0016）——一輪最多一個；題目由手機上的 AI 提議、程式驗證後採用（askSource 'device'，ADR-0020），否則由程式產生（'rule'，core/agent/ask.js）。
   * key：同一題的鍵（客戶端 24 小時內問過就不顯示）；options[]：{ label, kind, guess? }＋依 kind：state { state, source?: 'usual', say? }、reply { say }、store { value }、action { action: { name, ... } }、dismiss
   * pending：{ slot, state?, intent? }＝在等什麼答案（使用者直接打字時客戶端帶 pendingAsk 回來）
   */
  ask: ({ id, question, options, why, about, key, pending, askSource }) => {
    if (!Array.isArray(options) || !options.length || options.length > 6) throw new Error('事件 ask 的 options 要 1～6 個');
    const opts = options.map((o) => {
      if (!ASK_KINDS.includes(o?.kind)) throw new Error(`事件 ask 的 kind 不對：${o?.kind}`);
      const base = { label: String(o.label).slice(0, 20), kind: o.kind, ...(o.guess && { guess: true }) };
      if (o.kind === 'state') { if (!o.state) throw new Error('事件 ask 的 state 選項要有 state'); return { ...base, state: String(o.state), ...(o.source === 'usual' && { source: 'usual' }), ...(o.say && { say: String(o.say).slice(0, 200) }) }; }
      if (o.kind === 'reply') { if (!o.say) throw new Error('事件 ask 的 reply 選項要有 say（完整的一句）'); return { ...base, say: String(o.say).slice(0, 200), ...(['家', '公司', '學校'].includes(o.saved) && { saved: o.saved }) }; } // saved：手機有設定這個常用地點才顯示
      if (o.kind === 'store') { if (!o.value) throw new Error('事件 ask 的 store 選項要有 value'); return { ...base, value: String(o.value).slice(0, 100) }; }
      if (o.kind === 'action') {
        const a = o.action;
        if (!ASK_ACTIONS.includes(a?.name)) throw new Error(`事件 ask 的 action 不對：${a?.name}`);
        if (a.name === 'openLink' && !/^https:\/\//.test(String(a.url))) throw new Error('事件 ask 的 openLink 只能是 https 連結');
        if (a.name === 'navigate' && !/^#\/[a-z0-9/_-]{1,40}$/.test(String(a.to))) throw new Error('事件 ask 的 navigate 只能是 App 內的頁面（#/…）');
        if (a.name === 'handOff') { if (a.agent !== 'antifraud' || typeof a.text !== 'string' || !a.text.trim()) throw new Error('事件 ask 的 handOff 只能帶一句話到防詐'); return { ...base, action: { name: 'handOff', agent: 'antifraud', text: a.text.slice(0, 500) } }; }
        return { ...base, action: a };
      }
      return base;
    });
    return need('ask', { id, question: String(question).slice(0, 120), options: opts, ...(why && { why: String(why).slice(0, 80) }),  ...(about && { about: String(about) }), ...(key && { key: String(key).slice(0, 80) }), ...(pending?.slot && { pending }), askSource: askSource === 'device' ? 'device' : 'rule' }, ['id', 'question']);
  },
  /**
   * aside：卡片下方的小提示（不進回答文字，交通資訊仍是主角）。目前只有 kind 'drama'＝等車推一集短劇（core/agent/wait-drama.js，ADR-0019）；
   * parent＝那次到站工具呼叫的 id（客戶端接在那張卡片下面）；一輪最多一個；連結只收安全的 App 連結與 https 商店頁。
   */
  aside: ({ parent, kind, text, waitMin, mode, data, labels }) => {
    if (kind !== 'drama') throw new Error(`事件 aside 的 kind 不對：${kind}`);
    const store = data?.store && { ios: isStoreLink(data.store.ios) ? data.store.ios : null, android: isStoreLink(data.store.android) ? data.store.android : null };
    return need('aside', {
      parent, kind, text: String(text).slice(0, 120), ...(waitMin != null && { waitMin }), mode: mode === 'live' ? 'live' : 'demo',
      data: { id: String(data.id), title: String(data.title).slice(0, 40), ep: data.ep, freeEpisodes: data.freeEpisodes ?? null, appLink: isAppLink(data.appLink) ? data.appLink : null, store: store && (store.ios || store.android) ? store : null },
      labels: { watch: String(labels?.watch || ''), dismiss: String(labels?.dismiss || ''), note: String(labels?.note || '') },
    }, ['parent', 'kind', 'text']);
  },
  guardrail: ({ tier, rule, calls }) => need('guardrail', { tier, rule, ...(calls?.length && { calls: calls.map((c) => ({ label: String(c.label), tel: String(c.tel).replace(/[^0-9]/g, '') })) }) }, ['tier', 'rule']), // calls：一鍵撥號（安全情境）
  clientToolCall: ({ id, name, input = {} }) => need('client_tool_call', { id, name, input }, ['id', 'name']),
  text: (delta) => need('text', { delta: String(delta) }, ['delta']),
  /** 回答交給手機寫（ADR-0017，請求帶 clientCaps.edgeWrite）：程式版總結＋事實清單；不送 text，手機改寫不過就照 text 顯示程式版 */
  answerDraft: ({ text, facts, lang }) => need('answer_draft', { text: String(text), facts: facts ?? {}, lang: lang === 'en' ? 'en' : 'zh' }, ['text']),
  /** 試判斷（#/ai，請求帶 clientCaps.trial）：判斷結果、資料夠不夠、會查哪些資料來源（core/agent/trial.js，程式算） */
  trial: (info) => need('trial', { ...info }, ['intent', 'slots', 'sources']),
  /** 使用者說「重來」：前面的行程不再沿用（畫面加分隔線、前面的對話變淡） */
  contextReset: () => ({ type: 'context_reset' }),
  done: (usage) => ({ type: 'done', ...(usage && { usage }) }),
  error: ({ message, retryable = false, retryAfterSec }) => need('error', { message, retryable, ...(retryAfterSec != null && { retryAfterSec }) }, ['message']),
};

/**
 * 決策圖的資料膠囊：每個資料來源一句真實重點（例：天氣「27°C」或「下雨」、空品「AQI 58」、路況「塞 49 分」）。
 * @returns {Record<string, string>} 角色 → 文字
 */
export function tripSignals(trip, lang = null) {
  const en = lang === 'en';
  const out = {};
  if (trip.straightKm != null) out['地點'] = en ? `${trip.straightKm} km` : `${trip.straightKm} 公里`;
  const w = trip.weather;
  const temp = /(-?\d+)°C/.exec(w?.summary || '')?.[0];
  if (w) out['天氣'] = w.raining ? (en ? 'Rain' : '下雨') : w.pop3h >= 50 ? (en ? `Rain ${w.pop3h}%` : `雨 ${w.pop3h}%`) : (temp || (en ? 'Weather' : '天氣'));
  if (trip.air?.aqi != null) out['空品'] = `AQI ${trip.air.aqi}`;
  const t = trip.traffic;
  if (t) out['路況'] = en
    ? (!t.covered ? 'Local roads' : t.level === 'jam' ? `+${t.delayMin ?? '?'} min` : t.level === 'slow' ? 'Slow' : 'Clear')
    : (!t.covered ? '市區' : t.level === 'jam' ? `塞 ${t.delayMin ?? '?'} 分` : t.level === 'slow' ? '車多' : '順暢');
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
