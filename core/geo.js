// 幾何工具：解析 TDX Bus Shape 的 WKT，輸出 [[lat, lon], ...]（docs/MCP_TOOLS.md §3）
// WKT 座標順序是「經度 緯度」；TDX 實際格式待 M1 驗證，所以這裡全部防禦性解析：
// 看不懂就回空陣列，由呼叫端決定省略 shape，不讓整個查詢失敗。

const isLatLon = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** "121.5 25.0, 121.6 25.1" → [[25.0, 121.5], [25.1, 121.6]]；任一點無效回傳 null */
function parseCoordList(body) {
  const out = [];
  for (const pair of body.split(',')) {
    const [a, b] = pair.trim().split(/\s+/).map(Number);
    // 標準 WKT 是 (lon lat)；台灣經度 > 90、緯度 < 90，若資料把順序寫反就換回來
    let lat = b, lon = a;
    if (Math.abs(a) <= 90 && Math.abs(b) > 90) [lat, lon] = [a, b];
    if (!isLatLon(lat, lon)) return null;
    out.push([lat, lon]);
  }
  return out;
}

/**
 * 解析 WKT 的 LINESTRING／MULTILINESTRING（可帶 `SRID=4326;` 前綴）。
 * @param {string} wkt
 * @returns {Array<Array<[number, number]>>} 每條線一個陣列；格式不支援或解析失敗回傳 []
 */
export function parseWkt(wkt) {
  if (typeof wkt !== 'string') return [];
  const s = wkt.trim().replace(/^SRID=\d+;/i, '');
  const m = /^(MULTI)?LINESTRING\s*\((.*)\)$/is.exec(s);
  if (!m) return [];
  const parts = m[1] ? m[2].match(/\(([^()]*)\)/g)?.map((p) => p.slice(1, -1)) || [] : [m[2]];
  const lines = parts.map(parseCoordList);
  if (!lines.length || lines.some((l) => !l || l.length < 2)) return [];
  return lines;
}

/** 把 WKT 攤平成一條路徑（MULTILINESTRING 依序串接，去掉接點重複的點） */
export function pathFromWkt(wkt) {
  const out = [];
  for (const line of parseWkt(wkt)) {
    for (const p of line) {
      const last = out.at(-1);
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

/**
 * 點太多時等距抽樣，保留第一點與最後一點（控制回傳大小）。
 * @param {Array<[number, number]>} points
 * @param {number} [max=400]
 */
export function thinPath(points, max = 400) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
