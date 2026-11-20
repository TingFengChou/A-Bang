// 天氣服務（示範資料版）：介面與 weather.js 相同。情境由 scenario 決定：'clear'（預設）或 'rain'。
import { assertLatLon } from '../util.js';
import { seeded } from './transit-mock.js';
import { buildWeather } from './weather.js';
import { distanceM } from '../util.js';

/** 示範用：行政區大約中心（只用來在示範模式挑一區查藥局，不精確） */
export const DEMO_DISTRICTS = [
  ['臺北市', '中正區', 25.0324, 121.5199], ['臺北市', '大安區', 25.0263, 121.5434], ['臺北市', '信義區', 25.0330, 121.5654],
  ['臺北市', '萬華區', 25.0349, 121.4997], ['臺北市', '中山區', 25.0642, 121.5333], ['臺北市', '松山區', 25.0497, 121.5775],
  ['臺北市', '大同區', 25.0631, 121.5130], ['臺北市', '士林區', 25.0928, 121.5245], ['臺北市', '內湖區', 25.0690, 121.5885],
  ['新北市', '板橋區', 25.0115, 121.4621], ['新北市', '永和區', 25.0076, 121.5138], ['新北市', '新莊區', 25.0359, 121.4502],
  ['新北市', '三重區', 25.0614, 121.4880], ['新北市', '新店區', 24.9677, 121.5413],
  ['臺中市', '西屯區', 24.1814, 120.6434], ['臺南市', '中西區', 22.9918, 120.2027], ['高雄市', '前金區', 22.6270, 120.2953],
];
const DEMO_DISTRICT_MAX_M = 6000;

export function createMockWeatherServices({ scenario = 'clear' } = {}) {
  const rain = scenario === 'rain';
  return {
    weather: {
      /** 示範：最近的內建行政區中心（6 公里內；沒有回 null） */
      async district({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        let best = null;
        for (const [county, town, la, lo] of DEMO_DISTRICTS) {
          const d = distanceM(lat, lon, la, lo);
          if (d <= DEMO_DISTRICT_MAX_M && (!best || d < best.d)) best = { county, town, d };
        }
        return best && { county: best.county, town: best.town, area: `${best.county}${best.town}`, station: '示範', distanceM: Math.round(best.d), demo: true };
      },
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
        return { town: '', county: '', date: new Date(now + 8 * 3600e3 + 864e5).toISOString().slice(0, 10), pop: rain ? 70 : 20, dayPop: rain ? 70 : 20, minT, maxT: minT + 6, wx: rain ? '短暫陣雨（示範）' : '多雲時晴（示範）', demo: true };
      },
    },
  };
}
