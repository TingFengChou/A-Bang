// 公車、YouBike 的靜態資料（站牌、路線站序、YouBike 站點）：下載、正規化、存檔 key、預熱步驟（docs/DATA_SOURCES.md §1.1）。
// TDX 基本會員每分鐘 5 次：靜態資料整個縣市一次取、正規化後存檔（伺服器背景預熱，core/tdx-prewarm.js），
// 預熱過的縣市在本機算附近站牌，不再每次打 NearBy。這裡不 import node 模組（示範版會打包到 transit.js）。
import { zh, enField, arr } from '../util.js';
import { cacheOf, rawOpts, nonEmpty, STATIC_TTL } from './tdx-cache.js';

/** 預熱與本機查詢的縣市（台北、新北、桃園；伺服器可由 TDX_PREWARM_CITIES 調整） */
export const INDEX_CITIES = ['Taipei', 'NewTaipei', 'Taoyuan'];
export const ETA_TTL = 30;   // 公車到站：整個縣市一份，30 秒
export const BIKE_TTL = 30;  // YouBike 車數：整個縣市一份，30 秒
export const STALE_SEC = 60; // 額度快用完時，即時資料最多用 60 秒前的（資料時間照實標示）

/** 存檔 key（檔名由 core/tdx-store.js 轉成安全字元） */
export const transitKey = {
  busStations: (city) => `bus-stations-${city}`,
  busRoutes: (city) => `bus-routes-${city}`,
  busMeta: (city) => `bus-route-meta-${city}`,
  busRoute: (city, name) => `bus-route-${city}-${name}`,
  busShape: (city, name) => `bus-shape-${city}-${name}`,
  bikeStations: (city) => `bike-stations-${city}`,
};

const pos = (p) => (Number.isFinite(p?.PositionLat) && Number.isFinite(p?.PositionLon) ? { lat: p.PositionLat, lon: p.PositionLon } : {});

/** DisplayStopOfRoute → [{ uid, name, nameEn?, direction, stops: [{ seq, uid, name, nameEn?, lat?, lon? }] }] */
export function normRouteStops(rows) {
  return arr(rows).map((d) => ({
    uid: d.RouteUID || null, name: zh(d.RouteName), ...enField('nameEn', d.RouteName), direction: d.Direction ?? 0,
    stops: (d.Stops || []).map((x) => ({ seq: x.StopSequence, uid: x.StopUID, name: zh(x.StopName), ...enField('nameEn', x.StopName), ...pos(x.StopPosition) })),
  }));
}

/** Bus Station（整個縣市）→ [{ uid, id, name, nameEn?, lat, lon, loc, routes }]；loc＝站位實際所在縣市代碼（LocationCityCode） */
export function normBusStations(rows) {
  return arr(rows).filter((s) => Number.isFinite(s.StationPosition?.PositionLat)).map((s) => ({
    uid: s.StationUID, id: s.StationID, name: zh(s.StationName), ...enField('nameEn', s.StationName),
    lat: s.StationPosition.PositionLat, lon: s.StationPosition.PositionLon, loc: s.LocationCityCode || null,
    routes: [...new Set((s.Stops || []).map((x) => zh(x.RouteName)).filter(Boolean))],
  }));
}

/** Bike Station → 站點基本資料 */
export function normBikeStation(s) {
  return {
    uid: s.StationUID,
    name: zh(s.StationName).replace(/^YouBike\d\.\d_/, ''), ...enField('nameEn', s.StationName, (x) => x.replace(/^YouBike\s*\d\.\d_/i, '')),
    type: s.ServiceType === 2 ? 'YouBike 2.0' : 'YouBike 1.0',
    address: zh(s.StationAddress), ...pos(s.StationPosition),
    capacity: s.BikesCapacity ?? null,
  };
}

/** 整個縣市的靜態資料下載（預熱與使用者請求共用同一個 key） */
export const transitLoaders = {
  busStations: (tdx, city) => async (o) => nonEmpty(normBusStations(await tdx.get(`/basic/v2/Bus/Station/City/${city}`, { $select: 'StationUID,StationID,StationName,StationPosition,Stops,LocationCityCode' }, 60, rawOpts(o))), `${city} 公車站牌`),
  busRoutes: (tdx, city) => async (o) => nonEmpty(normRouteStops(await tdx.get(`/basic/v2/Bus/DisplayStopOfRoute/City/${city}`, {}, 60, rawOpts(o))), `${city} 路線站序`),
  busMeta: (tdx, city) => async (o) => nonEmpty(arr(await tdx.get(`/basic/v2/Bus/Route/City/${city}`, { $select: 'RouteUID,RouteName,DepartureStopNameZh,DestinationStopNameZh' }, 60, rawOpts(o)))
    .map((r) => ({ uid: r.RouteUID || null, name: zh(r.RouteName), dep: r.DepartureStopNameZh || null, dest: r.DestinationStopNameZh || null })), `${city} 路線起訖`),
  bikeStations: (tdx, city) => async (o) => nonEmpty(arr(await tdx.get(`/basic/v2/Bike/Station/City/${city}`, { $select: 'StationUID,StationName,StationAddress,StationPosition,BikesCapacity,ServiceType' }, 60, rawOpts(o)))
    .map(normBikeStation).filter((s) => Number.isFinite(s.lat)), `${city} YouBike 站點`),
};

/** 預熱步驟（core/tdx-prewarm.js）：一個縣市的公車站牌、站序、YouBike 站點、路線起訖，再下一個縣市 */
export function transitWarmSteps(tdx, cities = INDEX_CITIES) {
  const { cached } = cacheOf(tdx);
  return cities.flatMap((city) => ['busStations', 'busRoutes', 'bikeStations', 'busMeta'].map((kind) => {
    const k = transitKey[kind](city);
    return { key: k, ttl: STATIC_TTL, run: (o) => cached(k, STATIC_TTL, transitLoaders[kind](tdx, city), { ...o, force: true }) };
  }));
}

// 即時資料的索引：同一份回應只建一次
const etaIndexes = new WeakMap();
/** 公車到站（整個縣市或單一路線）→ Map：`RouteUID|Direction|StopUID`，沒有 RouteUID 時 `Direction|StopUID` */
export function etaIndex(rows) {
  if (rows && typeof rows === 'object' && etaIndexes.has(rows)) return etaIndexes.get(rows);
  const m = new Map();
  for (const e of arr(rows)) {
    if (e.RouteUID) m.set(`${e.RouteUID}|${e.Direction}|${e.StopUID}`, e);
    const k = `${e.Direction}|${e.StopUID}`;
    if (!m.has(k)) m.set(k, e);
  }
  if (rows && typeof rows === 'object') etaIndexes.set(rows, m);
  return m;
}
const bikeIndexes = new WeakMap();
/** YouBike 車數 → Map：StationUID */
export function bikeIndex(rows) {
  if (rows && typeof rows === 'object' && bikeIndexes.has(rows)) return bikeIndexes.get(rows);
  const m = new Map(arr(rows).map((x) => [x.StationUID, x]));
  if (rows && typeof rows === 'object') bikeIndexes.set(rows, m);
  return m;
}
