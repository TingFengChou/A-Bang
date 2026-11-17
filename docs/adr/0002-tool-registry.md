# ADR-0002：Tool 只定義一次（registry）

狀態：已採用，M2 實作

## 背景
MCP server 與網頁 agent（Claude API tool use）需要同樣的 tools。M0 時 tool 定義寫在 `mcp/server.js`，若網頁 agent 再寫一份，描述與 schema 會逐漸不一致，模型行為也會不同。

## 決策
在 `core/tools/` 以 `defineTool({ name, title, description, input, card, run })` 定義。MCP 由 registry 註冊；Claude API 的 `tools` 由 zod 轉 JSON Schema 產生；REST `/api/v1/tools/:name` 也走同一個 `run()`。

## 影響
- tool 描述是 prompt 的一部分，只需維護一處。
- 三條路徑可用同一組測試比對結果。
