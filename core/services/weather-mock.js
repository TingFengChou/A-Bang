// 天氣服務（示範資料版）：介面與 weather.js 相同。情境由 scenario 決定：'clear'（預設）或 'rain'。
import { assertLatLon } from '../util.js';
import { seeded } from './transit-mock.js';
import { buildWeather } from './weather.js';

export function createMockWeatherServices({ scenario = 'clear' } = {}) {
  const rain = scenario === 'rain';
  return {
    weather: {
      async now({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        const r = seeded(`wx${lat.toFixed(2)},${lon.toFixed(2)}`);
        const st = {
          name: '示範測站', town: '', county: '',
          lat: lat + 0.005, lon: lon + 0.005, observedAt: new Date().toISOString(),
          tempC: Math.round((rain ? 19 : 23) + r() * 6),
          weather: rain ? '陰有雨（示範）' : '多雲（示範）',
        };
        const gauge = { name: '示範雨量站', rainMm1h: rain ? 2.5 : 0 };
        return { ...buildWeather(st, gauge, rain ? 80 : 10, lat, lon), demo: true };
      },
      async tomorrow({ lat, lon }, now = Date.now()) {
        [lat, lon] = assertLatLon(lat, lon);
        const r = seeded(`wxt${lat.toFixed(2)},${lon.toFixed(2)}`);
        const minT = Math.round((rain ? 17 : 20) + r() * 3);
        return { town: '', county: '', date: new Date(now + 8 * 3600e3 + 864e5).toISOString().slice(0, 10), pop: rain ? 70 : 20, minT, maxT: minT + 6, wx: rain ? '短暫陣雨（示範）' : '多雲時晴（示範）', demo: true };
      },
    },
  };
}
