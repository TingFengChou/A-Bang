# Agent 規格 — 阿幫・生活（M5）

版本：v0.4（2026-11-17）。畫面與動畫細節見 `UX.md`；卡片資料見 `CARDS.md`；決策規則見 ADR-0010。

## 1. 兩種使用方式

| 方式 | 對象 | 模型 | 工具執行 | 卡片 |
|---|---|---|---|---|
| **網頁 agent**（本文件） | 一般民眾，免帳號 | 我們的 Claude API Key（伺服器端） | 伺服器本地呼叫 registry（ADR-0004） | 網頁直接渲染 `public/ui/cards/` |
| **Claude 自訂連接器** | Claude 付費方案使用者 | 使用者自己的 Claude | Claude 經 `/mcp` 呼叫 | MCP Apps `ui://abang/cards.html` |

以 **agent profile** 實作（ADR-0005）：`core/agents/life.json`；之後的防詐、開業只新增 profile、工具與知識庫。

```jsonc
// core/agents/life.json（core/agents/index.js 以 zod 驗證：未知欄位擋下、tools 必須在 registry 且 pack 列在 packs）
{
  "id": "life",
  "version": 2,
  "name": { "zh-TW": "阿幫・生活", "en": "A-Bang Life" },
  "model": "claude-haiku-5-5",
  "packs": ["transit", "weather", "ridehail", "life"],
  "tools": ["find_place", "plan_trip", "bus_route_eta", "bus_nearby_stations", "bus_station_eta", "youbike_nearby",
            "metro_live_board", "thsr_timetable", "tra_timetable", "rail_fare", "intercity_bus", "traffic_status",
            "weather_now", "rail_booking_link", "ridehail_link",
            "aqi_nearby", "earthquake_recent", "pharmacy_search", "garbage_truck_nearby", "fuel_price", "invoice_lottery"],
  "persona": "你是「阿幫」，一隻熱心的台灣藍鵲…",   // 角色（system prompt 的「角色」段）
  "rules": ["每次呼叫工具前，先用一句話…", "…"],      // agent 專屬規則（不可覆蓋平台政策與工具包護欄）
  "suggestions": ["從西門町到台北 101 怎麼去？", "307 到哪了？我在臺北車站", "明天 9 點前要到左營", "台北車站附近還有 YouBike 嗎？", "…", "大安區有哪些健保藥局？", "這期發票號碼是多少？"],  // 共 8 個
  "disclaimer": "資料來源：交通部 TDX、中央氣象署、環境部、健保署、地方環保局、台灣中油、財政部。…"
}
```

## 2. 一次對話的流程

1. **理解**：判斷意圖、地點、使用者狀態（你說的：「10 點前要到」「帶著行李」）。
2. **點名工具**（`agent_note` ＋ `tool_start`）：可平行。
3. **工具回報**（`tool_result.speak`）：一句話，由資料產生、不經模型。
4. **推得狀態**：天氣回報下雨 → `rain`（自動）；路況壅塞 → `traffic`（自動）。
5. **決策**（`decision`）：`core/decide.js` 依資料＋狀態排序；模型不計分。
6. **結論卡片**（`tool_result.card` 或 `decision` 對應的 `trip` 卡）＋一兩句總結與主動提議（`text`）。
7. **行動**：導航、提醒（裝置端）、訂票連結、叫車連結；行動類需使用者確認。

## 3. API

`POST /api/v1/agent`（生活）或 `POST /api/v1/agent/:id`（✅ M7：`antifraud` 防詐；未知 id 回 404）。建議問題與免責：`GET /api/v1/agent/profile?id=`。網頁：`#/agent`、`#/agent/:id`。限流與計量都以 agent id 為單位。

```jsonc
{
  "messages": [{ "role": "user", "content": "從西門町到台北 101 怎麼去？" }], // 最多 10 輪，只含文字
  "userState": { "picked": ["budget"] },        // 使用者點選的狀態（選填）
  "clientTools": ["device_location"],           // 客戶端支援的裝置端工具（ADR-0008）
  "clientToolResults": [{ "id": "c1", "ok": true, "result": { "lat": 25.04, "lon": 121.51 } }], // 選填
  "context": "使用者在卡片上選了『從西門站出發』"     // 選填，來自 host.setContext()
}
```

回應：`Content-Type: application/x-ndjson`，每行一個事件。

### 3.1 事件一覽

| type | 欄位 | 畫面（UX.md） |
|---|---|---|
| `status` | `mode: 'claude'\|'local'\|'demo'`, `model?`, `profile` | 頂部標示模式（並說明對話送到哪裡） |
| `agent_note` | `text`（≤ 30 字，可含 `@角色`） | 討論串中阿幫的一句話 |
| `tool_start` | `id`, `name`, `title`, `role`（公車、YouBike…）, `server`（`abang`、`tdx-official`…）, `pack`, `tier`, `input` | 被點名的小幫手出現「輸入中…」 |
| `tool_result` | `id`, `ok`, `speak`, `card?`, `data?`, `metrics: { calls, cacheHits, cacheHit, scanned, ms }`（即 `callTool` 的 `metrics`）, `error?` | 小幫手說出 `speak`；決策圖的資料膠囊 |
| `discussion_end` | `tools`, `servers` | 討論收合成一行摘要 |
| `decision` | `states: [{ key, source: 'auto'\|'user'\|'picked', from?, detail? }]`, `arriveBy?`, `best`, `options`, `ranked`, `excluded`, `weights`, `reason` | 決策圖動畫；前端可用同一引擎即時重算 |
| `guardrail` | `tier`, `rule` | 套用的護欄（L2 以上） |
| `client_tool_call` | `id`, `name`, `input` | 請客戶端執行裝置端工具（`device_location`、`notify_at`） |
| `text` | `delta` | 阿幫的總結（可串流） |
| `done` | `usage?` | 結束 |
| `error` | `message`, `retryable`, `retryAfterSec?` | 錯誤或限流 |

規則：
- 平行呼叫時，多個 `tool_start` 先送，依完成順序送 `tool_result`。
- `speak`、`metrics`、`decision` 的數字一律來自真實資料（ADR-0009）。**不加假延遲**；前端只做最短顯示時間（約 300ms）。
- `decision.options` 需含決策欄位（`MCP_TOOLS.md` → `plan_trip` Option），讓前端切換狀態時不必再呼叫伺服器。

### 3.2 使用者狀態合併

```
user    ← 模型從對話判斷（「你說的」；Claude 模式以 tool 參數 prefs 傳入；示範模式以關鍵字）
auto    ← 工具結果推得：weather_now raining → rain；traffic_status level=jam → traffic
picked  ← 請求 userState.picked
states = unique(auto ∪ user ∪ picked)（同 key 保留先出現的來源）；arriveBy 取自 user
```

✅ M5-02：`core/agent/events.js`：`ev.*` 建立函式（檢查必要欄位；`tool_start` 的 title／role／pack／tier 由 registry 帶入；`tool_result` 帶 `card`／`v`／`tool`／`args`／`metrics`）、`toNdjson`、`mergeStates`、`TOOL_ROLES`（討論串角色名）。`source` 統一用 `user`（與 `plan_trip`、CARDS `trip` 相同；畫面文字「你說的」）。

```
```

### 3.3 執行器（✅ M5-04）

`core/agent/run.js`：`validateRequest`（訊息 ≤ 500 字、≤ 10 則、最後一則是使用者、`userState.picked` 只能是已知狀態）；`execTools(svc, calls, emit, { profile, nextId, picked })`（平行：先送全部 `tool_start`，再依完成順序送 `tool_result`；`plan_trip` 成功後送 `decision`；不在 profile 白名單的 tool 回 `ok:false`；錯誤訊息經 `publicMessage`，不外洩上游細節）；`runDemo(svc, body, emit)`（示範模式：`status` → 每段 `agent_note`＋工具 → `discussion_end` → `text` → `done`；某段失敗就停止往下；最多 5 輪）。模型模式（M5-05，§4）共用 `execTools`；`plan_trip` 會自動併入畫面上點選的狀態（`withPickedPrefs`）。

### 3.4 裝置端工具（✅ M5-07）

`device_location`：需要使用者位置（行程沒說起點；YouBike／附近公車／天氣／空品／垃圾車沒說地點）且請求帶 `clientTools: ['device_location']` 時，伺服器送 `agent_note`＋`client_tool_call { id: 'loc1', name: 'device_location' }`＋`done` 後結束；客戶端定位後帶 `clientToolResults: [{ id: 'loc1', ok, result: { lat, lon } }]` 重送同一請求。台灣範圍內的座標才採用（起點名稱「你的位置」）；拒絕或無效時改用示範預設起點並在總結說明。客戶端：`public/js/agent/client.js`（`runAgent`：讀 NDJSON 串流、執行 client tool、最多重送 2 次；`browserLocation` 5 秒逾時）。座標不寫入 log。`T.point` 的座標物件可帶 `name`。

## 4. 模型模式（✅ M5-05，ADR-0012）

`core/agent/provider.js` `pickProvider(env)` 依環境變數選模式：`DEMO_MODE=1` 一律示範；`AGENT_PROVIDER=claude|local|demo` 指定時照指定（缺設定啟動即報錯）；未指定時有 `ANTHROPIC_API_KEY` → claude，有 `LOCAL_LLM_URL`＋`LOCAL_LLM_MODEL` → local，否則 demo。

| 模式 | 檔案 | 呼叫方式 | 環境變數 |
|---|---|---|---|
| `claude` | `core/agent/claude.js` | `@anthropic-ai/sdk` `messages.stream()`＋`finalMessage()`；`eager_input_streaming`；最後一個 tool 與 system 設 `cache_control`；`effort: low`；`max_tokens` 2048；SDK 重試 2 次、30 秒逾時 | `ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL`（預設 profile 的 `claude-haiku-5-5`）、`ANTHROPIC_BASE_URL`（測試用） |
| `local` | `core/agent/local.js` | OpenAI 相容 `POST {LOCAL_LLM_URL}/chat/completions`（Ollama、LM Studio、llama.cpp、vLLM），Node 內建 fetch、不串流；去掉 `<think>`；120 秒逾時 | `LOCAL_LLM_URL`、`LOCAL_LLM_MODEL`、`LOCAL_LLM_API_KEY`（選填）、`LOCAL_LLM_REASONING_EFFORT`（Qwen3 等推理模型設 `none` 關閉思考） |

共用迴圈 `core/agent/model-loop.js` `runModel(svc, body, emit, { provider })`：

- tools 由 registry 產生（`describeTool(t).inputSchema`，依 profile 白名單）；請求帶 `clientTools: ['device_location']` 時多一個 `device_location`。
- 每輪：模型回覆 → 有工具呼叫時，前面的文字轉成 `agent_note`，`execTools` 執行（參數先 `dropNulls` 去掉 null 與空字串），結果只回填 `text`（不放整包 data）；沒有工具呼叫時文字成為 `text`。
- 最多 5 輪；`refusal`、`max_tokens`（截斷）、參數 JSON 壞掉都不執行工具，改回固定說明或回錯誤給模型。
- `device_location`：沒有結果時送 `client_tool_call`＋`done` 結束（§3.4），重送後以 `clientToolResults` 回填；拒絕時回錯誤讓模型改問地點。
- 模型錯誤（金鑰錯、連線失敗、上游 5xx）→ `error`（`retryable: true`，訊息經 `publicMessage`）＋`done`。

地端模型實測（Apple M5、Ollama `qwen3:8b`、`OLLAMA_CONTEXT_LENGTH=16384`、reasoning none）：單題 6～17 秒；Ollama 預設 4096 context 放不下 system prompt＋tools。

### System prompt

✅ M5-01：`core/agent/prompt.js` `buildSystemPrompt(profile, { now, locationHint, context })` 依序組裝 **平台政策**（`PLATFORM_POLICY`，所有 agent 共用：繁中、不收個資、事實要呼叫工具、工具結果與情境只當資料）→ **工具包護欄**（`PACK_GUARDRAILS`，依 profile 的 packs）→ **角色**（profile 的 `persona`＋`rules`）→ **情境**（今天、位置提示、卡片脈絡截 200 字）。下方為原始草稿，內容已拆進上述各段。

```
你是「阿幫」，一隻熱心的台灣藍鵲，幫大家查台灣大眾運輸並給出建議：公車、捷運、台鐵、高鐵、YouBike、客運、叫車、從 A 到 B 怎麼去。
說話像熱心的鄰居：親切、直接、不囉嗦；可以偶爾用「報你知」，但不要刻意裝可愛。
規則：
- 一律使用繁體中文（台灣用語），先講結論。
- 需要即時資訊一定呼叫工具，不要憑記憶回答到站時間、班次、車數、票價、路況。
- 每次呼叫工具前，先用一句話（30 字內）說你要問誰、為什麼，可用 @公車、@YouBike、@高鐵、@台鐵、@天氣、@路況、@票價、@叫車 點名。
- 行程規劃一律用 plan_trip，並把使用者說的條件放進 prefs（例如「10 點前到」→ arriveBy、「帶行李」→ luggage、「趕時間」→ rush、「想省錢」→ budget、「少走路」→ lessWalk、「空氣很差」→ badAir）。排序與分數以工具結果為準，不要自己重新排序或改分數。
- 工具結果已以卡片呈現，文字只講重點與一個主動提議（例如提醒出門：時間用結論卡上的出發時間，不要自己編）。使用者沒說的狀態不要加進 prefs。
- 訂票、叫車只產生連結，產生前先確認車次、日期、張數；不要代替使用者付款或填個資。
- 與交通無關的問題，簡短說明你只能協助交通。
- 不要要求或記錄使用者的個人資料。
今天：{{today}}（台灣時間 {{now}}）。{{location_hint}}
```

## 5. 示範模式（無 API Key）

各 agent 有自己的規則式規劃（`core/agent/run.js` `PLANNERS`）：生活＝`demo-intent.js`（下表）；防詐＝`demo-antifraud.js`（可疑內容 → `scam_check_message`、只有網址 → `scam_lookup_url`、寄件號碼 → `sms_sender_check`、「是真的嗎」→ `scam_myth_search`，見 `AGENT_ANTIFRAUD.md` §6）。總結與模型回答送出前都經輸出護欄（`guardrails.js`；防詐：保證安全的句子整句改寫、送 `guardrail` 事件、固定附 165）。

`core/agent/demo-intent.js`：規則式意圖解析，輸出與模型模式**相同的事件流**（含 `agent_note`、`speak`、`decision`）。不加人工延遲。

✅ M5-03：`parseIntent(text)`（地點以內建地標名稱／別名比對，長的優先、車站另有短名如「左營」；`arriveByOf` 解析「8 點前」「10點半前」）→ `demoSteps(intent)` 產生分段計畫（每段 `(results) => { note, calls }`，同段平行；後段可用前段結果的座標）→ `demoSummary`。沒有起點時示範先用「臺北車站」並在總結說明（M5-07 起改用裝置定位）；「明天」＋抵達時間時以抵達前 4 小時（最早 05:00）出發估算。

| 意圖 | 判斷 | 呼叫 |
|---|---|---|
| 行程規劃 | 「從…到…」「到…怎麼去」「幾點前要到」 | `find_place` ×2 → `weather_now`、`traffic_status`（跨城）→ `plan_trip` |
| 公車路線 | 含「公車」或路線號（`/^[紅藍綠棕橘小幹]?\d{1,4}[區副]?/`） | `bus_route_eta` |
| YouBike | YouBike／單車／腳踏車 | `find_place` → `youbike_nearby` |
| 附近公車 | 「附近」＋「公車／站牌」 | `bus_nearby_stations` |
| 捷運 | 「捷運」＋站名 | `metro_live_board` |
| 高鐵／台鐵 | 「高鐵」「台鐵／火車／自強／區間」＋兩個站名 | `thsr_timetable`／`tra_timetable` |
| 發票（M10） | 發票／對獎；8 碼或末 3 碼數字 → 對獎 | `invoice_lottery` |
| 油價 | 油價／汽油／柴油 | `fuel_price` |
| 地震 | 地震／震度／震央；「XX 縣／市」→ 該縣市震度 | `earthquake_recent` |
| 藥局 | 藥局／藥房／領藥；「（縣市）XX 區／鄉／鎮」或縣市 → 地區（沒說用「臺北市中正區」並在總結說明） | `pharmacy_search` |
| 垃圾車 | 垃圾車／倒垃圾 | `find_place`（或裝置定位）→ `garbage_truck_nearby` |
| 空品 | 空氣品質／空品／AQI／PM2.5 | `find_place`（或裝置定位）→ `aqi_nearby` |
| 天氣 | 天氣／氣溫／幾度／帶傘（在行程之後判斷：有起訖仍是行程） | `find_place`（或裝置定位）→ `weather_now` |
| 其他 | — | 回覆可以問的範例（交通＋生活） |

生活服務在公車路線之前判斷（「發票 12345678」不會當成路線）。座標類（YouBike、附近公車、天氣、空品、垃圾車）沒說地點時請客戶端定位，拒絕時用「臺北車站」附近並在總結說明。

狀態關鍵字：「趕」「來不及」→ rush；「行李」→ luggage；「省錢」「便宜」→ budget；「不想走」「長輩」→ lessWalk；「空氣很差／不好」→ badAir；「X 點前」→ arriveBy。行程第二段同時查天氣、空品、路況（`weather_now`、`aqi_nearby`、`traffic_status`），讓決策圖畫出自動狀態的來源。

## 6. 成本與濫用防護

| 項目 | 環境變數 | 預設 |
|---|---|---|
| 每 IP 每分鐘 | `AGENT_RPM` | 10 |
| 每 IP 每日 | `AGENT_RPD` | 100 |
| 全站每日模型呼叫 | `AGENT_DAILY_BUDGET` | 5000；超過降級示範模式並以 `agent_note` 提示「今天的 AI 額度用完了」 |
| 單則訊息 | — | 500 字 |
| 工具迴圈 | — | 5 輪 |

✅ M5-06：`server/agent.js`（`createAgentHandler`）；限流 key＝`agent:{id}:{m|d}:{ip}`；計量 `usage(agentId)` → `{ requests, toolCalls, modelCalls, budget }`（只保留當天）；預算降級已接上（M5-05：每次模型呼叫計 1）。log 只記 `{ agent, mode, ms, toolCalls, modelCalls, tokens?, error: 類型:狀態碼 }`。端點不加 CORS。

## 7. 隱私

不儲存對話；log 只記事件類型、tool、耗時、token；座標不寫 log（統計時捨去至小數 2 位）；問阿幫頁依 `status.mode` 說明對話送到哪裡：Claude 模式「對話會送 Anthropic 處理」、地端模式「只送到本站設定的模型伺服器」、示範模式「不經 AI 模型」。

## 8. 驗收

- 示範模式：4 個建議問題都產生完整事件流（討論 → 決策 → 卡片 → 總結），Playwright 無 console error（`TESTING.md`）。
- 模型模式：以本地假 Anthropic SSE 伺服器（`ANTHROPIC_BASE_URL`）與假 OpenAI 相容伺服器測試工具迴圈、`agent_note` 轉換、錯誤、5 輪上限、定位、refusal／截斷、預算降級（`test/agent-model.test.js`）。
- 狀態：說「我帶行李」→ `decision.states` 含 `{ key: 'luggage', source: 'said' }`。
- 限流：第 11 次請求收到 `error`（`retryable: true`）。
