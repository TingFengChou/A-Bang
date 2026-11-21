// 進行中列（行程中模式，2026-11-21）：有到站提醒或下車提醒時，每一頁上方都有一條「回到公車頁」的列。
// 坐車中（下車提醒）優先：「307 坐車中・約 6 分到「市府」」；等車中（到站提醒）：「307 到「和平體育館」・到站前 3 分提醒你」。
// 已經在那條路線的公車頁就不顯示（頁面本身就是行程中畫面）。不是即時區域：每 20 秒的更新不打斷讀屏。
import { alightWatch, rideLeftText } from './alight.js';
import { currentArrivalWatch } from '../ui/cards/host-web.js';
import { esc } from './ui.js';

const busHref = (city, route, stop, dir) => `#/bus/${encodeURIComponent(city)}/${encodeURIComponent(route)}?${new URLSearchParams({ ...(stop && { stop }), ...(dir != null && { dir: String(dir) }) })}`;

/**
 * 要顯示什麼（純函式，測試用）。
 * @returns {{ kind: 'riding'|'waiting', href: string, text: string, route: string, city: string }|null}
 */
export function tripOf({ alight = null, arrival = null, now = Date.now() } = {}) {
  if (alight) return { kind: 'riding', city: alight.city, route: alight.routeName, href: busHref(alight.city, alight.routeName, alight.board, alight.direction), text: `${alight.routeName} 坐車中・${rideLeftText(alight, now)}` };
  if (arrival) return { kind: 'waiting', city: arrival.city, route: arrival.routeName, href: busHref(arrival.city, arrival.routeName, arrival.stop, arrival.direction), text: `${arrival.routeName} 到「${arrival.stop}」・到站前 ${arrival.minutes} 分提醒你` };
  return null;
}

/** 已經在這條路線的公車頁 */
const onBusPage = (t, hash) => hash.split('?')[0] === `#/bus/${encodeURIComponent(t.city)}/${encodeURIComponent(t.route)}`
  || hash.split('?')[0] === `#/bus/${t.city}/${t.route}`;

/** 掛在外殼上（app.js）：提醒開始、更新、結束與換頁時重畫 */
export function mountTripBar(el) {
  const paint = () => {
    const t = tripOf({ alight: alightWatch(), arrival: currentArrivalWatch() });
    if (!t || onBusPage(t, location.hash)) { el.hidden = true; el.replaceChildren(); return; }
    el.hidden = false;
    el.className = `trip-bar ${t.kind}`;
    el.innerHTML = `<a href="${esc(t.href)}"><span class="dot" aria-hidden="true"></span><span class="t">${esc(t.text)}</span><span class="go">${t.kind === 'riding' ? '看行程' : '看公車'} ›</span></a>`;
  };
  for (const ev of ['abang:alight-watch', 'abang:arrival-watch', 'hashchange']) window.addEventListener(ev, paint);
  paint();
  return paint;
}
