// 判斷層（2026-11-20 實驗後導入，docs/research/decision-eval.md）：判斷「意圖」與「使用者狀態」，方案排序仍由 decide.js 計分（ADR-0010）。
//   A 嵌入分類器：transformers.js＋multilingual-e5-small（開源、可在裝置上跑；選用依賴，裝不起來就停用）
//   B 模型判斷：地端模型（OpenAI 相容）＋自動優化過的提示詞（core/agent/judge-prompt.txt）
//   規則：demo-intent.js 的 parseIntent（保底，也負責抽地點、路線號碼等參數）
// 組合（實驗結果）：
//   意圖＝A 信心 ≥ 0.8 用 A，否則有模型就問 B；沒有模型（也沒有裝置端提示）時，規則有明確意圖就用規則，
//         規則聽不懂才用 A（A 信心 < 0.5 當作 unknown，不亂選）——真實資料健檢 2026-11-22：A 沒把握時常把「從板橋到台北車站」
//         「高雄車站到駁二」判成高鐵台鐵、詐騙簡訊判成查公車「24」；評估集 172 題 84.9% → 91.3%（docs/research/decision-eval.md 補充）
//   狀態＝規則 ∪（A ∩ B）——規則精準、A 與 B 都說有才加（全對 89.5%，驗收集 88.4%）
//   B 只在「A 沒把握」或「是行程問題（狀態才有用）」時才問，其餘不花模型呼叫
import { readFile } from 'node:fs/promises';
import { parseIntent } from './demo-intent.js';
import { EMBED_MODEL, EMBED_DTYPE, EMBED_TAU, embedText, trainClassifier, classifyVector } from '../judge-classify.js';

export const JUDGE_INTENTS = {
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
  traffic: '國道、高速公路路況：塞不塞車、車多不多（2026-11-22）',
  unknown: '以上都不是：閒聊、其他服務、阿幫不提供的資訊',
};
export const JUDGE_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir', 'elder', 'kids', 'mobility'];
export const CONFIDENT = 0.8;
/** 規則靠明確關鍵字認出的意圖：判斷層（手機、模型、嵌入分類器）說是別的也照規則（腦袋審查 #3） */
export const KEYWORD_INTENTS = new Set(['weather', 'aqi', 'quake', 'pharmacy', 'garbage', 'fuel', 'invoice', 'stock', 'youbike', 'nearby_bus', 'metro']);
/** A 沒把握、規則也聽不懂時：A 信心低於這個值就當作 unknown（不亂選；「我在等939」0.27、詐騙簡訊 0.42） */
export const UNSURE_FLOOR = 0.5;
/** 裝置端判斷的引擎（ADR-0014）：Apple Intelligence（Foundation Models）、Gemini Nano（ML Kit GenAI） */
export const DEVICE_ENGINES = ['apple', 'gemini-nano'];
/** 手機上的小模型（E3）：與這裡的 A 同一個嵌入分類器（core/judge-classify.js），帶信心；只判斷，不能寫回答 */
export const EMBED_ENGINE = 'e5';
export const DEVICE_JUDGE_ENGINES = [...DEVICE_ENGINES, EMBED_ENGINE];

/**
 * 載入嵌入模型（node，transformers.js）：回傳 texts → 正規化後的向量。手機上的小模型用同一個模型（public/js/edge-embed-worker.js）。
 * @returns {Promise<(texts: string[]) => Promise<number[][]>>}
 */
export async function createEmbedder({ model = EMBED_MODEL, cacheDir = new URL('../../node_modules/.cache/transformers/', import.meta.url).pathname } = {}) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const ex = await pipeline('feature-extraction', model, { dtype: EMBED_DTYPE });
  return async (texts) => (await ex(texts, { pooling: 'mean', normalize: true })).tolist();
}

/**
 * A 嵌入分類器：參數計算與分類在 core/judge-classify.js（與手機共用）。
 * @param {Array<{ text: string, intent: string, states: string[], history?: string[] }>} trainItems
 * @param {{ model?: string, tau?: number, cacheDir?: string }} [opts]
 * @returns {Promise<(it: { text: string, history?: string[] }) => Promise<{ intent: string, confidence: number, states: string[] }>>}
 */
export async function createEmbedClassifier(trainItems, { model, tau = EMBED_TAU, cacheDir } = {}) {
  const embed = await createEmbedder({ ...(model && { model }), ...(cacheDir && { cacheDir }) });
  const params = trainClassifier(await embed(trainItems.map(embedText)), trainItems, { tau, states: JUDGE_STATES });
  return async (it) => classifyVector((await embed([embedText(it)]))[0], params);
}

/**
 * B 模型判斷：OpenAI 相容端點（地端模型），回 JSON {intent, states}；關閉推理以求快。
 * @param {{ url: string, model: string, apiKey?: string, prompt: string, fetchImpl?: typeof fetch, timeoutMs?: number }} o
 */
export function createLlmJudge({ url, model, apiKey, prompt, fetchImpl = fetch, timeoutMs = 20_000 }) {
  const endpoint = `${String(url).replace(/\/+$/, '')}/chat/completions`;
  return async (it) => {
    const messages = [{ role: 'system', content: prompt }, ...(it.history?.length ? [{ role: 'user', content: `前文：${it.history.join(' ／ ')}` }] : []), { role: 'user', content: `${it.text}\n/no_think` }];
    const res = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model, messages, temperature: 0, stream: false, response_format: { type: 'json_object' }, reasoning_effort: 'none' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
    const j = await res.json();
    const text = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const m = /\{[\s\S]*\}/.exec(text);
    const o = m ? JSON.parse(m[0]) : {};
    return { intent: JUDGE_INTENTS[o.intent] ? o.intent : 'unknown', states: (Array.isArray(o.states) ? o.states : []).filter((k) => JUDGE_STATES.includes(k)) };
  };
}

/**
 * 組合判斷（見檔頭）。embed／llm 任一可為 null；兩個都沒有時等同規則。
 * @param {{ embed?: Function|null, llm?: Function|null, threshold?: number }} parts
 * @returns {(text: string, history?: string[], opts?: { device?: { intent: string, states: string[], engine: string, confidence?: number } }) => Promise<{ intent: string, states: string[], confidence: number|null, source: 'embed'|'llm'|'device'|'rules', llmUsed: boolean, engine?: string }>}
 */
export function createJudge({ embed = null, llm = null, threshold = CONFIDENT } = {}) {
  const run = async (text, history = [], { quick = false, device = null } = {}) => {
    // 裝置端提示（ADR-0014：手機上的 Apple Intelligence／Gemini Nano 先判斷好）：伺服器沒有自己的模型（B）時當作 B；
    // 有 B 時只用在快速版（評測：A＋規則＋Gemini Nano 全對 89.0%，A＋規則＋地端 qwen3:8b 89.5%，docs/research/edge-eval.md）
    // 手機上的小模型（E3）跟 A 是同一個分類器：伺服器沒有 A（JUDGE=off、還在載入）時當作 A（信心、門檻、規則優先都照 A 的規則）；伺服器有 A 就用自己的
    const devEmbed = device?.engine === EMBED_ENGINE && !embed && Number.isFinite(device.confidence) ? { intent: device.intent, confidence: device.confidence, states: device.states || [] } : null;
    const dev = device && device.engine !== EMBED_ENGINE && (quick || !llm) ? { intent: device.intent, states: device.states || [] } : null;
    const it = { text, ...(history.length && { history }) };
    const rules = parseIntent(text, { history: history.map((content) => ({ role: 'user', content })) });
    const a = embed ? await embed(it).catch(() => null) : devEmbed;
    const sure = a && a.confidence >= threshold;
    // 問阿幫能做什麼、道謝、道歉、只回「好」：整句就是這個，手機或模型看了前文（剛剛在排行程、說過快遲到）判成行程也不改，狀態也不沿用（2026-11-23 產品負責人：腦袋頁「你會做什麼」意圖總是行程規劃）
    const meta = rules.intent === 'unknown' && !!(rules.help || rules.thanks || rules.sorry || rules.ack);
    const wantLlm = !dev && !quick && !rules.followUp && !meta && llm && (!sure || a.intent === 'trip' || rules.intent === 'trip');
    const b = dev || (wantLlm ? await llm(it).catch(() => null) : null);
    // 接著上一輪改行程（「改成公車 601」「我很趕」）：規則看得到前文，以它為準（分類器只看這一句，會誤判成查公車）
    // 沒有模型也沒有裝置端提示、A 又沒把握：規則有明確意圖就用規則（真實資料健檢 S3）；規則聽不懂才看 A，A 太沒把握就當 unknown
    const ruled = rules.intent !== 'unknown' && Object.hasOwn(JUDGE_INTENTS, rules.intent);
    // 接著上一輪：規則看得到前文。改行程是 trip；接著問公車、股票、發票、油價（「那 262 呢」、末班車那題回「307」）照規則的意圖（PR #127 審查）
    // 規則有十足把握（這一句寫了公車路線號碼、問的就是那一路，例「307 到哪了」）：手機或模型判成別的（天氣）也不改（真實資料健檢 d10）
    // 腦袋審查 #3（2026-11-23）：句子有明確關鍵字的生活查詢（天氣、空品、藥局、油價、發票、股票代號、地震、垃圾車、YouBike、附近站牌、捷運）也一樣：
    // 手機看了前文（剛剛在排行程）判成行程、或把「2330 收盤多少」判成天氣時，照規則（路況、行程、聽不懂的句子仍可由手機或模型更正）
    const strong = ruled && !(rules.also || []).length && ((rules.intent === 'bus_route' && !!rules.route) || KEYWORD_INTENTS.has(rules.intent));
    const pick = meta ? ['unknown', 'rules'] : rules.followUp ? [rules.intent === 'trip' || !Object.hasOwn(JUDGE_INTENTS, rules.intent) ? 'trip' : rules.intent, 'rules'] : strong && ((b && b.intent !== rules.intent) || (sure && a.intent !== rules.intent)) ? [rules.intent, 'rules'] : sure ? [a.intent, 'embed'] : b ? [b.intent, dev ? 'device' : 'llm']
      : ruled || !a ? [rules.intent, 'rules'] : a.confidence >= UNSURE_FLOOR ? [a.intent, 'embed'] : ['unknown', 'embed'];
    const [intent, source] = pick;
    const agree = a && b ? a.states.filter((k) => b.states.includes(k)) : [];
    const states = meta ? [] : [...new Set([...rules.states.filter((k) => JUDGE_STATES.includes(k)), ...agree])];
    return { intent, states, confidence: a?.confidence ?? null, source, llmUsed: Boolean(b && !dev), ...(dev && { engine: device.engine }), ...(devEmbed && source === 'embed' && { engine: EMBED_ENGINE }), ...(rules.followUp && { followUp: true, states: [...new Set([...rules.states, ...states])] }), ...(rules.mode && { mode: rules.mode }) };
  };
  const judge = (text, history, opts = {}) => run(text, history, opts);
  /** 快速版：只用 A＋規則（幾毫秒；有裝置端提示也一起用），讓阿幫一送出就能說聽懂了什麼；完整版（含模型）之後再補狀態 */
  judge.quick = (text, history, opts = {}) => run(text, history, { ...opts, quick: true });
  return judge;
}

/**
 * 依環境變數建立判斷層（伺服器啟動時呼叫；模型在背景載入，載入前等同規則）。
 * JUDGE=off 關閉；JUDGE_MODEL_DIR 模型快取位置（容器內要可寫）；有 LOCAL_LLM_URL 時才有 B。
 * @returns {{ judge: Function, ready: Promise<boolean>, info: () => object }}
 */
export function judgeFromEnv(env = process.env, { log = () => {} } = {}) {
  if (env.JUDGE === 'off') return { judge: null, ready: Promise.resolve(false), info: () => ({ enabled: false }) };
  const state = { embed: null, llm: null, error: null };
  let current = createJudge();
  const rebuild = () => { current = createJudge({ embed: state.embed, llm: state.llm }); };
  const ready = (async () => {
    try {
      if (env.LOCAL_LLM_URL) {
        const prompt = (await readFile(new URL('./judge-prompt.txt', import.meta.url), 'utf8')).trim();
        state.llm = createLlmJudge({ url: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL || 'qwen3:8b', apiKey: env.LOCAL_LLM_API_KEY, prompt });
      }
      const train = JSON.parse(await readFile(new URL('../data/judge-train.json', import.meta.url), 'utf8')).items;
      state.embed = await createEmbedClassifier(train, { ...(env.JUDGE_MODEL_DIR && { cacheDir: env.JUDGE_MODEL_DIR }) });
      rebuild();
      log({ message: 'judge ready', embed: true, llm: Boolean(state.llm) });
      return true;
    } catch (e) {
      state.error = e?.code || e?.name || 'Error';
      rebuild(); // 至少有 B（若有設定）；A 載不到就退回規則
      log({ message: 'judge embed unavailable', error: state.error, llm: Boolean(state.llm) });
      return false;
    }
  })();
  const judge = (text, history, opts) => current(text, history, opts);
  judge.quick = (text, history, opts) => current.quick(text, history, opts);
  return { judge, ready, info: () => ({ enabled: true, embed: Boolean(state.embed), llm: Boolean(state.llm), ...(state.error && { error: state.error }) }) };
}
