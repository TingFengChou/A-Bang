// 我有車（2026-11-22 產品負責人「交通方式還有應該是自行開車」）：設定頁開了，行程比較才加入「自己開車」（不是每個人都有車）。
// 只存在這支手機（預設沒有）；問阿幫送 userState.car: true，伺服器只採用這個（模型帶的拿掉）。
export const CAR_KEY = 'abang.car';
export function hasCar() {
  try { return localStorage.getItem(CAR_KEY) === '1'; } catch { return false; }
}
export function setHasCar(on) {
  try { if (on) localStorage.setItem(CAR_KEY, '1'); else localStorage.removeItem(CAR_KEY); } catch { /* 無痕模式 */ }
}
