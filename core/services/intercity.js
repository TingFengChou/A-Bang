// 國道客運服務（真實 TDX 版）：起訖附近都有站牌的直達路線、接下來的班次、含路況的預估抵達（docs/MCP_TOOLS.md §7）
// ⚠️ 端點與欄位待 M1 驗證，防禦性解析；票價端點未確認，fare 先回 null。
import { distanceM, nowTW, toMin, toHHMM, UserError } from '../util.js';

export const STOP_RADIUS_M = 1500; // 起訖點到上下車站牌的最大距離
export const MAX_TRIPS = 5;
export const BUS_KMH = 70;         // 時刻表沒有下車時間時，用直線 × 1.3 ÷ 70 km/h 估算
const zh = (o) => (o && (o.Zh_tw ?? o)) || '';
const arr = (j) => (Array.isArray(j) ? j : []);
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 路況 level → 塞車風險（decide.js delayRisk，0～1）；國道即使順暢仍有少量風險 */
export function delayRiskOf(level) {
  return { jam: 0.9, slow: 0.5, smooth: 0.2 }[level] ?? 0.4;
}

/** 出發時間：'HH:mm'、ISO 或省略（現在）→ 當日分鐘數 */
export function departMinutes(departAt, now = Date.now()) {
  if (!departAt) return toMin(nowTW(now).hhmm);
  if (/^\d{1,2}:\d{2}$/.test(departAt)) return toMin(departAt);
  const t = Date.parse(departAt);
  if (Number.isNaN(t)) throw new UserError('departAt 格式需為 HH:mm 或 ISO 時間，例如 18:30');
  return toMin(nowTW(t).hhmm);
}

/**
 * 從各路線站序找出「上車站在起點附近、下車站在終點附近、且下車站在後」的組合。
 * @returns {Array<{ routeUid, subRouteUid, routeName, headsign, direction, board, alight, walkFromM, walkToM }>}
 */
export function matchRoutes(stopOfRoute, from, to, radius = STOP_RADIUS_M) {
  const out = [];
  for (const r of stopOfRoute) {
    const stops = (r.Stops || []).filter((s) => Number.isFinite(s.StopPosition?.PositionLat));
    let best = null;
    for (const b of stops) {
      const wb = distanceM(from.lat, from.lon, b.StopPosition.PositionLat, b.StopPosition.PositionLon);
      if (wb > radius) continue;
      for (const a of stops) {
        if (a.StopSequence <= b.StopSequence) continue;
        const wa = distanceM(to.lat, to.lon, a.StopPosition.PositionLat, a.StopPosition.PositionLon);
        if (wa > radius) continue;
        if (!best || wb + wa < best.walkFromM + best.walkToM) best = { b, a, walkFromM: wb, walkToM: wa };
      }
    }
    if (!best) continue;
    out.push({
      routeUid: r.RouteUID, subRouteUid: r.SubRouteUID || null,
      routeName: zh(r.RouteName), headsign: zh(r.SubRouteName) || zh(r.RouteName), direction: r.Direction ?? 0,
      board: { uid: best.b.StopUID, seq: best.b.StopSequence, name: zh(best.b.StopName) },
      alight: { uid: best.a.StopUID, seq: best.a.StopSequence, name: zh(best.a.StopName) },
      walkFromM: best.walkFromM, walkToM: best.walkToM,
    });
  }
  // 同一路線（去返程、不同子路線）只留步行最短的
  const byRoute = new Map();
  for (const m of out.sort((x, y) => x.walkFromM + x.walkToM - (y.walkFromM + y.walkToM))) if (!byRoute.has(m.routeName)) byRoute.set(m.routeName, m);
  return [...byRoute.values()];
}

/** 由時刻表算出今天的班次 [{ depart, arrive|null }] */
export function tripsFromSchedule(schedule, m, weekday) {
  const day = WEEK[weekday];
  const out = [];
  for (const tt of schedule.Timetables || []) {
    if (tt.ServiceDay && tt.ServiceDay[day] === 0) continue;
    const st = tt.StopTimes || [];
    const at = (stop) => st.find((x) => x.StopUID === stop.uid) || st.find((x) => x.StopSequence === stop.seq);
    const b = at(m.board), a = at(m.alight);
    const depart = b?.DepartureTime || b?.ArrivalTime;
    if (!depart) continue;
    out.push({ depart, arrive: a?.ArrivalTime || a?.DepartureTime || null });
  }
  return out;
}

/**
 * 組出班次清單（live 與 mock 共用）：篩出發時間、補估算抵達、加上路況延誤。
 */
export function buildTrips(cands, { departMin, straightM, traffic }) {
  const estMin = Math.round(((straightM * 1.3) / 1000 / BUS_KMH) * 60);
  const delay = traffic?.delayMin || 0;
  return cands
    .filter((c) => toMin(c.depart) >= departMin)
    .sort((x, y) => toMin(x.depart) - toMin(y.depart))
    .slice(0, MAX_TRIPS)
    .map((c) => {
      const d = toMin(c.depart);
      let a = c.arrive ? toMin(c.arrive) : d + estMin;
      if (a < d) a += 24 * 60; // 跨日
      return {
        trainNo: c.m.routeName, type: '國道客運', terminal: c.m.headsign,
        depart: toHHMM(d), arrive: toHHMM(a), minutes: a - d,
        ...(delay && { arriveWithDelay: toHHMM(a + delay), delayMin: delay }),
        ...(!c.arrive && { estimated: true }),
        fare: c.fare ?? null,
        board: c.m.board.name, alight: c.m.alight.name, walkFromM: c.m.walkFromM, walkToM: c.m.walkToM,
      };
    });
}

export function createIntercityServices(tdx, { traffic }) {
  return {
    intercity: {
      /**
       * @param {{ from: { lat, lon }, to: { lat, lon }, departAt?: string, now?: number }} p
       */
      async trips({ from, to, departAt, now = Date.now() }) {
        const departMin = departMinutes(departAt, now);
        const straightM = distanceM(from.lat, from.lon, to.lat, to.lon);
        const [stopOfRoute, tr] = await Promise.all([
          tdx.get('/basic/v2/Bus/StopOfRoute/InterCity', { $select: 'RouteUID,RouteName,SubRouteUID,SubRouteName,Direction,Stops' }, 86400),
          traffic.status({ from: { ...from }, to: { ...to } }).catch(() => null), // 路況失敗不影響班次
        ]);
        const matches = matchRoutes(arr(stopOfRoute), from, to).slice(0, 8);
        let cands = [];
        if (matches.length) {
          const filter = [...new Set(matches.map((m) => m.routeUid))].map((u) => `RouteUID eq '${String(u).replace(/'/g, "''")}'`).join(' or ');
          const schedules = arr(await tdx.get('/basic/v2/Bus/Schedule/InterCity', { $filter: filter }, 3600));
          const { weekday } = nowTW(now);
          for (const m of matches) {
            for (const s of schedules.filter((x) => x.RouteUID === m.routeUid && (!m.subRouteUid || !x.SubRouteUID || x.SubRouteUID === m.subRouteUid) && (x.Direction ?? 0) === m.direction)) {
              cands.push(...tripsFromSchedule(s, m, weekday).map((t) => ({ ...t, m })));
            }
          }
        }
        const traffic_ = tr ? { level: tr.level, delayMin: tr.delayMin } : { level: null, delayMin: null };
        return {
          system: 'BUS', date: nowTW(now).date, departAt: toHHMM(departMin),
          traffic: traffic_, delayRisk: delayRiskOf(traffic_.level),
          trains: buildTrips(cands, { departMin, straightM, traffic: traffic_ }),
        };
      },
    },
  };
}
