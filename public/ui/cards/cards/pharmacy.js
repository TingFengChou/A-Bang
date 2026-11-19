// pharmacy（pharmacy_search）：健保特約藥局、今天營業時段、電話、地圖搜尋
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const MAX = 10;

export default {
  title: (d, { t }) => t('pharmacy.title', { area: d.area || d.query || '' }),
  body(d, { host, t, state, rerender }) {
    if (!d.pharmacies.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('pharmacy.empty')));
    const rows = state.all ? d.pharmacies : d.pharmacies.slice(0, MAX);
    return h('div', { class: 'ab-body' },
      h('p', { class: 'ab-sub' }, t('pharmacy.today', { day: d.weekday })),
      h('ul', { class: 'ab-list' }, rows.map((p) => h('li', { class: 'ab-pharm' },
        h('div', { class: 'ab-row' }, h('span', { class: 'ab-name' }, p.name),
          h('span', { class: p.openToday ? 'ab-chip ok' : 'ab-chip' }, p.today == null ? t('pharmacy.unknown') : p.today.length ? p.today.join('・') : t('pharmacy.closed'))),
        h('p', { class: 'ab-sub' }, p.address, p.phone ? `・${p.phone}` : ''),
        h('div', { class: 'ab-actions' }, navButton(host, p.nav, t('pharmacy.map')))))),
      d.pharmacies.length > MAX && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.all = !state.all; rerender(); } }, state.all ? t('common.less') : t('common.more')),
      h('p', { class: 'ab-foot' }, t('pharmacy.note')));
  },
};
