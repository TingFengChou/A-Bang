# ADR-0012：網頁 agent 的模型可選 Claude 或地端模型

狀態：已採用（2026-11-18，Austin 確認「Claude + 地端兩者都做」）・M5-05

## 背景
網頁 agent（ADR-0004）原本只規劃 Claude API。Claude API 依 token 計費；開發、展示或不想付費時，希望能用自己機器上的開放權重模型（例如以 Ollama、LM Studio、llama.cpp 執行）。
阿幫的模型只負責判斷狀態、選工具、轉述（ADR-0010）；數字來自 `speak()` 與 `decide.js`（ADR-0009），所以較小的模型也不會捏造班次或分數，最差是聽不懂或選錯工具。

## 決策
1. 模型以 **provider** 抽象，三種模式共用同一套事件流與 `execTools`：
   - `claude`：官方 `@anthropic-ai/sdk`，`messages.stream()` ＋ `finalMessage()` 的手動迴圈（`core/agent/claude.js`）。
   - `local`：**OpenAI 相容** `POST {LOCAL_LLM_URL}/chat/completions`（Ollama、LM Studio、llama.cpp、vLLM 都提供），以 Node 內建 `fetch` 呼叫，不新增依賴（`core/agent/local.js`）。
   - `demo`：規則式（不變）。
2. 共用迴圈 `core/agent/model-loop.js`：模型在呼叫工具前的文字 → `agent_note`；沒有工具呼叫的那輪文字 → `text`；最多 5 輪工具。
3. 模式選擇（`core/agent/provider.js`）：`AGENT_PROVIDER=claude|local|demo` 指定；未指定時 `DEMO_MODE=1` → demo，有 `ANTHROPIC_API_KEY` → claude，有 `LOCAL_LLM_URL`＋`LOCAL_LLM_MODEL` → local，否則 demo。每日模型呼叫超過 `AGENT_DAILY_BUDGET` 時降級示範模式。
4. 事件 `status.mode` 增加 `'local'`。

## 不採用
- 只做地端：無法給大眾同時使用（一台機器同時只能服務一兩人）。
- 用 OpenAI 相容端點呼叫 Claude：Claude 一律用官方 SDK。
- 在網頁直接呼叫模型：金鑰只在伺服器（架構規則 4），也無法控管預算。

## 影響
- 新增依賴 `@anthropic-ai/sdk`（Austin 已同意）。
- ADR-0002「Claude API 的 tools 由 zod 轉 JSON Schema」同樣用於地端模型的 `tools[].function.parameters`。
- ADR-0004 的本地 tool 迴圈不變，改由 provider 呼叫模型。
- 隱私：claude 模式的對話與工具參數（含使用者同意分享的座標）會送 Anthropic；local 模式只送到 `LOCAL_LLM_URL`。
