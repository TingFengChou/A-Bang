# 互動卡片規格

版本：v0.4（2026-11-17）。決策：ADR-0003（MCP Apps、渲染共用）、ADR-0008（先定資料契約）。視覺見 `UX.md` §6。

## 1. 原則

- **一份渲染程式，三個地方用**：網頁 agent（直接渲染）、MCP Apps（`ui://abang/cards.html` 單檔）、App（WebView 或依契約原生實作）。
- **先定契約**：`public/ui/cards/schema/<card>.v1.json`（JSON Schema 2020-12）。卡片只讀契約內欄位；tool 輸出以測試驗證符合契約。
- **不直接 fetch**：卡片只能透過 `host` 介面取資料或互動。
- **文字集中**：`public/ui/cards/i18n/zh-TW.js`（🧩 多語；✅ M4-03：`t(key, vars)`，`{name}` 佔位符，缺鍵回傳鍵本身；新增語言複製本檔、鍵相同）。
- **單檔、零外部資源**：MCP Apps iframe 的 CSP 預設拒絕外部資源；圖示用內嵌 SVG。

## 1.1 實作（M4-02）

`public/ui/cards/`：`index.js`（`renderCard(el, payload, host)` → `{ update, refresh, destroy }`；外框、示範標示、更新時間、刷新與失敗狀態共用；`bus-route`／`bus-station`／`metro` 每 20 秒、`youbike` 每 30 秒經 `host.callTool` 刷新）、`cards/<card>.js`（7 種）、`mode-icons.js`（交通方式與資料來源圖示、立體代幣 `token()`、決策圖用 `svgIcon()`；常數 SVG）、`dom.js`（`h()` 只用 `textContent`／`setAttribute`；`style` 物件可帶 CSS 變數；`safeUrl` 只允許 https）、`actions.js`（導航、L2 確認連結、訂票：先呼叫 `rail_booking_link` 再 `openLink(url, { confirm })`）、`cards.css`（淺色、`.ab-` 前綴）、`host-web.js`。開發預覽：`/ui/cards/preview.html`（示範模式資料，E2E 會截圖）。動態（M4-07）：`countdown.js` 每秒把 `[data-eta-sec]` 依重畫後經過時間遞減（不呼叫 API；文字規則同伺服器 `busStatusText`），數字變化時 `.ab-tick` 輕微提示，車牌以 `.ab-bus` 標記公車位置；`prefers-reduced-motion` 時只換文字。

## 2. 輸入：`CardPayload`

就是 tool 的 `structuredContent`：

```jsonc
{
  "card": "bus-route",           // 卡片種類
  "v": 1,                        // 契約版本（M4 起加入）
  "mode": "live" | "demo",       // 卡片角落標示：demo「示範資料」（灰）、live「真實資料」（品牌色）
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
 * @property {(at: string, text: string) => Promise<string|boolean>} [remind]  出門提醒（裝置端；回傳提醒 id；不支援時不顯示按鈕）
 * @property {(id: string) => boolean} [cancelRemind]  取消出門提醒（T7；已響過或已取消回 false）
 * @property {(key: string) => object|null} [reminderFor]  這段路線（起訖）目前的出門提醒：卡片重畫、重新規劃後也知道已設定
 * @property {boolean} [canNotify]  這個裝置能不能發通知（iOS Safari 沒加到主畫面：false，不顯示提醒按鈕）
 * @property {() => Promise<'granted'|'denied'|'prompt'|'unsupported'>} [notifyState]  通知權限現況：'prompt' 時卡片先說明為什麼要通知，按了才要權限
 * @property {(w: { city, routeName, stop, direction?, minutes }) => Promise<boolean>} [watchArrival]  公車到站前 N 分提醒（L-14）
 * @property {() => void} [unwatchArrival]
 * @property {boolean} [background]  App 關著也會提醒（手機 App 有通知權限）
 * @property {() => string} [arrivalNote]  提醒說明文字鍵：whenAlways／whenOpenPage／whenNoPermission
 * @property {() => object|null} [arrivalWatch]  目前的到站提醒
 * @property {(hash: string) => void} [navigate]  開 App 內頁面（只接受 #/ 開頭）
 * @property {(t: { app: string|null, store: { ios, android }|null }) => void} [openApp]  開合作 App（MyDrama，ADR-0019）：先開 App 連結，1.6 秒內畫面沒離開就開商店頁；只收安全的自訂 scheme／https（`core/drama-say.js` `isAppLink`），商店頁只收 https。MCP Apps 不提供（卡片改用 https 商店頁）
 * @property {'light'} theme
 * @property {'web'|'mcp-app'|'app'} kind
 */
export function renderCard(el, payload, host) { /* 依 payload.card 分派 */ }
```

| 實作 | 檔案 | `callTool` | `ask` | `setContext` | `openLink` |
|---|---|---|---|---|---|
| 網頁 | `public/ui/cards/host-web.js` | `POST /api/v1/tools/:name` | 填入輸入框並送出 | 存在下一次 agent 請求的 `context` | `window.open`（L2 先確認）；`remind`（T7，`public/js/reminders.js`）：可多筆（最多 5）、同一段路線只留一筆（重新規劃後是改時間）、可取消（`cancelRemind`），存在 `localStorage` `abang.reminders`；時間一律台灣時間（不看裝置時區）；App 用系統本機通知（每筆一個編號 2000～2999，App 關著也會響），網頁用 service worker 通知（沒有再用 `new Notification`；頁面開著才響，重新整理後還原，別的分頁取消後不響）；關機期間錯過的提醒 Android 開機後約 15 秒會補送（App 還沒打開，擋不住），打開 App 時把過期的從通知列移除並刪掉；`notifyState` 讓卡片在第一次要權限前先說明；`watchArrival`：整個頁面共用一個提醒（S15：預估抵達比第一次說的晚 10 分以上（跳過的那班開走後重新算）、末班已過／今日未營運（馬上）、未發車超過 10 分鐘、交管不停靠時標 `stuck`，發 `abang:arrival-stuck` 一次，App 在背景時另送一則通知；公車卡片與公車頁說明並給「改其他方式」，送「不要坐公車，改別的方式去{目的地}」（問阿幫頁設定時記下行程目的地 `tripContext`；沒有就沿用對話）；其他頁面的提示可以點到問阿幫），每 20 秒查上車站到站時間，剩下 ≤ N 分通知一次（系統通知＋App 內 toast `abang:arrival`），設定時這班已在範圍內就跳過等下一班，最多盯 90 分；手機 App（M11-02）改用系統本機通知：每次查到就把「該出門了」排到預估時間（提早 30 秒，Android 不用精準鬧鐘），App 關著也會響，App 被關掉重開會恢復提醒；`background`／`arrivalNote()` 告訴卡片能不能在背景提醒（沒有通知權限時說明「App 開著時才會提醒」）；`navigate` 換 hash |
| MCP Apps | `public/ui/cards/host-mcp-app.js` | `app.callServerTool()` → `structuredContent` | `app.sendMessage()`（host 支援 `message` 時） | `app.updateModelContext()`（host 支援時） | L2 先在卡片下方顯示確認框（iframe 沙箱不允許 `window.confirm`）→ `app.openLink()`；host 不支援或拒絕時顯示網址與「複製連結」；不提供 `remind`、`watchArrival`、`navigate`（卡片不顯示那些按鈕） |

## 3.1 MCP Apps 打包與資源（✅ M4-04～06）

- 入口 `public/ui/cards/mcp-app.js`：`App`（ext-apps 1.7.5，`app-with-deps`）＋`PostMessageTransport(window.parent)`、`autoResize`；`ontoolresult` → `renderCard`（同種卡片就 `update`）；`ontoolinput` 顯示「更新中…」；`onteardown` 停止刷新。
- `npm run build:cards` → `dist/cards.html`（esbuild 單檔、CSS 內嵌、零外部資源，約 394 KB）。
- MCP：資源 `ui://abang/cards.html`（`text/html;profile=mcp-app`）；有卡片的 tool 帶 `_meta.ui.resourceUri`（與舊鍵 `ui/resourceUri`）。`mcp/cards-resource.js`：有 esbuild（開發）時記憶體內打包，否則讀 `dist/cards.html`（正式環境要先 `npm run build:cards`）。

## 4. 卡片種類與資料契約

共通：時間 ISO 8601 或 `HH:mm`；距離公尺；金額新台幣整數；`nav` 見 `MCP_TOOLS.md` §1。

> ✅ M4-01（2026-11-18）：7 種契約在 `public/ui/cards/schema/<card>.v1.json`（JSON Schema 2020-12 子集，驗證器 `schema/validate.js` 零依賴）；`bus_nearby_stations`、`youbike_nearby`、`bus_station_eta` 的 `data` 已改為下列物件格式（服務層仍回陣列，由 tool 包裝）；`structuredContent` 已帶 `v`、`tool`、`args`。`test/cards-schema.test.js` 以示範輸出驗證每種卡片。

### `bus-route`（`bus_route_eta`）

```jsonc
{ "city": "Taipei", "routeName": "307", "updatedAt": "…",
  "directions": [{ "direction": 0, "label": "往 板橋", "stops": [
    { "seq": 1, "stopName": "撫遠街", "lat": 25.05, "lon": 121.56, "etaSec": 120, "status": 0, "statusText": "約 2 分", "plate": "KKA-1234" } ] }],
  "shape": [[25.05, 121.56]],
  "focus": { "direction": 0, "label": "往 板橋", "seq": 5, "stopName": "西門", "etaSec": 360, "status": 0, "statusText": "6 分" } }   // 選填：盯的站（L-14）
```

有 `focus`（選公車後盯的上車站，L-14）：卡片上方大字倒數（`data-eta-sec`）、自動切到該方向、站序標「你在這上車」；`host.watchArrival` 存在時顯示「到站前 3／5 分提醒我」（已設定時顯示狀態與「取消提醒」；設定時這班已趕不上則說明會提醒下一班）；`host.navigate` 存在時顯示「開公車頁看動態」（`#/bus/:city/:route?stop=&dir=`，公車頁同樣顯示上車站與同一個提醒）。

互動：方向切換；點站牌 → `host.setContext('使用者在看「X」站')` 並顯示「導航」「提醒我」；每 20 秒 `callTool` 刷新；倒數每秒本地遞減。

### `bus-station`（`bus_station_eta`）

`{ city, stationId, name?, arrivals: [{ routeName, direction, etaSec, status, statusText }] }`；每 20 秒刷新。

### `nearby`（`bus_nearby_stations`）

`{ lat, lon, stations: [{ stationId, city, name, distance, routes[], nav }] }`；點站 → `host.callTool('bus_station_eta', …)` 在卡片內展開。

### `youbike`（`youbike_nearby`）

`{ lat, lon, stations: [{ uid, name, type, distance, rent, electric, returnSlots, inService, updatedAt, nav }] }`；可切換「借車／還車」排序；每 30 秒刷新。

### `metro`（`metro_live_board`）

`{ system, station, stationId, lat?, lon?, nav, updatedAt, trains: [{ line, lineId, lineColor?, destination, etaMin, status }] }`（行程卡片每段 `legs[].detailEn` 為英文說明，英文那一輪用）；每 20 秒刷新。`trains` 為空時顯示「目前沒有即時到站資料」。`lineColor` 依 `lineId` 給各線官方代表色（`core/metro-colors.js`；未知的線不給，卡片用品牌色）。

### `timetable`（`thsr_timetable`、`tra_timetable`、`intercity_bus`）

`{ system: 'THSR'|'TRA'|'BUS', from, to, date, trains: [{ trainNo, type?, depart, arrive, minutes, terminal?, fare?, excluded?: string }] }`；`BUS`（`intercity_bus`）另有 `traffic`、`delayRisk`，每班可有 `arriveWithDelay`、`delayMin`、`estimated`、`board`、`alight`、`walkFromM`、`walkToM`（有 `arriveWithDelay` 時以它為主、原抵達時間劃線）；
高鐵／台鐵查今天時預設從下一班開始列，已開出的班次收起，按「顯示今天已開出的 N 班」展開；都開走時顯示「今天的班次都開走了」（`visibleTrains`）。`excluded` 有值時灰階並顯示原因（例：「會遲到」）；按「訂票」→ `rail_booking_link` → `host.openLink(url, { confirm })`。

### `trip`（`plan_trip`）

```jsonc
{ "from": { "name": "西門町", "lat": 25.04, "lon": 121.50 }, "to": { "name": "台北101", "lat": 25.03, "lon": 121.56 },
  "best": "bus",
  "options": [ /* plan_trip Option（MCP_TOOLS.md §7） */ ],
  "ranking": { "ranked": [{ "id": "bus", "name": "公車 307", "score": 81, "breakdown": { } }], "excluded": [{ "id": "thsr-0700", "why": "會遲到" }], "reason": "選「公車 307」：因為正在下雨…" },
  "states": [{ "key": "rain", "source": "auto", "from": "weather_now", "detail": "陰有雨，3 小時降雨機率 80%" }, { "key": "luggage", "source": "user" }] }
// states[].key 另有 badAir（空品不佳，from: aqi_nearby，M10）；data.air = { site, aqi, status } | null
// mode：使用者指定的方式；avoid：使用者說不要的方式（A3，ranking.excluded[].why「你說不要叫車」；全部被排除時卡片說「排除你說不要的方式後，沒有其他可行的方案」，與「都趕不上」分開）
// 同時給 mode=X 與 avoid 含 X：X 被排除、回 modeUnavailable（照分數建議並明說）
// options[].lastBus：接近末班（示範 23:00 後）；skipped[]：沒列入的方式與原因（深夜收班、末班已過、YouBike 沒車位…）
// habit：使用者同意過的常選比例（{ metro: 0.6 }，選填）；habitOn：這次有沒有加分；ranking.ranked[].breakdown.habit：習慣加分（ADR-0010 2026-11-21）
// ask：關鍵問題（{ state, text, textEn, from, to, dMin, dCost }，ADR-0016）；states[].source 另有 usual（你說過，i18n trip.state.usual）
// 卡片：按建議方案的導航／叫車／訂票時送 window 事件 abang:choice { role }（網頁 App 記常選的方式；MCP Apps 裡沒人聽）
```

新增（A1b，2026-11-21）：`states[].key` 加 `group`（多人同行）、`rainSoon`（可能下雨）；選填 `party`、`tips[]`（`{ kind, text }`：`tight`／`rain` 以警示色列在建議方案上面，`cost` 列在理由下方；最多 5 條）、`tight: { slackMin }`；多人時叫車方案的 `cost`／`costRange` 是每人分攤（價格寫「每人 55～75 元」，多輛寫車數）、`share` 有總額與車數。決策圖的「多人同行」不能點掉（車資已是每人，要改人數跟阿幫說）。

多語（S12b，2026-11-21）：`renderCard` 的 payload 可帶 `lang: 'en'`，卡片標籤改用 `i18n/en.js`（鍵與佔位符與 zh-TW 相同，測試比對；缺鍵退回中文），`<section lang="en">`；地名、站名等資料維持原文。共用按鈕與倒數經 `i18n/index.js` 的 `withLocale` 取同一個語言。問阿幫頁：只有英文的提問那一輪卡片用英文。

呈現：建議方案＋分段時間條＋備案（最多 2）＋行動（導航、提醒、叫車、訂票）。決策圖由網頁 agent 的 `decision` 事件另外呈現；在 MCP Apps 中，`trip` 卡片以精簡版（排名條＋理由句＋狀態 chips 可切換）呈現。

### `scam-risk`（`scam_check_message`，M7）

`{ level: 'high'|'medium'|'low', score, findings: [{ id, category, label, excerpt }], urls: [{ input, domain, listed, category?, month? }], advice: string[], myths: [{ id, title, date }], rulesVersion, reviewed }`。等級以色彩＋符號＋文字呈現（不只靠顏色）；低風險標題固定「沒有發現已知的詐騙特徵」並註明不代表安全；可疑字句以引號標出；網址只顯示網域與清單比對結果，**不提供開啟使用者網址的按鈕**；行動按鈕：「165 全民防騙網」（官方網站）、「已經照做了怎麼辦」（`host.ask`，低風險不顯示）；頁尾標示規則庫版本與是否已審核。不自動刷新。

### 生活服務卡片（M10）

契約在 `schema/<card>.v1.json`，資料即對應 tool 的 `data`（`MCP_TOOLS.md` §生活服務）。

| 卡片 | 呈現 | 刷新 |
|---|---|---|
| `weather` | 下雨與否、氣溫、1 小時雨量、3 小時降雨機率、測站 | 10 分 |
| `aqi` | AQI 大數字（等級色彩＋文字）、PM2.5／PM10／O₃、附近測站 | 15 分 |
| `outing` | 出門建議最多 3 點（帶傘／防曬／保暖／口罩／安心出門的線條圖示；要注意的用警示色）、氣溫・降雨機率・AQI 三格、資料測站 | 10 分 |
| `quake` | 規模、震央、最大震度、深度、類型、指定縣市震度、氣象署報告連結 | 5 分 |
| `pharmacy` | 藥局、今天時段（有營業為綠色）、地址電話、地圖搜尋（最多 10，可展開） | — |
| `garbage` | 時間、地點、距離、今天有沒有收（不收則灰階）、新北車輛即時位置、導航 | 2 分 |
| `fuel` | 92／95／98／超級柴油牌價、生效日 | — |
| `invoice` | 特別獎、特獎、頭獎；卡片內輸入號碼對獎（`host.callTool`） | — |
| `drama` | 短劇（`drama_picks`／`drama_search`／`drama_series`，ADR-0019）：每部一列——直式封面示意（劇名第一個字＋依 id 的漸層色，**不載外部圖片**）、排名、新上架標記、劇名、「共 N 集・前 M 集免費・已完結／連載中」、台灣自製、類型標籤（最多 3）、簡介兩行收合（「看簡介」展開時 `host.callTool('drama_series')` 取完整簡介）、「在 MyDrama 看」（`host.openApp({ app, store })`；只有 https 商店頁時改「下載 MyDrama」走 `host.openLink`；都沒有不顯示）；熱搜關鍵字按鈕（`host.callTool('drama_search')`，並 `setContext` 告訴模型在看哪幾部）；搜尋沒結果給「看熱門排行」；頁尾「內容與播放由 MyDrama 提供；阿幫只推薦，不代替登入、付費或解鎖」 | — |
| `stock` | 加權／櫃買指數；每檔收盤價、漲跌（台股習慣漲紅跌綠，另有 ▲▼ 與 `aria-label`，不只靠顏色）、開高低、成交張數、資料日期；名稱不是完全相同時列「也可能是」按鈕；卡片內查別檔（`host.callTool`），查到後 `host.setContext` 告訴模型使用者在看哪幾檔；固定附「不構成投資建議」 | —（收盤資料） |

網頁入口：首頁格子 → `#/s/:id`（`public/js/pages/service.js`，需要位置的服務先定位）。

## 5. 狀態與錯誤

| 狀態 | 呈現 |
|---|---|
| 載入中（刷新） | 右上角小轉圈；保留舊資料 |
| 刷新失敗 | 右上角「暫時無法更新・HH:mm 的資料」；30 秒後重試 |
| 示範資料 | 角落灰色「示範資料」；真實資料標品牌色「真實資料」（兩種都標，不靠「沒有標籤」反推） |
| 空結果 | 一句話＋建議（「附近 500 公尺沒有站，要不要擴大到 1 公里？」→ `host.ask`） |

## 6. 測試

- 單元：`test/cards-schema.test.js` — 每個 tool 的 mock 輸出通過對應 schema（自寫小驗證器 `public/ui/cards/schema/validate.js`，支援 type、enum、const、properties、required、items、minimum／maximum、minItems、additionalProperties: false、本檔 `$ref`；契約只用這些關鍵字）。
- 視覺：Playwright 載入 `test/cards/harness.html`（假 host）＋每種卡片 fixture，手機與桌面截圖，無 console error。
- MCP Apps（✅ M4-08）：`scripts/e2e.js` 以 `test/cards/mcp-host.js`（`AppBridge`＋SDK `Client`）經 `/mcp` 讀 `ui://abang/cards.html`，放進 `sandbox="allow-scripts"` 的 iframe，送 tool input／result；檢查 7 種卡片、點站牌 → `updateModelContext`、訂票 → `callServerTool(rail_booking_link)` → 確認框 → `openLink`，每張截圖 `mcp-app-<card>.png`。單元：`test/host-mcp-app.test.js`（假 App）。
