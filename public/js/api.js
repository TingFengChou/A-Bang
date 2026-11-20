// 前端 API client：呼叫自家 HTTP API（TDX 金鑰只在伺服器）。
// 若頁面以「離線 Demo」打包（window.__DEMO_SERVICES__ 存在），則直接呼叫核心的示範服務。
import { API_BASE } from './base.js';

const demo = globalThis.__DEMO_SERVICES__;
/** staleAt：目前畫面用的是連不上時的舊資料（那份資料的時間，ms）；null＝最新 */
export const state = { mode: demo ? 'demo' : 'unknown', sources: null, staleAt: null };

// 離線與弱網：成功的回應存在這支手機，連不上時先顯示上次的資料並標出時間（不假裝是最新的）。
// 附近查詢（含使用者座標）不存，避免留下位置紀錄；服務狀態也不存。
const CACHE_KEY = 'abang.offline';
export const CACHE_MAX = 30;
export const CACHE_TTL = 24 * 3600e3;
const cacheable = (path) => !/nearby|status/.test(path);
function readCache() {
  try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
function writeCache(key, entry) {
  const all = readCache();
  all[key] = entry;
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(CACHE_MAX)) delete all[k];
  for (let n = keys.length; n > 0; n--) { // 空間不夠：從最舊的丟
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); return; } catch { delete all[Object.keys(all).sort((a, b) => all[a].at - all[b].at)[0]]; }
  }
}
const signal = (type, detail) => globalThis.dispatchEvent?.(new CustomEvent(type, { detail }));

async function call(path, params, demoFn) {
  if (demo) return demoFn(demo);
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''));
  const key = `${path}?${qs}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${key}`);
  } catch (e) { // 連不上（離線、弱網逾時）：有上次的資料就先用
    const hit = cacheable(path) && readCache()[key];
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      state.staleAt = hit.at;
      signal('abang:stale', { at: hit.at });
      return hit.data;
    }
    throw new Error('目前連不上網路，連上後再試一次', { cause: e });
  }
  const j = await res.json().catch(() => ({ error: `伺服器錯誤 ${res.status}` }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  state.mode = j.mode;
  if (cacheable(path)) writeCache(key, { at: Date.now(), data: j.data });
  if (state.staleAt) { state.staleAt = null; signal('abang:fresh'); }
  return j.data;
}

/** 清掉存在手機的離線資料（設定頁「清除這些資料」） */
export function clearOfflineCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 無痕模式 */ }
}

export const api = {
  /** 服務狀態；sources（各類資料真實／示範）存進 state.sources */
  status: () => call('/api/v1/status', {}, () => ({ mode: 'demo' })).then((d) => { state.sources = d?.sources || null; return d; }),
  busRoutes: (city, keyword) => call('/api/v1/bus/routes', { city, keyword }, (s) => s.bus.searchRoutes({ city, keyword })),
  busEta: (city, route) => call('/api/v1/bus/eta', { city, route }, (s) => s.bus.routeEta({ city, routeName: route })),
  busNearby: (lat, lon) => call('/api/v1/bus/nearby', { lat, lon }, (s) => s.bus.nearbyStations({ lat, lon })),
  busStationEta: (city, station) => call('/api/v1/bus/station-eta', { city, station }, (s) => s.bus.stationEta({ city, stationId: station })),
  bikeNearby: (lat, lon) => call('/api/v1/bike/nearby', { lat, lon }, (s) => s.bike.nearby({ lat, lon })),
  thsrStations: () => call('/api/v1/thsr/stations', {}, (s) => s.rail.thsrStations()),
  thsrTimetable: (from, to, date) => call('/api/v1/thsr/timetable', { from, to, date }, (s) => s.rail.thsrTimetable({ from, to, date })),
  traStations: () => call('/api/v1/tra/stations', {}, (s) => s.rail.traStations()),
  traTimetable: (from, to, date) => call('/api/v1/tra/timetable', { from, to, date }, (s) => s.rail.traTimetable({ from, to, date })),
};
