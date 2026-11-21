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
 * @param {'denied'|'off'|'timeout'|'unavailable'|null} [reason] 預設用最近一次定位失敗的原因
 * @returns {{ reason: string, text: string, canOpen: boolean }} canOpen：可以給「到設定開啟」按鈕
 */
export function locationHelp(reason = lastLocationError()) {
  const r = reason || 'unavailable';
  const app = isApp();
  const text = {
    denied: app
      ? `定位權限沒有打開。到手機的「設定 → Abang → 位置」允許，再回來試一次。`
      : '定位權限沒有打開。點網址列左邊的圖示，把「位置」改成允許，再重新整理。',
    off: app
      ? `手機的定位服務是關的。${isIOS() ? '到「設定 → 隱私權與安全性 → 定位服務」打開' : '從螢幕上方往下滑，打開「定位」'}，再試一次。`
      : '這台裝置的定位服務是關的。打開系統的定位服務，再試一次。',
    timeout: '定位太久沒有回應。到窗邊或戶外，或稍後再試一次。',
    unavailable: '暫時拿不到位置。確認定位已開啟，稍後再試一次。',
  }[r] || '暫時拿不到位置。確認定位已開啟，稍後再試一次。';
  return { reason: r, text, canOpen: !!native() && (r === 'denied' || r === 'off') };
}

/** 開系統設定：權限 → App 設定頁；定位服務關閉 → Android 的定位設定（iOS 只能開 App 設定頁） */
export async function openLocationSettings(reason = lastLocationError()) {
  const c = native();
  if (!c) return false;
  try { await c.nativePromise('AbangSystem', 'openSettings', { target: reason === 'off' && !isIOS() ? 'location' : 'app' }); return true; } catch { return false; }
}

/**
 * 頁面上的說明區塊（附近、生活服務頁定位失敗時）：原因＋「到設定開啟」（App）＋「再試一次」。
 * @param {{ retry?: () => void, reason?: string }} [opts]
 */
export function locationNotice({ retry, reason } = {}) {
  const h = locationHelp(reason);
  const box = document.createElement('div');
  box.className = 'loc-help';
  box.setAttribute('role', 'status');
  const p = document.createElement('p');
  p.textContent = `${h.text}現在先用台北車站附近。`;
  box.append(p);
  const row = document.createElement('div');
  row.className = 'loc-help-acts';
  if (h.canOpen) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: '到設定開啟' });
    b.addEventListener('click', async () => {
      if (!(await openLocationSettings(h.reason)) || !retry) return;
      // 從設定回來（畫面再出現）就自動再定位一次
      const back = () => { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', back); retry(); };
      document.addEventListener('visibilitychange', back);
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
