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
