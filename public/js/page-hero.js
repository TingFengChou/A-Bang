// 點進首頁格子後的頁首（2026-11-21 Austin：「首頁裡面每個項目點進去都要有美美的動畫與圖示」）：
// 跟格子同一個立體圖示（從格子飛進來，View Transitions），每個服務有自己的小動作（太陽轉、地震晃、單車搖、公車開…），
// 一句說明＋資料來源。圖示只是裝飾（讀屏跳過）；減少動態、精簡模式時不動。
import { miniApps, TILE_COLOR, HERO, HERO_COMPACT } from './registry.js';
import { icons } from './icons.js';
import { esc } from './ui.js';

/**
 * @param {string} id 格子 id（registry.js）
 * @returns {HTMLElement|null}
 */
export function pageHero(id) {
  const a = miniApps.find((x) => x.id === id);
  const h = HERO[id];
  if (!a || !h) return null;
  const box = document.createElement('section');
  box.className = `page-hero ph-${id} play${HERO_COMPACT.has(id) ? ' compact' : ''}`;
  const c = TILE_COLOR[id] || '#0f766e';
  box.style.setProperty('--c', c);
  box.innerHTML = `<span class="ph-token ab-token" style="--c:${c}" aria-hidden="true"><span class="ph-ic">${icons[a.icon] || ''}</span></span>`
    + `<div class="ph-text"><p class="ph-lead">${esc(h[0])}</p><p class="ph-src">資料來源：${esc(h[1])}</p></div>`
    + '<i class="ph-dot d1" aria-hidden="true"></i><i class="ph-dot d2" aria-hidden="true"></i><i class="ph-dot d3" aria-hidden="true"></i>';
  // 小動作只做幾次（WCAG 2.2.2：超過 5 秒的動態要能停），點圖示再做一次
  box.querySelector('.ph-token').addEventListener('click', () => { box.classList.remove('play'); void box.offsetWidth; box.classList.add('play'); });
  return box;
}
