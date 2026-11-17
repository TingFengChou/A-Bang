import { miniApps, groups } from '../registry.js';
import { icons } from '../icons.js';
import { esc, favs, etaBadge, chev } from '../ui.js';
import { api } from '../api.js';

export default {
  title: '阿幫',
  root: true,
  render({ main, toast, onCleanup }) {
    const hour = new Date().getHours();
    const greet = hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';
    main.innerHTML = `
      <section class="hero">
        <img class="mascot" src="/brand/abang-default.svg" alt="">
        <small>${greet}！我是阿幫，今天要去哪裡？</small>
        <div class="big">即時公車・YouBike・高鐵台鐵</div>
        <form class="search" id="q">${icons.search}<input name="q" placeholder="搜尋公車路線，例如 307" enterkeyhint="search" autocomplete="off"></form>
      </section>
      <div id="favs"></div>
      ${groups.map((g) => `
        <div class="section-title"><h2>${esc(g.name)}</h2><span>${esc(g.note)}</span></div>
        <div class="grid">${miniApps.filter((a) => a.group === g.id).map(tile).join('')}</div>`).join('')}
      <p class="updated" style="margin-top:24px">資料來源：交通部 TDX、政府資料開放平臺</p>`;

    main.querySelector('#q').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q').trim();
      if (q) location.hash = `#/bus?q=${encodeURIComponent(q)}`;
    });
    main.querySelectorAll('.tile.soon').forEach((el) =>
      el.addEventListener('click', () => toast(`「${el.dataset.name}」規劃中，預計串接${el.dataset.source}資料`)));

    renderFavs(main.querySelector('#favs'));
    const t = setInterval(() => renderFavs(main.querySelector('#favs')), 30000);
    onCleanup(() => clearInterval(t));
  },
};

function tile(a) {
  const inner = `<span class="ic">${icons[a.icon]}</span>${esc(a.name)}`;
  return a.status === 'soon'
    ? `<button class="tile soon" data-name="${esc(a.name)}" data-source="${esc(a.source)}"><span class="tag">規劃中</span>${inner}</button>`
    : `<a class="tile" href="${a.route}">${inner}</a>`;
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
