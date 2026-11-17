// bus-route（bus_route_eta）：方向切換、站序時間軸、即將到站高亮、點站牌 → 導航／提問（CARDS.md §4）
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const SOON_SEC = 180;

export default {
  refreshSec: 20,
  title: (d, { t }) => t('busRoute.title', { route: d.routeName }),
  body(d, { host, t, state, rerender }) {
    const dirs = d.directions || [];
    const di = Math.min(state.dir ?? 0, Math.max(0, dirs.length - 1));
    const dir = dirs[di];
    const tabs = dirs.length > 1 && h('div', { class: 'ab-tabs', role: 'tablist', 'aria-label': t('busRoute.switchDir') },
      dirs.map((x, i) => h('button', { type: 'button', role: 'tab', class: i === di ? 'ab-tab on' : 'ab-tab', 'aria-selected': i === di ? 'true' : 'false',
        onclick: () => { state.dir = i; state.stop = null; rerender(); } }, x.label)));
    if (!dir) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('common.empty')));
    const list = h('ol', { class: 'ab-timeline' }, dir.stops.map((s) => {
      const soon = s.etaSec != null && s.etaSec < SOON_SEC;
      const open = state.stop === s.seq;
      return h('li', { class: `ab-stop${soon ? ' soon' : ''}${open ? ' open' : ''}` },
        h('button', { type: 'button', class: 'ab-stop-row', 'aria-expanded': open ? 'true' : 'false', onclick: () => {
          state.stop = open ? null : s.seq;
          if (!open) host?.setContext?.(t('busRoute.context', { route: d.routeName, stop: s.stopName }));
          rerender();
        } },
        h('span', { class: 'ab-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'ab-name' }, s.stopName),
        h('span', { class: soon ? 'ab-eta soon' : 'ab-eta', ...(s.status === 0 && s.etaSec != null && { 'data-eta-sec': s.etaSec }) }, s.statusText),
        s.plate && h('span', { class: 'ab-bus', title: t('busRoute.busHere') }, t('busRoute.plate', { plate: s.plate }))),
        open && h('div', { class: 'ab-actions' },
          navButton(host, s.nav),
          host?.ask && h('button', { type: 'button', class: 'ab-btn', onclick: () => host.ask(t('busRoute.ask', { route: d.routeName, stop: s.stopName })) }, t('common.more'))));
    }));
    return h('div', { class: 'ab-body' }, tabs, list);
  },
};
