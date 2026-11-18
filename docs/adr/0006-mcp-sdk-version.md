# ADR-0006：MCP SDK 先維持 v1（`@modelcontextprotocol/sdk`）

狀態：已採用（2026-11-17 提議；2026-11-18 M4 重新評估後維持 v1）

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

## M4 重新評估（2026-11-18）
- `@modelcontextprotocol/ext-apps` 2.x 的 peer dependency 是 SDK v2（`@modelcontextprotocol/core`、`/client` 必裝）；1.7.x 的 peer 是 v1（`@modelcontextprotocol/sdk ^1.29`），功能（`App`、`AppBridge`、`PostMessageTransport`、`_meta.ui.resourceUri`）足夠本專案使用。
- 採用 ext-apps **1.7.5（devDependency）**：只打包進 `dist/cards.html`（入口 `public/ui/cards/mcp-app.js`，用 `app-with-deps` 預打包版，約 394 KB）與 E2E 的 AppBridge 測試 host；伺服器端不 import ext-apps，`_meta.ui.resourceUri` 與 `registerResource` 直接用 v1 `McpServer`。
- 維持 SDK v1。日後要用只在 ext-apps 2.x 才有的功能時，再遷移 v2 並新增 ADR。
