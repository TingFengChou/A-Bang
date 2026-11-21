// 下車提醒（2026-11-21，PLAN「行程中模式、下車提醒」）：上車後選要在哪一站下車，快到時提醒「準備下車」。
// 找「我這台」：每站的到站時間是「下一班」的。沿著站序看，從上車站往後第一個「到站時間變小」的站，就是剛離開上車站那台車的前方
// （上車站之後到那一站之前，下一班都是更後面的車）。目的站在那台車前方、而且中間沒有別台車（沒有再變小）＝目的站的下一班就是我這台。
// 站一律用站序（環狀路線有同名的站）。手機 App：設定當下就把通知排到預估時間（App 關著、網路斷也會響），每次更新再改。最多 3 小時。
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID, EARLY_MS } from './native-notify.js';

export const ALIGHT_SEC = 120;
export const SEC_PER_STOP = 90;
const POLL_MS = 20_000;
const MAX_MS = 3 * 3600e3;
const TITLE = '阿幫：準備下車';
const TITLE_EN = 'Abang: get off soon';
const titleOf = (w) => (w?.lang === 'en' ? TITLE_EN : TITLE);
const KEY = 'abang.alightWatch';
const state = { w: null, poll: null };
const signal = (type, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };
const ok = (s) => s && s.status === 0 && s.etaSec != null;

/** 「約 2 分後到「市府」，準備下車」／「快到「市府」了，準備下車！」；lang＝'en'（英文公車頁設的，S12g）用英文 */
export const alightText = (dest, sec, lang = null) => {
  const near = sec != null && sec < 60, n = Math.max(1, Math.round((sec ?? ALIGHT_SEC) / 60));
  if (lang === 'en') return near ? `Almost at ${dest}. Get ready to get off!` : `About ${n} min to ${dest}. Get ready to get off.`;
  return near ? `快到「${dest}」了，準備下車！` : `約 ${n} 分後到「${dest}」，準備下車`;
};

/** 用站序找站（沒有站序時才用站名） */
const indexOf = (stops, seq, name) => { const i = seq != null ? stops.findIndex((s) => s.seq === seq) : -1; return i >= 0 ? i : stops.findIndex((s) => s.stopName === name); };

/**
 * 我這台車到目的站還要多久（從到站時間的順序推）。
 * @returns {{ etaSec: number|null, where: 'ahead'|'passed'|'unknown' }}
 *   ahead：目的站的下一班就是我這台（etaSec 有值）；passed：我這台已經過了目的站；unknown：看不出來（資料不全、中間有別台車）
 */
export function busToDest(stops, bi, di) {
  if (bi < 0 || di <= bi) return { etaSec: null, where: 'unknown' };
  let j = -1;
  for (let k = bi + 1; k < stops.length; k++) if (ok(stops[k]) && ok(stops[k - 1]) && stops[k].etaSec < stops[k - 1].etaSec) { j = k; break; }
  if (j < 0) return { etaSec: null, where: 'unknown' };
  if (j > di) return { etaSec: null, where: 'passed' };
  for (let k = j + 1; k <= di; k++) if (ok(stops[k]) && ok(stops[k - 1]) && stops[k].etaSec < stops[k - 1].etaSec) return { etaSec: null, where: 'unknown' }; // 中間還有別台：目的站的下一班不是我
  return ok(stops[di]) ? { etaSec: stops[di].etaSec, where: 'ahead' } : { etaSec: null, where: 'unknown' };
}

/**
 * 該提醒下車了嗎（純函式）。
 * @param {{ boardSeq?: number, destSeq?: number, board: string, dest: string, plate?: string|null, boardAt: number, rideSec: number, seen?: boolean }} w  seen：看過我這台在前往目的站的路上（會被更新）
 * @returns {{ due: boolean, etaSec: number|null, by: 'bus'|'plate'|'passed'|'time'|null }}
 */
export function alightDue(w, stops, now = Date.now()) {
  const bi = indexOf(stops, w.boardSeq, w.board);
  const di = indexOf(stops, w.destSeq, w.dest);
  const d = stops[di];
  if (w.plate && ok(d) && d.plate === w.plate) return { due: d.etaSec <= ALIGHT_SEC, etaSec: d.etaSec, by: 'plate' };
  if (now < w.boardAt) { // 還沒上車（車正要進上車站）：上車站之後第一台是前一班，不能當我這台；照設定時的估計
    const left = w.rideSec + (w.boardAt - now) / 1000;
    return { due: left <= ALIGHT_SEC, etaSec: Math.round(left), by: left <= ALIGHT_SEC ? 'time' : null };
  }
  const pos = busToDest(stops, bi, di);
  if (pos.where === 'ahead') { w.seen = true; return { due: pos.etaSec <= ALIGHT_SEC, etaSec: pos.etaSec, by: 'bus' }; }
  if (pos.where === 'passed' && w.seen) return { due: true, etaSec: 0, by: 'passed' }; // 看過在路上、現在已經過了目的站：馬上提醒
  const left = w.rideSec - (now - w.boardAt) / 1000; // 看不出來：照設定時估的
  return left <= ALIGHT_SEC ? { due: true, etaSec: Math.max(0, Math.round(left)), by: 'time' } : { due: false, etaSec: Math.round(left), by: null };
}

/**
 * 設定時估「現在起」還要多久到目的站。
 * 公車正要進上車站（≤ 90 秒）：還沒上車，等這台；否則照到站時間的順序找我這台；都看不出來用站數 × 90 秒。
 * @returns {{ rideSec: number, boardAt: number, plate: string|null }|null}
 */
export function rideEstimate(stops, boardSeq, destSeq, now = Date.now()) {
  const bi = indexOf(stops, boardSeq);
  const di = indexOf(stops, destSeq);
  if (bi < 0 || di <= bi) return null;
  const b = stops[bi];
  if (ok(b) && b.etaSec <= 90) { // 車正要進站：上這台
    const d = stops[di];
    const ride = ok(d) && d.etaSec > b.etaSec ? d.etaSec - b.etaSec : (di - bi) * SEC_PER_STOP;
    return { rideSec: ride, boardAt: now + b.etaSec * 1000, plate: b.plate || null };
  }
  const pos = busToDest(stops, bi, di);
  if (pos.where === 'ahead') return { rideSec: pos.etaSec, boardAt: now, plate: stops[di].plate || null };
  return { rideSec: (di - bi) * SEC_PER_STOP, boardAt: now, plate: null };
}

function save() { try { if (state.w) localStorage.setItem(KEY, JSON.stringify(state.w)); else localStorage.removeItem(KEY); } catch { /* 無痕 */ } }

/** App：通知排到「到站前 2 分」（差不到 20 秒不重排）；排不了記下來（畫面說 App 關著不會提醒） */
async function planNative(w, etaSec, now = Date.now()) {
  if (!hasNativeNotify() || etaSec == null) return;
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
  stopAlight({ cancel: false });
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
export async function watchAlight(w, callTool) {
  if (hasNativeNotify()) await ensureNotifyPermission();
  else if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  stopAlight();
  const now = Date.now();
  state.w = { ...w, boardAt: w.boardAt ?? now };
  save();
  signal('abang:alight-watch', state.w);
  await planNative(state.w, w.rideSec - Math.max(0, (now - state.w.boardAt) / 1000) + Math.max(0, (state.w.boardAt - now) / 1000), now); // 先排好（第一次查失敗也會響）
  await pollAlight(callTool);
  if (state.w) state.poll = setInterval(() => pollAlight(callTool), POLL_MS);
  return Boolean(state.w);
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

/** App 被關掉再打開：通知已經響過或逾時就清掉；否則恢復 */
export function resumeAlight(callTool, now = Date.now()) {
  if (state.w) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved) return;
    const fired = saved.nativeAt && saved.nativeAt < now; // App 在背景時已經響過（JS 被暫停，沒能清掉）
    if (fired || !saved.dest || now - saved.boardAt >= MAX_MS) { localStorage.removeItem(KEY); cancelNotify(NOTIFY_ID.alight); return; }
    watchAlight(saved, callTool);
  } catch { /* 無痕 */ }
}
