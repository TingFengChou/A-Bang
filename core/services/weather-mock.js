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
    },
  };
}
