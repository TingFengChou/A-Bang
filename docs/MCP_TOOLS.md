# MCP Tools 規格

版本：v0.4（2026-11-17）　狀態：✅ 已完成　📝 待實作　⚠️ 端點待 M1 驗證

## 1. 共通約定

- 定義位置：`core/tools/<pack>.js`，以 `defineTool()` 註冊（ADR-0002）。
- 所有 tools 唯讀：`annotations.readOnlyHint = true`、`openWorldHint = true`。
- 每個 tool 必有 `pack`、`tier`、`speak(data, args)`；選填 `source`（資料來源標示，預設 TDX）、`static`（內建資料、不依賴金鑰：示範模式不加「示範資料」提示）、`modeOf(svc)`（資料不是 TDX 時自己判斷 live／demo）、`demoNote`（示範提示文字）。
- `callTool()` 回傳：`{ name, card, v?, mode, data, text, speak, args, metrics }`（`v`＝卡片契約版本，有卡片時才有；`args`＝驗證後參數）；`metrics = { calls, cacheHits, cacheHit, scanned, ms }`（`core/metrics.js`：TDX／氣象署取用次數含快取、全部由快取取得、上游回應筆數、耗時；示範模式 `calls`／`scanned` 為 0）。REST 原樣回傳；MCP 放在結果 `_meta['abang/metrics']`（每次不同，不混進 `structuredContent`）。
- MCP 回傳：

```jsonc
{
  "content": [{ "type": "text", "text": "【示範資料…】（示範模式）摘要（≤ 1500 字）\n\n資料來源：交通部 TDX 運輸資料流通服務" }],
  "structuredContent": { "card": "bus-route", "v": 1, "tool": "bus_route_eta", "args": { }, "mode": "live|demo", "speak": "一句話", "data": { } },
  "_meta（tool 定義上）": { "abang/pack": "transit", "abang/tier": "L1", "abang/card": "bus-route" }
}
```

- 錯誤：輸入錯誤 → `UserError`（MCP `isError: true`、HTTP 400），訊息為可行動的繁體中文。
- `speak`：討論串中小幫手的一句話（< 60 字），**只由資料產生、不經模型**（ADR-0009）。
- 有座標的結果附 `nav`（§6）。
- 英文名稱（ADR-0007、M3-14）：來源（TDX `En`）有非空英文時才附，沒有就不輸出、不翻譯：公車 `routeNameEn`、`stopNameEn`、站位 `nameEn`；YouBike `nameEn`（去掉 `YouBike2.0_` 前綴）；高鐵／台鐵車站 `nameEn`；捷運車站 `nameEn`、看板 `stationEn`、`lineEn`、`destinationEn`；路況路段 `nameEn`。示範資料沒有英文。

### 共用型別

| 名稱 | 定義 |
|---|---|
| `City` | `Taipei`／`TPE`／`台北市`／`臺北` 皆可（`core/cities.js`） |
| `LatLon` | `lat` 21–27、`lon` 118–123（WGS84）；`T.point` 的座標物件可另帶 `name`（≤ 30 字，例「你的位置」） |
| `Date` | `YYYY-MM-DD`，預設今天（台灣時間） |
| `Eta` | `{ etaSec: number\|null, status: 0–4, statusText }`；1 尚未發車、2 交管不停靠、3 末班車已過、4 今日未營運 |
| `Nav` | `{ google: url, apple: url }` |

## 2. 總表

| Tool | pack | tier | 卡片 | 狀態 |
|---|---|---|---|---|
| `bus_search_routes` | transit | L1 | — | ✅ |
| `bus_route_eta` | transit | L1 | `bus-route` | ✅（含座標、`nav`、`shape` ⚠️） |
| `bus_nearby_stations` | transit | L1 | `nearby` | ✅（含 `nav`） |
| `bus_station_eta` | transit | L1 | `bus-station` | ✅ ⚠️ |
| `youbike_nearby` | transit | L1 | `youbike` | ✅（含 `nav`） |
| `thsr_timetable` | transit | L1 | `timetable` | ✅ |
| `tra_timetable` | transit | L1 | `timetable` | ✅ |
| `rail_stations` | transit | L1 | — | ✅ |
| `metro_stations` | transit | L1 | — | ✅ ⚠️ |
| `metro_live_board` | transit | L1 | `metro` | ✅ ⚠️ |
| `find_place` | transit | L1 | — | ✅（內建地標；地理編碼 ⚠️） |
| `traffic_status` | transit | L1 | — | ✅ ⚠️ |
| `intercity_bus` | transit | L1 | `timetable` | ✅ ⚠️ |
| `rail_fare` | transit | L1 | — | ✅ ⚠️ |
| `plan_trip` | transit | L1 | `trip` | ✅（客運、軌道 ⚠️） |
| `rail_booking_link` | transit | **L2** | （時刻表按鈕） | 🧩 介面＋示範完成；⛔ 真實版需 TDX 導訂票權限 |
| `ridehail_link` | ridehail | **L2** | （行程卡按鈕） | ✅ |
| `weather_now` | weather | L1 | — | ✅（真實資料需 CWA 授權碼）⚠️ |
| `weather_tomorrow` | weather | L1 | — | ✅（2026-11-21；真實資料需 CWA 授權碼）⚠️ |
| `outing_advice` | weather | L1 | `outing` | ✅（2026-11-21；真實資料需 CWA 授權碼與 `MOENV_API_KEY`） |
| `aqi_nearby` | life | L1 | `aqi` | ✅（M10，`MOENV_API_KEY`） |
| `earthquake_recent` | life | L1 | `quake` | ✅（M10，`CWA_API_KEY`） |
| `pharmacy_search` | life | L1 | `pharmacy` | ✅（M10，免金鑰；資料無座標，給座標時依位置判斷行政區 S16） |
| `garbage_truck_nearby` | life | L1 | `garbage` | ✅（M10，臺北市、新北市） |
| `fuel_price` | life | L1 | `fuel` | ✅（M10） |
| `invoice_lottery` | life | L1 | `invoice` | ✅（M10） |
| `invoice_check_batch` | life | L1 | — | ✅（M10，網頁「我的發票」自動對獎） |
| `stock_quote` | finance | L1 | `stock` | ✅（證交所、櫃買中心收盤行情，免金鑰） |
| `scam_check_message` | antifraud | **L2** | `scam-risk` | ✅（M7） |
| `scam_lookup_url` | antifraud | **L2** | — | ✅（M7） |
| `scam_myth_search` | antifraud | L1 | — | ✅（M7） |
| `sms_sender_check` | antifraud | **L2** | — | ✅（M7，內建規則） |

## 3. 公車

### ✅ `bus_route_eta` — 公車路線即時到站

| | |
|---|---|
| 輸入 | `city?: City`（有 `near` 時可省略，用最近地標推估）, `routeName: string`, `stop?: string`（要盯的站，例如上車站）, `direction?: 0\|1`, `near?: Point`（使用者現在的位置；沒說站名時聚焦路線上離他最近的站，`focus` 加 `distanceM`、`nearest: true`；兩個方向都有同一站時挑車比較快到的方向） |
| 輸出 | `{ city, routeName, updatedAt, directions: [{ direction, label, stops: [{ seq, stopName, lat?, lon?, ...Eta, plate, nav }] }], shape?: [[lat, lon]], focus?: { direction, label, seq, stopName, etaSec, status, statusText } }`；給 `stop` 時依站名（臺／台相同）找站、先找 `direction` 那一邊，找到才有 `focus`，找不到文字說明「這條路線沒有…這一站」 |
| TDX | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}/{Route}`（1h）、`/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{Route}`（20s）、`/basic/v2/Bus/Route/City/{City}/{Route}`（1h）、`/basic/v2/Bus/Shape/City/{City}/{Route}`（1h，WKT）⚠️ |
| 篩選 | `$filter=RouteName/Zh_tw eq '{Route}'`（路徑參數會模糊比對） |
| speak | 「307 目前有 3 個站即將有車（例如北門、中山堂）。」；有 `focus` 時「601 約 6 分後到「西門」。」（不到 3 分「即將到」、不到 1 分「在「西門」進站中」） |
| 選公車就盯（L-14） | `plan_trip` 的公車方案帶 `follow: { city, routeName, stop, direction?, walkMin }`；決策選公車時 agent 執行器（`core/agent/run.js` `busFollowUp`）自動呼叫本 tool 盯上車站，示範與模型模式相同 |
| 座標 | 站點 `lat/lon` 取 `StopPosition`（缺座標的站不帶 `lat/lon`，`nav` 為 `null`）；`nav` 在 tool 層加（§6） |
| shape | ✅ M3-02：取 `Direction = 0` 那筆（沒有就第一筆）的 `Geometry`（WKT），`core/geo.js` 解析 `LINESTRING`／`MULTILINESTRING`（`lon lat` → `[lat, lon]`，順序寫反會自動換回）、串接成一條、超過 400 點等距抽樣；形狀端點失敗或格式不明時省略 `shape`，到站資料照常。示範模式以站點加中點產生 |

### ✅ `bus_search_routes`

輸入 `city`, `keyword`；輸出 `[{ city, routeName, departure, destination }]`；TDX `/basic/v2/Bus/Route/City/{City}` + `contains(RouteName/Zh_tw,'kw')`（1h）。

### ✅ `bus_nearby_stations`

輸入 `lat`, `lon`, `radius?`（預設 400，上限 1000）；輸出 `{ lat, lon, radius, stations: [{ stationId, stationUid, city, name, lat, lon, distance, routes[], nav? }] }`（M4-01 起為物件，卡片 `nearby`）；TDX `/advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(lat,lon,r)`（1h）；`city` 由 `StationUID` 前三碼推得。

### ✅ `bus_station_eta` ⚠️

輸入 `city`, `stationId`；輸出 `{ city, stationId, arrivals: [{ routeName, direction, ...Eta }] }`（依到站排序；M4-01 起為物件，卡片 `bus-station`）；TDX `/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/PassThrough/Station/{StationID}`（20s）。

## 4. YouBike

### ✅ `youbike_nearby`

輸入 `lat`, `lon`, `radius?`（預設 500）；輸出 `{ lat, lon, radius, stations: [{ uid, name, type, address, lat, lon, distance, capacity, rent, general, electric, returnSlots, inService, updatedAt, nav? }] }`（M4-01 起為物件，卡片 `youbike`）；TDX `/advanced/v2/Bike/Station/NearBy`（1h）＋ `/advanced/v2/Bike/Availability/NearBy`（30s），以 `StationUID` 合併。speak：「最近有車的是捷運台北車站M8（120 公尺），還有 12 台。」

## 5. 軌道與捷運

### ✅ `thsr_timetable`／`tra_timetable`

起站可省略（2026-11-21）：給 `near`（使用者位置）時用 30 公里內最近的車站，輸出加 `nearest: { station, distanceM, from? }`，speak 先說「離你最近的高鐵站是南港（約 4.4 公里）。」；車站座標取 TDX `StationPosition`（⚠️ 待驗證）；沒有 `from` 也沒有 `near` 時回 UserError 請使用者說起站。

輸入 `from`, `to`（中文站名或代碼，台／臺通用）, `date?`；輸出 `{ system: 'THSR'|'TRA', from, to, date, trains: [{ trainNo, type?, depart, arrive, minutes, terminal? }] }`。
查今天時，給模型的文字與 `speak` 以「現在時間」為準只講尚未開出的班次（「今天還有 N 班，下一班 HH:mm 出發」；都開走時說末班並建議查明天）；`data.trains` 仍是整天（`upcomingTrains(data, now)`）。
TDX：高鐵 `/basic/v2/Rail/THSR/DailyTimetable/OD/{O}/to/{D}/{Date}`；台鐵 v3 `/basic/v3/Rail/TRA/DailyTrainTimetable/OD/{O}/to/{D}/{Date}`（10m）。

### ✅ `rail_stations`

輸入 `system: 'THSR'|'TRA'`；輸出 `[{ id, name }]`（24h）。

### ✅ `rail_fare` ⚠️

| | |
|---|---|
| 輸入 | `system: 'THSR'\|'TRA'`, `from`, `to`（中文站名或代碼，台／臺通用） |
| 輸出 | `{ system, from, to, fares: [{ ticketType, fareClass, cabin?, trainType?, price, adultOneWay }] }`；`cabin` 只有高鐵、`trainType` 只有台鐵；成人單程（`adultOneWay`）在前，其次價格由低到高 |
| TDX | 高鐵 `/basic/v2/Rail/THSR/ODFare/{O}/to/{D}`；台鐵 v3 `/basic/v3/Rail/TRA/ODFare/{O}/to/{D}`（`ODFares` 每個車種一筆）；10m |
| 代碼 | `TicketType`、`FareClass`、`CabinClass` 依 Swagger 轉中文（`TICKET_TYPE`、`FARE_CLASS`、`CABIN_CLASS`，⚠️ 待驗證）；未知代碼顯示「代碼 N」；台鐵車種只用資料自帶的 `TrainTypeName`，沒有就顯示「車種代碼 N」；`Price` 無效的略過 |
| speak | 「台北到左營高鐵成人單程 1,490 元起（最高 2,390 元）。」；只有一種價格時不加「起」 |

`plan_trip`（M3-10）取成人單程最低價當 `cost`。示範模式依站距估算票價（非真實票價）。也可評估改用 TDX 官方 MCP。

### ✅ `metro_stations`／`metro_live_board` ⚠️

實作：`core/services/metro.js`、`metro-mock.js`、`core/tools/metro.js`（M3-04）。

| | `metro_stations` | `metro_live_board`（卡片 `metro`） |
|---|---|---|
| 輸入 | `system: 'TRTC'\|'TYMC'\|'TMRT'\|'KRTC'` | `system`、`station`（站名或代碼，台／臺通用，例 台北車站、BL12）；或 `near`（使用者位置，沒說站名時；`system` 可省略，各系統找 3 公里內最近的站，輸出加 `nearest: { distanceM, from? }`；超過 3 公里回 UserError 請使用者說站名，2026-11-21） |
| 輸出 | `[{ id, ids, name, lat?, lon?, nav }]`；同名多線合併成一站，`ids` 列出所有代碼 | `{ system, station, stationId, lat?, lon?, nav, updatedAt, trains: [{ line, lineId, destination, etaMin, status }] }`，依 `etaMin` 排序、沒有時間的在後 |
| TDX | `/basic/v2/Rail/Metro/Station/{Op}`（24h） | 先查車站，再 `/basic/v2/Rail/Metro/LiveBoard/{Op}`（20s，`$filter` 該站所有代碼） |
| 欄位 | `StationID`、`StationName`、`StationPosition` | `LineName`／`LineID`／`LineNO`、`DestinationStationName`（缺時用 `TripHeadSign`）、`EstimateTime`（分鐘）、`UpdateTime` |
| status | — | 0 分「進站中」、1 分「即將進站」、其他「N 分」、無資料「—」 |
| speak | 「桃園機場捷運共有 6 個車站。」 | 「美麗島最快 3 分鐘後有往小港的車。」；沒資料時「…目前沒有即時到站資料。」；`near`：「離你最近的是市政府（約 89 公尺）：…」（給地名時「離「臺北車站」最近的是…」） |

看板沒有資料時回空 `trains`（不報錯）。北捷看板資料有限，M1 實測後決定是否以 `StationTimeTable` 推算。示範模式：四個系統的主要車站（真實站名、近似座標），每 6 分鐘一班的模擬到站，終點站不顯示往自己方向的車。

## 6. 導航、訂票、叫車

### 導航（所有點位）

```jsonc
"nav": {
  "google": "https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=walking",
  "apple": "https://maps.apple.com/?daddr={lat},{lon}&dirflg=w"
}
```

TDX 站牌、站位、YouBike、車站資料都有經緯度（`StopPosition`／`StationPosition`）。完整逐步導航不在本階段。

✅ 實作 `core/nav.js`（M3-01）：

| 函式 | 說明 |
|---|---|
| `navLinks(lat, lon, mode?)` | `mode`：`walking`（預設）／`transit`／`driving`／`bicycling`（Apple 以步行代替）；座標取 6 位小數並編碼；座標無效回傳 `null` |
| `walkMinutes(distanceM)` | 直線 × 1.3 ÷ 4.5 km/h，無條件進位，最少 1 分 |
| `leaveAt({ etaSec, distanceM, now? })` | 出發時機 `{ walkMin, leaveInSec, leaveAt, status: 'ok'\|'hurry'\|'missed', text }`；`hurry` = 1 分鐘內要出門 |
| `withNav(items, mode?)` | 替有 `lat/lon` 的清單每筆加 `nav`（不改原物件） |

已附 `nav`：`bus_nearby_stations`、`youbike_nearby`、`bus_route_eta` 站點（M3-02）（tool 層包裝，live 與 mock 一致）。`plan_trip` 各段於 M3-10 加上；`leaveAt` 於 M3-10 與 M4 卡片使用。

### 🧩 `rail_booking_link` — 台鐵／高鐵導訂票（L2）⚠️

實作：`core/services/booking.js`（`validateBooking`、`bookingSummary`、真實版）、`booking-mock.js`、`core/tools/booking.js`（M3-12 權限前部分）。

| | |
|---|---|
| 輸入 | `system: 'THSR'\|'TRA'`, `trainNo`（1–4 位數字）, `date`（今天～28 天內）, `from`, `to`, `tickets?`（1–4，預設 1）, `carType?: 'standard'\|'business'`（只限高鐵） |
| 輸出 | `{ system, url, expiresAt, summary, tickets, confirmText, demo?, note? }`：開啟官方訂票網站並自動帶入；連結具時效 |
| 目前 | 真實版在權限與端點確認前**不呼叫 TDX**，回 `UserError`「導訂票尚未開通…」並附官方訂票網站（高鐵 `https://irs.thsrc.com.tw/IMINT/`、台鐵 `https://tip.railway.gov.tw/tra-tip-web/tip`）；示範版回官方網站首頁（不帶入車次）並標 `demo` |
| TDX | 台鐵／高鐵「導訂票」API（**前置：在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限**） |
| 規則 | 產生前需使用者確認車次、日期、張數；不代替付款或填個資 |

### ✅ `ridehail_link`（L2）

實作：`core/providers/ridehail/index.js`（provider 註冊、`estimateFare`、`createRidehailServices`）、`uber.js`、`core/tools/ridehail.js`（M3-09）。不呼叫外部 API，live 與示範相同（`static`）。

| | |
|---|---|
| 輸入 | `to`：座標或地名（`T.point`）；`from?`：同上，省略時上車點用 App 的目前位置；`provider?: 'uber'`（預設） |
| 輸出 | `{ provider, providerName, url, estimate: { low, high, distanceKm, currency: 'TWD', estimated: true, basis } \| null, from: string\|null, to, fromPoint, toPoint, confirmText }` |
| 連結 | `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]={lat}&dropoff[longitude]={lon}&dropoff[nickname]={name}`；有 `from` 時改為 `pickup[latitude]…`；座標 6 位小數、暱稱 URL 編碼 |
| 估價 | 沒有 `from` 時為 null。道路距離＝直線 × 1.3；`low` 依臺北市計程車費率（起跳 85 元含 1.25 公里、每 200 公尺 5 元）、`high`＝`low` × 1.3（塞車、夜間、平台浮動）；一律標 `estimated`，非業者報價。業者估價 `ridehail_estimate` 需合作 |
| 規則 | L2：呼叫前先向使用者確認目的地與要叫車（description 明示；M4 卡片用 `confirmText` 顯示確認視窗）；不代叫車、不付款、不收集個資（ADR-0011） |
| speak | `Uber叫車連結準備好了，到台北101，估計 220～290 元（估算）；開啟後在 App 內確認。` |

## 7. 地點、路況、行程

### ✅ `find_place`

| | |
|---|---|
| 輸入 | `query: string`（1–50 字）、`city?: City` |
| 輸出 | `[{ name, lat, lon, city, cityName, source: 'landmark'\|'station'\|'geocode', kind, nav }]`（`cityName` 中文縣市名）（≤ 5，最符合的在前） |
| 資料 | 內建地標 `core/data/landmarks.json`（201 筆；車站類 `kind=station` 回 `source: 'station'`）；地理編碼（TDX 或 TGOS）⚠️ 待 M1 驗證，尚未串接 |
| 比對 | `normPlace()`：臺→台、去空白與括號、英文小寫，**不去「站」**（「西門站」≠「西門」）。分數：名稱或別名完全相同 3 → 以查詢開頭 2 → 互相包含 1（「我要去逢甲夜市」也能找到）；同分車站優先，再取名稱短的 |
| 錯誤 | 空白查詢、無法辨識的 `city` → `UserError`；找不到回空陣列 |
| 來源標示 | `source: '阿幫內建地標資料（座標為近似值）'`、`static: true` |
| speak | 「「逢甲夜市」最符合的是逢甲夜市（臺中市）。」 |

### ✅ `traffic_status` ⚠️

實作：`core/services/traffic.js`、`traffic-mock.js`、`core/tools/traffic.js`（M3-06）。

| | |
|---|---|
| 輸入 | `from`, `to`：座標 `{ lat, lon }` 或地名（`resolvePoint()` 以 `find_place` 轉座標，找不到 → `UserError`） |
| 輸出 | `{ from, to, fromPoint: { name, lat, lon }, toPoint, level: 'smooth'\|'slow'\|'jam'\|null, delayMin, covered, straightKm, segments: [{ id, name, road, speedKmh, limitKmh, lengthKm, congestion }], events: [{ title, time }], note?, updatedAt }` |
| 沿途路段 | 直線 < 15 km 不查（`covered: false`、`level: null`）。路段中點離起訖連線 ≤ 3 km、投影落在起訖之間、且路段方向與行進方向一致才算沿途；依行進順序排列。長度用 `SectionLength`，沒有就由形狀估；速限缺時以 100 km/h 計 |
| level | 車速 ÷ 速限 < 0.4 為壅塞、< 0.75 為車多。壅塞累計 ≥ 5 km 或整體加權比值 < 0.4 → `jam`；車多以上累計 ≥ 5 km 或比值 < 0.75 → `slow`；其餘 `smooth`；沒有車速資料 → `null`（**不是順暢**） |
| delayMin | 只計車多與壅塞路段：實際行駛時間 − 以速限行駛時間 |
| events | 事件標題或內容提到沿途道路名稱的前 3 筆；事件端點失敗不影響車速結果 |
| speak | 「沿途國道塞車中，預估多花 49 分鐘（…事故…）。」、「沿途國道順暢。」、「起訖很近，不需要看國道路況。」 |

`level = jam` → 自動狀態「塞車中」；`level = null` 時 `plan_trip` 不加狀態。示範模式：`DEMO_TRAFFIC=jam`（或 `createServices({ demo: { traffic: 'jam' } })`）中間一段壅塞並有一則事故；預設順暢。可評估介接 TDX 官方 MCP event。

### ✅ `intercity_bus` ⚠️

實作：`core/services/intercity.js`、`intercity-mock.js`、`core/tools/intercity.js`（M3-07）。

| | |
|---|---|
| 輸入 | `from`, `to`：座標或地名（`T.point`）；`departAt?`：`'HH:mm'`（今天，00:00～23:59，台灣時間）或 ISO 日期時間（例 `2026-11-20T09:00`，沒帶時區視為台灣時間），預設現在 |
| 輸出 | `{ system: 'BUS', from, to, fromPoint, toPoint, date, departAt, traffic: { level, delayMin }, delayRisk, trains: [{ trainNo, type, terminal, depart, arrive, minutes, arriveWithDelay?, delayMin?, estimated?, nextDay?, fare, board, alight, walkFromM, walkToM }] }`（卡片 `timetable`，最多 5 班；`date` 是出發日；服務層也接受 ISO `departAt`，用該日的日期與星期 `ServiceDay` 篩班表；出發時間離午夜不到 3 小時時，一併列出 3 小時內的隔日班次並標 `nextDay: true`） |
| 配對 | `StopOfRoute/InterCity` 各路線：上車站離起點 ≤ 1.5 km、下車站離終點 ≤ 1.5 km、且下車站序在後；同一路線名只留步行最短的一組 |
| 班次 | `Schedule/InterCity` 只查配對到的路線；依 `ServiceDay` 篩今天；上下車時間以 `StopUID`（找不到用站序）對應；沒有下車時間時以直線 × 1.3 ÷ 70 km/h 估算並標 `estimated`；跨日自動 +24h |
| 路況 | 同時查 `traffic_status`：`delayMin` 加到 `arriveWithDelay`；`delayRisk`＝jam 0.9、slow 0.5、smooth 0.2、未知 0.4（國道即使順暢仍有風險）；路況失敗不影響班次 |
| 票價 | TDX 客運票價端點未確認，live 先回 `null`；示範模式有估算票價 |
| speak | 「下一班 1610 18:00 出發，預計 19:40 到（路上塞車中，多 20 分）。」；沒有班次時「…附近沒有直達的國道客運班次。」 |

### ✅ `plan_trip` — 從 A 到 B 怎麼去（卡片 `trip`）

實作：`core/services/trip.js`（`planTrip(svc, …)`，只組合既有服務）、`core/services/bus-direct.js`（`matchDirect`、`commonRoutes`；`bus.directTrips` live／mock 介面相同）、`core/tools/trip.js`（M3-10）。

| | |
|---|---|
| 輸入 | `from`, `to`：座標或地名（`T.point`）；`departAt?`：HH:mm 或 ISO（同 `intercity_bus`）；`prefs?: { states?: ('rush'\|'traffic'\|'rain'\|'luggage'\|'budget'\|'lessWalk'\|'badAir')[], arriveBy?: 'HH:mm', mode?: 'walk'\|'bike'\|'bus'\|'thsr'\|'tra'\|'intercity'\|'ridehail', avoid?: 同 mode 的陣列 }`（`mode`＝使用者指定的交通方式：分數與排名照算，`best` 改成該方式裡分數最高的，`ranking.reason`「照你說的選…」，輸出帶 `mode` 給前端重算；`avoid`＝使用者說不要的方式（「不要叫車」）：直接排除，`ranking.excluded[].why`「你說不要叫車」，輸出帶 `avoid` 給前端重算；決策圖標「不要」；`habit?: { [mode]: 0～1 }`＝使用者同意過的常選比例（選填，總和 ≤ 1.01；沒指定方式、沒說狀況時最多加 8 分，輸出帶 `habit`、`habitOn`，工具文字多一行「習慣…」；ADR-0010 2026-11-21）。輸出另有選填 `ask: { state, from, to, dMin, dCost, text, textEn }`＝關鍵問題（`keyQuestion`：答案取決於使用者時要問的一句，例「叫車（Uber）快 5 分但多 270 元，你趕時間嗎？」；網頁 agent 轉成 `ask` 事件，ADR-0016） |
| 輸出 | `{ from, to, straightKm, date, departAt, best, states: [{ key, source: 'auto'\|'user', from?, detail? }], weather, traffic, options: [Option], ranking: { ranked: [{ id, name, score, breakdown }], excluded: [{ id, name, why }], weights, reason }, unavailable? }`（與 `CARDS.md` `trip` 一致；`unavailable` 列出查詢失敗而略過的方案種類；公車方案另有 `follow`，見 `bus_route_eta`） |
| Option | `{ id, role: 'walk'\|'bike'\|'bus'\|'thsr'\|'tra'\|'intercity'\|'ridehail', name, minutes, waitMin, walkMin, cost, costRange?, exposure, effort, delayRisk, arriveAt, arriveMin（自出發日 00:00 起算，可超過 24 小時；`arriveBy` 以此比較，跨午夜不誤判）, leaveAt?（高鐵／台鐵／客運：最晚出門時間＝發車 − 到站時間）, legs: [{ mode, from: {name, lat, lon}, to: {...}, minutes, detail, nav, url? }], notes[], train?, estimated?: true }` |
| 排序 | `core/decide.js`（ADR-0010） |
| speak | 「比了 4 種方式，因為路上在塞車，建議台鐵自強。」 |

候選方案產生規則：

1. 步行：直線 × 1.3 ÷ 4.5 km/h；> 3 km 仍列出但通常排後。
2. YouBike：起點 500 m 內有車最近站 → 終點 500 m 內有空位最近站；騎乘 = 站距 × 1.3 ÷ 12 km/h。`exposure 1`、`effort 0.8`。
3. 公車直達：起訖 500 m 內站牌路線交集（≤ 3 條）→ 以站序驗證方向 → 等車 = 起站 ETA；乘車 = 站數 × 1.5 分。`exposure 0.2`、`delayRisk` 依路況。
4. 軌道：直線 > 30 km 時查最近高鐵／台鐵站與班次、票價（`rail_fare`）。`delayRisk 0`。
5. 國道客運：`intercity_bus`；`delayRisk` 依路況。
6. 叫車：距離與路況估算時間與價格區間（`estimated: true`）；附 `ridehail_link`。
6.5 第二批狀態（2026-11-21，A1b／S6）：`prefs.party`（同行人數 1～20，「我們 4 個人」）→ 叫車改用每人分攤比較（`TAXI_SEATS` 4 人一輛，超過叫多輛；`cost`／`costRange` 為每人，`share: { party, cars, total }`），自動狀態 `group`（多人同行）。起點天氣現在沒下雨、3 小時降雨機率 ≥ 60% → 自動狀態 `rainSoon`（可能下雨，`exposure` ×2）。指定 `arriveBy` 且最佳方案只早到 10 分內 → `tight: { slackMin }`。輸出 `tips[]`：`{ kind: 'tight'|'rain'|'cost', text }`（時間很緊、帶傘＝降雨機率 ≥ 60% 且雨量站沒量到雨、多人分攤＝叫車在卡片上看得到且沒指定別的方式；數字都來自上面的資料），工具文字以「提醒：…」給模型。`group` 的 `source` 是 `user`（人數是使用者說的）；`group`、`rainSoon`、`traffic` 不能由 `prefs.states` 直接指定。模型模式的 `party` 只採規則從使用者的話抽到的（`groundedPrefs`），預先查詢與比對鍵都含人數。人數 1（「只有我一個人」）清掉前面說的人數。

6.4 捷運（2026-11-21，S7）：起訖點各自 1.2 公里內有捷運站（同一系統）就列「捷運」方案：同一條線直達，不同線估轉乘一次（＋5 分、名稱「捷運（板南線轉文湖線）」）；時間＝兩站直線距離約每公里 2 分＋進出站，票價依距離估（20～65 元），都標 `estimated`。真實路網與轉乘站待 TDX `Metro/S2STravelTime`、`Metro/ODFare`。`prefs.mode`／`avoid` 可用 `metro`。
6.5 深夜（2026-11-21，S10）：出發時間 00:00～05:00 公車不列入（`skipped` 寫原因、建議叫車），23:00 後公車方案帶 `lastBus: true` 與提醒。
7. 自動狀態：查 `traffic_status`（跨城或走一般道路的方案）、`weather_now`（起點）與 `aqi_nearby`（起點，M10）；`raining` → 自動狀態「下雨」，`level = jam` → 「塞車中」，最近測站 AQI > 100 → 「空品不佳」（`detail` 帶測站與 AQI；輸出另有 `air: { site, aqi, status } | null`）。查詢失敗時不加狀態、不中斷規劃。示範：`DEMO_AIR=bad`（或 `createServices({ demo: { air: 'bad' } })`）把示範測站 AQI 調到對敏感族群不健康。

實作細節（M3-10；門檻與估算常數在 `trip.js` 的 `LIMITS`、`EST`）：

| 方案 | 條件（直線） | 時間 | 費用 | 標 `estimated` |
|---|---|---|---|---|
| 步行 | ≤ 6 km | `walkMinutes` | 0 | — |
| YouBike | 0.5～12 km；起點 500 m 內有車、終點 500 m 內有空位 | 走＋騎（站距 × 1.3 ÷ 12 km/h）＋走 | 台北市 2.0 費率（前 30 分 5 元，之後每 30 分 10 元） | — |
| 公車直達 | ≤ 25 km；`bus.directTrips` | 走＋等（ETA − 走路，趕不上以 10 分估）＋站數 × 1.5＋走 | 一段票 15 元 | 等車時間不明時 |
| 高鐵／台鐵 | > 30 km；起訖 25 km 內最近車站（座標由內建地標對照 `stationPoint`） | 到站（1.2 km 內走路，否則市區轉乘 道路 ÷ 20 km/h＋5 分）＋等第一班趕得上的車（最多算 10 分，再多就把 `leaveAt` 往後延）＋車程＋離站；`arriveAt` 以實際班次計算 | 成人單程（台鐵依車種）＋市區轉乘 15 元 | 有市區轉乘或查不到票價時 |
| 國道客運 | ≥ 15 km；`intercity.trips` | 走＋等（走到站牌趕得上的第一班，最多算 10 分）＋車程含路況延誤＋走；`arriveAt` 以實際班次計算 | 票價；缺資料時道路公里 × 1.3 元 | 缺票價或抵達為估算時 |
| 叫車 | 一律 | 等 6 分＋道路 ÷（市區 22／長程 55 km/h）＋路況延誤 | `ridehail_link` 估價區間中位數（`costRange`） | 一律 |

### ✅ `outing_advice` — 出門建議（pack `weather`，卡片 `outing`，2026-11-21）

輸入 `lat`、`lon`（或地名 `place`，由 `find_place` 同一套地標轉座標；兩者都沒有回 `UserError`）、`name?`（卡片標題）、`with?: 'kids'|'elder'`（同行的小孩或長輩：空品門檻放低）。同時查 `weather.now` 與 `life.aqiNearby`（`Promise.allSettled`：一邊查不到也回另一邊；兩邊都失敗才回錯誤），由 `core/agent/outing.js` `outingItems` 整理最多 3 點：`items: [{ kind: 'umbrella'|'hot'|'cold'|'mask'|'ok', level: 'warn'|'info'|'ok', text }]`（降雨 ≥ 50% 帶傘、≥ 30% 折傘；雨量站沒量到雨但已算「下雨」時說「很可能下雨」；≥ 32°C／≥ 28°C／≤ 10°C／≤ 16°C；AQI > 150／> 100、帶小孩或長輩 > 50；都正常＝安心出門）。輸出另有 `weather`（測站、氣溫、降雨機率、是否下雨）、`air`（測站、AQI、狀態）。工具文字附「請照這些重點回答」；speak 只說最重要的一點（「…，還有 2 點在卡片上」）。`weather.demo`／`air.demo` 各自標示示範（只有一邊有金鑰時不把真實資料說成示範），`missing: ['weather'|'air']` 表示那一邊這次查不到（卡片寫明）。沒有任何數字時不說「安心出門」。模型模式：說了地點直接用 `place` 查、沒拿到位置先看預設地點（並請模型說明），判斷層把出門建議判成空品或行程時規則的出門建議優先。示範與模型模式的出門建議都改用這個工具（原本天氣、空品兩張卡）。

### ✅ `weather_tomorrow` — 明天的預報（pack `weather`，2026-11-21）

輸入 `lat`、`lon`。最近觀測站的鄉鎮 → `F-D0047-089` 鄉鎮預報（1h 快取）取**明天（台灣時間）**的時段：`{ town, county, date: 'YYYY-MM-DD', pop: 明天各時段降雨機率最高值, dayPop: 白天（06～18 時）最高值, minT, maxT, wx }`；沒有時區的時間一律當台灣時間；元素名稱防禦性比對（「3小時／12小時降雨機率」「溫度／最高溫度／最低溫度」「天氣現象」）⚠️。沒有明天的資料回 `CwaError`。speak：「明天 11/22（日） 臺北市中正區多雲短暫雨，18～26°C，降雨機率 60%，記得帶傘。」（看白天降雨機率：≥ 50% 帶傘、≥ 30% 折傘；沒有鄉鎮名稱說「那一帶」）。「後天」「週末」「禮拜X」：說明只查得到現在和明天，不拿現在的天氣充數。示範：雨天情境 70%、晴 20%。問「明天會下雨嗎」「明天出門要帶傘嗎」用這個（`weather_now` 只有現在）。

### ✅ `weather_now` — 現在與接下來 3 小時天氣（pack `weather`）

| | |
|---|---|
| 輸入 | `lat`, `lon` |
| 輸出 | `{ station, town, county, distanceM, observedAt, tempC, rainMm1h: number\|null, rainStation: string\|null, pop3h: 0–100\|null, raining: boolean, summary }`（`rainMm1h` 是最近且 5 公里內雨量站的過去 1 小時雨量；沒有就 null；`pop3h` 取所在縣市＋鄉鎮尚未結束的預報時段，同名鄉鎮以縣市區分） |
| 資料 | 中央氣象署開放資料平臺（需 `CWA_API_KEY` 授權碼）：自動氣象站觀測 `O-A0001-001`／`O-A0003-001`（10m，氣溫、天氣）、雨量站 `O-A0002-001`（10m，`RainfallElement.Past1hr.Precipitation`；氣象站的 `Now.Precipitation` 是當日累積，不用）、鄉鎮天氣預報 `F-D0047-*`（1h）⚠️ 欄位待 M1 驗證 |
| 判斷 | `raining = rainMm1h > 0 || pop3h ≥ 70`（`isRaining`） |
| 模式 | `modeOf: svc.weatherMode`：有 `CWA_API_KEY` 才是 live，與 TDX 金鑰無關；來源標示「中央氣象署」；示範提示「尚未設定中央氣象署授權碼」 |
| 示範 | `DEMO_WEATHER=rain`（或 `createServices({ demo: { weather: 'rain' } })`）：雨量 2.5 mm、降雨機率 80%；預設多雲、10% |
| speak | 「中正區現在下雨，接下來 3 小時降雨機率 80%。」 |

### ✅ 生活服務（pack `life`，M10）

| tool | 輸入 | 輸出 `data` 重點 |
|---|---|---|
| `aqi_nearby` | `lat`, `lon` | `nearest { site, county, aqi, status, level, pollutant, pm25, pm10, o3, publishTime, distanceM }`、`nearby[3]` |
| `earthquake_recent` | `county?`, `limit`（1–10，預設 5） | `quakes[{ no, kind: significant\|local, time, magnitude, depthKm, location, maxIntensity, countyIntensity?, areas, report }]` |
| `pharmacy_search` | `area?`（例 臺北市大安區）, `query?`, `lat?`／`lon?`（沒說地區時依位置推估縣市＋鄉鎮區：`weather.district`，真實用最近觀測站（只查測站，不抓雨量與預報）、示範用 `weather-mock.js` 內建大約中心；推估不出或只給一個座標回 `UserError`；輸出 `areaFrom: { by: 'location', station, distanceM, demo }`，文字開頭「依位置推估在「X」（最近的測站：Y），不對請說哪一區。」） | `weekday`、`pharmacies[{ code, name, phone, address, today: ['上午'…]\|null, openToday, nav.google（地圖搜尋） }]`（最多 20） |
| `garbage_truck_nearby` | `lat`, `lon`, `radius`（100–1000，預設 500） | `stops[{ city, place, route, time, collectToday, days, distanceM, nav, truck? }]`、`covered`（臺北市、新北市） |
| `fuel_price` | — | `effectiveDate`、`prices[{ name, price, unit }]`（92／95／98／超級柴油） |
| `invoice_lottery` | `number?`（8 碼或末 3 碼；沒有任何數字的值，例如模型放進「這期」，視為沒給）, `period?`（例 11507） | `period { title, special, grand, first[] }`、`periods[6]`、`check? { prize, amount, partial?, note? }` |
| `invoice_check_batch` | `items: [{ number（8 碼）, date?（消費日 YYYY-MM-DD，不能是未來）\| period? }]`（1–50 張） | `{ latest: { period, title }, results: [{ number, date?, period, drawDate, status: 'won'\|'lost'\|'pending'\|'unavailable', title?, prize?, amount? }], summary: { won, lost, pending, unavailable, amount } }`；期別＝民國年＋單數起始月（`invoicePeriodOf`），開獎日＝期別後單數月 25 日（`invoiceDrawDate`）；比對規則與 `invoice_lottery` 共用 `checkInvoice`；號碼只比對、不保存 |

### ✅ 股市（pack `finance`）

| tool | 輸入 | 輸出 `data` 重點 |
|---|---|---|
| `stock_quote` | `query?`：代號或名稱，多檔用「、」分隔（最多 5 檔）；不給只回指數 | `indices[{ id: taiex\|tpex, name, date, close, change, changePct }]`、`quotes[{ code, name, market: 上市\|上櫃, date, open, high, low, close, change, changePct, volumeLots（張）, value, trades, query, similar?[{ code, name }] }]`、`notFound[]`（找不到不丟錯） |

- 比對：代號完全相同 → 名稱相同（臺／台視為相同）→ 名稱開頭 → 名稱包含（短名優先）；不是完全相同時附 `similar` 讓使用者改選。
- 收盤資料，每檔帶自己的日期；文字一律附「收盤資料，非即時報價；僅供參考，不構成投資建議」。漲跌在文字中寫成「漲 5（0.23%）」「跌 54（9.93%）」，不寫「+5」「-54」（地端小模型會說反）。
- 只報數字：`PACK_GUARDRAILS.finance` 禁止買賣建議與漲跌預測；輸出護欄 `no-investment-advice`（`core/agent/guardrails.js`）把含買賣建議、看漲看跌、目標價、明牌的句子整句換成固定說法並送 `guardrail` 事件。

| speak 範例 | 「台積電 11/18 收 2175，漲 5（0.23%）；環球晶 11/19 收 490，跌 54（9.93%）。」 |
|---|---|

模式：`aqiMode`（環境部金鑰）、`quakeMode`（氣象署授權碼）、`openDataMode`（其他，免金鑰；`DEMO_MODE=1`／`OPEN_DATA=0` 用 `core/data/demo/` 片段）。來源與欄位見 `DATA_SOURCES.md` §5.2。

### ✅ 防詐（pack `antifraud`，M7）

輸入、輸出、風險等級與寄件號碼規則見 `AGENT_ANTIFRAUD.md` §3。資料：165 遭停止解析涉詐網站（約 10 萬網域）、165 詐騙闢謠專區（CSV，24 小時快取；`DEMO_MODE=1` 或 `OPEN_DATA=0` 用 `core/data/demo/` 片段）＋規則庫 `core/data/scam-rules.json`。L2：不說「安全」，查不到只說「沒有發現已知的詐騙特徵，但不代表一定安全」，一律附 165。

| speak 範例 | 「高風險：有 1 個網址在 165 涉詐清單上，先不要照做。」 |
|---|---|

## 8. 卡片種類

見 `CARDS.md`：`bus-route`、`bus-station`、`nearby`、`youbike`、`metro`、`timetable`、`trip`、`scam-risk`（M7）、`weather`、`aqi`、`quake`、`pharmacy`、`garbage`、`fuel`、`invoice`（M10）、`stock`。
