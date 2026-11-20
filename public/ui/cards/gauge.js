// 空品半圓儀表與天氣氛圍：把數字變成一眼看得懂的畫面（資料仍是真實值，動畫只陪襯）。
// reduced motion、精簡模式不動：指針直接停在數值、數字不跳、雨不下。
const NS = 'http://www.w3.org/2000/svg';
// 環境部 AQI 六級；半圓每級等寬（30°），讓「普通」「不健康」等級一眼看得出，而不是被 300～500 擠掉
const BANDS = [[0, 50, '#16a34a'], [51, 100, '#eab308'], [101, 150, '#f97316'], [151, 200, '#dc2626'], [201, 300, '#7c3aed'], [301, 500, '#7f1d1d']];

/** AQI → 指針角度（0°＝最左、180°＝最右；每級 30°，級內線性） */
export function gaugeAngle(aqi) {
  if (aqi == null || !Number.isFinite(+aqi)) return 0;
  const v = Math.max(0, Math.min(500, +aqi));
  const i = BANDS.findIndex(([, hi]) => v <= hi);
  const [lo, hi] = BANDS[i];
  return Math.round((i * 30 + (Math.max(0, v - lo) / (hi - lo)) * 30) * 10) / 10;
}

/** 天氣 → 氛圍：rain（下雨）、cloud（降雨機率 ≥ 50%）、night（18～6 點）、sun */
export function sceneOf(d) {
  if (d?.raining) return 'rain';
  if ((d?.pop3h ?? 0) >= 50) return 'cloud';
  const at = d?.observedAt ? new Date(d.observedAt) : null;
  const hr = at && !Number.isNaN(at.getTime()) ? Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Taipei' }).format(at)) : 12;
  return hr >= 18 || hr < 6 ? 'night' : 'sun';
}

const still = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || document.documentElement.classList.contains('lite-motion');
const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
const C = { x: 60, y: 62, r: 46 };
const pt = (deg, r = C.r) => { const a = (deg * Math.PI) / 180; return [C.x - r * Math.cos(a), C.y - r * Math.sin(a)]; };

/** 半圓儀表（SVG）：六色弧＋指針從 0 轉到數值＋數字跳上去 */
export function aqiGauge(aqi, label) {
  const box = document.createElement('span');
  box.className = 'ab-gauge';
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  const s = svg('svg', { viewBox: '0 0 120 70', width: 120, height: 70, 'aria-hidden': 'true' });
  BANDS.forEach((_, i) => {
    const [x1, y1] = pt(i * 30 + 1.5), [x2, y2] = pt(i * 30 + 28.5);
    s.append(svg('path', { d: `M${x1.toFixed(1)} ${y1.toFixed(1)} A${C.r} ${C.r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`, stroke: BANDS[i][2], 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round', class: 'ab-gauge-band', style: `--i:${i}` }));
  });
  const deg = gaugeAngle(aqi);
  const needle = svg('g', { class: 'ab-gauge-needle' });
  needle.append(svg('line', { x1: C.x, y1: C.y, x2: C.x - 34, y2: C.y, stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round' }), svg('circle', { cx: C.x, cy: C.y, r: 5, fill: 'currentColor' }));
  s.append(needle);
  const num = document.createElement('strong');
  num.className = 'ab-aqi-num';
  num.textContent = aqi ?? '—';
  box.append(s, num);
  if (aqi == null || still()) { needle.style.transform = `rotate(${deg}deg)`; return box; }
  needle.style.transform = 'rotate(0deg)';
  requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${deg}deg)`; }));
  const t0 = performance.now(), dur = 900, to = +aqi;
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    num.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1 && num.isConnected !== false) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return box;
}

/** 天氣氛圍層（放在天氣卡最上面的一條）：雨絲、雲飄、太陽光芒、夜晚星星；純 CSS 動畫 */
export function weatherScene(scene) {
  const el = document.createElement('div');
  el.className = `ab-scene ${scene}`;
  el.setAttribute('aria-hidden', 'true');
  if (scene === 'rain') for (let i = 0; i < 14; i++) { const d = document.createElement('i'); d.style.setProperty('--x', `${(i * 7.3 + 3) % 100}%`); d.style.setProperty('--d', `${(i * 0.137) % 0.9}s`); el.append(d); }
  if (scene === 'night') for (let i = 0; i < 7; i++) { const d = document.createElement('i'); d.style.setProperty('--x', `${(i * 13.7 + 8) % 92}%`); d.style.setProperty('--y', `${(i * 23) % 60 + 10}%`); d.style.setProperty('--d', `${i * 0.4}s`); el.append(d); }
  if (scene === 'cloud' || scene === 'rain') { const c = document.createElement('b'); c.className = 'cloud'; el.append(c); }
  if (scene === 'sun') { const s = document.createElement('b'); s.className = 'sun'; el.append(s); }
  if (scene === 'night') { const m = document.createElement('b'); m.className = 'moon'; el.append(m); }
  return el;
}
