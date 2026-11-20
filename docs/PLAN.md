# 開發計畫與里程碑

版本：v0.6（2026-11-21）

規則：

- 一次做一個任務（以任務代號為單位，例如 `M3-04`），照 `docs/LOOP.md` 的循環執行。
- 任務完成要符合 `CLAUDE.md` 的「完成的定義」，並在此勾選、寫日期與一行備註。
- 標 ⛔ 的任務被外部條件卡住（金鑰、權限、網路）：先做不受影響的部分，其餘寫進 §狀態看板的「卡住」欄，不要猜測欄位。
- 標 🧩 的任務是為 M9 平台預留的擴充點（ADR-0007、`PLATFORM.md` §11），範圍很小但不可省略。

```
M0 基礎 ✅ ─▶ M2 Registry＋遠端 MCP ✅ ─▶ M3 交通完整版 ✅ ─▶ M4 互動卡片 ✅ ─▶ M5 網頁 agent ✅ ─▶ M6 上線 🚧
     M1 TDX 實測 ⛔（需金鑰，可與 M3 並行；M3 先用 mock＋TDX 形狀 fixture）
─▶ M7 反詐騙 ─▶ M8 中小企業概念驗證 ─▶【啟動門檻】─▶ M9 阿幫平台（Agent Builder）
```

## 狀態看板

| 里程碑 | 狀態 | 下一個任務 | 卡住 |
|---|---|---|---|
| M0 基礎 | ✅ | — | — |
| M1 TDX 實測 | ⛔ | M1-01 | TDX 金鑰、可連 TDX 的網路 |
| M2 Registry＋遠端 MCP | ✅（Claude 實機連線待驗） | — | Austin 以 cloudflared 實測 |
| M3 交通完整版 | ✅（2026-11-18 驗收；M3-12 真實導訂票 ⛔） | — | 待 Austin：無狀態市區短程叫車排第一是否合理（ADR-0010）；`rail_booking_link` 需導訂票權限；`weather_now` 真實資料需 CWA 授權碼（mock 與介面已完成） |
| M4 互動卡片 | ✅（2026-11-18；M4-09 Claude 實測 ⛔） | M4-09（Austin） | 本機 `npm start`＋cloudflared，在 Claude 自訂連接器實測卡片 |
| M5 網頁 agent | ✅（2026-11-18；Claude 實機待金鑰） | — | Claude 模式需 `ANTHROPIC_API_KEY`；地端模式需自架 Ollama 等（示範模式都不需要） |
| M10 生活開放資料 | ✅（2026-11-19） | — | 空品需 `MOENV_API_KEY`、地震需 `CWA_API_KEY`（沒有時示範片段）；藥局資料沒有座標 |
| M7 反詐騙 agent | ✅（2026-11-19；規則庫待專家審核） | — | 規則庫 `reviewedBy` 待防詐專家審核 |
| M11 行動 App | 🚧（M11-01 殼、M11-02 本機通知、名稱 Abang 與圖示、返回手勢、原生定位、鍵盤 ✅） | M11-03 原生相機掃 QR、M11-04 啟動畫面與隱私權政策頁 | 給別人用需 HTTPS 測試環境（M6-06）與開發者帳號；iOS 實機需 Austin 的 iPhone |
| M12 裝置端 AI（ADR-0014） | 🚧 第一階段 ✅（2026-11-21：Gemini Nano 實機、Apple Intelligence 模擬器；E3／E7／E8 待做） | E3 App 內分類器備援、E7 手機上轉述、E8 設定開關 | iOS 實機數據需 iPhone 15 Pro 以上並開啟 Apple Intelligence |
| M13 Agent 聰明度（PM 情境 S1～S18） | 🚧（情境集全部有第一版、todo 0：位置當起點、接著改、新狀態、出門建議、明天天氣、末班車、捷運轉乘、高鐵台鐵最近站、英文、常用地點 ✅） | S5、S12b 卡片英文、設計待辦 | 真實末班車、捷運路網需 TDX 金鑰 |
| M6 上線 | 🚧（M6-01／02／04／07 ✅、地端部署驗證 ✅） | 正式環境階段再做 | 2026-11-19 Austin 決定：雲端部署（M6-06）、Redis 快取（M6-03）、Lighthouse（M6-05）留到正式環境階段；先衝刺功能。M6-07 需在 repo 設定啟用 Pages |

建議順序：M4、M5、M7、M10 已完成；M1（TDX 金鑰）申請中；M6 正式環境項目延後；目前衝刺 M11 行動 App、M12 裝置端 AI、M13 Agent 聰明度（PM 情境清單見 `test/scenarios/life.json`）；M8 中小企業概念驗證移到下一階段。

## Austin 待辦（外部條件）

- [ ] 申請 TDX 會員，取得 Client ID／Secret，填入本機 `.env`（**不要貼到對話、不要 commit**）
- [ ] 在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限
- [ ] 申請中央氣象署開放資料平臺授權碼 → `.env` 的 `CWA_API_KEY`
- [ ] 本機 `npm start` ＋ `cloudflared tunnel --url http://localhost:8787`，在 Claude 新增自訂連接器 `https://<隨機>.trycloudflare.com/mcp`，確認能列出並呼叫 tools
- [ ] 本機執行 `node scripts/verify-tdx.js`、`node scripts/record-fixtures.js`（M1 完成後），把 fixtures commit
- [ ] 校對 `core/data/landmarks.json` 座標（201 筆，Claude 依記憶整理的近似值；可對照 Google 地圖或 M1 的 TDX／TGOS 結果，校對完把 `verified` 改為 `true`）
- [ ] （M5）取得 `ANTHROPIC_API_KEY`，設定每日預算；或不付費改用地端模型（`LOCAL_LLM_URL`＋`LOCAL_LLM_MODEL`，Ollama 需 `OLLAMA_CONTEXT_LENGTH=16384`）
- [ ] （M6）選定部署平台與網域；部署時設定環境變數（金鑰）並用 `Dockerfile` 建置
- [ ] （M11）決定 App 名稱與 App ID（目前 `tw.abang.app`）；申請 Apple Developer（每年 99 美元）與 Google Play 開發者帳號（一次 25 美元），公司或個人名義
- [ ] （M6）repo Settings → Pages → Source 選「GitHub Actions」，文件站才會發布（`.github/workflows/pages.yml`）

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
| CWA 觀測與鄉鎮預報欄位 | 未驗證（M3-08 假設 `records.Station[]`（`GeoInfo.Coordinates` WGS84、`WeatherElement.AirTemperature／Weather`）、雨量站 `O-A0002-001` 的 `RainfallElement.Past1hr.Precipitation`（`-998` 雨跡等特殊值目前視為沒有資料）、`F-D0047-089` 可用 `LocationName` 篩、上層縣市欄位 `LocationsName`（同名鄉鎮以縣市區分）、時段 `EndTime`、元素名「3小時降雨機率」；`weather_tomorrow` 另假設時段 `StartTime`（或 `DataTime`）、元素「溫度／最高溫度／最低溫度」「天氣現象」） |
| 捷運線別與估算 | 未驗證（2026-11-21：線別由站代碼字首推（台中數字代碼→綠線、高雄 RK→紅線、機捷 A）；時間票價依距離估，真實改用 `Metro/S2STravelTime`、`Metro/ODFare`） |
| 高鐵／台鐵車站座標與等級 | 未驗證（2026-11-21：`StationPosition.PositionLat／Lon` 給「最近車站」用；台鐵 `StationClass` 可用來優先有直達車的大站，目前改用「最近 3 站依序查、0 班換下一站」） |
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
- [x] ADR-0006：M2 維持 SDK v1，M4 再評估 v2（2026-11-18：評估後維持 v1）

## M3 交通完整版 ✅

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
- [x] M3-09 `core/providers/ridehail/uber.js` ＋ tool `ridehail_link`（pack ridehail、L2）；估價先以距離估算並標 `estimated`（2026-11-18：provider 註冊與 `createRidehailServices`；臺北市計程車費率＋道路距離估區間；`confirmText` 供 M4 確認視窗；4 項測試）
- [x] M3-10 `core/services/trip.js` `planTrip()`：候選方案（`MCP_TOOLS.md` §7 規則 1–7）→ 自動狀態 → `decide()` → `ranking`；tool `plan_trip`（卡片 `trip`）（2026-11-18：7 種方案、`bus.directTrips`（live 以站點座標驗方向／mock 示範路線）、車站座標由內建地標對照、來源失敗只略過並列 `unavailable`；輸出對齊 CARDS `trip`；7 項測試）
- [x] M3-11 `plan_trip` 固定 10 組 OD fixture 測試（含：雨天、塞車、趕時間＋arriveBy、帶行李、跨城），斷言第一名與理由句關鍵字（2026-11-18：`test/trip-od.test.js`；「想省錢」cost 倍數 3→5 並記錄於 ADR-0010；無狀態市區短程叫車第一待 Austin 決定）
- [ ] M3-12 ⛔ `rail_booking_link`（L2；導訂票權限到位前先完成介面、mock 與「未授權」錯誤訊息）（2026-11-18：權限前部分 ✅——參數驗證、示範版、真實版回「尚未開通」並附官方網站、tool L2；4 項測試。待權限：串 TDX 導訂票端點）
- [x] M3-13 `tdx-client` 回報 `metrics`（呼叫數、筆數、快取命中、耗時）；`callTool` 回傳 `metrics`（2026-11-18：`core/metrics.js` 以 `AsyncLocalStorage` 隔開同時請求；CWA 也計量；MCP 放 `_meta`；OpenAPI 更新；5 項測試；計量帶 agent id 待 M5）
- [x] M3-14 🧩 來源有英文名稱時保留（`nameEn`、`stopNameEn`）（2026-11-18：`util.en`／`enField`；公車、YouBike、高鐵台鐵車站、捷運、路況路段；3 項測試）

驗收：`npm test` 全過；`plan_trip` 對 10 組 OD 排序合理且理由句正確；所有 tools 在示範模式可用；`GET /api/v1/tools` 列出 ≥ 17 個 tools。

## M4 互動卡片（MCP Apps）

規格：`CARDS.md`、ADR-0003、ADR-0008。

- [x] M4-01 卡片資料契約 `public/ui/cards/schema/<card>.v1.json`（7 種），測試以 schema 驗證 tools 的 `structuredContent.data`（2026-11-18：零依賴驗證器；三個 tool 改物件格式；payload 帶 `v`／`tool`／`args`；14 項測試）
- [x] M4-02 `public/ui/cards/`：`index.js`（依 `card` 分派）、7 種卡片、`cards.css`（淺色）（2026-11-18：`dom.js` 只用 textContent／https 連結白名單；外框、示範標示、刷新與失敗狀態共用；`actions.js` 導航／L2 確認／訂票；`preview.html`＋E2E 截圖；`thsr_timetable`／`tra_timetable` 補 `system`）
- [x] M4-03 🧩 卡片文字集中於 `public/ui/cards/i18n/zh-TW.js`（2026-11-18：`t(key, vars)`、共通／L2 確認／7 種卡片的文字；3 項測試）
- [x] M4-04 host 介面兩種實作：`host-web.js`、`host-mcp-app.js`（`@modelcontextprotocol/ext-apps` 的 `App`）；先評估 SDK v2 並更新 ADR-0006（2026-11-18：ext-apps 1.7.5（devDependency，peer 為 SDK v1）；ADR-0006 維持 v1；`host-mcp-app.js` callServerTool／sendMessage／updateModelContext／openLink，iframe 內 L2 確認框與複製連結；`mcp-app.js` 入口；4 項測試）
- [x] M4-05 `scripts/build-cards.js`：esbuild 打包 `dist/cards.html`（2026-11-18：`npm run build:cards`；單檔、零外部資源，約 394 KB）
- [x] M4-06 MCP 出口：`ui://abang/cards.html` 資源；有卡片的 tool 加 `_meta.ui.resourceUri`（2026-11-18：`mcp/cards-resource.js`：開發時記憶體內打包、正式環境讀 `dist/cards.html`；也加舊鍵 `ui/resourceUri`；1 項測試）
- [x] M4-07 動態：倒數每秒遞減、數字變化、公車在時間軸移動；`prefers-reduced-motion` 關閉（2026-11-18：`countdown.js` 本地倒數（規則同 `busStatusText`）、數字變化提示、車牌標記；reduced motion 只換文字；2 項單元＋E2E）
- [x] M4-08 Playwright：以 `AppBridge` 當 host 載入每種卡片 fixture，截圖並檢查無 console error（2026-11-18：`test/cards/mcp-host.js` 經真正的 `/mcp` 取結果與資源、沙箱 iframe；7 種卡片、點站牌 → updateModelContext、訂票 → callServerTool → 確認框 → openLink；每張卡片截圖已檢查）
- [ ] M4-09 ⛔ 以 ext-apps `basic-host` 與 Claude 實測（Austin）

驗收：Claude 中呼叫 `bus_route_eta` 顯示互動卡片，能自行刷新、點站牌產生延伸提問。

## M5 民眾網頁 agent

規格：`AGENT.md`、`UX.md`、ADR-0004、ADR-0009、ADR-0010；視覺依原型 `docs/prototypes/transit-discussion.html`（以真實事件驅動，不照抄假資料）。

- [x] M5-01 🧩 `core/agents/life.json` ＋ zod 驗證；prompt 組裝順序：平台政策 → 工具包護欄 → agent 設定 → 使用者（2026-11-18：`core/agents/index.js` 與 registry 交叉檢查；`core/agent/prompt.js`；3 項測試）
- [x] M5-02 `core/agent/events.js`：事件型別與建立函式（`AGENT.md` §事件）＋測試（2026-11-18：`ev.*`、`toNdjson`、`mergeStates`、`TOOL_ROLES`；狀態來源統一 `user`；4 項測試）
- [x] M5-03 `core/agent/demo-intent.js`：規則式意圖（`AGENT.md` 示範模式表），產生與 Claude 模式相同事件（2026-11-18：地標比對擷取地點、抵達時間、狀態關鍵字、6 種意圖的分段計畫與總結；6 個建議問題皆可完整執行；6 項測試）
- [x] M5-04 `core/agent/run.js`：共用執行器（呼叫 tool → `tool_start`/`tool_result` → `plan_trip` 時發 `decision`）（2026-11-18：`validateRequest`、`execTools`（白名單、錯誤不外洩）、`runDemo`；picked 狀態帶進計分並標示；5 項測試）
- [x] M5-05 `core/agent/claude.js`：Claude tool-use 迴圈（`claude-haiku-5-5`），`agent_note` 來自模型、`speak` 來自資料（2026-11-18：ADR-0012 三種模式 claude／local／demo；`@anthropic-ai/sdk`；地端 OpenAI 相容 fetch；共用 `model-loop.js`；預算降級；頁面標示模式；地端 qwen3:8b 實測；順手修高鐵／台鐵「下一班」：今天只列未開出班次、卡片收起已開出班次）
- [x] M5-06 `POST /api/v1/agent` NDJSON 串流；🧩 限流與計量以 agent id 為單位；每日預算（2026-11-18：`server/agent.js`；預算降級 M5-05 接上；OpenAPI 文件；3 項測試）
- [x] M5-07 🧩 `client_tool_call`／`clientToolResults`；網頁實作 `device_location`（2026-11-18：伺服器請求定位、`deviceLocation` 驗證台灣範圍；`public/js/agent/client.js` NDJSON 串流＋client tool 重送；2 項測試）
- [x] M5-08 `public/js/pages/agent.js`：對話 UI、討論串、`@` 點名、建議問題（2026-11-18：`#/agent`；討論串 role=log、角色色彩頭像、metrics、收合；卡片以 renderCard 呈現；定位流程；`/api/v1/agent/profile`；E2E 截圖已檢查。決策圖 M5-09、首頁入口 M5-12）
- [x] M5-09 決策圖（`decision` 事件）：資料膠囊 → 狀態標籤連回來源 → 方案連線依分數變粗 → 勝出路徑亮起；狀態 chip 可切換並即時重算（前端呼叫同一份 `decide.js`）（2026-11-18：`decision-graph.js`、`/core/decide.js`、重算一致性測試、E2E 驗證切換想省錢會改變建議且不呼叫伺服器；FLIP／3D 於 M5-11）
- [x] M5-10 結論卡：建議方案＋分段時間條＋備案＋行動按鈕（導航、訂票、叫車、提醒我）（2026-11-18：trip 卡（M4-02）補「提醒我出門」：高鐵／台鐵／客運方案帶 `leaveAt`，web host `remind` 以系統通知；只提醒今天且 1 分鐘後的出門時間）
- [x] M5-11 輕量 3D：卡片立體進場、排名翻轉；低階手機與 `prefers-reduced-motion` 降級（2026-11-18：CSS `enter3d`、決策圖 FLIP（最多 3 個）、`lite-motion` 降級；E2E 驗證兩種模式）
- [x] M5-12 首頁改以 agent 為主要入口，舊功能保留在格子（2026-11-18：首頁搜尋框改為問阿幫（`#/agent?q=` 自動送出）＋3 個範例；格子與分頁列不變；離線 Demo 版維持公車搜尋）
- [x] M5-13 Playwright：示範模式 6 個建議問題的手機與桌面截圖；Claude 模式以本地 mock API 測迴圈與錯誤（2026-11-18：示範模式部分 ✅——6 題 × 手機桌面皆有討論串、正確卡片、行程有決策圖、截圖已檢查；截圖發現並修正：建議題改「明天 9 點前要到左營」（示範資料 8 點前無班次）、全部遲到時卡片改說「都趕不上」、班次制等車最多算 10 分。模型模式以本地假 API 測迴圈與錯誤：`test/agent-model.test.js`）

驗收：無 API Key 時完整展示；填入 `ANTHROPIC_API_KEY` 後切換 Claude，事件流與卡片相同；無假延遲。

## M6 上線準備

- [x] M6-01 `Dockerfile`、`.dockerignore`、`/healthz`（2026-11-18：兩階段建置（build 階段打包 `dist/cards.html`、執行階段只裝正式依賴）、node 使用者、檔案唯讀、HEALTHCHECK；`/healthz` 不限流不記 log；本機 docker build／run 驗證：healthz、首頁、MCP 卡片資源讀 dist、healthy）
- [x] M6-02 結構化 log（不含座標與對話內容）；🧩 欄位含 `agentId`、`tenantId`（第一方 `first-party`）（2026-11-18：`server/log.js` 一行一個 JSON、Cloud Logging 欄位 severity／message；存取 log 不含 query；錯誤遮蔽金鑰值、堆疊只留 6 行；MCP 寫 stderr；4 項測試）
- [ ] M6-03 ⏸ 選用 Redis 快取（`REDIS_URL` 有設才啟用）（正式環境階段；需新增依賴；單一實例不需要）
- [x] M6-04 無障礙：鍵盤、對比、`aria-live` 播報到站（2026-11-18：「跳到主要內容」、全站焦點框、分頁列 `aria-current`、toast `role=status`；`--off` 文字對比 3.1 → 5.0；修首頁範例問題白底白字；卡片常駐播報區（公車路線點開的站／即將進站、站牌最快 3 班、捷運最近 2 班），PWA 公車頁同樣播報，第一次不念、沒變不重念；4 項單元＋2 項 E2E）
- [ ] M6-05 ⏸ Lighthouse PWA／Performance ≥ 90（正式環境階段；需新增 dev 依賴 `lighthouse`，或用 Chrome DevTools 手動跑）
- [ ] M6-06 ⏸ 部署 Cloud Run 或 Zeabur，HTTPS 與自訂網域（正式環境階段。2026-11-19 地端部署驗證 ✅：`docker-compose.yml` 啟動、`/healthz`、網頁 agent 以地端 qwen3:8b 回答（約 18 秒、正確）、MCP 18 個 tools 與卡片資源）
- [x] M6-07 GitHub Pages 發布 `docs/`（`index.html`、原型）（2026-11-18：`.github/workflows/pages.yml`，推 main 且 docs 有變時發布；待 Austin 在 repo 設定啟用 Pages）

驗收：公開 HTTPS 網址可用網頁 agent；Claude 自訂連接器可連；文件站上線。

## M7 反詐騙 agent

規格：`AGENT_ANTIFRAUD.md`、ADR-0005、ADR-0007、`PLATFORM.md`（L2）。

- [x] M7-01 多 agent 路由：`antifraud.json` profile、網頁 `#/agent/:id`、API `/api/v1/agent/:id`、`/api/v1/agent/profile?id=`、首頁入口；MCP `/mcp/antifraud`（2026-11-19：`antifraud.json`、`hasProfile`；`/api/v1/agent/:id`（未知 404）、`profile?id=`、OpenAPI；網頁 `#/agent/:id`（標題、提示、@點名依 agent）；首頁「防詐」格子；`/mcp/antifraud` 由 pack 自動提供）
- [x] M7-02 165 開放資料：`core/services/antifraud.js`（停止解析涉詐網站、詐騙闢謠，CSV、24 小時快取）＋ mock／fixtures（2026-11-19：零依賴 CSV 解析；網域正規化（punycode）與上層網域比對；闢謠搜尋；24 小時快取、更新失敗沿用舊索引；啟動時預載；實測 9.7 萬網域、89 篇；示範片段在 `core/data/demo/`）
- [x] M7-03 詐騙特徵規則庫 `core/data/scam-rules.json`（版本化、待專家審核）＋ tools `scam_check_message`、`scam_lookup_url`、`scam_myth_search`、`sms_sender_check`（2026-11-19：17 條規則（版本 2026.11.19-1，待審核）；網址抽取；風險分數與等級；寄件號碼規則；8 項測試）
- [x] M7-04 風險卡片 `scam-risk`（契約、渲染、字典）（2026-11-19：契約 `scam-risk.v1.json`、渲染（色彩＋符號＋文字、不提供開啟使用者網址）、字典；MCP Apps 同一份）
- [x] M7-05 示範意圖（antifraud）與 L2 輸出護欄（不宣稱安全、固定附 165）（2026-11-19：`demo-antifraud.js`；`guardrails.js` 以句為單位改寫保證安全的說法、送 guardrail、固定附 165；示範與模型模式都套用；prompt 加防詐護欄）
- [x] M7-06 E2E：防詐頁建議問題、風險卡片、護欄（2026-11-19：手機＋桌面從首頁格子進入、5 個建議問題逐題、風險卡片高／中、總結有 165 且無安全保證；截圖已檢查）

## M10 生活開放資料（首頁格子）

2026-11-19 Austin：首頁「規劃中」的格子全部接上開放資料；M8 產業移到下一階段。每個服務＝一個 tool（pack `life`）＋一種卡片＋`#/s/:id` 服務頁（`public/js/pages/service.js`），網頁、問阿幫、MCP 共用。

- [x] L-01 服務頁框架 `#/s/:id`（定位、表單、卡片、重新定位）；捷運（既有 tool）、天氣（`weather` 卡片）
- [x] L-02 地震（中央氣象署，`CWA_API_KEY`）（2026-11-19：`earthquake_recent`（E-A0015-001 顯著有感＋E-A0016-001 小區域、最大震度、指定縣市震度、報告連結）；`quake` 卡片；無授權碼用示範片段）
- [x] L-03 空氣品質（環境部）（2026-11-19：`aqi_nearby`（aqx_p_432，`MOENV_API_KEY`；無金鑰用示範片段；回應不是 JSON 視為金鑰無效）；`aqi` 卡片（等級色彩＋文字））
- [x] L-04 藥局（健保署）（2026-11-19：`pharmacy_search`（健保署 CSV 每日、約 1 萬家；**資料沒有座標**→以地區／名稱搜尋、地圖搜尋連結；排除已歇業；今天營業時段）；`pharmacy` 卡片）
- [x] L-05 垃圾車（縣市環保局）（2026-11-19：`garbage_truck_nearby`（臺北市清運點位＋時間，週日週三停收；新北市路線＋星期欄位＋即時 GPS；其他縣市待擴充）；`garbage` 卡片）
- [x] L-06 油價（台灣中油）（2026-11-19：`fuel_price`（中油 JSON，民國生效日）；`fuel` 卡片）
- [x] L-07 發票對獎（財政部）（2026-11-19：`invoice_lottery`（財政部 RSS 最近 6 期；8 碼或末 3 碼對獎；增開六獎已不在資料中）；`invoice` 卡片內可再對獎）
- [x] L-08 E2E、文件（2026-11-19：首頁 8 格逐一進入（手機）、卡片、無「規劃中」格子、發票卡片內對獎；截圖已檢查）
- [x] L-09 問阿幫也能用生活服務（2026-11-19：life profile v2 加 `life` 工具包 6 個 tool、persona／規則／生活護欄；示範模式 7 種新意圖（天氣、空品、地震、藥局、垃圾車、油價、發票）；建議問題 8 個；@點名角色；示範藥局補臺北市中正區片段）
- [x] L-10 空品進決策引擎（2026-11-19：狀態 `badAir`「空品不佳」（`exposure` ×3、`effort` ×2）；`plan_trip` 起點 AQI > 100 自動加入、輸出 `air`；決策圖 空品 → 空品不佳；示範 `DEMO_AIR=bad`；ADR-0010 權重紀錄）
- [x] L-11 我的發票（本機自動對獎）（2026-11-19：`invoice_check_batch`（期別、開獎日、中獎／沒中／待開獎／超過範圍）；網頁「我的發票」存在手機、打開 App 時開獎日已到自動對獎並通知；問阿幫主動提議。不串 Gmail／載具（需保存使用者憑證，屬 ADR 變更））
- [ ] L-15 財政部手機條碼載具（2026-11-19 規劃；互動模型情境「載具」）：連結表單（同意事項＋手機條碼＋驗證碼，只存手機、不在對話輸入）→ `invoice_carrier_list` 抓發票存進「我的發票」→ 開獎自動對。⛔ 前提：公司以營業人身分向財政部財政資訊中心申請電子發票 API AppID／APIKey（審查、授權最長 3 年、流量管制；APIKey 只放伺服器加簽）；驗證碼屬個資、伺服器轉查不保存 → 需 ADR
- [x] L-17 判斷層導入（2026-11-20：`core/agent/judge.js`；意圖＝嵌入分類器有把握用它、否則問地端模型；狀態＝規則 ∪（A ∩ B）；示範模式照判斷意圖抽參數、模型模式狀態以判斷層為準＋地端模型縮減工具；實驗意圖 94.2%、全對 89.5%）
- [ ] L-16 指揮阿幫排程＋綜合知識（2026-11-19 規劃；互動模型情境「排程」「綜合知識」）：「開獎後幫我自動對發票」「每天 8 點跟我說天氣和台積電」建立排程（存手機、可暫停刪除；只排 L1 查詢與通知，L2 只提醒）；「今天要注意什麼」組合多來源成可展開的「今日重點」卡片。網頁版只在打開 App 時補跑；準時推播需推播伺服器與使用者訂閱 → 需 ADR
- [x] L-14 選公車就盯到站＋到站提醒（2026-11-20：`plan_trip` 公車方案 `follow`；`bus_route_eta` 加 `stop`／`direction` → `focus`；執行器 `busFollowUp` 決策選公車後自動盯上車站（示範與模型相同）；卡片大倒數、你在這上車、到站前 3／5 分提醒（`host.watchArrival`，趕不上這班就提醒下一班）、開公車頁看動態；公車頁 `?stop=&dir=`；提醒只在 App 開著時。2026-11-19 使用者提出；互動模型見 `docs/prototypes/agent-interaction.html` 情境 9：決策選公車 → 自動 `bus_route_eta` 上車站即時到站、開公車頁看動態、「到站前 N 分提醒我」通知）
- [x] L-13 掃發票 QR code（2026-11-19：`public/js/invoice-qr.js` `parseInvoiceCode`（左邊 QR：字軌＋號碼＋民國日期；右邊 `**` 提示；一維條碼 → 期別）；`BarcodeDetector`＋相機的連續掃描視窗，完成後一次對獎；不支援時改手動輸入；E2E 以假 BarcodeDetector 與 canvas 相機測試）
- [x] L-12 股市收盤行情（2026-11-19：`stock_quote`（pack `finance`；證交所 STOCK_DAY_ALL、櫃買中心收盤、加權與櫃買指數，免金鑰，30 分快取；代號或名稱、多檔、找不到不丟錯、`similar`）；`stock` 卡片（漲紅跌綠＋▲▼、卡片內查別檔、`setContext`）；首頁「股市」格子；問阿幫：股市意圖、追問（「那聯發科呢？」）、問買賣先說不提供投資建議；`PACK_GUARDRAILS.finance`＋輸出護欄 `no-investment-advice`；地端模型 5 種情境實測）

## M8 中小企業概念驗證（概要）— 下一階段（2026-11-19 決定）

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

## M11 行動 App（ADR-0013，2026-11-20 開始）

Capacitor 8 把現有網頁包成 Android／iOS App（同一份前端），呼叫同一 agent API 與卡片契約（ADR-0008）。

- [x] M11-01 App 殼（2026-11-20：ADR-0013；`npm run build:app` 打包 `dist/app`＋注入 API 位址；`public/js/base.js` 的 `API_BASE`；伺服器對 App 來源加 CORS（`APP_ORIGINS`）；App 內不註冊 service worker；`android/`、`ios/` 原生專案；Android 只對本機位址允許明碼 http；Android 模擬器實測問阿幫可用、iOS 模擬器版編譯成功）
- [x] M11-02 到站提醒改手機本機通知（2026-11-20：`@capacitor/local-notifications` 8.3.1；`public/js/native-notify.js` 經原生橋接呼叫；每次查到到站時間就把通知排到預估時間（同一則覆蓋、差不到 20 秒不重排），App 到背景或被關掉時系統照最後一次預估送出；車比預估早到就馬上送；取消提醒＝取消排好的通知；出發提醒也改本機通知；文字「App 關著也會提醒」；網頁維持現狀。iOS 模擬器與 Android 實機（Pixel）：權限、排程、App 關閉後送達 ✅）
- [x] M11 名稱 Abang、藍鵲 agent 造型（冠羽、耳麥、HUD）與 App 圖示（含 Android 主題單色圖示）（2026-11-21，PR #31）
- [x] M11 Android 返回手勢回上一層、首頁離開 App（PR #31）
- [x] M11 原生定位 `@capacitor/geolocation`（iOS 只問一次權限）、鍵盤打開收起分頁列、iOS 隱私清單（2026-11-21，PR #33）
- [ ] M11-03 原生相機掃發票 QR（網頁退路保留）
- [x] M11-04 啟動畫面（藍鵲＋Abang，iOS／Android 舊版圖片、Android 12+ 系統啟動畫面底色與圖示）、隱私權政策頁 `#/privacy`、設定頁 `#/settings`（2026-11-21；聯絡方式待營運單位補上）
- [ ] M11-05 ⛔ 測試環境部署（HTTPS，M6-06）＋ Google Play 內部測試、TestFlight（需開發者帳號）

## M12 裝置端 AI（ADR-0014，2026-11-21）

- [x] E1 ADR-0014：手機先判斷意圖與狀態，以 `deviceJudge` 提示伺服器；只收列舉值；方案仍由 `decide.js` 計分
- [x] E2 前端降級鏈 `public/js/edge-judge.js`（1.8 秒逾時、斷路器、外掛失敗照常）
- [x] E4 iOS Apple Intelligence（Foundation Models，`AbangEdgeAIPlugin.swift`）：模擬器可執行；實機待 iPhone 15 Pro 以上
- [x] E5 Android Gemini Nano（ML Kit GenAI Prompt API）：Pixel 11 Pro XL 實機意圖 90.1%、p50 約 270 ms；只在 Wi-Fi 下載模型（新依賴 `com.google.mlkit:genai-prompt`：依 Austin 2026-11-21「edge ai 盡量開發」加入，正式上架前請 Austin 再確認授權條款）
- [x] E6 實機評測 `scripts/eval-edge.js`、組合分數 `eval-edge-combo.js`（A＋規則＋Gemini Nano 全對 89.0%，`docs/research/edge-eval.md`）
- [ ] E3 App 內 transformers.js 分類器（第三層備援）
- [ ] E7 手機上轉述（伺服器沒有模型時仍能完整回答）
- [x] E8 設定頁可關閉裝置端 AI、顯示模型狀態（下載中、需要 Wi-Fi…）、隱私權政策說明（2026-11-21）

## M13 Agent 聰明度（PM 情境清單，2026-11-21）

情境集：`test/scenarios/life.json`（`npm test` 示範模式；`scripts/eval-scenarios.js` 模型模式）。

- [x] A0 情境對話測試集（2026-11-21 晚：78 個情境，todo 0）
- [x] A2 轉述受程式約束：抵達時間、交通方式、不要的方式、狀態只採使用者說的；`plan_trip` 下一步；回答不露出工具名稱；起訖點已知的行程由程式先比較（PR #34）
- [x] S16 位置當起點：捷運沒說站找最近的站（指定路線只找該線）、拒絕定位先從臺北車站算並說明（PR #34）
- [x] A3 結構化上下文：接著改起點、目的地、時間、不要某方式、重來；「沿用：…｜改：…」（PR #35）
- [x] A1 新狀態（第一批）：帶長輩、帶小孩、行動不便（排除不適合的方式）；S13 出門建議（天氣＋空品）（PR #36）
- [x] A1b 新狀態（第二批）：`group` 多人（叫車人均）、`rainSoon`（降雨機率 ≥ 60% 提醒帶傘）、`tight` 時間很緊（快趕不上）；`night` 由 S10 末班車規則處理（2026-11-21）
- [x] S10 深夜末班車（示範規則：00～05 時公車不列入、23 時後提醒末班；真實以 TDX 到站狀態為準）（2026-11-21）
- [x] S7 捷運方案與轉乘（捷運線間轉乘一次，估算；2026-11-21）
- [ ] S7b 公車＋捷運混合轉乘、真實捷運路網（TDX S2STravelTime／ODFare）
- [x] S12 觀光客英文對話（第一版：英文規則、地名別名、英文總結；2026-11-21）
- [ ] S12b 卡片與討論串英文、更多英文地名
- [x] S1 明天天氣（預報）：`weather_tomorrow`（2026-11-21）
- [ ] S11／S15 多筆提醒、公車一直不來時重新規劃
- [x] 「重來」分隔線、沒變的卡片收合、決策圖收班節點（2026-11-21）
- [x] 出門建議小卡（傘、衣著、口罩）：`outing_advice` 工具＋`outing` 卡片（2026-11-21）
- [x] S1 常用地點（家、公司、學校：「回家」直接成行程；座標只在手機、提到才送）（2026-11-21）
- [ ] S1b 常用地點：輸入地址或地名設定（`find_place` 選結果）、顯示「已設定：XX 附近」讓人確認；設在別處（不必人在現場）
- [ ] S1c 定位失敗分原因（拒絕／定位服務關閉／逾時）＋「到設定開啟」按鈕（專案內外掛加 openAppSettings，Android ACTION_APPLICATION_DETAILS_SETTINGS、iOS openSettingsURLString）；Android `prompt-with-rationale` 顯示為已拒絕
- [ ] S1d 本機資料改存 Capacitor Preferences（iOS 可能清掉 WKWebView 的 localStorage；新依賴要 ADR，PrivacyInfo 加 UserDefaults CA92.1；收藏、我的發票同理）
- [x] S16 高鐵／台鐵「最近車站」當起站（2026-11-21：`near`；「下一班高鐵到台中」「台鐵回高雄幾點有車」）
- [ ] S16 藥局定位轉行政區
- [x] S6 叫車人均（多人：4 人一輛、超過叫多輛）（2026-11-21）
- [ ] S5 YouBike 空位預測（騎到時可能沒位）
- [ ] S17 長途訂票（導訂票權限 ⛔）、S18 超出範圍與安全（拒答、轉介）擴充情境

## 體驗與品質補強（審查與 PM 建議，2026-11-21）

- [x] T6 iOS 名稱 Abang（`CFBundleName`；不改 `PRODUCT_NAME` 以免動到 Capacitor 的 App 目標與路徑）；iOS 18 深色／著色圖示（`scripts/build-icons.js`；Xcode 編譯通過，實機深色主畫面待確認）（2026-11-21）
- [x] T7 通知體驗：第一次提醒前的說明（為什麼要通知）、`remind()` 可取消與多筆、重開機後過期通知不補送；設定頁列出出門提醒（2026-11-21）
- [ ] T8 測試補強：busScene DOM 測試、E2E `page.clock` 固定日夜、原生 App 煙霧測試（adb／simctl，或 Maestro）
- [x] 首次使用引導（起點用現在位置、點方案改選、提醒 App 關著也會響；在這裡要定位與通知權限）（2026-11-21）
- [ ] 行程中模式（選定公車後：街景＋倒數＋下車提醒，抵達自動結束）、下車提醒（到某站前 1 站）
- [ ] 離線與弱網：快取最近一次結果，顯示「上次更新時間」

## 被卡住的項目（2026-11-21 彙整）

| 項目 | 卡在哪 | 誰 |
|---|---|---|
| 真實交通資料、M1 驗證、真實末班車與轉乘 | TDX Client ID／Secret | Austin |
| 高鐵／台鐵導訂票（M3-12、S17） | TDX 導訂票權限 | Austin |
| 真實天氣、地震／空品 | CWA 授權碼／MOENV 金鑰 | Austin |
| iOS Apple Intelligence 實機（E4） | iPhone 15 Pro 以上並開啟 Apple Intelligence | Austin |
| App 給別人用（TestFlight、Play 內測） | HTTPS 測試環境（M6-06）、Apple／Google 開發者帳號 | Austin |
| App 名稱 Abang 商標與商店撞名 | 智慧局檢索、商店搜尋 | Austin／法務 |
| Claude 模式與 MCP 連接器實測（M4-09） | `ANTHROPIC_API_KEY`、cloudflared | Austin |
| MyDrama 短劇（選公車後看短劇） | mydrama-workpack、公司 Bitbucket repo、授權與分潤；需 ADR | Austin |
| 推播排程（L-16）／手機條碼載具（L-15） | 推播伺服器與 ADR／財政部 AppID | Austin／公司 |
| 文件站發布 | repo Settings → Pages | Austin |
| 地標座標校對（201 筆）、正式 3D 吉祥物圖 | 人工校對、設計師 | Austin／設計資源 |
| Jev 實驗 | Jev 金鑰（可不做） | Austin |
- [ ] 之後：推播伺服器（排程，另寫 ADR，L-16）、地端 AI（判斷層放手機）、Siri 捷徑／App Intents、Android 小工具、App Attest／Play Integrity

## 其他候選（未排程）

地震、AQI（環境部）、藥局（健保署）、發票對獎（財政部）、TDX MaaS 多段轉乘、使用者帳號、民眾需求報表（給交通主管機關）。

## 市場現況備忘（2026-11）

- 交通部 TDX 已有官方 MCP（臺鐵／高鐵班次與票價、導訂票、道路事件；遠端 HTTP、需會員金鑰）。本專案不重複包裝 API，差異化在：跨資料組合（`plan_trip`）、討論串與決策圖、互動卡片、免帳號民眾 agent。M3-05／06 可評估直接介接官方 MCP（ARCHITECTURE「外部 MCP」）。
- 民間已有 data.gov.tw 資料集、政府採購、法規等 MCP；M8 先評估接用。
