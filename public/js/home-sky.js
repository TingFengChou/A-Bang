// 首頁「夜色與光」的天空與舞台（ADR-0023；原型 docs/prototypes/home-night-light.html）。
// 只產生 SVG／HTML 字串（純函式、固定亂數：每次畫出來一樣，截圖可比對）；動畫在 css/home.css。
// 天際線兩側高、中間低，右邊是一節一節的台北 101；核心是「手機上的 AI」（Λ＋琥珀核心＋軌道，同阿幫的腦袋）。

/** 固定亂數（Park–Miller） */
export function rng(seed = 28) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** 星星（46 顆，夜空上半部） */
export function starsHtml(seed = 28, w = 420, h = 330) {
  const r = rng(seed);
  return Array.from({ length: 46 }, () => {
    const z = r() < 0.2 ? 2 : 1.2;
    return `<i style="left:${(r() * w).toFixed(0)}px;top:${(r() * h).toFixed(0)}px;width:${z}px;height:${z}px;animation-delay:-${(r() * 4).toFixed(2)}s;animation-duration:${(2.5 + r() * 3).toFixed(2)}s"></i>`;
  }).join('');
}

/** 天際線＋台北 101（viewBox 0 0 375 110） */
export function skylineSvg(seed = 29) {
  const r = rng(seed);
  let x = -4, d = '', w = '';
  while (x < 378) {
    const bw = 10 + Math.round(r() * 12);
    const [lo, hi] = x < 84 ? [22, 40] : x < 292 ? [9, 14] : [22, 36];
    const bh = lo + Math.round(r() * (hi - lo));
    if (x + bw < 313 || x > 347) {
      d += `M${x} 110v-${bh}h${bw}v${bh}z`;
      for (let k = 0; k < 3; k++) if (bh > 24 && r() < 0.7) w += `<rect class="w" x="${x + 2 + Math.round(r() * (bw - 5))}" y="${110 - bh + 3 + Math.round(r() * (bh - 22))}" width="1.8" height="1.8" style="animation-delay:-${(r() * 3).toFixed(1)}s"/>`;
    }
    x += bw + 1;
  }
  const cx = 330;
  let t = `M${cx - 14} 110L${cx - 12} 84H${cx + 12}L${cx + 14} 110z`, joints = '', win = '';
  for (let i = 0; i < 8; i++) {
    const yb = 84 - i * 6.5, yt = yb - 6.5;
    t += `M${cx - 8} ${yb}L${cx - 10.5} ${yt}H${cx + 10.5}L${cx + 8} ${yb}z`;
    joints += `<path d="M${cx - 10.5} ${yt + 0.4}H${cx + 10.5}" stroke="rgba(204,251,241,.75)" stroke-width=".8"/>`;
    for (const [dx, on] of [[-5, i % 2 === 0], [-1, i % 3 !== 1], [3, i % 2 === 1], [6.5, i % 4 === 0]]) if (on) win += `<rect class="w" x="${cx + dx - 1}" y="${yt + 2.2}" width="2.2" height="2.2" style="animation-delay:-${(i * 0.37).toFixed(2)}s"/>`;
  }
  t += `M${cx - 6} 32v-5h12v5zM${cx - 3.5} 27v-4h7v4z`;
  return `<svg class="hs-city" viewBox="0 0 375 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><defs><linearGradient id="hs-bld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c6f6a"/><stop offset="1" stop-color="#0d3f3e"/></linearGradient><linearGradient id="hs-101" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fa79c"/><stop offset=".55" stop-color="#1d7f78"/><stop offset="1" stop-color="#145c58"/></linearGradient></defs>
<path d="M0 84C30 62 58 74 92 70s70 22 120 20 76-34 110-30 36 12 53 8V110H0z" fill="rgba(94,234,212,.1)"/>
<path d="${d}" fill="url(#hs-bld)" stroke="rgba(153,246,228,.28)" stroke-width=".6"/><g class="lights" fill="rgba(253,230,138,.85)">${w}</g>
<path d="${t}" fill="url(#hs-101)" stroke="rgba(204,251,241,.55)" stroke-width=".6"/>${joints}
<path d="M${cx} 23V11" stroke="#CCFBF1" stroke-width="1.4" stroke-linecap="round"/><g class="lights"><g fill="#FDE68A">${win}</g><circle class="beacon" cx="${cx}" cy="10" r="2.2" fill="#FBBF24"/><circle cx="${cx}" cy="10" r="5" fill="rgba(251,191,36,.25)"/></g></svg>`;
}

/** 手機上的 AI 核心（同阿幫的腦袋的圖形語彙） */
export const CORE_SVG = `<svg class="hs-mark" viewBox="86 34 188 188" aria-hidden="true"><defs><linearGradient id="hs-lam" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#CCFBF1"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient></defs>
<circle class="ring" cx="180" cy="128" r="86"/><g class="orbit"><circle class="arc" cx="180" cy="128" r="86"/><circle class="sat" cx="266" cy="128" r="5.5"/></g>
<path class="lam" d="M130 190L180 68L230 190"/><g class="coreP"><circle class="core-ring" cx="180" cy="160" r="26"/><circle class="core" cx="180" cy="160" r="16"/></g></svg>`;

/** 金色頭腦（手機上的 AI；不放文字，點了浮出說明） */
export const BRAIN_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="bf" d="M12 4.6C10.6 3 8 3.2 7.2 5.1 5.2 5.1 4 6.9 4.6 8.7 3.2 9.7 3 11.9 4.2 13.1 3.6 14.9 4.8 16.9 6.8 17c.6 1.9 3.2 2.7 5.2 1.3 2 1.4 4.6.6 5.2-1.3 2-.1 3.2-2.1 2.6-3.9 1.2-1.2 1-3.4-.4-4.4.6-1.8-.6-3.6-2.6-3.6C16 3.2 13.4 3 12 4.6z"/><path class="bl" d="M12 4.6v13.7M7.6 9.2c1.3-.3 2.3.4 2.5 1.6M7.2 13.6c1.1.7 2.4.4 3-.6M16.4 9.2c-1.3-.3-2.3.4-2.5 1.6M16.8 13.6c-1.1.7-2.4.4-3-.6"/></svg>`;

/** 藍鵲（吉祥物，站在卡片左上；版面放不下時不畫） */
export const BIRD_SVG = `<svg class="hs-bird" viewBox="44 18 162 178" aria-hidden="true"><g transform="translate(118 124) scale(1.25)">
<g class="b-tail"><path d="M24 20 Q50 30 60 54 L49 59 Q40 40 18 31 Z" fill="#2E6FB7"/><path d="M60 54 L49 59 L54 68 L65 63 Z" fill="#FFFFFF" stroke="#2E6FB7" stroke-width="1.5"/></g>
<rect x="34" y="-10" width="28" height="38" rx="9" fill="#0F766E"/><rect x="44" y="-3" width="14" height="9" rx="3" fill="#E1F5EE"/><circle cx="49" cy="16" r="3.5" fill="#FBBF24"/><circle cx="57" cy="22" r="3.5" fill="#F0997B"/>
<path d="M56 -10 L62 -30" stroke="#1F2A44" stroke-width="2.5" stroke-linecap="round"/><circle class="b-ant" cx="62" cy="-31" r="3.5" fill="#5EEAD4"/>
<circle cx="0" cy="0" r="46" fill="#3B82C4"/><path d="M-46 -2 A46 46 0 0 1 46 -2 Q30 -14 0 -14 Q-30 -14 -46 -2 Z" fill="#1F2A44"/><ellipse cx="0" cy="20" rx="28" ry="22" fill="#EAF3FB"/>
<g class="b-open"><circle cx="-15" cy="-6" r="8" fill="#FFF"/><circle cx="15" cy="-6" r="8" fill="#FFF"/><g class="b-pup"><circle cx="-13" cy="-5" r="4.5" fill="#1F2A44"/><circle cx="17" cy="-5" r="4.5" fill="#1F2A44"/><circle cx="-11.5" cy="-7" r="1.5" fill="#FFF"/><circle cx="18.5" cy="-7" r="1.5" fill="#FFF"/></g></g>
<g class="b-happy"><path d="M-21 -6 Q-15 -12 -9 -6" fill="none" stroke="#FFF" stroke-width="3.5" stroke-linecap="round"/><path d="M9 -6 Q15 -12 21 -6" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round"/></g>
<rect x="3" y="-19" width="27" height="22" rx="7" fill="#FFFFFF" fill-opacity=".18"/><rect x="3" y="-19" width="27" height="22" rx="7" fill="#5EEAD4" fill-opacity=".28" stroke="#134E4A" stroke-width="3"/><path d="M30 -12 L40 -16" stroke="#0F766E" stroke-width="2.5" stroke-linecap="round"/>
<path d="M-6 4 L6 4 L0 13 Z" fill="#E24B4A"/><circle cx="-27" cy="8" r="6" fill="#F4C0D1"/><circle cx="27" cy="8" r="6" fill="#F4C0D1"/>
<g class="b-crest"><path d="M-6 -44 C-10 -64 4 -80 26 -76 C12 -70 6 -58 6 -44 Z" fill="#1F2A44"/><path d="M4 -44 C4 -60 16 -68 32 -64 C20 -60 15 -53 14 -42 Z" fill="#4A90D9"/><path d="M14 -42 C17 -52 26 -57 37 -52 C28 -50 24 -45 21 -39 Z" fill="#1F2A44"/></g>
<rect x="-54" y="-18" width="16" height="24" rx="7" fill="#134E4A"/><rect x="-50" y="-13" width="8" height="14" rx="4" fill="#5EEAD4"/><path d="M-46 4 Q-40 20 -16 17" fill="none" stroke="#134E4A" stroke-width="3.5" stroke-linecap="round"/><circle cx="-15" cy="17" r="4" fill="#134E4A"/>
<path class="b-wdn" d="M-42 10 Q-54 20 -46 32" fill="none" stroke="#3B82C4" stroke-width="10" stroke-linecap="round"/><path class="b-wup" d="M-44 8 Q-64 -6 -58 -26" fill="none" stroke="#3B82C4" stroke-width="10" stroke-linecap="round"/>
<path d="M-10 44 L-12 54 M10 44 L12 54" stroke="#E24B4A" stroke-width="4" stroke-linecap="round"/></g></svg>`;

/**
 * 訊號到核心的連線（純計算）：每個訊號右邊一點 → 核心中心的長度與角度。
 * @param {Array<{ x: number, y: number }>} from 訊號右端（相對舞台）
 * @param {{ x: number, y: number }} core
 */
export function threads(from, core) {
  return from.map((p) => ({ left: p.x, top: p.y, len: Math.round(Math.hypot(core.x - p.x, core.y - p.y)), deg: +(Math.atan2(core.y - p.y, core.x - p.x) * 180 / Math.PI).toFixed(2) }));
}

/** 完整進場一天一次（ADR-0023 §10）；其他時候只淡入。回傳這次要不要跑完整版（會記下今天） */
export function fullIntroToday(dateKey, store = globalThis.localStorage) {
  try {
    if (store?.getItem('abang.homeIntro') === dateKey) return false;
    store?.setItem('abang.homeIntro', dateKey);
    return true;
  } catch { return false; }
}
