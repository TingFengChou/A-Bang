// metro（metro_live_board）：各線各方向下一班；空資料時說明
import { h } from '../dom.js';
import { navButton } from '../actions.js';

/** 時刻表估的班次用字典（英文卡片不出現中文）；看板的班次照資料 */
const statusOf = (x, t) => (x.scheduled ? (x.etaMin <= 1 ? t('metro.scheduledSoon') : t('metro.scheduled', { min: x.etaMin })) : x.status);

export default {
  refreshSec: 20,
  // 時刻表估算（北捷看板只有進站中）不叫「即時到站」
  title: (d, { t }) => t(d.source && d.source !== 'live' ? 'metro.titleTimetable' : 'metro.title', { station: d.station }),
  /** 播報：最近的 2 班 */
  announce: (d, { t }) => (d.trains?.length ? d.trains.slice(0, 2).map((x) => `${x.line} ${t('metro.toward', { dest: x.destination })} ${statusOf(x, t)}`).join('；') : null),
  body(d, { host, t, locale }) {
    const list = d.trains?.length
      ? h('ul', { class: 'ab-list' }, d.trains.map((x) => h('li', { class: 'ab-row' },
        h('span', { class: 'ab-line', style: x.lineColor ? { borderColor: x.lineColor } : null }, x.line),
        h('span', { class: 'ab-name' }, t('metro.toward', { dest: x.destination })),
        // 時刻表估的班次不脈動（不是看到車真的要進站）
        (() => { const soon = !x.scheduled && x.etaMin != null && x.etaMin <= 1; return h('span', { class: soon ? 'ab-eta soon' : x.scheduled ? 'ab-eta planned' : 'ab-eta' }, soon && h('i', { class: 'ab-pulse', 'aria-hidden': 'true' }), statusOf(x, t)); })())))
      : h('p', { class: 'ab-empty' }, t('metro.empty'));
    // 北捷即時到站在開放資料只有「進站中」：其他班次依時刻表估算，照實說
    const note = d.note && h('p', { class: 'ab-empty' }, locale === 'en' && d.noteEn ? d.noteEn : d.note);
    return h('div', { class: 'ab-body' }, list, note, h('div', { class: 'ab-actions' }, navButton(host, d.nav)));
  },
};
