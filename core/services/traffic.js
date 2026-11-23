// 路況服務（真實 TDX 版）：起訖兩點之間的國道路段即時車速、延誤與事件（docs/MCP_TOOLS.md §7）
// 端點與欄位 2026-11-23 實測（docs/DATA_SOURCES.md）；仍防禦性解析：取不到資料時回 level: null（不是「順暢」），由呼叫端決定不加狀態。
import { assertLatLon, distanceM, zh, enField, arr } from '../util.js';
import { pathFromWkt } from '../geo.js';
import { cacheOf, rawOpts, nonEmpty, STATIC_TTL } from './tdx-cache.js';

export const CORRIDOR_M = 3000;       // 路段中點離起訖連線多遠以內算「沿途」
export const MIN_TRIP_M = 15000;      // 直線 15 公里以內視為市區短程，不查國道
export const DEFAULT_LIMIT_KMH = 100; // 缺速限時的國道預設值


/** 以起點為原點的平面座標（公尺），短距離足夠準確 */
function project(lat0, lon0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

/**
 * 路段是否在起訖連線的走廊內、且方向一致。
 * @param {Array<[number, number]>} path 路段形狀 [[lat, lon]]（由起點到終點）
 */
export function onCorridor(path, from, to, corridorM = CORRIDOR_M) {
  if (!path || path.length < 2) return false;
  const P = project(from.lat, from.lon);
  const [bx, by] = P(to.lat, to.lon);
  const len2 = bx * bx + by * by;
  if (!len2) return false;
  const mid = path[Math.floor(path.length / 2)];
  const [mx, my] = P(mid[0], mid[1]);
  const t = (mx * bx + my * by) / len2;
  if (t < -0.05 || t > 1.05) return false;
  if (Math.hypot(mx - t * bx, my - t * by) > corridorM) return false;
  // 國道路段分方向：路段起訖向量要與行進方向同向
  const [sx, sy] = P(path[0][0], path[0][1]);
  const [ex, ey] = P(path.at(-1)[0], path.at(-1)[1]);
  return (ex - sx) * bx + (ey - sy) * by > 0;
}

export const JAM_RATIO = 0.4;   // 車速 ÷ 速限低於此值＝壅塞
export const SLOW_RATIO = 0.75; // 低於此值＝車多
export const JAM_KM = 5;        // 長途時，壅塞或車多累計達 5 公里就反映在整體 level（不被其他順暢路段平均掉）

/** 單一路段的路況文字（live 與 mock 共用，不外露 TDX 原始代碼） */
export function congestionOf(speedKmh, limitKmh) {
  if (!(speedKmh > 0)) return null;
  const r = speedKmh / limitKmh;
  return r < JAM_RATIO ? '壅塞' : r < SLOW_RATIO ? '車多' : '順暢';
}

// 路段形狀解析結果快取：同一份（已被 tdx-client 快取 24 小時的）回應只解析一次
const parsedShapes = new WeakMap();
function shapesOf(json) {
  if (json && typeof json === 'object' && parsedShapes.has(json)) return parsedShapes.get(json);
  const list = arr(json, 'SectionShapes').map((sh) => ({ id: sh.SectionID, path: pathFromWkt(sh.Geometry ?? sh.Wkt ?? '') })).filter((s) => s.path.length >= 2);
  if (json && typeof json === 'object') parsedShapes.set(json, list);
  return list;
}

/**
 * 由路段算整體路況。
 * level：壅塞累計 ≥ 5 km 或整體加權比值 < 0.4 → jam；車多以上累計 ≥ 5 km 或比值 < 0.75 → slow；其餘 smooth；沒有車速資料 → null。
 * delayMin：只計車多與壅塞的路段（與以速限行駛相比多花的分鐘）。
 * @param {Array<{ lengthKm: number, speedKmh: number|null, limitKmh: number }>} segs
 * @returns {{ level: 'smooth'|'slow'|'jam'|null, delayMin: number|null }}
 */
export function summarize(segs) {
  const ok = segs.filter((s) => s.speedKmh > 0 && s.lengthKm > 0);
  if (!ok.length) return { level: null, delayMin: null };
  const r = (s) => Math.min(1, s.speedKmh / s.limitKmh);
  const km = ok.reduce((n, s) => n + s.lengthKm, 0);
  const ratio = ok.reduce((n, s) => n + s.lengthKm * r(s), 0) / km;
  const jamKm = ok.filter((s) => r(s) < JAM_RATIO).reduce((n, s) => n + s.lengthKm, 0);
  const slowKm = ok.filter((s) => r(s) < SLOW_RATIO).reduce((n, s) => n + s.lengthKm, 0);
  const delay = ok.filter((s) => r(s) < SLOW_RATIO).reduce((n, s) => n + (s.lengthKm / s.speedKmh - s.lengthKm / s.limitKmh) * 60, 0);
  const level = jamKm >= JAM_KM || ratio < JAM_RATIO ? 'jam' : slowKm >= JAM_KM || ratio < SLOW_RATIO ? 'slow' : 'smooth';
  return { level, delayMin: Math.round(delay) };
}

/** 依起訖距離，回傳「不查國道」時的結果 */
export function shortTrip(from, to) {
  return { level: null, delayMin: null, covered: false, straightKm: +(distanceM(from.lat, from.lon, to.lat, to.lon) / 1000).toFixed(1), segments: [], events: [], note: '起訖距離短，未查國道路況' };
}

export const EVENT_NEAR_M = 500; // 事件位置離沿途路段多近才算「沿途」
const EVENT_DIR = { 北向: 'N', 南向: 'S', 東向: 'E', 西向: 'W' };

/** 點到折線的最短距離（公尺；平面近似） */
function distToPath(lat, lon, path) {
  const P = project(lat, lon);
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = P(path[i][0], path[i][1]);
    const [bx, by] = i + 1 < path.length ? P(path[i + 1][0], path[i + 1][1]) : [ax, ay];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * 沿途的道路事件（TDX `/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway`）。
 * 2026-11-23 實測：`Live/News/Freeway` 的 `Newses` 只有「施工維護」這類標題、沒有路名與位置，以前依路名篩一律對不到；
 * 改用 LiveEvents：`Positions` 是 WKT（實測都是 POINT（經度 緯度）；多點、線也收）、`Description`「國道一號 北向 27K+100 施工事件-施工維護」、
 * `Location.FreeExpressHighway.Direction`「北向」。事件位置離沿途路段 500 公尺內、而且附近有同方向的路段（有寫方向時）才算。
 * @param {any} json LiveEvents 回應
 * @param {Array<{ path: Array<[number, number]>, dir?: string|null }>} segs 沿途路段（形狀與 RoadDirection N／S／E／W）
 * @returns {Array<{ title: string, time: string|null }>}
 */
export function eventsAlong(json, segs, limit = 3) {
  const out = [];
  const PAD = 0.01; // 約 1 公里：先用外框排除離很遠的路段，不必逐點算距離
  const boxed = segs.map((s) => ({ s, box: s.path.reduce((b, [la, lo]) => [Math.min(b[0], la), Math.max(b[1], la), Math.min(b[2], lo), Math.max(b[3], lo)], [Infinity, -Infinity, Infinity, -Infinity]) }));
  const inBox = ([lat, lon], b) => lat >= b[0] - PAD && lat <= b[1] + PAD && lon >= b[2] - PAD && lon <= b[3] + PAD;
  for (const e of arr(json, 'LiveEvents')) {
    const pts = wktPoints(e.Positions);
    if (!pts.length) continue;
    // 事件（點、多點或一段線）任何一點離沿途路段 500 公尺內就算；有寫方向時，附近要有同方向（或沒標方向）的路段
    const near = boxed.filter(({ s, box }) => pts.some((p) => inBox(p, box) && distToPath(p[0], p[1], s.path) <= EVENT_NEAR_M)).map((x) => x.s);
    if (!near.length) continue;
    const dir = EVENT_DIR[e.Location?.FreeExpressHighway?.Direction] || EVENT_DIR[/([北南東西]向)/.exec(e.Description || '')?.[1]];
    if (dir && !near.some((s) => !s.dir || s.dir === dir)) continue; // 對向車道的事件
    out.push({ title: e.Description || e.EventTitle || '', time: e.PublishTime || e.EffectiveTime || null });
    if (out.length >= limit) break;
  }
  return out;
}

/** WKT（POINT、MULTIPOINT、LINESTRING…）裡所有座標 → [[lat, lon]]（經緯度寫反的換回來） */
function wktPoints(wkt) {
  const out = [];
  for (const m of String(wkt || '').matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    let lon = Number(m[1]), lat = Number(m[2]);
    if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) [lat, lon] = [lon, lat];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lat, lon]);
  }
  return out;
}

/** 國道路段資料（正規化後可存檔）：路段只留用到的欄位 */
const normSections = (j) => arr(j, 'Sections').map((s) => ({ SectionID: s.SectionID, SectionName: s.SectionName, RoadName: s.RoadName, RoadDirection: s.RoadDirection, SectionLength: s.SectionLength, SpeedLimit: s.SpeedLimit }));

export function createTrafficServices(tdx) {
  const { cached } = cacheOf(tdx);
  return {
    traffic: {
      /**
       * @param {{ from: { lat: number, lon: number }, to: { lat: number, lon: number } }} p
       */
      async status({ from, to }) {
        [from.lat, from.lon] = assertLatLon(from.lat, from.lon);
        [to.lat, to.lon] = assertLatLon(to.lat, to.lon);
        const straight = distanceM(from.lat, from.lon, to.lat, to.lon);
        if (straight < MIN_TRIP_M) return shortTrip(from, to);

        // 路段形狀與路段資料是靜態的：解析後存檔（重啟不必重抓）；車速與事件 60 秒
        const [shapeList, sections, live, roadEvents] = await Promise.all([
          cached('freeway-shapes', STATIC_TTL, async (o) => nonEmpty(shapesOf(await tdx.get('/basic/v2/Road/Traffic/SectionShape/Freeway', {}, 60, rawOpts(o))), '國道路段形狀')),
          cached('freeway-sections', STATIC_TTL, async (o) => nonEmpty(normSections(await tdx.get('/basic/v2/Road/Traffic/Section/Freeway', {}, 60, rawOpts(o))), '國道路段')),
          tdx.get('/basic/v2/Road/Traffic/Live/Freeway', {}, 60),
          tdx.get('/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway', {}, 60).catch(() => []), // 事件失敗不影響車速
        ]);
        const info = new Map(arr(sections, 'Sections').map((s) => [s.SectionID, s]));
        const speed = new Map(arr(live, 'LiveTraffics').map((l) => [l.SectionID, l]));
        // 沿行進方向的位置（0＝起點、1＝終點），用來排序路段
        const P = project(from.lat, from.lon);
        const [bx, by] = P(to.lat, to.lon);
        const along = ([lat, lon]) => { const [x, y] = P(lat, lon); return (x * bx + y * by) / (bx * bx + by * by); };
        const segments = [];
        const segPaths = []; // 沿途路段的形狀與方向（篩事件用，不輸出）
        for (const sh of shapeList) {
          const { path } = sh;
          if (!onCorridor(path, from, to)) continue;
          const s = info.get(sh.id) || {};
          const l = speed.get(sh.id) || {};
          segPaths.push({ path, dir: s.RoadDirection || null });
          const sp = Number(l.TravelSpeed);
          // 路段長度：資料有就用，沒有就由形狀估
          const lengthKm = Number(s.SectionLength) > 0 ? Number(s.SectionLength)
            : path.slice(1).reduce((n, p, i) => n + distanceM(path[i][0], path[i][1], p[0], p[1]), 0) / 1000;
          segments.push({
            id: sh.id,
            name: zh(s.SectionName) || [s.RoadName, s.RoadDirection].filter(Boolean).join(' ') || sh.id, ...enField('nameEn', s.SectionName),
            road: s.RoadName || null,
            speedKmh: sp > 0 ? sp : null,
            limitKmh: Number(s.SpeedLimit) > 0 ? Number(s.SpeedLimit) : DEFAULT_LIMIT_KMH,
            lengthKm: +lengthKm.toFixed(2),
            congestion: null, // 下面依車速與速限算（不外露 TDX CongestionLevel 代碼）
            _t: along(path[0]),
          });
        }
        segments.sort((a, b) => a._t - b._t);
        for (const s of segments) { delete s._t; s.congestion = congestionOf(s.speedKmh, s.limitKmh); }
        const events = eventsAlong(roadEvents, segPaths);
        const sum = summarize(segments);
        return {
          ...sum, covered: segments.length > 0, straightKm: +(straight / 1000).toFixed(1),
          segments, events,
          ...(!segments.length && { note: '沿途找不到國道路段資料' }),
          updatedAt: arr(live, 'LiveTraffics')[0]?.DataCollectTime || new Date().toISOString(),
        };
      },
    },
  };
}
