// garbage（garbage_truck_nearby）：附近清運點（時間、今天有沒有收、距離）、新北市車輛即時位置
import { h, hhmm } from '../dom.js';
import { navButton } from '../actions.js';

export default {
  refreshSec: 120,
  title: (_d, { t }) => t('garbage.title'),
  announce: (d) => { const s = d.stops.find((x) => x.truck); return s ? `${s.route}：${s.truck.location}` : null; },
  body(d, { host, t }) {
    if (!d.stops.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('garbage.empty', { covered: d.covered.join('、') })));
    return h('div', { class: 'ab-body' },
      h('ul', { class: 'ab-list' }, d.stops.map((s) => h('li', { class: s.collectToday ? 'ab-gb' : 'ab-gb off' },
        h('div', { class: 'ab-row' },
          h('strong', { class: 'ab-time' }, s.time ?? '—'),
          h('span', { class: 'ab-name' }, s.place),
          h('span', { class: 'ab-sub' }, t('common.meters', { n: s.distanceM }))),
        h('p', { class: 'ab-sub' }, `${s.route}・`, s.collectToday ? t('garbage.today') : t('garbage.notToday'), s.days ? `（${s.days}）` : ''),
        s.truck && h('p', { class: 'ab-truck' }, t('garbage.truck', { car: s.truck.car, where: s.truck.location, time: hhmm(s.truck.at.replace(' ', 'T') + '+08:00') })),
        h('div', { class: 'ab-actions' }, navButton(host, s.nav))))),
      h('p', { class: 'ab-foot' }, t('garbage.note', { covered: d.covered.join('、') })));
  },
};
