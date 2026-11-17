# ADR-0004：網頁 agent 在伺服器本地執行 tool 迴圈

狀態：已採用，M5 實作

## 背景
Claude API 可透過 MCP connector 參數直接連遠端 MCP server，也可由應用程式自行處理 tool use。

## 決策
網頁 agent 自行處理 tool-use 迴圈，直接呼叫 registry 的 `run()`，不經 MCP connector。

## 理由
- 少一次網路往返，延遲較低；本機開發不需要公開 URL。
- 能把 `tool_start` / `tool_result` 即時串流給前端做動畫，並直接拿到卡片資料。
- 可在伺服器端控制工具次數上限、預算與錯誤處理。

## 影響
MCP 與網頁 agent 行為一致性靠 ADR-0002 的 registry 保證。
