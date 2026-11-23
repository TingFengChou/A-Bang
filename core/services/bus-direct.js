// 公車直達配對（plan_trip 用，docs/MCP_TOOLS.md §7 規則 3）：以站點座標驗證方向（上車站在下車站之前）
import { distanceM } from '../util.js';

export const DIRECT_RADIUS_M = 500; // 起訖點到上下車站牌的最大距離
export const MAX_ROUTES = 3;        // 最多驗證幾條共同路線（每條要查一次路線到站）
// 起訖各取幾個站牌找共同路線：要涵蓋整個 DIRECT_RADIUS_M（2026-11-23 實測台北車站 500 公尺內超過 30 個，只取 30 個時 448 公尺外的站牌都漏掉）
export const DIRECT_STATIONS = 150;

/** 上車站的這些狀態代表車今天不會在這站載客（2 交管不停靠、3 末班已過、4 今日未營運）；下車站只看 2（不停靠就下不了車） */
const BOARD_OFF = new Set([2, 3, 4]);

/**
 * 在路線各方向的站序中，找「上車站離起點最近、下車站離終點最近且在上車站之後」的組合（步行總和最短的方向）。
 * 先跳過不會停的站（上車站 2／3／4、下車站 2），改用同路線下一個候選站；整條路線都不會停時才回不會停的那一站（status 照帶，plan_trip 照實說不列入）。
 * @param {Array<{ label: string, stops: Array<{ seq, stopName, lat?, lon?, etaSec?, status? }> }>} directions bus.routeEta 的 directions
 * @returns {{ label, board, alight, stops, walkFromM, walkToM } | null}
 */
export function matchDirect(directions, from, to, radius = DIRECT_RADIUS_M) {
  return pairOf(directions, from, to, radius, true) || pairOf(directions, from, to, radius, false);
}

function pairOf(directions, from, to, radius, skipOff) {
  let best = null;
  for (const [di, d] of (directions || []).entries()) {
    const stops = (d.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    for (const b of stops) {
      if (skipOff && BOARD_OFF.has(b.status)) continue;
      const wb = distanceM(from.lat, from.lon, b.lat, b.lon);
      if (wb > radius) continue;
      for (const a of stops) {
        if (a.seq <= b.seq || (skipOff && a.status === 2)) continue;
        const wa = distanceM(to.lat, to.lon, a.lat, a.lon);
        if (wa > radius) continue;
        if (!best || wb + wa < best.walkFromM + best.walkToM) {
          best = {
            label: d.label, direction: d.direction ?? di,
            // status：上車站的到站狀態（0 正常、1 尚未發車、2 交管不停靠、3 末班已過、4 今日未營運）；plan_trip 靠它排除今天不會來的路線
            board: { name: b.stopName, seq: b.seq, lat: b.lat, lon: b.lon, etaSec: b.etaSec ?? null, status: b.status ?? 0 },
            alight: { name: a.stopName, lat: a.lat, lon: a.lon },
            stops: a.seq - b.seq, walkFromM: wb, walkToM: wa,
          };
        }
      }
    }
  }
  return best;
}

/** 起訖附近站牌的共同路線（依出現次數多寡，最多 MAX_ROUTES 條） */
export function commonRoutes(fromStations, toStations, max = MAX_ROUTES) {
  const toSet = new Set(toStations.flatMap((s) => s.routes || []));
  const count = new Map();
  for (const r of fromStations.flatMap((s) => s.routes || [])) if (toSet.has(r)) count.set(r, (count.get(r) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([r]) => r);
}
