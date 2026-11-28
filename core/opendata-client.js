// 免金鑰政府開放資料 client（生活服務：油價、發票、藥局、垃圾車…）：逾時、快取（TTL）、計量、錯誤訊息不含網址參數。
// 只下載公開資料，不送任何使用者資料；同一網址同時只下載一次。
import { recordFetch } from './metrics.js';
import { shown } from './util.js';

export class OpenDataError extends Error {
  constructor(msg, status = 502) { super(msg); this.name = 'OpenDataError'; this.status = status; }
}

/** 失敗冷卻（毫秒）：沒有舊資料可用又下載失敗時，這段時間內直接回同一個錯誤，不重複打上游（架構審查 2026-11-28） */
export const FAIL_COOLDOWN_MS = 30_000;
/** TTL 至少這麼長（秒）的資料（每日更新的大檔：藥局、診所、辦事須知）過期後先給舊的、背景更新；即時資料照舊等下載 */
export const SWR_MIN_TTL_SEC = 3600;
/** 快取最多幾筆（網址）：超過時最久沒用的先刪；失敗紀錄也算（架構第三輪 #3：原本只有成功時才淘汰，上游斷線時每個不同的查詢字都留一筆） */
export const MAX_ENTRIES = 200;

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number }} [opts]
 */
export function createOpenDataClient({ fetchImpl = fetch, now = () => Date.now(), timeoutMs = 30_000 } = {}) {
  const cache = new Map(); // key → { exp, at, data, pending?, failedAt?, error? }；Map 的順序＝最近用過的在後面
  /** 寫入並移到最新；超過上限刪最久沒用的（下載中的不刪：同一網址同時只下載一次） */
  const put = (url, entry) => {
    cache.delete(url);
    cache.set(url, entry);
    for (const [k, v] of cache) {
      if (cache.size <= MAX_ENTRIES) break;
      if (k !== url && !v.pending) cache.delete(k);
    }
  };
  /** 失敗紀錄只留訊息與狀態（不留錯誤堆疊，記憶體與 log 都小） */
  const slim = (e) => Object.assign(new OpenDataError(e?.message || '資料暫時無法取得', e?.status ?? 502), e?.upstreamStatus && { upstreamStatus: e.upstreamStatus }, e?.publicMsg && { publicMsg: e.publicMsg });

  /**
   * @param {string} url
   * @param {{ ttlSec: number, label: string, as?: 'text'|'json', parse?: (raw: any) => any, headers?: object, maxBytes?: number, swr?: boolean }} o
   *   label：錯誤訊息用的資料名稱；parse：下載後轉成要快取的資料（解析失敗視為上游錯誤）；
   *   swr：過期但還能沿用時先給舊的、背景更新（預設：TTL ≥ 1 小時的資料）
   */
  /** 更新失敗時舊資料最多可以沿用多久（秒）：TTL 的 2 倍、至少 2 分鐘（垃圾車即時位置 TTL 60 秒 → 最多 2 分鐘前的位置；生活資料審查 #3：原本上游一直斷就永遠用舊資料） */
  const staleLimitSec = (ttlSec) => Math.max(ttlSec * 2, 120);
  const usable = (hit, ttlSec) => hit?.data !== undefined && now() - (hit.at ?? 0) <= staleLimitSec(ttlSec) * 1000;

  function refresh(url, hit, { ttlSec, label, as = 'text', parse = (x) => x, headers, maxBytes }) {
    const pending = (async () => {
      let res;
      try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), ...(headers && { headers }) }); } catch { throw shown(new OpenDataError(`${label}連線失敗，請稍後再試`), `${label}暫時連不上，請稍後再試。`); }
      if (!res.ok) throw Object.assign(shown(new OpenDataError(`${label}回應錯誤（HTTP ${res.status}）`), `${label}暫時無法取得，請稍後再試。`), { upstreamStatus: res.status }); // upstreamStatus：服務層分辨「找不到」與上游故障
      // maxBytes：回應大小上限（宣告的長度或實際讀到的超過就不解析）
      if (maxBytes && Number(res.headers?.get?.('content-length')) > maxBytes) throw shown(new OpenDataError(`${label}回應太大`), `${label}的資料格式有變，阿幫暫時讀不到，請稍後再試。`);
      let body;
      try { body = maxBytes || as !== 'json' ? await res.text() : await res.json(); } catch { throw shown(new OpenDataError(`${label}格式不符預期：讀不到內容`), `${label}的資料格式有變，阿幫暫時讀不到，請稍後再試。`); }
      if (maxBytes && Buffer.byteLength(String(body)) > maxBytes) throw shown(new OpenDataError(`${label}回應太大`), `${label}的資料格式有變，阿幫暫時讀不到，請稍後再試。`);
      let data;
      try { data = parse(as === 'json' && typeof body === 'string' ? JSON.parse(body) : body); } catch (e) { throw shown(new OpenDataError(`${label}格式不符預期：${e.message}`), `${label}的資料格式有變，阿幫暫時讀不到，請稍後再試。`); } // 解析錯誤的細節只進 log
      recordFetch({ cacheHit: false, data });
      put(url, { exp: now() + ttlSec * 1000, at: now(), data });
      return data;
    })().catch((e) => {
      // 更新失敗：舊資料還不算太舊（staleLimitSec）就先用舊的，太舊或沒有就丟錯（照實說資料暫時拿不到，不把幾小時前的資料當現在）
      if (usable(hit, ttlSec)) { put(url, { ...hit, exp: Math.min(now() + 60_000, (hit.at ?? 0) + staleLimitSec(ttlSec) * 1000) }); return hit.data; }
      const err = slim(e);
      put(url, { failedAt: now(), error: err }); // 冷卻：這段時間內不重複下載
      throw err;
    });
    put(url, { ...(hit || {}), pending });
    return pending;
  }

  async function get(url, o) {
    const hit = cache.get(url);
    if (hit?.data !== undefined && now() < hit.exp) { cache.delete(url); cache.set(url, hit); recordFetch({ cacheHit: true, data: hit.data }); return hit.data; } // 用過的移到最新（最久沒用的先刪）
    if (hit?.pending) return hit.data !== undefined && (o.swr ?? o.ttlSec >= SWR_MIN_TTL_SEC) && usable(hit, o.ttlSec) ? hit.data : hit.pending;
    if (hit?.error && now() - hit.failedAt < FAIL_COOLDOWN_MS) throw hit.error;
    // 每日更新的大檔：過期但還能沿用 → 先給舊的，背景更新（使用者不用等 16 MB 下載與解析）
    if ((o.swr ?? o.ttlSec >= SWR_MIN_TTL_SEC) && usable(hit, o.ttlSec)) {
      refresh(url, hit, o).catch(() => {}); // 背景更新失敗已在 refresh 裡處理（沿用或冷卻）
      recordFetch({ cacheHit: true, data: hit.data });
      return hit.data;
    }
    return refresh(url, hit, o);
  }
  return { get, size: () => cache.size };
}
