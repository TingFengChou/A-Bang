# MCP Tools 規格

版本：v0.4（2026-11-17）　狀態：✅ 已完成　📝 待實作　⚠️ 端點待 M1 驗證

## 1. 共通約定

- 定義位置：`core/tools/<pack>.js`，以 `defineTool()` 註冊（ADR-0002）。
- 所有 tools 唯讀：`annotations.readOnlyHint = true`、`openWorldHint = true`。
- 每個 tool 必有 `pack`、`tier`、`speak(data, args)`；選填 `source`（資料來源標示，預設 TDX）、`static`（內建資料、不依賴金鑰：示範模式不加「示範資料」提示）、`modeOf(svc)`（資料不是 TDX 時自己判斷 live／demo）、`demoNote`（示範提示文字）。
- `callTool()` 回傳：`{ name, card, mode, data, text, speak }`（📝 M3 加 `metrics`）。
- MCP 回傳：

```jsonc
{
  "content": [{ "type": "text", "text": "【示範資料…】（示範模式）摘要（≤ 1500 字）\n\n資料來源：交通部 TDX 運輸資料流通服務" }],
  "structuredContent": { "card": "bus-route", "mode": "live|demo", "speak": "一句話", "data": { } },
  "_meta（tool 定義上）": { "abang/pack": "transit", "abang/tier": "L1", "abang/card": "bus-route" }
}
```

- 錯誤：輸入錯誤 → `UserError`（MCP `isError: true`、HTTP 400），訊息為可行動的繁體中文。
- `speak`：討論串中小幫手的一句話（< 60 字），**只由資料產生、不經模型**（ADR-0009）。
- 有座標的結果附 `nav`（§6）。

### 共用型別

| 名稱 | 定義 |
|---|---|
| `City` | `Taipei`／`TPE`／`台北市`／`臺北` 皆可（`core/cities.js`） |
| `LatLon` | `lat` 21–27、`lon` 118–123（WGS84） |
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
| `plan_trip` | transit | L1 | `trip` | 📝 |
| `rail_booking_link` | transit | **L2** | （時刻表按鈕） | 📝 ⚠️ 需 TDX 權限 |
| `ridehail_link` | ridehail | **L2** | （行程卡按鈕） | 📝 |
| `weather_now` | weather | L1 | — | ✅（真實資料需 CWA 授權碼）⚠️ |

## 3. 公車

### ✅ `bus_route_eta` — 公車路線即時到站

| | |
|---|---|
| 輸入 | `city: City`, `routeName: string` |
| 輸出 | `{ city, routeName, updatedAt, directions: [{ direction, label, stops: [{ seq, stopName, lat?, lon?, ...Eta, plate, nav }] }], shape?: [[lat, lon]] }` |
| TDX | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}/{Route}`（1h）、`/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{Route}`（20s）、`/basic/v2/Bus/Route/City/{City}/{Route}`（1h）、`/basic/v2/Bus/Shape/City/{City}/{Route}`（1h，WKT）⚠️ |
| 篩選 | `$filter=RouteName/Zh_tw eq '{Route}'`（路徑參數會模糊比對） |
| speak | 「307 目前有 3 個站即將有車（例如北門、中山堂）。」 |
| 座標 | 站點 `lat/lon` 取 `StopPosition`（缺座標的站不帶 `lat/lon`，`nav` 為 `null`）；`nav` 在 tool 層加（§6） |
| shape | ✅ M3-02：取 `Direction = 0` 那筆（沒有就第一筆）的 `Geometry`（WKT），`core/geo.js` 解析 `LINESTRING`／`MULTILINESTRING`（`lon lat` → `[lat, lon]`，順序寫反會自動換回）、串接成一條、超過 400 點等距抽樣；形狀端點失敗或格式不明時省略 `shape`，到站資料照常。示範模式以站點加中點產生 |

### ✅ `bus_search_routes`

輸入 `city`, `keyword`；輸出 `[{ city, routeName, departure, destination }]`；TDX `/basic/v2/Bus/Route/City/{City}` + `contains(RouteName/Zh_tw,'kw')`（1h）。

### ✅ `bus_nearby_stations`

輸入 `lat`, `lon`, `radius?`（預設 400，上限 1000）；輸出 `[{ stationId, stationUid, city, name, lat, lon, distance, routes[], nav? }]`；TDX `/advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(lat,lon,r)`（1h）；`city` 由 `StationUID` 前三碼推得。

### ✅ `bus_station_eta` ⚠️

輸入 `city`, `stationId`；輸出依到站排序的 `[{ routeName, direction, ...Eta }]`；TDX `/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/PassThrough/Station/{StationID}`（20s）。

## 4. YouBike

### ✅ `youbike_nearby`

輸入 `lat`, `lon`, `radius?`（預設 500）；輸出 `[{ uid, name, type, address, lat, lon, distance, capacity, rent, general, electric, returnSlots, inService, updatedAt, nav? }]`；TDX `/advanced/v2/Bike/Station/NearBy`（1h）＋ `/advanced/v2/Bike/Availability/NearBy`（30s），以 `StationUID` 合併。speak：「最近有車的是捷運台北車站M8（120 公尺），還有 12 台。」

## 5. 軌道與捷運

### ✅ `thsr_timetable`／`tra_timetable`

輸入 `from`, `to`（中文站名或代碼，台／臺通用）, `date?`；輸出 `{ from, to, date, trains: [{ trainNo, type?, depart, arrive, minutes, terminal? }] }`。
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
| 輸入 | `system: 'TRTC'\|'TYMC'\|'TMRT'\|'KRTC'` | `system`、`station`（站名或代碼，台／臺通用，例 台北車站、BL12） |
| 輸出 | `[{ id, ids, name, lat?, lon?, nav }]`；同名多線合併成一站，`ids` 列出所有代碼 | `{ system, station, stationId, lat?, lon?, nav, updatedAt, trains: [{ line, lineId, destination, etaMin, status }] }`，依 `etaMin` 排序、沒有時間的在後 |
| TDX | `/basic/v2/Rail/Metro/Station/{Op}`（24h） | 先查車站，再 `/basic/v2/Rail/Metro/LiveBoard/{Op}`（20s，`$filter` 該站所有代碼） |
| 欄位 | `StationID`、`StationName`、`StationPosition` | `LineName`／`LineID`／`LineNO`、`DestinationStationName`（缺時用 `TripHeadSign`）、`EstimateTime`（分鐘）、`UpdateTime` |
| status | — | 0 分「進站中」、1 分「即將進站」、其他「N 分」、無資料「—」 |
| speak | 「桃園機場捷運共有 6 個車站。」 | 「美麗島最快 3 分鐘後有往小港的車。」；沒資料時「…目前沒有即時到站資料。」 |

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

### 📝 `rail_booking_link` — 台鐵／高鐵導訂票（L2）⚠️

| | |
|---|---|
| 輸入 | `system: 'THSR'|'TRA'`, `trainNo`, `date`, `from`, `to`, `tickets`（1–4）, `carType?`（高鐵：標準／商務） |
| 輸出 | `{ url, expiresAt, summary }`：開啟官方訂票網站並自動帶入；連結具時效 |
| TDX | 台鐵／高鐵「導訂票」API（**前置：在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限**） |
| 規則 | 產生前需使用者確認車次、日期、張數；不代替付款或填個資 |

### 📝 `ridehail_link`（L2）

依起訖座標產生叫車 App 深層連結；adapter：`core/providers/ridehail/uber.js`
`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]={lat}&dropoff[longitude]={lon}&dropoff[nickname]={name}`。
估價 `ridehail_estimate` 需業者合作；在此之前 `plan_trip` 以距離與路況估算區間並標示「估算」。

## 7. 地點、路況、行程

### ✅ `find_place`

| | |
|---|---|
| 輸入 | `query: string`（1–50 字）、`city?: City` |
| 輸出 | `[{ name, lat, lon, city, source: 'landmark'\|'station'\|'geocode', kind, nav }]`（≤ 5，最符合的在前） |
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
| 輸入 | `from`, `to`：座標或地名（`T.point`）；`departAt?: 'HH:mm'`（台灣時間，預設現在） |
| 輸出 | `{ system: 'BUS', from, to, fromPoint, toPoint, date, departAt, traffic: { level, delayMin }, delayRisk, trains: [{ trainNo, type, terminal, depart, arrive, minutes, arriveWithDelay?, delayMin?, estimated?, nextDay?, fare, board, alight, walkFromM, walkToM }] }`（卡片 `timetable`，最多 5 班；`date` 是出發日；服務層也接受 ISO `departAt`，用該日的日期與星期 `ServiceDay` 篩班表；出發時間離午夜不到 3 小時時，一併列出 3 小時內的隔日班次並標 `nextDay: true`） |
| 配對 | `StopOfRoute/InterCity` 各路線：上車站離起點 ≤ 1.5 km、下車站離終點 ≤ 1.5 km、且下車站序在後；同一路線名只留步行最短的一組 |
| 班次 | `Schedule/InterCity` 只查配對到的路線；依 `ServiceDay` 篩今天；上下車時間以 `StopUID`（找不到用站序）對應；沒有下車時間時以直線 × 1.3 ÷ 70 km/h 估算並標 `estimated`；跨日自動 +24h |
| 路況 | 同時查 `traffic_status`：`delayMin` 加到 `arriveWithDelay`；`delayRisk`＝jam 0.9、slow 0.5、smooth 0.2、未知 0.4（國道即使順暢仍有風險）；路況失敗不影響班次 |
| 票價 | TDX 客運票價端點未確認，live 先回 `null`；示範模式有估算票價 |
| speak | 「下一班 1610 18:00 出發，預計 19:40 到（路上塞車中，多 20 分）。」；沒有班次時「…附近沒有直達的國道客運班次。」 |

### 📝 `plan_trip` — 從 A 到 B 怎麼去（卡片 `trip`）

| | |
|---|---|
| 輸入 | `from: LatLon \| { query }`, `to: LatLon \| { query }`, `departAt?`, `prefs?: { states?: ('rush'\|'traffic'\|'rain'\|'luggage'\|'budget'\|'lessWalk')[], arriveBy?: 'HH:mm' }` |
| 輸出 | `{ from, to, straightKm, autoStates: [{ key, from }], options: [Option], ranking: { ranked, excluded, reason } }` |
| Option | `{ id, role, name, minutes, waitMin, walkMin, cost, exposure, effort, delayRisk, arriveAt?, leaveAt?, legs: [{ mode, from: {name, lat, lon}, to: {...}, minutes, detail, nav }], notes[], estimated?: true }` |
| 排序 | `core/decide.js`（ADR-0010） |
| speak | 「比了 4 種方式，因為路上在塞車，建議台鐵自強。」 |

候選方案產生規則：

1. 步行：直線 × 1.3 ÷ 4.5 km/h；> 3 km 仍列出但通常排後。
2. YouBike：起點 500 m 內有車最近站 → 終點 500 m 內有空位最近站；騎乘 = 站距 × 1.3 ÷ 12 km/h。`exposure 1`、`effort 0.8`。
3. 公車直達：起訖 500 m 內站牌路線交集（≤ 3 條）→ 以站序驗證方向 → 等車 = 起站 ETA；乘車 = 站數 × 1.5 分。`exposure 0.2`、`delayRisk` 依路況。
4. 軌道：直線 > 30 km 時查最近高鐵／台鐵站與班次、票價（`rail_fare`）。`delayRisk 0`。
5. 國道客運：`intercity_bus`；`delayRisk` 依路況。
6. 叫車：距離與路況估算時間與價格區間（`estimated: true`）；附 `ridehail_link`。
7. 自動狀態：查 `traffic_status`（跨城或走一般道路的方案）與 `weather_now`（起點）；`raining` → 自動狀態「下雨」，`level = jam` → 「塞車中」。查詢失敗時不加狀態、不中斷規劃。

### ✅ `weather_now` — 現在與接下來 3 小時天氣（pack `weather`）

| | |
|---|---|
| 輸入 | `lat`, `lon` |
| 輸出 | `{ station, town, county, distanceM, observedAt, tempC, rainMm1h: number\|null, rainStation: string\|null, pop3h: 0–100\|null, raining: boolean, summary }`（`rainMm1h` 是最近且 5 公里內雨量站的過去 1 小時雨量；沒有就 null） |
| 資料 | 中央氣象署開放資料平臺（需 `CWA_API_KEY` 授權碼）：自動氣象站觀測 `O-A0001-001`／`O-A0003-001`（10m，氣溫、天氣）、雨量站 `O-A0002-001`（10m，`RainfallElement.Past1hr.Precipitation`；氣象站的 `Now.Precipitation` 是當日累積，不用）、鄉鎮天氣預報 `F-D0047-*`（1h）⚠️ 欄位待 M1 驗證 |
| 判斷 | `raining = rainMm1h > 0 || pop3h ≥ 70`（`isRaining`） |
| 模式 | `modeOf: svc.weatherMode`：有 `CWA_API_KEY` 才是 live，與 TDX 金鑰無關；來源標示「中央氣象署」；示範提示「尚未設定中央氣象署授權碼」 |
| 示範 | `DEMO_WEATHER=rain`（或 `createServices({ demo: { weather: 'rain' } })`）：雨量 2.5 mm、降雨機率 80%；預設多雲、10% |
| speak | 「中正區現在下雨，接下來 3 小時降雨機率 80%。」 |

## 8. 卡片種類

見 `CARDS.md`：`bus-route`、`bus-station`、`nearby`、`youbike`、`metro`、`timetable`、`trip`。
