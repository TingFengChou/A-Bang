// gov-links（gov_official_link，M16-04d）：去政府辦事的官方入口——每個一列（名稱、網站、怎麼用）、開官網按鈕（L2：先確認）；
// 提醒只從官方網站或 App 進去、不要點簡訊連結。阿幫看不到登入後的內容。
import { h } from '../dom.js';
import { confirmLinkButton } from '../actions.js';

export default {
  title: (d, { t }) => t('links.title'),
  body(d, { host, t }) {
    if (!d.links.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('links.empty', { topic: d.topic })));
    return h('div', { class: 'ab-body' },
      h('ul', { class: 'ab-list' }, d.links.map((l) => h('li', { class: 'ab-gov-office' },
        h('span', { class: 'ab-name' }, l.title),
        h('p', { class: 'ab-sub' }, `${l.site}・${l.how}`),
        h('div', { class: 'ab-actions' }, confirmLinkButton(host, l.url, t('links.confirm', { site: l.site }), t('links.open', { site: l.site })))))),
      h('p', { class: 'ab-sub ab-gov-note' }, t('links.note')));
  },
};
