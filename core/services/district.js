// 座標 → 行政區（S16，2026-11-21）：藥局資料沒有座標、只能用「縣市＋鄉鎮區」搜尋，「附近的藥局」要先知道在哪一區。
// 真實：最近的中央氣象署測站所屬縣市與鄉鎮（weather.now 已有，免另外的金鑰與端點）。
// 示範（沒有授權碼）：內建幾個行政區的大約中心（示範用，不精確），6 公里內取最近的；找不到回 null（呼叫端請使用者說哪一區）。
import { distanceM } from '../util.js';

/** 示範用：行政區大約中心（只用來在示範模式挑一區查藥局） */
export const DEMO_DISTRICTS = [
  ['臺北市', '中正區', 25.0324, 121.5199], ['臺北市', '大安區', 25.0263, 121.5434], ['臺北市', '信義區', 25.0330, 121.5654],
  ['臺北市', '萬華區', 25.0349, 121.4997], ['臺北市', '中山區', 25.0642, 121.5333], ['臺北市', '松山區', 25.0497, 121.5775],
  ['臺北市', '大同區', 25.0631, 121.5130], ['臺北市', '士林區', 25.0928, 121.5245], ['臺北市', '內湖區', 25.0690, 121.5885],
  ['新北市', '板橋區', 25.0115, 121.4621], ['新北市', '永和區', 25.0076, 121.5138], ['新北市', '新莊區', 25.0359, 121.4502],
  ['臺中市', '西屯區', 24.1814, 120.6434], ['臺南市', '中西區', 22.9918, 120.2027], ['高雄市', '前金區', 22.6270, 120.2953],
];
const DEMO_MAX_M = 6000;

/**
 * @param {object} svc createServices() 的結果
 * @param {{ lat: number, lon: number }} p
 * @returns {Promise<{ county: string, town: string, area: string, demo: boolean }|null>}
 */
export async function districtOf(svc, { lat, lon }) {
  const w = await svc.weather?.now({ lat, lon }).catch(() => null);
  if (w?.county && w?.town) return { county: w.county, town: w.town, area: `${w.county}${w.town}`, demo: false };
  if (svc.weatherMode === 'live') return null; // 真實資料查不到行政區：不拿示範表充數
  let best = null;
  for (const [county, town, la, lo] of DEMO_DISTRICTS) {
    const d = distanceM(lat, lon, la, lo);
    if (d <= DEMO_MAX_M && (!best || d < best.d)) best = { county, town, d };
  }
  return best && { county: best.county, town: best.town, area: `${best.county}${best.town}`, demo: true };
}
