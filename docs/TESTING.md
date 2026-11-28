# 測試規格

版本：v0.5（2026-11-18）。目前：`npm run lint` 無錯誤、`npm test` 171 項全過、`npm run e2e` 18 項全過（手機＋桌面各 9）。

## 1. 原則

- 不連外網：所有測試在示範模式＋fixture 下可跑（CI 與雲端沙盒都連不到 TDX）。
- 每個新功能必有測試；修 bug 先寫能重現的測試。
- 測試只用 Node 內建 `node:test`、`node:assert`；E2E 用 Playwright（devDependency，Chromium）。不新增測試框架。
- 每輪依序：`npm run lint` → `npm test` → `npm run e2e` → `/code-review` → `/security-review`（`docs/LOOP.md` §1）。

## 2. 層級

| 層級 | 檔案 | 測什麼 | 何時 |
|---|---|---|---|
| 正規化 | `test/transit.test.js`、`test/<domain>.test.js` | TDX 形狀 fixture → 服務輸出格式（`MCP_TOOLS.md`） | 每個 service |
| 導航 | `test/nav.test.js` | 連結格式與編碼、無效座標、步行時間、出發時機、tools 附 `nav`（含 `bus_route_eta` 站點與示範 `shape`） | M3-01 起 |
| 叫車 | `test/ridehail.test.js` | Uber 連結格式（`my_location`、上車座標、暱稱編碼）、`estimateFare` 起跳與續程、未知 provider、tool 的 L2／pack／確認文字／地名轉座標 | M3-09 起 |
| 天氣 | `test/weather.test.js` | 氣象署形狀 fixture：WGS84、-99、最近測站、雨量站 `Past1hr`（不用當日累積）與 5 公里距離上限、預報解析、授權碼不出現在輸出、預報／局屬站／雨量站失敗；示範情境；`weatherMode` 與 TDX 金鑰獨立 | M3-08 起 |
| 客運 | `test/intercity.test.js` | 站牌配對與方向、`ServiceDay`（ISO `departAt` 用該日星期）、站序備援、估算抵達、跨日、深夜列出 3 小時內隔日班次（`nextDay`）、延誤、只查配對路線、路況失敗仍回班次、示範與 tool | M3-07 起 |
| 路況 | `test/traffic.test.js` | 走廊與方向判斷、整體 level 與延誤、TDX 形狀 fixture（反向／格式不明路段、事件篩選與失敗）、短程不查、示範情境、tool 地名與座標 | M3-06 起 |
| 捷運 | `test/metro.test.js` | TDX 形狀 fixture：同名多線合併、看板查同站所有代碼、排序、目的地備援；錯誤訊息；示範模式四系統；tools 的 card／speak／nav | M3-04 起 |
| 地點 | `test/places.test.js` | `landmarks.json` 筆數、欄位、名稱與別名不重複、同縣市距離合理；比對順序、臺／台、「站」不省略、縣市篩選、`find_place` tool | M3-03 起 |
| 幾何 | `test/geo.test.js` | WKT `LINESTRING`／`MULTILINESTRING`、SRID 前綴、經緯度順序、壞輸入回空、抽樣保留頭尾 | M3-02 起 |
| 決策 | `test/decide.test.js` | 權重、狀態、硬限制、理由句（ADR-0010） | 改 `decide.js` 必跑；改權重需新增情境 |
| 行程 | `test/trip.test.js` | M3-10：車站座標對照、公車直達配對與方向、YouBike 費率、市區短程四種方案、跨城自動狀態（下雨＋塞車）與抵達時間排除、來源失敗只略過、tool；M3-11：`test/trip-od.test.js` 10 組固定 OD（示範模式＋固定時間：第一名、排除、最後一名、自動狀態、理由句關鍵字） | M3 |
| Registry | `test/tools.test.js` | 每個 tool 有 `pack`/`tier`/`speak`、參數驗證錯誤訊息、`callTool` 格式 | 每個 tool |
| MCP | `test/mcp.test.js` | 起 server（隨機埠、`DEMO_MODE=1`）；stdio 與 HTTP 列出／呼叫；三路徑一致；405/404/429；`/api/docs` 白名單（`package.json`、路徑穿越、`constructor` 等原型名稱皆 404） | 每個 tool 自動涵蓋 |
| 導訂票 | `test/booking.test.js` | 車次、張數、日期範圍、車廂、車站驗證；示範連結與時效；真實版「尚未開通」附官方網站；tool L2 | M3-12 起 |
| 英文名稱 | `test/english.test.js` | `en`／`enField` 只輸出非空英文；公車站位、YouBike（去前綴）、高鐵車站、捷運車站／路線／目的地 | M3-14 起 |
| 計量 | `test/metrics.test.js` | `countRecords`、TDX 上游與快取計數、同時進行的 `measure` 互不干擾、CWA 計量、`callTool` 回傳 metrics、MCP 放 `_meta` | M3-13 起 |
| 錯誤訊息 | `test/errors.test.js` | `UserError` 原樣回傳；上游或程式錯誤對外只回通用訊息（REST 與 MCP），不洩漏上游回應、檔案路徑 | 改錯誤處理時 |
| API 文件 | `test/openapi.test.js` | OpenAPI 3.1 由 `server/rest.js` 路由表與 tool registry 產生：每個 REST 路由有 GET 文件與參數說明、每個 tool 有 POST 文件（request body 即 tool 的 JSON Schema）、`operationId` 唯一 | 新增路由或 tool 自動涵蓋 |
| 卡片倒數 | `test/cards-countdown.test.js` | `etaLabel` 與 `busStatusText` 一致；`startCountdown` 以假時鐘驗證遞減、跨門檻換文字與 `soon`、不小於 0 | M4-07 起 |
| 卡片文字 | `test/cards-i18n.test.js` | `t()` 佔位符與缺鍵；每則非空、括號成對、不含常見簡體字；每種卡片與 L2 確認視窗有必要文字 | M4-03 起 |
| 結構化 log | `test/log.test.js` | 一行一個 JSON、Cloud Logging 欄位、tenantId／agentId、金鑰遮蔽、路徑去 query；`test/mcp.test.js` 另測 `/healthz` 不限流、伺服器 stdout 每行都是 JSON 且不含座標 | M6-02 起 |
| 無障礙 | `test/a11y.test.js` | 卡片播報句、PWA 播報節流（第一次不念、相同不重念）、淺色／深色主題與卡片色彩對比 ≥ 4.5 | M6-04 起 |
| MCP Apps host | `test/host-mcp-app.test.js` | `payloadOf`（structuredContent、isError 用 tool 文字）；callTool → callServerTool；ask／setContext 只在 host 支援時送；openLink 只開 https、L2 取消不開 | M4-04 起 |
| 卡片契約 | `test/cards-schema.test.js` | 小驗證器本身；每個有卡片的 tool 都有契約且 7 種一一對應；11 組示範輸出（含塞車客運、雨天跨城行程）通過對應 schema；payload 帶 `v`／`tool`／`args` | M4-01 起 |
| 示範意圖 | `test/agent-demo-intent.test.js` | 地點擷取、抵達時間、意圖與狀態；每個建議問題的計畫以示範資料完整執行並以卡片結尾、`agent_note` ≤ 30 字；prefs 與明天日期帶入 plan_trip | M5-03 起 |
| Agent 事件建立 | `test/agent-events.test.js` | 每個 tool 有角色名；必要欄位；registry 帶入；`tool_result`／`decision` 來自真實 callTool；`mergeStates` 去重與來源；前端以 `decision` 重算＝伺服器排名（含跨午夜抵達） | M5-02 起 |
| Agent profile | `test/agent-profile.test.js` | life 通過驗證；未知欄位、不存在 tool、pack 不符、重複都擋下；system prompt 段落順序、日期、脈絡截斷 | M5-01 起 |
| Agent 端點 | `test/agent-http.test.js` | 起 server：NDJSON 串流、無 CORS、400／405／429；`client.js` 的定位流程（取得／拒絕）；handler 限流以 agent id＋IP、計量、結束事件 | M5-06 起 |
| Agent 執行器 | `test/agent.test.js` | 示範模式事件順序（`status` → `agent_note` → `tool_start`… → `tool_result`… → `decision` → `discussion_end` → `text` → `done`）、各意圖以卡片結尾、picked 狀態、白名單與錯誤不外洩、請求驗證；限流於 M5-06 | M5-04 起 |
| 模型迴圈 | `test/agent-model.test.js` | 以本地假 Anthropic SSE（`ANTHROPIC_BASE_URL=http://127.0.0.1:{port}`）與假 OpenAI 相容伺服器回放工具呼叫；5 輪上限；定位；refusal／截斷；錯誤；預算降級；`pickProvider` | ✅ M5-05 |
| 情境對話（A0） | `test/scenarios.test.js`＋`test/scenarios/life.json`、`life-q.json`（PM「該問就問、不該問就不問」Q-1～Q-27；`test/ask-q.test.js` 另外用假外掛「合理／亂來」跑手機出題）；模型模式 `scripts/eval-scenarios.js`（不進 CI） | PM 盤點 S1～S18 的多輪對話：有定位時用了哪些工具、狀態、最佳方案、抵達時間、起點是你的位置、總結必含／不得含；還做不到的情境標 `todo`（開發目標，不算失敗）。新情境先寫進 JSON 再開發 | 2026-11-21 起 |
| 轉述受程式約束（A2） | `test/agent-grounded.test.js` | 模型自加的抵達時間、交通方式丟掉（`groundedPrefs`）、回答不露出工具名稱（`hideToolNames`）、plan_trip 文字的「下一步」依建議方式、捷運最近站（`near`）與預先查詢沿用 | 2026-11-21 起 |
| E2E 冒煙 | `scripts/e2e.js`（`npm run e2e`） | 示範模式起伺服器（隨機埠、清空金鑰），Playwright 手機（iPhone 13）與桌面：首頁問阿幫（輸入 → `#/agent` 自動送出 → 卡片）與公車搜尋、公車路線去返程、附近（定位）、高鐵台鐵時刻表、Swagger UI；無 console／頁面錯誤；截圖存 `test/screenshots/`（不進版控）；每個 browser context 以 try/finally 關閉；M4-02 起加卡片預覽（7 種卡片皆渲染、公車方向切換與點站、附近站牌展開到站、YouBike 排序、行程建議／分段條／理由、高鐵訂票按鈕、卡片內沒有 script）；M5-08 起加問阿幫（建議問題 → 討論串 → 收合 → trip 卡片 → 總結、@ 點名、瀏覽器定位「你的位置」）；M5-09 起加決策圖（勝出方案、理由、加選「想省錢」即時重算且建議改變、不呼叫伺服器、明細長條）；M5-10 起加提醒我出門（假 host：今天 30 分鐘後出門 → 呼叫 remind、顯示已設定）；M5-13 起加建議問題逐題（M10 起 8 題，含藥局與發票）（討論串、正確卡片、行程有決策圖、每題截圖 `*-suggest-N.png`）；M5-11 起加動態兩種模式（reduced motion → `lite-motion` 不翻轉；完整動態 → `enter3d` 動畫與重算排名翻轉）；M4-08 起加 MCP Apps（AppBridge 經 `/mcp` 載入 `ui://abang/cards.html`，7 種卡片、updateModelContext、訂票確認後 openLink，截圖 `mcp-app-*.png`）；M6-04 起加無障礙（第一個 Tab 是跳到主要內容且有焦點框、Enter 移到 main、分頁列 aria-current、公車頁與每張卡片有 live region、首頁範例問題不是白字） | 每輪 |
| Lint | `eslint.config.js`（`npm run lint`） | ESLint 推薦規則＋Node／瀏覽器 globals；`node_modules`、`dist`、`docs`、`test/screenshots` 除外 | 每輪 |

## 3. Fixture

- 位置：`test/fixtures/<source>-<endpoint>.json`（例：`tdx-bus-eta-taipei-307.json`）。
- M1 之前：手寫 TDX 形狀資料（欄位依官方 Swagger）；M1-02 起以 `scripts/record-fixtures.js` 錄製真實回應（截前 5 筆）。
- 載入：`test/helpers/fake-tdx.js` 以路徑比對回傳 fixture，注入 `createTransitService({ tdx: fake })`。
- 不錄使用者位置；不放金鑰。

## 4. 示範模式情境開關（mock）

| 變數 | 值 | 效果 |
|---|---|---|
| `DEMO_MODE` | `1` | 強制 mock |
| `DEMO_WEATHER` | `rain`／`clear` | `weather_now` mock 結果（M3-08） |
| `DEMO_AIR` | `bad`／`good` | 示範空品：`bad` 時測站 AQI 調到對敏感族群不健康，`plan_trip` 自動加「空品不佳」（M10） |
| `DEMO_TRAFFIC` | `jam`／`smooth` | `traffic_status` mock 結果（M3-06） |
| `DEMO_BUS` | `off`／`offLive` | 示範直達公車有兩條、比較快的那條上車站今日未營運：`off` 規劃時就看得到；`offLive` 盯到站才發現（阿幫重排、改推另一條） |
| `DEMO_NOW` | ISO 時間 | 固定「現在」，讓時刻表與倒數可重現 |

測試內優先以參數注入（`createServices({ demo: { weather: 'rain' } })`），環境變數給手動展示用。

## 5. Playwright 慣例

第一次在本機跑需要下載 Chromium：`npx playwright install chromium`（只需一次；CI 用 `--with-deps`）。

```js
import { chromium, devices } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices['iPhone 13'] });
const errors = []; page.on('pageerror', (e) => errors.push(e)); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${port}/`);
// ... 操作 ...
assert.equal(errors.length, 0);
await page.screenshot({ path: 'test/screenshots/agent-trip-rain.png', fullPage: true });
```

- 人看的截圖 `deviceScaleFactor: 2`；只給自己檢查用 1。
- 等待以事件或元素為準（`waitForSelector('[data-event=done]')`），不要固定 sleep。
- 動畫測試設 `reducedMotion: 'reduce'` 跑一次，確認最終狀態一致。

## 6. CI

`.github/workflows/ci.yml`（PR 與推 `main` 時跑，`DEMO_MODE=1`）：Node 22、`npm ci` → `npm run lint` → `npm test` → `npm run test:clock`（不同時段，見下） → `npm run build:demo` → `npx playwright install --with-deps chromium` → `npm run e2e`；E2E 截圖上傳為 artifact `e2e-screenshots`（保留 7 天）。`npm run build:cards`（M4-05）接在 `build:demo` 之後。

### 結果不能看跑測試的時間（V1，2026-11-28）

`npm run test:clock`（`scripts/test-clock.js`）用假時鐘（`test/support/fake-clock.mjs`，`FAKE_TW=HH:mm`）把「現在」挪到台灣時間 06:00、10:30、15:00、22:30、00:30 各跑一次全部單元測試，任一時段失敗就失敗。抓過的例子：「9點前到」在早上 9 點後跑變 21:00（沒說早晚、已過的抵達時間推到晚上），CI 只在台灣白天紅。

寫測試時：跟時間有關的一律給固定時間——`parseIntent(q, { now })`、`arriveByOf(text, now)`、`departTimeOf(text, arriveBy, now)`、情境集的 `"at": "07:00"`、`runDemo(…, { now })`。只想跑某個時段：`CLOCK_TIMES=15:00 npm run test:clock`。

## 7. 本機真實資料檢查（Austin）

```bash
cp .env.example .env   # 填 TDX_CLIENT_ID / TDX_CLIENT_SECRET / CWA_API_KEY
node scripts/verify-tdx.js            # M1-01：所有端點狀態
node scripts/record-fixtures.js       # M1-02：錄製 fixture
DEMO_MODE=0 npm start                 # 真實資料
```


## 卡片視覺的 DOM 測試（T8，2026-11-21）

- `scripts/e2e.js`「公車街景與天氣卡日夜」：在瀏覽器直接渲染 `busScene`，驗證讀屏標籤（還有幾站、就在你這站）、公車位置（越近越靠站牌）、推估不出不畫車、圖片載不到只留文字；天氣卡依觀測時間（台灣時間 18～6 點）顯示夜晚或白天。
- `test/motion-helpers.test.js`：`sceneOf` 雨／雲／日夜邊界（含 UTC 時間）。
- 原生 App 煙霧測試（T8b）需要實機或模擬器，不在 CI。

## Android 實機煙霧測試（T8b，2026-11-21）

`npm run smoke:android`（`scripts/smoke-android.js`，不在 CI）：adb 連到手機、重開 App，經 WebView 偵錯通道（debug 版）用 Playwright `connectOverCDP` 連進 App 畫面，檢查：

- 原生外掛都有註冊：Geolocation、LocalNotifications、AbangEdgeAI、AbangSystem（專案內外掛要手動註冊，漏了不會報錯）
- 首頁、問阿幫、公車路線、天氣、附近、設定都畫得出來；浮動阿幫只在問阿幫頁以外出現
- 浮動阿幫拉出對話、Android 返回鍵收起
- 沒有畫面錯誤；每頁截圖在 `test/screenshots/android-*.png`

先決條件：`npm start`（App 經 `adb reverse` 連 8787）、App 已安裝（`npm run app:sync` 後 `gradlew installDebug`）。不解鎖手機、不改手機設定；`--keep` 不重開 App。手機螢幕關著（Dozing）時：返回鍵那項略過並說明（不喚醒手機）；點按改用頁面內直接點（螢幕不畫畫面時等不到「穩定」）；定位逾時的錯誤是環境，不算畫面錯誤。

## iOS 模擬器煙霧測試（T8c，2026-11-23）

`npm run smoke:ios`（`scripts/smoke-ios.js`，不在 CI）：重開模擬器上的 App，經模擬器的 Web Inspector 通道（跟 Safari「開發」選單同一條 unix socket `com.apple.webinspectord_sim.socket`；`scripts/webinspector.js` 自己做二進位 plist 編解碼，不加依賴、不加 XCUITest target）連進 App 的 WKWebView（Capacitor debug 版才可檢查），檢查：

- 原生外掛都有註冊：Geolocation、LocalNotifications、AbangEdgeAI、AbangSystem、AbangVision、AbangVoice、AbangHealth、AbangWatch
- 首頁、服務、提醒、我的、問阿幫、公車路線、天氣、附近、設定、阿幫的腦袋都畫得出來；中央「問阿幫」鍵在、分頁列標對格子
- AbangVoice.available、AbangHealth.status 回得來（只問狀態，不跳權限框）；語音能用時有麥克風鍵
- 中央鍵拉出對話、收起鍵收回（iOS 沒有返回鍵）
- 沒有畫面錯誤（console 錯誤，物件參數會展開）；手機上的 AI 在背景失敗只列警告
- App 沒有閃退（同一個行程）、`~/Library/Logs/DiagnosticReports` 沒有新的 App 當機報告
- 每頁截圖用 `simctl io screenshot` 存到 `test/screenshots/ios-*.png`

先決條件：Xcode、開著一台模擬器（`IOS_SIM=<UDID>` 指定，否則第一台開著的）、`npm start`（模擬器跟電腦共用網路，App 直接連 localhost:8787）。`--build`：先打包（`ABANG_API_BASE` 預設 http://localhost:8787）、`cap sync ios`、`xcodebuild`（未簽章 debug 版）、`simctl install`；`--keep` 不重開 App。未簽章的建置 webinspectord 回報的 bundle id 是「process-App」，所以用 `simctl launch` 給的 pid 找 App。

沒涵蓋：真的手指點按與滑動（simctl 沒有點按指令，點按都是頁面內 `click()`）、系統權限框（不改模擬器設定，重新安裝後第一次會跳定位權限框，截圖看得到但不影響畫面檢查）、HealthKit（未簽章沒有 entitlement，回報 no-entitlement）、手機上的 AI（模擬器沒有 Apple Intelligence）、語音辨識（模擬器不支援手機上辨識）、相機。
