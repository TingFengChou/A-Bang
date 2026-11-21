// 定位失敗時說清楚原因與下一步（S1c）：權限沒開、定位服務關閉、太久沒回應。
// 手機 App 給「到設定開啟」按鈕（專案內外掛 AbangSystem：Android 開 App 設定或定位設定、iOS 開 App 設定）；網頁版說明瀏覽器怎麼開。
import { lastLocationError } from './agent/client.js';

const native = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && c.isPluginAvailable?.('AbangSystem') && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};
const isApp = () => { try { return !!globalThis.Capacitor?.isNativePlatform?.(); } catch { return false; } };
const isIOS = () => { try { return globalThis.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; } };

/**
 * 原因 → 給人看的說明。
 * iOS 的「定位服務」總開關不在 App 的設定頁，開設定也沒用：只說路徑、不給按鈕。
 * @param {'denied'|'off'|'timeout'|'unavailable'|null} [reason] 預設用最近一次定位失敗的原因
 * @returns {{ reason: string, why: string, fix: string, text: string, canOpen: boolean }}
 *   why＋fix 不含「再試一次」（引導等沒有重試按鈕的地方用）；text＝完整一句；canOpen：可以給「到設定開啟」按鈕
 */
export function locationHelp(reason = lastLocationError()) {
  const r = ['denied', 'off', 'timeout', 'unavailable'].includes(reason) ? reason : 'unavailable';
  const app = isApp();
  const ios = isIOS();
  const canOpen = !!native() && (r === 'denied' || (r === 'off' && !ios));
  const [why, fix] = {
    denied: ['定位權限沒有打開。', !app
      ? '到瀏覽器的網站設定，把「位置」改成允許'
      : canOpen ? `按「到設定開啟」，在${ios ? '「位置」選「使用 App 期間」' : '「權限 → 位置資訊」選允許'}`
        : ios ? '到手機的「設定 → App → Abang → 位置」選「使用 App 期間」' : '到手機的「設定 → 應用程式 → Abang → 權限 → 位置資訊」選允許'],
    off: [app ? '手機的定位服務是關的。' : '這台裝置的定位服務是關的。', !app
      ? '打開系統的定位服務'
      : ios ? '到「設定 → 隱私權與安全性 → 定位服務」打開' : canOpen ? '按「到設定開啟」打開「使用位置資訊」' : '從螢幕上方往下滑，打開「位置資訊」'],
    timeout: ['定位太久沒有回應。', '到窗邊或戶外，或稍後'],
    unavailable: ['暫時拿不到位置。', '確認定位已開啟，稍後'],
  }[r];
  const tail = r === 'timeout' || r === 'unavailable' ? '再試一次。' : '，再試一次。';
  return { reason: r, why, fix, text: `${why}${fix}${tail}`, canOpen };
}

/** 開系統設定：權限 → App 設定頁；定位服務關閉 → Android 的定位設定。打不開回 false（畫面要說） */
export async function openLocationSettings(reason = lastLocationError()) {
  const c = native();
  if (!c) return false;
  try { await c.nativePromise('AbangSystem', 'openSettings', { target: reason === 'off' && !isIOS() ? 'location' : 'app' }); return true; } catch { return false; }
}
export const OPEN_FAILED = '打不開設定，請自己到手機的設定開啟。';

/**
 * 頁面上的說明區塊（附近、生活服務頁定位失敗時）：原因＋「到設定開啟」（App）＋「再試一次」。
 * @param {{ retry?: () => void, reason?: string, onCleanup?: (fn: () => void) => void }} [opts]
 *   onCleanup：離開頁面時拿掉「從設定回來自動重試」的監聽
 */
export function locationNotice({ retry, reason, onCleanup } = {}) {
  const h = locationHelp(reason);
  const box = document.createElement('div');
  box.className = 'loc-help';
  const p = document.createElement('p');
  p.setAttribute('role', 'status'); // 只有文字是即時區域（按鈕不在裡面）；先放進畫面再填字，讀屏才會念
  box.append(p);
  const text = `${h.text}現在先用台北車站附近。`;
  setTimeout(() => { p.textContent = text; }, 0);
  const row = document.createElement('div');
  row.className = 'loc-help-acts';
  if (h.canOpen) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: '到設定開啟' });
    let back = null;
    const stop = () => { if (back) document.removeEventListener('visibilitychange', back); back = null; };
    onCleanup?.(stop);
    b.addEventListener('click', async () => {
      // 先掛好「回來就重試」再開設定（iOS 回到前景時 JS 才收到開啟結果，晚掛會錯過）；只掛一個
      if (retry && !back) {
        back = () => { if (document.visibilityState !== 'visible') return; stop(); retry(); };
        document.addEventListener('visibilitychange', back);
      }
      if (!(await openLocationSettings(h.reason))) { stop(); p.textContent = OPEN_FAILED; }
    });
    row.append(b);
  }
  if (retry) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: '再試一次' });
    b.addEventListener('click', retry);
    row.append(b);
  }
  if (row.childElementCount) box.append(row);
  return box;
}
