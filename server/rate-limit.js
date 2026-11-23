// 簡易固定視窗限流（單機記憶體）。多實例部署時（M6）改用 Redis。
// key 由呼叫端決定：通常是「路由群組 + 客戶端 IP」，M5 起再加入 agent id（ADR-0007）。

export function createRateLimiter({ limit, windowMs = 60_000 }) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = Date.now();

  return function check(key) {
    const now = Date.now();
    if (now - lastSweep > windowMs) { // 定期清掉過期的 key，避免記憶體成長
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      lastSweep = now;
    }
    let h = hits.get(key);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + windowMs }; hits.set(key, h); }
    h.count++;
    return {
      ok: h.count <= limit,
      limit,
      remaining: Math.max(0, limit - h.count),
      retryAfterSec: Math.ceil((h.resetAt - now) / 1000),
    };
  };
}

/**
 * 取得客戶端 IP。TRUST_PROXY=N（N ≥ 1，部署在 N 層反向代理後）時才採用 X-Forwarded-For，
 * 而且取「從右邊數第 N 個」：最右邊是離我們最近的代理加上的；左邊的可以由客戶端自己偽造，不能拿來限流。
 * 例：TRUST_PROXY=1、X-Forwarded-For: 偽造, 真正的客戶端 → 真正的客戶端。
 */
export function clientIp(req) {
  const hops = Number.parseInt(process.env.TRUST_PROXY ?? '0', 10);
  if (hops >= 1) {
    const xff = req.headers['x-forwarded-for'];
    const list = (Array.isArray(xff) ? xff.join(',') : String(xff ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list.length >= hops ? list[list.length - hops] : list.at(-1); // 比設定的層數少（設定不符）：用最右邊，不用可偽造的最左邊
  }
  return req.socket?.remoteAddress || 'unknown';
}
