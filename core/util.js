// 共用工具：純 JS，Node 與瀏覽器皆可使用

/** TDX 多語欄位取中文：{ Zh_tw } 或字串 */
export const zh = (o) => (o && (o.Zh_tw ?? o)) || '';
/** TDX 多語欄位取英文：{ En } 有值才回傳，否則 undefined（ADR-0007 保留英文名稱） */
export const en = (o) => (o && typeof o === 'object' && typeof o.En === 'string' && o.En.trim()) || undefined;
/** 有英文時回傳 { [key]: 英文 }，沒有回傳 {}，用於展開：{ name, ...enField('nameEn', s.StationName) } */
export const enField = (key, o, fix = (x) => x) => { const v = en(o); return v ? { [key]: fix(v) } : {}; };
/** OData 字串常值跳脫（單引號重複） */
export const odataStr = (s) => String(s).replace(/'/g, "''");
/** 取回應中的陣列：本身是陣列，或包在 key 底下（例：{ Sections: [...] }） */
export const arr = (j, key) => (Array.isArray(j) ? j : (key && j?.[key]) || []);

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

/** 公車 StopStatus 轉中文；尚未發車但有預估（依班表推的）時帶上預估，跟 plan_trip 的說法一致「尚未發車，預估約 N 分後到站」（2026-11-22 真實健檢 x07） */
export function busStatusText(status, etaSec) {
  switch (status) {
    case 1: return Number.isFinite(etaSec) ? `尚未發車（預估約 ${Math.max(1, Math.ceil(etaSec / 60))} 分後到）` : '尚未發車';
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

/** 是不是日曆上真的有的 YYYY-MM-DD（2026-13-45、2026-02-30 都不是）；日期會放進 TDX 網址路徑，一定要先驗證 */
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 台灣時間的「現在」：{ date: 'YYYY-MM-DD', hhmm: 'HH:mm', weekday: 0–6（0＝週日） } */
export function nowTW(now = Date.now()) {
  const d = new Date(now + 8 * 3600e3);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16), weekday: d.getUTCDay() };
}

/** "HH:mm" ↔ 當日分鐘數（可超過 24 小時，例如 25:10） */
export const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export const toHHMM = (min) => { const m = Math.round(min); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

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

/** 非 UserError（上游、程式錯誤）對外一律回這句；細節只寫伺服器 log，避免洩漏上游回應或檔案路徑 */
// 沒有重置時間就不叫使用者「稍後再試」（Antigravity 第四輪的文案原則：不開空頭支票，說查不到）
export const INTERNAL_ERROR_MSG = '這項資料現在連不上，阿幫這次查不到。';
/** 錯誤 → 可以給使用者看的訊息 */
export const publicMessage = (e) => (e instanceof UserError ? e.message : typeof e?.publicMsg === 'string' && e.publicMsg ? e.publicMsg : INTERNAL_ERROR_MSG);
/**
 * 上游錯誤標上可以給使用者看的一句（架構第三輪 #6：原本各資料來源寫好的說明都被換成同一句，使用者不知道是哪個來源、要不要等）。
 * 只在丟錯的地方明確標：不含網址、上游回應內容、設定名稱（金鑰）；沒標的照舊回通用訊息。
 * @template {Error} E @param {E} e @param {string} [msg] 預設用錯誤本身的訊息 @returns {E}
 */
export const shown = (e, msg = e.message) => Object.assign(e, { publicMsg: msg });
