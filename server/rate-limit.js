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

/** 取得客戶端 IP；只有在 TRUST_PROXY=1（部署在反向代理後）時才採用 X-Forwarded-For */
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
