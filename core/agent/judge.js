// 判斷層（2026-11-20 實驗後導入，docs/research/decision-eval.md）：判斷「意圖」與「使用者狀態」，方案排序仍由 decide.js 計分（ADR-0010）。
//   A 嵌入分類器：transformers.js＋multilingual-e5-small（開源、可在裝置上跑；選用依賴，裝不起來就停用）
//   B 模型判斷：地端模型（OpenAI 相容）＋自動優化過的提示詞（core/agent/judge-prompt.txt）
//   規則：demo-intent.js 的 parseIntent（保底，也負責抽地點、路線號碼等參數）
// 組合（實驗結果）：
//   意圖＝A 信心 ≥ 0.8 用 A，否則有模型就問 B，沒有模型就用 A（A 平均 86.6% 仍優於規則 68%）
//   狀態＝規則 ∪（A ∩ B）——規則精準、A 與 B 都說有才加（全對 89.5%，驗收集 88.4%）
//   B 只在「A 沒把握」或「是行程問題（狀態才有用）」時才問，其餘不花模型呼叫
import { readFile } from 'node:fs/promises';
import { parseIntent } from './demo-intent.js';

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
  unknown: '以上都不是：閒聊、其他服務、阿幫不提供的資訊',
};
export const JUDGE_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir', 'elder', 'kids', 'mobility'];
export const CONFIDENT = 0.8;
/** 裝置端判斷的引擎（ADR-0014）：Apple Intelligence（Foundation Models）、Gemini Nano（ML Kit GenAI） */
export const DEVICE_ENGINES = ['apple', 'gemini-nano'];

const embedText = (it) => `query: ${it.history?.length ? `前文：${it.history.at(-1)}；這句：` : ''}${it.text}`;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

/**
 * A 嵌入分類器：意圖＝各類別訓練向量的中心＋餘弦相似度 softmax（tau 以訓練範例校準）；狀態＝每種一個 logistic regression。
 * @param {Array<{ text: string, intent: string, states: string[], history?: string[] }>} trainItems
 * @param {{ model?: string, tau?: number, cacheDir?: string }} [opts]
 * @returns {Promise<(it: { text: string, history?: string[] }) => Promise<{ intent: string, confidence: number, states: string[] }>>}
 */
export async function createEmbedClassifier(trainItems, { model = 'Xenova/multilingual-e5-small', tau = 0.005, cacheDir = new URL('../../node_modules/.cache/transformers/', import.meta.url).pathname } = {}) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const ex = await pipeline('feature-extraction', model, { dtype: 'q8' });
  const embed = async (texts) => (await ex(texts, { pooling: 'mean', normalize: true })).tolist();
  const X = await embed(trainItems.map(embedText));
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const models = {};
  for (const k of JUDGE_STATES) {
    const y = trainItems.map((t) => (t.states.includes(k) ? 1 : 0));
    const pos = y.filter(Boolean).length;
    const wPos = (y.length - pos) / Math.max(pos, 1); // 正例少：加權
    const w = new Array(X[0].length).fill(0);
    let b = 0;
    for (let epoch = 0; epoch < 400; epoch++) {
      const gw = new Array(w.length).fill(0);
      let gb = 0;
      X.forEach((x, i) => {
        const err = (sig(dot(w, x) + b) - y[i]) * (y[i] ? wPos : 1);
        for (let d = 0; d < x.length; d++) gw[d] += err * x[d];
        gb += err;
      });
      for (let d = 0; d < w.length; d++) w[d] -= (2.0 * gw[d]) / X.length + 1e-3 * w[d];
      b -= (2.0 * gb) / X.length;
    }
    models[k] = { w, b };
  }
  const cent = {};
  X.forEach((x, i) => { const k = trainItems[i].intent; cent[k] ||= new Array(x.length).fill(0); x.forEach((v, d) => { cent[k][d] += v; }); });
  for (const k of Object.keys(cent)) { const n = Math.sqrt(dot(cent[k], cent[k])); cent[k] = cent[k].map((v) => v / n); }
  return async (it) => {
    const [v] = await embed([embedText(it)]);
    const sims = Object.entries(cent).map(([k, c]) => [k, dot(v, c)]);
    const mx = Math.max(...sims.map((x) => x[1]));
    const e = sims.map(([k, s]) => [k, Math.exp((s - mx) / tau)]);
    const total = e.reduce((a, [, x]) => a + x, 0);
    const [intent, p] = e.map(([k, x]) => [k, x / total]).sort((a, b) => b[1] - a[1])[0];
    return { intent, confidence: p, states: JUDGE_STATES.filter((k) => sig(dot(models[k].w, v) + models[k].b) > 0.5) };
  };
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
 * @returns {(text: string, history?: string[], opts?: { device?: { intent: string, states: string[], engine: string } }) => Promise<{ intent: string, states: string[], confidence: number|null, source: 'embed'|'llm'|'device'|'rules', llmUsed: boolean, engine?: string }>}
 */
export function createJudge({ embed = null, llm = null, threshold = CONFIDENT } = {}) {
  const run = async (text, history = [], { quick = false, device = null } = {}) => {
    // 裝置端提示（ADR-0014：手機上的 Apple Intelligence／Gemini Nano 先判斷好）：伺服器沒有自己的模型（B）時當作 B；
    // 有 B 時只用在快速版（評測：A＋規則＋Gemini Nano 全對 89.0%，A＋規則＋地端 qwen3:8b 89.5%，docs/research/edge-eval.md）
    const dev = device && (quick || !llm) ? { intent: device.intent, states: device.states || [] } : null;
    const it = { text, ...(history.length && { history }) };
    const rules = parseIntent(text, { history: history.map((content) => ({ role: 'user', content })) });
    const a = embed ? await embed(it).catch(() => null) : null;
    const sure = a && a.confidence >= threshold;
    const wantLlm = !dev && !quick && !rules.followUp && llm && (!sure || a.intent === 'trip' || rules.intent === 'trip');
    const b = dev || (wantLlm ? await llm(it).catch(() => null) : null);
    // 接著上一輪改行程（「改成公車 601」「我很趕」）：規則看得到前文，以它為準（分類器只看這一句，會誤判成查公車）
    const intent = rules.followUp ? 'trip' : sure ? a.intent : b ? b.intent : a ? a.intent : rules.intent;
    const agree = a && b ? a.states.filter((k) => b.states.includes(k)) : [];
    const states = [...new Set([...rules.states.filter((k) => JUDGE_STATES.includes(k)), ...agree])];
    return { intent, states, confidence: a?.confidence ?? null, source: rules.followUp ? 'rules' : sure ? 'embed' : b ? (dev ? 'device' : 'llm') : a ? 'embed' : 'rules', llmUsed: Boolean(b && !dev), ...(dev && { engine: device.engine }), ...(rules.followUp && { followUp: true, states: [...new Set([...rules.states, ...states])] }), ...(rules.mode && { mode: rules.mode }) };
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
