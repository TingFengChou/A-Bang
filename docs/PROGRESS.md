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

## 2026-11-18 M3-QA 品質基礎與 review 修正
- 做了：Playwright E2E（`scripts/e2e.js`，手機＋桌面 5 個流程、截圖、每個 context try/finally 關閉）；Swagger（`server/rest.js` 路由表、`server/openapi.js` 產生 OpenAPI 3.1、`/api/docs` Swagger UI 白名單）；ESLint（`eslint.config.js`）；CI 加 `npm run lint` 與 E2E（截圖上傳 artifact）。review 修正：`weather_now` 的 `rainMm1h` 改取雨量站 `O-A0002-001` `Past1hr`（氣象站 `Now.Precipitation` 是當日累積）、新增 `rainStation`；`intercity` ISO 出發用該日星期、深夜列出 3 小時內隔日班次 `nextDay`；REST／MCP 非 `UserError` 只回通用訊息（`publicMessage`）；`/api/docs/constructor` 不再 502 洩漏路徑；`traffic_status` 改 `from`／`to` 名稱＋`fromPoint`／`toPoint`；`zh`／`arr`／`odataStr` 移到 `util.js`；路況 `congestionOf()`、`shapesOf()` 快取
- 測試：npm run lint 無錯誤；npm test 84 項全過（新增 errors、OpenAPI、weather 雨量站、intercity 隔日與 ISO）；npm run e2e 10 項全過
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
