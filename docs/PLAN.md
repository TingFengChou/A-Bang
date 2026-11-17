# 開發計畫與里程碑

版本：v0.5（2026-11-18）

規則：

- 一次做一個任務（以任務代號為單位，例如 `M3-04`），照 `docs/LOOP.md` 的循環執行。
- 任務完成要符合 `CLAUDE.md` 的「完成的定義」，並在此勾選、寫日期與一行備註。
- 標 ⛔ 的任務被外部條件卡住（金鑰、權限、網路）：先做不受影響的部分，其餘寫進 §狀態看板的「卡住」欄，不要猜測欄位。
- 標 🧩 的任務是為 M9 平台預留的擴充點（ADR-0007、`PLATFORM.md` §11），範圍很小但不可省略。

```
M0 基礎 ✅ ─▶ M2 Registry＋遠端 MCP ✅ ─▶ M3 交通完整版 🚧 ─▶ M4 互動卡片 ─▶ M5 網頁 agent ─▶ M6 上線
     M1 TDX 實測 ⛔（需金鑰，可與 M3 並行；M3 先用 mock＋TDX 形狀 fixture）
─▶ M7 反詐騙 ─▶ M8 中小企業概念驗證 ─▶【啟動門檻】─▶ M9 阿幫平台（Agent Builder）
```

## 狀態看板

| 里程碑 | 狀態 | 下一個任務 | 卡住 |
|---|---|---|---|
| M0 基礎 | ✅ | — | — |
| M1 TDX 實測 | ⛔ | M1-01 | TDX 金鑰、可連 TDX 的網路 |
| M2 Registry＋遠端 MCP | ✅（Claude 實機連線待驗） | — | Austin 以 cloudflared 實測 |
| M3 交通完整版 | 🚧 | M3-09 | `rail_booking_link` 需導訂票權限；`weather_now` 真實資料需 CWA 授權碼（mock 與介面已完成） |
| M4 互動卡片 | 📝 | — | — |
| M5 網頁 agent | 📝 | — | Claude 模式需 `ANTHROPIC_API_KEY`（示範模式不需要） |
| M6 上線 | 📝 | — | 部署帳號、網域 |

建議順序：M3-09 → M3-13 → M4 → M5（M5 的討論串與決策圖可在 M3 完成 `plan_trip` 後提前開工）。

## Austin 待辦（外部條件）

- [ ] 申請 TDX 會員，取得 Client ID／Secret，填入本機 `.env`（**不要貼到對話、不要 commit**）
- [ ] 在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限
- [ ] 申請中央氣象署開放資料平臺授權碼 → `.env` 的 `CWA_API_KEY`
- [ ] 本機 `npm start` ＋ `cloudflared tunnel --url http://localhost:8787`，在 Claude 新增自訂連接器 `https://<隨機>.trycloudflare.com/mcp`，確認能列出並呼叫 tools
- [ ] 本機執行 `node scripts/verify-tdx.js`、`node scripts/record-fixtures.js`（M1 完成後），把 fixtures commit
- [ ] 校對 `core/data/landmarks.json` 座標（201 筆，Claude 依記憶整理的近似值；可對照 Google 地圖或 M1 的 TDX／TGOS 結果，校對完把 `verified` 改為 `true`）
- [ ] （M5）取得 `ANTHROPIC_API_KEY`，設定每日預算
- [ ] （M6）選定部署平台與網域

---

## M0 基礎 ✅

- [x] 共用核心 `core/`：TDX client（token 快取、回應快取）、交通服務、示範資料
- [x] HTTP API `/api/v1/*` + PWA（附近、公車、YouBike、高鐵、台鐵、收藏）
- [x] MCP server（stdio，8 個 tools）
- [x] 測試：正規化 fixture 測試、MCP 整合測試
- [x] 單檔 Demo（`npm run build:demo`）

## M1 TDX 實測與 fixture 錄製 ⛔

前置：TDX Client ID／Secret（`.env`）、可連到 tdx.transportdata.tw 的網路。雲端沙盒無法連 TDX，**只能在 Austin 本機執行**；Claude Code 可先寫好腳本（不需金鑰即可完成的部分）。

- [ ] M1-01 `scripts/verify-tdx.js`：逐一呼叫 `MCP_TOOLS.md` 所有 ⚠️ 端點，印出狀態碼、筆數、第一筆欄位名稱（不印金鑰）；無金鑰時清楚提示並 exit 1
- [ ] M1-02 `scripts/record-fixtures.js`：把真實回應（每端點截前 5 筆）存到 `test/fixtures/<endpoint>.json`，移除可能的個資
- [ ] M1-03 ⛔ 本機執行 M1-01／02；`test/transit.test.js` 改讀新 fixtures；修正與實際欄位不符的正規化
- [ ] M1-04 ⛔ 把驗證結果寫進下表與 `DATA_SOURCES.md`；額度方案寫進 `ARCHITECTURE.md` §快取與額度

驗收：`npm test` 用真實 fixture 通過；`verify-tdx.js` 全綠或有明確「不支援」紀錄。

| 待驗證 | 狀態 |
|---|---|
| `Bus/EstimatedTimeOfArrival/.../PassThrough/Station/{id}` | 未驗證 |
| `Bus/Shape/City/{City}/{Route}` WKT 格式 | 未驗證（M3-02 假設欄位 `Geometry`、`LINESTRING`／`MULTILINESTRING`；`core/geo.js` 防禦性解析） |
| 站牌 `StopPosition` 於各縣市完整度 | 未驗證 |
| `Rail/Metro/LiveBoard/{Op}` 各系統欄位 | 未驗證（M3-04 假設 `EstimateTime` 為分鐘、`DestinationStationName`／`TripHeadSign`、可用 `$filter=StationID eq …`） |
| 台鐵／高鐵 ODFare 欄位 | 未驗證（M3-05 假設 `Fares[].TicketType／FareClass／CabinClass／Price`、台鐵 v3 `ODFares[]` 每車種一筆；代碼對照與台鐵 `TrainType` 意義待確認） |
| 高速公路旅行時間、道路事件、國道客運端點 | 未驗證（M3-07 假設 `StopOfRoute/InterCity`、`Schedule/InterCity` 的 `Timetables[].ServiceDay／StopTimes`；客運票價端點未知；M3-06 假設 `SectionShape`／`Section`／`Live`／`Live/News` 的 Freeway 端點與 `SectionShapes`、`Sections`、`LiveTraffics`、`Newses` 包裝；`TravelSpeed` 為 0 是「完全停滯」還是「無資料」（目前視為無資料）；走廊 3 km 可能同時納入平行國道（國 1／國 3），需以實際路段資料決定是否依 `RoadName` 只取一條主線） |
| 地理編碼（TDX 或 TGOS） | 未驗證（`find_place` 目前只查內建地標） |
| 導訂票 API 端點與參數（需權限） | 未驗證 |
| CWA 觀測與鄉鎮預報欄位 | 未驗證（M3-08 假設 `records.Station[]`（`GeoInfo.Coordinates` WGS84、`WeatherElement.AirTemperature／Weather`）、雨量站 `O-A0002-001` 的 `RainfallElement.Past1hr.Precipitation`（`-998` 雨跡等特殊值目前視為沒有資料）、`F-D0047-089` 可用 `LocationName` 篩、上層縣市欄位 `LocationsName`（同名鄉鎮以縣市區分）、時段 `EndTime`、元素名「3小時降雨機率」） |
| OData 空白用 `%20`（已實作）是否必要 | 未驗證 |

## M2 Tool registry＋遠端 MCP ✅

- [x] `core/tools/`：`defineTool()`、registry；8 個 tools 搬入（行為不變）
- [x] `mcp/create-server.js`；stdio 入口 `mcp/server.js`（`npm run mcp`）
- [x] `/mcp`、`/mcp/:pack`（Streamable HTTP，stateless，`enableJsonResponse`）
- [x] `GET /api/v1/tools`、`POST /api/v1/tools/:name`
- [x] 每 IP 限流（`RATE_LIMIT_API` 120/分、`RATE_LIMIT_MCP` 60/分、`TRUST_PROXY=1`）
- [x] 🧩 `pack`、`tier`；`MCP_PACKS` 與 `/mcp/:pack` 過濾
- [x] 測試：stdio、HTTP、REST 三路徑一致（24 項測試全過）
- [x] README：Claude 自訂連接器設定（cloudflared）
- [x] ADR-0006：M2 維持 SDK v1，M4 再評估 v2

## M3 交通完整版 🚧

規格：`MCP_TOOLS.md`、`DATA_SOURCES.md`、ADR-0010。每個新服務都要：真實 service ＋ mock（示範模式）＋ TDX 形狀 fixture 單元測試 ＋ tool 註冊（含 `speak`）＋ MCP 整合測試列出。

- [x] M3-00 決策引擎 `core/decide.js`（7 項測試，2026-11-17）
- [x] M3-00b 每個 tool 的 `speak`（2026-11-17）
- [x] M3-01 導航：`core/nav.js`（`navLinks(lat, lon, mode)`、`leaveAt(etaSec, distanceM)`）；`bus_nearby_stations`、`youbike_nearby` 每筆附 `nav`（2026-11-17：另有 `walkMinutes`、`withNav`；nav 在 tool 層包裝，7 項測試）
- [x] M3-02 `bus_route_eta` 站點加 `lat/lon`；`core/geo.js` 解析 Bus Shape WKT → `shape`（mock 也要有）（2026-11-17：站點另附 `nav`；形狀端點失敗時省略 `shape` 不影響到站；9 項測試）
- [x] M3-03 `core/data/landmarks.json`（≥ 150 筆：名稱、別名、座標、縣市）＋ `core/services/places.js` ＋ tool `find_place`（2026-11-17：201 筆、座標待校對；tool 加 `source`／`static` 正確標示來源；8 項測試）
- [x] M3-04 `core/services/metro.js` ＋ mock ＋ tools `metro_stations`、`metro_live_board`（卡片 `metro`）（2026-11-17：四系統；同名多線合併；看板空資料回空 trains；tools 在 `core/tools/metro.js`；6 項測試）
- [x] M3-05 `rail_fare`（台鐵／高鐵票價）（2026-11-17：代碼轉中文、成人單程在前、未知代碼保留；台鐵車種只用資料自帶名稱；3 項測試）
- [x] M3-06 `traffic_status`（pack transit；mock 提供「順暢」「壅塞」兩種情境，以 `DEMO_TRAFFIC=jam` 切換）（2026-11-17：沿途路段以走廊＋方向判斷；壅塞累計 5 km 即 jam；查不到為 null；`resolvePoint` 供 plan_trip 共用；6 項測試）
- [x] M3-07 `intercity_bus`（國道客運；`delayRisk` 依路況）（2026-11-17：站牌 1.5 km 配對、時刻表、含延誤抵達；票價端點未確認先回 null；`T.point` 共用；6 項測試）
- [x] M3-08 `weather_now`（pack weather；`CWA_API_KEY`；mock 以 `DEMO_WEATHER=rain` 切換）（2026-11-18：`cwa-client`、觀測＋鄉鎮預報、`weatherMode` 與 TDX 獨立；tool 加 `modeOf`／`demoNote`；6 項測試；真實資料待授權碼驗證）
- [x] M3-QA 品質基礎（使用者追加）：Playwright E2E 冒煙測試（`npm run e2e`）、Swagger／OpenAPI 3.1（`server/rest.js` 路由表＋`server/openapi.js`，`/api/docs`）、ESLint（`npm run lint`）、CI 加 lint 與 E2E；code-review／security-review／agy 審查修正（雨量改取雨量站 `Past1hr`、客運 ISO 出發日與隔日班次、5xx 不外洩訊息、Swagger 白名單 `Object.hasOwn`、`traffic_status` 輸出與 `intercity_bus` 一致）（2026-11-18；`npm test` 89 項、E2E 10 項）
- [ ] M3-09 `core/providers/ridehail/uber.js` ＋ tool `ridehail_link`（pack ridehail、L2）；估價先以距離估算並標 `estimated`
- [ ] M3-10 `core/services/trip.js` `planTrip()`：候選方案（`MCP_TOOLS.md` §7 規則 1–7）→ 自動狀態 → `decide()` → `ranking`；tool `plan_trip`（卡片 `trip`）
- [ ] M3-11 `plan_trip` 固定 10 組 OD fixture 測試（含：雨天、塞車、趕時間＋arriveBy、帶行李、跨城），斷言第一名與理由句關鍵字
- [ ] M3-12 ⛔ `rail_booking_link`（L2；導訂票權限到位前先完成介面、mock 與「未授權」錯誤訊息）
- [ ] M3-13 `tdx-client` 回報 `metrics`（呼叫數、筆數、快取命中、耗時）；`callTool` 回傳 `metrics`
- [ ] M3-14 🧩 來源有英文名稱時保留（`nameEn`、`stopNameEn`）

驗收：`npm test` 全過；`plan_trip` 對 10 組 OD 排序合理且理由句正確；所有 tools 在示範模式可用；`GET /api/v1/tools` 列出 ≥ 17 個 tools。

## M4 互動卡片（MCP Apps）

規格：`CARDS.md`、ADR-0003、ADR-0008。

- [ ] M4-01 卡片資料契約 `public/ui/cards/schema/<card>.v1.json`（7 種），測試以 schema 驗證 tools 的 `structuredContent.data`
- [ ] M4-02 `public/ui/cards/`：`index.js`（依 `card` 分派）、7 種卡片、`cards.css`（淺色）
- [ ] M4-03 🧩 卡片文字集中於 `public/ui/cards/i18n/zh-TW.js`
- [ ] M4-04 host 介面兩種實作：`host-web.js`、`host-mcp-app.js`（`@modelcontextprotocol/ext-apps` 的 `App`）；先評估 SDK v2 並更新 ADR-0006
- [ ] M4-05 `scripts/build-cards.js`：esbuild 打包 `dist/cards.html`
- [ ] M4-06 MCP 出口：`ui://abang/cards.html` 資源；有卡片的 tool 加 `_meta.ui.resourceUri`
- [ ] M4-07 動態：倒數每秒遞減、數字變化、公車在時間軸移動；`prefers-reduced-motion` 關閉
- [ ] M4-08 Playwright：以 `AppBridge` 當 host 載入每種卡片 fixture，截圖並檢查無 console error
- [ ] M4-09 ⛔ 以 ext-apps `basic-host` 與 Claude 實測（Austin）

驗收：Claude 中呼叫 `bus_route_eta` 顯示互動卡片，能自行刷新、點站牌產生延伸提問。

## M5 民眾網頁 agent

規格：`AGENT.md`、`UX.md`、ADR-0004、ADR-0009、ADR-0010；視覺依原型 `docs/prototypes/transit-discussion.html`（以真實事件驅動，不照抄假資料）。

- [ ] M5-01 🧩 `core/agents/life.json` ＋ zod 驗證；prompt 組裝順序：平台政策 → 工具包護欄 → agent 設定 → 使用者
- [ ] M5-02 `core/agent/events.js`：事件型別與建立函式（`AGENT.md` §事件）＋測試
- [ ] M5-03 `core/agent/demo-intent.js`：規則式意圖（`AGENT.md` 示範模式表），產生與 Claude 模式相同事件
- [ ] M5-04 `core/agent/run.js`：共用執行器（呼叫 tool → `tool_start`/`tool_result` → `plan_trip` 時發 `decision`）
- [ ] M5-05 `core/agent/claude.js`：Claude tool-use 迴圈（`claude-haiku-5-5`），`agent_note` 來自模型、`speak` 來自資料
- [ ] M5-06 `POST /api/v1/agent` NDJSON 串流；🧩 限流與計量以 agent id 為單位；每日預算
- [ ] M5-07 🧩 `client_tool_call`／`clientToolResults`；網頁實作 `device_location`
- [ ] M5-08 `public/js/pages/agent.js`：對話 UI、討論串、`@` 點名、建議問題
- [ ] M5-09 決策圖（`decision` 事件）：資料膠囊 → 狀態標籤連回來源 → 方案連線依分數變粗 → 勝出路徑亮起；狀態 chip 可切換並即時重算（前端呼叫同一份 `decide.js`）
- [ ] M5-10 結論卡：建議方案＋分段時間條＋備案＋行動按鈕（導航、訂票、叫車、提醒我）
- [ ] M5-11 輕量 3D：卡片立體進場、排名翻轉；低階手機與 `prefers-reduced-motion` 降級
- [ ] M5-12 首頁改以 agent 為主要入口，舊功能保留在格子
- [ ] M5-13 Playwright：示範模式 6 個建議問題的手機與桌面截圖；Claude 模式以本地 mock API 測迴圈與錯誤

驗收：無 API Key 時完整展示；填入 `ANTHROPIC_API_KEY` 後切換 Claude，事件流與卡片相同；無假延遲。

## M6 上線準備

- [ ] M6-01 `Dockerfile`、`.dockerignore`、`/healthz`
- [ ] M6-02 結構化 log（不含座標與對話內容）；🧩 欄位含 `agentId`、`tenantId`（第一方 `first-party`）
- [ ] M6-03 選用 Redis 快取（`REDIS_URL` 有設才啟用）
- [ ] M6-04 無障礙：鍵盤、對比、`aria-live` 播報到站
- [ ] M6-05 Lighthouse PWA／Performance ≥ 90
- [ ] M6-06 部署 Cloud Run 或 Zeabur，HTTPS 與自訂網域
- [ ] M6-07 GitHub Pages 發布 `docs/`（`index.html`、原型）

驗收：公開 HTTPS 網址可用網頁 agent；Claude 自訂連接器可連；文件站上線。

## M7 反詐騙 agent（概要）

詳細規格屆時寫 `docs/AGENT_ANTIFRAUD.md`。

- [ ] 網頁 `/agent/:id`、API `/api/v1/agent/:id`、MCP `/mcp/:pack` 已可依 profile 運作
- [ ] 165 開放資料同步（詐騙 LINE ID、假投資網站、闢謠），每日更新本地索引
- [ ] 詐騙特徵規則庫（人工維護、版本化）；`scam_check_message`、`scam_lookup_*`、`sms_sender_check`、`scam_myth_search`
- [ ] 風險卡片：等級、可疑字句、下一步（165）
- [ ] 護欄：不宣稱安全、不開啟可疑連結、不儲存貼上內容

## M8 中小企業概念驗證（概要）

詳細規格屆時寫 `docs/AGENT_SME.md`。

- [ ] 選定一個產業與縣市（建議化粧品製造）
- [ ] 申辦知識庫 `core/data/permits/<industry>.json`：項目、條件、主管機關、法源條號、官方連結、審核日期與審核人
- [ ] 法規檢索（全國法規資料庫）、`company_lookup`（商工登記公示資料）
- [ ] `permit_checklist`、`regulation_search`、`compliance_calendar` 與清單卡片
- [ ] 法規專家審核流程；標示「非法律意見」

## M9 阿幫平台（Agent Builder）— 需先達啟動門檻

規格：`PLATFORM.md`；決策：ADR-0005、ADR-0007。

啟動門檻（全部達成才開始）：

- [ ] 第一方 agent ≥ 2 個上線，tool 成功率 ≥ 99%，連續 8 週無重大護欄事故
- [ ] ≥ 5 家設計夥伴有具體用例並願意試用
- [ ] 每次對話成本已知，初步定價經夥伴驗證
- [ ] L2 護欄在真實流量下驗證，輸出檢查器上線
- [ ] `PLATFORM.md` 未決問題中的法律與條款確認完成

分段：M9a 內部化 → M9b 封閉測試（L1、網頁／內嵌／QR）→ M9c 公開（L2、LINE、MCP、多語）。L3 另行決定。

## 行動 App（M6 之後評估）

PWA 包殼（TWA／WebView）→ 原生 App 呼叫同一 agent API 與卡片契約（ADR-0008）；裝置端工具（定位、提醒、行事曆、通知）；Siri 捷徑／App Intents、Android 小工具；App Attest／Play Integrity。

## 其他候選（未排程）

地震、AQI（環境部）、藥局（健保署）、發票對獎（財政部）、TDX MaaS 多段轉乘、使用者帳號、民眾需求報表（給交通主管機關）。

## 市場現況備忘（2026-11）

- 交通部 TDX 已有官方 MCP（臺鐵／高鐵班次與票價、導訂票、道路事件；遠端 HTTP、需會員金鑰）。本專案不重複包裝 API，差異化在：跨資料組合（`plan_trip`）、討論串與決策圖、互動卡片、免帳號民眾 agent。M3-05／06 可評估直接介接官方 MCP（ARCHITECTURE「外部 MCP」）。
- 民間已有 data.gov.tw 資料集、政府採購、法規等 MCP；M8 先評估接用。
