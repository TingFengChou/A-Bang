// invoice（invoice_lottery）：本期中獎號碼、對獎結果、輸入號碼再對一次（host.callTool）
import { h } from '../dom.js';

const money = (n) => Number(n).toLocaleString('zh-TW');

export default {
  title: (d, { t }) => t('invoice.title', { period: d.period.title }),
  body(d, { host, t, rerender, payload }) {
    const p = d.period;
    const row = (label, nums, note) => h('div', { class: 'ab-inv' }, h('span', { class: 'ab-sub' }, label), h('div', null, nums.map((n) => h('strong', { class: 'ab-invno' }, n))), h('span', { class: 'ab-sub' }, note));
    const c = d.check;
    const result = c && h('div', { class: c.prize ? 'ab-risk low ab-win' : 'ab-risk low', role: 'status' },
      h('strong', null, c.prize ? t('invoice.win', { prize: c.prize, amount: money(c.amount) }) : t('invoice.lose', { n: c.number })), c.note && h('p', { class: 'ab-sub' }, c.note));
    const input = h('input', { class: 'ab-input', inputmode: 'numeric', maxlength: '8', placeholder: t('invoice.placeholder'), 'aria-label': t('invoice.placeholder') });
    const form = host?.callTool && h('form', { class: 'ab-actions', onsubmit: async (e) => {
      e.preventDefault();
      try { Object.assign(payload, await host.callTool('invoice_lottery', { number: input.value.trim(), period: p.period })); rerender(); } catch (err) { input.setCustomValidity(err.message); input.reportValidity(); input.setCustomValidity(''); }
    } }, input, h('button', { type: 'submit', class: 'ab-btn ab-primary' }, t('invoice.check')));
    return h('div', { class: 'ab-body' }, result,
      row(t('invoice.special'), [p.special], t('invoice.specialNote')),
      row(t('invoice.grand'), [p.grand], t('invoice.grandNote')),
      row(t('invoice.first'), p.first, t('invoice.firstNote')),
      form, h('p', { class: 'ab-foot' }, t('invoice.note')));
  },
};
