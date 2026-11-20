// 手機 App 的本機通知（ADR-0013 M11-02）：@capacitor/local-notifications，經 Capacitor 原生橋接呼叫（免建置、不 import 套件）。
// 排好的通知由手機系統送出，App 在背景或被關掉也會響；網頁版（沒有 Capacitor）一律回 false，呼叫端改用原本的網頁通知。
const PLUGIN = 'LocalNotifications';
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};

/** 通知編號：同一種提醒只會有一則（重新排程＝覆蓋） */
export const NOTIFY_ID = { arrival: 1001, leave: 1002 };

/** 是否在手機 App 裡、可以排本機通知 */
export const hasNativeNotify = () => Boolean(cap());

/** 要通知權限（Android 13+、iOS 第一次會跳系統對話框）；回傳是否允許 */
export async function ensureNotifyPermission() {
  const c = cap();
  if (!c) return false;
  try {
    let p = await c.nativePromise(PLUGIN, 'checkPermissions', {});
    if (p?.display === 'prompt' || p?.display === 'prompt-with-rationale') p = await c.nativePromise(PLUGIN, 'requestPermissions', {});
    return p?.display === 'granted';
  } catch { return false; }
}

/**
 * 在指定時間送一則通知（同 id 先取消再排，等於更新時間與內容）。時間已過就約 1 秒後送。
 * @param {number} id  NOTIFY_ID 之一
 * @param {Date} at
 * @returns {Promise<boolean>}
 */
export async function scheduleNotify(id, at, title, body) {
  const c = cap();
  if (!c) return false;
  const when = new Date(Math.max(at.getTime(), Date.now() + 1000));
  try {
    await c.nativePromise(PLUGIN, 'cancel', { notifications: [{ id }] }).catch(() => {});
    // at 傳 Date 物件：iOS 橋接直接轉成 NSDate、Android 橋接序列化成 ISO 字串，兩邊外掛都讀得懂
    // allowWhileIdle：省電模式也送（Android 可能延後幾十秒；精準鬧鐘權限沒開時系統會用不精準排程）
    await c.nativePromise(PLUGIN, 'schedule', { notifications: [{ id, title, body, schedule: { at: when, allowWhileIdle: true } }] });
    return true;
  } catch { return false; }
}

/** 取消一則還沒送出的通知 */
export async function cancelNotify(id) {
  const c = cap();
  if (!c) return;
  try { await c.nativePromise(PLUGIN, 'cancel', { notifications: [{ id }] }); } catch { /* 沒有就算了 */ }
}
