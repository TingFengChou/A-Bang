// 大眾運輸服務（真實 TDX 版）：把 TDX 原始資料正規化成 App / MCP 共用的格式
import { resolveCity, cityFromUID } from '../cities.js';
import { distanceM, busStatusText, minutesBetween, normName, todayTW, assertLatLon, UserError, zh, odataStr as q } from '../util.js';
import { pathFromWkt, thinPath } from '../geo.js';


export function createTransitServices(tdx) {
  // ───────── 公車 ─────────
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
        city: c.city, routeName: zh(r.RouteName),
        departure: r.DepartureStopNameZh, destination: r.DestinationStopNameZh,
      }));
    },

    /** 單一路線各站到站時間（含去返程） */
    async routeEta({ city, routeName }) {
      const c = mustCity(city);
      const filter = { $filter: `RouteName/Zh_tw eq '${q(routeName)}'` };
      const [stopsOfRoute, etas, routes, shapes] = await Promise.all([
        tdx.get(`/basic/v2/Bus/DisplayStopOfRoute/City/${c.city}/${encodeURIComponent(routeName)}`, filter, 3600),
        tdx.get(`/basic/v2/Bus/EstimatedTimeOfArrival/City/${c.city}/${encodeURIComponent(routeName)}`, filter, 20),
        tdx.get(`/basic/v2/Bus/Route/City/${c.city}/${encodeURIComponent(routeName)}`, { ...filter, $select: 'RouteName,DepartureStopNameZh,DestinationStopNameZh' }, 3600),
        // 路線形狀端點待 M1 驗證：失敗只省略 shape，不影響到站資料
        tdx.get(`/basic/v2/Bus/Shape/City/${c.city}/${encodeURIComponent(routeName)}`, filter, 3600).catch(() => []),
      ]);
      if (!stopsOfRoute.length) throw new UserError(`${c.name}找不到路線「${routeName}」`);
      const route = routes[0] || {};
      const etaMap = new Map(etas.map((e) => [`${e.Direction}|${e.StopUID}`, e]));
      const directions = stopsOfRoute.map((d) => ({
        direction: d.Direction,
        label: `往 ${d.Direction === 0 ? route.DestinationStopNameZh || '終點' : route.DepartureStopNameZh || '起點'}`,
        stops: d.Stops.map((s) => {
          const e = etaMap.get(`${d.Direction}|${s.StopUID}`) || {};
          const p = s.StopPosition || {};
          return {
            seq: s.StopSequence, stopName: zh(s.StopName),
            ...(Number.isFinite(p.PositionLat) && Number.isFinite(p.PositionLon) && { lat: p.PositionLat, lon: p.PositionLon }),
            etaSec: e.EstimateTime ?? null, status: e.StopStatus ?? 0,
            statusText: busStatusText(e.StopStatus ?? 0, e.EstimateTime),
            plate: e.PlateNumb && e.PlateNumb !== '-1' ? e.PlateNumb : null,
          };
        }),
      }));
      const shape = routeShape(shapes);
      return { city: c.city, routeName, directions, ...(shape && { shape }), updatedAt: new Date().toISOString() };
    },

    /** 座標附近的公車站位 */
    async nearbyStations({ lat, lon, radius = 400 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const rows = await tdx.get('/advanced/v2/Bus/Station/NearBy', {
        $spatialFilter: `nearby(${lat},${lon},${Math.min(radius, 1000)})`, $top: 30,
      }, 3600);
      return rows.map((s) => {
        const p = s.StationPosition;
        return {
          stationId: s.StationID, stationUid: s.StationUID,
          city: cityFromUID(s.StationUID)?.city || null,
          name: zh(s.StationName), lat: p.PositionLat, lon: p.PositionLon,
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
        routeName: zh(e.RouteName), direction: e.Direction,
        etaSec: e.EstimateTime ?? null, status: e.StopStatus ?? 0,
        statusText: busStatusText(e.StopStatus ?? 0, e.EstimateTime),
      })).sort(sortEta);
    },
  };

  // ───────── 公共自行車 YouBike ─────────
  const bike = {
    async nearby({ lat, lon, radius = 500 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const sf = { $spatialFilter: `nearby(${lat},${lon},${Math.min(radius, 1000)})`, $top: 30 };
      const [stations, avail] = await Promise.all([
        tdx.get('/advanced/v2/Bike/Station/NearBy', sf, 3600),
        tdx.get('/advanced/v2/Bike/Availability/NearBy', sf, 30),
      ]);
      const a = new Map(avail.map((x) => [x.StationUID, x]));
      return stations.map((s) => {
        const v = a.get(s.StationUID) || {};
        const p = s.StationPosition;
        return {
          uid: s.StationUID,
          name: zh(s.StationName).replace(/^YouBike\d\.\d_/, ''),
          type: s.ServiceType === 2 ? 'YouBike 2.0' : 'YouBike 1.0',
          address: zh(s.StationAddress), lat: p.PositionLat, lon: p.PositionLon,
          distance: distanceM(lat, lon, p.PositionLat, p.PositionLon),
          capacity: s.BikesCapacity ?? null,
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
    async thsrStations() {
      const rows = await tdx.get('/basic/v2/Rail/THSR/Station', { $select: 'StationID,StationName' }, 86400);
      return rows.map((s) => ({ id: s.StationID, name: zh(s.StationName) }));
    },
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
    /** 高鐵票價（OD） */
    async thsrFare({ from, to }) {
      const st = await rail.thsrStations();
      const o = findStation(st, from, '高鐵'), d = findStation(st, to, '高鐵');
      if (o.id === d.id) throw new UserError('起訖站不可相同');
      const rows = await tdx.get(`/basic/v2/Rail/THSR/ODFare/${o.id}/to/${d.id}`, {}, 600);
      const od = (Array.isArray(rows) ? rows : rows?.ODFares || [])[0];
      return { system: 'THSR', from: o.name, to: d.name, fares: normFares(od?.Fares, 'THSR') };
    },
    async traStations() {
      const j = await tdx.get('/basic/v3/Rail/TRA/Station', { $select: 'StationID,StationName' }, 86400);
      return (j.Stations || j).map((s) => ({ id: s.StationID, name: zh(s.StationName) }));
    },
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
    const j = await tdx.get(`/basic/v3/Rail/TRA/ODFare/${o.id}/to/${d.id}`, {}, 600);
    const ods = Array.isArray(j) ? j : j?.ODFares || [];
    // v3 每個車種一筆 OD，各有 Fares
    const fares = ods.flatMap((od) => normFares(od.Fares, 'TRA', trainTypeLabel(od)));
    return { system: 'TRA', from: o.name, to: d.name, fares: sortFares(fares) };
  };

  return { bus, bike, rail };
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

export function findStation(list, input, label) {
  const s = String(input || '').trim();
  const byId = list.find((x) => x.id === s);
  if (byId) return byId;
  const n = normName(s);
  const hit = list.find((x) => normName(x.name) === n) || list.find((x) => normName(x.name).includes(n));
  if (!hit) throw new UserError(`找不到${label}車站「${input}」`);
  return hit;
}

export function sortEta(a, b) {
  const k = (x) => (x.etaSec != null ? x.etaSec : 1e6 + x.status);
  return k(a) - k(b);
}
