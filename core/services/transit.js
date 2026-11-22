// 大眾運輸服務（真實 TDX 版）：把 TDX 原始資料正規化成 App / MCP 共用的格式
// TDX 基本會員每分鐘 5 次（docs/DATA_SOURCES.md §1.1）：靜態資料（站牌、站序、車站）存檔共用，即時資料整個縣市一次取、30 秒共用。
import { resolveCity, cityFromUID } from '../cities.js';
import { distanceM, busStatusText, minutesBetween, normName, todayTW, assertLatLon, UserError, zh, enField, odataStr as q } from '../util.js';
import { pathFromWkt, thinPath } from '../geo.js';
import { matchDirect, commonRoutes, DIRECT_RADIUS_M } from './bus-direct.js';
import { cacheOf, rawOpts, nonEmpty, STATIC_TTL } from './tdx-cache.js';
import { INDEX_CITIES, ETA_TTL, BIKE_TTL, STALE_SEC, transitKey as key, transitLoaders, normRouteStops, normBikeStation, etaIndex, bikeIndex } from './transit-data.js';

const COVER_M = 1500; // 本機站牌資料離這個點最近的站超過這個距離，視為沒涵蓋（改問 TDX NearBy）

/** 高鐵、台鐵車站（存檔，預熱） */
export const railLoaders = {
  thsrStations: (tdx) => async (o) => nonEmpty((await tdx.get('/basic/v2/Rail/THSR/Station', { $select: 'StationID,StationName,StationPosition' }, 60, rawOpts(o)))
    .map((s) => ({ id: s.StationID, name: zh(s.StationName), ...enField('nameEn', s.StationName), ...stationPos(s) })), '高鐵車站'),
  traStations: (tdx) => async (o) => {
    const j = await tdx.get('/basic/v3/Rail/TRA/Station', { $select: 'StationID,StationName,StationPosition' }, 60, rawOpts(o));
    return nonEmpty((j.Stations || j).map((s) => ({ id: s.StationID, name: zh(s.StationName), ...enField('nameEn', s.StationName), ...stationPos(s) })), '台鐵車站');
  },
};
export function railWarmSteps(tdx) {
  const { cached } = cacheOf(tdx);
  return [['thsr-stations', 'thsrStations'], ['tra-stations', 'traStations']].map(([k, kind]) => ({ key: k, ttl: STATIC_TTL, run: (o) => cached(k, STATIC_TTL, railLoaders[kind](tdx), { ...o, force: true }) }));
}

/**
 * @param {object} tdx core/tdx-client.js（測試可給只有 get() 的假物件）
 * @param {{ cities?: string[] }} [opts] cities：預熱過、可在本機查附近站牌的縣市
 */
export function createTransitServices(tdx, { cities = INDEX_CITIES } = {}) {
  const { cached, stored, meta } = cacheOf(tdx);
  const storedOf = (kind, city) => stored(key[kind](city), STATIC_TTL, transitLoaders[kind](tdx, city)).catch(() => undefined);

  /**
   * 這個點有沒有預熱過的公車站牌資料涵蓋：最近的站在 1.5 公里內，且站位實際所在的縣市（LocationCityCode）也預熱過
   * （例：基隆市區有新北路線的站，但基隆自己的路線沒預熱 → 不算涵蓋，改問 TDX）。
   * @returns {Promise<{ lists: Array<Array<object>>, loc: string|null } | null>}
   */
  async function coveredBy(lat, lon) {
    const loaded = (await Promise.all(cities.map(async (city) => ({ city, list: await storedOf('busStations', city) })))).filter((x) => Array.isArray(x.list) && x.list.length);
    if (!loaded.length) return null;
    let best = null;
    for (const { list } of loaded) for (const s of list) {
      const m = distanceM(lat, lon, s.lat, s.lon);
      if (!best || m < best.m) best = { m, s };
    }
    if (!best || best.m > COVER_M) return null;
    const codes = new Set(loaded.map((x) => resolveCity(x.city)?.code));
    if (best.s.loc && !codes.has(best.s.loc)) return null;
    return { lists: loaded.map((x) => x.list), loc: best.s.loc };
  }

  // ───────── 公車 ─────────
  /** 路線站序：預熱過的整個縣市資料優先，沒有就逐條查（存檔） */
  async function routeStops(city, routeName) {
    const all = await storedOf('busRoutes', city);
    const hit = Array.isArray(all) ? all.filter((d) => d.name === routeName) : [];
    if (hit.length) return hit;
    // 預熱的清單裡沒有（新路線、清單比較舊）或沒預熱：逐條查（空結果不存檔）
    return cached(key.busRoute(city, routeName), STATIC_TTL, async (o) => normRouteStops(await tdx.get(
      `/basic/v2/Bus/DisplayStopOfRoute/City/${city}/${encodeURIComponent(routeName)}`, { $filter: `RouteName/Zh_tw eq '${q(routeName)}'` }, 60, rawOpts(o))));
  }
  /** 路線形狀（存檔）；端點失敗回 null，不影響到站資料 */
  const routeShapeOf = (city, routeName) => cached(key.busShape(city, routeName), STATIC_TTL, async (o) => routeShape(await tdx.get(
    `/basic/v2/Bus/Shape/City/${city}/${encodeURIComponent(routeName)}`, { $filter: `RouteName/Zh_tw eq '${q(routeName)}'` }, 60, rawOpts(o)))).catch(() => null);
  /** 整個縣市的公車預估到站（30 秒，所有路線、所有人共用；額度快用完時用 60 秒內的舊資料） */
  const cityEta = (city) => meta(`/basic/v2/Bus/EstimatedTimeOfArrival/City/${city}`, { $select: 'RouteUID,Direction,StopUID,EstimateTime,StopStatus,PlateNumb' }, ETA_TTL, { staleSec: STALE_SEC });

  const bus = {
    /** 依關鍵字搜尋路線 */
    async searchRoutes({ city, keyword }) {
      const c = mustCity(city);
      const rows = await tdx.get(`/basic/v2/Bus/Route/City/${c.city}`, {
        $select: 'RouteName,DepartureStopNameZh,DestinationStopNameZh',
        $filter: `contains(RouteName/Zh_tw,'${q(keyword)}')`,
        $top: 30,
      }, 3600);
      return rows.map((r) => ({
        city: c.city, routeName: zh(r.RouteName), ...enField('routeNameEn', r.RouteName),
        departure: r.DepartureStopNameZh, destination: r.DestinationStopNameZh,
      }));
    },

    /**
     * 單一路線各站到站時間（含去返程）。
     * 站序：預熱的縣市資料或逐條查（存檔）；到站：整個縣市一份（30 秒共用）；shape: false 時不查形狀（plan_trip 用不到）。
     * updatedAt：到站資料實際取得的時間（額度快用完時可能是不到一分鐘前的舊資料，stale: true）
     */
    async routeEta({ city, routeName, shape = true }) {
      const c = mustCity(city);
      const [dirs, eta, path, info] = await Promise.all([
        routeStops(c.city, routeName),
        cityEta(c.city),
        shape ? routeShapeOf(c.city, routeName) : null,
        storedOf('busMeta', c.city),
      ]);
      if (!dirs.length) throw new UserError(`${c.name}找不到路線「${routeName}」`);
      const etaMap = etaIndex(eta.data);
      // 資料取得後過了幾秒（快取最多 30 秒、額度快用完時的舊資料最多 60 秒）：倒數扣掉，行程判斷與提醒用修正後的值
      const age = Math.max(0, Math.floor(((tdx.now?.() ?? Date.now()) - eta.at) / 1000));
      const route = Array.isArray(info) ? info.find((r) => (dirs[0].uid && r.uid ? r.uid === dirs[0].uid : r.name === routeName)) : null;
      const directions = dirs.map((d) => ({
        direction: d.direction,
        // 往哪裡：路線的起訖站名（預熱過才有），沒有就用這個方向的最後一站
        label: `往 ${(d.direction === 0 ? route?.dest : route?.dep) || d.stops.at(-1)?.name || (d.direction === 0 ? '終點' : '起點')}`,
        stops: d.stops.map((s) => {
          const e = (d.uid && etaMap.get(`${d.uid}|${d.direction}|${s.uid}`)) || etaMap.get(`${d.direction}|${s.uid}`) || {};
          return {
            seq: s.seq, stopName: s.name, ...(s.nameEn && { stopNameEn: s.nameEn }),
            ...(Number.isFinite(s.lat) && Number.isFinite(s.lon) && { lat: s.lat, lon: s.lon }),
            ...etaOf(e, age),
            plate: e.PlateNumb && e.PlateNumb !== '-1' ? e.PlateNumb : null,
          };
        }),
      }));
      return { city: c.city, routeName, directions, ...(path && { shape: path }), updatedAt: new Date(eta.at).toISOString(), ...(eta.stale && { stale: true }) };
    },

    /** 座標附近的公車站位：預熱過的縣市在本機算（不打 TDX），其他地方問 TDX NearBy（不存檔：座標是使用者位置） */
    async nearbyStations({ lat, lon, radius = 400 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const r = Math.min(radius, 1000);
      const cov = await coveredBy(lat, lon);
      if (cov) {
        const out = [];
        for (const list of cov.lists) for (const s of list) {
          const d = distanceM(lat, lon, s.lat, s.lon);
          if (d <= r) out.push({ stationId: s.id, stationUid: s.uid, city: cityFromUID(s.uid)?.city || null, name: s.name, ...(s.nameEn && { nameEn: s.nameEn }), lat: s.lat, lon: s.lon, distance: d, routes: s.routes });
        }
        return out.sort((a, b) => a.distance - b.distance).slice(0, 30);
      }
      const rows = await tdx.get('/advanced/v2/Bus/Station/NearBy', {
        $spatialFilter: `nearby(${lat},${lon},${r})`, $top: 30,
      }, 3600);
      return rows.map((s) => {
        const p = s.StationPosition;
        return {
          stationId: s.StationID, stationUid: s.StationUID,
          city: cityFromUID(s.StationUID)?.city || null,
          name: zh(s.StationName), ...enField('nameEn', s.StationName), lat: p.PositionLat, lon: p.PositionLon,
          distance: distanceM(lat, lon, p.PositionLat, p.PositionLon),
          routes: [...new Set((s.Stops || []).map((x) => zh(x.RouteName)))],
        };
      }).sort((a, b) => a.distance - b.distance);
    },

    /** 某站位所有路線的到站時間 */
    async stationEta({ city, stationId }) {
      const c = mustCity(city);
      const rows = await tdx.get(`/basic/v2/Bus/EstimatedTimeOfArrival/City/${c.city}/PassThrough/Station/${encodeURIComponent(stationId)}`, {}, 20);
      return rows.map((e) => ({
        routeName: zh(e.RouteName), ...enField('routeNameEn', e.RouteName), direction: e.Direction,
        etaSec: e.EstimateTime ?? null, status: e.StopStatus ?? 0,
        statusText: busStatusText(e.StopStatus ?? 0, e.EstimateTime),
      })).sort(sortEta);
    },
  };

  // ───────── 公共自行車 YouBike ─────────
  /** 預熱過的 YouBike 站點（本機算附近）；這個點不在預熱的縣市回 null（改問 TDX NearBy） */
  async function localBikeStations(lat, lon, r) {
    const cov = await coveredBy(lat, lon);
    if (!cov) return null;
    const lists = await Promise.all(cities.map((city) => storedOf('bikeStations', city)));
    const codes = new Set(cities.filter((_, i) => Array.isArray(lists[i]) && lists[i].length).map((c) => resolveCity(c)?.code));
    if (!codes.size || (cov.loc && !codes.has(cov.loc))) return null;
    const out = [];
    for (const list of lists) for (const s of list || []) { const d = distanceM(lat, lon, s.lat, s.lon); if (d <= r) out.push({ ...s, distance: d }); }
    return out.sort((a, b) => a.distance - b.distance).slice(0, 30);
  }

  const bike = {
    /** 附近 YouBike：站點（預熱過在本機算）＋車數（依站點代碼的縣市，整個縣市一次取、30 秒共用） */
    async nearby({ lat, lon, radius = 500 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const r = Math.min(radius, 1000);
      const sf = { $spatialFilter: `nearby(${lat},${lon},${r})`, $top: 30 };
      const stations = (await localBikeStations(lat, lon, r))
        || (await tdx.get('/advanced/v2/Bike/Station/NearBy', sf, 3600)).map((s) => ({ ...normBikeStation(s), distance: distanceM(lat, lon, s.StationPosition?.PositionLat, s.StationPosition?.PositionLon) }));
      // 看不出縣市（站點代碼不是縣市開頭）的才用 NearBy 查車數
      const citiesHere = [...new Set(stations.map((s) => cityFromUID(s.uid)?.city).filter(Boolean))];
      const unknown = stations.some((s) => !cityFromUID(s.uid));
      const avails = await Promise.all([
        ...citiesHere.map((c) => meta(`/basic/v2/Bike/Availability/City/${c}`, {}, BIKE_TTL, { staleSec: STALE_SEC }).then((x) => x.data)),
        ...(unknown ? [tdx.get('/advanced/v2/Bike/Availability/NearBy', sf, BIKE_TTL)] : []),
      ]);
      const idx = avails.map(bikeIndex);
      const availOf = (uid) => { for (const m of idx) { const v = m.get(uid); if (v) return v; } return {}; };
      return stations.map((s) => {
        const v = availOf(s.uid);
        return {
          uid: s.uid, name: s.name, ...(s.nameEn && { nameEn: s.nameEn }), type: s.type,
          address: s.address, lat: s.lat, lon: s.lon,
          distance: s.distance,
          capacity: s.capacity ?? null,
          rent: v.AvailableRentBikes ?? null,
          general: v.AvailableRentBikesDetail?.GeneralBikes ?? null,
          electric: v.AvailableRentBikesDetail?.ElectricBikes ?? null,
          returnSlots: v.AvailableReturnBikes ?? null,
          inService: v.ServiceStatus !== 0,
          updatedAt: v.UpdateTime || null,
        };
      }).sort((x, y) => x.distance - y.distance);
    },
  };

  // ───────── 軌道：高鐵 / 台鐵 ─────────
  const rail = {
    thsrStations: () => cached('thsr-stations', STATIC_TTL, railLoaders.thsrStations(tdx)),
    async thsrTimetable({ from, to, date = todayTW() }) {
      const st = await rail.thsrStations();
      const o = findStation(st, from, '高鐵'), d = findStation(st, to, '高鐵');
      const rows = await tdx.get(`/basic/v2/Rail/THSR/DailyTimetable/OD/${o.id}/to/${d.id}/${date}`, {}, 600);
      return {
        from: o.name, to: d.name, date,
        trains: rows.map((r) => ({
          trainNo: r.DailyTrainInfo.TrainNo,
          depart: r.OriginStopTime.DepartureTime, arrive: r.DestinationStopTime.ArrivalTime,
          minutes: minutesBetween(r.OriginStopTime.DepartureTime, r.DestinationStopTime.ArrivalTime),
        })).sort((x, y) => x.depart.localeCompare(y.depart)),
      };
    },
    /** 高鐵票價（OD；票價很少變，存檔一天） */
    async thsrFare({ from, to }) {
      const st = await rail.thsrStations();
      const o = findStation(st, from, '高鐵'), d = findStation(st, to, '高鐵');
      if (o.id === d.id) throw new UserError('起訖站不可相同');
      const fares = await cached(`thsr-fare-${o.id}-${d.id}`, STATIC_TTL, async (opt) => {
        const rows = await tdx.get(`/basic/v2/Rail/THSR/ODFare/${o.id}/to/${d.id}`, {}, 60, rawOpts(opt));
        const od = (Array.isArray(rows) ? rows : rows?.ODFares || [])[0];
        return normFares(od?.Fares, 'THSR');
      });
      return { system: 'THSR', from: o.name, to: d.name, fares };
    },
    traStations: () => cached('tra-stations', STATIC_TTL, railLoaders.traStations(tdx)),
    async traTimetable({ from, to, date = todayTW() }) {
      const st = await rail.traStations();
      const o = findStation(st, from, '台鐵'), d = findStation(st, to, '台鐵');
      const j = await tdx.get(`/basic/v3/Rail/TRA/DailyTrainTimetable/OD/${o.id}/to/${d.id}/${date}`, {}, 600);
      return {
        from: o.name, to: d.name, date,
        trains: (j.TrainTimetables || []).map((t) => {
          const so = t.StopTimes.find((x) => x.StationID === o.id) || t.StopTimes[0];
          const sd = t.StopTimes.find((x) => x.StationID === d.id) || t.StopTimes.at(-1);
          return {
            trainNo: t.TrainInfo.TrainNo,
            type: zh(t.TrainInfo.TrainTypeName).replace(/\(.*\)/, ''),
            depart: so.DepartureTime, arrive: sd.ArrivalTime,
            minutes: minutesBetween(so.DepartureTime, sd.ArrivalTime),
            terminal: zh(t.TrainInfo.EndingStationName),
          };
        }).sort((x, y) => x.depart.localeCompare(y.depart)),
      };
    },
  };

  rail.traFare = async ({ from, to }) => {
    const st = await rail.traStations();
    const o = findStation(st, from, '台鐵'), d = findStation(st, to, '台鐵');
    if (o.id === d.id) throw new UserError('起訖站不可相同');
    const fares = await cached(`tra-fare-${o.id}-${d.id}`, STATIC_TTL, async (opt) => {
      const j = await tdx.get(`/basic/v3/Rail/TRA/ODFare/${o.id}/to/${d.id}`, {}, 60, rawOpts(opt));
      const ods = Array.isArray(j) ? j : j?.ODFares || [];
      // v3 每個車種一筆 OD，各有 Fares
      return sortFares(ods.flatMap((od) => normFares(od.Fares, 'TRA', trainTypeLabel(od))));
    });
    return { system: 'TRA', from: o.name, to: d.name, fares };
  };

  /**
   * 起訖附近都有站牌的直達公車（plan_trip 用）：共同路線 → 以站點座標驗證方向；單一路線失敗只略過。
   * 只查一個縣市的路線（站牌代碼前三碼＝路線的主管縣市；共同路線最多的那個），到站資料整個縣市一次取：一趟最多打 1 次 TDX。
   */
  bus.directTrips = async ({ from, to, radius = DIRECT_RADIUS_M }) => {
    const [a, b] = await Promise.all([bus.nearbyStations({ ...from, radius }), bus.nearbyStations({ ...to, radius })]);
    const city = pickRouteCity(a, b);
    if (!city) return [];
    const inCity = (list) => list.filter((s) => s.city === city);
    let limited = false;
    const out = await Promise.all(commonRoutes(inCity(a), inCity(b)).map(async (routeName) => {
      const eta = await bus.routeEta({ city, routeName, shape: false }).catch((e) => { if (e?.status === 429) limited = true; return null; });
      const m = eta && matchDirect(eta.directions, from, to, radius);
      return m && { routeName, city, ...m };
    }));
    // 額度用完（routeEta 429）略過的路線：在結果陣列上標 limited（不可列舉，不改資料形狀；core 共用，不依賴 node 的 metrics），plan_trip 照實說，不說成查不到直達公車
    const list = out.filter(Boolean);
    if (limited) Object.defineProperty(list, 'limited', { value: true });
    return list;
  };

  return { bus, bike, rail };
}

/** 到站秒數扣掉資料的年紀（不小於 0），狀態文字跟著修正後的秒數 */
export function etaOf(e, ageSec = 0) {
  const etaSec = Number.isFinite(e.EstimateTime) ? Math.max(0, e.EstimateTime - ageSec) : null;
  return { etaSec, status: e.StopStatus ?? 0, statusText: busStatusText(e.StopStatus ?? 0, etaSec ?? undefined) };
}

/** 直達公車要查哪個縣市的路線：起訖共同路線最多的縣市；都沒有共同路線時用起點最近站牌的縣市 */
export function pickRouteCity(fromStations, toStations) {
  const cities = [...new Set(fromStations.map((s) => s.city).filter(Boolean))];
  let best = null;
  for (const c of cities) {
    const n = commonRoutes(fromStations.filter((s) => s.city === c), toStations.filter((s) => s.city === c), Infinity).length;
    if (n && (!best || n > best.n)) best = { c, n };
  }
  return best?.c || fromStations[0]?.city || null;
}

// ───────── helpers ─────────
/** Bus Shape 回應 → 去程路徑 [[lat, lon]]（沒有去程取第一筆）；解析不出兩點以上回傳 null */
export function routeShape(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows.find((r) => r.Direction === 0) || rows[0];
  const path = thinPath(pathFromWkt(row.Geometry ?? row.Wkt ?? ''));
  return path.length >= 2 ? path : null;
}

// ── 票價代碼（依 TDX Swagger；⚠️ 待 M1 驗證，未知代碼顯示「代碼 N」） ──
export const TICKET_TYPE = { 1: '單程票', 2: '來回票', 3: '電子票證', 4: '回數票', 5: '定期票（30 天）', 6: '定期票（60 天）', 7: '早鳥票', 8: '團體票' };
export const FARE_CLASS = { 1: '成人', 2: '學生', 3: '孩童', 4: '敬老', 5: '愛心', 6: '愛心孩童', 7: '愛心陪伴', 8: '軍警', 9: '法優' };
export const CABIN_CLASS = { 1: '標準車廂', 2: '商務車廂', 3: '自由座' };
const label = (table, code) => table[code] || (code == null ? null : `代碼 ${code}`);
// 台鐵車種代碼對照未經驗證：只採用資料自帶的名稱，否則顯示代碼
const trainTypeLabel = (od) => zh(od.TrainTypeName) || (od.TrainType != null ? `車種代碼 ${od.TrainType}` : null);

/** TDX Fares → [{ ticketType, fareClass, cabin?, trainType?, price, adultOneWay }]；價格無效的略過 */
export function normFares(fares, system, trainType = null) {
  return sortFares((fares || []).filter((f) => Number.isFinite(f.Price)).map((f) => ({
    ticketType: label(TICKET_TYPE, f.TicketType),
    fareClass: label(FARE_CLASS, f.FareClass),
    ...(system === 'THSR' && { cabin: label(CABIN_CLASS, f.CabinClass) }),
    ...(trainType && { trainType }),
    price: f.Price,
    adultOneWay: f.TicketType === 1 && f.FareClass === 1,
  })));
}
/** 成人單程在前，其次價格由低到高 */
export const sortFares = (list) => list.sort((a, b) => b.adultOneWay - a.adultOneWay || a.price - b.price);

function mustCity(city) {
  const c = resolveCity(city);
  if (!c) throw new UserError(`無法辨識縣市「${city}」，可用 Taipei / 台北市 / TPE 等寫法`);
  return c;
}

/** 車站座標（StationPosition.PositionLat／Lon；⚠️ 待 M1 驗證，沒有就不帶） */
function stationPos(s) {
  const p = s.StationPosition || {};
  const lat = Number(p.PositionLat), lon = Number(p.PositionLon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat ? { lat, lon } : {};
}

/** 車站別名：查不到時再試（高鐵的高雄站是左營） */
const STATION_ALIAS = { [normName('高雄')]: '左營', [normName('新左營')]: '左營' };
export function findStation(list, input, label) {
  const s = String(input || '').trim();
  const byId = list.find((x) => x.id === s);
  if (byId) return byId;
  const n = normName(s);
  const hit = list.find((x) => normName(x.name) === n) || list.find((x) => normName(x.name).includes(n))
    || (STATION_ALIAS[n] && list.find((x) => normName(x.name).includes(normName(STATION_ALIAS[n])))); // 高鐵沒有「高雄」站：高雄＝左營（台鐵有高雄站，上面就找到了）
  if (!hit) throw new UserError(`找不到${label}車站「${input}」`);
  return hit;
}

export function sortEta(a, b) {
  const k = (x) => (x.etaSec != null ? x.etaSec : 1e6 + x.status);
  return k(a) - k(b);
}
