// host 介面（CARDS.md §3）：卡片只透過它取資料或互動。實作：host-web.js（網頁）、host-mcp-app.js（M4-04，MCP Apps）。

/** @typedef {Object} Host
 * @property {(name: string, args: object) => Promise<object>} callTool  刷新或延伸查詢，回傳 CardPayload
 * @property {(text: string) => void} ask           代使用者提問
 * @property {(text: string) => void} setContext    更新模型脈絡
 * @property {(url: string, opts?: { confirm?: string }) => void} openLink  confirm 有值時先顯示確認視窗（L2）
 * @property {(at: string, text: string) => Promise<boolean>} [remind]
 * @property {(w: { city: string, routeName: string, stop: string, direction?: number, minutes: number }) => Promise<boolean>} [watchArrival]  公車到站前 N 分提醒（L-14）
 * @property {() => void} [unwatchArrival]
 * @property {() => ({ city: string, routeName: string, stop: string, minutes: number } | null)} [arrivalWatch]
 * @property {boolean} [background]  提醒在 App 關著時也會響（手機 App 有通知權限才是 true；沒有這個屬性＝只有開著時）
 * @property {() => 'whenAlways'|'whenOpenPage'|'whenNoPermission'} [arrivalNote]  設定提醒後的說明文字鍵（i18n busRoute.*）；沒有時用 whenOpenPage
 * @property {(hash: string) => void} [navigate]  開 App 內頁面（網頁 host 才有）
 * @property {'light'} theme
 * @property {'web'|'mcp-app'|'app'} kind
 */
export {};
