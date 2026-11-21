// TDX 運輸資料流通服務 client：OIDC client_credentials token 快取 + 回應快取
// 文件：https://github.com/tdxmotc/SampleCode
import { recordFetch } from './metrics.js';

const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api';

export class TdxError extends Error {
  constructor(status, msg) { super(msg); this.name = 'TdxError'; this.status = status; }
}

/** 免費方案每秒可呼叫的次數有限：同時最多幾個請求、兩次請求至少間隔多久（2026-11-21 實測行程比較會連續呼叫數次而被擋 429） */
export const TDX_LIMIT = { concurrent: 3, gapMs: 220, retryMs: 1200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTdxClient({ clientId, clientSecret, fetchImpl = fetch, log = () => {}, limit = TDX_LIMIT }) {
  // 請求排隊：最多 limit.concurrent 個同時進行，且每次送出至少間隔 limit.gapMs
  let active = 0;
  let lastAt = 0;
  const queue = [];
  const pump = () => {
    while (active < limit.concurrent && queue.length) {
      const job = queue.shift();
      active++;
      const wait = Math.max(0, lastAt + limit.gapMs - Date.now());
      lastAt = Date.now() + wait;
      sleep(wait).then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  };
  const throttled = (run) => new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); pump(); });
  let token = null;
  let tokenExp = 0;
  let tokenPromise = null;
  const cache = new Map(); // url -> { exp, data }

  async function getToken() {
    if (token && Date.now() < tokenExp) return token;
    // single-flight：token endpoint 每 IP 每分鐘限 20 次
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const res = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        });
        if (!res.ok) throw new TdxError(res.status, `TDX token 取得失敗 (${res.status})，請確認 Client ID / Secret`);
        const j = await res.json();
        token = j.access_token;
        tokenExp = Date.now() + (j.expires_in - 300) * 1000; // 提前 5 分鐘換新
        log('[tdx] token refreshed');
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  /**
   * GET TDX API
   * @param {string} path 例如 '/basic/v2/Bus/Route/City/Taipei'
   * @param {object} query OData 參數，例如 { $top: 10, $filter: "..." }
   * @param {number} ttlSec 快取秒數（即時資料建議 15~30，靜態資料 3600+）
   */
  async function get(path, query = {}, ttlSec = 20) {
    const qs = new URLSearchParams({ $format: 'JSON', ...query });
    const url = `${API_BASE}${path}?${qs.toString().replace(/\+/g, '%20')}`; // OData 空白用 %20 較保險
    const hit = cache.get(url);
    if (hit && Date.now() < hit.exp) { recordFetch({ cacheHit: true, data: hit.data }); return hit.data; }

    const doFetch = () => throttled(async () =>
      fetchImpl(url, { headers: { authorization: `Bearer ${await getToken()}`, 'accept-encoding': 'br, gzip' } }));

    let res = await doFetch();
    if (res.status === 401) { token = null; res = await doFetch(); } // token 失效重試一次
    if (res.status === 429) { // 每秒次數超過：照 Retry-After（沒有就等一下）重試一次
      const after = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : limit.retryMs);
      log('[tdx] 429, retry once');
      res = await doFetch();
    }
    if (res.status === 429) { // 額度用完：照 TDX 回的重置秒數說清楚（免費帳號審核前每分鐘只有 5 次，2026-11-21 實測）
      const reset = Number(res.headers?.get?.('ratelimit-reset') ?? res.headers?.get?.('retry-after'));
      const perMin = Number(res.headers?.get?.('x-ratelimit-limit-minute'));
      throw new TdxError(429, `TDX 呼叫次數已達方案上限${Number.isFinite(perMin) && perMin > 0 ? `（每分鐘 ${perMin} 次）` : ''}，請${Number.isFinite(reset) && reset > 0 ? `約 ${Math.ceil(reset)} 秒後` : '稍後'}再試`);
    }
    if (!res.ok) throw new TdxError(res.status, `TDX API 錯誤 ${res.status}：${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    recordFetch({ cacheHit: false, data });
    cache.set(url, { exp: Date.now() + ttlSec * 1000, data });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return data;
  }

  return { get };
}
