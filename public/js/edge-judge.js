// 裝置端 AI 判斷（ADR-0014）：手機 App 裡用系統內建的模型先判斷「使用者想做什麼」與「使用者狀態」，
// 結果當作提示（deviceJudge）跟著問題送到伺服器，伺服器就不用再呼叫模型判斷（省時間、省成本）。
//   iOS：Apple Intelligence（Foundation Models，iOS 26 以上、支援的機型且已開啟）
//   Android：Gemini Nano（ML Kit GenAI Prompt API，經 AICore；支援的機型）
// 網頁版、系統模型不可用、逾時或回傳看不懂 → 回 null，伺服器照原本的判斷層（使用者看不出差別）。
// 只送「意圖、狀態、引擎」三個欄位，不送模型原文；方案排序仍由伺服器 decide.js 計分（ADR-0010）。
const PLUGIN = 'AbangEdgeAI';
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};

/** 與 core/agent/judge.js 的 JUDGE_INTENTS、JUDGE_STATES 相同（test/edge-judge.test.js 比對） */
export const EDGE_INTENTS = ['trip', 'bus_route', 'youbike', 'nearby_bus', 'metro', 'rail', 'weather', 'aqi', 'quake', 'pharmacy', 'garbage', 'fuel', 'invoice', 'stock', 'unknown'];
export const EDGE_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir'];
export const EDGE_ENGINES = ['apple', 'gemini-nano'];
/** 等裝置判斷最多這麼久，超過就不等（使用者送出後不該卡住） */
export const EDGE_TIMEOUT_MS = 1800;
const OFF_KEY = 'abang.edgeAI';

/**
 * 給裝置模型的指示（精簡版的 core/agent/judge-prompt.txt：手機模型的上下文小，越短越快）。
 * iOS 用結構化輸出（@Generable）不需要 JSON 格式說明；Android 要求只回 JSON。
 */
export const EDGE_INSTRUCTIONS = `你是交通與生活助理的「意圖與狀態判斷器」，只判斷，不回答問題。
意圖（選一個）：trip 從 A 到 B 怎麼去、行程、比較交通方式（只說目的地也算）；bus_route 某條公車路線到哪、多久到、末班；youbike 借還 YouBike、站點車位；nearby_bus 附近公車站牌；metro 捷運下一班；rail 高鐵、台鐵班次車票；weather 天氣、會不會下雨；aqi 空氣品質、PM2.5、口罩；quake 地震；pharmacy 藥局；garbage 垃圾車；fuel 油價；invoice 發票對獎；stock 台股；unknown 以上都不是。
狀態（使用者明講才列，可為空）：rush 趕時間、快遲到；luggage 帶行李、大包小包；budget 要便宜、省錢；lessWalk 不想走路、帶長輩、推嬰兒車、腳不舒服；rain 正在下雨（問會不會下雨不算）；badAir 空氣很差。
「307 到哪了」「藍15 還要多久」問某條公車在哪、多久到是 bus_route，不是 trip。「板南線下一班」「淡水信義線還要等多久」是 metro。「下一班高鐵到台中」「幾點有自強號」是 rail，不是 trip。「這期發票」「中獎號碼」「我有沒有中」是 invoice。「改坐公車」「那叫車呢」這類接著改條件的話是 trip。前文提過的狀態持續有效。`;

/** 使用者可在設定關掉裝置端 AI（E8）；讀不到就當開著 */
export function edgeEnabled() {
  try { return globalThis.localStorage?.getItem(OFF_KEY) !== 'off'; } catch { return true; }
}

/** 把外掛回傳整理成 deviceJudge；任何欄位不對就整個不用（回 null） */
export function normalizeJudge(raw, engine) {
  let o = raw;
  if (typeof o === 'string') {
    const m = o.match(/\{[\s\S]*\}/); // Android 模型偶爾在 JSON 前後加字
    try { o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
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

/**
 * 在手機上判斷這一句。
 * @param {string} text 使用者這一句
 * @param {string[]} [history] 前面幾句（只取最後 2 句）
 * @returns {Promise<{ intent: string, states: string[], engine: string } | null>}
 */
export async function edgeJudge(text, history = [], { timeout = EDGE_TIMEOUT_MS } = {}) {
  const c = cap();
  if (!c || !edgeEnabled() || !text) return null;
  let timer;
  try {
    const call = c.nativePromise(PLUGIN, 'judge', { text: String(text).slice(0, 500), history: history.slice(-2).map((h) => String(h).slice(0, 200)), instructions: EDGE_INSTRUCTIONS, intents: EDGE_INTENTS, states: EDGE_STATES });
    const r = await Promise.race([call, new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout); })]);
    return r ? normalizeJudge(r.result, r.engine) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
