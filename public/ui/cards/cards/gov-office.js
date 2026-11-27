// gov-office（gov_office_nearby，M16-04b）：最近的戶政事務所（距離、步行、地址、電話、導航）＋今天是不是上班日（辦公日曆）
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const telOf = (p) => String(p || '').split(/[#,，轉]/)[0].replace(/[^0-9]/g, ''); // 分機不放進 tel:
const far = (m, t) => (m >= 1000 ? t('govOffice.km', { km: (m / 1000).toFixed(1) }) : t('govOffice.m', { m }));

export default {
  title: (d, { t }) => t('govOffice.title'),
  body(d, { host, t }) {
    const today = d.today;
    const day = today.workday ? t('govOffice.workday', { date: today.date }) : t('govOffice.off', { date: today.date, note: today.note ? t('govOffice.offNote', { note: today.note }) : '' });
    return h('div', { class: 'ab-body' },
      h('p', { class: today.workday ? 'ab-chip ok ab-gov-day' : 'ab-chip warn ab-gov-day', role: 'status' }, day),
      !today.known && h('p', { class: 'ab-sub' }, t('govOffice.guess')),
      d.offices.length ? h('ul', { class: 'ab-list' }, d.offices.map((o) => h('li', { class: 'ab-gov-office' },
        h('div', { class: 'ab-row' }, h('span', { class: 'ab-name' }, o.name), h('span', { class: 'ab-sub' }, `${far(o.distanceM, t)}${o.walkMin ? t('govOffice.walk', { n: o.walkMin }) : ''}`)),
        h('p', { class: 'ab-sub' }, o.address),
        h('div', { class: 'ab-actions' },
          navButton(host, o.nav),
          telOf(o.tel).length >= 6 && h('a', { class: 'ab-btn', href: `tel:${telOf(o.tel)}` }, t('govOffice.call', { tel: o.tel })))))) : h('p', { class: 'ab-empty' }, t('govOffice.empty')),
      h('p', { class: 'ab-sub ab-gov-note' }, t('govOffice.hours')));
  },
};
