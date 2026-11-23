// 判斷層 A 嵌入分類器的純函式（AGENT.md §5.3）：伺服器（core/agent/judge.js）與手機上的小模型（public/js/edge-embed-worker.js，E3）共用同一份，
// 兩邊判斷才會一致。這裡不載入模型、不讀檔：只負責「嵌入向量 → 意圖與狀態」。
//   意圖＝各類別訓練向量的中心＋餘弦相似度 softmax（tau 以訓練範例校準）；狀態＝每種一個 logistic regression。
// 手機用的參數 core/data/judge-classifier.json 由 scripts/build-edge-classifier.js 從 core/data/judge-train.json 算出（test/judge-classify.test.js 檢查兩者同步）。

/** 嵌入模型（multilingual-e5-small，量化 q8：約 118 MB＋詞表 17 MB） */
export const EMBED_MODEL = 'Xenova/multilingual-e5-small';
export const EMBED_DTYPE = 'q8';
export const EMBED_TAU = 0.005;
/** 手機上的小模型要下載的檔案（相對於模型資料夾；伺服器 /edge-model/ 只開放這幾個） */
export const EMBED_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
/** 與 core/agent/judge.js 的 JUDGE_STATES 相同 */
export const CLASSIFY_STATES = ['rush', 'luggage', 'budget', 'lessWalk', 'rain', 'badAir', 'elder', 'kids', 'mobility'];

/** e5 的查詢格式；有前文時帶上最後一句（與訓練時相同） */
export const embedText = (it) => `query: ${it.history?.length ? `前文：${it.history.at(-1)}；這句：` : ''}${it.text}`;
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sig = (z) => 1 / (1 + Math.exp(-z));

/**
 * 從訓練向量算出分類器參數。
 * @param {number[][]} X 每筆訓練範例的嵌入向量（已正規化）
 * @param {Array<{ intent: string, states: string[] }>} items 對應的標註
 * @returns {{ tau: number, intents: Record<string, number[]>, states: Record<string, { w: number[], b: number }> }}
 */
export function trainClassifier(X, items, { tau = EMBED_TAU, states = CLASSIFY_STATES } = {}) {
  const models = {};
  for (const k of states) {
    const y = items.map((t) => (t.states.includes(k) ? 1 : 0));
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
  X.forEach((x, i) => { const k = items[i].intent; cent[k] ||= new Array(x.length).fill(0); x.forEach((v, d) => { cent[k][d] += v; }); });
  for (const k of Object.keys(cent)) { const n = Math.sqrt(dot(cent[k], cent[k])); cent[k] = cent[k].map((v) => v / n); }
  return { tau, intents: cent, states: models };
}

/**
 * 一個嵌入向量 → 意圖（含信心）與狀態。
 * @param {number[]} v 這一句的嵌入向量（已正規化）
 * @param {ReturnType<typeof trainClassifier>} params
 * @returns {{ intent: string, confidence: number, states: string[] }}
 */
export function classifyVector(v, params) {
  const sims = Object.entries(params.intents).map(([k, c]) => [k, dot(v, c)]);
  const mx = Math.max(...sims.map((x) => x[1]));
  const e = sims.map(([k, s]) => [k, Math.exp((s - mx) / params.tau)]);
  const total = e.reduce((a, [, x]) => a + x, 0);
  const [intent, p] = e.map(([k, x]) => [k, x / total]).sort((a, b) => b[1] - a[1])[0];
  return { intent, confidence: p, states: Object.keys(params.states).filter((k) => sig(dot(params.states[k].w, v) + params.states[k].b) > 0.5) };
}

/** 存檔用：數字取 6 位小數（約 10 萬字元；判斷結果與未取整相同，測試比對） */
export function roundParams(params, digits = 6) {
  const r = (x) => Number(x.toFixed(digits));
  return {
    tau: params.tau,
    intents: Object.fromEntries(Object.entries(params.intents).map(([k, c]) => [k, c.map(r)])),
    states: Object.fromEntries(Object.entries(params.states).map(([k, m]) => [k, { w: m.w.map(r), b: r(m.b) }])),
  };
}

/**
 * 檢查 judge-classifier.json 的形狀（手機下載後、伺服器提供前都會檢查；不對就不用，退回規則）。
 * @returns {boolean}
 */
export function validParams(p, { intents = null, dim = 384 } = {}) {
  if (!p || typeof p !== 'object' || !(p.tau > 0) || !p.intents || !p.states) return false;
  const vec = (a) => Array.isArray(a) && a.length === dim && a.every(Number.isFinite);
  const ik = Object.keys(p.intents);
  if (!ik.length || !ik.every((k) => vec(p.intents[k]) && (!intents || intents.includes(k)))) return false;
  return Object.keys(p.states).every((k) => CLASSIFY_STATES.includes(k) && vec(p.states[k]?.w) && Number.isFinite(p.states[k]?.b));
}
