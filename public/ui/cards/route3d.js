// 立體路線圖：把公車路線（真實路線形狀與站點座標）畫在一塊傾斜的地面上，你這站與公車是立起來的圖釘／代幣。
// 只用 CSS 3D（perspective＋rotateX），不引入 WebGL；路線依序畫出、公車代幣浮動。reduced motion／精簡模式：平面、不動畫。
import { token } from './mode-icons.js';

const W = 300, H = 190, PAD = 16;

/**
 * 經緯度 → 平面座標（等距投影、經度乘 cos(緯度)，保持比例、置中）。
 * @param {Array<[number, number]>} pts [[lat, lon]]
 * @returns {{ xy: (p: [number, number]) => [number, number] } | null}
 */
export function projector(pts, w = W, h = H, pad = PAD) {
  const ok = (pts || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ok.length < 2) return null;
  const lat0 = ok.reduce((n, p) => n + p[0], 0) / ok.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = ok.map((p) => p[1] * k), ys = ok.map((p) => -p[0]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((w - pad * 2) / (x1 - x0 || 1e-9), (h - pad * 2) / (y1 - y0 || 1e-9));
  const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  return { xy: ([lat, lon]) => [+(ox + (lon * k - x0) * s).toFixed(1), +(oy + (-lat - y0) * s).toFixed(1)] };
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };

/**
 * @param {{ stops: Array<{ seq: number, stopName: string, lat?: number, lon?: number, plate?: string|null }>, shape?: Array<[number, number]>, meSeq?: number|null, label: string, meText?: string }} o
 * @returns {HTMLElement | null} 站點沒有座標時回 null
 */
export function routeMap3d({ stops, shape, meSeq = null, label, meText = '你', seen = false }) {
  const pts = stops.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  const line = shape?.length > 1 ? shape : pts.map((s) => [s.lat, s.lon]);
  const pj = projector([...line, ...pts.map((s) => [s.lat, s.lon])]);
  if (!pj || pts.length < 2) return null;
  const box = document.createElement('div');
  box.className = seen ? 'ab-map3d seen' : 'ab-map3d'; // seen：刷新重畫時不再播進場
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  const plane = document.createElement('div');
  plane.className = 'ab-map3d-plane';
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${pj.xy(p).join(' ')}`).join('');
  s.append(svg('path', { d, class: 'ab-map3d-shadow' }), svg('path', { d, class: 'ab-map3d-line', pathLength: 1 }));
  for (const st of pts) { const [x, y] = pj.xy([st.lat, st.lon]); s.append(svg('circle', { cx: x, cy: y, r: st.seq === meSeq ? 5 : 3, class: st.seq === meSeq ? 'ab-map3d-stop me' : 'ab-map3d-stop' })); }
  plane.append(s);
  // 立起來的東西：你這站的圖釘、每台公車（站點有車牌的位置）
  const stand = (el, st, cls) => {
    const [x, y] = pj.xy([st.lat, st.lon]);
    const p = document.createElement('span');
    p.className = `ab-map3d-up ${cls}`;
    p.style.left = `${(x / W) * 100}%`; p.style.top = `${(y / H) * 100}%`;
    p.append(el);
    plane.append(p);
  };
  const me = pts.find((st) => st.seq === meSeq);
  if (me) { const pin = document.createElement('span'); pin.className = 'ab-map3d-pin'; pin.textContent = meText; stand(pin, me, 'me'); }
  pts.filter((st) => st.plate).forEach((st) => stand(token('bus', { size: 'xs', go: true }), st, 'bus'));
  box.append(plane);
  return box;
}
