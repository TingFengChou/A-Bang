// MCP Apps host（M4-04，CARDS.md §3、ADR-0003）：卡片在 Claude 等 MCP Apps host 的 iframe 裡，經 ext-apps 的 App 與 host 溝通。
// 不 import ext-apps：由入口（mcp-app.js）傳入已建立的 App，這裡只做介面轉接（方便測試、打包時才帶 SDK）。
// iframe 沙箱常不允許 window.confirm／window.open：L2 確認與「無法開啟時複製連結」都在卡片內呈現。
import { h, safeUrl } from './dom.js';
import { t } from './i18n/index.js';

/** CallToolResult → structuredContent（有卡片的 tool 即 CardPayload；rail_booking_link 等只有 data）；isError 或沒有結構化資料時丟錯（訊息用 tool 的文字） */
export function payloadOf(result) {
  const text = (result?.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
  if (result?.isError) throw new Error(text || t('mcpApp.failed'));
  const p = result?.structuredContent;
  if (!p || typeof p !== 'object') throw new Error(text || t('mcpApp.noCard'));
  return p;
}

/**
 * @param {object} app ext-apps 的 App（已設定 handler；connect 前後皆可建立）
 * @param {{ root?: HTMLElement, confirm?: (text: string) => Promise<boolean> }} [opts]
 *   root：確認框與連結框要放的位置；confirm：測試注入
 * @returns {import('./host.js').Host}
 */
export function createMcpAppHost(app, { root = document.body, confirm } = {}) {
  const caps = () => app.getHostCapabilities?.() || {};
  const ask = confirm || ((text) => confirmBox(root, text));
  return {
    kind: 'mcp-app', theme: 'light',
    async callTool(name, args) {
      return payloadOf(await app.callServerTool({ name, arguments: args || {} }));
    },
    ask(text) {
      if (!caps().message) return; // host 不支援代使用者發訊息
      app.sendMessage({ role: 'user', content: [{ type: 'text', text: String(text) }] }).catch(() => {});
    },
    setContext(text) {
      if (!caps().updateModelContext) return;
      app.updateModelContext({ content: [{ type: 'text', text: String(text) }] }).catch(() => {});
    },
    async openLink(url, opts = {}) {
      const u = safeUrl(url);
      if (!u) return;
      if (opts.confirm && !(await ask(opts.confirm))) return;
      if (caps().openLinks) {
        try {
          const r = await app.openLink({ url: u });
          if (!r?.isError) return;
        } catch { /* host 拒絕 → 改顯示連結 */ }
      }
      linkBox(root, u);
    },
  };
}

/** 卡片內的 L2 確認框（role=alertdialog）；回傳使用者是否按「前往官方網站」 */
export function confirmBox(root, text) {
  root.querySelector('.ab-confirm')?.cancel?.(); // 同時只留一個確認框；舊的視為取消
  return new Promise((resolve) => {
    const done = (ok) => { box.remove(); resolve(ok); };
    const go = h('button', { type: 'button', class: 'ab-btn ab-primary', onclick: () => done(true) }, t('confirm.go'));
    const box = h('div', { class: 'ab-confirm', role: 'alertdialog', 'aria-modal': 'false', 'aria-label': t('confirm.title') },
      h('p', { class: 'ab-confirm-text' }, text),
      h('div', { class: 'ab-actions' }, go, h('button', { type: 'button', class: 'ab-btn', onclick: () => done(false) }, t('confirm.cancel'))));
    box.cancel = () => done(false);
    root.append(box);
    go.focus();
  });
}

/** host 無法開啟連結時：顯示網址與「複製連結」，使用者自行到瀏覽器開啟 */
export function linkBox(root, url) {
  root.querySelector('.ab-linkbox')?.remove();
  const field = h('input', { class: 'ab-linkurl', type: 'text', readonly: true, value: url, 'aria-label': t('mcpApp.linkLabel') });
  const copy = h('button', {
    type: 'button', class: 'ab-btn',
    onclick: async () => {
      field.select();
      try { await navigator.clipboard.writeText(url); copy.textContent = t('common.copied'); } catch { /* 剪貼簿被擋：文字已選取，可手動複製 */ }
    },
  }, t('common.copyLink'));
  root.append(h('div', { class: 'ab-linkbox', role: 'status' },
    h('p', null, t('mcpApp.openHint')), field,
    h('div', { class: 'ab-actions' }, copy, h('button', { type: 'button', class: 'ab-btn ab-link', onclick: (e) => e.currentTarget.closest('.ab-linkbox')?.remove() }, t('confirm.cancel')))));
}
