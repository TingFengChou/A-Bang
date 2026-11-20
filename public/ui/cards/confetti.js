// 中獎紙花：2D 紙片從上方灑落（DOM＋Web Animations，不靠外部套件，MCP Apps 卡片裡也能用）。
// reduced motion 或精簡模式時不放。
const COLORS = ['#0f766e', '#14b8a6', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#22c55e'];
const quiet = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('lite-motion');

/**
 * @param {HTMLElement} host 紙花的容器（會加上 position: relative 的覆蓋層）
 * @param {{ count?: number }} [o]
 */
export function confetti(host, { count = 28 } = {}) {
  if (!host || quiet() || typeof host.animate !== 'function') return;
  const layer = document.createElement('div');
  layer.className = 'ab-confetti';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(layer);
  const h = Math.max(host.clientHeight, 160);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const w = 5 + Math.random() * 5;
    p.style.cssText = `position:absolute;top:-12px;left:${Math.random() * 100}%;width:${w}px;height:${w * 1.6}px;background:${COLORS[i % COLORS.length]};border-radius:2px`;
    layer.append(p);
    const dx = (Math.random() - 0.5) * 120, rot = (Math.random() - 0.5) * 720;
    p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${dx}px, ${h * (0.7 + Math.random() * 0.5)}px) rotate(${rot}deg)`, opacity: 0 }],
      { duration: 900 + Math.random() * 700, delay: Math.random() * 250, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 2000);
}
