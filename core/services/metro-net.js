// 捷運真實路網的查詢（metro_route 與行程規劃共用）：載入各系統的車站順序 → 最短路徑 → 票價。
// 純計算在 core/metro-route.js；這裡只負責向 metro 服務拿資料（真實或示範，介面相同）。
import { toRoutes, findRoute, fareGroups } from '../metro-route.js';

/**
 * @param {{ lines: Function, odFare?: Function }} metro svc.metro
 * @param {{ from: string, to: string, systems: string[], onlyStored?: boolean, strict?: boolean }} a 上下車站名、要載入的系統（linkedSystems）；onlyStored＝只用已存的路網與票價（行程規劃不花額度）；
 *   strict＝路網拿不到時丟出原本的錯（metro_route：照實說連不上，不說成「路網沒有這一站」；P0-2 B）
 * @returns {Promise<null | { minutes, transfers, legs, routes, fare: number|null, fares: Array<{ system, price }> }>}
 *   哪個系統的路網拿不到（額度用完以外的錯誤）或找不到路線：null（呼叫端照舊用估算）
 */
export async function metroNetRoute(metro, { from, to, systems, onlyStored = false, strict = false }) {
  if (!metro?.lines) return null;
  const lists = await Promise.allSettled(systems.map(async (sys) => { const l = await metro.lines({ system: sys, ...(onlyStored && { onlyStored }) }); if (!l) throw new Error(`no lines ${sys}`); return toRoutes(sys, l); }));
  // 少一個系統可能繞遠路或說找不到：寧可回 null 讓呼叫端用估算；額度用完要往上丟（metro_route 改用示範、行程規劃照實說）
  const bad = lists.find((r) => r.status === 'rejected');
  if (bad) { if (bad.reason?.status === 429 || strict) throw bad.reason; return null; }
  const routes = lists.flatMap((r) => r.value);
  const found = findRoute(routes, from, to);
  if (!found) return null;
  const fares = await Promise.all(fareGroups(found.legs).map(async (g) => ({ system: g.system, price: (await metro.odFare?.({ ...g, ...(onlyStored && { onlyStored }) }).catch(() => null)) ?? null })));
  const fare = fares.length && fares.every((f) => f.price != null) ? fares.reduce((s, f) => s + f.price, 0) : null;
  return { ...found, routes, fare, fares };
}
