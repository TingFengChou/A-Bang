// bus-station（bus_station_eta）：此站所有路線的到站時間
import { h } from '../dom.js';

export function arrivalsList(arrivals, t) {
  if (!arrivals?.length) return h('p', { class: 'ab-empty' }, t('busStation.empty'));
  return h('ul', { class: 'ab-list' }, arrivals.map((r) => h('li', { class: 'ab-row' },
    h('span', { class: 'ab-route' }, r.routeName),
    h('span', { class: 'ab-sub' }, r.direction ? t('busStation.inbound') : t('busStation.outbound')),
    h('span', { class: r.etaSec != null && r.etaSec < 180 ? 'ab-eta soon' : 'ab-eta', ...(r.status === 0 && r.etaSec != null && { 'data-eta-sec': r.etaSec }) }, r.statusText))));
}

export default {
  refreshSec: 20,
  title: (d, { t }) => t('busStation.title', { name: d.name || d.stationId }),
  /** 播報：最快到站的 3 班 */
  announce: (d, { t }) => (d.arrivals?.length ? t('busStation.announce', { name: d.name || d.stationId, list: d.arrivals.slice(0, 3).map((r) => `${r.routeName} ${r.statusText}`).join('；') }) : null),
  body: (d, { t }) => h('div', { class: 'ab-body' }, arrivalsList(d.arrivals, t)),
};
