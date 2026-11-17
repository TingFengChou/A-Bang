# ADR-0006：MCP SDK 先維持 v1（`@modelcontextprotocol/sdk`）

狀態：提議，待 Austin 確認（2026-11-17，M2）

## 背景
MCP TypeScript SDK 已有 v2（拆成 `@modelcontextprotocol/server`、`/client` 等套件），而 MCP Apps 的 `@modelcontextprotocol/ext-apps` 2.x 以 v2 為 peer dependency。專案目前使用 v1（`@modelcontextprotocol/sdk` 1.32）。

## 評估
- ext-apps 的伺服器端 helper（`registerAppTool`、`registerAppResource`）只是在 `server.registerTool` / `registerResource` 加上 `_meta.ui.resourceUri` 與 MIME type，v1 的 `McpServer` 同樣可用（已檢查其原始碼）。
- 卡片端（iframe 內的 `App` 類別）是獨立 bundle，不受伺服器 SDK 版本影響。
- v1 的 `StreamableHTTPServerTransport` 可直接接 Node `http` 的 req/res，符合本專案「零框架 HTTP」原則。
- v2 遷移會同時影響 stdio、HTTP、測試，M2 改動面變大。

## 決策（提議）
M2 維持 v1，所有 SDK 呼叫集中在 `mcp/create-server.js` 與 `server/http.js` 的 `/mcp` 區塊，降低日後遷移成本。M4 實作 MCP Apps 時重新評估；若 ext-apps 與 v1 出現不相容，再遷移 v2 並更新本 ADR。

## 影響
- `package.json` 不新增 v2 套件。
- 遷移時只需改 `mcp/create-server.js`、`server/http.js` 的 `/mcp`、`test/mcp.test.js`。
