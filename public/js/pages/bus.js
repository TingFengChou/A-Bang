import { api } from '../api.js';
import { icons } from '../icons.js';
import { esc, loading, errorBox, empty, etaBadge, fmtTime, favs, prefs, chev } from '../ui.js';

const CITY_CHIPS = [['Taipei', '臺北'], ['NewTaipei', '新北'], ['Taoyuan', '桃園'], ['Taichung', '臺中'], ['Tainan', '臺南'], ['Kaohsiung', '高雄'], ['Keelung', '基隆'], ['Hsinchu', '新竹']];
const REFRESH = 20000;

function starAction(setAction, toast, item) {
  const draw = () => setAction(favs.has(item.id) ? icons.starFill : icons.star, () => {
    toast(favs.toggle(item) ? '已加入收藏' : '已取消收藏'); draw();
  }, '收藏', favs.has(item.id));
  draw();
}

/** 路線搜尋 */
export const busSearch = {
  title: '公車',
  root: true,
  render({ main, query }) {
    let city = prefs.get('city', 'Taipei');
    main.innerHTML = `
      <form class="form" id="f">
        <div class="chips" id="cities">${CITY_CHIPS.map(([v, n]) => `<button type="button" class="chip" data-c="${v}">${n}</button>`).join('')}</div>
        <div class="row"><input class="field" name="q" placeholder="輸入路線，例如 307、紅30" value="${esc(query.q || '')}" enterkeyhint="search" autocomplete="off"><button class="btn">搜尋</button></div>
      </form>
      <div id="res"></div>`;
    const res = main.querySelector('#res');
    const chips = main.querySelectorAll('#cities .chip');
    const paint = () => chips.forEach((c) => c.classList.toggle('on', c.dataset.c === city));
    chips.forEach((c) => c.addEventListener('click', () => { city = c.dataset.c; prefs.set('city', city); paint(); search(); }));
    paint();

    async function search() {
      const q = main.querySelector('[name=q]').value.trim();
      if (!q) return (res.innerHTML = empty('輸入路線號碼開始查詢'));
      res.innerHTML = loading();
      try {
        const rows = await api.busRoutes(city, q);
        res.innerHTML = rows.length
          ? `<div class="card list">${rows.map((r) => `
              <a href="#/bus/${r.city}/${encodeURIComponent(r.routeName)}">
                <div class="grow"><div class="title">${esc(r.routeName)}</div><div class="sub">${esc(r.departure)} ⇄ ${esc(r.destination)}</div></div>${chev}
              </a>`).join('')}</div>`
          : empty('找不到符合的路線');
      } catch (e) { res.innerHTML = errorBox(e); }
    }
    main.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); search(); });
    search();
  },
};

/**
 * 螢幕閱讀器播報（M6-04）：第一次載入不念（內容本身會被讀到）；之後每 20 秒刷新，文字有變才更新 live region。
 * @param {HTMLElement} el aria-live 區塊（常駐，不隨列表重畫）
 */
export function announcer(el) {
  let first = true, last = '';
  return (text) => {
    if (!first && text && text !== last) el.textContent = text;
    first = false; last = text;
  };
}

/** 路線即時到站 */
export const busRoute = {
  title: '路線',
  render({ main, params: [city, route], setTitle, setAction, toast, onCleanup }) {
    route = decodeURIComponent(route);
    setTitle(`${route} 公車`);
    starAction(setAction, toast, { id: `route:${city}:${route}`, type: 'route', title: `${route} 公車`, sub: '路線', href: location.hash });
    let dir = 0, data = null;
    main.innerHTML = `<div class="seg" id="dirs"></div><div id="stops">${loading()}</div><div class="updated" id="upd"></div><p class="sr-only" aria-live="polite" aria-atomic="true" id="sr"></p>`;
    const say = announcer(main.querySelector('#sr'));

    async function load() {
      try {
        data = await api.busEta(city, route);
        paint();
        const d = data.directions[dir] || data.directions[0];
        const soon = (d?.stops || []).filter((s) => s.status === 0 && s.etaSec != null && s.etaSec < 180).slice(0, 3).map((s) => s.stopName);
        say(soon.length ? `${route} 即將進站：${soon.join('、')}` : '');
        main.querySelector('#upd').textContent = `更新於 ${fmtTime()}・每 20 秒自動更新`;
      } catch (e) { main.querySelector('#stops').innerHTML = errorBox(e); }
    }
    function paint() {
      const dirs = main.querySelector('#dirs');
      dirs.innerHTML = data.directions.map((d, i) => `<button data-i="${i}" class="${i === dir ? 'on' : ''}">${esc(d.label)}</button>`).join('');
      dirs.querySelectorAll('button').forEach((b) => (b.onclick = () => { dir = +b.dataset.i; paint(); }));
      const d = data.directions[dir] || data.directions[0];
      main.querySelector('#stops').innerHTML = `<div class="card list timeline">${d.stops.map((s) => `
        <div class="${s.plate ? 'here' : ''}">
          <div class="grow"><div class="title">${esc(s.stopName)}</div>${s.plate ? `<div class="plate">${esc(s.plate)} 即將抵達</div>` : ''}</div>
          ${etaBadge(s)}
        </div>`).join('')}</div>`;
    }
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH);
    onCleanup(() => clearInterval(t));
  },
};

/** 站位即時到站 */
export const busStation = {
  title: '公車站',
  render({ main, params: [city, stationId], query, setTitle, setAction, toast, onCleanup }) {
    stationId = decodeURIComponent(stationId);
    const name = query.name || '公車站';
    setTitle(name);
    starAction(setAction, toast, { id: `station:${city}:${stationId}`, type: 'station', city, stationId, title: name, sub: '公車站', href: location.hash });
    main.innerHTML = `<div id="list">${loading()}</div><div class="updated" id="upd"></div><p class="sr-only" aria-live="polite" aria-atomic="true" id="sr"></p>`;
    const say = announcer(main.querySelector('#sr'));
    async function load() {
      try {
        const rows = await api.busStationEta(city, stationId);
        say(rows.slice(0, 3).map((r) => `${r.routeName} ${r.statusText}`).join('；'));
        main.querySelector('#list').innerHTML = rows.length
          ? `<div class="card list">${rows.map((r) => `
              <a href="#/bus/${city}/${encodeURIComponent(r.routeName)}">
                <div class="grow"><div class="title">${esc(r.routeName)}</div><div class="sub">${r.direction ? '返程' : '去程'}</div></div>${etaBadge(r)}
              </a>`).join('')}</div>`
          : empty('目前沒有到站資訊');
        main.querySelector('#upd').textContent = `更新於 ${fmtTime()}・每 20 秒自動更新`;
      } catch (e) { main.querySelector('#list').innerHTML = errorBox(e); }
    }
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH);
    onCleanup(() => clearInterval(t));
  },
};

/** 收藏 */
export const favPage = {
  title: '收藏',
  root: true,
  render({ main }) {
    const l = favs.list();
    main.innerHTML = l.length
      ? `<div class="card list">${l.map((f) => `<a href="${esc(f.href)}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${esc(f.sub)}</div></div>${chev}</a>`).join('')}</div>`
      : empty('還沒有收藏。在公車路線或站牌頁點右上角星號即可加入。');
  },
};
