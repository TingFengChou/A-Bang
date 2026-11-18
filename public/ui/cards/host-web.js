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
    /**
     * 裝置端提醒（UX.md §6）：今天 HH:mm（裝置時間）以系統通知提醒；需使用者允許通知、且頁面保持開啟。
     * @returns {Promise<boolean>} 是否設定成功
     */
    async remind(at, text) {
      if (typeof Notification === 'undefined') return false;
      const [h, m] = String(at).split(':').map(Number);
      const when = new Date(); when.setHours(h, m, 0, 0);
      const delay = when.getTime() - Date.now();
      if (!(delay > 0 && delay < 12 * 3600e3)) return false;
      const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (perm !== 'granted') return false;
      setTimeout(() => { try { new Notification('阿幫提醒', { body: text, icon: '/icons/icon.svg' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ } }, delay);
      return true;
    },
    openLink(url, opts = {}) {
      if (!/^https:\/\//i.test(url)) return;
      // 確認文字由 tool 提供（訂票、叫車各自說明付款在哪裡完成）；這裡不再自行加句子
      if (opts.confirm && !confirm(opts.confirm)) return;
      window.open(url, '_blank', 'noopener');
    },
  };
}
