# 開發紀錄

每輪（`docs/LOOP.md`）完成後在**最上面**加一筆。格式：

```
## YYYY-MM-DD 任務代號 標題
- 做了：…
- 測試：npm test N 項全過（新增 M 項）
- 文件：更新了哪些
- 下一個：任務代號
- 卡住：無／原因與需要 Austin 做的事
```

---

## 2026-11-19 M6 地端部署驗證
- 做了：`docker-compose.yml`（讀 `.env`、地端模型指向主機 Ollama、唯讀、no-new-privileges）；`docker compose up -d --build` 實測：`/healthz` agent=local、網頁 agent 以 qwen3:8b 回答高鐵最早班（約 18 秒、答案正確）、MCP 18 個 tools、卡片資源 404 KB
- 決定：Austin 指示雲端部署、Redis、Lighthouse 留到正式環境階段，先衝刺功能
- 下一個：M7 反詐騙 agent
- 卡住：M1 TDX 金鑰

## 2026-11-18 M6-01、02、04、07 上線準備
- 做了：`Dockerfile`（兩階段、只裝正式依賴、node 使用者、檔案唯讀、HEALTHCHECK）＋`.dockerignore`＋`/healthz`；本機 docker build／run 驗證（發現本機 `core/tools` 等目錄權限 700，COPY 後 node 讀不到 → 映像內統一 `chmod a+rX`）。`server/log.js` 結構化 log（JSON、severity、tenantId、agentId、存取 log 不含 query、錯誤遮金鑰）。無障礙：跳到主要內容、焦點框、`aria-current`、`--off` 對比 3.1 → 5.0、卡片與公車頁播報到站；看截圖發現首頁範例問題白底白字（M5-12 起）→ 已修。`.github/workflows/pages.yml` 發布 docs。SW v0.3.5
- 測試：npm run lint 無錯誤；npm test 198 項全過（新增 7 項）；npm run e2e 21 項全過（新增 2 項）
- 文件：ARCHITECTURE §7／§8、UX §10、README（Docker、/healthz）、TESTING、PLAN、CLAUDE、index.html
- 下一個：M6-03／05 待新依賴同意（Redis、lighthouse）；M6-06 待部署帳號
- 卡住：M1 TDX 金鑰；Pages 需在 repo 設定啟用

## 2026-11-18 M4-04～06、M4-08 MCP Apps 互動卡片
- 做了：新增 devDependency `@modelcontextprotocol/ext-apps` 1.7.5（2.x 需 SDK v2；1.7.x peer 為 v1 → ADR-0006 維持 v1）；`host-mcp-app.js`（callServerTool／sendMessage／updateModelContext／openLink；iframe 沙箱不能 `window.confirm`，L2 確認框與複製連結在卡片下方）；`mcp-app.js` 入口；`scripts/build-cards.js`（`npm run build:cards` → `dist/cards.html`，單檔約 394 KB）；MCP 資源 `ui://abang/cards.html` 與 tool `_meta.ui.resourceUri`（開發時記憶體內打包、正式環境讀 dist）；卡片色彩變數也套到確認框；CI 加 build:cards
- 測試：npm run lint 無錯誤；npm test 191 項全過（新增 4 項）；npm run e2e 19 項全過（新增 AppBridge 經 `/mcp` 載入 7 種卡片、updateModelContext、訂票 → 確認 → openLink；每張卡片截圖已檢查，發現確認框按鈕因色彩變數只在 `.ab-card` 而看不見 → 已修）
- 文件：ADR-0006、CARDS §3／§3.1／§6、TESTING、PLAN、README、CLAUDE、ARCHITECTURE、index.html、CI
- 下一個：M4-09 Claude 實測（Austin：本機 npm start＋cloudflared）；M6 上線準備
- 卡住：M1 TDX 金鑰申請中

## 2026-11-18 M5-05 模型模式（Claude＋地端模型）
- 做了：ADR-0012 三種模式（claude／local／demo，`AGENT_PROVIDER` 或自動選）；`core/agent/claude.js`（`@anthropic-ai/sdk` 串流、prompt cache、effort low）、`local.js`（OpenAI 相容 fetch，Ollama 等，去 `<think>`、可關閉思考）、共用 `model-loop.js`（agent_note、5 輪上限、refusal／截斷、device_location、參數去 null）、`provider.js`；`server/agent.js` 接上每日預算降級與 log（不記內容）；問阿幫頁標示模式與資料去向；plan_trip 自動併入畫面點選的狀態。用地端 qwen3:8b 實玩發現並修正：高鐵／台鐵「下一班」原本回當天第一班 → 工具文字與 speak 只講未開出班次、卡片收起已開出班次；SW 更新會裝進 HTTP 快取的舊檔 → 安裝時 `cache: 'reload'`（v0.3.4）
- 測試：npm run lint 無錯誤；npm test 187 項全過（新增 `test/agent-model.test.js` 等 16 項）；npm run e2e 全過
- 文件：ADR-0012、AGENT §3／§4／§6／§7／§8、ARCHITECTURE、README、.env.example、MCP_TOOLS、CARDS、TESTING、PLAN、CLAUDE、index.html
- 下一個：M5 完成；剩 M4-04／05／06／08（待新依賴 `@modelcontextprotocol/ext-apps` 同意）、M1（TDX 金鑰）
- 卡住：Claude 實機需 `ANTHROPIC_API_KEY`；市區短程權重待決定

## 2026-11-18 M5-13 示範模式建議問題截圖（部分）
- 做了：E2E 逐題點 6 個建議問題（手機＋桌面），檢查討論串、對應卡片（trip／bus-route／youbike／timetable）、行程有決策圖，每題截圖；E2E 伺服器放寬 `AGENT_RPM`。看截圖發現並修正 3 件事：①「明天 8 點前要到左營」在示範資料下全部遲到 → 建議題改 9 點；② 全部遲到時行程卡改說「所有方式都趕不上指定時間…」；③ 高鐵顯示「182 分」（很早出發把 67 分等車算進去）→ 班次制等車最多算 10 分、`leaveAt` 往後延、抵達以實際班次計算（ADR-0010 紀錄；跨城塞車最後一名變叫車）
- 測試：npm run lint 無錯誤；npm test 171 項全過（新增 1 項）；npm run e2e 18 項全過
- 文件：MCP_TOOLS §7、ADR-0010、AGENT、TESTING、PLAN、CLAUDE
- 下一個：無不受阻的任務——M5-05（Claude 模式，待決定 SDK 或 fetch）、M4-04／05／06／08（待新依賴同意）
- 卡住：PR #2 合併、市區短程權重、兩個新依賴決定

## 2026-11-18 M5-12 首頁以問阿幫為入口
- 做了：首頁搜尋框改為「問阿幫」（`#/agent?q=` 自動送出、送出後網址換成 `#/agent`）、3 個範例問題；功能格子與分頁列保留；離線 Demo 版維持公車搜尋；SW v0.3.3
- 測試：npm run lint 無錯誤；npm test 170 項全過；npm run e2e 16 項全過（首頁問題 → bus-route 卡片；公車搜尋改由 `#/bus?q=` 進入）；`npm run build:demo` 正常
- 文件：UX §3、TESTING、PLAN、CLAUDE
- 下一個：M5-13（Playwright 示範 6 個建議問題截圖；Claude 模式 mock 測試待 M5-05）
- 卡住：同前

## 2026-11-18 M5-11 輕量 3D
- 做了：結果卡片與決策圖 `.enter3d` 立體進場（`rotateX(8deg)`＋`translateZ`，依序延遲）；決策圖重算 FLIP 排名翻轉（Web Animations、最多 3 個）；`lite()`（`hardwareConcurrency ≤ 4` 或 reduced motion）→ `html.lite-motion` 只淡入；SW v0.3.2
- 測試：npm run lint 無錯誤；npm test 170 項全過；npm run e2e 16 項全過（新增完整動態模式：3D 進場與翻轉；reduced motion 模式不翻轉）
- 文件：UX §9、TESTING、PLAN、CLAUDE
- 下一個：M5-12（首頁以 agent 為主要入口）
- 卡住：同前

## 2026-11-18 M5-10 結論卡行動
- 做了：trip 卡（M4-02 已有建議、分段條、備案、導航、叫車、訂票）補「提醒我出門」：`plan_trip` 高鐵／台鐵／客運方案帶 `leaveAt`（發車 − 到站時間）；`host-web.remind`（系統通知、需允許、12 小時內）；卡片只對今天且 1 分鐘後的出門時間顯示按鈕，設定後顯示「好，HH:mm 提醒你出門」
- 測試：npm run lint 無錯誤；npm test 170 項全過（trip 測 leaveAt）；npm run e2e 14 項全過（假 host 驗證提醒）
- 文件：MCP_TOOLS Option、CARDS host、TESTING、PLAN、CLAUDE
- 下一個：M5-11（輕量 3D 與排名翻轉）
- 卡住：同前

## 2026-11-18 M5-09 決策圖
- 做了：`public/ui/agent/decision-graph.js`（資料 → 你的狀態 → 方案 → 建議四欄 SVG；自動狀態虛線連回天氣／路況；連線粗細＝分數；排除方案灰階刪除線；勝出路徑與關鍵資料來源亮起；狀態 chips 切換／加選即時以同一份 `decide.js` 重算，關掉自動狀態時理由句加「不考慮『…』的話」；明細長條標示前兩項；SVG `title`／`desc` 文字替代）；伺服器白名單提供 `/core/decide.js`；`plan_trip`／`decision` 帶 `arriveBy`／`arriveByMin`；CSS 分段動畫、reduced motion 直接顯示；SW v0.3.1
- 測試：npm run lint 無錯誤；npm test 170 項全過（新增重算一致性）；npm run e2e 14 項全過（決策圖互動、截圖已檢查）
- 文件：UX §5、TESTING、PLAN、CLAUDE
- 下一個：M5-10（結論卡：建議＋分段條＋備案＋行動）
- 卡住：同前

## 2026-11-18 M5-08 問阿幫頁面
- 做了：`public/js/pages/agent.js`（`#/agent`：使用者泡泡、小幫手討論串 `role=log`／角色色彩頭像／@角色 chip／metrics／討論完成收合與展開、卡片以 `renderCard`、狀態與理由、總結泡泡、建議問題、@ 點名列、裝置定位流程、離線 Demo 版提示）；`public/css/agent.css`；`GET /api/v1/agent/profile`；Service Worker 版本 v0.3.0 並快取新檔
- 測試：npm run lint 無錯誤；npm test 169 項全過；npm run e2e 14 項全過（新增問阿幫流程，手機截圖已檢查）
- 文件：UX、TESTING、README、PLAN、CLAUDE
- 下一個：M5-09（決策圖）
- 卡住：同前

## 2026-11-18 M5-07 裝置端工具（定位）
- 做了：`run.js` 需要位置且客戶端支援時送 `client_tool_call device_location`，`deviceLocation` 只採台灣範圍座標（「你的位置」）；`demo-intent.js` 行程／YouBike／附近公車可用定位座標；`T.point` 座標可帶 `name`；`public/js/agent/client.js`（`runAgent` 讀 NDJSON、執行 client tool、重送；`browserLocation`）
- 測試：npm run lint 無錯誤；npm test 169 項全過（新增 2 項）
- 文件：AGENT §3.4、MCP_TOOLS 共用型別、TESTING、PLAN、CLAUDE
- 下一個：M5-08（網頁 agent 頁面）
- 卡住：同前

## 2026-11-18 M5-06 Agent 端點
- 做了：`server/agent.js` `createAgentHandler`（先驗證、NDJSON 串流 `runDemo`、例外以 `error`＋`done` 結束；限流每分鐘／每日 key＝agent id＋IP；每日計量 requests／toolCalls／modelCalls；log 不記對話與座標）；`server/http.js` 掛上 `POST /api/v1/agent`（無 CORS、405、429 帶 retry-after）；OpenAPI 加 `/api/v1/agent`
- 測試：npm run lint 無錯誤；npm test 167 項全過（新增 3 項）
- 文件：AGENT §6、ARCHITECTURE、README、TESTING、PLAN、CLAUDE
- 下一個：M5-08（網頁 agent 頁面；M5-05 Claude 模式待決定 SDK／fetch，M5-07 client tools 可並行）
- 卡住：同前

## 2026-11-18 M5-04 Agent 共用執行器
- 做了：`core/agent/run.js`：`validateRequest`、`execTools`（平行、先 start 後依完成順序 result、plan_trip 後 decision、profile 白名單、錯誤經 publicMessage）、`runDemo`（示範模式完整事件流；picked 狀態帶進 plan_trip 並在 decision 標 `picked`）
- 測試：npm run lint 無錯誤；npm test 164 項全過（新增 5 項）
- 文件：AGENT §3.3、TESTING、PLAN、CLAUDE
- 下一個：M5-06（`POST /api/v1/agent` NDJSON；M5-05 Claude 模式待決定 SDK 或 fetch）
- 卡住：同前

## 2026-11-18 M5-03 示範模式意圖
- 做了：`core/agent/demo-intent.js`：`placesInText`（內建地標名稱／別名，長的優先、車站短名）、`arriveByOf`、狀態關鍵字、`parseIntent`（trip、bus_route、youbike、nearby_bus、metro、rail、unknown）、`demoSteps`（分段計畫，`agent_note` 以 @角色開頭）、`demoSummary`
- 測試：npm run lint 無錯誤；npm test 159 項全過（新增 6 項；profile 的 6 個建議問題都能以示範資料完整執行）
- 文件：AGENT §5、TESTING、PLAN、CLAUDE
- 下一個：M5-04（共用執行器 run.js）
- 卡住：同前

## 2026-11-18 M5-02 Agent 事件
- 做了：`core/agent/events.js`（11 種事件的建立函式、registry 帶入 title／role／pack／tier、`tool_result` 帶卡片 payload 與 metrics、`decision` 由 plan_trip 資料組成、`toNdjson`、`mergeStates`、`TOOL_ROLES`）；AGENT.md 狀態來源 `said` 統一為 `user`（與 plan_trip／CARDS 一致）
- 測試：npm run lint 無錯誤；npm test 153 項全過（新增 4 項）
- 文件：AGENT §3.1／§3.2、TESTING、PLAN、CLAUDE
- 下一個：M5-03（示範模式意圖）
- 卡住：同前（PR #2 合併、權重、新依賴）

## 2026-11-18 M5-01 Agent profile 與 system prompt
- 做了：`core/agents/life.json`（加 `version`、`persona`、`rules`，建議問題 6 個）；`core/agents/index.js`（zod `.strict()` 驗證、tools 必須在 registry、pack 必須列在 packs、不可重複）；`core/agent/prompt.js`（平台政策 → 工具包護欄 → 角色 → 情境；工具結果與情境只當資料）。新分支 `dev/m5`（疊在 `dev/m4`）
- 測試：npm run lint 無錯誤；npm test 149 項全過（新增 3 項）
- 文件：AGENT §1／§4、ARCHITECTURE、TESTING、PLAN、CLAUDE
- 下一個：M5-02（事件）
- 卡住：M4-04 起新依賴；M5-05 Claude 模式需決定用 `@anthropic-ai/sdk` 或 fetch（新依賴待同意）

## 2026-11-18 M4-07 卡片動態
- 做了：`public/ui/cards/countdown.js`（`etaLabel` 與伺服器 `busStatusText` 同規則；`startCountdown` 每秒依重畫後經過時間遞減 `[data-eta-sec]`、跨門檻換 `soon`、數字變化 `.ab-tick` 提示；reduced motion 只換文字）；bus-route／bus-station 加 `data-eta-sec`（只限正常營運狀態）；公車車牌標記 `.ab-bus`
- 測試：npm run lint 無錯誤；npm test 146 項全過（新增 2 項）；npm run e2e 12 項全過
- 文件：CARDS §1.1、TESTING、PLAN、CLAUDE
- 下一個：M4-04 `host-mcp-app.js`（⛔ 需新增依賴 `@modelcontextprotocol/ext-apps`，等 Austin 同意）；M4-05／06／08 都依賴它
- 卡住：新依賴待同意

## 2026-11-18 M4-02 卡片渲染
- 做了：`public/ui/cards/` 7 種卡片（bus-route 方向切換與點站牌、bus-station、nearby 卡片內展開到站、youbike 借／還排序、metro、timetable 塞車延誤／隔日／排除／訂票、trip 建議＋分段條＋備案＋排除＋狀態 chips）；`index.js` 外框與刷新；`dom.js`（不用 innerHTML、https 白名單）；`actions.js`；`cards.css`（淺色）；`host-web.js`（M4-04 的網頁 host，無新依賴）；`preview.html`；`thsr_timetable`／`tra_timetable` 補 `system`（卡片標題與訂票依它判斷）
- 測試：npm run lint 無錯誤；npm test 144 項全過；npm run e2e 12 項全過（新增卡片預覽，手機＋桌面截圖已檢查）
- 文件：CARDS §1.1、ARCHITECTURE、MCP_TOOLS、TESTING、PLAN、CLAUDE
- 下一個：M4-04 `host-mcp-app.js`（需新增依賴 `@modelcontextprotocol/ext-apps`，停下等 Austin）
- 卡住：新依賴待同意

## 2026-11-18 M4-03 卡片文字字典
- 做了：`public/ui/cards/i18n/zh-TW.js`：`t(key, vars)`、`MESSAGES`（共通、L2 確認視窗、bus-route、bus-station、nearby、youbike、metro、timetable、trip）
- 測試：npm run lint 無錯誤；npm test 144 項全過（新增 3 項）
- 文件：CARDS §1、TESTING、PLAN、CLAUDE
- 下一個：M4-02（卡片渲染）
- 卡住：M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`（待 Austin）

## 2026-11-18 M4-01 卡片資料契約
- 做了：`public/ui/cards/schema/` 7 種契約（bus-route、bus-station、nearby、youbike、metro、timetable、trip；JSON Schema 2020-12 子集）＋零依賴驗證器 `validate.js`；`bus_nearby_stations`、`youbike_nearby`、`bus_station_eta` 的 `data` 改物件（`stations`／`arrivals`＋查詢參數）；`callTool` 回 `v`（有卡片時）與 `args`，MCP `structuredContent` 帶 `v`／`tool`／`args`；OpenAPI 更新。新分支 `dev/m4`（疊在 PR #2 上）
- 測試：npm run lint 無錯誤；npm test 141 項全過（新增 14 項 cards-schema）；npm run e2e 10 項全過
- 文件：CARDS §4／§6、MCP_TOOLS §1／§3／§4、TESTING、PLAN、CLAUDE
- 下一個：M4-03（卡片文字字典）→ M4-02（卡片渲染）
- 卡住：M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`（待 Austin）

## 2026-11-18 M3 里程碑收尾驗收
- 驗收（PLAN M3）：`npm test` 127 項全過 ✅；`plan_trip` 10 組 OD 排序與理由句（`test/trip-od.test.js`）✅；示範模式逐一呼叫 18 個 tools 全部成功 ✅；`GET /api/v1/tools` 列出 18 個（≥ 17）✅；`npm run lint` 無錯誤、`npm run e2e` 10 項全過
- 未完成：M3-12 真實導訂票（⛔ TDX 導訂票權限）；所有 TDX／CWA 真實欄位待 M1
- 文件：PLAN 狀態看板、`docs/index.html`（M3 狀態、tools 表、資料來源、架構）
- 待 Austin：① 授權合併 PR #2；② 無狀態市區短程叫車第一是否調整權重（ADR-0010）；③ M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`
- 下一個：M4-01（卡片資料契約）

## 2026-11-18 M3-12 導訂票（權限前部分）
- 做了：`core/services/booking.js`（`validateBooking`：車次、張數 1～4、日期今天～28 天、車廂只限高鐵、車站比對；真實版在權限前回 `UserError`「尚未開通」並附官方訂票網站，不呼叫 TDX）、`booking-mock.js`（官方網站首頁、15 分時效、標示示範）；tool `rail_booking_link`（transit、L2、`confirmText`）
- 測試：npm run lint 無錯誤；npm test 127 項全過（新增 4 項；tools 18 個）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§6、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3 里程碑收尾驗收
- 卡住：真實導訂票需 Austin 在 TDX 申請「臺鐵訂票導訂」「高鐵訂票導訂」權限

## 2026-11-18 M3-14 英文名稱保留
- 做了：`util.en`／`enField`（TDX `En` 非空才輸出）；公車 `routeNameEn`／`stopNameEn`／站位 `nameEn`、YouBike `nameEn`（去前綴）、高鐵台鐵車站 `nameEn`、捷運 `nameEn`／`stationEn`／`lineEn`／`destinationEn`、路況路段 `nameEn`
- 測試：npm run lint 無錯誤；npm test 123 項全過（新增 3 項）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §1、TESTING、PLAN、CLAUDE
- 下一個：M3 里程碑收尾驗收（M3-12 ⛔ 需 TDX 導訂票權限）
- 卡住：M3-12 需導訂票權限；無狀態市區短程叫車第一待 Austin 決定

## 2026-11-18 M3-13 計量 metrics
- 做了：`core/metrics.js`（`measure`、`recordFetch`、`countRecords`；`AsyncLocalStorage` 隔開同時進行的請求）；`tdx-client`、`cwa-client` 在快取命中與上游回應時記錄；`callTool` 回傳 `metrics: { calls, cacheHits, cacheHit, scanned, ms }`；MCP 放結果 `_meta['abang/metrics']`；OpenAPI `ToolResult` 加 `metrics`
- 測試：npm run lint 無錯誤；npm test 120 項全過（新增 5 項 metrics）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §1、AGENT §3.1、ARCHITECTURE、TESTING、PLAN、CLAUDE
- 下一個：M3-14（英文名稱 `nameEn`）
- 卡住：無（計量帶 agent id 於 M5）

## 2026-11-18 M3-11 plan_trip 固定 OD 測試
- 做了：`test/trip-od.test.js` 10 組 OD（市區短程無狀態／下雨／想省錢／帶行李＋少走路、1.5 公里、台中下雨、跨城無狀態／塞車／趕時間＋12:00 前到、新竹想省錢），先確認兩次執行結果相同；「想省錢」`cost` 倍數 3 → 5（×3 時市區叫車與公車同分、叫車勝出），記錄於 ADR-0010 並在 `decide.test.js` 加情境
- 測試：npm run lint 無錯誤；npm test 115 項全過（新增 10 項 OD、1 項 decide）
- 文件：ADR-0010（權重調整紀錄）、TESTING、PLAN、CLAUDE
- 下一個：M3-13（metrics）；M3-12 需 TDX 導訂票權限
- 卡住：待 Austin 決定——無狀態時市區短程（1.5～5 公里）叫車排第一是否符合產品預期（ADR-0010 權重調整紀錄）

## 2026-11-18 M3-10 行程規劃 plan_trip
- 做了：`core/services/trip.js` `planTrip()`：起點天氣＋沿途路況 → 自動狀態（下雨、塞車中）；7 種候選方案（步行、YouBike、公車直達、高鐵、台鐵、國道客運、叫車）各自容錯，失敗列 `unavailable`；`decide()` 排序與理由；`stationPoint` 由內建地標對照車站座標。`core/services/bus-direct.js`（`matchDirect` 以站點座標驗方向、`commonRoutes`）＋ `bus.directTrips`（live 與 mock）。tool `plan_trip`（卡片 `trip`，輸出對齊 `CARDS.md`）
- 測試：npm run lint 無錯誤；npm test 104 項全過（新增 9 項 trip、1 項 decide 跨午夜；tools 17 個）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§7（方案門檻與估算表）、CARDS `trip`、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3-11（10 組固定 OD 測試）
- 卡住：無；公車直達、客運、軌道真實欄位待 M1

## 2026-11-18 M3-09 叫車連結
- 做了：`core/providers/ridehail/`（`uber.js` 深層連結：無上車點用 `my_location`、座標 6 位小數、暱稱編碼；`index.js` provider 註冊、`estimateFare` 以臺北市計程車費率＋直線 × 1.3 估區間並標 `estimated`、`createRidehailServices`）；tool `ridehail_link`（pack `ridehail`、L2、`static`，description 要求先確認，回傳 `confirmText` 給 M4 確認視窗）；PR #1 已合併，改在 `dev/m3-2` 開發
- 測試：npm run lint 無錯誤；npm test 93 項全過（新增 4 項 ridehail；tools／REST 數量改 16、packs 加 ridehail）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§6、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3-10（`plan_trip`）
- 卡住：無

## 2026-11-18 M3-QA 品質基礎與 review 修正
- 做了：Playwright E2E（`scripts/e2e.js`，手機＋桌面 5 個流程、截圖、每個 context try/finally 關閉）；Swagger（`server/rest.js` 路由表、`server/openapi.js` 產生 OpenAPI 3.1、`/api/docs` Swagger UI 白名單）；ESLint（`eslint.config.js`）；CI 加 `npm run lint` 與 E2E（截圖上傳 artifact）。review 修正：`weather_now` 的 `rainMm1h` 改取雨量站 `O-A0002-001` `Past1hr`（氣象站 `Now.Precipitation` 是當日累積）、新增 `rainStation`；`intercity` ISO 出發用該日星期、深夜列出 3 小時內隔日班次 `nextDay`；REST／MCP 非 `UserError` 只回通用訊息（`publicMessage`）；`/api/docs/constructor` 不再 502 洩漏路徑；`traffic_status` 改 `from`／`to` 名稱＋`fromPoint`／`toPoint`；`zh`／`arr`／`odataStr` 移到 `util.js`；路況 `congestionOf()`、`shapesOf()` 快取
- 測試：npm run lint 無錯誤；npm test 89 項全過（新增 errors、OpenAPI、weather 雨量站與同名鄉鎮、intercity 隔日／跨午夜／ISO、metro 轉乘站代碼、413 與錯誤 CORS）；npm run e2e 10 項全過
- 文件：LOOP（每輪 lint → test → e2e → /code-review → /security-review → push PR 分支）、TESTING、CLAUDE、README、ARCHITECTURE、MCP_TOOLS、DATA_SOURCES、PLAN
- 審查：code-review、security-review、agy 獨立審查結果貼在 PR #1
- 下一個：M3-09（`ridehail_link`）
- 卡住：無

## 2026-11-18 M3-08 現在天氣
- 做了：`core/cwa-client.js`（授權碼只在請求網址、快取鍵不含）；`core/services/weather.js`（自動站＋局屬站取最近有資料者、`-99` 視為無資料、鄉鎮 3 小時降雨機率、`isRaining`）＋ `weather-mock.js`（clear／rain）；tool `weather_now`（pack `weather`）；`defineTool` 加 `modeOf`／`demoNote`，天氣的 live／demo 只看 `CWA_API_KEY`；`loadEnv` 讀 `CWA_API_KEY`、`DEMO_WEATHER`
- 測試：npm test 75 項全過（新增 6 項 weather；tools 15 個、packs transit＋weather）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §1／§2／§7、DATA_SOURCES §3、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-09（`ridehail_link`）
- 卡住：真實天氣需 Austin 申請 CWA 授權碼（已列 Austin 待辦）；欄位待驗證

## 2026-11-17 M3-07 國道客運班次
- 做了：`core/services/intercity.js`（站牌 1.5 km 配對與方向、`ServiceDay`、站序備援、沒有下車時間時估算、跨日、路況延誤 `arriveWithDelay`、`delayRisk`）＋ `intercity-mock.js`；tool `intercity_bus`（卡片 `timetable`）；`util.nowTW／toMin／toHHMM`；`T.point` 共用（traffic 也改用）
- 測試：npm test 69 項全過（新增 6 項 intercity；tools／mcp 數量改為 14）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§7、CARDS `timetable`、DATA_SOURCES、ARCHITECTURE、TESTING、README、PRD、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-08（`weather_now`；真實資料需 CWA 授權碼，先做 mock 與介面）
- 卡住：無；客運端點欄位待 M1 驗證，票價端點未確認

## 2026-11-17 M3-06 沿途國道路況
- 做了：`core/services/traffic.js`（路段形狀走廊＋方向判斷、依行進順序、`summarize`：壅塞累計 5 km 即 jam、延誤只計慢路段、沒資料回 null）＋ `traffic-mock.js`（smooth／jam）；tool `traffic_status`（地名或座標，`core/tools/traffic.js`）；`places.resolvePoint` 供 plan_trip 共用；`createServices({ demo })` 與 `DEMO_TRAFFIC` 接上
- 測試：npm test 63 項全過（新增 6 項 traffic；tools／mcp 數量改為 13）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§7、DATA_SOURCES、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 另：程式推上 GitHub，`main`＝初始匯入，M3 在 `dev/m3`，PR #1
- 下一個：M3-07（`intercity_bus`）
- 卡住：無；國道路況端點與欄位待 M1 驗證

## 2026-11-17 M3-05 高鐵／台鐵票價
- 做了：`rail.thsrFare`、`rail.traFare`（`normFares`：票種、身分、車廂代碼轉中文，成人單程在前，未知代碼顯示「代碼 N」，無效價格略過；台鐵 v3 依車種展開）＋示範版（依站距估算）；tool `rail_fare`
- 測試：npm test 57 項全過（新增 3 項；tools／mcp 數量改為 12）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§5、DATA_SOURCES、README、PRD、TESTING、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-06（`traffic_status`）
- 卡住：無；票價代碼對照與台鐵車種代碼待 M1 驗證

## 2026-11-17 M3-04 捷運車站與即時到站
- 做了：`core/services/metro.js`（四系統、同名多線合併、看板依分鐘排序、目的地備援 `TripHeadSign`）＋ `metro-mock.js`（真實站名、近似座標、模擬每 6 分一班）；tools `metro_stations`、`metro_live_board`（卡片 `metro`、附 `nav`），放在 `core/tools/metro.js`；`createServices` 改為 transit 與 metro 共用同一個 TDX client
- 測試：npm test 54 項全過（新增 6 項 metro；tools／mcp 數量改為 11）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§5、CARDS `metro`、DATA_SOURCES、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-05（`rail_fare`）
- 卡住：無；捷運看板欄位待 M1 驗證

## 2026-11-17 M3-03 內建地標與 find_place
- 做了：`core/data/landmarks.json` 201 筆（車站、機場、景點、夜市商圈、學校、醫院、機關，涵蓋本島與離島各縣市）；`core/services/places.js`（`normPlace` 不省略「站」、分數排序、縣市篩選）；tool `find_place`（附 `nav`）；`defineTool` 新增選填 `source`／`static`，MCP 依 tool 標示資料來源、內建資料不加示範提示
- 測試：npm test 48 項全過（新增 8 項 places；tools／mcp 數量改為 9）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §1／§2／§7、DATA_SOURCES §5、ARCHITECTURE、TESTING、README、PLAN（Austin 待辦加座標校對）、CLAUDE
- 下一個：M3-04（捷運 `metro_stations`、`metro_live_board`）
- 卡住：無；地標座標是近似值待 Austin 校對（`verified: false`）；外部地理編碼待 M1

## 2026-11-17 M3-02 公車路線站點座標與路線形狀
- 做了：新增 `core/geo.js`（`parseWkt`、`pathFromWkt`、`thinPath`）；`bus_route_eta` 站點帶 `lat/lon`（`StopPosition`）與 `nav`，回傳去程 `shape`；形狀端點失敗或格式不明時省略 `shape`；mock 依縣市中心產生站點座標與形狀
- 測試：npm test 40 項全過（新增 9 項：geo 5、transit 3、nav 1）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§3／§6、DATA_SOURCES、ARCHITECTURE、TESTING、PLAN（含 M1 待驗證表）、CLAUDE
- 下一個：M3-03（`landmarks.json`＋`find_place`）
- 卡住：無；Bus Shape 的實際欄位與 WKT 格式待 M1 驗證

## 2026-11-17 M3-01 導航連結與出發時機
- 做了：新增 `core/nav.js`（`navLinks`、`walkMinutes`、`leaveAt`、`withNav`）；`bus_nearby_stations`、`youbike_nearby` 每筆附 `nav`（tool 層包裝，live／mock 一致），tool 描述註明 nav
- 測試：npm test 31 項全過（新增 `test/nav.test.js` 7 項）
- 文件：MCP_TOOLS §6、PLAN、ARCHITECTURE、TESTING、CLAUDE 目錄
- 下一個：M3-02（`bus_route_eta` 站點座標＋路線形狀 WKT）
- 卡住：無（原本資料夾未 `git init`；2026-11-17 Austin 同意後初始化，隨初始 commit 提交）

## 2026-11-17 文件整理 v0.4（規劃 session）
- 做了：全面整理規格以配合討論串、決策引擎、導航／訂票／叫車；新增 UX、CARDS、DATA_SOURCES、TESTING、LOOP、PROGRESS、ADR-0011、ADR 索引；PLAN 改為任務代號與狀態看板；文件網站同步更新。
- 測試：npm test 24 項全過
- 下一個：M3-01
- 卡住：M1（TDX 金鑰）、M3-12（導訂票權限）、M3-08 真實資料（CWA 授權碼）

## 2026-11-17 M3-00 決策引擎、M3-00b speak（規劃 session）
- 做了：`core/decide.js`（比例／絕對計分、狀態權重、arriveBy 硬限制、理由句）；8 個 tools 加 `speak`
- 測試：npm test 24 項全過（decide 7 項）

## 2026-11-17 M2 Tool registry＋遠端 MCP（規劃 session）
- 做了：`core/tools/` registry、`/mcp`、`/mcp/:pack`、REST tools、限流
- 測試：stdio／HTTP／REST 三路徑一致
- 卡住：Claude 實機連線待 Austin 以 cloudflared 驗證
