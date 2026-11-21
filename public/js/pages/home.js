import { miniApps, groups, TILE_COLOR } from '../registry.js';
import { icons } from '../icons.js';
import { esc, favs, etaBadge, chev } from '../ui.js';
import { api, state } from '../api.js';

export default {
  title: 'Abang', // App 名稱（2026-11-20 Austin 決定）；吉祥物與對話裡仍叫「阿幫」
  root: true,
  render({ main, toast, onCleanup }) {
    const hour = new Date().getHours();
    const greet = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';
    // M5-12：首頁以「問阿幫」為主要入口；離線 Demo（沒有伺服器）仍維持公車搜尋
    const offline = !!globalThis.__DEMO_SERVICES__;
    const examples = ['去台北 101', '307 到哪了？', '附近還有 YouBike 嗎？']; // 起點預設是現在位置：範例只說要去哪
    main.innerHTML = `
      <section class="hero">
        <span class="mascot-3d" aria-hidden="true"><i class="mascot-shadow"></i><img class="mascot main" src="/brand/abang-default.svg" alt=""><img class="mascot alt" src="/brand/abang-think.svg" alt=""></span>
        <small>${greet}！我是阿幫，今天要去哪裡？</small>
        <div class="big">${offline ? '即時公車・YouBike・高鐵台鐵' : '想去哪裡，直接問我'}</div>
        <form class="search" id="q">${icons.search}<input name="q" maxlength="500" placeholder="${offline ? '搜尋公車路線，例如 307' : '想去哪裡？例如：去台北 101'}" enterkeyhint="${offline ? 'search' : 'send'}" autocomplete="off" aria-label="${offline ? '搜尋公車路線' : '問阿幫'}"></form>
        ${offline ? '' : `<div class="hero-ask">${examples.map((q) => `<a class="chip" href="#/agent?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</div>`}
      </section>
      <div id="favs"></div>
      ${groups.map((g) => `
        <div class="section-title"><h2>${esc(g.name)}</h2><span>${esc(g.note)}</span></div>
        <div class="grid">${miniApps.filter((a) => a.group === g.id).map((a, i) => tile(a, i)).join('')}</div>`).join('')}
      <p class="updated" style="margin-top:24px">資料來源：交通部 TDX、政府資料開放平臺・<a href="#/settings">設定與隱私</a></p>`;

    main.querySelector('#q').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q').trim();
      if (q) location.hash = offline ? `#/bus?q=${encodeURIComponent(q)}` : `#/agent?q=${encodeURIComponent(q)}`;
    });
    // 點格子：格子的圖示飛進下一頁的頁首（View Transitions；不支援或減少動態時照常換頁）
    main.querySelectorAll('a.tile').forEach((a) => a.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || !canMorph()) return;
      e.preventDefault();
      a.querySelector('.ic').style.viewTransitionName = 'ph-token';
      dispatchEvent(new CustomEvent('abang:go', { detail: { hash: a.getAttribute('href') } }));
    }));
    main.querySelectorAll('.tile.soon').forEach((el) =>
      el.addEventListener('click', () => toast(`「${el.dataset.name}」規劃中`)));
    // 示範資料的服務在格子上標「示範」（依 /api/v1/status 的 sources）
    api.status().then(() => markDemoTiles(main)).catch(() => {});

    renderFavs(main.querySelector('#favs'));
    const t = setInterval(() => renderFavs(main.querySelector('#favs')), 30000);
    onCleanup(() => clearInterval(t));
    tiltMascot(main.querySelector('.hero'), onCleanup);
  },
};

const canMorph = () => typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('lite-motion');

/** 資料是示範的服務：格子右上角標「示範」（離線 Demo 全部是示範） */
function markDemoTiles(main) {
  const demo = new Set((state.sources || []).filter((x) => x.mode === 'demo').map((x) => x.id));
  const all = !state.sources && state.mode === 'demo';
  for (const el of main.querySelectorAll('a.tile[data-source]')) {
    el.querySelector('.tag.demo')?.remove();
    if (all || demo.has(el.dataset.source)) el.insertAdjacentHTML('beforeend', '<span class="tag demo" title="目前是示範資料，不是即時資料">示範</span>');
  }
}

function tile(a, i = 0) {
  const inner = `<span class="ic ab-token" style="--c:${TILE_COLOR[a.id] || '#0f766e'}">${icons[a.icon]}</span>${esc(a.name)}`;
  return a.status === 'soon'
    ? `<button class="tile soon" data-name="${esc(a.name)}"><span class="tag">規劃中</span>${inner}</button>`
    : `<a class="tile" style="--i:${i}" href="${a.route}" data-source="${esc(a.source)}">${inner}</a>`;
}

async function renderFavs(el) {
  const list = favs.list().slice(0, 5);
  if (!list.length) { el.innerHTML = ''; return; }
  const rows = await Promise.all(list.map(async (f) => {
    if (f.type !== 'station') return `<a href="${f.href}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${esc(f.sub)}</div></div>${chev}</a>`;
    const etas = await api.busStationEta(f.city, f.stationId).catch(() => []);
    const top = etas[0];
    return `<a href="${f.href}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${top ? `${esc(top.routeName)} 最快` : esc(f.sub)}</div></div>${top ? etaBadge(top) : chev}</a>`;
  }));
  el.innerHTML = `<div class="section-title"><h2>我的收藏</h2><a href="#/favs"><span>全部</span></a></div><div class="card list">${rows.join('')}</div>`;
}

/** 3D 吉祥物：手指／滑鼠在首頁橫幅上移動時，阿幫轉頭看過去（±12°），陰影跟著偏；離開後回到自己輕輕轉身 */
function tiltMascot(hero, onCleanup) {
  const m = hero?.querySelector('.mascot-3d');
  if (!m || document.documentElement.classList.contains('lite-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const move = (e) => {
    const r = hero.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    m.classList.add('looking');
    m.style.setProperty('--ry', `${(x * 12).toFixed(1)}deg`);
    m.style.setProperty('--rx', `${(-y * 8).toFixed(1)}deg`);
    m.style.setProperty('--sx', `${(-x * 5).toFixed(1)}px`);
  };
  const leave = () => { m.classList.remove('looking'); m.style.removeProperty('--ry'); m.style.removeProperty('--rx'); m.style.removeProperty('--sx'); };
  hero.addEventListener('pointermove', move);
  hero.addEventListener('pointerleave', leave);
  onCleanup?.(() => { hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); });
}
