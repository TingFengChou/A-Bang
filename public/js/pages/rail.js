import { api } from '../api.js';
import { icons } from '../icons.js';
import { esc, loading, errorBox, empty, prefs } from '../ui.js';

const CFG = {
  thsr: { title: '高鐵時刻', stations: api.thsrStations, timetable: api.thsrTimetable, def: ['1000', '1070'] },
  tra: { title: '台鐵時刻', stations: api.traStations, timetable: api.traTimetable, def: ['1000', '4400'] },
};

export default {
  title: '時刻表',
  hero: ({ params: [sys] }) => (sys === 'tra' ? 'tra' : 'thsr'),
  askHint: ({ params: [sys] }) => ({ kind: 'rail', context: `使用者正在看${sys === 'tra' ? '台鐵' : '高鐵'}時刻表`, chips: [sys === 'tra' ? '台鐵到台中下一班幾點？' : '下一班高鐵到台中幾點？'] }),
  async render({ main, params: [sys], setTitle }) {
    const cfg = CFG[sys] || CFG.thsr;
    setTitle(cfg.title);
    main.innerHTML = loading();
    let stations;
    try { stations = await cfg.stations(); } catch (e) { return (main.innerHTML = errorBox(e)); }
    const [from0, to0] = prefs.get(`od:${sys}`, cfg.def);
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const opts = (sel) => stations.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

    main.innerHTML = `
      <form class="form" id="f">
        <div class="row">
          <select class="field" name="from" aria-label="起站">${opts(from0)}</select>
          <button type="button" class="icon-btn" id="swap" aria-label="交換起訖站">${icons.swap}</button>
          <select class="field" name="to" aria-label="迄站">${opts(to0)}</select>
        </div>
        <div class="row"><input class="field" type="date" name="date" value="${today}" aria-label="日期"><button class="btn">查詢</button></div>
      </form>
      <div id="res"></div>`;
    const f = main.querySelector('#f');
    main.querySelector('#swap').onclick = () => { [f.from.value, f.to.value] = [f.to.value, f.from.value]; search(); };
    f.addEventListener('submit', (e) => { e.preventDefault(); search(); });

    async function search() {
      const res = main.querySelector('#res');
      if (f.from.value === f.to.value) return (res.innerHTML = empty('起訖站不可相同'));
      prefs.set(`od:${sys}`, [f.from.value, f.to.value]);
      res.innerHTML = loading();
      try {
        const r = await cfg.timetable(f.from.value, f.to.value, f.date.value);
        if (!r.trains.length) return (res.innerHTML = empty(r.transfersUnavailable ? '當日沒有直達班次；換車的走法暫時查不到，請稍後再查' : sys === 'tra' ? '當日沒有直達班次，也找不到換車的走法' : '當日沒有直達班次'));
        const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
        const isToday = r.date === today;
        const nextIdx = isToday ? r.trains.findIndex((t) => t.depart >= now) : -1;
        res.innerHTML = `
          <div class="section-title"><h2>${esc(r.from)} → ${esc(r.to)}</h2><span>${r.trains.length} 班</span></div>
          <div class="card list">${r.trains.map((t, i) => `
            <div class="train ${isToday && t.depart < now ? 'past' : ''} ${i === nextIdx ? 'next' : ''}" ${i === nextIdx ? 'id="next"' : ''}>
              <span class="t">${esc(t.depart)}</span>
              <span class="mid">${Math.floor(t.minutes / 60) ? `${Math.floor(t.minutes / 60)}時` : ''}${t.minutes % 60}分</span>
              <span class="t">${esc(t.arrive)}</span>
              <span class="meta">${t.legs ? `<span class="type-tag xfer">換車 ${t.transfers} 次</span>` : `${t.type ? `<span class="type-tag">${esc(t.type)}</span><br>` : ''}${esc(t.trainNo)} 次`}</span>
              ${t.legs ? `<span class="legs"><b>在${esc(t.via.join('、'))}換車</b>${t.legs.map((l) => `<br>${esc(l.trainNo)} 次${l.type ? ` ${esc(l.type)}` : ''}｜${esc(l.from)} ${esc(l.depart)} → ${esc(l.to)} ${esc(l.arrive)}`).join('')}</span>` : ''}
            </div>`).join('')}</div>
          ${r.transferNote ? `<p class="note rail-note">${esc(r.transferNote)}</p>` : ''}`;
        main.querySelector('#next')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) { res.innerHTML = errorBox(e); }
    }
    search();
  },
};
