// nearby（bus_nearby_stations）：依距離排序；點站 → 卡片內展開該站到站（host.callTool）
import { h } from '../dom.js';
import { navButton } from '../actions.js';
import { arrivalsList } from './bus-station.js';

export default {
  title: (d, { t }) => t('nearby.title'),
  body(d, { host, t, state, rerender }) {
    if (!d.stations?.length) {
      return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('nearby.empty', { radius: d.radius ?? 400 })),
        host?.ask && h('button', { type: 'button', class: 'ab-btn', onclick: () => host.ask(t('nearby.expandAsk')) }, t('nearby.expand')));
    }
    const open = async (s) => {
      if (state.open === s.stationId) { state.open = null; rerender(); return; }
      state.open = s.stationId; state.arrivals = null; state.err = null; rerender();
      try {
        const r = await host.callTool('bus_station_eta', { city: s.city, stationId: s.stationId });
        if (state.open === s.stationId) { state.arrivals = r.data.arrivals; rerender(); }
      } catch (e) { state.err = e?.message || String(e); rerender(); }
    };
    return h('div', { class: 'ab-body' }, h('ul', { class: 'ab-list' }, d.stations.map((s) => h('li', { class: 'ab-item' },
      h('button', { type: 'button', class: 'ab-row ab-click', 'aria-expanded': state.open === s.stationId ? 'true' : 'false', onclick: () => host?.callTool && s.city && open(s) },
        h('span', { class: 'ab-name' }, s.name),
        h('span', { class: 'ab-dist' }, t('common.meters', { n: s.distance }))),
      h('div', { class: 'ab-sub' }, t('nearby.routes', { routes: s.routes.join('、') })),
      h('div', { class: 'ab-actions' }, navButton(host, s.nav)),
      state.open === s.stationId && h('div', { class: 'ab-expand' },
        state.err ? h('p', { class: 'ab-fail' }, state.err) : state.arrivals ? arrivalsList(state.arrivals, t) : h('p', { class: 'ab-sub' }, t('common.loading')))))));
  },
};
