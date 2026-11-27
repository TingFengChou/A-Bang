// pharmacy（pharmacy_search）：健保特約藥局、今天營業時段、電話、地圖搜尋
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const MAX = 5; // 其餘收在「看更多」（設計審查）
/** 現在是哪個看診時段（台灣時間；健保署只登記上午、下午、晚上）：營業時間外回 null */
export const periodNow = (now = Date.now()) => { const hr = new Date(now + 8 * 3600e3).getUTCHours(); return hr >= 8 && hr < 12 ? '上午' : hr >= 12 && hr < 18 ? '下午' : hr >= 18 && hr < 22 ? '晚上' : null; };
const telOf = (p) => String(p || '').split('#')[0].replace(/[^0-9]/g, ''); // 分機（#）不放進 tel:（# 會被當成網址片段）
const PERIOD_EN = { 上午: 'morning', 下午: 'afternoon', 晚上: 'evening' };
const DAY_EN = { 星期一: 'Monday', 星期二: 'Tuesday', 星期三: 'Wednesday', 星期四: 'Thursday', 星期五: 'Friday', 星期六: 'Saturday', 星期日: 'Sunday', 星期天: 'Sunday' };

export default {
  refreshSec: 600, // 時段換了（中午、傍晚）「今天這個時段」跟著更新
  title: (d, { t }) => t('pharmacy.title', { area: d.area || d.query || '' }),
  body(d, { host, t, state, rerender, locale }) {
    const pname = (x) => (locale === 'en' ? PERIOD_EN[x] || x : x);
    if (!d.pharmacies.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('pharmacy.empty')));
    const rows = state.all ? d.pharmacies : d.pharmacies.slice(0, MAX);
    return h('div', { class: 'ab-body' },
      h('p', { class: 'ab-sub' }, t('pharmacy.today', { day: locale === 'en' ? DAY_EN[d.weekday] || d.weekday : d.weekday })),
      h('ul', { class: 'ab-list' }, rows.map((p) => h('li', { class: 'ab-pharm' },
        h('div', { class: 'ab-row' }, h('span', { class: 'ab-name' }, p.name),
          h('span', { class: p.openToday ? 'ab-chip ok' : 'ab-chip' }, p.today == null ? t('pharmacy.unknown') : p.today.length ? p.today.map(pname).join(locale === 'en' ? ', ' : '・') : t('pharmacy.closed'))),
        p.today?.includes(periodNow()) && h('p', { class: 'ab-open-now' }, h('i', { class: 'ab-dot-ok', 'aria-hidden': 'true' }), t('pharmacy.openNow', { period: pname(periodNow()) })), // 健保署只登記時段：說「有登記」，不說營業中
        h('p', { class: 'ab-sub' }, p.address),
        h('div', { class: 'ab-actions' }, navButton(host, p.nav, t('pharmacy.map'), t('clinic.mapOf', { name: p.name })),
          telOf(p.phone).length >= 6 && h('a', { class: 'ab-btn', href: `tel:${telOf(p.phone)}`, 'aria-label': t('clinic.callOf', { name: p.name }) }, t('pharmacy.call', { phone: p.phone })))))),
      d.pharmacies.length > MAX && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.all = !state.all; rerender(); } }, state.all ? t('common.less') : t('common.more')),
      h('p', { class: 'ab-foot' }, t('pharmacy.note')));
  },
};
