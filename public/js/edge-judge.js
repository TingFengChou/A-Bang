// 裝置端 AI 判斷（ADR-0014）：手機 App 裡用系統內建的模型先判斷「使用者想做什麼」與「使用者狀態」，
// 結果當作提示（deviceJudge）跟著問題送到伺服器；伺服器沒有自己的判斷模型時（例：Claude 模式）由它補上，省時間、省成本。
//   iOS：Apple Intelligence（Foundation Models，iOS 26 以上、支援的機型且已開啟）
//   Android：Gemini Nano（ML Kit GenAI Prompt API，經 AICore；支援的機型）
// 網頁版、系統模型不可用、逾時或回傳看不懂 → 回 null，伺服器照原本的判斷層（使用者看不出差別）。
// 只送「意圖、狀態、引擎」三個欄位，不送模型原文；方案排序仍由伺服器 decide.js 計分（ADR-0010）。
import { unsafeAsk } from '../../core/suggest.js';

// 外掛 AbangEdgeAI 有三個用模型的任務：judge（聽懂問題）、write（寫回答，edge-write.js）、suggest（猜下一句）。
// 共用這裡的外掛存取與斷路器；優先順序 judge ＞ write ＞ suggest：judge、write 開始前先取消正在跑的 suggest（cancelSuggest），
// 手機正在寫回答時不猜下一句；任何一個任務回「不可用」就這次開 App 都不再用（取消後 3 秒內的忙碌錯誤不算，edgeTrips）。
export const EDGE_PLUGIN = 'AbangEdgeAI';
const PLUGIN = EDGE_PLUGIN;
/** 手機 App 裡的 Capacitor（網頁版回 null）；edge-write.js 共用 */
export const edgeCap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};
const cap = edgeCap;

/** 與 core/agent/judge.js 的 JUDGE_INTENTS、JUDGE_STATES 相同（test/edge-judge.test.js 比對） */
export const EDGE_INTENTS = ['trip', 'bus_route', 'youbike', 'nearby_bus', 'metro', 'rail', 'weather', 'aqi', 'quake', 'pharmacy', 'garbage', 'fuel', 'invoice', 'stock', 'unknown'];
export const EDGE_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir', 'elder', 'kids', 'mobility'];
export const EDGE_ENGINES = ['apple', 'gemini-nano'];
/** 等裝置判斷最多這麼久，超過就不等（使用者送出後不該卡住） */
export const EDGE_TIMEOUT_MS = 1800;
const OFF_KEY = 'abang.edgeAI';
/** 引擎的顯示名稱、不能用的原因（設定頁、首頁「手機上的 AI」共用） */
export const EDGE_ENGINE_NAME = { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano' };
export const EDGE_REASON = { ok: '可以使用', unsupported: '這支手機不支援', disabled: '手機沒有開啟 Apple Intelligence', downloading: '模型下載中', 'needs-wifi': '連上 Wi-Fi 後會自動下載模型', 'os-too-old': '系統版本太舊', language: '目前不支援繁體中文', web: '網頁版不使用（只在手機 App）', 'no-plugin': '這個版本沒有裝置端 AI' };

/**
 * 給裝置模型的指示（精簡版的 core/agent/judge-prompt.txt：手機模型的上下文小，越短越快）。
 * iOS 用結構化輸出（@Generable）不需要 JSON 格式說明；Android 要求只回 JSON。
 */
export const EDGE_INSTRUCTIONS = `你是交通與生活助理的「意圖與狀態判斷器」，只判斷，不回答問題。
意圖（選一個）：trip 從 A 到 B 怎麼去、行程、比較交通方式（只說目的地也算）；bus_route 某條公車路線到哪、多久到、末班；youbike 借還 YouBike、站點車位；nearby_bus 附近公車站牌；metro 捷運下一班；rail 高鐵、台鐵班次車票；weather 天氣、會不會下雨；aqi 空氣品質、PM2.5、口罩；quake 地震；pharmacy 藥局；garbage 垃圾車；fuel 油價；invoice 發票對獎；stock 台股；unknown 以上都不是。
狀態（使用者明講才列，可為空）：rush 趕時間、快遲到；luggage 帶行李、大包小包；budget 要便宜、省錢；lessWalk 不想走路、腳不舒服；rain 正在下雨（問會不會下雨不算）；badAir 空氣很差；elder 帶長輩、老人家同行；kids 帶小孩、推嬰兒車；mobility 坐輪椅、行動不便。
「307 到哪了」「藍15 還要多久」問某條公車在哪、多久到是 bus_route，不是 trip。「板南線下一班」「淡水信義線還要等多久」是 metro。「下一班高鐵到台中」「幾點有自強號」是 rail，不是 trip。「這期發票」「中獎號碼」「我有沒有中」是 invoice。「改坐公車」「那叫車呢」這類接著改條件的話是 trip。前文提過的狀態持續有效。`;

/** 使用者可在設定關掉裝置端 AI（E8）；讀不到就當開著 */
export function edgeEnabled() {
  try { return globalThis.localStorage?.getItem(OFF_KEY) !== 'off'; } catch { return true; }
}

/** 設定頁與「阿幫的腦袋」（#/ai）共用的開關；存不了（無痕模式）回 false */
export function setEdgeEnabled(on) {
  try { if (on) globalThis.localStorage.removeItem(OFF_KEY); else globalThis.localStorage.setItem(OFF_KEY, 'off'); return true; } catch { return false; }
}

// 在手機上判斷了幾次、上次花多久（#/ai 顯示）：只記數字、只存在這支手機，不上傳、不含句子
export const EDGE_STATS_KEY = 'abang.edgeStats';
const dayKey = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readStats = () => {
  try { const o = JSON.parse(globalThis.localStorage?.getItem(EDGE_STATS_KEY) || 'null'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
const validMs = (v) => (Number.isFinite(v) && v >= 0 && v <= 60_000 ? Math.round(v) : null);
/**
 * 今天在手機上判斷了幾次（換日歸零）、上次花多久（毫秒；沒判斷過是 null）。
 * @returns {{ today: number, lastMs: number|null }}
 */
export function edgeStats(now = Date.now()) {
  const o = readStats();
  return { today: o.d === dayKey(now) && Number.isInteger(o.n) && o.n > 0 ? o.n : 0, lastMs: validMs(o.ms) };
}
/** 記一次成功的裝置判斷（ms：花多久） */
export function noteEdgeJudge(ms, now = Date.now()) {
  const { today, lastMs } = edgeStats(now);
  try { globalThis.localStorage?.setItem(EDGE_STATS_KEY, JSON.stringify({ d: dayKey(now), n: today + 1, ms: validMs(ms) ?? lastMs })); } catch { /* 無痕模式：不記 */ }
}

/** 把外掛回傳整理成 deviceJudge；任何欄位不對就整個不用（回 null） */
export function normalizeJudge(raw, engine) {
  let o = raw;
  if (typeof o === 'string') {
    // Android 模型偶爾在 JSON 前後加字、或輸出兩個物件：取第一個解析得出來的
    o = null;
    for (const m of raw.match(/\{[^{}]*\}/g) || []) { try { o = JSON.parse(m); break; } catch { /* 下一個 */ } }
  }
  if (!o || typeof o !== 'object' || !EDGE_INTENTS.includes(o.intent) || !EDGE_ENGINES.includes(engine)) return null;
  const states = [...new Set((Array.isArray(o.states) ? o.states : []).filter((k) => EDGE_STATES.includes(k)))];
  return { intent: o.intent, states, engine };
}

/** 裝置模型的狀態：{ available, engine, reason }（reason：unsupported／disabled／downloading／not-ready…） */
export async function edgeStatus() {
  const c = cap();
  if (!c) return { available: false, reason: 'web' };
  try { return await c.nativePromise(PLUGIN, 'status', {}); } catch { return { available: false, reason: 'no-plugin' }; }
}

/** 進問阿幫頁時先讓系統載入模型（第一次判斷才不會慢）；失敗不影響 */
export function edgePrewarm() {
  const c = cap();
  if (c && edgeEnabled()) c.nativePromise(PLUGIN, 'prewarm', { instructions: EDGE_INSTRUCTIONS }).catch(() => {});
}

// 斷路器（PR #32 審查）：上一題還沒跑完（例：iOS 冷啟動 5 秒）就不等；外掛說不可用就這次開 App 都不再試
let inflight = null;
let unavailable = false;
/** 取消建議後這段時間內的「忙碌」類錯誤不算模型壞掉（與 Android BUSY_GRACE_MS、iOS busyGrace 相同） */
export const EDGE_BUSY_GRACE_MS = 3000;
let lastCancelAt = -Infinity;
/**
 * 外掛的錯誤要不要讓這次開 App 都不再用手機上的 AI（斷路器）。
 * 只有「不可用」才算；剛取消建議（3 秒內）又遇到忙碌、取消中、同時有請求、限流 → 只是讓位，這一題交給伺服器，不跳斷路器。
 */
export function edgeTrips(message, sinceCancelMs = Infinity) {
  const m = String(message || '');
  if (sinceCancelMs < EDGE_BUSY_GRACE_MS && /busy|cancel|concurren|rate.?limit/i.test(m)) return false;
  return /unavailable/.test(m);
}
/** 斷路器跳了嗎（外掛說不可用）：跳了就這次開 App 都不再請手機做任何事 */
export const edgeTripped = () => unavailable;
/** 任務失敗時回報（write 也用）：不可用就跳斷路器；剛讓位的忙碌不算 */
export function noteEdgeError(message) { if (edgeTrips(message, Date.now() - lastCancelAt)) unavailable = true; }
/** 正在用模型的其他任務（write）：有的話不猜下一句 */
export const edgeTasks = new Set();
/** 測試用：重設斷路器 */
export const _resetEdge = () => { inflight = null; unavailable = false; suggestInflight = null; suggestOff = false; suggestAbort = null; lastCancelAt = -Infinity; edgeTasks.clear(); };

/**
 * 在手機上判斷這一句。
 * @param {string} text 使用者這一句
 * @param {string[]} [history] 前面幾句（只取最後 2 句）
 * @returns {Promise<{ intent: string, states: string[], engine: string } | null>}
 */
export async function edgeJudge(text, history = [], { timeout = EDGE_TIMEOUT_MS } = {}) {
  const c = cap();
  if (!c || unavailable || inflight || !edgeEnabled() || !text) return null;
  cancelSuggest(); // judge 優先：正在猜下一句就先取消（Android 原生端共用一條執行緒，不讓 judge 排在 suggest 後面）
  let timer;
  const t0 = Date.now();
  try {
    const call = c.nativePromise(PLUGIN, 'judge', { text: String(text).slice(0, 500), history: history.slice(-2).map((h) => String(h).slice(0, 200)), instructions: EDGE_INSTRUCTIONS, intents: EDGE_INTENTS, states: EDGE_STATES });
    // 逾時後原生端仍在跑：跑完前下一題不再呼叫（避免排隊），跑完的結果丟掉（不會用到下一題）
    inflight = call.catch((e) => noteEdgeError(e?.message)).finally(() => { inflight = null; });
    const r = await Promise.race([call, new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout); })]);
    const out = r ? normalizeJudge(r.result, r.engine) : null;
    if (out) noteEdgeJudge(validMs(r.ms) ?? Date.now() - t0); // 外掛有回模型耗時就用它，否則用這裡量到的（含橋接）
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ───── 動態「下一句」建議（UX.md §3.2、AGENT.md §5.4）：手機上的 AI 依情境猜使用者接下來想問的 3～4 句 ─────
// 情境（public/js/agent/suggest.js contextText）只在手機上給模型看，不送伺服器；回來的句子另外由伺服器規則驗證（只送句子）。
export const SUGGEST_KEY = 'abang.edgeSuggest';
/** 設定頁「用手機上的 AI 猜我接下來想問什麼」（預設開；裝置端 AI 整個關掉時也不用） */
export function suggestEnabled() {
  try { return globalThis.localStorage?.getItem(SUGGEST_KEY) !== 'off'; } catch { return true; }
}
export function setSuggestEnabled(on) {
  try { if (on) globalThis.localStorage.removeItem(SUGGEST_KEY); else globalThis.localStorage.setItem(SUGGEST_KEY, 'off'); return true; } catch { return false; }
}

/** 給手機模型的指示（短：手機模型上下文小） */
export const SUGGEST_INSTRUCTIONS = `你幫「阿幫」App 猜使用者下一句想問什麼。依情境寫 4 句使用者接下來最可能問阿幫的話。
每句 6～20 字，口語，像使用者自己會打的字；繁體中文、台灣用語。
每句要單獨看得懂：寫出地名或公車路線號碼，不要用「那裡」「這班」「回程」。
只問阿幫查得到的：從 A 到 B 怎麼去、公車多久到、捷運下一班、高鐵台鐵班次、YouBike、附近公車站、天氣、明天會不會下雨、出門要帶傘嗎、空氣品質、地震、藥局、垃圾車、油價、發票、台股收盤。
跟剛剛查到的結果直接相關的排前面；不要重複剛剛已經問過的；不要問投資建議；不要編地名。`;
export const SUGGEST_INSTRUCTIONS_EN = `${SUGGEST_INSTRUCTIONS}\nThe user is asking in English: write all 4 questions in simple English.`;

/** 外掛回傳 → 句子陣列：字串（每行一句）、陣列或 { questions }；去編號、引號、重複，太短太長（中文 40、英文 60 字）、夾帶誘導內容的丟掉 */
export function normalizeSuggest(raw, max = 6, { lang = null } = {}) {
  const maxLen = lang === 'en' ? 60 : 40;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.questions) ? raw.questions : typeof raw === 'string' ? raw.split(/\n+/) : [];
  const out = [];
  for (const x of list) {
    const s = String(x ?? '').replace(/^\s*(?:[-*•‧·]|\d+\s*[.、)）]|[（(]\d+[)）])\s*/, '').replace(/^["「『“]+|["」』”]+$/g, '').trim();
    if (s.length < 4 || s.length > maxLen || /[{}[\]<>]/.test(s) || unsafeAsk(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

let suggestInflight = null;
let suggestOff = false; // 這個版本的外掛沒有 suggest、或說不可用：這次開 App 不再試
let suggestAbort = null; // 取消正在等的那一次（結果丟掉）
/**
 * 使用者送出問題時讓位給 judge（產品負責人 2026-11-21：judge 優先）：請原生端取消正在跑的 suggest（Android 取消 ML Kit 的 future、
 * iOS 取消 Task），這裡不再等它、結果丟掉，下一題也不會因為它還在跑而被擋。舊版外掛沒有 cancelSuggest 也沒關係（原生端 judge 另有自己的執行緒）。
 */
export function cancelSuggest() {
  const c = cap();
  if (!c || !suggestInflight) return false;
  c.nativePromise(PLUGIN, 'cancelSuggest', {}).catch(() => {});
  lastCancelAt = Date.now();
  suggestAbort?.();
  suggestAbort = null;
  suggestInflight = null;
  return true;
}
/** 現在可以請手機上的 AI 猜嗎（App、外掛可用、兩個開關都開著）；不能就直接用規則，不必等 */
export const edgeCanSuggest = () => !!cap() && !unavailable && !suggestOff && edgeEnabled() && suggestEnabled();
/**
 * 在手機上猜使用者接下來想問的話（只給候選；要不要顯示由 agent/suggest.js 驗證、排序）。
 * @param {string} context 情境文字（suggest.js contextText；不含座標）
 * @returns {Promise<{ asks: string[], engine: string } | null>} 不可用、關掉、逾時、上一次還在跑 → null
 */
export async function edgeSuggest(context, { lang = null, timeout = 1500 } = {}) {
  const c = cap();
  if (!c || unavailable || suggestOff || suggestInflight || inflight || edgeTasks.size || !edgeEnabled() || !suggestEnabled() || !context) return null; // 正在判斷（judge）或寫回答（write）：不猜（它們優先）
  let timer;
  try {
    const call = c.nativePromise(PLUGIN, 'suggest', { context: String(context).slice(0, 600), instructions: lang === 'en' ? SUGGEST_INSTRUCTIONS_EN : SUGGEST_INSTRUCTIONS, lang: lang === 'en' ? 'en' : 'zh-TW', max: 4 });
    const p = call.catch((e) => { if (/unavailable|not implemented|UNIMPLEMENTED/i.test(e?.message || e?.code || '')) suggestOff = true; }).finally(() => { if (suggestInflight === p) suggestInflight = null; });
    suggestInflight = p;
    const r = await Promise.race([call, new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout); suggestAbort = () => resolve(null); })]);
    suggestAbort = null;
    const asks = r ? normalizeSuggest(r.result, 6, { lang }) : [];
    return asks.length && EDGE_ENGINES.includes(r.engine) ? { asks, engine: r.engine } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
