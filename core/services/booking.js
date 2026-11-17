// 台鐵／高鐵導訂票（M3-12，ADR-0011）：產生官方訂票網站的連結，付款與個資在官方網站完成。
// ⛔ TDX「臺鐵訂票導訂」「高鐵訂票導訂」需在 TDX 會員中心申請權限，端點與參數尚未驗證（PLAN M1 待驗證表）。
// 權限與端點確認前，真實版一律回「尚未開通」並附官方訂票網站；介面與 mock 先完成，之後只換實作。
import { UserError, nowTW } from '../util.js';
import { findStation } from './transit.js';

export const SYSTEM_NAME = { THSR: '高鐵', TRA: '台鐵' };
/** 官方訂票網站（固定網址，不帶任何使用者資料） */
export const OFFICIAL_BOOKING = {
  THSR: 'https://irs.thsrc.com.tw/IMINT/',
  TRA: 'https://tip.railway.gov.tw/tra-tip-web/tip',
};
export const MAX_TICKETS = 4;
export const BOOKING_DAYS = 28; // 開放預訂天數（兩者官方皆約 28 天，⚠️ 待確認）
export const LINK_TTL_MIN = 15;  // 導訂票連結時效（⚠️ 待 TDX 文件確認）

/**
 * 檢查訂票參數，回傳正規化的 { system, trainNo, date, from, to, tickets, carType }；車站用該系統的車站清單比對。
 * @param {{ thsrStations: Function, traStations: Function }} rail
 */
export async function validateBooking(rail, { system, trainNo, date, from, to, tickets = 1, carType }, now = Date.now()) {
  if (!SYSTEM_NAME[system]) throw new UserError('system 需為 THSR（高鐵）或 TRA（台鐵）');
  if (!/^\d{1,4}$/.test(String(trainNo))) throw new UserError('車次需為 1～4 位數字，例如 123');
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS) throw new UserError(`張數需為 1～${MAX_TICKETS} 張`);
  if (carType && system !== 'THSR') throw new UserError('只有高鐵可以選車廂（標準／商務）');
  const today = nowTW(now).date;
  const last = nowTW(now + BOOKING_DAYS * 864e5).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > last) throw new UserError(`乘車日期需在今天（${today}）到 ${last} 之間`);
  const list = await (system === 'THSR' ? rail.thsrStations() : rail.traStations());
  const label = SYSTEM_NAME[system];
  const o = findStation(list, from, label), d = findStation(list, to, label);
  if (o.id === d.id) throw new UserError('起訖站不可相同');
  return { system, trainNo: String(trainNo), date, from: o, to: d, tickets, ...(carType && { carType }) };
}

/** 給使用者確認的摘要：「高鐵 123 次 2026-11-20 台北→左營 2 張（標準車廂）」 */
export const bookingSummary = (b) => `${SYSTEM_NAME[b.system]} ${b.trainNo} 次 ${b.date} ${b.from.name}→${b.to.name} ${b.tickets} 張${b.carType ? `（${b.carType === 'business' ? '商務車廂' : '標準車廂'}）` : ''}`;

export function createBookingServices(_tdx, { rail }) {
  return {
    booking: {
      async railLink(p) {
        const b = await validateBooking(rail, p);
        // 權限與端點確認前不呼叫 TDX：回清楚的「尚未開通」，並給官方訂票網站讓使用者自己訂
        throw new UserError(`${SYSTEM_NAME[b.system]}導訂票尚未開通（需在 TDX 會員中心申請「${b.system === 'THSR' ? '高鐵' : '臺鐵'}訂票導訂」權限）。請先到官方網站訂票：${OFFICIAL_BOOKING[b.system]}（${bookingSummary(b)}）`);
      },
    },
  };
}
