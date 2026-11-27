// 簡易固定視窗限流（單機記憶體）。多實例部署時（M6）改用 Redis。
// key 由呼叫端決定：通常是「路由群組 + 客戶端 IP」，M5 起再加入 agent id（ADR-0007）。

/** 最多記幾個 key（架構第二輪 #5：換 IPv6 位址可以把 Map 撐大）；滿了淘汰最舊的 */
export const MAX_KEYS = 50_000;

export function createRateLimiter({ limit, windowMs = 60_000, maxKeys = MAX_KEYS, now: clock = () => Date.now() }) {
  const hits = new Map(); // key -> { count, resetAt }
  let lastSweep = clock();
  const sweepEvery = Math.min(windowMs, 60_000); // 每日限流的視窗是 24 小時：原本一天才清一次

  return function check(key) {
    const now = clock();
    if (now - lastSweep > sweepEvery) { // 定期清掉過期的 key，避免記憶體成長
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      lastSweep = now;
    }
    let h = hits.get(key);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.delete(key); // 重新放到最後（Map 依插入順序，最前面＝最舊）
      hits.set(key, h);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    }
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
    if (list.length) return ipKey(list.length >= hops ? list[list.length - hops] : list.at(-1)); // 比設定的層數少（設定不符）：用最右邊，不用可偽造的最左邊
  }
  return ipKey(req.socket?.remoteAddress || 'unknown');
}

/**
 * 限流用的位址：IPv4 照原樣（含 ::ffff:1.2.3.4 這種 IPv4-mapped）；IPv6 取前 64 位元（同一個網段＝同一個人，
 * 換位址繞不過每分鐘、每日上限；架構第二輪 #5）。
 */
export function ipKey(ip) {
  const s = String(ip || '').trim().toLowerCase().replace(/%.*$/, ''); // 去掉 zone id（fe80::1%en0）
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) return v4[1];
  if (!s.includes(':')) return s || 'unknown';
  const [head, tail = ''] = s.split('::');
  const a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const full = s.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  if (full.length !== 8 || !full.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return s;
  return `${full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
