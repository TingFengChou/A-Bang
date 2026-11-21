// 「阿幫的腦袋」現場試判斷（#/ai，2026-11-22，產品負責人：「除了意圖狀態外，可以多是否有足夠資料、最後預計回答的內容、下一個預計詢問使用者的內容」）。
// 這裡算「資料夠不夠」：這個意圖需要哪些欄位、哪些從句子聽到了、缺哪些、缺的怎麼補（定位、現在時間、預設），
// 以及會查哪些資料來源、現在是真實資料還是示範資料（為什麼）。全部由程式算（parseIntent 的結果、svc 的模式），不讓模型猜。
// 請求帶 clientCaps.trial 時，/api/v1/agent 在判斷完、查資料前送一個 trial 事件（run.js）；不另開端點、不呼叫任何模型。
import { answerable } from '../suggest.js';
import { needsLocation } from './demo-intent.js';
import { JUDGE_INTENTS } from './judge.js';
import { dataSources } from '../index.js';

/** 欄位 → 從 parseIntent 結果取值（只取名稱與時間，不取座標） */
const nameOf = (x) => (typeof x === 'string' ? x : x?.name ? String(x.name) : null);
const SLOT_VALUE = {
  to: (it, en) => nameOf(it.toSaved) || it.to || (it.nearRail ? (en ? `nearest ${it.nearRail === 'THSR' ? 'HSR' : 'train'} station` : it.nearRail === 'THSR' ? '最近的高鐵站' : '最近的火車站') : null),
  from: (it) => nameOf(it.fromSaved) || it.from || null,
  when: (it, en) => {
    const day = it.departDays ?? (it.tomorrow ? 1 : 0);
    if (it.arriveBy) return en ? `arrive by ${it.arriveBy}` : `${it.arriveBy} 前到`;
    if (it.departTime) return en ? `${['today', 'tomorrow', 'in 2 days'][day] || 'today'} ${it.departTime}` : `${['今天', '明天', '後天'][day] || '今天'} ${it.departTime} 出發`;
    return it.tomorrow ? (en ? 'tomorrow' : '明天') : null;
  },
  route: (it) => it.route || null,
  stop: (it) => it.stop || it.places?.[0] || null,
  place: (it) => it.savedAt || it.area || it.places?.[0] || null,
  station: (it) => it.station || it.near || null,
  day: (it, en) => (it.later ? (en ? 'after tomorrow' : '後天以後') : it.tomorrow ? (en ? 'tomorrow' : '明天') : null),
  stock: (it) => it.query || null,
  grade: (it) => it.grade || null,
  drama: (it) => it.dramaQuery || null,
  saved: (it) => it.missing || null,
};

/**
 * 各意圖需要的欄位：[欄位, 必要嗎, 沒說時怎麼補]
 * 補法：location＝用你的位置（問阿幫會先請手機定位；試判斷不送定位）｜now＝現在｜today＝今天｜all＝全部列出｜hot＝熱門排行｜latest＝最新一期｜saved＝要先設定常用地點
 */
export const INTENT_SLOTS = {
  trip: [['to', true], ['from', false, 'location'], ['when', false, 'now']],
  bus_route: [['route', true], ['stop', false, 'location']],
  youbike: [['place', false, 'location']],
  nearby_bus: [['place', false, 'location']],
  metro: [['station', false, 'location']],
  rail: [['to', true], ['from', false, 'location'], ['when', false, 'now']],
  weather: [['place', false, 'location'], ['day', false, 'today']],
  aqi: [['place', false, 'location']],
  outing: [['place', false, 'location']],
  pharmacy: [['place', false, 'location']],
  garbage: [['place', false, 'location']],
  quake: [],
  fuel: [['grade', false, 'all']],
  invoice: [],
  stock: [['stock', false, 'index']],
  drama: [['drama', false, 'hot']],
  savedMissing: [['saved', true, 'saved']],
};

/** 意圖 → 會查的資料來源（dataSources 的 id；交通含國道路況，行程另外看天氣與空品） */
export const INTENT_SOURCES = {
  trip: ['transit', 'weather', 'aqi'], bus_route: ['transit'], youbike: ['transit'], nearby_bus: ['transit'], metro: ['transit'], rail: ['transit'],
  weather: ['weather'], aqi: ['aqi'], outing: ['weather', 'aqi'], quake: ['quake'],
  pharmacy: ['opendata'], garbage: ['opendata'], fuel: ['opendata'], invoice: ['opendata'], stock: ['opendata'], drama: ['drama'],
};

/** 為什麼不能回答（欄位齊了也一樣）：後天以後的天氣、問該不該買股票、問油價漲跌、聽不懂 */
const blockedOf = (it) => (it.intent === 'weather' && it.later ? 'later' : it.intent === 'stock' && it.advice ? 'advice' : it.intent === 'fuel' && it.trend ? 'trend' : null);

/**
 * 資料夠不夠（純函式）。
 * @param {object} it 這一輪 agent 實際用的意圖（runDemo 判斷層定案後的 parseIntent 結果）
 * @param {{ judged?: string|null, lang?: 'zh'|'en' }} [o] judged：判斷層（手機或伺服器）說的意圖——規則聽不懂但判斷層聽得懂時，照它列出需要的欄位
 * @returns {{ intent: string, judged: string|null, target: string, slots: Array<{ key: string, required: boolean, have: boolean, value?: string, fill?: string }>, missing: string[], fixed: boolean, location: boolean, enough: boolean, blocked: string|null, heard: object }}
 *   target：照哪個意圖列欄位；fixed：固定說明、不用查資料；location：會先請手機定位（試判斷不送定位）
 */
export function slotReport(it, { judged = null, lang = 'zh' } = {}) {
  const en = lang === 'en';
  const ruleIntent = it?.intent || 'unknown';
  // 規則聽不懂、判斷層有意圖：用判斷層的意圖列欄位（這一輪仍會當成聽不懂，enough＝false）
  const target = ruleIntent === 'unknown' && judged && judged !== 'unknown' && Object.hasOwn(INTENT_SLOTS, judged) ? judged : ruleIntent;
  const spec = Object.hasOwn(INTENT_SLOTS, target) ? INTENT_SLOTS[target] : null;
  const slots = (spec || []).map(([key, required, fill]) => {
    const value = SLOT_VALUE[key](it || {}, en);
    return { key, required, have: !!value, ...(value && { value: String(value).slice(0, 40) }), ...(!value && fill && { fill }) };
  });
  const missing = slots.filter((s) => s.required && !s.have).map((s) => s.key);
  const blocked = blockedOf(it || {});
  const understood = target === ruleIntent && !!spec;
  // 固定說明（防詐請到防詐頁、阿幫不能代按代付、道謝…）：不用查資料，算「夠」
  const fixed = !spec && ruleIntent !== 'unknown';
  const enough = fixed || (understood && !missing.length && !blocked && (ruleIntent === 'savedMissing' ? false : answerable(it)));
  const heard = {
    ...(it?.places?.length && { places: it.places.slice(0, 3).map((p) => String(p).slice(0, 40)) }),
    ...(it?.states?.length && { states: [...it.states] }),
    ...(it?.arriveBy && { arriveBy: it.arriveBy }),
    ...(it?.departTime && { departTime: it.departTime }),
    ...(it?.tomorrow && { tomorrow: true }),
    ...(it?.mode && { mode: it.mode }),
  };
  return { intent: ruleIntent, judged: judged || null, target, slots, missing, fixed, location: !!it && Object.hasOwn(INTENT_SLOTS, ruleIntent) && needsLocation(it), enough, blocked, heard };
}

/** TDX 額度用完多久內算「現在改用示範」 */
export const TDX_LIMIT_WINDOW_MS = 10 * 60_000;

/**
 * 會查的資料來源與現在的狀態（真實／示範、為什麼）。不含金鑰、網址或環境變數名稱。
 * reason：live 正常｜forced 伺服器設定成只用示範資料｜no-key 沒有金鑰或授權碼｜no-download 沒開開放資料下載｜tdx-limit TDX 額度剛用完（改示範）｜no-source 沒有設定片庫
 * @param {object} svc createServices() 的結果
 * @param {string} intent
 * @param {{ now?: number }} [o]
 * @returns {Array<{ id: string, mode: 'live'|'demo', reason: string, minutesAgo?: number }>}
 */
export function sourceReport(svc, intent, { now = Date.now() } = {}) {
  const ids = INTENT_SOURCES[intent] || [];
  const all = dataSources(svc);
  const limitedAt = typeof svc.tdxLimitedAt === 'function' ? svc.tdxLimitedAt() : null;
  return ids.map((id) => {
    const src = all.find((s) => s.id === id);
    const mode = src?.mode === 'live' ? 'live' : 'demo';
    if (id === 'transit' && mode === 'live' && limitedAt && now - limitedAt < TDX_LIMIT_WINDOW_MS) return { id, mode: 'demo', reason: 'tdx-limit', minutesAgo: Math.max(0, Math.round((now - limitedAt) / 60_000)) };
    if (mode === 'live') return { id, mode, reason: 'live' };
    const reason = svc.demoForced ? 'forced' : id === 'opendata' ? 'no-download' : id === 'drama' ? 'no-source' : (id === 'aqi' || id === 'quake') && svc.openDataMode !== 'live' ? 'no-download' : 'no-key';
    return { id, mode, reason };
  });
}

/**
 * trial 事件的內容（run.js 送出）：判斷結果、資料夠不夠、資料來源。
 * @param {object} svc
 * @param {object} it 定案後的意圖
 * @param {{ judge?: object|null, lang?: string, now?: number, safety?: string|null }} [o]
 */
export function trialInfo(svc, it, { judge = null, lang = 'zh', now = Date.now(), safety = null } = {}) {
  const judged = judge?.intent && Object.hasOwn(JUDGE_INTENTS, judge.intent) ? judge.intent : null;
  const slots = slotReport(it, { judged, lang });
  return {
    lang: lang === 'en' ? 'en' : 'zh',
    judge: judge ? { intent: judge.intent, states: [...(judge.states || [])], source: judge.source || 'rules', ...(judge.engine && { engine: judge.engine }), ...(judge.confidence != null && { confidence: Math.round(judge.confidence * 100) / 100 }) }
      : { intent: it?.intent || 'unknown', states: [...(it?.states || [])], source: 'rules' },
    ...slots,
    sources: safety ? [] : sourceReport(svc, slots.target, { now }),
    ...(safety && { safety }),
  };
}
