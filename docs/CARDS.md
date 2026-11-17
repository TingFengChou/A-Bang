# 互動卡片規格

版本：v0.4（2026-11-17）。決策：ADR-0003（MCP Apps、渲染共用）、ADR-0008（先定資料契約）。視覺見 `UX.md` §6。

## 1. 原則

- **一份渲染程式，三個地方用**：網頁 agent（直接渲染）、MCP Apps（`ui://abang/cards.html` 單檔）、App（WebView 或依契約原生實作）。
- **先定契約**：`public/ui/cards/schema/<card>.v1.json`（JSON Schema 2020-12）。卡片只讀契約內欄位；tool 輸出以測試驗證符合契約。
- **不直接 fetch**：卡片只能透過 `host` 介面取資料或互動。
- **文字集中**：`public/ui/cards/i18n/zh-TW.js`（🧩 多語；✅ M4-03：`t(key, vars)`，`{name}` 佔位符，缺鍵回傳鍵本身；新增語言複製本檔、鍵相同）。
- **單檔、零外部資源**：MCP Apps iframe 的 CSP 預設拒絕外部資源；圖示用內嵌 SVG。

## 2. 輸入：`CardPayload`

就是 tool 的 `structuredContent`：

```jsonc
{
  "card": "bus-route",           // 卡片種類
  "v": 1,                        // 契約版本（M4 起加入）
  "mode": "live" | "demo",       // demo 時卡片角落顯示「示範資料」
  "speak": "一句話",
  "data": { },                   // 依卡片種類，見 §4
  "tool": "bus_route_eta",       // M4 起加入：刷新時用
  "args": { "city": "Taipei", "routeName": "307" }  // M4 起加入：刷新時用
}
```

## 3. `host` 介面

```js
/** @typedef {Object} Host
 * @property {(name: string, args: object) => Promise<CardPayload>} callTool  刷新或延伸查詢
 * @property {(text: string) => void} ask           代使用者提問（例：「307 往動物園方向下一班？」）
 * @property {(text: string) => void} setContext    更新模型脈絡（例：使用者選了哪一站）
 * @property {(url: string, opts?: { confirm?: string }) => void} openLink  開地圖、訂票、叫車；confirm 有值時先顯示確認視窗（L2）
 * @property {(at: string, text: string) => Promise<boolean>} [remind]  提醒（裝置端；不支援時不顯示按鈕）
 * @property {'light'} theme
 * @property {'web'|'mcp-app'|'app'} kind
 */
export function renderCard(el, payload, host) { /* 依 payload.card 分派 */ }
```

| 實作 | 檔案 | `callTool` | `ask` | `setContext` | `openLink` |
|---|---|---|---|---|---|
| 網頁 | `public/ui/cards/host-web.js` | `POST /api/v1/tools/:name` | 填入輸入框並送出 | 存在下一次 agent 請求的 `context` | `window.open`（L2 先確認） |
| MCP Apps | `public/ui/cards/host-mcp-app.js` | `app.callServerTool()` | `app.sendMessage()` | `app.updateModelContext()` | `app.openLink()`（若 host 支援；否則顯示可複製連結） |

## 4. 卡片種類與資料契約

共通：時間 ISO 8601 或 `HH:mm`；距離公尺；金額新台幣整數；`nav` 見 `MCP_TOOLS.md` §1。

> ✅ M4-01（2026-11-18）：7 種契約在 `public/ui/cards/schema/<card>.v1.json`（JSON Schema 2020-12 子集，驗證器 `schema/validate.js` 零依賴）；`bus_nearby_stations`、`youbike_nearby`、`bus_station_eta` 的 `data` 已改為下列物件格式（服務層仍回陣列，由 tool 包裝）；`structuredContent` 已帶 `v`、`tool`、`args`。`test/cards-schema.test.js` 以示範輸出驗證每種卡片。

### `bus-route`（`bus_route_eta`）

```jsonc
{ "city": "Taipei", "routeName": "307", "updatedAt": "…",
  "directions": [{ "direction": 0, "label": "往 板橋", "stops": [
    { "seq": 1, "stopName": "撫遠街", "lat": 25.05, "lon": 121.56, "etaSec": 120, "status": 0, "statusText": "約 2 分", "plate": "KKA-1234" } ] }],
  "shape": [[25.05, 121.56]] }
```

互動：方向切換；點站牌 → `host.setContext('使用者在看「X」站')` 並顯示「導航」「提醒我」；每 20 秒 `callTool` 刷新；倒數每秒本地遞減。

### `bus-station`（`bus_station_eta`）

`{ city, stationId, name?, arrivals: [{ routeName, direction, etaSec, status, statusText }] }`；每 20 秒刷新。

### `nearby`（`bus_nearby_stations`）

`{ lat, lon, stations: [{ stationId, city, name, distance, routes[], nav }] }`；點站 → `host.callTool('bus_station_eta', …)` 在卡片內展開。

### `youbike`（`youbike_nearby`）

`{ lat, lon, stations: [{ uid, name, type, distance, rent, electric, returnSlots, inService, updatedAt, nav }] }`；可切換「借車／還車」排序；每 30 秒刷新。

### `metro`（`metro_live_board`）

`{ system, station, stationId, lat?, lon?, nav, updatedAt, trains: [{ line, lineId, lineColor?, destination, etaMin, status }] }`；每 20 秒刷新。`trains` 為空時顯示「目前沒有即時到站資料」。`lineColor` M4 再依 `lineId` 補（M3-04 未提供）。

### `timetable`（`thsr_timetable`、`tra_timetable`、`intercity_bus`）

`{ system: 'THSR'|'TRA'|'BUS', from, to, date, trains: [{ trainNo, type?, depart, arrive, minutes, terminal?, fare?, excluded?: string }] }`；`BUS`（`intercity_bus`）另有 `traffic`、`delayRisk`，每班可有 `arriveWithDelay`、`delayMin`、`estimated`、`board`、`alight`、`walkFromM`、`walkToM`（有 `arriveWithDelay` 時以它為主、原抵達時間劃線）；
`excluded` 有值時灰階並顯示原因（例：「會遲到」）；按「訂票」→ `rail_booking_link` → `host.openLink(url, { confirm })`。

### `trip`（`plan_trip`）

```jsonc
{ "from": { "name": "西門町", "lat": 25.04, "lon": 121.50 }, "to": { "name": "台北101", "lat": 25.03, "lon": 121.56 },
  "best": "bus",
  "options": [ /* plan_trip Option（MCP_TOOLS.md §7） */ ],
  "ranking": { "ranked": [{ "id": "bus", "name": "公車 307", "score": 81, "breakdown": { } }], "excluded": [{ "id": "thsr-0700", "why": "會遲到" }], "reason": "選「公車 307」：因為正在下雨…" },
  "states": [{ "key": "rain", "source": "auto", "from": "weather_now", "detail": "陰有雨，3 小時降雨機率 80%" }, { "key": "luggage", "source": "user" }] }
```

呈現：建議方案＋分段時間條＋備案（最多 2）＋行動（導航、提醒、叫車、訂票）。決策圖由網頁 agent 的 `decision` 事件另外呈現；在 MCP Apps 中，`trip` 卡片以精簡版（排名條＋理由句＋狀態 chips 可切換）呈現。

## 5. 狀態與錯誤

| 狀態 | 呈現 |
|---|---|
| 載入中（刷新） | 右上角小轉圈；保留舊資料 |
| 刷新失敗 | 右上角「暫時無法更新・HH:mm 的資料」；30 秒後重試 |
| 示範資料 | 角落灰色「示範資料」 |
| 空結果 | 一句話＋建議（「附近 500 公尺沒有站，要不要擴大到 1 公里？」→ `host.ask`） |

## 6. 測試

- 單元：`test/cards-schema.test.js` — 每個 tool 的 mock 輸出通過對應 schema（自寫小驗證器 `public/ui/cards/schema/validate.js`，支援 type、enum、const、properties、required、items、minimum／maximum、minItems、additionalProperties: false、本檔 `$ref`；契約只用這些關鍵字）。
- 視覺：Playwright 載入 `test/cards/harness.html`（假 host）＋每種卡片 fixture，手機與桌面截圖，無 console error。
- MCP Apps：以 `AppBridge` 當 host 載入 `dist/cards.html`，送 `ui/notifications/tool-result`，檢查渲染與 `callServerTool` 往返。
