// 台灣國定假日（含補假）：內建清單 core/data/tw-holidays.json（行政院人事行政總處公告，以官方為準；⚠️ 待校對）。
// 捷運站別時刻表（core/services/metro.js）在國定假日改用 ServiceDay.NationalHolidays 的假日班表。日期一律用台灣時間判斷。
import HOLIDAYS from './data/tw-holidays.json' with { type: 'json' };

const DATES = new Map(Object.values(HOLIDAYS.years).flat().map((x) => [x.date, x.name]));
/** 清單涵蓋的年份（範圍外的年份一律當成不是國定假日：照星期幾） */
export const HOLIDAY_YEARS = Object.keys(HOLIDAYS.years).map(Number);

/** 台灣時間的日期（YYYY-MM-DD）；dayOffset：前後幾天（凌晨看前一天的營運日） */
export function twDate(now = Date.now(), dayOffset = 0) {
  return new Date(now + 8 * 3600e3 + dayOffset * 86400e3).toISOString().slice(0, 10);
}

/** 這一天（YYYY-MM-DD，台灣日期）是國定假日或補假嗎 */
export const isNationalHoliday = (ymd) => DATES.has(String(ymd));
/** 國定假日的名稱（不是回 null） */
export const holidayName = (ymd) => DATES.get(String(ymd)) || null;
