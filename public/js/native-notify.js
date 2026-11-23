// 手機 App 的本機通知（ADR-0013 M11-02）：@capacitor/local-notifications，經 Capacitor 原生橋接呼叫（免建置、不 import 套件）。
// 排好的通知由手機系統送出，App 在背景或被關掉也會響；網頁版（沒有 Capacitor）一律回 false，呼叫端改用原本的網頁通知。
// Android（PR #28 審查）：不用精準鬧鐘（Google Play 不允許公車提醒使用 SCHEDULE_EXACT_ALARM；沒權限時外掛還會把使用者拉去設定頁），
// 改用 allowWhileIdle 的一般排程並提早 30 秒；通知走高重要性頻道（會跳出、會震動）。
const PLUGIN = 'LocalNotifications';
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};

/** 通知編號：同一種提醒只會有一則（重新排程＝覆蓋） */
export const NOTIFY_ID = { arrival: 1001, leave: 1002, stuck: 1003, alight: 1004, invoice: 1005 };
/** 一般排程可能晚幾十秒：提早這麼多送（「約 N 分」吸收誤差） */
export const EARLY_MS = 30_000;
const CHANNEL = 'arrival';

/** 是否在手機 App 裡、可以排本機通知 */
export const hasNativeNotify = () => Boolean(cap());

let channelReady = null;
/** Android 通知頻道（高重要性：會跳出橫幅並震動）；iOS 沒有頻道，呼叫會失敗也沒關係 */
function ensureChannel(c) {
  channelReady ||= c.nativePromise(PLUGIN, 'createChannel', { id: CHANNEL, name: '公車到站與出發提醒', description: '阿幫的到站前提醒與出發提醒', importance: 4, visibility: 1, vibration: true }).catch(() => {});
  return channelReady;
}

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
 * @returns {Promise<boolean>} 排程是否成功（失敗：權限被關、外掛錯誤）
 */
export async function scheduleNotify(id, at, title, body) {
  const c = cap();
  if (!c) return false;
  const when = new Date(Math.max(at.getTime(), Date.now() + 1000));
  try {
    await ensureChannel(c);
    await c.nativePromise(PLUGIN, 'cancel', { notifications: [{ id }] }).catch(() => {});
    // at 傳 Date 物件：iOS 橋接直接轉成 NSDate、Android 橋接序列化成 ISO 字串，兩邊外掛都讀得懂
    // isExactNotification: false：Android 用一般排程（allowWhileIdle），不需要精準鬧鐘權限
    await c.nativePromise(PLUGIN, 'schedule', { notifications: [{ id, title, body, channelId: CHANNEL, schedule: { at: when, allowWhileIdle: true }, isExactNotification: false }] });
    return true;
  } catch { return false; }
}

/** 取消一則還沒送出的通知 */
export async function cancelNotify(id) {
  const c = cap();
  if (!c) return;
  try { await c.nativePromise(PLUGIN, 'cancel', { notifications: [{ id }] }); } catch { /* 沒有就算了 */ }
}
