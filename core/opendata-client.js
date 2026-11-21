// 免金鑰政府開放資料 client（生活服務：油價、發票、藥局、垃圾車…）：逾時、快取（TTL）、計量、錯誤訊息不含網址參數。
// 只下載公開資料，不送任何使用者資料；同一網址同時只下載一次。
import { recordFetch } from './metrics.js';

export class OpenDataError extends Error {
  constructor(msg, status = 502) { super(msg); this.name = 'OpenDataError'; this.status = status; }
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number }} [opts]
 */
export function createOpenDataClient({ fetchImpl = fetch, now = () => Date.now(), timeoutMs = 30_000 } = {}) {
  const cache = new Map(); // key → { exp, data } 或 { pending }

  /**
   * @param {string} url
   * @param {{ ttlSec: number, label: string, as?: 'text'|'json', parse?: (raw: any) => any, headers?: object }} o
   *   label：錯誤訊息用的資料名稱；parse：下載後轉成要快取的資料（解析失敗視為上游錯誤）
   */
  async function get(url, { ttlSec, label, as = 'text', parse = (x) => x, headers }) {
    const hit = cache.get(url);
    if (hit?.data !== undefined && now() < hit.exp) { recordFetch({ cacheHit: true, data: hit.data }); return hit.data; }
    if (hit?.pending) return hit.pending;
    const pending = (async () => {
      let res;
      try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), ...(headers && { headers }) }); } catch { throw new OpenDataError(`${label}連線失敗，請稍後再試`); }
      if (!res.ok) throw Object.assign(new OpenDataError(`${label}回應錯誤（HTTP ${res.status}）`), { upstreamStatus: res.status }); // upstreamStatus：服務層分辨「找不到」與上游故障
      let data;
      try { data = parse(as === 'json' ? await res.json() : await res.text()); } catch (e) { throw new OpenDataError(`${label}格式不符預期：${e.message}`); }
      recordFetch({ cacheHit: false, data });
      cache.set(url, { exp: now() + ttlSec * 1000, data });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return data;
    })().catch((e) => {
      // 更新失敗：有舊資料就先用舊的（標示 stale），沒有才丟錯
      if (hit?.data !== undefined) { cache.set(url, { exp: now() + 60_000, data: hit.data }); return hit.data; }
      cache.delete(url);
      throw e;
    });
    cache.set(url, { ...(hit || {}), pending });
    return pending;
  }
  return { get };
}
