# 系統架構

版本：v0.4（2026-11-17）　狀態標示：✅ 已完成　🚧 進行中　📝 規格已定、待實作　🔭 下一階段

## 1. 一句話

**一個核心、多個出口、多個 agent。**所有資料存取、工具定義、決策邏輯都在 `core/`；網頁、MCP、App 只是出口；每個 agent（阿幫・生活、阿幫・防詐、阿幫・開業）只是「一組工具＋設定＋護欄」。

## 2. 總覽

```
 使用者端                         出口層                                  核心 core/                                   資料源
┌──────────────────┐   ┌───────────────────────────────┐   ┌─────────────────────────────────────────┐   ┌─────────────────────┐
│ 民眾網頁（PWA）   │──▶│ server/http.js                │   │ tools/      Tool registry ✅            │   │ 交通部 TDX ✅        │
│  對話＋討論串     │   │  /api/v1/*        REST ✅      │──▶│   transit pack（8 tools＋speak）✅       │──▶│  公車・YouBike・軌道  │
│  ＋決策圖＋卡片   │   │  /api/v1/tools/:name ✅        │   │ decide.js   決策引擎 ✅                  │   │  路況・客運 📝        │
├──────────────────┤   │  /api/v1/agent    NDJSON 📝    │   │ agent/      agent 執行環境 📝            │   ├─────────────────────┤
│ Claude／AI agent │──▶│  /mcp、/mcp/:pack 遠端 MCP ✅  │   │   profiles/ life ✅規格 antifraud sme 🔭 │   │ TDX 官方 MCP（外部） │
│  （自訂連接器）   │   ├───────────────────────────────┤   │ services/   交通服務 ✅ ＋ mock ✅        │   │  導訂票・道路事件 📝  │
├──────────────────┤   │ mcp/                          │   │   metro・places・trip・traffic 📝        │   ├─────────────────────┤
│ iOS／Android 🔭   │──▶│  stdio ✅  create-server ✅    │   │ providers/  叫車 adapter（Uber）📝       │   │ 氣象署 📝 165・Uber 🔭│
│ LINE 🔭           │   │  ui://abang/cards.html 📝     │   │ tdx-client.js token・快取 ✅             │   └─────────────────────┘
└──────────────────┘   └───────────────────────────────┘   └─────────────────────────────────────────┘
          ▲                                                   卡片渲染 public/ui/cards/ 📝（網頁與 MCP Apps 共用）
          └──────────── 地圖導航（Google／Apple Maps 深層連結）、叫車 App、官方訂票網站（導訂票）
```

## 3. 目錄與職責

| 路徑 | 狀態 | 職責 | 不可以做 |
|---|---|---|---|
| `core/tdx-client.js` | ✅ | OIDC token 快取（single-flight、提前 5 分換新）、回應快取、401 重試、429 處理 | 解析業務欄位 |
| `core/services/*.js` | ✅ transit／📝 metro、places、trip、traffic、weather、booking | 呼叫 client、正規化成共用格式、輸入容錯 | 知道 HTTP／MCP 存在 |
| `core/services/*-mock.js` | ✅ | 介面相同的示範資料，穩定可重現 | 呼叫外部網路 |
| `core/tools/` | ✅ | Tool registry：`defineTool({ name, title, description, pack, tier, card, input, run, speak })`；`callTool()` 驗證參數並回傳 `{ name, card, mode, data, text, speak }` | 依賴特定 transport |
| `core/decide.js` | ✅ | 決策引擎：依資料＋使用者狀態替方案計分排序、硬限制、理由句（ADR-0010） | 呼叫模型或外部 API |
| `core/agent/` | 📝 | Claude tool-use 迴圈、示範意圖解析、事件串流、使用者狀態合併 | 直接碰 TDX |
| `core/agents/*.json` | 📝 | agent profile（ADR-0005）：system prompt、工具白名單、建議問題、免責、模型 | 寫程式邏輯 |
| `core/providers/` | 📝 | 外部服務 adapter（ADR-0011）：`ridehail/uber.js` 深層連結；`mcp-client.js` 包裝外部 MCP（TDX 官方 MCP） | 直接被 server 呼叫 |
| `core/nav.js` | ✅ | 導航深層連結、步行時間、出發時機（M3-01） | 呼叫外部 API |
| `core/geo.js` | 📝 | WKT 解析（M3-02） | — |
| `core/data/` | 📝 | `landmarks.json` 內建地標 | — |
| `server/http.js` | ✅ | REST、`/api/v1/tools/:name`、遠端 `/mcp`、靜態檔、限流、CORS | 商業邏輯 |
| `server/rate-limit.js` | ✅ | 每 IP 固定視窗限流（之後加 agent id） | — |
| `mcp/create-server.js` | ✅ | 由 registry 註冊 MCP tools（`_meta`：pack、tier、card），回傳 `structuredContent: { card, mode, speak, data }` | 自行定義 tool |
| `mcp/server.js` | ✅ | stdio 入口（`MCP_PACKS` 過濾） | — |
| `public/` | ✅ PWA／📝 agent 頁 | 頁面、路由、收藏；M5 起首頁為對話 | 持有金鑰 |
| `public/ui/cards/` | 📝 | 卡片渲染器（依 `CARDS.md` 契約），網頁與 MCP App bundle 共用 | 直接 fetch（透過 host） |
| `docs/prototypes/` | ✅ | 互動原型（討論串＋決策圖） | 被正式程式 import |

## 4. 一次「阿幫・生活」對話的資料流

```
使用者：「從西門町到台北 101 怎麼去？」
  │
  ▼ POST /api/v1/agent（NDJSON 事件串流）
agent 執行環境（core/agent）
  ├─ 判斷意圖與使用者狀態（模型或示範規則）            → event: agent_note「我請地點、天氣、公車、YouBike 一起看看」
  ├─ 呼叫工具（可平行）callTool(svc, name, args)       → event: tool_start（role、server、pack、tier）
  │     └─ tool.run() → services → tdx-client（快取）    → event: tool_result（speak、card、data、metrics）
  │        └─ tool.speak(data)：一句話，由資料產生、不經模型
  ├─ 由工具結果推得狀態（天氣下雨、路況壅塞）＋你說的＋你選的
  ├─ decide(options, { states, arriveBy })             → event: decision（ranked、excluded、reason）
  ├─ 結論卡片（card = trip / bus-route / timetable…）    → 前端渲染，倒數與位置持續更新
  └─ 一兩句總結＋主動提議（提醒、導航、訂票）              → event: text、done
```

Claude 等外部 client 走 `/mcp` 時，順序相同，只是由 Claude 決定呼叫哪些工具；`structuredContent.speak` 與 `card` 讓支援 MCP Apps 的 client 也能顯示卡片。

## 5. 關鍵設計

### 5.1 Tool registry（ADR-0002）✅

- tool 只定義一次；MCP、REST、網頁 agent 共用 `callTool()`。
- 每個 tool 必有：`pack`（工具包）、`tier`（L1／L2／L3，PLATFORM.md §5.3）、`speak(data)`（討論串的一句話）。
- 輸入以 zod 驗證；錯誤丟 `UserError`（HTTP 400／MCP `isError`）。

### 5.2 決策引擎（ADR-0010）✅

- 比較項目：總時間、等車、走路、費用（比例計分）、淋雨、體力、塞車風險（0–1）。
- 使用者狀態調整權重：趕時間、塞車中、下雨、帶行李、想省錢、少走路；硬限制：抵達時間。
- 狀態來源：**自動判斷**（工具資料）、**你說的**（對話）、**你選的**（點選）。
- 模型不計分；權重調整需更新測試與 ADR。

### 5.3 小幫手討論串＋決策圖（ADR-0009、ADR-0010）📝

- 討論串：阿幫以 @角色 點名工具，工具以 `speak` 一句話回報，標示 tool 與 MCP 來源；完成後收合。
- 決策圖：資料膠囊流入 → 狀態標籤連回資料來源 → 方案連線依分數變粗 → 勝出路徑亮起。
- 互動與時序規格見 `UX.md`；原型 `docs/prototypes/transit-discussion.html`。

### 5.4 互動卡片（ADR-0003、ADR-0008）📝

- 卡片資料契約見 `CARDS.md`（版本化 JSON Schema），網頁直接渲染、MCP Apps 以 `ui://abang/cards.html` 單檔呈現、App 可用 WebView 或原生。
- 卡片透過 `host` 介面互動：`callTool`、`ask`、`setContext`、`openLink`、`theme`。

### 5.5 導航、訂票、叫車 📝

- 導航：所有點位附 `nav`（Google／Apple Maps 深層連結）；「出發時機」由步行時間＋即時到站算出。
- 訂票：TDX 台鐵／高鐵「導訂票」產生具時效的官方訂票連結（需 TDX 權限）；付款在官方網站。
- 叫車：`core/providers/ridehail/` adapter，先 Uber 深層連結；估價待合作。
- 這三類屬 **L2 行動**：產生連結前需使用者確認，不代替使用者付款或填個資。

### 5.6 多端與平台預留（ADR-0007、ADR-0008）

- 卡片契約＋事件協定（含 `client_tool_call`）讓 iOS／Android／LINE 可共用。
- 🧩 預留：tool 的 `pack`／`tier`、英文名稱、卡片字典、agent profile 為 JSON、以 agent id 計量。不提前實作 Builder 或多租戶。

## 6. 快取與額度

| 資料 | TTL |
|---|---|
| Token | 到期前 5 分鐘換新（token endpoint 每 IP 每分鐘 ≤ 20 次） |
| 公車到站、站牌到站、捷運看板 | 20 秒 |
| YouBike 車數 | 30 秒（站點 1 小時） |
| 路況 | 60 秒 📝 |
| 路線、站序、形狀 | 1 小時 |
| 車站清單 | 24 小時 |
| 時刻表、票價 | 10 分鐘 |

單機記憶體快取；多實例（M6）改 Redis。限流：`RATE_LIMIT_API`（預設 120/分）、`RATE_LIMIT_MCP`（60/分）、agent（AGENT.md §6）。

## 7. 安全與隱私

- 金鑰只在伺服器環境變數；前端、MCP 回傳、log 都不得出現。
- 所有 tools 唯讀；行動類（訂票連結、叫車連結）需使用者確認。
- 座標只用於當次查詢；log 只記縣市層級或小數 2 位。
- 不儲存對話內容；統計只記事件類型、tool 名稱、耗時。
- 靜態檔防目錄穿越 ✅；請求 body 上限 64 KB ✅。

## 8. 部署（M6）

單一 Node 程序提供 PWA、REST、`/mcp`、agent；容器化部署 Cloud Run／Zeabur；HTTPS 必須（Claude 自訂連接器要求）。`TRUST_PROXY=1` 時採用 `X-Forwarded-For`。
