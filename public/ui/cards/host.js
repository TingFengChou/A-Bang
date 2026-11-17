// host 介面（CARDS.md §3）：卡片只透過它取資料或互動。實作：host-web.js（網頁）、host-mcp-app.js（M4-04，MCP Apps）。

/** @typedef {Object} Host
 * @property {(name: string, args: object) => Promise<object>} callTool  刷新或延伸查詢，回傳 CardPayload
 * @property {(text: string) => void} ask           代使用者提問
 * @property {(text: string) => void} setContext    更新模型脈絡
 * @property {(url: string, opts?: { confirm?: string }) => void} openLink  confirm 有值時先顯示確認視窗（L2）
 * @property {(at: string, text: string) => Promise<boolean>} [remind]
 * @property {'light'} theme
 * @property {'web'|'mcp-app'|'app'} kind
 */
export {};
