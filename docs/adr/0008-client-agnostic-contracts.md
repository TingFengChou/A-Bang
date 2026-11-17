# ADR-0008：多端彈性——卡片資料契約與裝置端工具事件

狀態：已採用（2026-11-17）

## 背景
除了網頁與 Claude，未來會有 iOS / Android App、LINE、內嵌對話框，甚至 Siri 捷徑與 Android 小工具。MCP 是工具的標準介面，本身不綁定前端；但如果卡片只有 HTML、事件協定只考慮網頁，原生 App 就得重做或繞路。

## 決策
1. **卡片資料契約**：每種卡片的 `structuredContent` 定義版本化 JSON Schema（`public/ui/cards/schema/<card>.v1.json`），內容只有資料、不含呈現。HTML 卡片（網頁、MCP Apps、App 的 WebView）與未來的原生畫面都依同一份契約渲染。破壞性變更要升版（v2）並同時支援一段時間。
2. **agent 事件協定預留裝置端工具**：`/api/v1/agent` 的 NDJSON 事件保留
   - `client_tool_call`：`{ id, name, input }`，請客戶端執行（如 `device_location`、`calendar_add`、`notify_at`）
   - `client_tool_result`：客戶端以後續請求回傳 `{ id, ok, result }`
   客戶端在請求中宣告自己支援哪些裝置端工具（`clientTools: [...]`）；網頁先只支援定位。
3. **三種接入方式並存**：agent API（預設）、App 直接當 MCP client 連 `/mcp`（官方有 Swift、Kotlin SDK）、REST（給小工具與系統整合）。
4. **客戶端驗證抽象化**：agent API 的身分驗證做成可替換的中介層（網頁：IP 限流；App：之後加 App Attest / Play Integrity 與裝置權杖）。

## 理由
- 一份核心與工具，多端共用；新增一端只需寫呈現層。
- 裝置能力（定位、提醒）只有手機能做，預留事件可避免日後改協定。

## 影響
- M4 卡片要先寫 schema 再寫渲染；測試以 schema 驗證 fixture。
- M5 事件協定文件與實作包含保留事件（網頁先實作 `device_location`）。
- 原生 App 排在 M6 上線之後再評估；可先用 PWA 包殼上架。
