// metro（metro_live_board）：各線各方向下一班；空資料時說明
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const CODES = new Set(['arriving', 'approaching', 'minutes', 'scheduled', 'unknown']);
/** 狀態代碼；不認得的值（舊版回應的中文字串、離線快取）用 etaMin 推回代碼 */
export function statusCode(x) {
  if (x.scheduled) return 'scheduled';
  if (CODES.has(x.status)) return x.status;
  if (x.etaMin == null) return 'unknown';
  return x.etaMin <= 0 ? 'arriving' : x.etaMin <= 1 ? 'approaching' : 'minutes';
}
/** 狀態代碼（arriving／approaching／minutes／scheduled／unknown，core/services/metro.js）→ 字典（英文卡片不出現中文） */
const statusOf = (x, t) => {
  const code = statusCode(x);
  if (code === 'scheduled') return x.etaMin <= 1 ? t('metro.scheduledSoon') : t('metro.scheduled', { min: x.etaMin });
  if (code === 'arriving' || code === 'approaching') return t(`metro.status.${code}`);
  if (code === 'minutes' && x.etaMin != null) return t('metro.status.minutes', { min: x.etaMin });
  return t('metro.status.unknown');
};
/** 英文卡片：線名、終點有英文就用英文 */
const lineOf = (x, en) => (en && x.lineEn) || x.line;
const destOf = (x, en) => (en && x.destinationEn) || x.destination;
const isEn = (locale) => String(locale || '').startsWith('en');

export default {
  refreshSec: 20,
  // 時刻表估算（北捷看板只有進站中）不叫「即時到站」
  title: (d, { t }) => t(d.source && d.source !== 'live' ? 'metro.titleTimetable' : 'metro.title', { station: d.station }),
  /** 播報：最近的 2 班 */
  announce: (d, { t, locale }) => (d.trains?.length ? d.trains.slice(0, 2).map((x) => `${lineOf(x, isEn(locale))} ${t('metro.toward', { dest: destOf(x, isEn(locale)) })} ${statusOf(x, t)}`).join(isEn(locale) ? '; ' : '；') : null),
  body(d, { host, t, locale }) {
    const list = d.trains?.length
      ? h('ul', { class: 'ab-list' }, d.trains.map((x) => h('li', { class: 'ab-row' },
        h('span', { class: 'ab-line', style: x.lineColor ? { borderColor: x.lineColor } : null }, lineOf(x, isEn(locale))),
        h('span', { class: 'ab-name' }, t('metro.toward', { dest: destOf(x, isEn(locale)) })),
        // 時刻表估的班次不脈動（不是看到車真的要進站）
        (() => { const soon = ['arriving', 'approaching'].includes(statusCode(x)) && x.etaMin != null && x.etaMin <= 1; return h('span', { class: soon ? 'ab-eta soon' : x.scheduled ? 'ab-eta planned' : 'ab-eta' }, soon && h('i', { class: 'ab-pulse', 'aria-hidden': 'true' }), statusOf(x, t)); })())))
      : h('p', { class: 'ab-empty' }, t('metro.empty'));
    // 北捷即時到站在開放資料只有「進站中」：其他班次依時刻表估算，照實說
    const note = d.note && h('p', { class: 'ab-empty' }, locale === 'en' && d.noteEn ? d.noteEn : d.note);
    return h('div', { class: 'ab-body' }, list, note, h('div', { class: 'ab-actions' }, navButton(host, d.nav)));
  },
};
