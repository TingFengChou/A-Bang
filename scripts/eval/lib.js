// 意圖與狀態判斷實驗的共用部分：類別定義、評估集、地端模型呼叫、嵌入分類器、計分。
// 金鑰只從環境變數讀、不印出；評估集與訓練範例都是自行撰寫的假想提問，不含使用者資料。
import { readFile } from 'node:fs/promises';

export const INTENTS = {
  trip: '從 A 到 B 怎麼去、行程規劃、比較交通方式（含只說目的地）',
  bus_route: '某一條公車路線到哪、多久到站、末班車',
  youbike: 'YouBike／公共自行車借車還車、站點車位',
  nearby_bus: '附近有哪些公車站牌、站牌有哪些路線',
  metro: '捷運下一班、捷運到站時間、班距',
  rail: '高鐵或台鐵（火車）班次、時刻、車票',
  weather: '天氣、氣溫、會不會下雨、帶傘、颱風',
  aqi: '空氣品質、AQI、PM2.5、空汙、要不要戴口罩',
  quake: '地震、震度、震央',
  pharmacy: '藥局、領藥、買藥',
  garbage: '垃圾車、倒垃圾、資源回收車時間',
  fuel: '油價、汽油、柴油價格',
  invoice: '統一發票、對獎、中獎號碼、開獎',
  stock: '台股股價、大盤、指數、個股（含問該不該買）',
  unknown: '以上都不是：閒聊、其他服務、阿幫不提供的資訊',
};
export const STATES = {
  rush: '使用者趕時間、快遲到、很急',
  luggage: '使用者帶行李、大包小包、嬰兒車',
  budget: '使用者想省錢、預算有限、要便宜',
  lessWalk: '使用者不想多走路、行動不便、帶長輩、腳不舒服',
  rain: '使用者說正在下雨或雨很大（不是只問會不會下雨）',
  badAir: '使用者說空氣很差、霧霾、空汙嚴重（不是只問空氣品質）',
};
export const STATE_KEYS = Object.keys(STATES);

export const loadItems = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')).items;

/** 基準系統提示詞（地端模型） */
export const BASE_PROMPT = `你是交通與生活助理的「意圖與狀態判斷器」。只回 JSON：{"intent": "<意圖>", "states": ["<狀態>", ...]}。
意圖（只能選一個）：
${Object.entries(INTENTS).map(([k, v]) => `- ${k}：${v}`).join('\n')}
狀態（使用者這句話或前文明確表達的才列，可以是空陣列）：
${Object.entries(STATES).map(([k, v]) => `- ${k}：${v}`).join('\n')}
有前文時，簡短的追問（例如「那聯發科呢？」）沿用前文的意圖。`;

const LOCAL_URL = () => (process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
export const LOCAL_MODEL = () => process.env.LOCAL_LLM_MODEL || 'qwen3:8b';

/** 地端模型（OpenAI 相容）聊天；think＝開啟推理（優化器用），預設關閉 */
export async function localChat(messages, { json = false, think = false, temperature = 0, timeoutMs = 180_000 } = {}) {
  const res = await fetch(`${LOCAL_URL()}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_MODEL(), messages, temperature, stream: false, ...(json && { response_format: { type: 'json_object' } }), ...(!think && { reasoning_effort: 'none' }) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local HTTP ${res.status}`);
  const j = await res.json();
  return { text: String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), tokens: (j.usage?.prompt_tokens || 0) + (j.usage?.completion_tokens || 0) };
}

/** 用地端模型判斷一題（system＝提示詞） */
export async function localClassify(it, system = BASE_PROMPT) {
  const msgs = [{ role: 'system', content: system }, ...(it.history?.length ? [{ role: 'user', content: `前文：${it.history.join(' ／ ')}` }] : []), { role: 'user', content: `${it.text}\n/no_think` }];
  const { text, tokens } = await localChat(msgs, { json: true });
  const m = /\{[\s\S]*\}/.exec(text);
  let o = {};
  try { o = m ? JSON.parse(m[0]) : {}; } catch { /* 格式錯當作沒答 */ }
  return { intent: INTENTS[o.intent] ? o.intent : 'unknown', states: (Array.isArray(o.states) ? o.states : []).filter((k) => STATE_KEYS.includes(k)), tokens };
}

// ── 嵌入分類器：與正式判斷層共用（core/agent/judge.js） ──
export { createEmbedClassifier } from '../../core/agent/judge.js';

// ── 計分 ──
export function score(rows) {
  let tp = 0, fp = 0, fn = 0, exact = 0;
  for (const { it, r } of rows) {
    const g = new Set(it.states), p = new Set(r.states);
    for (const k of p) (g.has(k) ? tp++ : fp++);
    for (const k of g) if (!p.has(k)) fn++;
    if (r.intent === it.intent && g.size === p.size && [...g].every((k) => p.has(k))) exact++;
  }
  const prec = tp + fp ? tp / (tp + fp) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
  const intentOk = rows.filter((x) => x.r.intent === x.it.intent).length;
  return { n: rows.length, intentAcc: rows.length ? intentOk / rows.length : 0, prec, rec, f1: prec + rec ? (2 * prec * rec) / (prec + rec) : 0, exact: rows.length ? exact / rows.length : 0 };
}

/** 切分：單數 id 給優化（B），雙數 id 是驗收集（所有方法都另外報告驗收集分數，公平比較） */
export const isHoldout = (it) => it.id % 2 === 0;
