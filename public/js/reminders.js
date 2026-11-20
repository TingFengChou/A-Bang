// 出門提醒（T7，2026-11-21）：可以有多筆、可以取消，存在這支手機（localStorage abang.reminders）。
// 手機 App：系統本機通知（每筆一個通知編號，App 關著也會響）；網頁：計時器＋通知（頁面開著才會響，重新整理後還原）。
// 同一段路線（key）只留一筆：重新規劃後再按「提醒我出門」是改時間，不會變兩則。
// 關機期間錯過的提醒：Android 外掛開機後約 15 秒會補送（App 還沒打開就響，PR #50 審查），沒辦法事先擋；
// 打開 App 時把過期的從通知列移除、取消排程，並從清單刪掉。iOS 關機錯過的不會補送。
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify } from './native-notify.js';

const KEY = 'abang.reminders';
/** 原生通知編號範圍（到站提醒 1001、舊版出門提醒 1002 不在這裡） */
const NID_BASE = 2000;
const NID_SPAN = 1000;
/** 最多同時幾筆（避免無限累積） */
export const MAX_REMINDERS = 5;
const TITLE = '阿幫提醒';
const timers = new Map();
const emit = () => globalThis.dispatchEvent?.(new CustomEvent('abang:reminders'));

function load() {
  try { const all = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(all) ? all.filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.at)) : []; } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 無痕模式 */ }
}

/** @returns {Array<{ id: string, at: number, text: string, nid: number, key?: string, opt?: string }>} 還沒到的、依時間排序 */
export function listReminders(now = Date.now()) {
  return load().filter((r) => r.at > now).sort((a, b) => a.at - b.at);
}

/** 這段路線（key）目前的提醒；沒有回 null */
export const reminderFor = (key) => (key ? listReminders().find((r) => r.key === key) || null : null);

/** 這個裝置能不能發通知（同步）：App 有本機通知；網頁要有 Notification（iOS Safari 沒加到主畫面就沒有） */
export const canNotify = () => hasNativeNotify() || typeof Notification !== 'undefined';

/** 通知權限現況（不跳對話框）：granted／denied／prompt／unsupported */
export async function notifyState() {
  const c = globalThis.Capacitor;
  if (hasNativeNotify()) {
    try { const d = (await c.nativePromise('LocalNotifications', 'checkPermissions', {}))?.display; return d === 'granted' ? 'granted' : d === 'denied' ? 'denied' : 'prompt'; } catch { return 'prompt'; }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

/** 網頁通知：先用 service worker（Android Chrome 不能 new Notification），沒有再用建構子；tag＝提醒 id（多個分頁不重複） */
async function showWeb(r) {
  const opts = { body: r.text, icon: '/icons/icon.svg', tag: r.id };
  try {
    const reg = await globalThis.navigator?.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) { await reg.showNotification(TITLE, opts); return; }
  } catch { /* 改用建構子 */ }
  try { new Notification(TITLE, opts); } catch { /* 這個瀏覽器不能顯示 */ }
}

function webTimer(r) {
  clearTimeout(timers.get(r.id));
  const delay = r.at - Date.now();
  if (delay <= 0) return;
  timers.set(r.id, setTimeout(() => {
    timers.delete(r.id);
    if (!load().some((x) => x.id === r.id)) return; // 別的分頁或設定頁已經取消
    showWeb(r);
    save(load().filter((x) => x.id !== r.id));
    emit();
  }, delay));
}

function drop(r) {
  clearTimeout(timers.get(r.id)); timers.delete(r.id);
  if (hasNativeNotify() && Number.isInteger(r.nid)) cancelNotify(r.nid);
}

/**
 * 新增提醒。同一段路線（key）已有提醒就換成新的（改時間）；同時間同文字視為同一筆。
 * @param {Date} when
 * @param {string} text
 * @param {{ key?: string, opt?: string }} [meta]  key：路線（起訖）；opt：方案 id（卡片判斷「這個方案已設定」）
 * @returns {Promise<string|false>} 提醒 id；權限被拒、時間不對、裝置不支援回 false
 */
export async function addReminder(when, text, { key, opt } = {}) {
  const at = when.getTime();
  const delay = at - Date.now();
  if (!(delay > 0 && delay < 12 * 3600e3)) return false;
  let list = listReminders();
  const same = list.find((r) => r.at === at && r.text === text);
  if (same) return same.id;
  const old = key ? list.find((r) => r.key === key) : null;
  if (!old && list.length >= MAX_REMINDERS) return false;
  const used = new Set(list.filter((r) => r !== old).map((r) => r.nid));
  let nid = NID_BASE + (Math.floor(at / 60000) % NID_SPAN);
  while (used.has(nid)) nid = NID_BASE + ((nid - NID_BASE + 1) % NID_SPAN);
  const r = { id: `r${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, text, nid, ...(key && { key }), ...(opt && { opt }) };
  if (hasNativeNotify()) {
    if (!(await ensureNotifyPermission())) return false;
    if (old && old.nid !== nid) cancelNotify(old.nid);
    if (!(await scheduleNotify(nid, when, TITLE, text))) return false;
  } else {
    if (typeof Notification === 'undefined') return false;
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return false;
    if (old) drop(old);
  }
  list = listReminders().filter((x) => x.id !== old?.id);
  save([...list, r]);
  if (!hasNativeNotify()) webTimer(r);
  emit();
  return r.id;
}

/** 取消一筆（id）；回傳是否還有這筆（已響過或已取消回 false） */
export function cancelReminder(id) {
  const all = load();
  const r = all.find((x) => x.id === id);
  if (!r) return false;
  drop(r);
  save(all.filter((x) => x.id !== id));
  emit();
  return r.at > Date.now();
}

/** 全部取消（清除本機資料） */
export function cancelAllReminders() {
  for (const r of load()) drop(r);
  timers.clear();
  try { localStorage.removeItem(KEY); } catch { /* 無痕模式 */ }
  emit();
}

/**
 * 打開 App／網頁時：過期的取消排程、從通知列移除（Android 開機後補送的舊提醒）並刪掉；網頁版把還沒到的重新排上（重新整理後還原）。
 * @returns {Array<object>} 還沒到的提醒
 */
export function restoreReminders(now = Date.now()) {
  const all = load();
  const alive = [];
  const stale = [];
  for (const r of all) (r.at > now ? alive : stale).push(r);
  if (hasNativeNotify()) {
    const c = globalThis.Capacitor;
    const ids = stale.filter((r) => Number.isInteger(r.nid)).map((r) => ({ id: r.nid }));
    for (const { id } of ids) cancelNotify(id);
    if (ids.length) c.nativePromise('LocalNotifications', 'removeDeliveredNotifications', { notifications: ids }).catch(() => {});
  } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const r of alive) webTimer(r);
  }
  if (stale.length) { save(alive); emit(); }
  return alive;
}

// 別的分頁取消或新增：這個分頁的計時器跟著更新
globalThis.addEventListener?.('storage', (e) => {
  if (e.key !== KEY) return;
  const ids = new Set(load().map((r) => r.id));
  for (const id of [...timers.keys()]) if (!ids.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
  emit();
});

