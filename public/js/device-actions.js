// 阿幫動手做（ADR-0021）：加到行事曆、分享——最後一步由系統畫面確認，阿幫不代按。
// 手機 App：AbangSystem 外掛開系統的新增行程畫面（iOS EKEventEditViewController、Android ACTION_INSERT）與分享面板。
// 網頁：行事曆下載 .ics；分享用 Web Share API，不支援就複製文字。內容由 core/device-actions.js 產生（不經模型）。
import { cleanCalendarEvent, cleanShare, toIcs } from '../../core/device-actions.js';
import { tFor } from '../ui/cards/i18n/index.js';

const PLUGIN = 'AbangSystem';
const app = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' && (c.isPluginAvailable ? c.isPluginAvailable(PLUGIN) : true) ? c : null; } catch { return null; }
};
/** 舊版 App 的外掛沒有這個方法（UNIMPLEMENTED）：照實說要更新，不改走網頁的下載（App 內的 WebView 下載不了檔案） */
const outdated = (e) => /UNIMPLEMENTED|not implemented/i.test(String(e?.code || e?.message || e));

/**
 * 加到行事曆。
 * @returns {Promise<'saved'|'cancelled'|'opened'|'downloaded'|'denied'|'outdated'|'failed'>} saved／cancelled：iOS 系統畫面的結果；opened：Android 打開了行事曆 App；downloaded：網頁下載了 .ics
 */
export async function addCalendar(event, { doc = globalThis.document, now = Date.now() } = {}) {
  const e = cleanCalendarEvent(event);
  if (!e) return 'failed';
  const c = app();
  if (c) {
    try { const r = await c.nativePromise(PLUGIN, 'addCalendarEvent', e); return r?.opened ? 'opened' : r?.saved ? 'saved' : 'cancelled'; } catch (err) { return outdated(err) ? 'outdated' : err?.code === 'denied' ? 'denied' : 'failed'; } // Android 只知道打開了（opened）
  }
  const ics = toIcs(e, { uid: `${e.start}-${now}`, now });
  if (!ics || !doc?.createElement || typeof Blob === 'undefined') return 'failed';
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url; a.download = 'abang-trip.ics'; a.rel = 'noopener';
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/**
 * 分享。
 * @returns {Promise<'shared'|'cancelled'|'opened'|'copied'|'outdated'|'failed'>} opened：Android 打開了分享選單（拿不到有沒有送出）
 */
export async function share(payload, { nav = globalThis.navigator } = {}) {
  const p = cleanShare(payload);
  if (!p) return 'failed';
  const c = app();
  if (c) {
    try { const r = await c.nativePromise(PLUGIN, 'share', p); return r?.opened ? 'opened' : r?.shared === false ? 'cancelled' : 'shared'; } catch (err) { return outdated(err) ? 'outdated' : 'failed'; }
  }
  if (typeof nav?.share === 'function') {
    try { await nav.share({ ...(p.title && { title: p.title }), text: p.text, ...(p.url && { url: p.url }) }); return 'shared'; } catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  }
  try { await nav.clipboard.writeText(p.url ? `${p.text}\n${p.url}` : p.text); return 'copied'; } catch { return 'failed'; }
}

/** 這個客戶端做得到的裝置動作（送給伺服器：deviceActions.can） */
export const deviceActionsCan = () => ['addCalendar', 'share'];

/** 結果 → 給使用者看的一句：用卡片字典（public/ui/cards/i18n 的 device.*），卡片按鈕與對話說法一致 */
export function resultText(kind, r, lang = null) {
  const t = tFor(lang === 'en' ? 'en' : 'zh-TW');
  const key = `device.${kind}.${r}`;
  return t(key) === key ? t('device.failed') : t(key);
}
