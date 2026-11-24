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
import { cleanTopic } from '../topic.js';

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
  // 2026-11-23 產品負責人：阿幫會的每一件事都要有意圖（以前只有 16 類，防詐、叫車、提醒、設定……都落到「其他」）
  intercity: '國道客運：搭客運、長途巴士的班次與時間',
  ridehail: '叫車：計程車、Uber、叫一台車（只給官方連結）',
  booking: '訂票：訂高鐵、台鐵車票（只給官方連結）',
  place: '找地點：某個地方在哪、地址（沒問怎麼去）',
  outing: '出門建議：出門要注意什麼、要不要帶傘或外套、適不適合出門',
  drama: '短劇：找劇、推薦短劇、追劇、MyDrama',
  exercise: '散步運動：今天走太少、要不要去走走、運動建議',
  scam: '詐騙：可疑簡訊、電話、網址、加 LINE、投資群組、假檢警、被騙了怎麼辦',
  reminder: '提醒：提醒我出門、公車快到通知我、下車提醒、取消提醒',
  settings: '設定：常用地點（家、公司）、我有車、語言、通知、隱私',
  help: '問阿幫能做什麼、是誰、怎麼用',
  chat: '閒聊、打招呼、道謝、道歉、稱讚、只回「好」',
  emergency: '緊急求助：受傷、急病、有人昏倒、車禍、失火、遇到危險、想傷害自己',
  unknown: '以上都不是：阿幫沒有提供的服務或資訊（訂餐廳、查快遞…）',
};
export const JUDGE_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir', 'elder', 'kids', 'mobility'];
export const CONFIDENT = 0.8;
/** 規則靠明確關鍵字認出的意圖：判斷層（手機、模型、嵌入分類器）說是別的也照規則（腦袋審查 #3） */
export const KEYWORD_INTENTS = new Set(['weather', 'aqi', 'quake', 'pharmacy', 'garbage', 'fuel', 'invoice', 'stock', 'youbike', 'nearby_bus', 'metro']);
/** A 沒把握、規則也聽不懂時：A 信心低於這個值就當作 unknown（不亂選；「我在等939」0.27、詐騙簡訊 0.42） */
export const UNSURE_FLOOR = 0.5;
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
    return { intent: JUDGE_INTENTS[o.intent] ? o.intent : 'unknown', states: (Array.isArray(o.states) ? o.states : []).filter((k) => JUDGE_STATES.includes(k)), ...(cleanTopic(o.topic) && { topic: cleanTopic(o.topic) }) };
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
    const dev = device && (quick || !llm) ? { intent: device.intent, states: device.states || [], ...(cleanTopic(device.topic) && { topic: cleanTopic(device.topic) }) } : null;
    const it = { text, ...(history.length && { history }) };
    const rules = parseIntent(text, { history: history.map((content) => ({ role: 'user', content })) });
    const a = embed ? await embed(it).catch(() => null) : null;
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
    const pick = meta ? [rules.help && !rules.greet ? 'help' : 'chat', 'rules'] : rules.followUp ? [rules.intent === 'trip' || !Object.hasOwn(JUDGE_INTENTS, rules.intent) ? 'trip' : rules.intent, 'rules'] : strong && ((b && b.intent !== rules.intent) || (sure && a.intent !== rules.intent)) ? [rules.intent, 'rules'] : sure ? [a.intent, 'embed'] : b ? [b.intent, dev ? 'device' : 'llm']
      : ruled || !a ? [rules.intent, 'rules'] : a.confidence >= UNSURE_FLOOR ? [a.intent, 'embed'] : ['unknown', 'embed'];
    const [intent0, source] = pick;
    const intent = finer(intent0, rules, text);
    const agree = a && b ? a.states.filter((k) => b.states.includes(k)) : [];
    const states = meta ? [] : [...new Set([...rules.states.filter((k) => JUDGE_STATES.includes(k)), ...agree])];
    // 範圍外（unknown）：手機或伺服器模型寫的主題（使用者想做什麼）帶著，回答時說得出聽懂了什麼（2026-11-23）
    const topic = intent === 'unknown' && !meta ? b?.topic || null : null;
    return { intent, states, confidence: a?.confidence ?? null, source, llmUsed: Boolean(b && !dev), ...(topic && { topic }), ...(dev && { engine: device.engine }), ...(rules.followUp && { followUp: true, states: [...new Set([...rules.states, ...states])] }), ...(rules.mode && { mode: rules.mode }) };
  };
  const judge = (text, history, opts = {}) => run(text, history, opts);
  /** 快速版：只用 A＋規則（幾毫秒；有裝置端提示也一起用），讓阿幫一送出就能說聽懂了什麼；完整版（含模型）之後再補狀態 */
  judge.quick = (text, history, opts = {}) => run(text, history, { ...opts, quick: true });
  return judge;
}

/** 散步運動的字眼（出門建議裡問的是走走、運動）：判成 exercise */
const EXERCISE = /散步|走走|走一走|運動|跑步|慢跑|健走|動一動|步數|走太少/;
/**
 * 規則已經聽出更細的事（指定搭客運、叫車；出門是要去散步運動）：意圖標得更精確（2026-11-23 阿幫會的每一件事都有意圖）。
 * 執行照舊：intercity／ridehail 仍是指定交通方式的行程、exercise 仍是出門建議（core/agent/demo-intent.js slotsFor）。
 */
export function finer(intent, rules, text) {
  if (intent === 'trip' && (rules.mode === 'intercity' || rules.mode === 'ridehail')) return rules.mode;
  if (intent === 'outing' && EXERCISE.test(String(text || ''))) return 'exercise';
  return intent;
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
