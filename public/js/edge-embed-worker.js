// 手機上的小模型（E3，ADR-0014 補充）：在 Web Worker 裡跑 transformers.js＋multilingual-e5-small（與伺服器判斷層 A 同一個模型），主執行緒不卡。
// 只判斷「意圖、狀態、信心」（core/judge-classify.js，與伺服器共用）；句子不離開這支手機的這個執行緒，結果才由主執行緒當 deviceJudge 送出。
// 模型檔只從阿幫自己的伺服器（/edge-model/）下載，存在這支手機的 IndexedDB（不用 Cache API：iOS App 的 capacitor:// 來源不一定有）。
// 訊息：{ id, op: 'load'|'judge'|'has'|'delete', ... } → { id, ok?, result?, progress?, error? }
import { EMBED_MODEL, EMBED_DTYPE, embedText, classifyVector, validParams } from '../../core/judge-classify.js';
import { ORT_MJS, embedUrls } from './edge-embed-files.js';

const DB = 'abang-edge-embed';
const STORE = 'files';

// ───── IndexedDB 快取（transformers.js 的 customCache 介面：match、put）─────
let dbp = null;
const openDb = () => (dbp ||= new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => { dbp = null; reject(r.error); };
}));
const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
};
const keyOf = (k) => String(typeof k === 'string' ? k : k?.url || k);
const idbCache = {
  async match(key) {
    const blob = await tx('readonly', (s) => s.get(keyOf(key))).catch(() => undefined);
    return blob ? new Response(blob, { headers: { 'content-length': String(blob.size) } }) : undefined;
  },
  async put(key, response) {
    const blob = await response.blob();
    await tx('readwrite', (s) => s.put(blob, keyOf(key)));
  },
  keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
  clear: () => tx('readwrite', (s) => s.clear()),
};

let ex = null; // feature-extraction pipeline
let params = null;
let loading = null;
let origFetch = null;

/** 先自己下載 .wasm（有進度；transformers.js 下載 .wasm 不回報進度），放進快取，之後 transformers.js 從快取拿 */
async function fetchWasm(url, onBytes) {
  if (await idbCache.match(url)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`server-missing ${r.status}`);
  const reader = r.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  await idbCache.put(url, new Response(new Blob(parts)));
}

/**
 * 載入模型。remote＝true 時才會連網下載（使用者按「下載」）；平常開 App 只從快取載入，快取不完整就丟錯（不偷偷用行動網路下載 160 MB）。
 * @param {{ api: string, remote?: boolean, sizes?: Record<string, number> }} o sizes：各檔大小（主執行緒先用 HEAD 查好，算總進度）
 */
async function load({ api, remote = false, classifier }, progress) {
  if (ex) return;
  if (!validParams(classifier)) throw new Error('bad-classifier');
  const urls = embedUrls(api);
  if (!remote) {
    const have = new Set(await idbCache.keys());
    if (!urls.every((u) => have.has(u))) throw new Error('not-downloaded');
  }
  const T = await import('../vendor/transformers.min.js');
  const { pipeline, env } = T;
  env.allowLocalModels = false;
  env.allowRemoteModels = true; // 兩個都關 transformers.js 會拒絕；只從快取：先檢查快取齊全＋擋掉 fetch
  env.remoteHost = `${api}/edge-model/`;
  env.remotePathTemplate = '{model}/';
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = true;
  env.customCache = idbCache;
  env.useWasmCache = true;
  origFetch ||= env.fetch;
  env.fetch = remote ? origFetch : () => Promise.reject(new Error('not-downloaded')); // 只從快取：擋掉下載（同一個 Worker 之後按下載要恢復）
  const onnx = env.backends.onnx;
  onnx.wasm.numThreads = 1; // WebView 沒有跨來源隔離，用不到多執行緒
  onnx.wasm.proxy = false;
  onnx.wasm.wasmPaths = { mjs: new URL(`../vendor/${ORT_MJS}`, import.meta.url).href, wasm: urls[0] };
  let done = 0;
  if (remote) await fetchWasm(urls[0], (n) => { done += n; progress(done); });
  const base = done;
  const seen = {};
  ex = await pipeline('feature-extraction', EMBED_MODEL, {
    dtype: EMBED_DTYPE, device: 'wasm',
    progress_callback: remote ? (p) => { if (p.status === 'progress' && p.file) { seen[p.file] = p.loaded || 0; progress(base + Object.values(seen).reduce((a, b) => a + b, 0)); } } : undefined,
  });
  params = classifier;
  await ex(['query: 暖身'], { pooling: 'mean', normalize: true }); // 第一次推論較慢：先跑一次
}

async function judge({ text, history = [] }) {
  if (!ex || !params) throw new Error('not-loaded');
  const t0 = performance.now();
  const out = await ex([embedText({ text: String(text).slice(0, 500), ...(history.length && { history: history.slice(-1).map((h) => String(h).slice(0, 200)) }) })], { pooling: 'mean', normalize: true });
  const r = classifyVector(Array.from(out.data), params);
  return { ...r, ms: Math.round(performance.now() - t0) };
}

self.onmessage = async ({ data }) => {
  const { id, op } = data || {};
  const post = (o) => self.postMessage({ id, ...o });
  try {
    if (op === 'load') {
      loading ||= load(data, (bytes) => post({ progress: bytes })).finally(() => { loading = null; });
      await loading;
      post({ ok: true });
    } else if (op === 'judge') post({ ok: true, result: await judge(data) });
    else if (op === 'has') { const have = new Set(await idbCache.keys()); post({ ok: true, result: embedUrls(data.api).every((u) => have.has(u)) }); }
    else if (op === 'delete') { ex?.dispose?.().catch?.(() => {}); ex = null; params = null; await idbCache.clear(); post({ ok: true }); }
    else post({ error: 'bad-op' });
  } catch (e) {
    post({ error: String(e?.message || e).slice(0, 200) });
  }
};
