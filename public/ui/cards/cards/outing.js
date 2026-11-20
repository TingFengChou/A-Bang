// outing（outing_advice）：出門建議——帶傘、防曬、保暖、口罩（最多 3 點，要注意的醒目）＋氣溫、降雨機率、空品
// 圖示是本檔常數字串（不含上游資料），可以安全放進 innerHTML；建議文字一律用 textContent（h()）。
import { h } from '../dom.js';
import { dict } from './aqi.js';

/** 24×24 線條圖示（stroke=currentColor） */
const ICON = {
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
  hot: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cold: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  mask: '<path d="M5 9c2.5-1 4.5-1.3 7-1.3s4.5.3 7 1.3v4c0 3-3.5 5.5-7 5.5S5 16 5 13z"/><path d="M5 10c-2 0-3 1-3 2.5S3.5 15 5.5 14.5M19 10c2 0 3 1 3 2.5s-1.5 2.5-3.5 2"/><path d="M9 12h6M9.5 15h5"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
};
const icon = (kind) => {
  const s = h('span', { class: 'ab-out-icon', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[kind] || ICON.ok}</svg>`;
  return s;
};

export default {
  refreshSec: 600,
  title: (d, { t }) => (d.name ? t('outing.titleAt', { name: d.name }) : t('outing.title')),
  announce: (d) => d.items.map((x) => x.text).join('；'),
  body(d, { t }) {
    const w = d.weather;
    const a = d.air;
    const stat = (label, value) => h('div', { class: 'ab-stat' }, h('span', { class: 'ab-sub' }, label), h('strong', null, value));
    const demo = (x) => (x?.demo ? t('outing.demoTag') : '');
    const meta = [w && t('outing.metaWeather', { station: w.station, demo: demo(w) }), a && t('outing.metaAir', { site: a.site, demo: demo(a) })].filter(Boolean).join('・');
    return h('div', { class: 'ab-body' },
      // list-style:none 時 VoiceOver 會丟掉清單語意：明寫 role=list；要注意的項目讀屏先念「要注意」（不只靠顏色）
      h('ul', { class: 'ab-outing', role: 'list', 'aria-label': t('outing.items') }, d.items.map((x) => h('li', { class: `ab-out ${x.level}` },
        icon(x.kind), h('span', null, x.level === 'warn' && h('span', { class: 'ab-sr' }, t('outing.warn')), x.text)))),
      (d.missing || []).length > 0 && h('p', { class: 'ab-sub ab-missing' }, d.missing.map((k) => t(`outing.missing.${k}`)).join('；')),
      h('div', { class: 'ab-stats' },
        stat(t('weather.temp'), w?.tempC != null ? `${w.tempC}°C` : '—'),
        stat(t('outing.pop'), w?.pop3h != null ? `${w.pop3h}%` : '—'),
        stat(a?.status ? t('outing.aqiStatus', { status: dict(t, 'aqi.status', a.status) }) : t('outing.aqi'), a?.aqi != null ? `${a.aqi}` : '—')),
      meta && h('p', { class: 'ab-sub' }, meta));
  },
};
