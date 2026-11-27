// 健保署特約院所（藥局、診所）共用的純函式（架構審查 2026-11-28：兩邊各寫一份、行為已經開始分歧）：
// 地址正規化、固定看診時段解析、現在是哪個時段、同名區跨縣市只列一個。
// 不依賴 Node，伺服器與卡片共用（卡片經 /core/nhi-hours.js 取得，server/http.js SHARED_CORE）。

export const PERIODS = ['上午', '下午', '晚上'];
export const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const TW_MS = 8 * 3600e3;

/** 全形數字與「台」統一、去空白（地址比對用） */
export const normAddr = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/台/g, '臺').replace(/\s+/g, '');

/** 台灣時間的星期（0＝星期日） */
export const twDow = (now = Date.now()) => new Date(now + TW_MS).getUTCDay();

/** 台灣日期 YYYYMMDD（比對終止合約日） */
export const twYmd = (now = Date.now()) => new Date(now + TW_MS).toISOString().slice(0, 10).replaceAll('-', '');

/** 現在是哪個看診時段（健保署只登記上午、下午、晚上）：8–12 上午、12–18 下午、18–22 晚上，其他 null */
export function periodAt(now = Date.now()) {
  const hr = new Date(now + TW_MS).getUTCHours();
  return hr >= 8 && hr < 12 ? '上午' : hr >= 12 && hr < 18 ? '下午' : hr >= 18 && hr < 22 ? '晚上' : null;
}

/** 固定看診時段文字 → 7×3（[星期日..六][上午、下午、晚上]，true＝看診）；空的回 null */
export function weekSlots(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  return WEEK.map((w) => PERIODS.map((p) => s.includes(`星期${w}${p}看診`)));
}

/** 某一天有登記的時段（['上午', '晚上']）；沒填時段回 null */
export function dayPeriods(text, dow) {
  const slots = weekSlots(text);
  return slots ? PERIODS.filter((_, i) => slots[dow][i]) : null;
}

/** 地址開頭的縣市（「臺北市」「新北市」「苗栗縣」） */
export const cityOf = (addr) => /^(.{2}[市縣])/.exec(String(addr ?? ''))?.[1] || null;

/**
 * 只說區名（「中正區」）而好幾個縣市都有：只列一個縣市的，另外說還有哪些（生活資料審查：基隆市中正區的人拿到臺北市的藥局）。
 * @param {Array<{ address: string }>} list 已經依地區篩過的
 * @param {string} area 使用者說的地區（有縣市就不處理）
 * @param {string|null} [prefer] 優先的縣市（例如依位置推得的）；沒有就用清單裡第一個出現的
 * @returns {{ list: object[], city?: string, otherCities?: string[] }}
 */
export function pickCity(list, area, prefer = null) {
  if (!area || /[市縣]/.test(area)) return { list };
  const cities = [...new Set(list.map((x) => cityOf(x.address)).filter(Boolean))];
  if (cities.length < 2) return { list };
  const city = prefer && cities.includes(prefer) ? prefer : cities[0];
  return { list: list.filter((x) => cityOf(x.address) === city), city, otherCities: cities.filter((c) => c !== city) };
}
