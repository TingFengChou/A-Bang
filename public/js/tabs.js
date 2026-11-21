// 底部分頁列（2026-11-21 首頁與導覽重新設計，Austin：「最下面都是公車相關，跟全方位資料整合＋edge AI 的 App 不相符」）：
// 首頁｜服務｜問阿幫（中央大鍵）｜提醒｜我的。中央鍵不是連結：在其他頁拉出同一段對話（abang-dock.js），在問阿幫頁聚焦輸入框。
// 這裡只放純資料與純函式（node:test 可測），畫面在 app.js。

/** [網址, 字典鍵, 圖示]；ask 是中央大鍵（按鈕） */
export const TABS = [
  { id: 'home', href: '#/', key: 'tab.home', icon: 'home' },
  { id: 'services', href: '#/services', key: 'tab.services', icon: 'grid' },
  { id: 'ask', href: '#/agent', key: 'tab.ask', center: true },
  { id: 'reminders', href: '#/reminders', key: 'tab.reminders', icon: 'bell' },
  { id: 'me', href: '#/me', key: 'tab.me', icon: 'user' },
];

/** 子頁面屬於哪一個分頁（分頁列標「目前在這一區」）：資料服務 → 服務；收藏、設定、隱私、阿幫的腦袋 → 我的 */
const SECTIONS = [
  [/^\/?$/, 'home'],
  [/^\/services$/, 'services'],
  [/^\/(nearby|bus|bus-station|rail|s)(\/|$)/, 'services'],
  [/^\/agent\/(?!life$)[a-z]/, 'services'], // 防詐等其他 agent 是服務；生活 agent 是中央鍵
  [/^\/agent(\/life)?$/, 'ask'],
  [/^\/reminders$/, 'reminders'],
  [/^\/(me|favs|settings|privacy|ai)$/, 'me'], // ai：阿幫的腦袋（手機上的 AI）
];

/**
 * 目前網址（不含 #、不含 ?）對應的分頁與是不是分頁本身。
 * @param {string} path 例：'/'、'/bus/Taipei/307'
 * @returns {{ tab: string|null, exact: boolean }}
 */
export function activeTab(path = '/') {
  const p = path || '/';
  const hit = SECTIONS.find(([re]) => re.test(p));
  if (!hit) return { tab: null, exact: false };
  const tab = hit[1];
  const t = TABS.find((x) => x.id === tab);
  const exact = `#${p}` === t.href || (tab === 'home' && (p === '' || p === '/')) || (tab === 'ask' && p === '/agent/life');
  return { tab, exact };
}

/** 分頁上的 aria-current：分頁本身＝page；在這一區的子頁＝true；其他不標 */
export const currentAttr = (tabId, path) => {
  const a = activeTab(path);
  return a.tab !== tabId ? null : a.exact ? 'page' : 'true';
};

/**
 * Android 返回鍵（不含對話框：app.js 先關對話框）：首頁＝離開 App；分頁本身（服務、提醒、我的、問阿幫）＝回首頁（不走分頁之間的歷史）；
 * 其他頁有上一頁就回上一頁，沒有（深層連結打開）回首頁。
 * @returns {'exit'|'back'|'#/'}
 */
export function backTarget(path = '/', canGoBack = false) {
  const a = activeTab(path);
  if (a.tab === 'home' && a.exact) return 'exit';
  if (a.exact) return '#/';
  return canGoBack ? 'back' : '#/';
}
