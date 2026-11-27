// passport-wait（passport_waiting，M16-04c）：護照現場等待人數——每個據點一列：申辦一般件、網路預約件、領護照；網路預約與即時看板連結
import { h, safeUrl } from '../dom.js';

const cell = (n, label, t) => h('div', { class: 'ab-pw-cell' }, h('span', { class: n === 0 ? 'ab-pw-n ab-pw-zero' : 'ab-pw-n' }, n == null ? '—' : String(n), n != null && h('small', {}, t('passport.people'))), h('span', { class: 'ab-sub' }, label)); // 單位看得到（設計審查）

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
      h('p', { class: 'ab-sub' }, d.updatedAt ? t('passport.updated') : t('passport.note')), // 時間在卡片標題列，不重複
      h('div', { class: 'ab-actions' }, link(d.booking, t('passport.book'), true), link(d.page, t('passport.page'))));
  },
};
