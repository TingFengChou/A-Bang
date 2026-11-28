// 快打烊了：現場常提早停止掛號、抽號（2026-11-28 Claude 與 Antigravity 第十三輪：「台灣很多診所、戶政表定 17:00，
// 現場常在打烊前 20～30 分鐘就停止掛號或抽號碼牌；16:40 說『營業到 17:00，趕得上』，人跑過去被擋在門外，信任感直接歸零」）。
// 資料沒有各家的確切時間（健保署只登記上午、下午、晚上；戶政據點沒有營業時間），所以只說「快到尾聲，先打電話」，不說幾點停止。
// 純函式，伺服器與卡片共用（卡片經 /core/closing.js，server/http.js SHARED_CORE）。

const TW_MS = 8 * 3600e3;
const minutesOfDay = (now) => { const d = new Date(Number(now) + TW_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** 健保署看診時段大約結束的時間（分鐘）：上午 12:00、下午 18:00、晚上 22:00（跟 nhi-hours.js periodAt 同一套切法） */
export const PERIOD_END_MIN = { 上午: 12 * 60, 下午: 18 * 60, 晚上: 22 * 60 };
/** 剩多少分鐘以內算「快到尾聲」 */
export const CLOSING_WITHIN_MIN = 45;

/**
 * 這個看診時段是不是快到尾聲（最後 45 分鐘）。
 * @param {string|null} period 現在的時段（periodAt 的結果）
 * @returns {boolean}
 */
export function periodClosingSoon(period, now = Date.now()) {
  const end = PERIOD_END_MIN[period];
  if (!end) return false;
  const left = end - minutesOfDay(now);
  return left > 0 && left <= CLOSING_WITHIN_MIN;
}

/** 戶政事務所多數下午 5 點下班（部分有夜間延時、週六服務）：上班日 16:15～17:00 是 'soon'，17:00 以後是 'over'；其他 null */
export const OFFICE_CLOSE_MIN = 17 * 60;
export function officeClosing(workday, now = Date.now()) {
  if (!workday) return null;
  const m = minutesOfDay(now);
  if (m >= OFFICE_CLOSE_MIN) return 'over';
  return OFFICE_CLOSE_MIN - m <= CLOSING_WITHIN_MIN ? 'soon' : null;
}
