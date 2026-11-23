// metro-route（metro_route）：捷運怎麼坐——每一段坐哪條線、往哪、幾站，轉乘站；總時間（估算）、票價、第一段下一班
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const isEn = (locale) => String(locale || '').startsWith('en');
const pick = (en, zh, eng) => (en && eng) || zh;

/** 往哪：一般線「往 南港展覽館」；環狀線（高雄輕軌，終點都是籬仔內）說下一站 */
export function towardText(l, t, en) {
  return l.toward ? t('route.toward', { dest: pick(en, l.toward, l.towardEn) }) : t('route.nextStop', { stop: pick(en, l.next, l.nextEn) });
}

/** 第一段的下一班：「下一班約 3 分」／時刻表「約 3 分（時刻表）」／台中捷運「約每 9 分一班」 */
export function nextText(n, t) {
  if (!n) return null;
  if (n.headway) return n.headway.max > n.headway.min ? t('metro.headwayRange', { min: n.headway.min, max: n.headway.max }) : t('metro.headway', { min: n.headway.min });
  if (n.etaMin == null) return null;
  return n.etaMin <= 1 ? t(n.scheduled ? 'route.nextSoonPlanned' : 'route.nextSoon') : t(n.scheduled ? 'route.nextPlanned' : 'route.next', { min: n.etaMin });
}

export default {
  title: (d, { t, locale }) => t('route.title', { from: pick(isEn(locale), d.from, d.fromEn), to: pick(isEn(locale), d.to, d.toEn) }),
  /** 播報：第一段怎麼坐＋要不要轉乘 */
  announce: (d, { t, locale }) => {
    const en = isEn(locale), l = d.legs?.[0];
    if (!l) return null;
    return [`${pick(en, l.line, l.lineEn)} ${towardText(l, t, en)}`, d.transfers ? t('route.transfers', { n: d.transfers }) : t('route.direct')].join(en ? '; ' : '；');
  },
  body(d, { host, t, locale }) {
    const en = isEn(locale);
    const chips = h('div', { class: 'ab-chips' },
      h('span', { class: 'ab-chip' }, t('route.minutes', { n: d.minutes })),
      h('span', { class: 'ab-chip' }, d.transfers ? t('route.transfers', { n: d.transfers }) : t('route.direct')),
      d.fare != null && h('span', { class: 'ab-chip' }, t('route.fare', { n: d.fare })));
    const items = [];
    (d.legs || []).forEach((l, i) => {
      if (i) {
        const prev = d.legs[i - 1];
        items.push(h('li', { class: 'ab-route-xfer' }, prev.system !== l.system ? t('route.xferSystem', { stop: pick(en, l.from, l.fromEn) }) : t('route.xfer', { stop: pick(en, l.from, l.fromEn) })));
      }
      const nx = i === 0 && nextText(d.next, t);
      items.push(h('li', { class: 'ab-item' },
        h('div', { class: 'ab-row' },
          h('span', { class: 'ab-line', style: l.color ? { borderColor: l.color } : null }, pick(en, l.line, l.lineEn)),
          h('span', { class: 'ab-name' }, towardText(l, t, en)),
          h('span', { class: 'ab-eta planned' }, t('route.stops', { n: l.stops }))),
        h('div', { class: 'ab-sub' }, `${pick(en, l.from, l.fromEn)} → ${pick(en, l.to, l.toEn)}`, nx && h('b', { class: 'ab-next' }, ` · ${nx}`))));
    });
    const notes = [pick(en, d.note, d.noteEn), d.fareNote && pick(en, d.fareNote, d.fareNoteEn)].filter(Boolean);
    return h('div', { class: 'ab-body' }, chips, h('ul', { class: 'ab-list ab-route-legs' }, items),
      notes.map((n) => h('p', { class: 'ab-empty' }, n)),
      h('div', { class: 'ab-actions' }, navButton(host, d.nav)));
  },
};
