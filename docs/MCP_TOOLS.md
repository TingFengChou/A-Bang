# MCP Tools 規格

版本：v0.4（2026-11-17）　狀態：✅ 已完成　📝 待實作　⚠️ 端點待 M1 驗證

## 1. 共通約定

- 定義位置：`core/tools/<pack>.js`，以 `defineTool()` 註冊（ADR-0002）。
- 所有 tools 唯讀：`annotations.readOnlyHint = true`、`openWorldHint = true`。
- 每個 tool 必有 `pack`、`tier`、`speak(data, args)`；選填 `source`（資料來源標示，預設 TDX）、`static`（內建資料、不依賴金鑰：示範模式不加「示範資料」提示）、`modeOf(svc)`（資料不是 TDX 時自己判斷 live／demo）、`demoNote`（示範提示文字）。
- `callTool()` 回傳：`{ name, card, v?, mode, data, text, speak, args, metrics }`（`v`＝卡片契約版本，有卡片時才有；`args`＝驗證後參數）；`metrics = { calls, cacheHits, cacheHit, scanned, ms }`（`core/metrics.js`：TDX／氣象署取用次數含快取、全部由快取取得、上游回應筆數、耗時；示範模式 `calls`／`scanned` 為 0）。REST 原樣回傳；MCP 放在結果 `_meta['abang/metrics']`（每次不同，不混進 `structuredContent`）。
- 輸入 JSON Schema（`describeTool().inputSchema`：OpenAPI、`/api/v1/tools`、模型工具定義共用）用 zod 的**輸入端**（`z.toJSONSchema(schema, { io: 'input' })`）：有預設值的參數（`earthquake_recent.limit`、`garbage_truck_nearby.radius`、`drama_picks.limit`…）不列為必填。
- 日期參數（`T.date`）要是日曆上真的有的 `YYYY-MM-DD`（`2026-13-45`、`2026-02-30` 回 `UserError` 400）；服務層組 TDX 網址時再驗一次（`railDate`），路徑段（站代碼、日期）一律 `encodeURIComponent`，查詢字串不能改到別的 TDX 端點。站名空白（或只有「站」）也是 `UserError`，不會配到第一站。
- 舊版 REST（`server/rest.js` 路由表，PWA 頁面用）：`runRoute()` 先依路由表檢查查詢字串（去空白、空的當沒填；`required`、`number`／`integer`、`boolean`、`format: 'date'`、`minimum` 不對回 400，訊息說要加或改哪個參數），再在與 tool 相同的計量範圍（`measure()`）內執行；TDX 額度用完改用示範資料時回 `{ mode: 'demo', fallback: 'tdx-limit', data }`（不把示範資料標成 live；前端不存成離線的「上次的資料」）。路由裡再呼叫 tool（下車提醒）時，tool 的 fallback 也會往外標。沒有的路徑回 404「沒有這個 API」。
- MCP 回傳：

```jsonc
{
  "content": [{ "type": "text", "text": "【示範資料…】（示範模式；有金鑰但 TDX 額度用完時說「TDX 每分鐘的查詢額度用完，這次先用示範資料」）摘要（≤ 1500 字）\n\n資料來源：交通部 TDX 運輸資料流通服務" }],
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
| `bus_route_eta` | transit | L1 | `bus-route` | ✅（含座標、`nav`、`shape`；2026-11-23 實測） |
| `bus_nearby_stations` | transit | L1 | `nearby` | ✅（含 `nav`） |
| `bus_station_eta` | transit | L1 | `bus-station` | ✅ ⚠️ |
| `youbike_nearby` | transit | L1 | `youbike` | ✅（含 `nav`） |
| `thsr_timetable` | transit | L1 | `timetable` | ✅ |
| `tra_timetable` | transit | L1 | `timetable` | ✅ |
| `rail_stations` | transit | L1 | — | ✅ |
| `metro_stations` | transit | L1 | — | ✅ ⚠️ |
| `metro_live_board` | transit | L1 | `metro` | ✅ ⚠️ |
| `metro_route` | transit | L1 | `metro-route` | ✅ |
| `find_place` | transit | L1 | — | ✅（內建地標；TDX 地理編碼可用、尚未串接） |
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
| `drama_picks` | drama | L1 | `drama` | ✅（2026-11-22，MyDrama 公開片庫，ADR-0019；沒設定 `MYDRAMA_API_BASE` 用虛構示範片庫） |
| `drama_search` | drama | L1 | `drama` | ✅（同上） |
| `drama_series` | drama | L1 | `drama` | ✅（同上） |
| `scam_check_message` | antifraud | **L2** | `scam-risk` | ✅（M7） |
| `scam_lookup_url` | antifraud | **L2** | — | ✅（M7） |
| `scam_myth_search` | antifraud | L1 | — | ✅（M7） |
| `sms_sender_check` | antifraud | **L2** | — | ✅（M7，內建規則） |

## 3. 公車

### ✅ `bus_route_eta` — 公車路線即時到站

| | |
|---|---|
| 輸入 | `city?: City`（有 `near` 時可省略，用最近地標推估）, `routeName: string`, `stop?: string`（要盯的站，例如上車站）, `direction?: 0\|1`, `near?: Point`（使用者現在的位置；有 `stop` 但沒給 `city` 時只用來推縣市〔M14-02 拍站牌〕；沒說站名時聚焦路線上離他最近的站，`focus` 加 `distanceM`、`nearest: true`；兩個方向都有同一站時挑車比較快到的方向；另一個方向離你最近的站放 `focus.other`，speak 兩個方向都說）, `toward?: string`（往哪個方向，例「板橋」：只看方向名稱或終點有這個地名的那一邊；對不到時 `toward.found: false`、speak 照實說「沒有往「板橋」的方向」並兩個方向都列，PM Q-18） |
| 輸出 | `{ city, routeName, updatedAt, directions: [{ direction, label, stops: [{ seq, stopName, lat?, lon?, ...Eta, plate, nav }] }], shape?: [[lat, lon]], focus?: { direction, label, seq, stopName, etaSec, status, statusText, other? }, toward?: { name, found, direction?, label? } }`；給 `stop` 時依站名（臺／台相同）找站、先找 `direction` 那一邊，找到才有 `focus`，找不到文字說明「這條路線沒有…這一站」 |
| TDX | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}/{Route}`（1h；只收臺北、新北、桃園、臺中、臺南，其他縣市 400 → 改用 `/basic/v2/Bus/StopOfRoute/City/{City}/{Route}`，每個子路線一個方向一筆，2026-11-23 實測）、`/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{Route}`（20s）、`/basic/v2/Bus/Route/City/{City}/{Route}`（1h）、`/basic/v2/Bus/Shape/City/{City}/{Route}`（1h，WKT `LINESTRING (經度 緯度, …)`，2026-11-23 實測；另有 `EncodedPolyline` 未用） |
| 篩選 | `$filter=RouteName/Zh_tw eq '{Route}'`（路徑參數會模糊比對） |
| 跨縣市（2026-11-22 真實資料健檢） | 給的（或依位置推估的）縣市找不到這條路線時，依 `NEIGHBOR_CITIES`（台北↔新北、基隆、桃園；桃園↔新北、台北、新竹）找相鄰縣市：只用預熱快取的路線清單判斷在哪個縣市（服務 `bus.routeCities(routeName)`，只讀存檔、不打 TDX；示範資料同介面），找到才查那個縣市；輸出多 `cityMoved: { from, to }`，speak 句尾「（新北市沒有 307，這是臺北市的 307）」。清單也沒有照原本的 `UserError` |
| speak | 「307 目前有 3 個站即將有車（例如北門、中山堂）。」；有 `focus` 時「601 約 6 分後到「西門」。」（不到 3 分「即將到」、不到 1 分「在「西門」進站中」） |
| 選公車就盯（L-14） | `plan_trip` 的公車方案帶 `follow: { city, routeName, stop, direction?, walkMin }`；決策選公車時 agent 執行器（`core/agent/run.js` `busFollowUp`）自動呼叫本 tool 盯上車站，示範與模型模式相同 |
| 座標 | 站點 `lat/lon` 取 `StopPosition`（缺座標的站不帶 `lat/lon`，`nav` 為 `null`）；`nav` 在 tool 層加（§6） |
| shape | ✅ M3-02：取 `Direction = 0` 那筆（沒有就第一筆）的 `Geometry`（WKT），`core/geo.js` 解析 `LINESTRING`／`MULTILINESTRING`（`lon lat` → `[lat, lon]`，順序寫反會自動換回）、串接成一條、超過 400 點等距抽樣；形狀端點失敗或格式不明時省略 `shape`，到站資料照常。示範模式以站點加中點產生 |

### ✅ `bus_search_routes`

輸入 `city`, `keyword`；輸出 `[{ city, routeName, departure, destination }]`；TDX `/basic/v2/Bus/Route/City/{City}` + `contains(RouteName/Zh_tw,'kw')`（1h）。

### ✅ `bus_nearby_stations`

輸入 `lat`, `lon`, `radius?`（預設 400，上限 1000）；輸出 `{ lat, lon, radius, stations: [{ stationId, stationUid, city, name, lat, lon, distance, routes[], nav? }] }`（M4-01 起為物件，卡片 `nearby`）；TDX `/advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(lat,lon,r)`（1h）；`city` 由 `StationUID` 前三碼推得。

### ✅ `bus_station_eta`

輸入 `city`, `stationId`；輸出 `{ city, stationId, arrivals: [{ routeName, direction, ...Eta }] }`（依到站排序；M4-01 起為物件，卡片 `bus-station`）；TDX `/advanced/v2/Bus/EstimatedTimeOfArrival/City/{City}/PassThrough/Station/{StationID}`（20s；2026-11-22 實測 `/basic/` 是 404）。

## 4. YouBike

### ✅ `youbike_nearby`

輸入 `lat`, `lon`, `radius?`（預設 500）；輸出 `{ lat, lon, radius, stations: [{ uid, name, type, address, lat, lon, distance, capacity, rent, general, electric, returnSlots, inService, updatedAt, nav? }] }`（M4-01 起為物件，卡片 `youbike`）；TDX `/advanced/v2/Bike/Station/NearBy`（1h）＋ `/advanced/v2/Bike/Availability/NearBy`（30s），以 `StationUID` 合併。speak：「最近有車的是捷運台北車站M8（120 公尺），還有 12 台。」

## 5. 軌道與捷運

### ✅ `thsr_timetable`／`tra_timetable`

起站可省略（2026-11-21）：給 `near`（使用者位置）時用 30 公里內最近的車站，輸出加 `nearest: { station, distanceM, from? }`，speak 先說「離你最近的高鐵站是南港（約 4.4 公里）。」；車站座標取 TDX `StationPosition`（⚠️ 待驗證）；沒有 `from` 也沒有 `near` 時回 UserError 請使用者說起站。

輸入 `from`, `to`（中文站名或代碼，台／臺通用）, `date?`；輸出 `{ system: 'THSR'|'TRA', from, to, date, trains: [{ trainNo, type?, depart, arrive, minutes, terminal?, transfers?, via?, legs? }], transferNote? }`（台鐵換車見下）。
查今天時，給模型的文字與 `speak` 以「現在時間」為準只講尚未開出的班次（「今天還有 N 班，下一班 HH:mm 出發」；都開走時說末班並建議查明天）；`data.trains` 仍是整天（`upcomingTrains(data, now)`）。
TDX：高鐵 `/basic/v2/Rail/THSR/DailyTimetable/OD/{O}/to/{D}/{Date}`；台鐵 v3 `/basic/v3/Rail/TRA/DailyTrainTimetable/OD/{O}/to/{D}/{Date}`（10m）。

**台鐵換車走法（2026-11-23）**：OD 時刻表只有直達車，支線小站（平溪、集集、內灣）一班都沒有、直達很少的路線（臺北→臺東）很難查。`tra_timetable` 與 `plan_trip` 改走 `traTrips()`（`core/services/rail-trips.js`）：
- 直達車照舊用 OD 時刻表（當天、最準）；要換車的走法用台鐵定期時刻表（`rail.traGeneral()`，`GeneralTrainTimetable`，一天下載一次、約 950 班）依星期篩班次，在本機用 Connection Scan 算（`core/rail-journeys.js`：換車至少 5 分、最多換 2 次，去掉被「更晚出發、更早或同時到、換車不更多」比下去的）。
- 換車的走法只在直達車明顯比不上時才列（沒有直達車在它出發前 10 分內開、且在它抵達後 10 分內到），併進 `trains`，照出發時間排序。
- 換車那一列：`{ trainNo: '4006→4708', depart, arrive, minutes, transfers, via: ['瑞芳'], legs: [{ trainNo, type?, from, to, depart, arrive }], fareType?, planned: true }`；資料另有 `transferNote`（「要換車的班次依台鐵定期時刻表推算，以當天公告為準」）。
- 定期時刻表查不到（額度、上游錯誤）時只有直達車，不改用示範班表（假的換車走法比沒有更糟）。示範資料：平溪線（瑞芳）、集集線（二水）、內灣線（新竹）要換車，幹線兩站照舊直達。
- `plan_trip` 的台鐵方案改選「趕得上的班次裡最早到的」（原本取最早開的：慢車先開時選到比較晚到的那班）；換車時 `name`「台鐵（瑞芳換車）」、`legs` 每班車一段、`rail: { transfers, via }`、notes 說在哪換車，訂票鍵訂第一段。

### ✅ `rail_stations`

輸入 `system: 'THSR'|'TRA'`；輸出 `[{ id, name }]`（24h）。

### ✅ `rail_fare` ⚠️

| | |
|---|---|
| 輸入 | `system: 'THSR'\|'TRA'`, `from`, `to`（中文站名或代碼，台／臺通用） |
| 輸出 | `{ system, from, to, fares: [{ ticketType, fareClass, cabin?, trainType?, price, adultOneWay }] }`；`cabin` 只有高鐵、`trainType` 只有台鐵；成人單程（`adultOneWay`）在前，其次價格由低到高。台鐵只列成人單程的各車種（區間、區間快、復興、莒光、自強、自強3000、普悠瑪、太魯閣） |
| TDX | 高鐵 `/basic/v2/Rail/THSR/ODFare/{O}/to/{D}`；台鐵 v3 `/basic/v3/Rail/TRA/ODFare/{O}/to/{D}`（`ODFares` 每個車種×方向一筆，只取 `TravelDistance` 最短的方向：另一個方向是繞島另一邊）；1d 存檔 |
| 代碼 | `TicketType`、`FareClass`、`CabinClass` 依 Swagger 轉中文（`TICKET_TYPE`、`FARE_CLASS`、`CABIN_CLASS`，2026-11-22 實測符合）；高鐵未知代碼顯示「代碼 N」；台鐵 `TrainType` 依 `TRA_TRAIN_TYPE` 轉中文（名稱與時刻表車種一致，`plan_trip` 對得到同車種票價），7 普快（一般路段沒有）與不認得的代碼不列，不把原始代碼給使用者看；`Price` 無效的略過 |
| speak | 「台北到左營高鐵成人單程 1,490 元起（最高 2,390 元）。」；只有一種價格時不加「起」 |

`plan_trip`（M3-10）取成人單程最低價當 `cost`。示範模式依站距估算票價（非真實票價）。也可評估改用 TDX 官方 MCP。

### ✅ `metro_stations`／`metro_live_board` ⚠️

實作：`core/services/metro.js`、`metro-mock.js`、`core/tools/metro.js`（M3-04）。

| | `metro_stations` | `metro_live_board`（卡片 `metro`） |
|---|---|---|
| 輸入 | `system: 'TRTC'\|'TYMC'\|'TMRT'\|'KRTC'` | `system`、`station`（站名或代碼，台／臺通用，例 台北車站、BL12）；或 `near`（使用者位置，沒說站名時；`system` 可省略，各系統找 3 公里內最近的站，輸出加 `nearest: { distanceM, from? }`；超過 3 公里回 UserError 請使用者說站名，2026-11-21） |
| 輸出 | `[{ id, ids, name, lat?, lon?, nav }]`；同名多線合併成一站，`ids` 列出所有代碼 | `{ system, station, stationId, lat?, lon?, nav, updatedAt, trains: [{ line, lineId, destination, etaMin, status }] }`，依 `etaMin` 排序、沒有時間的在後 |
| TDX | `/basic/v2/Rail/Metro/Station/{Op}`（1 天，存檔） | 先查車站，再 `/basic/v2/Rail/Metro/LiveBoard/{Op}`（整個系統一份，20s，本機篩該站所有代碼）；看板沒有的方向用 `/basic/v2/Rail/Metro/StationTimeTable/{Op}`（存檔）估下一班 |
| 欄位 | `StationID`、`StationName`、`StationPosition` | `LineName`／`LineID`／`LineNO`、`DestinationStationName`（缺時用 `TripHeadSign`）、`EstimateTime`（分鐘；淡海、安坑輕軌是秒，換成分鐘）、`UpdateTime` |
| status | — | 狀態代碼（2026-11-22）：0 分 `arriving`（進站中）、1 分 `approaching`（即將進站）、其他 `minutes`（N 分）、時刻表 `scheduled`、無資料 `unknown`；卡片與英文回答依代碼用字典，工具文字仍是中文易讀字（`metroStatusText`） |
| speak | 「桃園機場捷運共有 6 個車站。」 | 「美麗島最快 3 分鐘後有往小港的車。」；沒資料時「…目前沒有即時到站資料。」；`near`：「離你最近的是市政府（約 89 公尺）：…」（給地名時「離「臺北車站」最近的是…」） |

### ✅ `metro_route`（2026-11-23）

捷運從 A 站到 B 站怎麼坐（轉乘建議）。輸入 `from`、`to`（站名）、`system`（選填：上車站的系統，同名站在不同城市時給）。

- **路網**：各線車站順序 TDX `/basic/v2/Rail/Metro/StationOfLine/{Operator}`（存檔），`core/metro-route.js` 建圖；同名站（臺／台相同、機場捷運站名結尾的「站」去掉）就是轉乘站，同系統不同線、跨系統都算。最短路徑：每站約 2 分（輕軌 2.5、機捷 3）、轉乘 5 分、跨系統 7 分。北捷支線：小碧潭、新北投是接駁（在七張、北投換車）；蘆洲支線直通（南勢角直達蘆洲，新莊 → 蘆洲在大橋頭換車；共用段「往 迴龍／蘆洲」）。高雄輕軌環狀線頭尾相連，卡片說「下一站」。台中捷運沒有 StationOfLine（只有一條線）：用車站清單依代碼排序。
- **載入哪些系統**：北部是上下車的系統＋台北捷運（三鶯線、淡海、安坑輕軌都靠北捷轉）；南部是高雄捷運＋高雄輕軌；不同城市回 `UserError`。
- **票價**：同一個系統連續坐的幾段算一張票，TDX `ODFare`（成人單程票 TicketType 1、FareClass 1，存檔）；跨系統分段相加並說明可能有轉乘優惠；查不到 `fare: null`。
- **下一班**：第一段的上車站看 `metro.liveBoard`，只取往這段方向的車（`trainGoesWay`：終點在下一站之後）；台中捷運給班距；環狀線分不出方向不給。
- 輸出：`{ from, to, system, minutes（估算，不含等車）, transfers, fare, fares?, fareNote?, legs: [{ system, lineId, line, color?, from, fromId, to, toId, stops, minutes, next, toward?, loop? }], next?, note, nav }`；speak「鶯歌車站到松山機場：坐三鶯線往頂埔，下一班約 3 分，在頂埔轉板南線…；約 40 分、65 元。」

**系統與末班車（2026-11-22 真實資料健檢）**：只給 `station` 沒給 `system` 時不再預設台北——依站名在四個系統的車站清單裡找（`systemOfStation`：站名完全相同的優先，同名站有 `near` 就用離他近的那個系統，否則台北、機捷、台中、高雄的順序；都找不到回 `UserError`「台北、桃園、台中、高雄捷運都找不到…」）。新增輸入 `last: true`（問末班車）：任何系統都查站別時刻表，輸出多 `lastTrains: [{ lineId, line, destination, time }]`（`lastFromTimetable`：今天營運日各線各方向最晚的一班，凌晨 4 點前算前一天；國定假日規則同下一班；查不到時刻表是空陣列），speak「美麗島的末班車（時刻表）：往小港 00:xx、…」。

看板與時刻表都沒有資料時回空 `trains`（不報錯）。2026-11-22 實測：北捷看板只有「列車進站中」的站（DATA_SOURCES.md §1.2），所以看板沒有的方向依站別時刻表估 60 分鐘內的下一班：`trains[].scheduled: true`、`status: 'scheduled'`（卡片顯示「約 N 分」），輸出加 `source: 'timetable'|'mixed'`、`note`／`noteEn`（說明是時刻表估算）；speak「台北車站依時刻表約 2 分鐘後有往頂埔的車。」；北捷每次都補時刻表，其他系統只在這一站沒有看板資料時才查。示範模式：四個系統的主要車站（真實站名、近似座標），每 6 分鐘一班的模擬到站，終點站不顯示往自己方向的車。

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
| 估價 | 沒有 `from` 時為 null。道路距離＝直線 × 1.3；`low` 以臺北市計程車費率估算（起跳 85 元含 1.25 公里、每 200 公尺 5 元；各縣市費率不同，`basis` 照實說「以臺北市計程車費率…估算，各縣市費率不同」）、`high`＝`low` × 1.3（塞車、夜間、平台浮動）；一律標 `estimated`，非業者報價。業者估價 `ridehail_estimate` 需合作 |
| 規則 | L2：呼叫前先向使用者確認目的地與要叫車（description 明示；M4 卡片用 `confirmText` 顯示確認視窗）；不代叫車、不付款、不收集個資（ADR-0011） |
| speak | `Uber叫車連結準備好了，到台北101，估計 220～290 元（估算）；開啟後在 App 內確認。` |

## 7. 地點、路況、行程

### ✅ `find_place`

| | |
|---|---|
| 輸入 | `query: string`（1–50 字）、`city?: City` |
| 輸出 | `[{ name, lat, lon, city, cityName, source: 'landmark'\|'station'\|'geocode', kind, nav }]`（`cityName` 中文縣市名）（≤ 5，最符合的在前） |
| 資料 | 內建地標 `core/data/landmarks.json`（201 筆；車站類 `kind=station` 回 `source: 'station'`）；地理編碼：TDX `/advanced/V3/Map/GeoCode/Coordinate/Address/{地址}`、`/Markname/{地標}` 可用（2026-11-23 實測，`DATA_SOURCES.md` §5），尚未串接 |
| 比對 | `normPlace()`：臺→台、去空白與括號、英文小寫，**不去「站」**（「西門站」≠「西門」）。分數：名稱或別名完全相同 3 → 以查詢開頭 2 → 互相包含 1（「我要去逢甲夜市」也能找到）；同分車站優先，再取名稱短的 |
| 錯誤 | 空白查詢、無法辨識的 `city` → `UserError`；找不到回空陣列 |
| 來源標示 | `source: '阿幫內建地標資料（座標為近似值）'`、`static: true` |
| speak | 「「逢甲夜市」最符合的是逢甲夜市（臺中市）。」 |

### ✅ `traffic_status`（端點 2026-11-23 實測）

實作：`core/services/traffic.js`、`traffic-mock.js`、`core/tools/traffic.js`（M3-06）。

| | |
|---|---|
| 輸入 | `from`, `to`：座標 `{ lat, lon }` 或地名（`resolvePoint()` 以 `find_place` 轉座標，找不到 → `UserError`）；起訖直線不到 1 公里（`TRAFFIC_MIN_M`，例：模型拿同一個座標當起訖）→ `UserError`「起點和終點幾乎是同一個地方…請問使用者要從哪裡到哪裡」，不回沒查過的「附近沒塞車」（2026-11-22 真實資料健檢；示範行程起訖不到 1 公里就不查國道） |
| 輸出 | `{ from, to, fromPoint: { name, lat, lon }, toPoint, level: 'smooth'\|'slow'\|'jam'\|null, delayMin, covered, straightKm, segments: [{ id, name, road, speedKmh, limitKmh, lengthKm, congestion }], events: [{ title, time }], note?, updatedAt }` |
| 沿途路段 | 直線 < 15 km 不查（`covered: false`、`level: null`）。路段中點離起訖連線 ≤ 3 km、投影落在起訖之間、且路段方向與行進方向一致才算沿途；依行進順序排列。長度用 `SectionLength`，沒有就由形狀估；速限缺時以 100 km/h 計 |
| level | 車速 ÷ 速限 < 0.4 為壅塞、< 0.75 為車多。壅塞累計 ≥ 5 km 或整體加權比值 < 0.4 → `jam`；車多以上累計 ≥ 5 km 或比值 < 0.75 → `slow`；其餘 `smooth`；沒有車速資料 → `null`（**不是順暢**） |
| delayMin | 只計車多與壅塞路段：實際行駛時間 − 以速限行駛時間 |
| events | 道路事件 `/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway`（2026-11-23 實測：原本的 `Live/News/Freeway` 只有「施工維護」這類標題、沒有路名與位置，依路名篩一律對不到）：事件 `Positions`（POINT）離沿途路段 500 公尺內、方向（`Location.FreeExpressHighway.Direction` 或 `Description` 的「北向／南向」）與那一段 `RoadDirection` 相同的前 3 筆；`title` 用 `Description`（例「國道一號 北向 27K+100 施工事件-施工維護」）；事件端點失敗不影響車速結果 |
| speak | 「沿途國道塞車中，預估多花 49 分鐘（…事故…）。」、「沿途國道順暢。」、「起訖很近，不需要看國道路況。」 |

`level = jam` → 自動狀態「塞車中」；`level = null` 時 `plan_trip` 不加狀態。示範模式：`DEMO_TRAFFIC=jam`（或 `createServices({ demo: { traffic: 'jam' } })`）中間一段壅塞並有一則事故；預設順暢。可評估介接 TDX 官方 MCP event。

### ✅ `intercity_bus`（端點 2026-11-23 實測）

實作：`core/services/intercity.js`、`intercity-mock.js`、`core/tools/intercity.js`（M3-07）。

| | |
|---|---|
| 輸入 | `from`, `to`：座標或地名（`T.point`）；`departAt?`：`'HH:mm'`（今天，00:00～23:59，台灣時間）或 ISO 日期時間（例 `2026-11-20T09:00`，沒帶時區視為台灣時間），預設現在 |
| 輸出 | `{ system: 'BUS', from, to, fromPoint, toPoint, date, departAt, traffic: { level, delayMin }, delayRisk, trains: [{ trainNo, type, terminal, depart, arrive, minutes, arriveWithDelay?, delayMin?, estimated?, departEstimated?, departFrom?: { name, time }, nextDay?, fare, board, alight, walkFromM, walkToM }] }`（卡片 `timetable`，最多 5 班；`date` 是出發日；服務層也接受 ISO `departAt`，用該日的日期與星期 `ServiceDay` 篩班表；出發時間離午夜不到 3 小時時，一併列出 3 小時內的隔日班次並標 `nextDay: true`） |
| 配對 | `StopOfRoute/InterCity` 各路線：上車站離起點 ≤ 1.5 km、下車站離終點 ≤ 1.5 km、且下車站序在後；同一路線名只留步行最短的一組 |
| 班次 | `Schedule/InterCity` 只查配對到的路線；依 `ServiceDay` 篩今天；上下車時間以 `StopUID`（找不到用站序）對應；沒有下車時間時以直線 × 1.3 ÷ 70 km/h 估算並標 `estimated`；跨日自動 +24h。2026-11-23 實測：有些班次的 `StopTimes` 只有起站一筆（例 0968 去程）→ 上車站沒有時間時，由前面最近一個有時間的站沿站牌距離 ÷ 50 km/h（`ALONG_KMH`，估快一點、寧可早到站牌）估 `depart`，標 `departEstimated: true` 與 `departFrom: { name, time }`（哪一站幾點開；speak「約 07:04 到上大竹（大竹消防隊 07:00 開）」），出發時間篩選也用估的上車時間（起站已開走、還沒到上車站的班次照列）；`ServiceDay` 是 0／1 |
| 路況 | 同時查 `traffic_status`：`delayMin` 加到 `arriveWithDelay`；`delayRisk`＝jam 0.9、slow 0.5、smooth 0.2、未知 0.4（國道即使順暢仍有風險）；路況失敗不影響班次 |
| 票價 | TDX 客運票價端點 `/basic/v2/Bus/RouteFare/InterCity` 存在（2026-11-23 實測：`StageFares[].OriginStage／DestinationStage.StopID`、`Fares[].TicketType／FareClass／Price`，`FareName` 例「全票_不分時段_三排座」），尚未串接，live 先回 `null`；示範模式有估算票價 |
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
6.6 捷運營運時間與沒列入的原因（2026-11-22，產品負責人實機：00:10 問「去台北101」沒有公車和捷運，以為是 bug）：
- 捷運依系統的營運時間常數 `METRO_HOURS`（`core/services/trip.js`；⚠️ 大約值，以各系統公告為準：台北、台中、高雄約 06:00～24:00，桃園機場捷運約 06:00～23:59）。收班時不列入，`skipped` 加 `{ role: 'metro', closed: true, first: '06:00', why: '捷運已收班（約 06:00 首班）' }`；收班前 30 分（台北 23:30 起）列入但帶 `lastTrain: true` 與「末班快到了」。真實與示範資料都適用（捷運沒有收班即時狀態）。
- 真實模式但這次公車因 TDX 額度用完改用示範資料（`withTdxFallback`，`fellBack('bus.directTrips')`）：深夜公車依時間估收班，`skipped` 的公車帶 `estimated: true, fallback: 'tdx-limit'`，原因照實說「TDX 額度用完，這次依時間估」；白天見 6.7（不列入）。
- 輸出 `missing: [{ role, kind, why, whyEn, closed?, first?, fallback? }]`：任何時候都列出沒列入的方式與原因（含 `skipped`；kind：skipped 查了但不可行、none 查不到站或路線、noService 沒有趕得上的班次；太近 `near`、太遠 `far` 顯而易見不列）。捷運沒列入也分原因：附近沒有捷運站、走到站太遠（約走幾分）、起訖同一站（near）。
- 輸出 `night: { text, textEn, closed: ['bus','metro'], late: [...], estimated?, fallback? }`：深夜的一句（`trip-considered.js nightOf`），例「現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車」；出發時間不是現在時說「00:10 出發，…」。`speak`、示範回答、英文回答都以這句開頭，模型模式漏講時 `mustSay` 補在最前面；工具文字多「深夜（回答第一句先說）」「沒列入：…」兩行。網頁 agent 這一輪的「現在」（示範時鐘）由 `execTools` 帶進 `plan_trip`（`svc.now`）。
- 審查修正（PR #110）：營運判斷看**走到捷運站的時刻**（出發＋走到站分鐘：23:55 出發走到站已過 24:00＝收班；05:55 出發 06:02 到站可搭）；首班前 1 小時內（05:00～05:59）說「捷運還沒發車（約 06:00 首班）」（`notYet: true`，英文 hasn't started yet）。起訖 10 公里內都沒有捷運站（`METRO_NA_M`）＝這一帶沒有捷運，kind `na`、不列入 `missing`。站牌狀態只有 3（末班已過）算收班；4（今日未營運）說「今天沒有營運」，不觸發深夜一句。`directTrips` 內部 `routeEta` 429 記下（`metrics.markLimited`），沒有可用路線時公車原因照實說「TDX 額度用完，公車資料這次查不到」。只有一種方式＋深夜：`night` 不說「先比…」、`single` 不再列已由 `night` 說的收班；`night.body`／`bodyEn` 是不帶時間的版本（回答已說「明天 00:10 出發：」或出發時間是程式合成的）。`departAt` 只給 HH:mm 且比現在早超過 1 小時（`DEPART_PAST_MIN`）＝明天（火車、客運也查隔天）。明天＋抵達時間合成的出發時間不早於 06:00（抵達時間在 07:00 前才更早）。
6.7 TDX 額度用完時示範資料不參加排名（2026-11-22，真實資料健檢 t02／t04／x03／z11）：`withTdxFallback` 遇 429 改用示範資料時，`metrics.markFallback` 記下方法的完整名稱（`bus.directTrips`、`intercity.trips`、`rail.thsrTimetable`、`rail.traStations`、`metro.stations`、`bike.nearby`、`traffic.status`）。真實模式下，來自示範資料的方案**不列入**：`skipped` 加 `limitSkip(role)`＝`{ role, why: 'TDX 額度用完，這次查不到客運班次（稍後再問一次）', whyEn, fallback: 'tdx-limit' }`（公車到站、客運班次、高鐵班次、台鐵班次、捷運車站、YouBike 車輛與空位），卡片「沒列入」、決策圖、工具文字「沒列入：…」都看得到；沒有方案就沒有 `follow`，回答不會問假班次的到站提醒。只有票價是示範的：鐵路照列、票價改依距離保守估（見下表）。路況是示範的：不加「塞車中」、不加客運延誤與叫車時間、`traffic` 為 null，`considered` 的路況一行「TDX 額度用完，這次查不到國道路況」（`available: false`）。輸出 `limited: { roles, noTransit, text, textEn }`：一句照實說哪些方式沒列入；大眾運輸因此一個都沒有時（`noTransit`）說「大眾運輸都沒列入（不推示範的班次）；先比走路、叫車（叫車的時間與車資是估算），約 1 分鐘後再問一次就查得到」。`limited` 另有 `short`／`shortEn`（工具發言用的短句）與 `suggest`（「過一分鐘再問一次」，多種方式時也給；只有一種方式時 `single` 把額度用完的方式合成一句）。用到的地方：工具文字（模型看得到「TDX 額度用完（回答要照實說，不可提示範班次）：…」）、中英 `speak`、示範中英回答、行程卡片（最上面橘底一行）、「接下來可以」。`plan_trip` 標 `fallbackSafe`（`core/tools/define.js`）：示範資料的方案已排除，額度用完時工具結果 `mode` 照真實、`speak` 不再加「這次先用示範資料」、卡片不掛示範徽章（`fallback: 'tdx-limit'` 照記）；其他工具真的顯示示範資料時照舊標示範。
6.9 自己開車（2026-11-22）：`prefs.car`（手機設定「我有車」，由程式帶）或 `prefs.mode: 'drive'`（「開車去」；「叫車」仍是 ridehail）才列 `role: 'drive'`。時間＝車程（同叫車的 `carMinutes`：市區 22 km/h，長程前 50 km 55、之後 95 km/h）＋國道塞車延誤＋找車位與走過去；花費＝油錢（道路公里 × 2.6 元）＋停車 1 小時約 40 元（⚠️ 估算，`est` 時間與花費）。有目的地 600 公尺內停車場資料時開到有空位的那一個，`parking` 列最多 3 個（名稱、距離、剩幾位、收費說明），走過去照距離算；查不到照實說。台北市、新北市的停車場座標用市府開放資料（TDX 沒有），其他縣市用 TDX（`DATA_SOURCES.md` 停車場）。

6.10 交通健檢（2026-11-23）：
- 台鐵、高鐵車站座標用車站清單的（TDX `StationPosition`；示範資料也有座標），內建地標只當備援：地標沒收的鶯歌、樹林、新烏日、新左營都用得到（台中車站 → 高鐵台中站列「台鐵 臺中 → 新烏日」；三峽從鶯歌上車，不繞到桃園）。
- 深夜等首班（`longWait`）：`decide()` 的總時間、等車改用真正要等的（`effMinutes`＝`minutes`＋`longWait.extra`，`feltMinutes`、理由句、`keyQuestion` 同一套），等於照抵達時間比：01:00 台北 → 新竹推 02:33 到的叫車，不推 07:27 才到的台鐵；想省錢時照分數仍可選等首班。工具文字每個方案多「05:24 才有車，現在出發要等約 264 分」。
- 估算的台鐵（不查時刻表）約 05:00～隔天 00:30 有車（`TRA_EST`、`traEstRunning`）：23:45 列入，01:00 說「這個時間台鐵沒有車（約 05:00～00:30 有車）」。
- 跨系統捷運每一段各自找線與轉乘站（同系統的 `lineRoute`）：三峽 → 台北 101「三鶯線：三峽 → 頂埔｜在頂埔站轉板南線，到台北車站再轉淡水信義線：頂埔 → 台北101／世貿」，每次轉乘加時間，`transfers`、`metro.vias`；機場捷運直達車在跨系統方案也用公告的時間與 160 元（`AIRPORT_EXPRESS`）。
- 叫車、YouBike 的車資說「以臺北市費率估算（各縣市費率不同）」，不說成當地費率。

6.8 估算值保守看（2026-11-22，真實資料健檢 z01）：方案的 `est: { minutes?: true|分鐘數, cost?: true|元 }` 標出估的部分（客運票價缺資料、客運抵達依距離估的車程、鐵路票價查不到、公車趕不上下一班或尚未發車的等車），`decide()` 計分時把估的部分多算 `UNCERTAIN`（時間 15%、票價 30%），扣分記在 `ranking.ranked[].breakdown.uncertain`（決策圖扣分列「估算」）。叫車不標（已有車資範圍與「花錢換時間要划算」）；捷運依距離與票價規則估、跟公車每站 1.5 分同一類，不標。機場捷運直達車（台北車站 ↔ 機場第一／第二航廈）改用公告參數 `AIRPORT_EXPRESS`（約 35／38 分、160 元、等 8 分；⚠️ 以桃園捷運公告為準），不標 `estimated`。捷運沒列入的原因照實說哪一端：「起點 1.2 公里內沒有捷運站（最近的是頂埔站，約 4.1 公里）」、兩端都沒有、兩端都沒有。2026-11-22 起：全台捷運與輕軌都列入（台北、桃園機場、台中、高雄、新北捷運三鶯線與環狀線、淡海輕軌、安坑輕軌、高雄輕軌；新北捷運的線彼此不相通，分線計算）；跨系統在同名站轉乘（三鶯線頂埔轉板南線、機場線臺北車站轉台北捷運；估算多 5 分，`metro.crossSystem`、`via`、`systems`）；走不到的站（1.2～8 公里）用公車或 YouBike 接駁估算（名稱加「（先到X站）」、`metro.feeder`、`est.minutes`），接駁比坐捷運還遠時不列並說「到捷運站太遠」。台鐵不限距離（時間久、麻煩的自然分數低，沒列出會以為沒查）：8 公里內或車站不順路時不查時刻表，列「台鐵（估算）」（`est` 時間與票價，省 TDX 額度）。公車尚未發車但站牌有預估：說明「尚未發車，預估約 22 分後到站（發車後以即時資料為準）」，公車卡片的 `statusText` 同一個說法「尚未發車（預估約 22 分後到）」（`busStatusText`）。
7. 自動狀態：查 `traffic_status`（跨城或走一般道路的方案）、`weather_now`（起點）與 `aqi_nearby`（起點，M10）；`raining` → 自動狀態「下雨」，`level = jam` → 「塞車中」，最近測站 AQI > 100 → 「空品不佳」（`detail` 帶測站與 AQI；輸出另有 `air: { site, aqi, status } | null`）。查詢失敗時不加狀態、不中斷規劃。示範：`DEMO_AIR=bad`（或 `createServices({ demo: { air: 'bad' } })`）把示範測站 AQI 調到對敏感族群不健康。
7.1 判斷用到的資料（2026-11-21）：輸出 `considered[]`（天氣、空品、路況各一筆：`{ source, role, available, demo, value, valueEn, text, textEn, say, sayEn, effect: 'none'|'score'|狀態 key, tone }`，`core/services/trip-considered.js`；討論串 `data_note` 與決策圖資料欄用）。最近的空品測站超過 25 公里（`AIR_MAX_M`）不採用：`air` 為 null、不加 `badAir`。只有一種方式時輸出 `single: { text, textEn, suggest: [{ label, ask }] }`（各方式沒列出的原因：太遠、附近沒有站、某時間以後查不到趕得上的班次、不可行；示範資料加註），工具文字多「判斷用到的資料：…」「只有一種方式：…」兩行給模型。

實作細節（M3-10；門檻與估算常數在 `trip.js` 的 `LIMITS`、`EST`）：

| 方案 | 條件（直線） | 時間 | 費用 | 標 `estimated` |
|---|---|---|---|---|
| 步行 | ≤ 6 km | `walkMinutes` | 0 | — |
| YouBike | 0.5～12 km；起點 500 m 內有車、終點 500 m 內有空位 | 走＋騎（站距 × 1.3 ÷ 12 km/h）＋走 | 台北市 2.0 費率（前 30 分 5 元，之後每 30 分 10 元） | — |
| 公車直達 | ≤ 25 km；`bus.directTrips`；上車站 2 交管不停靠、3 末班已過、4 今日未營運的路線不列入（`missing` kind `route`），幾條時先選到站時間確定的。真實資料、出發時間離現在超過 15 分（`BUS_LIVE_AHEAD_MIN`）：站牌的即時到站與狀態不套用（只有同一天的「今日未營運」照樣排除），到站時間不明（`etaUnknown`）、不帶 `follow`（不盯現在的到站），深夜依出發時間估收班 | 走＋等（ETA − 走路，趕不上或時間不明以 10 分估）＋站數 × 1.5＋走 | 一段票 15 元 | 等車時間不明時；沒有任何預估或尚未發車另標 `etaUnknown`（決策不排在時間確定的大眾運輸前面） |
| 高鐵／台鐵 | 高鐵 > 30 km、台鐵不限；起訖 25 km 內最近車站（座標用車站清單的 `StationPosition`，沒有才由內建地標對照：`railPoint` → `stationPoint`） | 到站（1.2 km 內走路，否則市區轉乘 道路 ÷ 20 km/h＋5 分）＋等第一班趕得上的車（最多算 10 分，再多就把 `leaveAt` 往後延）＋車程＋離站；`arriveAt` 以實際班次計算。班表上 03:00 前發車的班次是前一天的末班車，算成 24 小時以後（`railDepMin`：00:09 → 24:09）。真正要等超過 60 分（`LONG_WAIT_MIN`，深夜等首班）標 `longWait: { min, extra, first }` 與「首班 05:24 才開，現在出發要等約 4 小時 24 分」 | 成人單程（台鐵依車種）＋市區轉乘 15 元；查不到票價時依兩站直線距離保守估（`RAIL_FARE_EST`：高鐵每公里 5 元、台鐵以自強號每公里 2.8 元，`est.cost`），不當 0 元 | 有市區轉乘或查不到票價時 |
| 國道客運 | ≥ 15 km；`intercity.trips` | 走＋等（走到站牌趕得上的第一班，最多算 10 分；真正要等超過 60 分同樣標 `longWait`）＋車程含路況延誤＋走；`arriveAt` 以實際班次計算 | 票價；缺資料時起跳 70 元＋道路公里 × 1.2 元（`intercityFareEst`，保守估，`est.cost`） | 缺票價或抵達為估算時 |
| 叫車 | 一律 | 等 6 分＋車程（`carMinutes`：道路 15 km 內 22 km/h；更遠的前 50 km 55 km/h、超過 50 km 的部分 95 km/h）＋路況延誤 | `ridehail_link` 估價區間中位數（`costRange`） | 一律 |

### ✅ `outing_advice` — 出門建議（pack `weather`，卡片 `outing`，2026-11-21）

輸入 `lat`、`lon`（或地名 `place`，由 `find_place` 同一套地標轉座標；兩者都沒有回 `UserError`）、`name?`（卡片標題）、`with?: 'kids'|'elder'`（同行的小孩或長輩：空品門檻放低）。同時查 `weather.now` 與 `life.aqiNearby`（`Promise.allSettled`：一邊查不到也回另一邊；兩邊都失敗才回錯誤），由 `core/agent/outing.js` `outingItems` 整理最多 3 點：`items: [{ kind: 'umbrella'|'hot'|'cold'|'mask'|'ok', level: 'warn'|'info'|'ok', text }]`（降雨 ≥ 50% 帶傘、≥ 30% 折傘；雨量站沒量到雨但已算「下雨」時說「很可能下雨」；≥ 32°C／≥ 28°C／≤ 10°C／≤ 16°C；AQI > 150／> 100、帶小孩或長輩 > 50；都正常＝安心出門）。輸出另有 `weather`（測站、氣溫、降雨機率、是否下雨）、`air`（測站、AQI、狀態）。工具文字附「請照這些重點回答」；speak 只說最重要的一點（「…，還有 2 點在卡片上」）。`weather.demo`／`air.demo` 各自標示示範（只有一邊有金鑰時不把真實資料說成示範），`missing: ['weather'|'air']` 表示那一邊這次查不到（卡片寫明）。沒有任何數字時不說「安心出門」。模型模式：說了地點直接用 `place` 查、沒拿到位置先看預設地點（並請模型說明），判斷層把出門建議判成空品或行程時規則的出門建議優先。示範與模型模式的出門建議都改用這個工具（原本天氣、空品兩張卡）。

### ✅ `weather_tomorrow` — 明天的預報（pack `weather`，2026-11-21）

輸入 `lat`、`lon`。最近觀測站的縣市＋鄉鎮 → 該縣市的鄉鎮預報 `F-D0047-0xx`（`TOWN_FORECAST`；2026-11-22 實測 `F-D0047-089` 是縣市層級、用鄉鎮篩一律空的；1h 快取，與 `weather_now` 共用）取**明天（台灣時間）**的時段：`{ town, county, date: 'YYYY-MM-DD', pop: 明天各時段降雨機率最高值, dayPop: 白天（06～18 時）最高值, minT, maxT, wx }`；沒有時區的時間一律當台灣時間；元素名稱防禦性比對（「3小時／12小時降雨機率」「溫度／最高溫度／最低溫度」「天氣現象」）⚠️。沒有明天的資料回 `CwaError`。speak：「明天 11/22（日） 臺北市中正區多雲短暫雨，18～26°C，降雨機率 60%，記得帶傘。」（看白天降雨機率：≥ 50% 帶傘、≥ 30% 折傘；沒有鄉鎮名稱說「那一帶」）。「後天」「週末」「禮拜X」：說明只查得到現在和明天，不拿現在的天氣充數。示範：雨天情境 70%、晴 20%。問「明天會下雨嗎」「明天出門要帶傘嗎」用這個（`weather_now` 只有現在）。

### ✅ `weather_now` — 現在與接下來 3 小時天氣（pack `weather`）

| | |
|---|---|
| 輸入 | `lat`, `lon` |
| 輸出 | `{ station, town, county, distanceM, observedAt, tempC, feelsC: number\|null, rainMm1h: number\|null, rainStation: string\|null, pop3h: 0–100\|null, raining: boolean, summary }`（`station` 是 15 公里內最近、有氣溫的觀測站，`summary` 的天氣描述可能借 10 公里內的站；`rainMm1h` 是最近且 5 公里內雨量站的過去 1 小時雨量；沒有就 null；`pop3h` 取所在縣市＋鄉鎮尚未結束的預報時段，同名鄉鎮以縣市區分；`feelsC` 是體感溫度：氣溫、相對濕度、風速〔澳洲氣象局公式〕，缺濕度或風速時為 null，2026-11-22 ADR-0018） |
| 資料 | 中央氣象署開放資料平臺（需 `CWA_API_KEY` 授權碼）：自動氣象站觀測 `O-A0001-001`／`O-A0003-001`（10m，氣溫、天氣）、雨量站 `O-A0002-001`（10m，`RainfallElement.Past1hr.Precipitation`；氣象站的 `Now.Precipitation` 是當日累積，不用）、鄉鎮天氣預報：所在縣市的 `F-D0047-0xx`＋`LocationName`（1h，DATA_SOURCES.md §3，2026-11-22 已驗證） |
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
- 指數名稱（「加權指數」「大盤」「台股」「櫃買指數」「上櫃指數」「OTC」…）不當個股找、不列 `notFound`；問到的指數排在 `indices` 第一個（speak 講它）；只問指數不下載個股清單。
- 收盤資料，每檔帶自己的日期；文字一律附「收盤資料，非即時報價；僅供參考，不構成投資建議」。漲跌在文字中寫成「漲 5（0.23%）」「跌 54（9.93%）」，不寫「+5」「-54」（地端小模型會說反）。
- 只報數字：`PACK_GUARDRAILS.finance` 禁止買賣建議與漲跌預測；輸出護欄 `no-investment-advice`（`core/output-guards.js`，經 `core/agent/guardrails.js`）把含買賣建議、看漲看跌、目標價、明牌的句子整句換成固定說法並送 `guardrail` 事件。2026-11-23 補：主詞是公司名的預測（「台積電明天會漲」：說了未來時間＋會漲跌；「台積電應該會反彈」：會／應該＋反彈、回檔、上漲、下跌…）、進出場時機（「現在是進場的好時機」、抄底、逢低買）、被換掉的問句後面緊接的短回答（「這檔會漲嗎？不會，會跌」的「不會，會跌」）。一般行情（「漲 102.8 點」）、天氣（「明天會下雨」）、「不會，捷運還有車」不動。

| speak 範例 | 「台積電 11/18 收 2175，漲 5（0.23%）；環球晶 11/19 收 490，跌 54（9.93%）。」 |
|---|---|

模式：`aqiMode`（環境部金鑰）、`quakeMode`（氣象署授權碼）、`openDataMode`（其他，免金鑰；`DEMO_MODE=1`／`OPEN_DATA=0` 用 `core/data/demo/` 片段）。來源與欄位見 `DATA_SOURCES.md` §5.2。

### ✅ 短劇（pack `drama`，ADR-0019，2026-11-22）

MyDrama 的公開讀取端點（排行、搜尋、單劇、簡介、熱搜；不登入），網址與連結都在環境變數（`DATA_SOURCES.md` §5.4）。

| tool | 輸入 | 輸出 `data` 重點 |
|---|---|---|
| `drama_picks` | `list?`：`hot`（預設）／`new`／`completed`／`taiwan`；`limit?` 1～10（預設 5） | `kind: 'list'`、`list`、`listName`、`items[]`（附 `rank`）、`keywords[]`（熱搜，失敗回空）、`store` |
| `drama_search` | `query`：劇名或類型（1～20 字，只放關鍵字，「短劇」「推薦」等套話會去掉） | `kind: 'search'`、`query`、`total`、`items[]`、`store`；沒找到不丟錯（`items: []`） |
| `drama_series` | `id`：英數、底線、連字號（1～64 字） | `kind: 'series'`、`items[0]`（簡介最多 600 字）、`store`；找不到或已下架 → `UserError` |

`items[]`：`{ id, title, tags[≤5], genre, episodes, freeEpisodes, completed, isNew, taiwanOriginal, heat, synopsis（≤160 字）, appLink }`。`appLink`＝第 1 集的 App 連結（`MYDRAMA_LINK_EPISODE` 範本代入；沒設定為 `null`）；`store`＝`{ ios, android }`（https，沒設定為 `null`）。封面、價格、解鎖設定不往上傳；限制級不列。

| speak 範例 | 「熱門排行前 3 名：《夜班公車的約定》、《總裁的便當外送員》、《重返十八歲的阿嬤》。」（示範片庫的劇名都是虛構的） |
|---|---|

模式：`dramaMode`（設定 `MYDRAMA_API_BASE` 且非 `DEMO_MODE=1` 時 live）。等車推劇不是工具，是程式在到站結果之後的 `aside` 事件（`AGENT.md` §5.4）。

### ✅ 防詐（pack `antifraud`，M7）

輸入、輸出、風險等級與寄件號碼規則見 `AGENT_ANTIFRAUD.md` §3。資料：165 遭停止解析涉詐網站（約 10 萬網域）、165 詐騙闢謠專區（CSV，24 小時快取；`DEMO_MODE=1` 或 `OPEN_DATA=0` 用 `core/data/demo/` 片段）＋規則庫 `core/data/scam-rules.json`。L2：不說「安全」，查不到只說「沒有發現已知的詐騙特徵，但不代表一定安全」，一律附 165。

| speak 範例 | 「高風險：有 1 個網址在 165 涉詐清單上，先不要照做。」 |
|---|---|

## 8. 卡片種類

見 `CARDS.md`：`bus-route`、`bus-station`、`nearby`、`youbike`、`metro`、`timetable`、`trip`、`scam-risk`（M7）、`weather`、`aqi`、`quake`、`pharmacy`、`garbage`、`fuel`、`invoice`（M10）、`stock`、`drama`（ADR-0019）。
