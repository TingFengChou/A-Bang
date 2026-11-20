// invoice（invoice_lottery）：本期中獎號碼、對獎結果、輸入號碼再對一次（host.callTool）
import { h } from '../dom.js';
import { confetti } from '../confetti.js';

/** 對中的位數：特別獎／特獎／頭獎 8 碼、二～六獎末 7～3 碼；只給末 3 碼時 3 碼 */
const HIT = { 特別獎: 8, 特獎: 8, 頭獎: 8, 二獎: 7, 三獎: 6, 四獎: 5, 五獎: 4, 六獎: 3 };
export const hitDigits = (c) => (c?.prize ? (HIT[c.prize] ?? (c.partial ? 3 : 0)) : 0);

/** 號碼逐位亮起（從最後一碼往前，跟對獎規則一樣），對中的位數停在綠底 */
function digits(number, k) {
  const ds = String(number).split('');
  return h('div', { class: `ab-digits${k ? ' win' : ''}`, 'aria-hidden': 'true' }, ds.map((d, i) => h('span', { class: i >= ds.length - k ? 'hit' : 'miss', style: { '--d': String(ds.length - 1 - i) } }, d)));
}

const money = (n) => Number(n).toLocaleString('zh-TW');

export default {
  title: (d, { t }) => t('invoice.title', { period: d.period.title }),
  body(d, { host, t, rerender, payload }) {
    const p = d.period;
    const row = (label, nums, note) => h('div', { class: 'ab-inv' }, h('span', { class: 'ab-sub' }, label), h('div', null, nums.map((n) => h('strong', { class: 'ab-invno' }, n))), h('span', { class: 'ab-sub' }, note));
    const c = d.check;
    const result = c && h('div', { class: c.prize ? 'ab-risk low ab-win' : 'ab-risk low', role: 'status' },
      digits(c.number, hitDigits(c)),
      h('strong', null, c.prize ? t('invoice.win', { prize: c.prize, amount: money(c.amount) }) : t('invoice.lose', { n: c.number })), c.note && h('p', { class: 'ab-sub' }, c.note));
    // 中獎：號碼亮完再灑紙花（同一次結果只灑一次）
    if (c?.prize && payload._confetti !== c.number) { payload._confetti = c.number; setTimeout(() => confetti(result?.closest('.ab-card') || result), 700); }
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
