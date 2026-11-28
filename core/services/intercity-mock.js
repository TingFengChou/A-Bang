// 國道客運（示範資料版）：介面與 intercity.js 相同。路線名稱標「示範」，班次、時間、票價皆為模擬。
import { distanceM, toHHMM } from '../util.js';
import { departOf, delayRiskOf, buildTrips, serviceDays } from './intercity.js';

const MIN_KM = 15; // 直線 15 公里以內不提供客運
/**
 * 示範用的客運轉運站（約略座標）：起訖 1.5 公里內都有、而且不是同一站，才有示範班次，上下車在轉運站、走路照實算。
 * 以前任兩點都假設 400 公尺外有直達客運（台北車站→淡水老街也有、高鐵桃園站→台北101 推了客運；2026-11-28 Antigravity 第五輪：修資料，不要拿掉）。
 */
export const DEMO_HUBS = [
  ['台北轉運站', 25.0490, 121.5170], ['市府轉運站', 25.0412, 121.5653], ['板橋客運站', 25.0137, 121.4637], ['基隆客運站', 25.1318, 121.7400],
  ['桃園客運站', 24.9890, 121.3137], ['中壢客運站', 24.9536, 121.2256], ['新竹轉運站', 24.8017, 120.9718],
  ['台中轉運站', 24.1372, 120.6856], ['朝馬轉運站', 24.1673, 120.6427], ['嘉義客運站', 23.4791, 120.4405],
  ['台南轉運站', 22.9971, 120.2121], ['高雄客運站', 22.6394, 120.3025], ['宜蘭轉運站', 24.7547, 121.7580], ['羅東轉運站', 24.6773, 121.7731],
  ['桃園機場客運站', 25.0777, 121.2328], // 機場線客運（台北車站 → 機場有國光 1819 等）
];
export const HUB_WALK_M = 1500;
/** 最近的示範轉運站（1.5 公里內；沒有回 null） */
export function nearestHub(p) {
  let best = null;
  for (const [name, lat, lon] of DEMO_HUBS) {
    const d = distanceM(p.lat, p.lon, lat, lon);
    if (d <= HUB_WALK_M && (!best || d < best.d)) best = { name, lat, lon, d };
  }
  return best;
}

export function createMockIntercityServices({ traffic }) {
  return {
    intercity: {
      async trips({ from, to, departAt, now = Date.now() }) {
        const dep = departOf(departAt, now);
        const departMin = dep.minute;
        const straightM = distanceM(from.lat, from.lon, to.lat, to.lon);
        const h1 = nearestHub(from), h2 = nearestHub(to);
        const hubM = h1 && h2 && h1.name !== h2.name ? distanceM(h1.lat, h1.lon, h2.lat, h2.lon) : 0;
        const tr = await traffic.status({ from: { ...from }, to: { ...to } }).catch(() => null);
        const traffic_ = tr ? { level: tr.level, delayMin: tr.delayMin } : { level: null, delayMin: null };
        const cands = [];
        if (hubM >= MIN_KM * 1000) {
          const km = (hubM / 1000) * 1.2;
          const ride = Math.round((km / 80) * 60) + 10;
          const fare = Math.round((70 + km * 1.2) / 5) * 5; // 跟 trip.js intercityFareEst 同一個估法（起跳 70 元＋道路公里 × 1.2 元；台北→機場約 125 元，國光 1819 實際約 140）
          // 兩條示範路線：A 每 30 分一班、B 每 45 分一班（較便宜、多停幾站）
          for (const [name, every, extra, f] of [['示範 A', 30, 0, fare], ['示範 B', 45, 15, Math.round((fare * 0.85) / 5) * 5]]) {
            const m = { routeName: `國道客運${name}`, headsign: '直達（示範）', board: { name: `${h1.name}（示範）` }, alight: { name: `${h2.name}（示範）` }, walkFromM: Math.round(h1.d), walkToM: Math.round(h2.d) };
            for (const dayOffset of serviceDays(departMin)) {
              for (let t = 6 * 60; t < 23 * 60; t += every) {
                cands.push({ depart: toHHMM(t), arrive: toHHMM(t + ride + extra), fare: f, m, dayOffset });
              }
            }
          }
        }
        return {
          system: 'BUS', date: dep.date, departAt: toHHMM(departMin), demo: true,
          traffic: traffic_, delayRisk: delayRiskOf(traffic_.level),
          trains: buildTrips(cands, { departMin, straightM, traffic: traffic_ }),
        };
      },
    },
  };
}
