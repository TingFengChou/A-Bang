// passport-wait（passport_waiting，M16-04c）：護照現場等待人數——每個據點一列：申辦一般件、網路預約件、領護照；網路預約與即時看板連結
import { h, safeUrl } from '../dom.js';

const clock = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : null; };
const cell = (n, label, t) => h('div', { class: 'ab-pw-cell' }, h('span', { class: 'ab-pw-n' }, n == null ? '—' : String(n)), h('span', { class: 'ab-sub' }, label), n != null && h('span', { class: 'ab-sr' }, t('passport.people')));

export default {
  refreshSec: 60,
  title: (d, { t }) => t('passport.title'),
  body(d, { host, t }) {
    const link = (url, label, primary) => { const u = safeUrl(url); return u && host?.openLink && h('button', { type: 'button', class: primary ? 'ab-btn ab-primary' : 'ab-btn', onclick: () => host.openLink(u) }, label); };
    return h('div', { class: 'ab-body' },
      d.offices.length ? h('ul', { class: 'ab-list' }, d.offices.map((o) => h('li', { class: 'ab-pw-office' },
        h('span', { class: 'ab-name' }, o.short),
        h('div', { class: 'ab-pw-row', role: 'group', 'aria-label': o.short },
          cell(o.general.waiting, t('passport.general'), t), cell(o.online.waiting, t('passport.online'), t), cell(o.pickup.waiting, t('passport.pickup'), t))))) : h('p', { class: 'ab-empty' }, t('passport.empty')),
      h('p', { class: 'ab-sub' }, d.updatedAt ? t('passport.updated', { time: clock(d.updatedAt) }) : t('passport.note')),
      h('div', { class: 'ab-actions' }, link(d.booking, t('passport.book'), true), link(d.page, t('passport.page'))));
  },
};
