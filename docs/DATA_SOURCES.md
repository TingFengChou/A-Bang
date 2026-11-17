# 開放資料來源與使用方式

版本：v0.4（2026-11-17）。狀態：✅ 已串接（含 mock）　📝 待實作　⚠️ 端點／欄位待 M1 驗證　🔭 下一階段

## 1. 交通部 TDX 運輸資料流通服務（主要來源）

| 項目 | 內容 |
|---|---|
| 網站 | https://tdx.transportdata.tw （會員中心 → API 金鑰） |
| 授權 | 政府資料開放授權條款；畫面與 MCP 文字需標示「資料來源：交通部 TDX 運輸資料流通服務」 |
| 認證 | OIDC client credentials：`POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`，`grant_type=client_credentials`、`client_id`、`client_secret`；token 有效 24 小時 |
| 呼叫 | `GET https://tdx.transportdata.tw/api{path}`，`Authorization: Bearer {token}`，`$format=JSON` |
| 限制 | token endpoint 每 IP 每分鐘 ≤ 20 次；API 額度依會員方案（M1-04 記錄實際值）；遇 429 依 `Retry-After` 重試一次 |
| 實作 | `core/tdx-client.js`：token single-flight、到期前 5 分換新、回應快取（TTL 由呼叫端指定）、401 換 token 重試、OData 空白編碼為 `%20` |
| 環境變數 | `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`（留空 → 示範模式） |

常用 OData：`$filter`、`$select`、`$top`、`$orderby`；空間：`$spatialFilter=nearby(lat,lon,radiusM)`（radius ≤ 1000）。

### 端點清單

| 用途 | 端點 | TTL | 狀態 | 用於 |
|---|---|---|---|---|
| 公車路線 | `/basic/v2/Bus/Route/City/{City}[/{Route}]` | 1h | ✅ | `bus_search_routes`、`bus_route_eta` |
| 路線站序 | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}/{Route}` | 1h | ✅ | `bus_route_eta` |
| 公車預估到站 | `/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{Route}` | 20s | ✅ | `bus_route_eta` |
| 站位預估到站 | `/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/PassThrough/Station/{StationID}` | 20s | ✅ ⚠️ | `bus_station_eta` |
| 附近站位 | `/advanced/v2/Bus/Station/NearBy` | 1h | ✅ | `bus_nearby_stations`、`plan_trip` |
| 路線形狀 | `/basic/v2/Bus/Shape/City/{City}/{Route}`（WKT，欄位 `Geometry`） | 1h | ✅ ⚠️ | `bus_route_eta.shape` |
| YouBike 站點 | `/advanced/v2/Bike/Station/NearBy` | 1h | ✅ | `youbike_nearby` |
| YouBike 車數 | `/advanced/v2/Bike/Availability/NearBy` | 30s | ✅ | `youbike_nearby` |
| 高鐵時刻 | `/basic/v2/Rail/THSR/DailyTimetable/OD/{O}/to/{D}/{Date}` | 10m | ✅ | `thsr_timetable` |
| 高鐵車站 | `/basic/v2/Rail/THSR/Station` | 24h | ✅ | `rail_stations` |
| 台鐵時刻 | `/basic/v3/Rail/TRA/DailyTrainTimetable/OD/{O}/to/{D}/{Date}` | 10m | ✅ | `tra_timetable` |
| 台鐵車站 | `/basic/v3/Rail/TRA/Station` | 24h | ✅ | `rail_stations` |
| 高鐵／台鐵票價 | `/basic/v2/Rail/THSR/ODFare/{O}/to/{D}`、`/basic/v3/Rail/TRA/ODFare/{O}/to/{D}` | 10m | ✅ ⚠️ | `rail_fare` |
| 捷運車站 | `/basic/v2/Rail/Metro/Station/{Operator}` | 24h | ✅ ⚠️ | `metro_stations`、`metro_live_board`（站名→代碼） |
| 捷運即時看板 | `/basic/v2/Rail/Metro/LiveBoard/{Operator}`（`$filter=StationID eq …`） | 20s | ✅ ⚠️ | `metro_live_board` |
| 公路客運 | `/basic/v2/Bus/Route/InterCity`、`/basic/v2/Bus/EstimatedTimeOfArrival/InterCity` | 1h／20s | 📝 ⚠️ | `intercity_bus` |
| 高速公路路況 | 路段旅行時間、即時路況（`/v2/Road/Traffic/…`）、道路事件 | 60s | 📝 ⚠️ | `traffic_status` |
| 導訂票 | 台鐵／高鐵導訂票 API（需申請「臺鐵訂票導訂」「高鐵訂票導訂」權限） | 不快取 | 📝 ⚠️ | `rail_booking_link` |

`{City}` 由 `core/cities.js` 解析（`Taipei`、`NewTaipei`、`Taoyuan`、`Taichung`、`Tainan`、`Kaohsiung`…）；`{Operator}`：`TRTC` 台北、`TYMC` 桃園、`TMRT` 台中、`KRTC` 高雄。

### 座標欄位（導航用）

| 資料 | 欄位 |
|---|---|
| 公車站牌／站位 | `StopPosition`／`StationPosition`：`PositionLat`、`PositionLon`（WGS84）；`bus_route_eta` 用 `DisplayStopOfRoute` 各站的 `StopPosition` |
| YouBike | `StationPosition` |
| 台鐵／高鐵／捷運車站 | `StationPosition` |

## 2. TDX 官方 MCP（外部 MCP）

| 端點 | 內容 | 狀態 |
|---|---|---|
| `https://tdx.transportdata.tw/tdx-mcp/rail` | 臺鐵／高鐵班次、票價、導訂票 | 🔭 評估介接 |
| `https://tdx.transportdata.tw/tdx-mcp/event` | 道路事件 | 🔭 評估介接 |

需 TDX 會員金鑰。介接方式：`core/providers/mcp-client.js` 以 MCP client 呼叫，包成本專案 tool（`server: 'tdx-official'`），讓討論串標示來源。先以自家 TDX REST 實作為主，官方 MCP 為替代來源。

## 3. 中央氣象署開放資料平臺

| 項目 | 內容 |
|---|---|
| 網站 | https://opendata.cwa.gov.tw （登入取得授權碼） |
| 呼叫 | `GET https://opendata.cwa.gov.tw/api/v1/rest/datastore/{DataID}?Authorization={key}&format=JSON` |
| 環境變數 | `CWA_API_KEY`（留空 → `weather_now` 用 mock） |
| 用到的資料集 | `O-A0001-001` 自動氣象站觀測（10 分鐘）、`O-A0003-001` 局屬氣象站觀測、`F-D0047-*` 鄉鎮天氣預報（3 小時降雨機率） ⚠️ |
| 用於 | `weather_now` → 自動狀態「下雨」 |
| 標示 | 「資料來源：中央氣象署」 |

## 4. 導航、叫車（深層連結，不需金鑰）

| 用途 | URL |
|---|---|
| Google Maps 步行導航 | `https://www.google.com/maps/dir/?api=1&destination={lat},{lon}&travelmode=walking` |
| Apple 地圖 | `https://maps.apple.com/?daddr={lat},{lon}&dirflg=w` |
| Uber | `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]={lat}&dropoff[longitude]={lon}&dropoff[nickname]={name}` |

連結參數一律 `encodeURIComponent`；不帶使用者目前位置（`my_location` 由 App 決定）。

## 5. 地理編碼（`find_place`）

1. ✅ 內建地標 `core/data/landmarks.json`（自建，201 筆：車站、機場、景點、夜市商圈、學校、醫院、機關；`verified: false`——座標為整理時的近似值，約百公尺等級，**待人工校對**，見 PLAN「Austin 待辦」）。
2. 車站名稱：目前併在內建地標（`kind=station`）；TDX 車站 `StationPosition` 於 M1 驗證後可改為即時來源。
3. 外部地理編碼 ⚠️：候選 TDX 地理編碼服務或內政部 TGOS；M1 驗證可用性與授權後決定。

## 6. 下一階段來源

| 來源 | 用途 | 里程碑 |
|---|---|---|
| 內政部警政署 165 開放資料（詐騙 LINE ID、假投資網站、闢謠） | 阿幫・防詐 | M7 |
| 全國法規資料庫開放資料 | 阿幫・開業 法規檢索 | M8 |
| 經濟部商工登記公示資料 | `company_lookup` | M8 |
| 環境部 AQI、健保署藥局、財政部發票 | 生活延伸 | 未排程 |

## 7. 使用規則

- 所有外部呼叫只在 `core/`（`CLAUDE.md` 規則 1）；新端點必設 TTL（規則 7）。
- 端點、欄位未驗證時：防禦性解析（欄位缺失回 `null`），並列入 `PLAN.md` M1 待驗證表。
- 金鑰不得出現在前端、log、MCP 回傳、fixture。
- fixture 錄製前移除可能的個資（車牌可保留，屬公開資料；不錄使用者位置）。
