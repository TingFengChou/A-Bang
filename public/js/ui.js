import { icons } from './icons.js';
import { browserLocation } from './agent/client.js';

/** HTML 跳脫 */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const loading = (msg = '載入中…') => `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
const NET_ERR = /^(TypeError|AbortError|TimeoutError)$/;
export const errorBox = (e) => `<div class="error">${esc(NET_ERR.test(e?.name) ? '目前連不上網路，連上後再試一次' : e?.message || e)}</div>`;
export const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

export function etaBadge({ etaSec, status, statusText }) {
  let cls = 'off';
  if (status === 0 && etaSec != null) cls = etaSec < 180 ? 'soon' : etaSec < 600 ? 'mid' : '';
  return `<span class="eta ${cls}">${esc(statusText)}</span>`;
}

export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
/** 存下資料的時間：今天 14:05／昨天 14:05／11/20 14:05 */
export function savedWhen(at, now = Date.now()) {
  const d = new Date(at);
  const hm = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (x) => new Date(x).toDateString();
  return day(at) === day(now) ? hm : day(at) === day(now - 864e5) ? `昨天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
/** 舊資料的頁尾說明 */
export const staleNote = (at) => `離線：這是 ${savedWhen(at)} 存下的資料，連上網路後自動更新`;
export const fmtTime = (d = new Date()) => d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const chev = icons.chev.replace('<svg', '<svg class="chev"');

// ───── 收藏（localStorage，失敗時退回記憶體）─────
const mem = {};
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
/** 本機儲存（給其他模組用，例如「我的發票」） */
export const storage = ls;
export const favs = {
  list: () => ls.get('favs') || [],
  has: (id) => favs.list().some((f) => f.id === id),
  toggle(item) {
    const l = favs.list();
    const i = l.findIndex((f) => f.id === item.id);
    i >= 0 ? l.splice(i, 1) : l.unshift(item);
    ls.set('favs', l.slice(0, 30));
    return i < 0;
  },
};
export const prefs = { get: (k, d) => ls.get(`pref:${k}`) ?? d, set: (k, v) => ls.set(`pref:${k}`, v) };

// ───── 定位：失敗時用台北車站，並告知使用者 ─────
export const FALLBACK = { lat: 25.0478, lon: 121.517, label: '台北車站（預設位置）' };
let lastPos = null;
export function locate({ fresh = false } = {}) {
  if (lastPos && !fresh) return Promise.resolve(lastPos);
  // 與問阿幫共用同一個定位（App 走原生外掛，iOS 只問一次權限；2 分鐘內重用）
  // 附近站牌、YouBike 在 400 公尺內：要精確位置（Android 12+ 不設 highAccuracy 只會拿到大概位置）
  return browserLocation(8000, { highAccuracy: true, fresh }).then((p) => (p ? (lastPos = { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), label: '目前位置' }) : FALLBACK));
}
