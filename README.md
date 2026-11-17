# 阿幫（A-Bang）— 用台灣公共資料幫你辦事的 AI 助手

阿幫是一隻熱心的台灣藍鵲。第一階段專注**大眾交通**：公車、捷運、YouBike、台鐵、高鐵、從 A 到 B 怎麼去。

- **MCP tools**：Claude 等 AI agent 可透過遠端連接器（`/mcp`）或本機（stdio）直接查即時交通。
- **民眾網頁 agent**（M5）：阿幫點名各個小幫手（公車、YouBike、高鐵、天氣、路況…）討論，依「即時資料＋你的狀態」（下雨、塞車、趕時間、帶行李、想省錢…）用透明規則選出建議，並可一鍵導航、訂票、叫車。

> 文件網站：[`docs/index.html`](docs/index.html)（GitHub Pages）　開發指引：[`CLAUDE.md`](CLAUDE.md)　計畫：[`docs/PLAN.md`](docs/PLAN.md)　互動原型：[`docs/prototypes/transit-discussion.html`](docs/prototypes/transit-discussion.html)

## 架構

```
 民眾網頁（PWA）──┐                ┌─ core/tools/   Tool registry（pack・tier・speak）
 Claude／AI agent ─┼─▶ server/http.js ─┤  core/decide.js 決策引擎（資料＋使用者狀態 → 排序與理由）
 iOS／Android／LINE┘   /api/v1  /mcp    ├─ core/agent/   網頁 agent（Claude 或示範模式，NDJSON 事件）
                    mcp/server.js(stdio)└─ core/services/ ＋ mock ─▶ tdx-client ─▶ 交通部 TDX、氣象署…
```

一個核心、多個出口：tool 只定義一次，MCP、REST、網頁 agent 共用；金鑰只在伺服器。詳見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
cp .env.example .env      # 填入金鑰；全部留空就是示範模式
npm start                 # http://localhost:8787（PWA、/api/v1、/mcp）
npm test
```

| 金鑰 | 取得 | 沒有時 |
|---|---|---|
| `TDX_CLIENT_ID`／`TDX_CLIENT_SECRET` | [TDX](https://tdx.transportdata.tw/register) 會員中心 → API 金鑰 | 交通資料用示範資料 |
| `CWA_API_KEY` | [中央氣象署開放資料平臺](https://opendata.cwa.gov.tw) | 天氣用示範資料（M3） |
| `ANTHROPIC_API_KEY` | Anthropic Console | 網頁 agent 用示範模式（M5） |

台鐵／高鐵導訂票需另在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限。

## 用 Claude 連阿幫（MCP）

### Claude 自訂連接器（遠端）

端點：`/mcp`（全部工具）或 `/mcp/transit`（只含交通工具包）。本機測試：

```bash
npm start
npx cloudflared tunnel --url http://localhost:8787   # 取得臨時 https 網址
```

Claude「設定 → Connectors → Add custom connector」填 `https://<臨時網址>/mcp`。

### Claude Desktop／Claude Code（stdio）

```json
{ "mcpServers": { "abang": { "command": "node", "args": ["/絕對路徑/A-Bang/mcp/server.js"],
  "env": { "TDX_CLIENT_ID": "…", "TDX_CLIENT_SECRET": "…" } } } }
```

```bash
claude mcp add abang -e TDX_CLIENT_ID=… -e TDX_CLIENT_SECRET=… -- node /絕對路徑/A-Bang/mcp/server.js
```

### Tools

| Tool | 說明 | 狀態 |
|---|---|---|
| `bus_search_routes` | 搜尋公車路線 | ✅ |
| `bus_route_eta` | 路線各站即時到站 | ✅ |
| `bus_nearby_stations` | 附近公車站與路線 | ✅ |
| `bus_station_eta` | 某站所有路線到站 | ✅ |
| `youbike_nearby` | 附近 YouBike 可借可還 | ✅ |
| `thsr_timetable`／`tra_timetable` | 高鐵／台鐵 OD 時刻表 | ✅ |
| `rail_stations` | 高鐵／台鐵車站 | ✅ |
| `metro_stations`／`metro_live_board` | 捷運車站與即時看板 | 📝 M3 |
| `find_place` | 地名 → 座標 | 📝 M3 |
| `traffic_status`、`intercity_bus`、`rail_fare`、`weather_now` | 路況、國道客運、票價、天氣 | 📝 M3 |
| `plan_trip` | 從 A 到 B：比較方案並依使用者狀態排序 | 📝 M3 |
| `rail_booking_link`、`ridehail_link` | 官方訂票連結、叫車連結（需使用者確認） | 📝 M3 |

完整規格：[`docs/MCP_TOOLS.md`](docs/MCP_TOOLS.md)。所有 tools 唯讀（`readOnlyHint`）；結果附 `structuredContent: { card, mode, speak, data }`。

## HTTP API

| Endpoint | 說明 |
|---|---|
| `GET /api/v1/status` | 模式、工具包 |
| `GET /api/v1/tools?pack=` | tools、工具包、分級、JSON Schema |
| `POST /api/v1/tools/:name` | 呼叫 tool；回傳 `{ name, card, mode, data, text, speak }` |
| `POST /api/v1/agent` | 📝 M5：網頁 agent，NDJSON 事件串流（[`docs/AGENT.md`](docs/AGENT.md)） |
| `POST /mcp`、`/mcp/:pack` | 遠端 MCP（Streamable HTTP、stateless） |
| `GET /api/v1/bus/*`、`/bike/nearby`、`/thsr/*`、`/tra/*` | 舊版 REST（PWA 使用） |

錯誤：`{ "error": "…" }`（400 參數、405 方法、413 過大、429 限流、502 上游）。

## 環境變數

見 [`.env.example`](.env.example)：`PORT`、`DEMO_MODE`、`TDX_*`、`CWA_API_KEY`、`ANTHROPIC_*`、`RATE_LIMIT_*`、`AGENT_*`、`TRUST_PROXY`、`MCP_PACKS`、`DEMO_WEATHER`、`DEMO_TRAFFIC`。

## 開發

用 Claude Code 循環開發：照 [`docs/LOOP.md`](docs/LOOP.md)，每輪一個任務（[`docs/PLAN.md`](docs/PLAN.md) 的任務代號），紀錄在 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

| 文件 | 內容 |
|---|---|
| [`PRD.md`](docs/PRD.md) | 目標、範圍、產品線 |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 架構、資料流、職責 |
| [`MCP_TOOLS.md`](docs/MCP_TOOLS.md) | tools 規格 |
| [`DATA_SOURCES.md`](docs/DATA_SOURCES.md) | 開放資料來源、端點、TTL |
| [`AGENT.md`](docs/AGENT.md) | 網頁 agent、事件協定 |
| [`UX.md`](docs/UX.md) | 討論串、決策圖、卡片、文案 |
| [`CARDS.md`](docs/CARDS.md) | 卡片資料契約 |
| [`TESTING.md`](docs/TESTING.md) | 測試規格 |
| [`BRAND.md`](docs/BRAND.md) | 品牌 |
| [`PLATFORM.md`](docs/PLATFORM.md) | 下一階段：阿幫平台 |
| [`adr/`](docs/adr/README.md) | 架構決策紀錄 |

## 授權與資料來源

程式碼 MIT。資料來源：交通部 TDX 運輸資料流通服務、中央氣象署、政府資料開放平臺，依[政府資料開放授權條款](https://data.gov.tw/license)使用，畫面需標示來源。
