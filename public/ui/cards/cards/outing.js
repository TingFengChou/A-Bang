// outing（outing_advice）：出門建議——帶傘、防曬、保暖、口罩（最多 3 點，要注意的醒目）＋天氣與空品的數字
// 圖示是本檔常數字串（不含上游資料），可以安全放進 innerHTML；建議文字一律用 textContent（h()）。
import { h } from '../dom.js';

/** 24×24 線條圖示（stroke=currentColor） */
const ICON = {
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/><path d="M12 3v0"/>',
  hot: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cold: '<path d="M8 3l-4 3v15h16V6l-4-3"/><path d="M8 3l4 4 4-4"/><path d="M12 7v14"/>',
  mask: '<path d="M4 9c3-1 5-1 8-1s5 0 8 1v4c0 3-4 6-8 6s-8-3-8-6z"/><path d="M4 9L2 8M20 9l2-1M8 12h8M9 15h6"/>',
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
    return h('div', { class: 'ab-body' },
      h('ul', { class: 'ab-outing', 'aria-label': t('outing.items') }, d.items.map((x) => h('li', { class: `ab-out ${x.level}` },
        icon(x.kind), h('span', null, x.text)))),
      h('div', { class: 'ab-stats' },
        stat(t('weather.temp'), w?.tempC != null ? `${w.tempC}°C` : '—'),
        stat(t('weather.pop3h'), w?.pop3h != null ? `${w.pop3h}%` : '—'),
        stat(t('outing.aqi'), a?.aqi != null ? `${a.aqi}（${a.status}）` : '—')),
      h('p', { class: 'ab-sub' }, t('outing.meta', { station: w?.station || '—', site: a?.site || '—' })));
  },
};
