# ADR-0003：互動卡片採 MCP Apps，渲染程式碼與網頁共用

狀態：已採用，M4 實作

## 背景
希望 tool 結果在 Claude 裡不只是文字，而是可互動的卡片；同時民眾網頁 agent 要顯示一樣的卡片。

## 決策
- 採用 MCP Apps 擴充（`@modelcontextprotocol/ext-apps`）：tool 的 `_meta.ui.resourceUri` 指向 `ui://abang/cards.html`，以 `text/html;profile=mcp-app` 提供單檔 HTML。
- 卡片渲染器放 `public/ui/cards/`，透過注入的 `host` 介面（`callTool`、`ask`、`setContext`、`openLink`、`theme`）與外界溝通。MCP App 與網頁各實作一個 host。
- 網頁 agent 直接渲染卡片（不經 iframe），避免自建 MCP Apps host 的複雜度。

## 影響
- 不支援 MCP Apps 的 client 仍可從 `content` 文字取得完整資訊。
- 卡片不得依賴外部資源（iframe CSP 預設拒絕），全部打包進單檔。
