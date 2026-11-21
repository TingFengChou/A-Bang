// 每次 tool 呼叫的計量（M3-13，AGENT.md §3.1 tool_result.metrics）：上游呼叫數、快取命中、掃描筆數、耗時。
// 以 AsyncLocalStorage 隔開同時進行的請求（共用同一個 TDX client 也不會互相干擾）；只在伺服器端使用。
// 數字一律來自實際呼叫（ADR-0009）；示範模式不呼叫上游，calls／scanned 為 0。
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/** 回應中的資料筆數：陣列長度，或包在物件裡的第一個陣列（例 { Sections: [...] }、CWA { records: { Station: [...] } }） */
export function countRecords(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== 'object') return 0;
  const inner = data.records && typeof data.records === 'object' ? data.records : data;
  const list = Object.values(inner).find(Array.isArray);
  return list ? list.length : 1;
}

/** client 每次取資料（快取或上游）時呼叫；不在 measure() 範圍內時什麼都不做 */
export function recordFetch({ cacheHit, data }) {
  const m = als.getStore();
  if (!m) return;
  m.calls++;
  if (cacheHit) m.cacheHits++;
  m.scanned += countRecords(data);
}

/** 這次 tool 呼叫有一部分因上游額度用完改用示範資料（TDX 429 → mock；工具結果的 mode 標成 demo） */
export function markFallback() {
  const m = als.getStore();
  if (m) m.fallback = true;
}

/**
 * 在計量範圍內執行 fn。
 * @returns {Promise<{ result: any, metrics: { calls: number, cacheHits: number, cacheHit: boolean, scanned: number, ms: number } }>}
 */
export async function measure(fn) {
  const m = { calls: 0, cacheHits: 0, scanned: 0 };
  const t0 = performance.now();
  const result = await als.run(m, fn);
  return { result, metrics: { ...m, cacheHit: m.calls > 0 && m.cacheHits === m.calls, ms: Math.round(performance.now() - t0) } }; // m.fallback：有改用示範資料
}
