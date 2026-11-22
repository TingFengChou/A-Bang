// 下車提醒（2026-11-21，PLAN「行程中模式、下車提醒」）：上車後選要在哪一站下車，快到時提醒「準備下車」。
// 「我這台」怎麼找、何時該提醒是純邏輯，在 core/alight.js（2026-11-23 搬過去：Android 常駐服務透過伺服器用同一份）。
// Android App（有 AbangWatch 外掛）：開常駐服務 AbangAlightService，通知列常駐「307 坐車中・約 6 分到「市府」・快到時提醒你下車」，
// App 關著也每 20 秒更新、到點響鈴；畫面開著時這裡照樣每 20 秒查（畫面上的剩餘時間），不再預排本機通知。
// 其他手機 App（iOS）：設定當下就把通知排到預估時間（App 關著、網路斷也會響），每次更新再改。最多 3 小時。
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID, EARLY_MS } from './native-notify.js';
import { hasWatchService, startAlightService, stopAlightService, alightServiceStatus } from './native-watch.js';
import { ALIGHT_SEC, ALIGHT_MAX_MS, alightDue, alightText } from '../../core/alight.js';

export { ALIGHT_SEC, SEC_PER_STOP, alightText, busToDest, alightDue, rideEstimate } from '../../core/alight.js';

const POLL_MS = 20_000;
const MAX_MS = ALIGHT_MAX_MS;
const TITLE = '阿幫：準備下車';
const TITLE_EN = 'Abang: get off soon';
const titleOf = (w) => (w?.lang === 'en' ? TITLE_EN : TITLE);
const KEY = 'abang.alightWatch';
const state = { w: null, poll: null };
const signal = (type, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };

function save() { try { if (state.w) localStorage.setItem(KEY, JSON.stringify(state.w)); else localStorage.removeItem(KEY); } catch { /* 無痕 */ } }

/** App：通知排到「到站前 2 分」（差不到 20 秒不重排）；排不了記下來（畫面說 App 關著不會提醒） */
async function planNative(w, etaSec, now = Date.now()) {
  if (!hasNativeNotify() || etaSec == null || w.service) return; // 常駐服務在跑：由它準時提醒
  const at = now + Math.max(0, etaSec - ALIGHT_SEC) * 1000;
  if (w.nativeAt && Math.abs(at - w.nativeAt) < 20_000) return;
  const done = await scheduleNotify(NOTIFY_ID.alight, new Date(at - EARLY_MS), titleOf(w), alightText(w.dest, ALIGHT_SEC, w.lang));
  if (state.w !== w) return;
  w.nativeAt = done ? at : 0;
  w.nativeFailed = !done;
  save();
}

/** 停止下車提醒（使用者取消、已提醒、逾時） */
export function stopAlight({ cancel = true } = {}) {
  clearInterval(state.poll);
  if (state.w?.service) stopAlightService(); // Android 常駐服務一起停（App 內提醒過、取消、逾時）
  if (cancel && state.w?.nativeAt) cancelNotify(NOTIFY_ID.alight);
  state.w = null;
  save();
  signal('abang:alight-watch', null);
}

function fire(etaSec) {
  const w = state.w;
  if (!w) return;
  const text = alightText(w.dest, etaSec, w.lang);
  const planned = w.nativeAt;
  stopAlight({ cancel: false }); // 常駐服務也停了：背景時下面改由這裡馬上送
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  if (hasNativeNotify()) {
    if (visible) { if (planned) cancelNotify(NOTIFY_ID.alight); } // 畫面上看得到：不重複
    else if (!planned || planned > Date.now() + 5000) scheduleNotify(NOTIFY_ID.alight, new Date(), titleOf(w), text);
  } else {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(titleOf(w), { body: text, icon: '/icons/icon.svg', tag: 'abang-alight' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  }
  try { globalThis.navigator?.vibrate?.([300, 120, 300]); } catch { /* 不支援 */ }
  signal('abang:alight', { text });
}

/** 查一次（每 20 秒；測試直接呼叫） */
export async function pollAlight(callTool, now = Date.now()) {
  const w = state.w;
  if (!w) return;
  if (now - w.boardAt > MAX_MS) { stopAlight(); return; }
  if (w.service === true) { // 'pending'：還沒開（第一次查）
    const st = await alightServiceStatus();
    if (state.w !== w) return;
    if (st && !st.active) {
      if (st.firedAt || st.endedAt) { stopAlight({ cancel: false }); return; } // 服務已經響過、或使用者在通知按了「停止」：畫面跟著結束
      w.service = false; save(); // 被系統收掉：改回預排本機通知（下面照樣排）
    }
  }
  try {
    const r = await callTool('bus_route_eta', { city: w.city, routeName: w.routeName, ...(w.direction != null && { direction: w.direction }) });
    if (state.w !== w) return;
    const dirs = r?.data?.directions || [];
    const dir = dirs.find((x) => x.direction === w.direction) || (w.direction == null ? dirs[0] : null);
    if (!dir) return; // 方向對不上：不猜（下次再試）
    const res = alightDue(w, dir.stops || [], now);
    w.last = { etaSec: res.etaSec, at: now };
    save();
    signal('abang:alight-watch', w);
    if (res.due) { fire(res.etaSec); return; }
    await planNative(w, res.etaSec, now);
  } catch { /* 暫時查不到：下次再試（排好的通知照舊） */ }
}

/**
 * 開始下車提醒（同時只有一個）。
 * @param {{ city: string, routeName: string, direction?: number, board: string, boardSeq?: number, dest: string, destSeq?: number, plate?: string|null, rideSec: number, boardAt?: number, lang?: 'en' }} w  lang：英文公車頁設的（通知用英文）
 * @returns {Promise<boolean>} 是否還在提醒（目的站太近，設定當下就提醒並結束時回 false）
 */
export async function watchAlight(w, callTool, { resumed = false } = {}) {
  if (!resumed) signal('abang:choice', { role: 'bus' }); // 設下車提醒＝選了公車（habits.js 記常選的方式；只記方式）
  const granted = hasNativeNotify() ? await ensureNotifyPermission() : true;
  if (!hasNativeNotify() && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  stopAlight();
  const now = Date.now();
  const { service: _s, nativeAt: _n, nativeFailed: _f, ...rest } = w;
  const cur = state.w = { ...rest, boardAt: w.boardAt ?? now, service: granted && hasWatchService() && 'pending' }; // 有外掛：第一次查完還在提醒才真的開（太近當下就提醒時不多開一個）；沒有通知權限不開（畫面照實說 App 關著不會提醒）
  save();
  signal('abang:alight-watch', cur);
  if (!cur.service) await planNative(cur, w.rideSec - Math.max(0, (now - cur.boardAt) / 1000) + Math.max(0, (cur.boardAt - now) / 1000), now); // 先排好（第一次查失敗也會響）
  await pollAlight(callTool);
  if (state.w !== cur) return false;
  if (cur.service) {
    cur.service = await startAlightService({ ...cur, until: cur.boardAt + MAX_MS }); // Android：通知列常駐、App 關著也每 20 秒問伺服器
    if (state.w !== cur) { if (cur.service) stopAlightService(); return false; }
    save();
    if (!cur.service) await planNative(cur, rideLeftSec(cur), Date.now()); // 開不了（舊版 App）：照原本方式預排
  }
  state.poll = setInterval(() => pollAlight(callTool), POLL_MS);
  return true;
}

/**
 * 到下車站還要幾秒（行程中模式）：最近一次查到的時間扣掉經過的時間；還沒查到用設定時的估計。
 * @returns {number|null}
 */
export function rideLeftSec(w, now = Date.now()) {
  if (!w) return null;
  if (w.last?.etaSec != null) return Math.max(0, Math.round(w.last.etaSec - (now - w.last.at) / 1000));
  if (Number.isFinite(w.rideSec)) return Math.max(0, Math.round(w.rideSec - Math.max(0, now - w.boardAt) / 1000 + Math.max(0, w.boardAt - now) / 1000));
  return null;
}
/** 「約 6 分到「市府」」／「快到「市府」了」 */
export const rideLeftText = (w, now = Date.now()) => { const s = rideLeftSec(w, now); return s == null ? `往「${w.dest}」` : s < 60 ? `快到「${w.dest}」了` : `約 ${Math.round(s / 60)} 分到「${w.dest}」`; };

/** 目前的下車提醒（沒有回 null） */
export const alightWatch = () => state.w;
/** 還沒上車（車正要進上車站，設定時已算好上車時間） */
export const notBoarded = (w, now = Date.now()) => !!w && now < w.boardAt;

/** App 被關掉再打開：通知已經響過或逾時就清掉；常駐服務還在跑就接著看（不重開）；否則恢復 */
export async function resumeAlight(callTool, now = Date.now()) {
  if (state.w) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return; } // 無痕
  if (!saved) return;
  const clear = () => { try { localStorage.removeItem(KEY); } catch { /* 無痕 */ } cancelNotify(NOTIFY_ID.alight); };
  const fired = saved.nativeAt && saved.nativeAt < now; // App 在背景時已經響過（JS 被暫停，沒能清掉）
  if (fired || !saved.dest || now - saved.boardAt >= MAX_MS) { clear(); return; }
  if (saved.service === true) {
    const st = await alightServiceStatus();
    if (state.w) return;
    if (st?.active) { // 服務一直在跑：畫面接著看，不重開（通知列不會閃）
      state.w = saved;
      signal('abang:alight-watch', saved);
      await pollAlight(callTool);
      if (state.w === saved) state.poll = setInterval(() => pollAlight(callTool), POLL_MS);
      return;
    }
    if (st && (st.firedAt || st.endedAt)) { clear(); return; } // 響過了、或在通知按了「停止」
  }
  await watchAlight(saved, callTool, { resumed: true }).catch(() => {});
}
