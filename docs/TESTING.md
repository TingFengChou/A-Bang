# 測試規格

版本：v0.5（2026-11-18）。目前：`npm run lint` 無錯誤、`npm test` 89 項全過、`npm run e2e` 10 項全過（手機＋桌面各 5）。

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
| 天氣 | `test/weather.test.js` | 氣象署形狀 fixture：WGS84、-99、最近測站、雨量站 `Past1hr`（不用當日累積）與 5 公里距離上限、預報解析、授權碼不出現在輸出、預報／局屬站／雨量站失敗；示範情境；`weatherMode` 與 TDX 金鑰獨立 | M3-08 起 |
| 客運 | `test/intercity.test.js` | 站牌配對與方向、`ServiceDay`（ISO `departAt` 用該日星期）、站序備援、估算抵達、跨日、深夜列出 3 小時內隔日班次（`nextDay`）、延誤、只查配對路線、路況失敗仍回班次、示範與 tool | M3-07 起 |
| 路況 | `test/traffic.test.js` | 走廊與方向判斷、整體 level 與延誤、TDX 形狀 fixture（反向／格式不明路段、事件篩選與失敗）、短程不查、示範情境、tool 地名與座標 | M3-06 起 |
| 捷運 | `test/metro.test.js` | TDX 形狀 fixture：同名多線合併、看板查同站所有代碼、排序、目的地備援；錯誤訊息；示範模式四系統；tools 的 card／speak／nav | M3-04 起 |
| 地點 | `test/places.test.js` | `landmarks.json` 筆數、欄位、名稱與別名不重複、同縣市距離合理；比對順序、臺／台、「站」不省略、縣市篩選、`find_place` tool | M3-03 起 |
| 幾何 | `test/geo.test.js` | WKT `LINESTRING`／`MULTILINESTRING`、SRID 前綴、經緯度順序、壞輸入回空、抽樣保留頭尾 | M3-02 起 |
| 決策 | `test/decide.test.js` | 權重、狀態、硬限制、理由句（ADR-0010） | 改 `decide.js` 必跑；改權重需新增情境 |
| 行程 | `test/trip.test.js`（M3-11） | 10 組固定 OD：第一名、排除、理由句關鍵字 | M3 |
| Registry | `test/tools.test.js` | 每個 tool 有 `pack`/`tier`/`speak`、參數驗證錯誤訊息、`callTool` 格式 | 每個 tool |
| MCP | `test/mcp.test.js` | 起 server（隨機埠、`DEMO_MODE=1`）；stdio 與 HTTP 列出／呼叫；三路徑一致；405/404/429；`/api/docs` 白名單（`package.json`、路徑穿越、`constructor` 等原型名稱皆 404） | 每個 tool 自動涵蓋 |
| 錯誤訊息 | `test/errors.test.js` | `UserError` 原樣回傳；上游或程式錯誤對外只回通用訊息（REST 與 MCP），不洩漏上游回應、檔案路徑 | 改錯誤處理時 |
| API 文件 | `test/openapi.test.js` | OpenAPI 3.1 由 `server/rest.js` 路由表與 tool registry 產生：每個 REST 路由有 GET 文件與參數說明、每個 tool 有 POST 文件（request body 即 tool 的 JSON Schema）、`operationId` 唯一 | 新增路由或 tool 自動涵蓋 |
| 卡片契約 | `test/cards-schema.test.js`（M4-01） | mock 輸出符合 `public/ui/cards/schema/*.json` | M4 |
| Agent 事件 | `test/agent.test.js`（M5） | 示範模式：4 個建議問題的事件序列（`status` → `agent_note` → `tool_start`… → `decision` → `text` → `done`）；狀態合併；限流 | M5 |
| Claude 迴圈 | `test/agent-claude.test.js`（M5） | 以本地假 Anthropic API（`ANTHROPIC_BASE_URL=http://127.0.0.1:{port}`）回放 tool_use；5 輪上限；錯誤 | M5 |
| E2E 冒煙 | `scripts/e2e.js`（`npm run e2e`） | 示範模式起伺服器（隨機埠、清空金鑰），Playwright 手機（iPhone 13）與桌面：首頁與搜尋、公車路線去返程、附近（定位）、高鐵台鐵時刻表、Swagger UI；無 console／頁面錯誤；截圖存 `test/screenshots/`（不進版控）；每個 browser context 以 try/finally 關閉 | 每輪 |
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
| `DEMO_TRAFFIC` | `jam`／`smooth` | `traffic_status` mock 結果（M3-06） |
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

`.github/workflows/ci.yml`（PR 與推 `main` 時跑，`DEMO_MODE=1`）：Node 22、`npm ci` → `npm run lint` → `npm test` → `npm run build:demo` → `npx playwright install --with-deps chromium` → `npm run e2e`；E2E 截圖上傳為 artifact `e2e-screenshots`（保留 7 天）。M4 起加 `npm run build:cards`。

## 7. 本機真實資料檢查（Austin）

```bash
cp .env.example .env   # 填 TDX_CLIENT_ID / TDX_CLIENT_SECRET / CWA_API_KEY
node scripts/verify-tdx.js            # M1-01：所有端點狀態
node scripts/record-fixtures.js       # M1-02：錄製 fixture
DEMO_MODE=0 npm start                 # 真實資料
```
