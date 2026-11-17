# CLAUDE.md — 阿幫（A-Bang）

給 Claude Code 的專案指引。每次開始先讀這份，再照 `docs/LOOP.md` 做一輪（一個任務）。

## 專案一句話

串接台灣政府開放資料的 AI 助手「阿幫」（吉祥物：台灣藍鵲）。**網頁優先**，第一階段是**大眾交通**。
核心是一組 **MCP tools**：同一套 tools 給 (1) Claude 等 MCP client 透過遠端連接器使用、(2) 我們的民眾網頁 agent 使用。
網頁 agent 會呈現**小幫手討論串**（阿幫點名工具、工具一句話回報）與**決策圖**（MCP 資料＋使用者狀態 → 建議），結論以**互動卡片**呈現並可導航、訂票、叫車。

## 目前進度

M0 ✅、M2 ✅、決策引擎 ✅、`speak` ✅、M3-01 導航 ✅、M3-02 路線座標與形狀 ✅、M3-03 `find_place` ✅、M3-04 捷運 ✅、M3-05 票價 ✅、M3-06 路況 ✅、M3-07 國道客運 ✅、M3-08 天氣 ✅（真實資料待 CWA 授權碼）、品質基礎（E2E／Swagger／ESLint／CI）✅、M3-09 叫車連結 ✅、M3-10 `plan_trip` ✅、M3-11 固定 OD 測試 ✅、M3-13 metrics ✅、M3-14 英文名稱 ✅、M3-12 導訂票（權限前部分）🧩；**M3 交通完整版 ✅**（M3-12 真實導訂票待權限）；M4 互動卡片進行中（M4-01 卡片契約 ✅、M4-03 卡片文字字典 ✅）（`docs/PLAN.md` 狀態看板）。M1 需 TDX 金鑰，只能在 Austin 本機做。

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
| `docs/UX.md` | M4／M5：畫面、討論串、決策圖動畫、文案、可及性 |
| `docs/CARDS.md` | M4：卡片資料契約與 host 介面 |
| `docs/TESTING.md` | 寫測試時 |
| `docs/BRAND.md` | 寫使用者看得到的文字或圖像時 |
| `docs/PRD.md` | 範圍不確定時 |
| `docs/PLATFORM.md` | 只看「預留項目」；不要實作 Builder |
| `docs/adr/README.md` | 改變決策前 |
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
  agent/         📝 M5：run.js、claude.js、demo-intent.js、events.js
  agents/        📝 M5：life.json（agent profile）
  providers/     ridehail/（index.js 註冊與估價、uber.js 深層連結）✅；📝 mcp-client.js（外部 MCP）
  data/          landmarks.json（內建地標，座標待校對）
server/          http.js（REST、/mcp、/api/docs、靜態檔）、rest.js（路由表）、openapi.js、rate-limit.js
mcp/             create-server.js、server.js（stdio）
public/          PWA；📝 ui/cards/（M4）、js/pages/agent.js（M5）
test/            node:test；fixtures/
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
