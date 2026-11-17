// 共用工具：純 JS，Node 與瀏覽器皆可使用

/** 兩點距離（公尺），Haversine */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 台/臺 統一、去空白，用於站名比對 */
export function normName(s = '') {
  return String(s).replace(/臺/g, '台').replace(/\s+/g, '').replace(/站$/, '');
}

/** 公車 StopStatus 轉中文 */
export function busStatusText(status, etaSec) {
  switch (status) {
    case 1: return '尚未發車';
    case 2: return '交管不停靠';
    case 3: return '末班車已過';
    case 4: return '今日未營運';
  }
  if (etaSec == null) return '—';
  if (etaSec < 60) return '進站中';
  if (etaSec < 180) return '即將進站';
  return `${Math.floor(etaSec / 60)} 分`;
}

/** "HH:mm" 相減得分鐘數（跨日自動 +24h） */
export function minutesBetween(t1, t2) {
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1);
  if (d < 0) d += 24 * 60;
  return d;
}

/** 今天日期 YYYY-MM-DD（台灣時區） */
export function todayTW() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

export function assertLatLon(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 21 || lat > 27 || lon < 118 || lon > 123) {
    throw new UserError('經緯度不在台灣範圍內（lat 21~27, lon 118~123）');
  }
  return [lat, lon];
}

/** 給使用者看的錯誤（HTTP 400 / MCP isError） */
export class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; }
}
