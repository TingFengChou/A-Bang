// 前端 API client：呼叫自家 HTTP API（TDX 金鑰只在伺服器）。
// 若頁面以「離線 Demo」打包（window.__DEMO_SERVICES__ 存在），則直接呼叫核心的示範服務。
import { API_BASE } from './base.js';

const demo = globalThis.__DEMO_SERVICES__;
/** staleAt：目前畫面用的是連不上時的舊資料（那份資料的時間，ms）；null＝最新 */
export const state = { mode: demo ? 'demo' : 'unknown', sources: null, staleAt: null };

// 離線與弱網：成功的回應存在這支手機，連不上時先顯示上次的資料並標出時間（不假裝是最新的）。
// 只存明確允許的查詢（cache：保留多久）：到站時間 10 分鐘、路線與時刻表 24 小時；參數有座標的一律不存（不留位置紀錄）。
const CACHE_KEY = 'abang.offline';
export const CACHE_MAX = 30;
/** 整份離線資料最多多大（跟收藏、我的發票共用手機空間，不能擠掉它們） */
export const CACHE_BYTES = 300_000;
export const TTL = { eta: 10 * 60e3, day: 24 * 3600e3 };
/** 弱網：等這麼久還沒回應就當連不上（用上次的資料） */
export const TIMEOUT_MS = 8000;
const valid = (e, now) => e && typeof e === 'object' && Number.isFinite(e.at) && Number.isFinite(e.ttl) && now - e.at < e.ttl && 'data' in e;
function readCache(now = Date.now()) {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).filter(([, e]) => valid(e, now))); // 過期的不留（隱私權政策：24 小時內）
  } catch { return {}; }
}
function writeCache(key, entry) {
  try {
    const all = { ...readCache(), [key]: entry };
    let keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, CACHE_MAX); // 新的在前
    for (;;) {
      if (!keys.length) { localStorage.removeItem(CACHE_KEY); return; }
      const text = JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]])));
      if (text.length <= CACHE_BYTES) {
        try { localStorage.setItem(CACHE_KEY, text); return; } catch { /* 手機空間不夠：再丟舊的 */ }
      }
      keys = keys.slice(0, -1);
    }
  } catch { /* 存不了就算了，不影響這次查詢 */ }
}
const signal = (type, detail) => globalThis.dispatchEvent?.(new CustomEvent(type, { detail }));
const OFFLINE_MSG = '目前連不上網路，連上後再試一次';
/** 連線層的錯誤（離線、逾時、被中斷）→ 中文說明（Safari 是英文「Load failed」） */
export const isNetworkError = (e) => e?.name === 'TypeError' || e?.name === 'AbortError' || e?.name === 'TimeoutError';
export const networkMessage = (e) => (isNetworkError(e) ? OFFLINE_MSG : e?.message || OFFLINE_MSG);

async function call(path, params, demoFn, { cache = 0 } = {}) {
  if (demo) return demoFn(demo);
  const entries = Object.entries(params || {}).filter(([, v]) => v != null && v !== '');
  const qs = new URLSearchParams(entries);
  const key = `${path}?${qs}`;
  const canCache = cache > 0 && !entries.some(([k]) => /^(lat|lon|lng|near)$/i.test(k)); // 有座標的不存
  const fallback = (cause) => {
    const hit = canCache && readCache()[key];
    if (hit) {
      state.staleAt = hit.at;
      signal('abang:stale', { at: hit.at });
      return hit.data;
    }
    throw new Error(OFFLINE_MSG, { cause });
  };
  let res;
  try {
    res = await fetch(`${API_BASE}${key}`, { signal: AbortSignal.timeout?.(TIMEOUT_MS) });
  } catch (e) { return fallback(e); } // 連不上、逾時
  if ([502, 503, 504].includes(res.status)) return fallback(new Error(`HTTP ${res.status}`)); // 閘道錯誤＝伺服器那頭連不上
  const j = await res.json().catch(() => null);
  // 200 但不是我們的 JSON（公共 Wi-Fi 的登入頁、代理伺服器）：當作連不上，不覆蓋好的資料
  if (res.ok && !(j && typeof j === 'object' && 'data' in j)) return fallback(new Error('unexpected response'));
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  state.mode = j.mode;
  // fallback：TDX 額度用完、這次伺服器改用示範資料（mode: demo）——不存成「上次的資料」，連不上時才不會把示範資料當真的顯示
  if (canCache && !j.fallback) writeCache(key, { at: Date.now(), ttl: cache, data: j.data });
  if (state.staleAt && canCache) { state.staleAt = null; signal('abang:fresh'); }
  return j.data;
}

/** 清掉存在手機的離線資料 */
export function clearOfflineCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 無痕模式 */ }
}

export const api = {
  /** 服務狀態；sources（各類資料真實／示範）存進 state.sources */
  status: () => call('/api/v1/status', {}, () => ({ mode: 'demo' })).then((d) => { state.sources = d?.sources || null; state.partner = d?.partner || null; return d; }), // partner：合作 App 連結（散步建議的 MyDrama 活動頁）
  busRoutes: (city, keyword) => call('/api/v1/bus/routes', { city, keyword }, (s) => s.bus.searchRoutes({ city, keyword }), { cache: TTL.day }),
  busEta: (city, route) => call('/api/v1/bus/eta', { city, route }, (s) => s.bus.routeEta({ city, routeName: route }), { cache: TTL.eta }),
  busNearby: (lat, lon) => call('/api/v1/bus/nearby', { lat, lon }, (s) => s.bus.nearbyStations({ lat, lon })),
  busStationEta: (city, station) => call('/api/v1/bus/station-eta', { city, station }, (s) => s.bus.stationEta({ city, stationId: station }), { cache: TTL.eta }),
  bikeNearby: (lat, lon) => call('/api/v1/bike/nearby', { lat, lon }, (s) => s.bike.nearby({ lat, lon })),
  thsrStations: () => call('/api/v1/thsr/stations', {}, (s) => s.rail.thsrStations(), { cache: TTL.day }),
  thsrTimetable: (from, to, date) => call('/api/v1/thsr/timetable', { from, to, date }, (s) => s.rail.thsrTimetable({ from, to, date }), { cache: TTL.day }),
  traStations: () => call('/api/v1/tra/stations', {}, (s) => s.rail.traStations(), { cache: TTL.day }),
  traTimetable: (from, to, date) => call('/api/v1/tra/timetable', { from, to, date }, (s) => (s.traTrips ? s.traTrips({ from, to, date }) : s.rail.traTimetable({ from, to, date })), { cache: TTL.day }),
};
