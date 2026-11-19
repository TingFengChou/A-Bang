// weather（weather_now）：氣溫、過去 1 小時雨量、3 小時降雨機率、是否下雨（中央氣象署）
import { h, hhmm } from '../dom.js';

export default {
  refreshSec: 600,
  title: (d, { t }) => t('weather.title', { where: [d.county, d.town].filter(Boolean).join('') || d.station }),
  announce: (d) => d.summary,
  body(d, { t }) {
    const stat = (label, value) => h('div', { class: 'ab-stat' }, h('span', { class: 'ab-sub' }, label), h('strong', null, value));
    return h('div', { class: 'ab-body' },
      h('p', { class: d.raining ? 'ab-wx rain' : 'ab-wx' }, d.raining ? t('weather.rain') : t('weather.dry')),
      h('div', { class: 'ab-stats' },
        stat(t('weather.temp'), d.tempC != null ? `${d.tempC}°C` : '—'),
        stat(t('weather.rain1h'), d.rainMm1h != null ? `${d.rainMm1h} mm` : '—'),
        stat(t('weather.pop3h'), d.pop3h != null ? `${d.pop3h}%` : '—')),
      h('p', { class: 'ab-sub' }, t('weather.station', { station: d.station, km: (d.distanceM / 1000).toFixed(1), time: d.observedAt ? hhmm(d.observedAt) : '—' })));
  },
};
