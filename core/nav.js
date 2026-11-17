// 導航深層連結與出發時機（ADR-0011、docs/MCP_TOOLS.md §6）
// 只產生官方地圖 App 的連結，不做站內逐步導航；不帶使用者目前位置。

export const WALK_KMH = 4.5;     // 步行速度
export const DETOUR = 1.3;       // 直線距離 → 實際路徑的繞路係數

const MODES = {
  walking: { google: 'walking', apple: 'w' },
  transit: { google: 'transit', apple: 'r' },
  driving: { google: 'driving', apple: 'd' },
  bicycling: { google: 'bicycling', apple: 'w' }, // Apple 地圖網址沒有自行車參數，以步行代替
};

const isCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
const fix = (n) => Number(n.toFixed(6));

/**
 * 目的地導航連結。
 * @param {number} lat
 * @param {number} lon
 * @param {'walking'|'transit'|'driving'|'bicycling'} [mode='walking']
 * @returns {{ google: string, apple: string } | null} 座標無效時回傳 null
 */
export function navLinks(lat, lon, mode = 'walking') {
  if (!isCoord(lat, lon)) return null;
  const m = MODES[mode] || MODES.walking;
  const dest = `${fix(lat)},${fix(lon)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=${m.google}`,
    apple: `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=${m.apple}`,
  };
}

/** 依直線距離估算步行分鐘數（直線 × 1.3 ÷ 4.5 km/h，無條件進位，最少 1 分） */
export function walkMinutes(distanceM) {
  if (!Number.isFinite(distanceM) || distanceM < 0) return null;
  return Math.max(1, Math.ceil((distanceM * DETOUR) / ((WALK_KMH * 1000) / 60)));
}

/**
 * 出發時機：到站時間 − 步行時間。
 * @param {{ etaSec: number|null, distanceM: number, now?: number }} p
 * @returns {null | { walkMin: number, leaveInSec: number, leaveAt: string, status: 'ok'|'hurry'|'missed', text: string }}
 *   status：ok 還有時間；hurry 1 分鐘內要出門；missed 走過去會趕不上
 */
export function leaveAt({ etaSec, distanceM, now = Date.now() }) {
  const walkMin = walkMinutes(distanceM);
  if (!Number.isFinite(etaSec) || walkMin == null) return null;
  const leaveInSec = Math.round(etaSec - walkMin * 60);
  const status = leaveInSec < 0 ? 'missed' : leaveInSec < 60 ? 'hurry' : 'ok';
  const text = status === 'missed'
    ? `走過去要 ${walkMin} 分，這班趕不上`
    : status === 'hurry' ? `走過去要 ${walkMin} 分，現在出門剛好`
      : `走過去要 ${walkMin} 分，${Math.floor(leaveInSec / 60)} 分鐘後出門`;
  return { walkMin, leaveInSec, leaveAt: new Date(now + leaveInSec * 1000).toISOString(), status, text };
}

/** 替有 lat/lon 的清單每筆加上 nav（不修改原物件） */
export function withNav(items, mode = 'walking') {
  return items.map((x) => ({ ...x, nav: navLinks(x.lat, x.lon, mode) }));
}
