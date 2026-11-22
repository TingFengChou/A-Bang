// 停車場（示範資料版）：介面與 parking.js 相同。目的地旁邊兩個「示範停車場」，名稱標示範、不是真的空位。
import { assertLatLon } from '../util.js';
import { rankLots } from './parking.js';

export function createMockParkingServices() {
  return {
    parking: {
      async nearby({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        const lots = [
          { id: 'DEMO1', name: '示範停車場 A', lat: lat + 0.0015, lon: lon + 0.001, fare: '30 元／小時（示範）', live: true, available: 42, total: 120, full: false },
          { id: 'DEMO2', name: '示範停車場 B', lat: lat - 0.002, lon: lon - 0.0015, fare: '40 元／小時（示範）', live: true, available: 0, total: 80, full: true },
        ];
        return { city: null, lots: rankLots(lots, { lat, lon }), demo: true };
      },
    },
  };
}
