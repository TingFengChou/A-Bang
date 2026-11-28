// 大字模式（2026-11-28 Claude 與 Antigravity 第十五輪：長輩模式先做輕量的「字放大」開關）：整頁放大 15%（CSS zoom，版面跟著重排，不會左右捲）。
// 只存在這支手機（一個鍵）；預設關。設定與隱私、「我的」都可以開關。
export const BIG_TEXT_KEY = 'abang.bigText';
export const bigTextOn = () => { try { return localStorage.getItem(BIG_TEXT_KEY) === '1'; } catch { return false; } };
/** 套用到 <html>（App 啟動時、開關時） */
export function applyBigText(on = bigTextOn()) { globalThis.document?.documentElement.classList.toggle('big-text', !!on); }
export function setBigTextOn(on) {
  try { if (on) localStorage.setItem(BIG_TEXT_KEY, '1'); else localStorage.removeItem(BIG_TEXT_KEY); } catch { /* 無痕模式：只這次有效 */ }
  applyBigText(on);
}
