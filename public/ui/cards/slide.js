// 站間滑動（FLIP）：資料刷新重畫前記下每台公車（以車牌為鍵）的位置，重畫後從舊位置滑到新位置，
// 使用者看得出「車往前開了一站」，而不是圖示瞬間跳過去。只在資料刷新時用（切方向、展開某站不滑）。
// reduced motion、精簡模式（html.lite-motion）、沒有 Web Animations 時不動。
const still = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || (typeof document !== 'undefined' && document.documentElement.classList.contains('lite-motion'));

/** @returns {Map<string, { top: number, left: number }>} 車牌 → 位置 */
export function snapshot(root, sel = '[data-plate]') {
  const m = new Map();
  for (const el of root?.querySelectorAll?.(sel) || []) {
    const r = el.getBoundingClientRect();
    m.set(el.dataset.plate, { top: r.top, left: r.left });
  }
  return m;
}

/** 位置變了（≥ 2px）的車從舊位置滑過來；回傳滑動的台數 */
export function slide(root, before, { sel = '[data-plate]', ms = 700 } = {}) {
  if (!root || !before?.size || still()) return 0;
  let n = 0;
  for (const el of root.querySelectorAll(sel)) {
    const a = before.get(el.dataset.plate);
    if (!a || typeof el.animate !== 'function') continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.15)` }, { transform: 'translate(0, 0) scale(1)' }], { duration: ms, easing: 'cubic-bezier(.3, 1.25, .5, 1)' });
    n++;
  }
  return n;
}
