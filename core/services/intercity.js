// 國道客運服務（真實 TDX 版）：起訖附近都有站牌的直達路線、接下來的班次、含路況的預估抵達（docs/MCP_TOOLS.md §7）
// 端點與欄位 2026-11-23 實測（docs/DATA_SOURCES.md）；防禦性解析。票價端點 `/basic/v2/Bus/RouteFare/InterCity`（`StageFares`）存在但尚未串接，fare 先回 null。
import { distanceM, nowTW, toMin, toHHMM, UserError, zh, arr, odataStr } from '../util.js';
import { cacheOf, rawOpts, nonEmpty, STATIC_TTL } from './tdx-cache.js';

export const STOP_RADIUS_M = 1500; // 起訖點到上下車站牌的最大距離
export const MAX_TRIPS = 5;
export const BUS_KMH = 70;         // 時刻表沒有下車時間時，用直線 × 1.3 ÷ 70 km/h 估算
export const ALONG_KMH = 50;       // 時刻表沒有上車站時間時，由前一個有時間的站沿站牌距離 ÷ 50 km/h 估到站（估快一點：寧可早到站牌）
export const NEXT_DAY_WINDOW_MIN = 180; // 深夜查詢：列出 3 小時內的隔日（跨日）班次
const DAY = 24 * 60;
/** 合法的 HH:mm（00:00～23:59） */
export const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
/** departAt 可接受的 ISO：YYYY-MM-DD，或加上 THH:mm[:ss[.sss]]，可帶時區 Z／±hh:mm */
export const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
/** 分鐘數 → 'HH:mm'，可超過 24 小時（例 1445 → '24:05'），用來表示跨過午夜的時刻 */
const hhmmRaw = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 路況 level → 塞車風險（decide.js delayRisk，0～1）；國道即使順暢仍有少量風險 */
export function delayRiskOf(level) {
  return { jam: 0.9, slow: 0.5, smooth: 0.2 }[level] ?? 0.4;
}

/** 'HH:mm' 比現在早超過這麼多分鐘就當成明天（剛過幾分鐘的時間仍算今天） */
export const DEPART_PAST_MIN = 60;
/**
 * 出發時刻（台灣時間）：'HH:mm' 視為今天（比現在早超過 DEPART_PAST_MIN 分視為明天）、ISO 用該日的日期與星期、省略為現在。
 * ISO 沒有時區時一律視為台灣時間（+08:00），不受伺服器時區影響；只有日期時為當天 00:00。
 * @returns {{ date: string, weekday: number, minute: number }}
 */
export function departOf(departAt, now = Date.now()) {
  const hhmm = departAt && HHMM_RE.test(departAt) ? departAt : null;
  let t = now;
  if (departAt && !hhmm) {
    let iso = String(departAt).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += '+08:00';
    t = /^\d{4}-\d{2}-\d{2}T/.test(iso) ? Date.parse(iso) : NaN;
    if (Number.isNaN(t)) throw new UserError('departAt 格式需為 HH:mm 或 ISO 時間，例如 18:30');
  }
  // 只給 HH:mm、而且比現在早超過 1 小時＝隔天（23:50 說「00:10」是明天 00:10；火車、客運也查隔天的班表）
  if (hhmm && toMin(hhmm) < toMin(nowTW(now).hhmm) - DEPART_PAST_MIN) t = now + 864e5;
  const n = nowTW(t);
  return { date: n.date, weekday: n.weekday, minute: toMin(hhmm || n.hhmm) };
}

/** 出發時間 → 當日分鐘數（departOf 的簡寫） */
export const departMinutes = (departAt, now = Date.now()) => departOf(departAt, now).minute;

/**
 * 從各路線站序找出「上車站在起點附近、下車站在終點附近、且下車站在後」的組合。
 * along：上車站以前（含）各站離第一站的沿線距離 [[站序, 公尺]]（時刻表沒有上車站時間時估到站用）
 * @returns {Array<{ routeUid, subRouteUid, routeName, headsign, direction, board, alight, walkFromM, walkToM, along }>}
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
    const along = [];
    let cum = 0;
    const seqd = [...stops].sort((x, y) => x.StopSequence - y.StopSequence).filter((s) => s.StopSequence <= best.b.StopSequence);
    seqd.forEach((s, i) => {
      if (i) cum += distanceM(seqd[i - 1].StopPosition.PositionLat, seqd[i - 1].StopPosition.PositionLon, s.StopPosition.PositionLat, s.StopPosition.PositionLon);
      along.push([s.StopSequence, Math.round(cum)]);
    });
    out.push({
      routeUid: r.RouteUID, subRouteUid: r.SubRouteUID || null,
      routeName: zh(r.RouteName), headsign: zh(r.SubRouteName) || zh(r.RouteName), direction: r.Direction ?? 0,
      board: { uid: best.b.StopUID, seq: best.b.StopSequence, name: zh(best.b.StopName) },
      alight: { uid: best.a.StopUID, seq: best.a.StopSequence, name: zh(best.a.StopName) },
      walkFromM: best.walkFromM, walkToM: best.walkToM, along,
    });
  }
  // 同一路線（去返程、不同子路線）只留步行最短的
  const byRoute = new Map();
  for (const m of out.sort((x, y) => x.walkFromM + x.walkToM - (y.walkFromM + y.walkToM))) if (!byRoute.has(m.routeName)) byRoute.set(m.routeName, m);
  return [...byRoute.values()];
}

/**
 * 由時刻表算出某個星期幾的班次 [{ depart, arrive|null }]。
 * ServiceDay 有提供時只收明確標 1 的星期；班次在起站發車後跨過午夜的站點時刻改寫成 24:xx（例 23:30 發車、00:05 到上車站 → '24:05'）。
 */
export function tripsFromSchedule(schedule, m, weekday) {
  const day = WEEK[weekday];
  const out = [];
  for (const tt of schedule.Timetables || []) {
    if (tt.ServiceDay && Number(tt.ServiceDay[day]) !== 1) continue;
    const st = tt.StopTimes || [];
    const at = (stop) => st.find((x) => x.StopUID === stop.uid) || st.find((x) => x.StopSequence === stop.seq);
    const first = st.reduce((p, x) => (p == null || (x.StopSequence ?? Infinity) < (p.StopSequence ?? Infinity) ? x : p), null);
    const b = at(m.board);
    const a = at(m.alight);
    const time = (x) => x?.DepartureTime || x?.ArrivalTime;
    // 2026-11-23 實測：有些班次的 StopTimes 只有起站一筆（例 THB0968 去程）→ 上車站沒有時間時，
    // 由上車站之前最近一個有時間的站，沿站牌距離估到站（ALONG_KMH），標 fromStop（哪一站、幾點開），抵達也用估的
    const known = b ? null : st.filter((x) => (x.StopSequence ?? Infinity) < m.board.seq && time(x)).reduce((p, x) => (!p || x.StopSequence > p.StopSequence ? x : p), null);
    if (!b && !known) continue;
    if (!time(b || known)) continue;
    const startMin = toMin(time(first) || time(b || known));
    const wrap = (t) => (t && toMin(t) < startMin ? hhmmRaw(toMin(t) + DAY) : t);
    if (b) { out.push({ depart: wrap(time(b)), arrive: wrap(time(a) || null) }); continue; }
    const cum = (seq) => m.along?.find(([q]) => q === seq)?.[1];
    const gapM = Math.max(0, (cum(m.board.seq) ?? 0) - (cum(known.StopSequence) ?? 0));
    const knownAt = wrap(time(known));
    out.push({ depart: hhmmRaw(toMin(knownAt) + Math.round((gapM / 1000 / ALONG_KMH) * 60)), arrive: null, fromStop: { name: zh(known.StopName) || null, time: toHHMM(toMin(knownAt)) } });
  }
  return out;
}

/** 是否需要查隔日班次（出發時間離午夜不到 NEXT_DAY_WINDOW_MIN） */
export const needsNextDay = (departMin) => departMin + NEXT_DAY_WINDOW_MIN > DAY;

/**
 * 要查哪幾天的班表（相對出發日）：清晨（6 點前）也看前一天跨過午夜（24:xx）的班次；深夜看隔日。
 * @returns {number[]} 例如 [-1, 0]、[0]、[0, 1]
 */
export const serviceDays = (departMin) => [...(departMin < 6 * 60 ? [-1] : []), 0, ...(needsNextDay(departMin) ? [1] : [])];

/**
 * 組出班次清單（live 與 mock 共用）：篩出發時間、補估算抵達、加上路況延誤。
 * 候選班次帶 dayOffset（-1＝前一天的 24:xx 班次、0＝出發日、1＝隔日）；隔日班次只收出發後 NEXT_DAY_WINDOW_MIN 內的，並標 nextDay。
 */
export function buildTrips(cands, { departMin, straightM, traffic }) {
  const estMin = Math.round(((straightM * 1.3) / 1000 / BUS_KMH) * 60);
  const delay = traffic?.delayMin || 0;
  const at = (c) => toMin(c.depart) + (c.dayOffset || 0) * DAY;
  return cands
    .filter((c) => at(c) >= departMin && (c.dayOffset !== 1 || at(c) < departMin + NEXT_DAY_WINDOW_MIN))
    .sort((x, y) => at(x) - at(y))
    .slice(0, MAX_TRIPS)
    .map((c) => {
      const d = at(c);
      let a = c.arrive ? toMin(c.arrive) + (c.dayOffset || 0) * DAY : d + estMin;
      while (a < d) a += DAY; // 跨日
      return {
        trainNo: c.m.routeName, type: '國道客運', terminal: c.m.headsign,
        depart: toHHMM(d), arrive: toHHMM(a), minutes: a - d,
        ...(d >= DAY && { nextDay: true }),
        ...(delay && { arriveWithDelay: toHHMM(a + delay), delayMin: delay }),
        ...(!c.arrive && { estimated: true }),
        // 時刻表沒有上車站的時間：depart 是由前面的站估的（departEstimated），departFrom＝那一站與發車時間
        ...(c.fromStop && { departEstimated: true, departFrom: c.fromStop }),
        fare: c.fare ?? null,
        board: c.m.board.name, alight: c.m.alight.name, walkFromM: c.m.walkFromM, walkToM: c.m.walkToM,
      };
    });
}

/** 公路客運站序 → 只留 matchRoutes 用到的欄位（形狀與 TDX 相同，可存檔） */
export const normIntercityStops = (rows) => arr(rows).map((r) => ({
  RouteUID: r.RouteUID, RouteName: { Zh_tw: zh(r.RouteName) }, SubRouteUID: r.SubRouteUID || null, SubRouteName: r.SubRouteName ? { Zh_tw: zh(r.SubRouteName) } : null, Direction: r.Direction ?? 0,
  Stops: (r.Stops || []).map((x) => ({ StopUID: x.StopUID, StopSequence: x.StopSequence, StopName: { Zh_tw: zh(x.StopName) }, ...(x.StopPosition && { StopPosition: { PositionLat: x.StopPosition.PositionLat, PositionLon: x.StopPosition.PositionLon } }) })),
}));

export function createIntercityServices(tdx, { traffic }) {
  const { cached } = cacheOf(tdx);
  return {
    intercity: {
      /**
       * @param {{ from: { lat, lon }, to: { lat, lon }, departAt?: string, now?: number }} p
       */
      async trips({ from, to, departAt, now = Date.now() }) {
        const dep = departOf(departAt, now);
        const departMin = dep.minute;
        const straightM = distanceM(from.lat, from.lon, to.lat, to.lon);
        const [stopOfRoute, tr] = await Promise.all([
          // 路線站序是靜態的：只留比對用的欄位後存檔（重啟不必重抓，約 1 MB）
          cached('intercity-stop-of-route', STATIC_TTL, async (o) => nonEmpty(normIntercityStops(await tdx.get('/basic/v2/Bus/StopOfRoute/InterCity', { $select: 'RouteUID,RouteName,SubRouteUID,SubRouteName,Direction,Stops' }, 60, rawOpts(o))), '公路客運站序')),
          traffic.status({ from: { ...from }, to: { ...to } }).catch(() => null), // 路況失敗不影響班次
        ]);
        const matches = matchRoutes(arr(stopOfRoute), from, to).slice(0, 8);
        const cands = [];
        if (matches.length) {
          const filter = [...new Set(matches.map((m) => m.routeUid))].map((u) => `RouteUID eq '${odataStr(u)}'`).join(' or ');
          const schedules = arr(await tdx.get('/basic/v2/Bus/Schedule/InterCity', { $filter: filter }, 3600));
          const days = serviceDays(departMin);
          for (const m of matches) {
            for (const s of schedules.filter((x) => x.RouteUID === m.routeUid && (!m.subRouteUid || !x.SubRouteUID || x.SubRouteUID === m.subRouteUid) && (x.Direction ?? 0) === m.direction)) {
              for (const dayOffset of days) {
                cands.push(...tripsFromSchedule(s, m, (dep.weekday + dayOffset + 7) % 7).map((t) => ({ ...t, m, dayOffset })));
              }
            }
          }
        }
        const traffic_ = tr ? { level: tr.level, delayMin: tr.delayMin } : { level: null, delayMin: null };
        return {
          system: 'BUS', date: dep.date, departAt: toHHMM(departMin),
          traffic: traffic_, delayRisk: delayRiskOf(traffic_.level),
          trains: buildTrips(cands, { departMin, straightM, traffic: traffic_ }),
        };
      },
    },
  };
}
