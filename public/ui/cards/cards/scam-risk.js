// scam-risk（scam_check_message，M7-04）：風險等級（色彩＋文字）、可疑字句、網址比對、下一步、相關闢謠、規則庫版本。
// L2：不顯示「安全」；低風險固定說「沒有發現已知的詐騙特徵」。不提供任何開啟使用者網址的按鈕（AGENT_ANTIFRAUD.md §1）。
import { h } from '../dom.js';

const ICON = { high: '!', medium: '?', low: '·' };

export default {
  title: (d, { t }) => t('scam.title'),
  body(d, { host, t }) {
    const level = h('div', { class: `ab-risk ${d.level}`, role: 'status' },
      h('span', { class: 'ab-risk-icon', 'aria-hidden': 'true' }, ICON[d.level]),
      h('div', null,
        h('strong', null, t(`scam.level.${d.level}`)),
        h('p', { class: 'ab-sub' }, t(`scam.levelNote.${d.level}`))));
    const findings = d.findings.length > 0 && h('section', { class: 'ab-sec' },
      h('h4', null, t('scam.findings')),
      h('ul', { class: 'ab-list' }, d.findings.map((f) => h('li', { class: 'ab-finding' },
        h('span', { class: 'ab-chip bad' }, f.category),
        h('span', null, f.label),
        h('q', { class: 'ab-excerpt' }, f.excerpt)))));
    const urls = d.urls.length > 0 && h('section', { class: 'ab-sec' },
      h('h4', null, t('scam.urls')),
      h('ul', { class: 'ab-list' }, d.urls.map((u) => h('li', { class: 'ab-row' },
        h('code', { class: 'ab-domain' }, u.domain || u.input),
        h('span', { class: u.listed ? 'ab-chip bad' : 'ab-chip' }, u.listed ? t('scam.listed', { category: u.category || '', month: u.month || '' }) : t('scam.notListed'))))));
    const advice = h('section', { class: 'ab-sec' },
      h('h4', null, t('scam.next')),
      h('ol', { class: 'ab-advice' }, d.advice.map((a) => h('li', null, a))),
      h('div', { class: 'ab-actions' },
        host?.openLink && h('button', { type: 'button', class: 'ab-btn ab-primary', onclick: () => host.openLink('https://165.npa.gov.tw/') }, t('scam.open165')),
        host?.ask && d.level !== 'low' && h('button', { type: 'button', class: 'ab-btn', onclick: () => host.ask(t('scam.askWhat')) }, t('scam.askWhatBtn'))));
    const myths = d.myths.length > 0 && h('section', { class: 'ab-sec' },
      h('h4', null, t('scam.myths')),
      h('ul', { class: 'ab-list' }, d.myths.map((m) => h('li', { class: 'ab-sub' }, `${m.title}（${m.date}）`))));
    return h('div', { class: 'ab-body' }, level, findings, urls, advice, myths,
      h('p', { class: 'ab-foot' }, t(d.reviewed ? 'scam.rules' : 'scam.rulesUnreviewed', { v: d.rulesVersion })));
  },
};
