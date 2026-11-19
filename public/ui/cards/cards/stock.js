// stock（stock_quote）：加權／櫃買指數、個股收盤價與漲跌（台股習慣：漲紅、跌綠，另加 ▲▼ 文字不只靠顏色）、查別檔（host.callTool，並以 setContext 告訴模型正在看哪幾檔）
import { h } from '../dom.js';

const dir = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const arrow = (n) => (n > 0 ? '▲' : n < 0 ? '▼' : '');
const fmt = (n) => (n == null ? '—' : n.toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
const changeText = (c, p) => (c == null ? '—' : `${arrow(c)}${fmt(Math.abs(c))}${p == null ? '' : `（${Math.abs(p).toFixed(2)}%）`}`);
const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '—');

export default {
  title: (_d, { t }) => t('stock.title'),
  body(d, { host, t, rerender, payload }) {
    const ask = async (query, input) => {
      try {
        Object.assign(payload, await host.callTool('stock_quote', { query }));
        // 問阿幫：接下來的追問（「它成交量多少」）讓模型知道使用者在看哪幾檔
        const names = payload.data.quotes.map((q) => `${q.name}（${q.code}）`).join('、');
        if (names) host.setContext?.(t('stock.context', { names }));
        rerender();
      } catch (err) {
        if (!input) return;
        input.setCustomValidity(err.message); input.reportValidity(); input.setCustomValidity('');
      }
    };
    const idx = d.indices.length > 0 && h('div', { class: 'ab-stats' }, d.indices.map((i) => h('div', { class: 'ab-stat' },
      h('span', { class: 'ab-sub' }, t('stock.index', { name: i.name, date: md(i.date) })), h('strong', null, fmt(i.close)),
      h('span', { class: `ab-chg ${dir(i.change)}`, 'aria-label': t(`stock.${dir(i.change)}`, { n: changeText(i.change, i.changePct) }) }, changeText(i.change, i.changePct)))));
    const rows = d.quotes.map((q) => h('li', { class: 'ab-stk' },
      h('div', null,
        h('strong', null, q.name), h('span', { class: 'ab-sub ab-stk-meta' }, `${q.code}・${q.market}・${t('stock.close', { date: md(q.date) })}`),
        q.close != null && h('p', { class: 'ab-sub' }, t('stock.ohlv', { open: fmt(q.open), high: fmt(q.high), low: fmt(q.low), lots: fmt(q.volumeLots) })),
        q.similar && h('p', { class: 'ab-sub' }, t('stock.similar'), ...q.similar.map((s) => h('button', { type: 'button', class: 'ab-stk-alt', onclick: () => ask(s.code) }, `${s.name}（${s.code}）`)))),
      q.close == null
        ? h('span', { class: 'ab-sub' }, t('stock.noTrade'))
        : h('div', { class: 'ab-stk-px' }, h('strong', null, fmt(q.close)), h('span', { class: `ab-chg ${dir(q.change)}`, 'aria-label': t(`stock.${dir(q.change)}`, { n: changeText(q.change, q.changePct) }) }, changeText(q.change, q.changePct)))));
    const input = h('input', { class: 'ab-input', maxlength: '60', placeholder: t('stock.placeholder'), 'aria-label': t('stock.placeholder') });
    const form = host?.callTool && h('form', { class: 'ab-actions', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) ask(input.value.trim(), input); } },
      input, h('button', { type: 'submit', class: 'ab-btn ab-primary' }, t('stock.search')));
    return h('div', { class: 'ab-body' }, idx,
      rows.length > 0 && h('ul', { class: 'ab-list' }, rows),
      d.notFound.length > 0 && h('p', { class: 'ab-sub', role: 'status' }, t('stock.notFound', { q: d.notFound.join('、') })),
      form, h('p', { class: 'ab-foot' }, t('stock.note')));
  },
};
