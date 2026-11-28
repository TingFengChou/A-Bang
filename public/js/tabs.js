// 外殼的頁面矩陣（ADR-0023 §3，2026-11-29 首頁改版 H3；規格 docs/HOME_REDESIGN.md §5）：拿掉底部分頁列。
//   home：首頁自己有日期列、提醒與個人鍵、「您可能想問」＋輸入列
//   dock：一級總覽頁（全部服務、提醒、個人）底部是輸入列（相機、輸入框、麥克風）；全部服務多一排「您可能想問」
//   fab ：內容頁（公車、鐵道、附近、各資料頁、收藏、阿幫的腦袋）右下角一顆「問阿幫」浮動鍵，拉出同一段對話（abang-dock.js）
//   none：問阿幫頁（有自己的輸入區）、設定、隱私（表單）不放
// 這裡只放純資料與純函式（node:test 可測），畫面在 app.js。

const CHROME = [
  [/^\/?$/, 'home'],
  [/^\/(services|reminders|me)$/, 'dock'],
  [/^\/agent(\/|$)/, 'none'],
  [/^\/(settings|privacy)$/, 'none'],
];

/**
 * 這一頁底部放什麼。
 * @param {string} path 例：'/'、'/bus/Taipei/307'（不含 #、不含 ?）
 * @returns {'home'|'dock'|'fab'|'none'}
 */
export function chromeOf(path = '/') {
  const p = path || '/';
  const hit = CHROME.find(([re]) => re.test(p));
  return hit ? hit[1] : 'fab';
}

/** 全部服務才放「您可能想問」（提醒、個人只放輸入列） */
export const dockAsks = (path) => path === '/services';

/**
 * Android 返回鍵（不含對話框：app.js 先關對話框）：首頁＝離開 App；其他頁有上一頁就回上一頁，沒有（深層連結打開）回首頁。
 * 不寫死回首頁（Antigravity 第十九輪）。
 * @returns {'exit'|'back'|'#/'}
 */
export function backTarget(path = '/', canGoBack = false) {
  if (chromeOf(path) === 'home') return 'exit';
  return canGoBack ? 'back' : '#/';
}
