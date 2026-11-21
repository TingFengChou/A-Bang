// 進行中列（行程中模式，2026-11-21）：有到站提醒或下車提醒時，每一頁上方都有一條「回到公車頁」的列。
// 坐車中（下車提醒）優先：「307 坐車中・約 6 分到「市府」」；等車中（到站提醒）：「307 到「和平體育館」・到站前 3 分提醒你」。
// 已經在那條路線的公車頁就不顯示（頁面本身就是行程中畫面）。不是即時區域：每 20 秒的更新不打斷讀屏。
import { alightWatch, rideLeftText } from './alight.js';
import { currentArrivalWatch } from '../ui/cards/host-web.js';
import { esc } from './ui.js';

const busHref = (city, route, stop, dir) => `#/bus/${encodeURIComponent(city)}/${encodeURIComponent(route)}?${new URLSearchParams({ ...(stop && { stop }), ...(dir != null && { dir: String(dir) }) })}`;

/**
 * 要顯示什麼（純函式，測試用）。
 * @returns {{ kind: 'riding'|'waiting', href: string, text: string, route: string, city: string, stop: string, direction?: number }|null}
 */
export function tripOf({ alight = null, arrival = null, now = Date.now() } = {}) {
  if (alight) return { kind: 'riding', city: alight.city, route: alight.routeName, stop: alight.board, direction: alight.direction, href: busHref(alight.city, alight.routeName, alight.board, alight.direction), text: `${alight.routeName} 坐車中・${rideLeftText(alight, now)}` };
  if (arrival) {
    // 「在 X 上車」（不是目的地）；查到過到站時間就說還有幾分（扣掉經過的時間）
    const left = arrival.last?.etaSec != null ? Math.round((arrival.last.etaSec - (now - arrival.last.at) / 1000) / 60) : null;
    const when = left != null && !arrival.skip ? (left <= 1 ? '車快到了' : `約 ${left} 分到站`) : `到站前 ${arrival.minutes} 分提醒你`;
    return { kind: 'waiting', city: arrival.city, route: arrival.routeName, stop: arrival.stop, direction: arrival.direction, href: busHref(arrival.city, arrival.routeName, arrival.stop, arrival.direction), text: `${arrival.routeName} 在「${arrival.stop}」上車・${when}` };
  }
  return null;
}

/** 已經在這條路線、這個上車站與方向的公車頁（頁面本身就是行程中畫面）；同路線別站或別方向仍顯示 */
export function onBusPage(t, hash) {
  const [path, qs = ''] = hash.split('?');
  if (path !== `#/bus/${encodeURIComponent(t.city)}/${encodeURIComponent(t.route)}` && path !== `#/bus/${t.city}/${t.route}`) return false;
  const q = new URLSearchParams(qs);
  return q.get('stop') === t.stop && (t.direction == null || q.get('dir') == null || Number(q.get('dir')) === t.direction);
}

/** 掛在外殼上（app.js）：提醒開始、更新、結束與換頁時重畫 */
export function mountTripBar(el) {
  const paint = () => {
    const t = tripOf({ alight: alightWatch(), arrival: currentArrivalWatch() });
    if (!t || onBusPage(t, location.hash)) { el.hidden = true; el.replaceChildren(); return; }
    el.hidden = false;
    el.className = `trip-bar ${t.kind}`;
    el.innerHTML = `<a href="${esc(t.href)}"><span class="dot" aria-hidden="true"></span><span class="t">${esc(t.text)}</span><span class="go">${t.kind === 'riding' ? '看行程' : '看公車'}<span aria-hidden="true"> ›</span></span></a>`;
  };
  for (const ev of ['abang:alight-watch', 'abang:arrival-watch', 'hashchange']) window.addEventListener(ev, paint);
  // 剩幾分會隨時間變：查詢失敗（隧道、離線）或從背景回來時也要更新
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paint(); });
  setInterval(() => { if (!el.hidden && document.visibilityState === 'visible') paint(); }, 30_000);
  paint();
  return paint;
}
