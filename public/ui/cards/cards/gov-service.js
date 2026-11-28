// gov-service（gov_service_info，M16-04a）：去政府辦事要帶什麼——應備證件、怎麼辦、要幾天、官方網頁；資料更新日期與「以機關公告為準」
import { h, safeUrl } from '../dom.js';

const CH = ['counter', 'online', 'other'];
const SHOW_DOCS = 3; // 先列 3 條、每條最多 3 行（設計審查：原本一張卡約三個螢幕高）

function itemBlock(s, { host, t, state, rerender }, first) {
  const open = state.open?.[s.id] ?? first; // 第一項預設展開
  const allDocs = state.allDocs?.[s.id];
  const docs = allDocs ? s.docs : s.docs.slice(0, SHOW_DOCS);
  // 出門前檢核表（T-CHECKLIST，Antigravity 第七輪）：host 支援時（網頁、App）應備文件可以勾，記在手機；Claude 裡照舊列清單
  const checks = Boolean(host?.checklist && s.id);
  const done = checks ? host.checklist.get(s.id) : new Set();
  const link = (url, label, primary = false) => { const u = safeUrl(url); return u && host?.openLink && h('button', { type: 'button', class: primary ? 'ab-btn ab-primary' : 'ab-btn', onclick: (e) => { e.stopPropagation(); host.openLink(u); } }, label); };
  return h('div', { class: 'ab-option ab-gov' }, // 不用「建議方案」的框（那是行程卡的意思）
    h('button', { type: 'button', class: 'ab-gov-head', 'aria-expanded': String(!!open), onclick: () => { state.open = { ...(state.open || {}), [s.id]: !open }; rerender(); } },
      h('span', { class: 'ab-name' }, h('span', { class: 'ab-gov-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'), s.title),
      h('span', { class: 'ab-chips' }, s.channels.filter((c) => CH.includes(c)).map((c) => h('span', { class: c === 'online' ? 'ab-chip ok' : 'ab-chip' }, t(`gov.ch.${c}`))))),
    open && h('div', { class: 'ab-gov-body' },
      s.days && h('p', { class: 'ab-sub' }, t('gov.days', { days: s.days })),
      h('div', { class: 'ab-actions' }, // 官方入口放在條文前面（先給入口再給細節）
        link(s.onlineUrl, t('gov.online'), true),
        link(s.url, t('gov.page')),
        link(s.formUrl, t('gov.form'))),
      h('h4', {}, t('gov.docs')),
      checks && s.docs.length > 0 && h('p', { class: 'ab-sub ab-gov-ready', role: 'status' }, done.size >= s.docs.length ? t('gov.readyAll') : t('gov.ready', { n: done.size, total: s.docs.length })),
      s.docs.length ? h('ul', { class: allDocs ? 'ab-gov-docs' : 'ab-gov-docs clamp' }, docs.map((x, i) => h('li', {}, checks
        ? h('label', { class: 'ab-gov-check' }, h('input', { type: 'checkbox', ...(done.has(i) && { checked: '' }), onchange: (e) => { const d = new Set(done); if (e.target.checked) d.add(i); else d.delete(i); host.checklist.set(s.id, d); rerender(); } }), h('span', {}, x))
        : x))) : h('p', { class: 'ab-empty' }, t('gov.noDocs')),
      !allDocs && (s.docs.length > SHOW_DOCS || s.docs.some((x) => x.length > 60)) && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.allDocs = { ...(state.allDocs || {}), [s.id]: true }; rerender(); } }, s.docs.length > SHOW_DOCS ? t('gov.moreDocs', { n: s.docs.length - SHOW_DOCS }) : t('gov.fullDocs')),
      s.contact && h('p', { class: 'ab-sub' }, t('gov.contact', { contact: s.contact })),
      h('p', { class: 'ab-sub ab-gov-note' }, s.updated ? t('gov.updated', { date: s.updated }) : t('gov.noDate'))));
}

export default {
  title: (d, { t }) => t('gov.title', { query: d.query }),
  body(d, ctx) {
    const { t } = ctx;
    if (!d.items.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('gov.empty', { query: d.query })));
    return h('div', { class: 'ab-body' },
      d.items.map((s, i) => itemBlock(s, ctx, i === 0)),
      h('p', { class: 'ab-sub ab-gov-note' }, t('gov.source')));
  },
};
