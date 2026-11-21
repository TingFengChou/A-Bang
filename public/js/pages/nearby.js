import { api } from '../api.js';
import { icons } from '../icons.js';
import { esc, loading, errorBox, empty, fmtDist, fmtTime, locate, chev, FALLBACK } from '../ui.js';
import { locationNotice } from '../location-help.js';
import { pageHero } from '../page-hero.js';

/** 切換公車站／YouBike 時頁首跟著換（換分頁不經過 app.js 換頁） */
const swapHero = (tab) => { const h = pageHero(tab === 'bike' ? 'bike' : 'nearby'); const box = document.getElementById('pagehero'); if (h && box) box.replaceChildren(h); };

export default {
  title: '附近',
  root: true,
  hero: ({ query }) => (query.tab === 'bike' ? 'bike' : 'nearby'),
  askHint: ({ query }) => ({ context: `使用者正在看附近的${query.tab === 'bike' ? ' YouBike' : '公車站'}`, chips: query.tab === 'bike' ? ['附近還有 YouBike 嗎？'] : ['附近有哪些公車站？', '附近還有 YouBike 嗎？'] }),
  render({ main, query, setAction, onCleanup }) {
    let tab = query.tab === 'bike' ? 'bike' : 'bus';
    let pos = null;
    main.innerHTML = `
      <div class="seg"><button data-t="bus">公車站</button><button data-t="bike">YouBike</button></div>
      <div class="chips" style="margin-bottom:10px"><span class="chip on" id="loc">${icons.pin.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} 定位中…</span></div>
      <div id="list">${loading('取得位置中…')}</div>
      <div class="updated" id="upd"></div>`;
    const list = main.querySelector('#list');
    const seg = main.querySelectorAll('.seg button');
    const paint = () => seg.forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    seg.forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; paint(); history.replaceState(null, '', `#/nearby${tab === 'bike' ? '?tab=bike' : ''}`); swapHero(tab); load(); }));
    paint();

    async function load(fresh = false) {
      list.innerHTML = loading();
      try {
        pos = await locate({ fresh });
        main.querySelector('#loc').lastChild.textContent = ` ${pos.label}`;
        main.querySelector('.loc-help')?.remove();
        if (pos === FALLBACK) main.querySelector('#list').before(locationNotice({ retry: () => load(true), onCleanup })); // 沒拿到位置：說原因與下一步（S1c）
        if (tab === 'bus') renderBus(await api.busNearby(pos.lat, pos.lon));
        else renderBike(await api.bikeNearby(pos.lat, pos.lon));
        main.querySelector('#upd').textContent = `更新於 ${fmtTime()}`;
      } catch (e) { list.innerHTML = errorBox(e); }
    }

    function renderBus(rows) {
      if (!rows.length) return (list.innerHTML = empty('附近 400 公尺內沒有公車站'));
      list.innerHTML = `<div class="card list">${rows.map((s) => `
        <a href="#/bus-station/${s.city}/${encodeURIComponent(s.stationId)}?name=${encodeURIComponent(s.name)}">
          <div class="grow"><div class="title">${esc(s.name)}</div><div class="sub">${s.routes.map(esc).join('・')}</div></div>
          <span class="dist">${fmtDist(s.distance)}</span>${chev}
        </a>`).join('')}</div>`;
    }

    function renderBike(rows) {
      if (!rows.length) return (list.innerHTML = empty('附近 500 公尺內沒有 YouBike 站'));
      list.innerHTML = `<div class="card list">${rows.map((s) => `
        <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=walking" target="_blank" rel="noopener">
          <div class="grow">
            <div class="title">${esc(s.name)}</div>
            <div class="sub">${fmtDist(s.distance)}・${esc(s.type)}${s.electric ? `・電輔 ${s.electric}` : ''}${s.inService ? '' : '・暫停營運'}</div>
          </div>
          <div class="bikebar">
            <div class="${s.rent ? '' : 'zero'}"><b>${s.rent ?? '-'}</b><span>可借</span></div>
            <div class="ret"><b>${s.returnSlots ?? '-'}</b><span>可還</span></div>
          </div>
        </a>`).join('')}</div>`;
    }

    setAction(icons.locate, () => load(true), '重新定位');
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000);
    onCleanup(() => clearInterval(t));
  },
};
