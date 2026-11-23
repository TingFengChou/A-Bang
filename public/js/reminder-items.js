// 提醒頁（#/reminders）與分頁列小數字共用：把三種進行中的提醒整理成同一種清單（純函式，node:test 可測）。
//   到站提醒（ui/cards/host-web.js currentArrivalWatch）、下車提醒（alight.js alightWatch）、出門提醒（reminders.js listReminders）
// 不碰 DOM、不讀手機儲存：呼叫端把現況傳進來。

// 一律用台灣時間（提醒本身是照台灣時間排的；手機設成別的時區時清單不能差好幾小時，前端審查 #5）
const TW = 8 * 3600e3;
const hm = (ms) => { const d = new Date(ms + TW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const twDay = (ms) => new Date(ms + TW).toISOString().slice(0, 10);
/** 一筆提醒的識別（提醒頁「看當時的對話」用，chat-links.js）：到站、下車看路線＋站，出門看提醒 id */
export const reminderRef = ({ kind, id, routeName, stop }) => (kind === 'leave' ? `leave|${id}` : `${kind}|${routeName}|${stop}`);
const busHref = (city, route, stop, dir, lang) => `#/bus/${encodeURIComponent(city)}/${encodeURIComponent(route)}?${new URLSearchParams({ ...(stop && { stop }), ...(dir != null && { dir: String(dir) }), ...(lang === 'en' && { lang }) })}`;

/**
 * @param {{ arrival?: object|null, alight?: object|null, leave?: Array<{ id: string, at: number, text: string }>, now?: number }} o
 * @returns {Array<{ kind: 'alight'|'arrival'|'leave', id: string, ref: string, title: string, sub: string, href?: string, cancelLabel: string }>}
 *   順序：坐車中（下車）→ 等車中（到站）→ 出門提醒（依時間）
 */
export function reminderItems({ arrival = null, alight = null, leave = [], now = Date.now() } = {}) {
  const out = [];
  if (alight?.routeName && alight.dest) {
    out.push({ kind: 'alight', id: 'alight', ref: reminderRef({ kind: 'alight', routeName: alight.routeName, stop: alight.dest }), title: `${alight.routeName} 下車提醒`, sub: `快到「${alight.dest}」前約 2 分提醒你${alight.board ? `・從「${alight.board}」上車` : ''}`,
      href: alight.city ? busHref(alight.city, alight.routeName, alight.board, alight.direction, alight.lang) : undefined, cancelLabel: `取消 ${alight.routeName} 的下車提醒` });
  }
  if (arrival?.routeName && arrival.stop) {
    out.push({ kind: 'arrival', id: 'arrival', ref: reminderRef({ kind: 'arrival', routeName: arrival.routeName, stop: arrival.stop }), title: `${arrival.routeName} 到站提醒`, sub: `公車到「${arrival.stop}」前 ${arrival.minutes} 分提醒你`,
      href: arrival.city ? busHref(arrival.city, arrival.routeName, arrival.stop, arrival.direction, arrival.lang) : undefined, cancelLabel: `取消 ${arrival.routeName} 的到站提醒` });
  }
  for (const r of [...(leave || [])].filter((x) => x && x.at > now).sort((a, b) => a.at - b.at)) {
    const day = twDay(r.at) === twDay(now) ? '今天' : '明天';
    out.push({ kind: 'leave', id: r.id, ref: reminderRef({ kind: 'leave', id: r.id }), title: `${day} ${hm(r.at)} 出門提醒`, sub: String(r.text || '').replace(/^該出門了：/, ''), cancelLabel: `取消 ${hm(r.at)} 的出門提醒` });
  }
  return out;
}
