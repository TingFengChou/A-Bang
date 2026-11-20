// 下車提醒（2026-11-21，PLAN「行程中模式、下車提醒」）：上車後選要在哪一站下車，快到時提醒「準備下車」。
// 判斷：知道車牌時，等目的站「下一班」就是我這台（plate 相同）且剩 ≤ 2 分；不知道車牌就用上車時估的乘車時間。
// 手機 App：每次更新把通知排到預估時間（App 關著也會響）；網頁：頁面開著時提醒。最多盯 3 小時。
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID, EARLY_MS } from './native-notify.js';

export const ALIGHT_SEC = 120;
const POLL_MS = 20_000;
const MAX_MS = 3 * 3600e3;
const TITLE = '阿幫：準備下車';
const KEY = 'abang.alightWatch';
const state = { w: null, poll: null, nativeAt: 0 };
const signal = (type, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };

/** 「下一站就是「市府」，準備下車」／「約 2 分後到「市府」，準備下車」 */
export const alightText = (dest, sec) => (sec != null && sec < 60 ? `快到「${dest}」了，準備下車！` : `約 ${Math.max(1, Math.round((sec ?? ALIGHT_SEC) / 60))} 分後到「${dest}」，準備下車`);

/**
 * 該提醒下車了嗎（純函式，方便測試）。
 * @param {{ dest: string, plate?: string|null, boardAt: number, rideSec: number }} w
 * @param {Array<{ stopName: string, etaSec: number|null, status: number, plate?: string|null }>} stops 這個方向的各站
 * @returns {{ due: boolean, etaSec: number|null, by: 'plate'|'time'|null }}
 */
export function alightDue(w, stops, now = Date.now()) {
  const d = stops.find((s) => s.stopName === w.dest);
  const live = d && d.status === 0 && d.etaSec != null;
  if (w.plate && live && d.plate === w.plate) return { due: d.etaSec <= ALIGHT_SEC, etaSec: d.etaSec, by: 'plate' }; // 目的站的下一班就是我這台
  const left = w.rideSec - (now - w.boardAt) / 1000; // 照上車時估的乘車時間，還剩多少
  // 沒有車牌（或車牌對不上）：時間到了就提醒；目的站下一班 ≤ 2 分且已經坐了一半以上也提醒
  if (left <= ALIGHT_SEC) return { due: true, etaSec: Math.max(0, Math.round(left)), by: 'time' };
  if (live && d.etaSec <= ALIGHT_SEC && (now - w.boardAt) / 1000 >= w.rideSec / 2) return { due: true, etaSec: d.etaSec, by: 'time' };
  return { due: false, etaSec: live ? d.etaSec : Math.round(left), by: null };
}

/** 每站大約幾秒（到站時間對不上時的估算） */
export const SEC_PER_STOP = 90;
/**
 * 上車時估乘車時間：目的站與上車站的到站時間差（同一台車時才準）；
 * 差太小（目的站的下一班其實是前一台）就用站數 × 90 秒。
 */
export function rideEstimate(stops, board, dest) {
  const bi = stops.findIndex((s) => s.stopName === board);
  const di = stops.findIndex((s) => s.stopName === dest);
  if (bi < 0 || di <= bi) return null;
  const bySeq = (di - bi) * SEC_PER_STOP;
  const b = stops[bi], d = stops[di];
  const diff = d.etaSec != null && b.etaSec != null ? d.etaSec - Math.max(0, b.etaSec) : null;
  return diff != null && diff >= bySeq / 2 ? diff : bySeq;
}

function save() { try { if (state.w) localStorage.setItem(KEY, JSON.stringify(state.w)); else localStorage.removeItem(KEY); } catch { /* 無痕 */ } }

/** 停止下車提醒（使用者取消、已提醒、逾時） */
export function stopAlight({ cancel = true } = {}) {
  clearInterval(state.poll);
  if (cancel && state.nativeAt) cancelNotify(NOTIFY_ID.alight);
  state.w = null; state.nativeAt = 0;
  save();
  signal('abang:alight-watch', null);
}

function fire(etaSec) {
  const w = state.w;
  if (!w) return;
  const text = alightText(w.dest, etaSec);
  const planned = state.nativeAt;
  stopAlight({ cancel: false });
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  if (hasNativeNotify()) {
    if (visible) { if (planned) cancelNotify(NOTIFY_ID.alight); } // 畫面上看得到：不重複
    else if (!planned || planned > Date.now() + 5000) scheduleNotify(NOTIFY_ID.alight, new Date(), TITLE, text);
  } else {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(TITLE, { body: text, icon: '/icons/icon.svg', tag: 'abang-alight' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  }
  try { globalThis.navigator?.vibrate?.([300, 120, 300]); } catch { /* 不支援 */ }
  signal('abang:alight', { text });
}

/** 查一次（每 20 秒；測試直接呼叫） */
export async function pollAlight(callTool, now = Date.now()) {
  const w = state.w;
  if (!w) return;
  if (now - w.boardAt > MAX_MS) { stopAlight(); return; }
  try {
    const r = await callTool('bus_route_eta', { city: w.city, routeName: w.routeName, ...(w.direction != null && { direction: w.direction }) });
    if (state.w !== w) return;
    const dir = (r?.data?.directions || []).find((x, i) => (x.direction ?? i) === w.direction) || r?.data?.directions?.[0];
    const res = alightDue(w, dir?.stops || [], now);
    w.last = { etaSec: res.etaSec, at: now };
    signal('abang:alight-watch', w);
    if (res.due) { fire(res.etaSec); return; }
    // App：通知排到預估「到站前 2 分」（關著也會響）；差不到 20 秒不重排
    if (hasNativeNotify() && res.etaSec != null) {
      const at = now + Math.max(0, res.etaSec - ALIGHT_SEC) * 1000;
      if (Math.abs(at - state.nativeAt) > 20_000 && (await scheduleNotify(NOTIFY_ID.alight, new Date(at - EARLY_MS), TITLE, alightText(w.dest, ALIGHT_SEC)))) state.nativeAt = at;
    }
  } catch { /* 暫時查不到：下次再試 */ }
}

/**
 * 開始下車提醒（同時只有一個）。
 * @param {{ city: string, routeName: string, direction?: number, board: string, dest: string, plate?: string|null, rideSec: number }} w
 */
export async function watchAlight(w, callTool) {
  if (hasNativeNotify()) await ensureNotifyPermission();
  else if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  stopAlight();
  state.w = { ...w, boardAt: w.boardAt ?? Date.now() };
  save();
  signal('abang:alight-watch', state.w);
  await pollAlight(callTool);
  if (state.w) state.poll = setInterval(() => pollAlight(callTool), POLL_MS);
  return true;
}

/** 目前的下車提醒（沒有回 null） */
export const alightWatch = () => state.w;

/** App 被關掉再打開：還沒逾時就恢復 */
export function resumeAlight(callTool) {
  if (state.w) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.dest && Date.now() - saved.boardAt < MAX_MS) watchAlight(saved, callTool);
    else if (saved) { localStorage.removeItem(KEY); cancelNotify(NOTIFY_ID.alight); }
  } catch { /* 無痕 */ }
}
