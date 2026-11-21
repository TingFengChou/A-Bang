// 提醒 ↔ 當時的對話（UX.md §4.17）：在問阿幫設的到站、下車、出門提醒，提醒頁那一筆加「看當時的對話」。
// 只在記憶體（這次開著的 App／分頁）：對話保留期間有效；重開 App 後對話不在了，連結就不顯示（chatTurnFor 回 null）。
// 只連「真的在那一輪操作過」的（10 分鐘內點過那一輪）；提醒取消或響完就拿掉。
import { reminderRef } from '../reminder-items.js';
import { listReminders } from '../reminders.js';

const links = new Map(); // reminderRef → 第幾輪
let rounds = null; // collapse.js（問阿幫頁註冊；只有一個保留的生活對話）

/** 這筆提醒是第幾輪對話設的（對話還在才回）；沒有回 null */
export function chatTurnFor(ref) {
  const n = links.get(ref);
  return n && rounds?.has(n) ? n : null;
}

export const RECENT_MS = 10 * 60e3; // 從對話點去公車頁設下車提醒：10 分鐘內算同一件事

/**
 * 提醒變了：拿掉已經不在的（取消、響完）。純函式（node:test）。
 * @param {Map<string, number>} map
 * @param {'arrival'|'alight'|'leave'} kind
 * @param {string[]} live 這一類現在還在的 ref
 */
export function pruneLinks(map, kind, live) {
  const keep = new Set(live);
  for (const ref of [...map.keys()]) if (ref.startsWith(`${kind}|`) && !keep.has(ref)) map.delete(ref);
}

// 事件只掛一次（模組層級）：到站、下車提醒的事件帶現況（null＝取消）；出門提醒看清單
// 到站提醒：設定時先停掉舊的（事件 null）再送新的，所以等新的事件到了才連（pendingArrival）
let pendingArrival = null;
const onArrival = (e) => {
  const w = e.detail;
  const ref = w?.routeName ? reminderRef({ kind: 'arrival', routeName: w.routeName, stop: w.stop }) : null;
  pruneLinks(links, 'arrival', ref ? [ref] : []);
  if (ref && pendingArrival?.ref === ref) { links.set(ref, pendingArrival.n); pendingArrival = null; }
};
const onLeave = () => pruneLinks(links, 'leave', listReminders().map((r) => reminderRef({ kind: 'leave', id: r.id })));
// 下車提醒在公車頁設（從對話的「上車後提醒我下車」過去）：10 分鐘內碰過、而且那一輪查過這條公車才連
const onAlight = (e) => {
  const w = e.detail;
  const ref = w?.routeName && w.dest ? reminderRef({ kind: 'alight', routeName: w.routeName, stop: w.dest }) : null;
  pruneLinks(links, 'alight', ref ? [ref] : []);
  if (!ref || links.has(ref)) return;
  const m = rounds?.recent(RECENT_MS);
  const rode = m?.view?.results?.some((r) => (r.tool === 'bus_route_eta' && r.data?.routeName === w.routeName) || (r.tool === 'plan_trip' && r.data?.options?.some((o) => o.role === 'bus' && String(o.name).includes(w.routeName))));
  if (rode) links.set(ref, m.n);
};
let wired = false;

/**
 * 問阿幫頁掛上：包住 host 的出門提醒與到站提醒（記下是哪一輪設的）。
 * @param {object} host createWebHost() 的結果（會換掉 remind、watchArrival）
 * @param {{ recent: (ms: number) => ({ n: number, view: any }|null), has: (n: number) => boolean }} r collapse.js
 * @returns {() => void} 清掉（清除本機資料時）
 */
export function linkReminders(host, r) {
  rounds = r;
  const remind = host.remind;
  host.remind = async (...a) => {
    const m = r.recent(RECENT_MS);
    const id = await remind.apply(host, a);
    if (id && m) links.set(reminderRef({ kind: 'leave', id }), m.n);
    return id;
  };
  const watch = host.watchArrival;
  host.watchArrival = (w) => {
    const m = r.recent(RECENT_MS);
    pendingArrival = m && w?.routeName ? { ref: reminderRef({ kind: 'arrival', routeName: w.routeName, stop: w.stop }), n: m.n } : null;
    return watch.call(host, w);
  };
  if (!wired && typeof globalThis.addEventListener === 'function') {
    wired = true;
    addEventListener('abang:arrival-watch', onArrival);
    addEventListener('abang:alight-watch', onAlight);
    addEventListener('abang:reminders', onLeave);
  }
  return () => { links.clear(); pendingArrival = null; };
}
