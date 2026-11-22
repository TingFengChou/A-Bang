// 交通方式與資料來源的線條圖示（24×24、stroke=currentColor）＋立體「代幣」樣式：行程卡、決策圖、公車卡片、公車頁共用。
// 圖示是本檔常數字串（不含上游資料），可以安全放進 innerHTML。3D 只用 CSS（cards.css .ab-token），reduced motion 時不動。

/** 各方式的路徑（不含外層 <svg>，決策圖要放進 SVG 內） */
export const MODE_PATH = {
  walk: '<circle cx="13" cy="4.2" r="2"/><path d="M11 21l2-6-3-3 1-5 4 3 3 1"/><path d="M9.5 12.5L7 15"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7"/><path d="M10 9l2 7h-6"/><path d="M14 6h2.5"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><path d="M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r=".9" fill="currentColor"/><circle cx="16" cy="14.5" r=".9" fill="currentColor"/>',
  metro: '<circle cx="12" cy="12" r="9"/><path d="M8 16V8l4 5 4-5v8"/>',
  thsr: '<path d="M4 15c0-5 4-9 10-9h3l3 4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h16"/><path d="M7 21l2-2M17 21l-2-2"/>',
  tra: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14"/><path d="M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="13.5" r=".9" fill="currentColor"/><circle cx="15" cy="13.5" r=".9" fill="currentColor"/>',
  intercity: '<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M3 11h18M7 19v-3M17 19v-3"/>',
  // 自己開車：方向盤（跟叫車的車子分開，一眼看得出是自己開）
  drive: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M3.8 10.5h5.9M14.3 10.5h5.9M12 14.2v6.2"/>',
  ridehail: '<path d="M5 16l1.5-5A2 2 0 0 1 8.4 9.6h7.2a2 2 0 0 1 1.9 1.4L19 16"/><rect x="3" y="16" width="18" height="3" rx="1"/><circle cx="7.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>',
  place: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  weather: '<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 1 1 17 18z"/>',
  air: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  traffic: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  fare: '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M14 7v12"/>',
  trip: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
};
MODE_PATH.transit = MODE_PATH.bus;

/** 代表色（與 cards.css 的 .ab-leg 一致） */
export const MODE_COLOR = {
  walk: '#6b7280', bike: '#d97706', bus: '#0f766e', transit: '#0f766e', metro: '#0e7490', thsr: '#c2410c', tra: '#1d4ed8',
  intercity: '#7c3aed', ridehail: '#334155', drive: '#475569', place: '#1d4ed8', weather: '#0284c7', air: '#0891b2', traffic: '#b45309', fare: '#7c3aed', trip: '#0f766e',
};

/** 方案（plan_trip option.role）或小幫手角色 → 圖示 key */
const ROLE_MODE = { walk: 'walk', bike: 'bike', bus: 'bus', thsr: 'thsr', tra: 'tra', intercity: 'intercity', ridehail: 'ridehail', drive: 'drive', metro: 'metro',
  地點: 'place', 天氣: 'weather', 空品: 'air', 路況: 'traffic', 票價: 'fare', 行程: 'trip', 公車: 'bus', YouBike: 'bike', 高鐵: 'thsr', 台鐵: 'tra', 捷運: 'metro', 客運: 'intercity', 叫車: 'ridehail' };
export const modeOf = (roleOrMode) => ROLE_MODE[roleOrMode] || (MODE_PATH[roleOrMode] ? roleOrMode : null);

export const modeSvg = (mode) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MODE_PATH[mode] || ''}</svg>`;

/**
 * 立體代幣：圓角方塊＋漸層＋厚度陰影＋微透視；go＝輕輕上下浮動（交通工具「在動」）。
 * @param {string} mode MODE_PATH 的 key（或方案 role、小幫手角色）
 * @param {{ size?: 'sm'|'md'|'lg', go?: boolean, label?: string, cls?: string }} [o]
 */
export function token(mode, { size = 'md', go = false, label, cls = '' } = {}) {
  const m = modeOf(mode) || 'trip';
  const el = document.createElement('span');
  el.className = `ab-token ${size}${go ? ' go' : ''}${cls ? ` ${cls}` : ''}`;
  el.style.setProperty('--c', MODE_COLOR[m]);
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  el.innerHTML = modeSvg(m); // 常數 SVG
  return el;
}

/** 放進 SVG 圖（決策圖）的圖示：<svg x y width height>，顏色用 currentColor（呼叫端設 style.color） */
export function svgIcon(mode, x, y, size) {
  const m = modeOf(mode);
  if (!m) return null;
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ x, y, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'dg-ic', 'aria-hidden': 'true' })) s.setAttribute(k, String(v));
  s.innerHTML = MODE_PATH[m]; // 常數 SVG
  return s;
}
