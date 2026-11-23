# CLAUDE.md — 阿幫（A-Bang）

給 Claude Code 的專案指引。每次開始先讀這份，再照 `docs/LOOP.md` 做一輪（一個任務）。

## 專案一句話

串接台灣政府開放資料的 AI 助手「阿幫」（吉祥物：台灣藍鵲；手機 App 商店名稱 **Abang**）。**網頁優先**，第一階段是**大眾交通**。
核心是一組 **MCP tools**：同一套 tools 給 (1) Claude 等 MCP client 透過遠端連接器使用、(2) 我們的民眾網頁 agent 使用。
網頁 agent 會呈現**小幫手討論串**（阿幫點名工具、工具一句話回報）與**決策圖**（MCP 資料＋使用者狀態 → 建議），結論以**互動卡片**呈現並可導航、訂票、叫車。

## 目前進度

M0 ✅、M2 ✅、決策引擎 ✅、`speak` ✅、M3-01 導航 ✅、M3-02 路線座標與形狀 ✅、M3-03 `find_place` ✅、M3-04 捷運 ✅、M3-05 票價 ✅、M3-06 路況 ✅、M3-07 國道客運 ✅、M3-08 天氣 ✅（真實資料待 CWA 授權碼）、品質基礎（E2E／Swagger／ESLint／CI）✅、M3-09 叫車連結 ✅、M3-10 `plan_trip` ✅、M3-11 固定 OD 測試 ✅、M3-13 metrics ✅、M3-14 英文名稱 ✅、M3-12 導訂票（權限前部分）🧩；**M3 交通完整版 ✅**（M3-12 真實導訂票待權限）；**M4 互動卡片 ✅**（M4-01 契約、M4-02 渲染、M4-03 字典、M4-04 MCP Apps host、M4-05 打包、M4-06 `ui://` 資源、M4-07 動態、M4-08 AppBridge E2E；M4-09 Claude 實測待 Austin）；M5（M5-01 profile ✅、M5-02 事件 ✅、M5-03 示範意圖 ✅、M5-04 執行器 ✅、M5-06 agent 端點 ✅、M5-07 裝置定位 ✅、M5-08 問阿幫頁 `#/agent` ✅、M5-09 決策圖 ✅、M5-10 結論卡提醒 ✅、M5-11 輕量 3D ✅、M5-12 首頁入口 ✅、M5-13 示範截圖 ✅、M5-05 Claude＋地端模型 ✅）；**M5 網頁 agent ✅**（Claude 實機待金鑰）；M6 上線進行中（M6-01 Docker＋`/healthz` ✅、M6-02 結構化 log ✅、M6-04 無障礙 ✅、M6-07 文件站 workflow ✅、地端 docker compose 驗證 ✅；雲端部署／Redis／Lighthouse 留到正式環境階段）；**M7 阿幫・防詐 ✅**（165 開放資料、規則庫待專家審核、`scam-risk` 卡片、L2 輸出護欄）；**M10 生活開放資料 ✅**（首頁格子：捷運、天氣、空品、地震、藥局、垃圾車、油價、發票、股市收盤；`#/s/:id`）；M11 行動 App 進行中（M11-01 Capacitor 殼、M11-02 本機通知、M11-04 設定與隱私、名稱 Abang 與圖示〔Λ 標誌；藍鵲是 App 內的吉祥物〕、原生定位 ✅）；**M12 裝置端 AI ✅ 第一階段**（ADR-0014：Gemini Nano、Apple Intelligence；**回答也在手機上寫** ✅ ADR-0017：手機支援時伺服器不呼叫模型，程式護欄檢查數字；E9 阿幫的腦袋 `#/ai`：核心動畫、系統回報的模型資訊、現場試判斷、思考動畫「阿幫在想」 ✅）；**M13 Agent 聰明度進行中**（情境集 `test/scenarios/life.json` 全部有第一版：A0／A1／A1b／A2／A3、出門建議小卡、位置當起點、明天天氣、末班車、捷運轉乘、高鐵台鐵最近站、英文與卡片英文、常用地點 ✅）；體驗補強（首次使用引導、出門提醒多筆可取消、離線顯示上次資料、iOS 18 圖示、附近藥局依位置、公車一直不來改其他方式、下車提醒、時間軸點站設上車站、英文提問的討論串與決策圖、安全情境先給求助電話、常用地點用地名設定、定位失敗說原因、行程中模式、英文其餘 S12f）✅；**阿幫常駐 ✅**（換頁對話保留、浮動阿幫、提醒由阿幫說、知道你在哪一頁、App 重開後上次的對話〔只有文字、按「接著上次問」才送〕）；**M14 阿幫聽得懂** 🧩（M14-01 語音問阿幫 ✅：只在手機上辨識、語言包第一次按麥克風時協助下載、不支援就反白說原因、長按中央鍵放開送出；實機待確認）；**問什麼由手機上的 AI 決定** ✅（ADR-0020：手機 judge 同時出題，程式驗證、規則保底；實機待確認）；**Agent 聰明度**：情境 127 個＋防詐 2 個（含 PM 第二～五批：口語、台語、錯字、更正、出發時間、長輩、觀光客英文、回程、急症先叫 119、生活追問、詐騙話術）示範全過、地端模型模式 105／109；Android 實機煙霧測試 `smoke:android` ✅、iOS 模擬器煙霧測試 `smoke:ios` ✅；**頁面質感 ✅**（格子點進去的頁首與圖示動畫、公車街景會動、各頁資料小巧思兩批）；**阿幫・短劇 🧩**（ADR-0019：MyDrama 公開片庫、等車推短劇、問阿幫找劇、運動建議提示句；網址只在 `.env` 的 `MYDRAMA_*`，沒有時用虛構示範片庫；待產品負責人看截圖）；**M14 阿幫會看 ✅**（M14-02：拍簡訊查詐騙、拍站牌問路、拍發票對獎，手機上讀字，ADR-0015；M11-03 原生相機掃發票一起完成）；**M15 健康與運動** 🧩（M15-01 天氣好又動得少時建議去走走 ✅：Health Connect／HealthKit 只讀步數與運動時間、預設關閉、健康資料只在手機，ADR-0018；實機待確認）；M8 產業移到下一階段（`docs/PLAN.md` 狀態看板）；**M1 TDX 實測 ✅**（2026-11-23：`scripts/verify-tdx.js`、`scripts/record-fixtures.js`、`test/tdx-fixtures.test.js`；要 `.env` 的 TDX 金鑰，每分鐘 5 次額度）。

## 必讀文件（依序）

| 文件 | 何時讀 |
|---|---|
| `docs/LOOP.md` | **每輪必讀**：循環開發協定、停止條件、任務 → 必讀文件 |
| `docs/PLAN.md` | **每輪必讀**：狀態看板、任務代號、驗收 |
| `docs/PROGRESS.md` | 每輪讀最後 5 筆、做完在最上面加一筆 |
| `docs/CONTEXT.md` | 第一次：規劃討論的決策摘要 |
| `docs/ARCHITECTURE.md` | 第一次：架構、目錄職責、資料流 |
| `docs/MCP_TOOLS.md` | tool 任務：輸入、輸出、端點、`plan_trip` 演算法 |
| `docs/DATA_SOURCES.md` | 串資料：TDX 認證、端點、TTL、CWA、深層連結 |
| `docs/AGENT.md` | M5：事件協定、system prompt、示範模式、成本 |
| `docs/AGENT_ANTIFRAUD.md` | M7：防詐 agent、165 資料、規則庫、L2 護欄 |
| `docs/UX.md` | M4／M5：畫面、討論串、決策圖動畫、文案、可及性 |
| `docs/CARDS.md` | M4：卡片資料契約與 host 介面 |
| `docs/TESTING.md` | 寫測試時 |
| `docs/BRAND.md` | 寫使用者看得到的文字或圖像時 |
| `docs/PRD.md` | 範圍不確定時 |
| `docs/PLATFORM.md` | 只看「預留項目」；不要實作 Builder |
| `docs/adr/README.md` | 改變決策前（ADR-0015：裝置端的聽與看；ADR-0018：健康資料只在手機） |
| `docs/prototypes/transit-discussion.html` | M5 的視覺與互動參考（假資料，不可被 import） |
| `docs/index.html` | 給人看的文件網站；里程碑收尾時同步狀態 |

## 指令

```bash
npm install
npm start            # http://localhost:8787（PWA ＋ /api/v1 ＋ /mcp）
npm run mcp          # MCP server（stdio）
npm run lint         # ESLint，要零錯誤
npm test             # node:test，全部要過
npm run e2e          # Playwright E2E 冒煙測試（示範模式、手機＋桌面，截圖在 test/screenshots/）
npm run build:demo   # dist/demo.html 單檔示範版
npm run build:cards  # dist/cards.html MCP Apps 卡片單檔（正式環境部署前要跑）
npm run smoke:android # Android 實機煙霧測試（adb＋WebView 偵錯通道：每頁、原生外掛、浮動阿幫、返回鍵；不在 CI）
npm run smoke:ios    # iOS 模擬器煙霧測試（simctl＋Web Inspector 通道：每頁、原生外掛、中央鍵對話、沒有閃退；--build 先建置安裝；不在 CI）
IOS_DEV_TEAM=<Team ID> npm run ios:dev # 把開發版裝到接上的實體 iPhone（走同一個 Wi-Fi 連本機 8787；只在這次建置暫時允許本機網路，建置完還原；不在 CI）
npm run app:sync     # 手機 App（ADR-0013）：打包 dist/app（ABANG_API_BASE）＋ cap sync；再 npx cap open android／ios
docker build -t abang .   # 容器映像（兩階段；/healthz 健康檢查）
```

Node.js ≥ 20。`public/` 不引入前端框架或建置工具（原生 ES modules、免建置）；MCP App 卡片單檔打包用 esbuild。Playwright 是 devDependency，第一次跑 E2E 前要 `npx playwright install chromium`（CI 用 `--with-deps`）。API 文件：`/api/docs`（Swagger UI，規格 `/api/v1/openapi.json` 由 `server/rest.js` 路由表與 tool registry 自動產生，新增路由或 tool 不必手寫文件）。

每輪驗證順序（`docs/LOOP.md` §1）：`npm run lint` → `npm test` → `npm run e2e` → `/code-review` → `/security-review`（需要時請 agy 獨立審查），commit 後推到目前的 PR 分支，不推 `main`。

## 目錄

```
core/            唯一的資料與邏輯層
  tdx-client.js  TDX token／快取
  cwa-client.js  中央氣象署授權碼／快取
  services/      <domain>.js ＋ <domain>-mock.js（介面相同）
  tools/         registry：define.js、index.js、<pack>.js（領域大時分檔，例 metro.js，pack 仍為 transit）
  decide.js      決策引擎（ADR-0010）
  nav.js         導航連結、步行時間、出發時機（ADR-0011）
  metrics.js     每次 tool 呼叫的計量（AsyncLocalStorage）
  geo.js         WKT 路線形狀解析、路徑抽樣
  metro-colors.js 捷運官方路線色
  agent/         M5：prompt.js、events.js、demo-intent.js、run.js、model-loop.js、provider.js、claude.js、local.js ✅；judge.js 判斷層（意圖與狀態：嵌入分類器＋模型＋規則＋裝置端提示，AGENT.md §5.3、ADR-0014）；outing.js 出門建議
  agents/        life.json、antifraud.json（agent profile）＋ index.js（zod 驗證）✅
  opendata-client.js 免金鑰開放資料下載與快取（M10）；services/life.js 生活服務（空品、地震、藥局、垃圾車、油價、發票）；services/stock.js 股市收盤（證交所、櫃買中心）
  edge-write.js  手機寫的回答的程式護欄（ADR-0017，純函式，經 /core/ 給前端）；agent/answer-facts.js 給手機的事實清單
  scam-check.js  防詐規則比對、風險等級、寄件號碼（M7）；data/scam-rules.json 規則庫；csv.js CSV 解析
  vision-text.js 阿幫會看：讀到的字分類（可疑訊息、站牌路牌、發票）與組問題（純函式，前端以 /core/vision-text.js 共用，M14-02）
  health-nudge.js 健康與運動：天氣好又動得少的規則、散步地點、文案、一天一次（純函式，前端以 /core/health-nudge.js 共用；健康資料只在手機，ADR-0018）
  providers/     ridehail/（index.js 註冊與估價、uber.js 深層連結）✅；📝 mcp-client.js（外部 MCP）
  data/          landmarks.json（內建地標，座標待校對）
server/          http.js（REST、/mcp、/api/docs、/healthz、靜態檔）、log.js（結構化 log）、rest.js（路由表）、openapi.js、agent.js（/api/v1/agent）、rate-limit.js
mcp/             create-server.js、server.js（stdio）、cards-resource.js（ui://abang/cards.html）
public/          PWA；ui/cards/（卡片渲染、契約、字典、web host、MCP Apps host 與入口 mcp-app.js；預覽 /ui/cards/preview.html）；js/tabs.js（分頁列：首頁｜服務｜問阿幫中央鍵｜提醒｜我的）、js/pages/home.js＋js/home-now.js（首頁：手機上的 AI、現在摘要）、js/pages/services.js（#/services）、js/pages/reminders.js＋js/reminder-items.js（#/reminders）、js/pages/me.js（#/me）、js/pages/agent.js（問阿幫 #/agent，keepAlive）、js/pages/ai.js（阿幫的腦袋 #/ai：裝置端 AI 核心動畫、模型資訊、現場試判斷；字典 pages/ai-i18n.js、資料整理 js/ai-info.js、css/ai.css）、js/abang-dock.js（對話保留、中央「問阿幫」鍵、提醒泡泡）、js/page-hero.js（格子頁首）、js/trip-bar.js（進行中列）、js/location-help.js（定位失敗原因）、js/agent/client.js（定位：App 用原生外掛）、js/agent/thinking.js（「阿幫在想」核心小動畫：事件 → 階段）、js/edge-judge.js（裝置端 AI）、js/vision.js＋css/vision.css（阿幫會看：相機鍵、看的動畫、確認後才送）、js/voice.js＋js/voice-i18n.js＋js/agent/voice-ui.js（語音問阿幫：狀態機、字典、麥克風鍵與在聽面板，M14-01）、js/health.js＋js/health-ui.js（健康與運動：來源、一天一次、首頁小卡、問阿幫補一句、開關，ADR-0018）、js/keyboard.js、css/agent.css
test/            node:test；fixtures/；scenarios/（情境對話集，A0）
android/、ios/   Capacitor 原生專案（ADR-0013）；前端仍在 public/，打包到 dist/app；專案內外掛 AbangEdgeAI（ADR-0014）、AbangSystem（開 App 設定，S1c）、AbangVoice（語音問阿幫：手機上語音辨識，M14-01）、AbangVision（手機上讀字與條碼，ADR-0015）、AbangHealth（步數與運動時間，只讀，ADR-0018）
docs/            規格、ADR、原型、文件網站
```

## 架構規則（不可違反）

1. **核心層唯一**：所有資料邏輯在 `core/`。`server/`、`mcp/`、`public/` 不得直接呼叫外部 API。
2. **Tool 只定義一次**：在 `core/tools/` 用 `defineTool()`；MCP、REST、網頁 agent 都從 registry 取用。
3. **Mock 對等**：每個真實服務都有介面相同的 mock；沒有任何金鑰時整個系統可完整運作。
4. **金鑰只在伺服器**：從環境變數讀；不送瀏覽器、不寫 log、不進版控、不出現在 fixture。
5. **回傳正規化資料**：依 `MCP_TOOLS.md` 格式，不把 TDX 原始欄位（`Zh_tw`、`EstimateTime`…）漏到上層。
6. **錯誤分類**：輸入錯誤 `UserError`（HTTP 400／MCP `isError`）；上游錯誤 `TdxError`。訊息用繁體中文並說明下一步。
7. **快取優先**：新端點一定要設 TTL（`DATA_SOURCES.md`）。
8. **為平台預留（ADR-0007）**：tool 標 `pack`、`tier`；保留英文名稱；卡片文字放字典；agent 設定是 JSON；計量帶 agent id。不提前實作 Builder 或多租戶。
9. **多端彈性（ADR-0008）**：卡片先定 JSON Schema 再寫渲染；事件協定保留 `client_tool_call`。
10. **小幫手討論串（ADR-0009）**：工具發言用 `speak(data)`（不經模型）；數字來自真實資料；不加假延遲；淺色主題，不做深色 HUD。
11. **決策由程式計分（ADR-0010）**：方案排序一律走 `core/decide.js`；模型只判斷狀態、選工具、轉述結果。改權重要更新測試。
12. **行動需確認（ADR-0011）**：導航、訂票、叫車只產生官方連結；L2 tool 產生前需使用者確認；不代替付款、不收集個資。

## 程式風格

- ES modules、`async/await`、無 TypeScript；型別用 JSDoc。
- 使用者看得到的文字一律**繁體中文（台灣用語）**；比對時「臺／台」視為相同（`normName()`）。
- 檔案小而專一；不加新依賴前先確認 Node 內建能否做到（新增依賴屬停止條件）。

## 完成的定義（每個任務）

- [ ] `npm test` 全過，新功能有測試（`docs/TESTING.md`）
- [ ] 示範模式下可完整操作
- [ ] 規格文件同步（`MCP_TOOLS.md`／`CARDS.md`／`AGENT.md`／`UX.md`／README／`.env.example`）
- [ ] `docs/PLAN.md` 勾選＋狀態看板、`docs/PROGRESS.md` 加紀錄
- [ ] 沒有金鑰、`.env`、個人位置資料進 repo
- [ ] `npm run lint`、`npm run e2e` 全過；`/code-review`、`/security-review` 無未處理問題
- [ ] Conventional Commit（`feat(core): M3-01 …`）；推到目前的 PR 分支，不推 `main`

## 卡住時

不確定的端點或欄位 → 防禦性解析＋列入 PLAN.md M1 待驗證表，不要猜完就當真。需要金鑰、權限、新依賴、改 ADR → 依 `docs/LOOP.md` §2 停下來說明。
