// metro（metro_live_board）：各線各方向下一班；空資料時說明
import { h } from '../dom.js';
import { navButton } from '../actions.js';

export default {
  refreshSec: 20,
  title: (d, { t }) => t('metro.title', { station: d.station }),
  /** 播報：最近的 2 班 */
  announce: (d, { t }) => (d.trains?.length ? d.trains.slice(0, 2).map((x) => `${x.line} ${t('metro.toward', { dest: x.destination })} ${x.status}`).join('；') : null),
  body(d, { host, t, locale }) {
    const list = d.trains?.length
      ? h('ul', { class: 'ab-list' }, d.trains.map((x) => h('li', { class: 'ab-row' },
        h('span', { class: 'ab-line', style: x.lineColor ? { borderColor: x.lineColor } : null }, x.line),
        h('span', { class: 'ab-name' }, t('metro.toward', { dest: x.destination })),
        h('span', { class: x.etaMin != null && x.etaMin <= 1 ? 'ab-eta soon' : 'ab-eta' }, x.etaMin != null && x.etaMin <= 1 && h('i', { class: 'ab-pulse', 'aria-hidden': 'true' }), x.status))))
      : h('p', { class: 'ab-empty' }, t('metro.empty'));
    // 北捷即時到站在開放資料只有「進站中」：其他班次依時刻表估算，照實說
    const note = d.note && h('p', { class: 'ab-empty' }, locale === 'en' && d.noteEn ? d.noteEn : d.note);
    return h('div', { class: 'ab-body' }, list, note, h('div', { class: 'ab-actions' }, navButton(host, d.nav)));
  },
};
