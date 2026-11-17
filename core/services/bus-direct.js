// 公車直達配對（plan_trip 用，docs/MCP_TOOLS.md §7 規則 3）：以站點座標驗證方向（上車站在下車站之前）
import { distanceM } from '../util.js';

export const DIRECT_RADIUS_M = 500; // 起訖點到上下車站牌的最大距離
export const MAX_ROUTES = 3;        // 最多驗證幾條共同路線（每條要查一次路線到站）

/**
 * 在路線各方向的站序中，找「上車站離起點最近、下車站離終點最近且在上車站之後」的組合（步行總和最短的方向）。
 * @param {Array<{ label: string, stops: Array<{ seq, stopName, lat?, lon?, etaSec? }> }>} directions bus.routeEta 的 directions
 * @returns {{ label, board, alight, stops, walkFromM, walkToM } | null}
 */
export function matchDirect(directions, from, to, radius = DIRECT_RADIUS_M) {
  let best = null;
  for (const d of directions || []) {
    const stops = (d.stops || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
    for (const b of stops) {
      const wb = distanceM(from.lat, from.lon, b.lat, b.lon);
      if (wb > radius) continue;
      for (const a of stops) {
        if (a.seq <= b.seq) continue;
        const wa = distanceM(to.lat, to.lon, a.lat, a.lon);
        if (wa > radius) continue;
        if (!best || wb + wa < best.walkFromM + best.walkToM) {
          best = {
            label: d.label,
            board: { name: b.stopName, lat: b.lat, lon: b.lon, etaSec: b.etaSec ?? null },
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
