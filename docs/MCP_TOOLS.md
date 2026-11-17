# MCP Tools 規格

版本：v0.4（2026-11-17）　狀態：✅ 已完成　📝 待實作　⚠️ 端點待 M1 驗證

## 1. 共通約定

- 定義位置：`core/tools/<pack>.js`，以 `defineTool()` 註冊（ADR-0002）。
- 所有 tools 唯讀：`annotations.readOnlyHint = true`、`openWorldHint = true`。
- 每個 tool 必有 `pack`、`tier`、`speak(data, args)`。
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
| `bus_route_eta` | transit | L1 | `bus-route` | ✅（📝 加座標、形狀） |
| `bus_nearby_stations` | transit | L1 | `nearby` | ✅（含 `nav`） |
| `bus_station_eta` | transit | L1 | `bus-station` | ✅ ⚠️ |
| `youbike_nearby` | transit | L1 | `youbike` | ✅（含 `nav`） |
| `thsr_timetable` | transit | L1 | `timetable` | ✅ |
| `tra_timetable` | transit | L1 | `timetable` | ✅ |
| `rail_stations` | transit | L1 | — | ✅ |
| `metro_stations` | transit | L1 | — | 📝 ⚠️ |
| `metro_live_board` | transit | L1 | `metro` | 📝 ⚠️ |
| `find_place` | transit | L1 | — | 📝 |
| `traffic_status` | transit | L1 | — | 📝 ⚠️ |
| `intercity_bus` | transit | L1 | `timetable` | 📝 ⚠️ |
| `rail_fare` | transit | L1 | — | 📝 ⚠️ |
| `plan_trip` | transit | L1 | `trip` | 📝 |
| `rail_booking_link` | transit | **L2** | （時刻表按鈕） | 📝 ⚠️ 需 TDX 權限 |
| `ridehail_link` | ridehail | **L2** | （行程卡按鈕） | 📝 |
| `weather_now` | weather | L1 | — | 📝 需 CWA 授權碼 |

## 3. 公車

### ✅ `bus_route_eta` — 公車路線即時到站

| | |
|---|---|
| 輸入 | `city: City`, `routeName: string` |
| 輸出 | `{ city, routeName, updatedAt, directions: [{ direction, label, stops: [{ seq, stopName, lat?, lon?, ...Eta, plate }] }], shape?: [[lat, lon]] }` |
| TDX | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}/{Route}`（1h）、`/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{Route}`（20s）、`/basic/v2/Bus/Route/City/{City}/{Route}`（1h）、📝 `/basic/v2/Bus/Shape/City/{City}/{Route}`（1h，WKT）⚠️ |
| 篩選 | `$filter=RouteName/Zh_tw eq '{Route}'`（路徑參數會模糊比對） |
| speak | 「307 目前有 3 個站即將有車（例如北門、中山堂）。」 |
| 📝 M3 | stops 加 `lat/lon`（`StopPosition`）、加 `shape` |

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

### 📝 `rail_fare` ⚠️

輸入 `system`, `from`, `to`；輸出 `[{ ticketType, cabin?, price }]`。TDX 台鐵／高鐵 ODFare（10m）。也可評估改用 TDX 官方 MCP。

### 📝 `metro_stations`／`metro_live_board` ⚠️

輸入 `system: 'TRTC'|'TYMC'|'TMRT'|'KRTC'`（＋`station`）；輸出 `{ station, trains: [{ line, destination, etaMin, status }] }`；TDX `/basic/v2/Rail/Metro/Station/{Op}`（24h）、`/basic/v2/Rail/Metro/LiveBoard/{Op}`（20s）。北捷看板資料有限，M1 實測後決定是否以 `StationTimeTable` 推算。

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

已附 `nav`：`bus_nearby_stations`、`youbike_nearby`（tool 層包裝，live 與 mock 一致）。`bus_route_eta` 站點於 M3-02、`plan_trip` 各段於 M3-10 加上；`leaveAt` 於 M3-10 與 M4 卡片使用。

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

### 📝 `find_place`

輸入 `query`；輸出 `[{ name, lat, lon, city, source: 'landmark'|'station'|'geocode' }]`（≤ 5）。順序：內建地標 `core/data/landmarks.json`（約 150 筆）→ 車站名稱 → 地理編碼（TDX 或 TGOS，⚠️ 待驗證）。

### 📝 `traffic_status` ⚠️

輸入 `from`, `to`（座標或地名）；輸出 `{ level: 'smooth'|'slow'|'jam', delayMin, segments: [{ name, speedKmh }], events: [] }`。資料：TDX 高速公路路段旅行時間、即時路況、道路事件（可評估介接 TDX 官方 MCP event）（60s）。`level = jam` → 自動狀態「塞車中」。

### 📝 `intercity_bus` ⚠️

輸入 `from`, `to`, `departAt?`；輸出班次、預估抵達（含路況延誤）、票價。資料：TDX 公路客運。

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

### 📝 `weather_now` — 現在與接下來 3 小時天氣（pack `weather`）

| | |
|---|---|
| 輸入 | `lat`, `lon` |
| 輸出 | `{ station, observedAt, tempC, raining: boolean, rainMm1h, pop3h: 0–100, summary }` |
| 資料 | 中央氣象署開放資料平臺（需 `CWA_API_KEY` 授權碼）：自動氣象站觀測 `O-A0001-001`／`O-A0003-001`（10m）、鄉鎮天氣預報 `F-D0047-*`（1h）⚠️ 欄位待 M1 驗證 |
| 判斷 | `raining = rainMm1h > 0 || pop3h ≥ 70` |
| speak | 「中正區現在下雨，接下來 3 小時降雨機率 80%。」 |

## 8. 卡片種類

見 `CARDS.md`：`bus-route`、`bus-station`、`nearby`、`youbike`、`metro`、`timetable`、`trip`。
