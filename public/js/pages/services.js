// 服務 #/services（2026-11-21 首頁重新設計）：所有資料服務的總覽，四組（防詐、交通、生活、消費與政府），每個一句「在這裡可以做什麼」＋資料來源。
// 原本分頁列上的「附近」「公車」在這裡（交通組）。點了圖示一樣飛進下一頁的頁首（View Transitions，與首頁格子同一套）。
import { miniApps, groups, TILE_COLOR, HERO, descOf } from '../registry.js';
import { icons } from '../icons.js';
import { esc, chev } from '../ui.js';
import { morphTiles } from './home.js';

/** 顯示順序：防詐放最前面（不埋在最後） */
const ORDER = ['safe', 'transit', 'life', 'gov'];

export default {
  title: '服務',
  shellTitle: 'title.services',
  root: true,
  render({ main }) {
    const list = ORDER.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
    main.innerHTML = `
      <p class="page-lead">政府開放資料，阿幫整理成你看得懂的樣子。不知道找哪個？<a href="#/agent">直接問阿幫</a>。</p>
      ${list.map((g) => `
        <section class="svc-group${g.id === 'safe' ? ' safe' : ''}" aria-labelledby="sg-${g.id}">
          <div class="section-title"><h2 id="sg-${g.id}">${esc(g.name)}</h2><span>${esc(g.note)}</span></div>
          <div class="card list svc-list">${miniApps.filter((a) => a.group === g.id && a.status !== 'soon').map(row).join('')}</div>
        </section>`).join('')}
      <p class="updated">每個服務的資料都來自政府開放資料；示範模式時標「示範」。</p>`;
    morphTiles(main, 'a.svc');
  },
};

function row(a) {
  const src = HERO[a.id]?.[1] || (a.id === 'antifraud' ? '165 全民防騙網' : '');
  return `<a class="svc" href="${a.route}" data-app="${esc(a.id)}">
    <span class="ic ab-token" style="--c:${TILE_COLOR[a.id] || '#0f766e'}">${icons[a.icon]}</span>
    <span class="grow"><span class="title">${esc(a.name)}</span><span class="sub wrap">${esc(descOf(a.id))}${src ? `<em>・${esc(src)}</em>` : ''}</span></span>${chev}</a>`;
}
