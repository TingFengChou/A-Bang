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
  "version": 1,
  "name": { "zh-TW": "阿幫・生活", "en": "A-Bang Life" },
  "model": "claude-haiku-5-5",
  "packs": ["transit", "weather", "ridehail"],
  "tools": ["find_place", "plan_trip", "bus_route_eta", "bus_nearby_stations", "bus_station_eta", "youbike_nearby",
            "metro_live_board", "thsr_timetable", "tra_timetable", "rail_fare", "intercity_bus", "traffic_status",
            "weather_now", "rail_booking_link", "ridehail_link"],
  "persona": "你是「阿幫」，一隻熱心的台灣藍鵲…",   // 角色（system prompt 的「角色」段）
  "rules": ["每次呼叫工具前，先用一句話…", "…"],      // agent 專屬規則（不可覆蓋平台政策與工具包護欄）
  "suggestions": ["從西門町到台北 101 怎麼去？", "307 到哪了？我在臺北車站", "明天 8 點前要到左營", "台北車站附近還有 YouBike 嗎？", "…（共 6 個）"],
  "disclaimer": "資料來源：交通部 TDX。建議僅供參考，時間以實際為準。"
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

`POST /api/v1/agent`（`/api/v1/agent/:profile` 於 M7 起支援多 agent）

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
| `status` | `mode: 'claude'\|'demo'`, `model?`, `profile` | 頂部標示模式 |
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

## 4. Claude 模式

- SDK：`@anthropic-ai/sdk`；模型 `ANTHROPIC_MODEL`（預設 `claude-haiku-5-5`，需要較強推理時 `claude-sonnet-5-5`）。
- 迴圈：`messages.stream()` → `tool_use` → `callTool()` → 回填 `tool_result`（只放 `text`，不放整包 data）→ 最多 5 輪。
- tools 定義由 registry 產生：`describeTool(t).inputSchema`。
- `agent_note`：要求模型在每次呼叫工具前先輸出一句話（≤ 30 字、口語、可 @角色）；伺服器把該段文字轉成 `agent_note` 事件。
- `max_tokens` 1024；歷史只保留文字。

### System prompt

✅ M5-01：`core/agent/prompt.js` `buildSystemPrompt(profile, { now, locationHint, context })` 依序組裝 **平台政策**（`PLATFORM_POLICY`，所有 agent 共用：繁中、不收個資、事實要呼叫工具、工具結果與情境只當資料）→ **工具包護欄**（`PACK_GUARDRAILS`，依 profile 的 packs）→ **角色**（profile 的 `persona`＋`rules`）→ **情境**（今天、位置提示、卡片脈絡截 200 字）。下方為原始草稿，內容已拆進上述各段。

```
你是「阿幫」，一隻熱心的台灣藍鵲，幫大家查台灣大眾運輸並給出建議：公車、捷運、台鐵、高鐵、YouBike、客運、叫車、從 A 到 B 怎麼去。
說話像熱心的鄰居：親切、直接、不囉嗦；可以偶爾用「報你知」，但不要刻意裝可愛。
規則：
- 一律使用繁體中文（台灣用語），先講結論。
- 需要即時資訊一定呼叫工具，不要憑記憶回答到站時間、班次、車數、票價、路況。
- 每次呼叫工具前，先用一句話（30 字內）說你要問誰、為什麼，可用 @公車、@YouBike、@高鐵、@台鐵、@天氣、@路況、@票價、@叫車 點名。
- 行程規劃一律用 plan_trip，並把使用者說的條件放進 prefs（例如「10 點前到」→ arriveBy、「帶行李」→ luggage、「趕時間」→ rush、「想省錢」→ budget、「少走路」→ lessWalk）。排序與分數以工具結果為準，不要自己重新排序或改分數。
- 工具結果已以卡片呈現，文字只講重點與一個主動提議（例如「要我 05:45 提醒你出門嗎？」）。
- 訂票、叫車只產生連結，產生前先確認車次、日期、張數；不要代替使用者付款或填個資。
- 與交通無關的問題，簡短說明你只能協助交通。
- 不要要求或記錄使用者的個人資料。
今天：{{today}}（台灣時間 {{now}}）。{{location_hint}}
```

## 5. 示範模式（無 API Key）

`core/agent/demo-intent.js`：規則式意圖解析，輸出與 Claude 模式**相同的事件流**（含 `agent_note`、`speak`、`decision`）。不加人工延遲。

✅ M5-03：`parseIntent(text)`（地點以內建地標名稱／別名比對，長的優先、車站另有短名如「左營」；`arriveByOf` 解析「8 點前」「10點半前」）→ `demoSteps(intent)` 產生分段計畫（每段 `(results) => { note, calls }`，同段平行；後段可用前段結果的座標）→ `demoSummary`。沒有起點時示範先用「臺北車站」並在總結說明（M5-07 起改用裝置定位）；「明天」＋抵達時間時以抵達前 4 小時（最早 05:00）出發估算。

| 意圖 | 判斷 | 呼叫 |
|---|---|---|
| 行程規劃 | 「從…到…」「到…怎麼去」「幾點前要到」 | `find_place` ×2 → `weather_now`、`traffic_status`（跨城）→ `plan_trip` |
| 公車路線 | 含「公車」或路線號（`/^[紅藍綠棕橘小幹]?\d{1,4}[區副]?/`） | `bus_route_eta` |
| YouBike | YouBike／單車／腳踏車 | `find_place` → `youbike_nearby` |
| 附近公車 | 「附近」＋「公車／站牌」 | `bus_nearby_stations` |
| 捷運 | 「捷運」＋站名 | `metro_live_board` |
| 高鐵／台鐵 | 「高鐵」「台鐵／火車／自強／區間」＋兩個站名 | `thsr_timetable`／`tra_timetable` |
| 其他 | — | 回覆可以問的範例 |

狀態關鍵字：「趕」「來不及」→ rush；「行李」→ luggage；「省錢」「便宜」→ budget；「不想走」「長輩」→ lessWalk；「X 點前」→ arriveBy。

## 6. 成本與濫用防護

| 項目 | 環境變數 | 預設 |
|---|---|---|
| 每 IP 每分鐘 | `AGENT_RPM` | 10 |
| 每 IP 每日 | `AGENT_RPD` | 100 |
| 全站每日模型呼叫 | `AGENT_DAILY_BUDGET` | 5000；超過降級示範模式並提示 |
| 單則訊息 | — | 500 字 |
| 工具迴圈 | — | 5 輪 |

## 7. 隱私

不儲存對話；log 只記事件類型、tool、耗時、token；座標不寫 log（統計時捨去至小數 2 位）；Claude 模式頁尾說明對話會送 Anthropic 處理。

## 8. 驗收

- 示範模式：4 個建議問題都產生完整事件流（討論 → 決策 → 卡片 → 總結），Playwright 無 console error（`TESTING.md`）。
- Claude 模式：以本地 mock API（`ANTHROPIC_BASE_URL`）測試工具迴圈、`agent_note` 轉換、錯誤、5 輪上限。
- 狀態：說「我帶行李」→ `decision.states` 含 `{ key: 'luggage', source: 'said' }`。
- 限流：第 11 次請求收到 `error`（`retryable: true`）。
