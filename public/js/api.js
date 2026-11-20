// 前端 API client：呼叫自家 HTTP API（TDX 金鑰只在伺服器）。
// 若頁面以「離線 Demo」打包（window.__DEMO_SERVICES__ 存在），則直接呼叫核心的示範服務。
import { API_BASE } from './base.js';

const demo = globalThis.__DEMO_SERVICES__;
export const state = { mode: demo ? 'demo' : 'unknown', sources: null };

async function call(path, params, demoFn) {
  if (demo) return demoFn(demo);
  const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''));
  const res = await fetch(`${API_BASE}${path}?${qs}`);
  const j = await res.json().catch(() => ({ error: `伺服器錯誤 ${res.status}` }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  state.mode = j.mode;
  return j.data;
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
