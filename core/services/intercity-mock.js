// 國道客運（示範資料版）：介面與 intercity.js 相同。路線名稱標「示範」，班次、時間、票價皆為模擬。
import { distanceM, nowTW, toHHMM } from '../util.js';
import { departMinutes, delayRiskOf, buildTrips } from './intercity.js';

const MIN_KM = 15; // 直線 15 公里以內不提供客運

export function createMockIntercityServices({ traffic }) {
  return {
    intercity: {
      async trips({ from, to, departAt, now = Date.now() }) {
        const departMin = departMinutes(departAt, now);
        const straightM = distanceM(from.lat, from.lon, to.lat, to.lon);
        const tr = await traffic.status({ from: { ...from }, to: { ...to } }).catch(() => null);
        const traffic_ = tr ? { level: tr.level, delayMin: tr.delayMin } : { level: null, delayMin: null };
        const cands = [];
        if (straightM >= MIN_KM * 1000) {
          const km = (straightM / 1000) * 1.2;
          const ride = Math.round((km / 80) * 60) + 10;
          const fare = Math.round((km * 1.6) / 5) * 5;
          // 兩條示範路線：A 每 30 分一班、B 每 45 分一班（較便宜、多停幾站）
          for (const [name, every, extra, f] of [['示範 A', 30, 0, fare], ['示範 B', 45, 15, Math.round((fare * 0.85) / 5) * 5]]) {
            const m = { routeName: `國道客運${name}`, headsign: '直達（示範）', board: { name: '起點附近站牌（示範）' }, alight: { name: '終點附近站牌（示範）' }, walkFromM: 400, walkToM: 350 };
            for (let t = 6 * 60; t < 23 * 60; t += every) {
              cands.push({ depart: toHHMM(t), arrive: toHHMM(t + ride + extra), fare: f, m });
            }
          }
        }
        return {
          system: 'BUS', date: nowTW(now).date, departAt: toHHMM(departMin), demo: true,
          traffic: traffic_, delayRisk: delayRiskOf(traffic_.level),
          trains: buildTrips(cands, { departMin, straightM, traffic: traffic_ }),
        };
      },
    },
  };
}
