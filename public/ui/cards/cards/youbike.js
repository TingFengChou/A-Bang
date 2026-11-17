// youbike（youbike_nearby）：可切換「借車／還車」排序；可借（電輔）、可還、暫停營運
import { h } from '../dom.js';
import { navButton } from '../actions.js';

export default {
  refreshSec: 30,
  title: (d, { t }) => t('youbike.title'),
  body(d, { host, t, state, rerender }) {
    if (!d.stations?.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('youbike.empty', { radius: d.radius ?? 500 })));
    const mode = state.sort || 'rent';
    const key = mode === 'rent' ? 'rent' : 'returnSlots';
    // 有車（或有空位）的站依距離在前，其餘在後
    const list = [...d.stations].sort((a, b) => (b.inService && b[key] > 0) - (a.inService && a[key] > 0) || a.distance - b.distance);
    const seg = h('div', { class: 'ab-tabs', role: 'tablist' }, ['rent', 'return'].map((m) => h('button', {
      type: 'button', role: 'tab', class: m === mode ? 'ab-tab on' : 'ab-tab', 'aria-selected': m === mode ? 'true' : 'false',
      onclick: () => { state.sort = m; rerender(); } }, t(m === 'rent' ? 'youbike.sortRent' : 'youbike.sortReturn'))));
    return h('div', { class: 'ab-body' }, seg, h('ul', { class: 'ab-list' }, list.map((s) => h('li', { class: s.inService ? 'ab-item' : 'ab-item off' },
      h('div', { class: 'ab-row' }, h('span', { class: 'ab-name' }, s.name), h('span', { class: 'ab-dist' }, t('common.meters', { n: s.distance }))),
      s.inService
        ? h('div', { class: 'ab-chips' },
          h('span', { class: s.rent > 0 ? 'ab-chip ok' : 'ab-chip bad' }, t('youbike.rent', { n: s.rent ?? '?' })),
          s.electric > 0 && h('span', { class: 'ab-chip' }, t('youbike.electric', { n: s.electric })),
          h('span', { class: s.returnSlots > 0 ? 'ab-chip ok' : 'ab-chip bad' }, t('youbike.return', { n: s.returnSlots ?? '?' })))
        : h('div', { class: 'ab-sub' }, t('youbike.outOfService')),
      h('div', { class: 'ab-actions' }, navButton(host, s.nav))))));
  },
};
