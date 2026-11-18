// MCP Apps 卡片入口（M4-04／05，ADR-0003）：打包成 dist/cards.html（scripts/build-cards.js），
// 由 MCP 資源 ui://abang/cards.html 提供。host 送來 tool 結果 → 依 structuredContent 渲染同一份卡片程式。
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { renderCard, t } from './index.js';
import { createMcpAppHost, payloadOf } from './host-mcp-app.js';
import { h } from './dom.js';

const root = document.getElementById('app');
const app = new App({ name: 'abang-cards', version: '1.0.0' }, {}, { autoResize: true });
const host = createMcpAppHost(app, { root: document.body });
let view = null;
let shown = null; // 目前卡片種類

const message = (cls, text) => { view?.destroy(); view = null; shown = null; root.replaceChildren(h('p', { class: cls }, text)); };

app.ontoolinput = () => { if (!view) message('ab-empty', t('common.loading')); };
app.ontoolresult = (result) => {
  let p;
  try { p = payloadOf(result); } catch (e) { message('ab-fail', e.message); return; }
  if (typeof p.card !== 'string') { message('ab-empty', t('mcpApp.noCard')); return; }
  if (view && shown === p.card) { view.update(p); return; }
  view?.destroy();
  try {
    view = renderCard(root, p, host);
    shown = p.card;
  } catch { message('ab-fail', t('mcpApp.failed')); } // 不認得的卡片種類（伺服器較新）→ 看文字結果
};
app.ontoolcancelled = () => { if (!view) message('ab-empty', t('mcpApp.cancelled')); };
app.onteardown = async () => { view?.destroy(); view = null; return {}; };

app.connect(new PostMessageTransport(window.parent, window.parent)).catch(() => message('ab-fail', t('mcpApp.failed')));
