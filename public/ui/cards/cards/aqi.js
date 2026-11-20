// aqi（aqi_nearby）：最近測站 AQI（色彩＋文字）、PM2.5／PM10／O3、附近其他測站
import { h, hhmm } from '../dom.js';
import { aqiGauge } from '../gauge.js';

export default {
  refreshSec: 900,
  title: (d, { t }) => t('aqi.title', { site: d.nearest.site }),
  announce: (d, { t }) => t('aqi.say', { site: d.nearest.site, aqi: d.nearest.aqi ?? '—', status: d.nearest.status }),
  body(d, { t }) {
    const n = d.nearest;
    const stat = (label, v) => h('div', { class: 'ab-stat' }, h('span', { class: 'ab-sub' }, label), h('strong', null, v ?? '—'));
    return h('div', { class: 'ab-body' },
      h('div', { class: `ab-aqi ${n.level || 'na'}` }, aqiGauge(n.aqi, `AQI ${n.aqi ?? '—'}，${n.status}`), h('div', null, h('strong', null, n.status), n.pollutant && h('p', { class: 'ab-sub' }, t('aqi.pollutant', { p: n.pollutant })))),
      h('div', { class: 'ab-stats' }, stat('PM2.5', n.pm25), stat('PM10', n.pm10), stat('O₃', n.o3)),
      h('p', { class: 'ab-sub' }, t('aqi.meta', { county: n.county, km: (n.distanceM / 1000).toFixed(1), time: hhmm(n.publishTime.replace(' ', 'T') + '+08:00') })),
      d.nearby.length > 0 && h('ul', { class: 'ab-list' }, d.nearby.map((s) => h('li', { class: 'ab-row' }, h('span', { class: 'ab-name' }, s.site), h('span', { class: `ab-chip aqi-${s.level || 'na'}` }, `AQI ${s.aqi ?? '—'} ${s.status}`)))));
  },
};
