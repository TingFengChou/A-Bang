// 手機上的小模型（E3，ADR-0014 補充）：主執行緒這一側。模型在 Web Worker 跑（edge-embed-worker.js），這裡只管下載、載入、判斷與狀態。
// 使用者在設定頁按「下載」才會抓（約 160 MB，從阿幫自己的伺服器）；之後開 App 只從手機上的快取載入，不會偷偷再下載。
// 手機內建的 AI（Apple Intelligence／Gemini Nano）不能用時才由它接手判斷意圖與狀態（edge-judge.js edgeJudge）。
import { embedUrls } from './edge-embed-files.js';

export const EMBED_ENGINE = 'e5';
export const EMBED_KEY = 'abang.edgeEmbed';
/** 判斷最多等多久（Worker 裡約幾十毫秒；還在載入就不等） */
export const EMBED_TIMEOUT_MS = 1500;

let worker = null;
let seq = 0;
const pending = new Map();
/** idle 沒下載／還沒載入｜downloading｜loading 從快取載入中｜ready｜evicted 手機清掉了快取｜missing 伺服器沒有提供｜error */
let state = 'idle';
let progress = null; // { loaded, total }
let lastError = null;
let gen = 0; // 刪除後，之前那次下載或載入晚到的結果不再改狀態
const listeners = new Set();
const set = (s, extra = {}) => { state = s; Object.assign(info, extra); for (const f of listeners) { try { f(embedState()); } catch { /* 畫面已關 */ } } };
const info = {};

/** API 位址：App 打包時注入；網頁版同一個網域 */
export const embedApi = () => String(globalThis.__ABANG_API_BASE__ || globalThis.location?.origin || '').replace(/\/+$/, '');

// WebAssembly SIMD（onnxruntime-web 需要；iOS 16.4 以上、Android WebView 都有）
const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
/** 這個瀏覽器（WebView）跑得動嗎：Worker、WebAssembly SIMD、IndexedDB */
export function embedSupported() {
  try { return typeof Worker === 'function' && typeof indexedDB === 'object' && !!globalThis.WebAssembly?.validate?.(SIMD); } catch { return false; }
}

/** 使用者下載過、要用嗎（設定頁的開關；刪除後就是關） */
export function embedWanted() {
  try { return globalThis.localStorage?.getItem(EMBED_KEY) === 'on'; } catch { return false; }
}
const setWanted = (on) => { try { if (on) globalThis.localStorage.setItem(EMBED_KEY, 'on'); else globalThis.localStorage.removeItem(EMBED_KEY); } catch { /* 無痕 */ } };

/** 現在的狀態（設定頁、阿幫的腦袋顯示） */
export const embedState = () => ({ state, wanted: embedWanted(), supported: embedSupported(), ...(progress && { progress: { ...progress } }), ...(lastError && { error: lastError }) });
export const embedReady = () => state === 'ready';
/** 狀態變了通知（回傳取消函式） */
export function onEmbedChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./edge-embed-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data?.id);
    if (!p) return;
    if (data.progress != null) { p.onProgress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
  };
  worker.onerror = () => { for (const p of pending.values()) p.reject(new Error('worker-error')); pending.clear(); worker = null; if (state !== 'idle') set('error'); };
  return worker;
}
const call = (op, payload = {}, onProgress = null) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject, onProgress });
  getWorker().postMessage({ id, op, ...payload });
});

let classifierP = null;
/** 分類器參數（core/data/judge-classifier.json；網頁版由伺服器 /core/ 提供，App 打包在裡面） */
const classifier = () => (classifierP ||= fetch(new URL('../../core/judge-classifier.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error('bad-classifier'); return r.json(); }).catch((e) => { classifierP = null; throw e; }));

/** 要下載多大（HEAD 查各檔大小）；伺服器沒有提供 → null */
export async function embedDownloadSize(api = embedApi()) {
  try {
    const sizes = await Promise.all(embedUrls(api).map(async (u) => { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) throw new Error('missing'); return Number(r.headers.get('content-length')) || 0; }));
    return sizes.reduce((a, b) => a + b, 0);
  } catch { return null; }
}

/**
 * 使用者按「下載」：抓模型、存在手機、載入。完成後記住（之後開 App 自動從手機上載入）。
 * @param {(p: { loaded: number, total: number }) => void} [onProgress]
 * @returns {Promise<boolean>}
 */
export async function downloadEmbed(onProgress = () => {}) {
  if (!embedSupported() || state === 'downloading' || state === 'loading') return false;
  const api = embedApi();
  lastError = null;
  const total = await embedDownloadSize(api);
  if (total == null) { set('missing'); return false; }
  progress = { loaded: 0, total };
  set('downloading');
  const my = gen;
  try {
    await call('load', { api, remote: true, classifier: await classifier() }, (loaded) => { progress = { loaded: Math.min(loaded, total), total }; onProgress(progress); set('downloading'); });
    if (my !== gen) return false;
    setWanted(true);
    progress = null;
    set('ready');
    return true;
  } catch (e) {
    if (my !== gen) return false;
    lastError = String(e.message).slice(0, 80);
    progress = null;
    set(/server-missing|404/.test(e.message) ? 'missing' : 'error');
    return false;
  }
}

/** 開 App 後（進問阿幫頁）從手機上的快取載入；沒下載過或已載入就不做事。快取被系統清掉 → evicted（設定頁請使用者重新下載） */
export async function warmEmbed() {
  if (!embedWanted() || !embedSupported() || state !== 'idle') return;
  set('loading');
  const my = gen;
  try {
    await call('load', { api: embedApi(), remote: false, classifier: await classifier() });
    if (my === gen) set('ready');
  } catch (e) {
    if (my !== gen) return;
    lastError = String(e.message).slice(0, 80);
    set(/not-downloaded/.test(e.message) ? 'evicted' : 'error');
  }
}

/**
 * 判斷這一句（意圖、狀態、信心）；還沒載入、逾時、失敗 → null。
 * @returns {Promise<{ intent: string, states: string[], confidence: number, ms: number } | null>}
 */
export async function embedJudge(text, history = [], { timeout = EMBED_TIMEOUT_MS } = {}) {
  if (state !== 'ready' || !text) return null;
  let timer;
  try {
    return await Promise.race([call('judge', { text: String(text), history: history.slice(-1) }), new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout); })]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 刪除手機上的小模型（釋放約 160 MB）並關掉 */
export async function deleteEmbed() {
  setWanted(false);
  gen++;
  try { await call('delete'); } catch { /* 刪不掉也關掉 */ }
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('deleted')); // 還在等的下載或載入：結束掉（gen 已變，不會改狀態）
  pending.clear();
  progress = null;
  lastError = null;
  set('idle');
}

/** 測試用 */
export const _resetEmbed = () => { worker = null; pending.clear(); state = 'idle'; progress = null; lastError = null; classifierP = null; };
