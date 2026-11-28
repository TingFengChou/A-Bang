// clinic（clinic_search）：這一區的健保特約診所，這個時段有登記看診的排前面；科別、電話、地圖搜尋。
// 只說「有登記看診」，不說看診中（臨時休診不會反映）；不判斷病情、不推薦科別。
import { h, fmtTel } from '../dom.js';
import { navButton } from '../actions.js';
import { periodNow } from './pharmacy.js';
import { periodClosingSoon } from '../../../../core/closing.js';

const MAX = 5; // 其餘收在「看更多」（設計審查：一張卡太高）
const telOf = (p) => String(p || '').split('#')[0].replace(/[^0-9]/g, ''); // 分機（#）不放進 tel:
const PERIOD_EN = { 上午: 'morning', 下午: 'afternoon', 晚上: 'evening' };
const DAY_EN = { 星期一: 'Monday', 星期二: 'Tuesday', 星期三: 'Wednesday', 星期四: 'Thursday', 星期五: 'Friday', 星期六: 'Saturday', 星期日: 'Sunday' };

export default {
  refreshSec: 600, // 時段換了（中午、傍晚）「這個時段」跟著更新
  title: (d, { t }) => t('clinic.title', { what: d.dept || t('clinic.western'), area: d.otherCities ? `${d.city}${d.area}` : d.area || d.query || '' }),
  body(d, { host, t, state, rerender, locale }) {
    const pname = (x) => (locale === 'en' ? PERIOD_EN[x] || x : x);
    if (!d.clinics.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('clinic.empty')), h('p', { class: 'ab-foot' }, t('clinic.note')));
    const planned = d.phase === 'planned';
    const now = planned ? d.period : periodNow(); // 問別的日子或時段：加粗問的那個時段
    const rows = state.all ? d.clinics : d.clinics.slice(0, MAX);
    return h('div', { class: 'ab-body' },
      h('p', { class: 'ab-sub' }, t(planned ? 'clinic.onDay' : 'clinic.today', { day: locale === 'en' ? DAY_EN[d.weekday] || d.weekday : d.weekday })),
      !planned && now && periodClosingSoon(now) && d.clinics.some((c) => c.today?.includes(now)) && h('p', { class: 'ab-chip warn ab-closing', role: 'note' }, t('clinic.closingSoon', { period: pname(now) })), // 這個時段快到尾聲（卡片每 10 分鐘重算；第十三輪）
      h('ul', { class: 'ab-list' }, rows.map((c) => h('li', { class: 'ab-pharm ab-clinic' },
        h('div', { class: 'ab-row' }, h('span', { class: 'ab-name' }, c.name),
          h('span', { class: c.today?.length ? 'ab-chip ok' : 'ab-chip' }, c.today == null ? t('clinic.unknown') : c.today.length ? c.today.flatMap((p, i) => [i ? (locale === 'en' ? ', ' : '・') : '', p === now ? h('strong', {}, pname(p)) : pname(p)]) : t('clinic.closed'))), // 現在這個時段加粗（不只靠顏色）
        !planned && now && c.today?.includes(now) && h('p', { class: 'ab-open-now' }, h('i', { class: 'ab-dot-ok', 'aria-hidden': 'true' }), t('clinic.openNow', { period: pname(now) })),
        h('p', { class: 'ab-sub' }, [c.depts?.join(locale === 'en' ? ', ' : '、'), c.address].filter(Boolean).join('・')), // 科別與地址一行
        h('div', { class: 'ab-actions' }, navButton(host, c.nav, t('clinic.map'), t('clinic.mapOf', { name: c.name })),
          telOf(c.phone).length >= 6 && h('a', { class: 'ab-btn', href: `tel:${telOf(c.phone)}`, 'aria-label': t('clinic.callOf', { name: c.name }) }, t('clinic.call', { phone: fmtTel(c.phone) })))))),
      d.clinics.length > MAX && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.all = !state.all; rerender(); } }, state.all ? t('common.less') : t('common.more')),
      h('p', { class: 'ab-foot' }, t('clinic.note')));
  },
};
