// fuel（fuel_price）：中油汽柴油零售牌價與生效日
import { h } from '../dom.js';

export default {
  title: (_d, { t }) => t('fuel.title'),
  body(d, { t }) {
    return h('div', { class: 'ab-body' },
      h('div', { class: 'ab-stats' }, d.prices.map((p) => h('div', { class: 'ab-stat' }, h('span', { class: 'ab-sub' }, p.name), h('strong', null, p.price.toFixed(1))))),
      h('p', { class: 'ab-sub' }, t('fuel.meta', { date: d.effectiveDate ?? '—', unit: d.prices[0]?.unit || '元/公升' })));
  },
};
