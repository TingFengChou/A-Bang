// quake（earthquake_recent）：最近地震（時間、規模、深度、震央、最大震度、指定縣市震度）、氣象署報告連結
import { h, safeUrl } from '../dom.js';

const when = (iso) => String(iso).slice(5, 16).replace('T', ' ');
/** 震度分色：1–2 灰、3–4 橘、5 以上紅（「5弱」「6強」取數字） */
export const intensityLevel = (i) => { const n = parseInt(String(i ?? ''), 10); return !Number.isFinite(n) ? '' : n >= 5 ? 'hi' : n >= 3 ? 'mid' : 'lo'; };

export default {
  refreshSec: 300,
  title: (d, { t }) => (d.county ? t('quake.titleCounty', { county: d.county }) : t('quake.title')),
  body(d, { host, t }) {
    if (!d.quakes.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('quake.empty')));
    return h('div', { class: 'ab-body' }, h('ul', { class: 'ab-list' }, d.quakes.map((q) => h('li', { class: 'ab-quake' },
      h('div', { class: 'ab-row' },
        h('strong', { class: 'ab-mag' }, `M${q.magnitude?.toFixed(1) ?? '—'}`),
        h('span', { class: 'ab-name' }, q.location.replace(/\s*\(.*\)/, '')),
        h('span', { class: `ab-chip ab-int ${intensityLevel(q.maxIntensity)}` }, t('quake.max', { i: q.maxIntensity ?? '—' }))),
      h('p', { class: 'ab-sub' }, t('quake.meta', { time: when(q.time), depth: q.depthKm ?? '—', kind: t(`quake.kind.${q.kind}`) }), d.county ? ` ・${d.county} ${q.countyIntensity ?? t('quake.none')}` : ''),
      safeUrl(q.report) && host?.openLink && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => host.openLink(q.report) }, t('quake.report'))))));
  },
};
