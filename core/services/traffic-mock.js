// 路況服務（示範資料版）：介面與 traffic.js 相同。情境由 scenario 決定：'smooth'（預設）或 'jam'。
// 路段沿起訖直線切出，名稱標「示範」，非真實路況。
import { assertLatLon, distanceM } from '../util.js';
import { MIN_TRIP_M, DEFAULT_LIMIT_KMH, summarize, shortTrip, congestionOf } from './traffic.js';

export function createMockTrafficServices({ scenario = 'smooth' } = {}) {
  const jam = scenario === 'jam';
  return {
    traffic: {
      async status({ from, to }) {
        [from.lat, from.lon] = assertLatLon(from.lat, from.lon);
        [to.lat, to.lon] = assertLatLon(to.lat, to.lon);
        const straight = distanceM(from.lat, from.lon, to.lat, to.lon);
        if (straight < MIN_TRIP_M) return shortTrip(from, to);
        // 國道里程約為直線 1.2 倍，每段約 15 公里，最多 8 段
        const totalKm = (straight / 1000) * 1.2;
        const n = Math.min(8, Math.max(1, Math.round(totalKm / 15)));
        const segments = Array.from({ length: n }, (_, i) => {
          // 塞車情境：中間那一段壅塞
          const congested = jam && i === Math.floor(n / 2);
          const speedKmh = congested ? 35 : 92;
          return {
            id: `DEMO-${i + 1}`, name: `國道1號 第 ${i + 1} 段（示範）`, road: '國道1號',
            speedKmh, limitKmh: DEFAULT_LIMIT_KMH,
            lengthKm: +(totalKm / n).toFixed(2), congestion: congestionOf(speedKmh, DEFAULT_LIMIT_KMH),
          };
        });
        const events = jam ? [{ title: '國道1號 事故，內線車道封閉（示範）', time: new Date().toISOString() }] : [];
        return { ...summarize(segments), covered: true, straightKm: +(straight / 1000).toFixed(1), segments, events, demo: true, updatedAt: new Date().toISOString() };
      },
    },
  };
}
