// 提醒 ↔ 當時的對話（UX.md §4.17）：在問阿幫設的到站、下車、出門提醒，提醒頁那一筆加「看當時的對話」。
// 只在記憶體（這次開著的 App／分頁）：對話保留期間有效；重開 App 後對話不在了，連結就不顯示（chatTurnFor 回 null）。
import { reminderRef } from '../reminder-items.js';

const links = new Map(); // reminderRef → 第幾輪
let alive = null; // (n) => 那一輪還在畫面上嗎（問阿幫頁註冊）

/** 這筆提醒是第幾輪對話設的（對話還在才回）；沒有回 null */
export function chatTurnFor(ref) {
  const n = links.get(ref);
  return n && alive?.(n) ? n : null;
}

const RECENT_MS = 10 * 60e3; // 從對話點去公車頁設下車提醒：10 分鐘內算同一件事

/**
 * 問阿幫頁掛上：包住 host 的出門提醒與到站提醒（記下是哪一輪設的），並接下車提醒（在公車頁設的）。
 * @param {object} host createWebHost() 的結果（會換掉 remind、watchArrival）
 * @param {{ recent: (ms: number) => ({ n: number, view: any }|null), has: (n: number) => boolean }} rounds collapse.js
 * @returns {() => void} 清掉（清除本機資料時）
 */
export function linkReminders(host, rounds) {
  alive = rounds.has;
  const remind = host.remind;
  host.remind = async (...a) => {
    const m = rounds.recent(RECENT_MS);
    const id = await remind.apply(host, a);
    if (id && m) links.set(reminderRef({ kind: 'leave', id }), m.n);
    return id;
  };
  const watch = host.watchArrival;
  host.watchArrival = (w) => {
    const m = rounds.recent(RECENT_MS);
    if (m && w?.routeName) links.set(reminderRef({ kind: 'arrival', routeName: w.routeName, stop: w.stop }), m.n);
    return watch.call(host, w);
  };
  // 下車提醒在公車頁設（從對話的「上車後提醒我下車」過去）：那一輪查過這條公車才連
  const onAlight = (e) => {
    const w = e.detail;
    if (!w?.routeName || !w.dest) return;
    const ref = reminderRef({ kind: 'alight', routeName: w.routeName, stop: w.dest });
    if (links.has(ref)) return;
    const m = rounds.recent(RECENT_MS);
    const rode = m?.view?.results?.some((r) => (r.tool === 'bus_route_eta' && r.data?.routeName === w.routeName) || (r.tool === 'plan_trip' && r.data?.options?.some((o) => o.role === 'bus' && String(o.name).includes(w.routeName))));
    if (rode) links.set(ref, m.n);
  };
  addEventListener('abang:alight-watch', onAlight);
  return () => links.clear();
}
