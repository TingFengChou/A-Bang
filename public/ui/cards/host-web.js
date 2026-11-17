// 網頁 host（CARDS.md §3）：callTool → POST /api/v1/tools/:name；L2 連結先確認再開新分頁。
// MCP Apps 版（host-mcp-app.js）於 M4-04 實作。

/**
 * @param {{ base?: string, ask?: (text: string) => void, setContext?: (text: string) => void, confirm?: (text: string) => boolean }} [opts]
 * @returns {import('./host.js').Host}
 */
export function createWebHost({ base = '', ask, setContext, confirm = (m) => window.confirm(m) } = {}) {
  return {
    kind: 'web', theme: 'light',
    async callTool(name, args) {
      const res = await fetch(`${base}/api/v1/tools/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    },
    ask: ask || (() => {}),
    setContext: setContext || (() => {}),
    openLink(url, opts = {}) {
      if (!/^https:\/\//i.test(url)) return;
      if (opts.confirm && !confirm(`${opts.confirm}\n\n付款在官方網站完成，阿幫不會取得你的付款資料`)) return;
      window.open(url, '_blank', 'noopener');
    },
  };
}
