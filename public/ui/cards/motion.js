// 動畫引擎（GSAP，index.html 以 <script defer> 載入；漸進增強）。
// 沒載到、reduced motion、低階裝置（html.lite-motion）時回 null，呼叫端改用 CSS 動畫或直接顯示最終狀態。
// 動畫只陪襯：資料到了就顯示，不讓使用者等（ADR-0009 不加假延遲）。
let registered = false;
export function motion() {
  const g = globalThis.gsap;
  if (!g || typeof document === 'undefined') return null;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  if (document.documentElement.classList.contains('lite-motion')) return null;
  if (!registered) {
    registered = true;
    try { g.registerPlugin(...[globalThis.MotionPathPlugin, globalThis.Flip].filter(Boolean)); } catch { /* 外掛缺了就只用核心 */ }
    g.config({ nullTargetWarn: false }); // 某些節點組可能是空的（例如沒有排除的方案）
  }
  return g;
}
