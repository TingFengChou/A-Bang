import { icons } from './icons.js';

/** HTML 跳脫 */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const loading = (msg = '載入中…') => `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
export const errorBox = (e) => `<div class="error">${esc(e?.message || e)}</div>`;
export const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

export function etaBadge({ etaSec, status, statusText }) {
  let cls = 'off';
  if (status === 0 && etaSec != null) cls = etaSec < 180 ? 'soon' : etaSec < 600 ? 'mid' : '';
  return `<span class="eta ${cls}">${esc(statusText)}</span>`;
}

export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
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
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(FALLBACK);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve((lastPos = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), label: '目前位置' })),
      () => resolve(FALLBACK),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}
