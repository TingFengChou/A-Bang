// 捷運路線官方代表色（設計審查：路線色條用各線自己的顏色，一眼分得出板南線、淡水信義線）。
// 依各捷運公司公開的路線識別色；只在畫面上當色條用，不是資料來源。未知的線回 null（卡片用品牌色）。
const COLORS = {
  TRTC: { BL: '#0070BD', R: '#E3002C', G: '#008659', O: '#F8B61C', BR: '#C48C31', Y: '#FFDB00' },
  TYMC: { A: '#8246AF' },
  TMRT: { G: '#8DC21F' },
  KRTC: { R: '#E20B65', O: '#FAA73F', C: '#7CBD52' },
};

/**
 * @param {string} system TRTC／TYMC／TMRT／KRTC
 * @param {string|null} lineId 例：BL、R、G
 * @returns {string|null}
 */
export function metroLineColor(system, lineId) {
  const id = String(lineId || '').toUpperCase().replace(/[^A-Z]/g, '');
  return COLORS[system]?.[id] || null;
}
