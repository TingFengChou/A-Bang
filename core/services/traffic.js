// 路況服務（真實 TDX 版）：起訖兩點之間的國道路段即時車速、延誤與事件（docs/MCP_TOOLS.md §7）
// ⚠️ 端點與欄位待 M1 驗證，全部防禦性解析：取不到資料時回 level: null（不是「順暢」），由呼叫端決定不加狀態。
import { assertLatLon, distanceM, zh, arr } from '../util.js';
import { pathFromWkt } from '../geo.js';

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

export function createTrafficServices(tdx) {
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

        const [shapes, sections, live, news] = await Promise.all([
          tdx.get('/v2/Road/Traffic/SectionShape/Freeway', {}, 86400),
          tdx.get('/v2/Road/Traffic/Section/Freeway', {}, 86400),
          tdx.get('/v2/Road/Traffic/Live/Freeway', {}, 60),
          tdx.get('/v2/Road/Traffic/Live/News/Freeway', {}, 60).catch(() => []), // 事件失敗不影響車速
        ]);
        const info = new Map(arr(sections, 'Sections').map((s) => [s.SectionID, s]));
        const speed = new Map(arr(live, 'LiveTraffics').map((l) => [l.SectionID, l]));
        // 沿行進方向的位置（0＝起點、1＝終點），用來排序路段
        const P = project(from.lat, from.lon);
        const [bx, by] = P(to.lat, to.lon);
        const along = ([lat, lon]) => { const [x, y] = P(lat, lon); return (x * bx + y * by) / (bx * bx + by * by); };
        const segments = [];
        for (const sh of shapesOf(shapes)) {
          const { path } = sh;
          if (!onCorridor(path, from, to)) continue;
          const s = info.get(sh.id) || {};
          const l = speed.get(sh.id) || {};
          const sp = Number(l.TravelSpeed);
          // 路段長度：資料有就用，沒有就由形狀估
          const lengthKm = Number(s.SectionLength) > 0 ? Number(s.SectionLength)
            : path.slice(1).reduce((n, p, i) => n + distanceM(path[i][0], path[i][1], p[0], p[1]), 0) / 1000;
          segments.push({
            id: sh.id,
            name: zh(s.SectionName) || [s.RoadName, s.RoadDirection].filter(Boolean).join(' ') || sh.id,
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
        const roads = new Set(segments.map((s) => s.road).filter(Boolean));
        const events = arr(news, 'Newses')
          .filter((n) => [...roads].some((r) => `${n.Title || ''}${n.Description || ''}`.includes(r)))
          .slice(0, 3)
          .map((n) => ({ title: n.Title || '', time: n.PublishTime || n.UpdateTime || null }));
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
