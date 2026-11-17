# ADR-0005：多 agent 共用平台（agent profile）

狀態：已採用方向，M7 實作

## 背景
除了生活（交通）agent，規劃中還有反詐騙 agent 與中小企業申辦 agent。三者的資料、風險與護欄不同，但核心、卡片、MCP 出口、限流、事件串流都相同。

## 決策
- 每個 agent 以設定檔定義：`core/agents/<id>.js` → `{ id, name, systemPrompt, tools: [...], suggestions, disclaimer, model }`。
- tool registry 為全域；agent 只宣告可用的 tools 白名單。
- 出口依 agent 分流：網頁 `/agent/:id`、API `/api/v1/agent/:id`、MCP `/mcp/:id`。
- 各 agent 的知識庫（如詐騙特徵規則、申辦清單）以版本化 JSON 存在 `core/data/`，需人工審核欄位（審核人、日期）。

## 影響
- M5 實作網頁 agent 時，就以「單一 profile（life）」的形式設計，避免 M7 重構。
- 新 agent 的工作量集中在資料與護欄，而非平台。
