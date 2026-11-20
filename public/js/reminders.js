// 出門提醒（T7，2026-11-21）：可以有多筆、可以取消，存在這支手機（localStorage abang.reminders）。
// 手機 App：系統本機通知（每筆一個通知編號，App 關著也會響）；網頁：setTimeout＋瀏覽器通知（頁面開著才會響，重新整理後還原）。
// 打開 App 時清掉已過期的（重開機後系統補送舊通知也一併取消，不補送過時的「該出門了」）。
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify } from './native-notify.js';

const KEY = 'abang.reminders';
/** 原生通知編號範圍（到站提醒 1001、舊版出門提醒 1002 不在這裡） */
const NID_BASE = 2000;
const NID_SPAN = 1000;
/** 最多同時幾筆（避免無限累積） */
export const MAX_REMINDERS = 5;
const TITLE = '阿幫提醒';
const timers = new Map();

/** @returns {Array<{ id: string, at: number, text: string, nid: number }>} 依時間排序、還沒過期的 */
export function listReminders(now = Date.now()) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    return (Array.isArray(all) ? all : []).filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.at) && r.at > now - 60_000).sort((a, b) => a.at - b.at);
  } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 無痕模式 */ }
}

/** 通知權限現況（不跳對話框）：granted／denied／prompt／unsupported */
export async function notifyState() {
  const c = globalThis.Capacitor;
  if (hasNativeNotify()) {
    try { const d = (await c.nativePromise('LocalNotifications', 'checkPermissions', {}))?.display; return d === 'granted' ? 'granted' : d === 'denied' ? 'denied' : 'prompt'; } catch { return 'prompt'; }
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : Notification.permission;
}

function webTimer(r) {
  clearTimeout(timers.get(r.id));
  const delay = r.at - Date.now();
  if (delay <= 0) return;
  timers.set(r.id, setTimeout(() => {
    timers.delete(r.id);
    try { new Notification(TITLE, { body: r.text, icon: '/icons/icon.svg' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
    save(listReminders().filter((x) => x.id !== r.id));
    globalThis.dispatchEvent?.(new CustomEvent('abang:reminders'));
  }, delay));
}

/**
 * 新增提醒（同一時間同一段文字視為同一筆）。
 * @param {Date} when
 * @param {string} text
 * @returns {Promise<string|false>} 提醒 id；權限被拒、時間不對、裝置不支援回 false
 */
export async function addReminder(when, text) {
  const at = when.getTime();
  const delay = at - Date.now();
  if (!(delay > 0 && delay < 12 * 3600e3)) return false;
  const list = listReminders();
  const same = list.find((r) => r.at === at && r.text === text);
  if (same) return same.id;
  if (list.length >= MAX_REMINDERS) return false;
  const used = new Set(list.map((r) => r.nid));
  let nid = NID_BASE + (Math.floor(at / 60000) % NID_SPAN);
  while (used.has(nid)) nid = NID_BASE + ((nid - NID_BASE + 1) % NID_SPAN);
  const r = { id: `r${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, text, nid };
  if (hasNativeNotify()) {
    if (!(await ensureNotifyPermission()) || !(await scheduleNotify(nid, when, TITLE, text))) return false;
  } else {
    if (typeof Notification === 'undefined') return false;
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return false;
    webTimer(r);
  }
  save([...list, r]);
  globalThis.dispatchEvent?.(new CustomEvent('abang:reminders'));
  return r.id;
}

/** 取消一筆（id）；回傳是否有這筆 */
export function cancelReminder(id) {
  const list = listReminders(0);
  const r = list.find((x) => x.id === id);
  if (!r) return false;
  clearTimeout(timers.get(id)); timers.delete(id);
  if (hasNativeNotify()) cancelNotify(r.nid);
  save(list.filter((x) => x.id !== id));
  globalThis.dispatchEvent?.(new CustomEvent('abang:reminders'));
  return true;
}

/** 全部取消（清除本機資料） */
export function cancelAllReminders() {
  for (const r of listReminders(0)) { clearTimeout(timers.get(r.id)); if (hasNativeNotify()) cancelNotify(r.nid); }
  timers.clear();
  try { localStorage.removeItem(KEY); } catch { /* 無痕模式 */ }
}

/**
 * 打開 App／網頁時：過期的取消（系統重開機後補送的舊通知也不要響）並移除；網頁版把還沒到的重新排上（重新整理後還原）。
 */
export function restoreReminders(now = Date.now()) {
  let all;
  try { all = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { all = []; }
  if (!Array.isArray(all)) all = [];
  const alive = [];
  for (const r of all) {
    if (!r || !Number.isFinite(r.at)) continue;
    if (r.at <= now) { if (hasNativeNotify() && Number.isInteger(r.nid)) cancelNotify(r.nid); continue; }
    alive.push(r);
    if (!hasNativeNotify() && typeof Notification !== 'undefined' && Notification.permission === 'granted') webTimer(r);
  }
  if (alive.length !== all.length) save(alive);
  return alive;
}
