// 卡片共用的行動按鈕：導航、L2 連結（叫車、訂票）。L2 一律帶 confirm，由 host 顯示確認視窗（ADR-0011）。
import { h, safeUrl } from './dom.js';
import { t } from './i18n/index.js';

/** 導航按鈕（nav 為 { google, apple }；沒有就不顯示） */
export function navButton(host, nav, label = t('common.navigate')) {
  const url = safeUrl(nav?.google);
  if (!url || !host?.openLink) return null;
  return h('button', { class: 'ab-btn', type: 'button', onclick: (e) => { e.stopPropagation(); host.openLink(url); } }, label);
}

/** L2 連結按鈕：開啟前必須確認 */
export function confirmLinkButton(host, url, confirmText, label) {
  const u = safeUrl(url);
  if (!u || !host?.openLink) return null;
  const confirm = confirmText || t('confirm.title'); // 畫的時候就取字（點的時候已不在卡片的語言裡）
  return h('button', { class: 'ab-btn ab-primary', type: 'button', onclick: (e) => { e.stopPropagation(); host.openLink(u, { confirm }); } }, label);
}

/**
 * 訂票按鈕：先呼叫 rail_booking_link 取得連結（失敗時顯示錯誤訊息，例如「尚未開通」），再確認開啟。
 * @param {{ system, trainNo, date, from, to }} q
 */
export function bookButton(host, q, onError) {
  if (!host?.callTool || !host?.openLink || !['THSR', 'TRA'].includes(q.system)) return null;
  return h('button', {
    class: 'ab-btn', type: 'button',
    onclick: async (e) => {
      e.stopPropagation();
      try {
        const r = await host.callTool('rail_booking_link', q);
        const u = safeUrl(r?.data?.url);
        if (u) host.openLink(u, { confirm: r.data.confirmText });
      } catch (err) { onError?.(err?.message || String(err)); }
    },
  }, t('timetable.book'));
}
