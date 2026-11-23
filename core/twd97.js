// TWD97 二度分帶（TM2，中央經線 121°，EPSG:3826）→ WGS84 經緯度。純函式、不 import 任何模組（瀏覽器示範版也能打包）。
// 台北市、新北市停車場開放資料的座標是 TWD97（公尺）；TWD97 與 WGS84 差異在公分級，這裡直接當 WGS84 用。
// 公式：Snyder《Map Projections – A Working Manual》橫麥卡托反算（GRS80 橢球）。

const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9999;
const LON0 = (121 * Math.PI) / 180;
const DX = 250000;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

/** 台灣本島與近海（澎湖、綠島、蘭嶼都在內）；金門、馬祖用另一個分帶，不在這裡換算 */
const inTaiwan = (lat, lon) => lat > 21.5 && lat < 25.6 && lon > 119.2 && lon < 122.2;

/**
 * @param {number|string} x TWD97 東距（公尺）
 * @param {number|string} y TWD97 北距（公尺）
 * @returns {{ lat: number, lon: number } | null} 數字不對或換算後不在台灣就回 null
 */
export function twd97ToWgs84(x, y) {
  x = Number(x); y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  const mu = y / K0 / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const p1 = mu
    + ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * E1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(p1), cos = Math.cos(p1), tan = Math.tan(p1);
  const C = EP2 * cos ** 2;
  const T = tan ** 2;
  const N = A / Math.sqrt(1 - E2 * sin ** 2);
  const R = (A * (1 - E2)) / (1 - E2 * sin ** 2) ** 1.5;
  const D = (x - DX) / (N * K0);
  const lat = p1 - ((N * tan) / R) * (D ** 2 / 2
    - ((5 + 3 * T + 10 * C - 4 * C ** 2 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T + 298 * C + 45 * T ** 2 - 252 * EP2 - 3 * C ** 2) * D ** 6) / 720);
  const lon = LON0 + (D - ((1 + 2 * T + C) * D ** 3) / 6
    + ((5 - 2 * C + 28 * T - 3 * C ** 2 + 8 * EP2 + 24 * T ** 2) * D ** 5) / 120) / cos;
  const out = { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
  return inTaiwan(out.lat, out.lon) ? { lat: Math.round(out.lat * 1e6) / 1e6, lon: Math.round(out.lon * 1e6) / 1e6 } : null;
}
