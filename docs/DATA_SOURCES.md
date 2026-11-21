# 開放資料來源與使用方式

版本：v0.4（2026-11-17）。狀態：✅ 已串接（含 mock）　📝 待實作　⚠️ 端點／欄位待 M1 驗證　🔭 下一階段

## 1. 交通部 TDX 運輸資料流通服務（主要來源）

| 項目 | 內容 |
|---|---|
| 網站 | https://tdx.transportdata.tw （會員中心 → API 金鑰） |
| 授權 | 政府資料開放授權條款；畫面與 MCP 文字需標示「資料來源：交通部 TDX 運輸資料流通服務」 |
| 認證 | OIDC client credentials：`POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`，`grant_type=client_credentials`、`client_id`、`client_secret`；token 有效 24 小時 |
| 呼叫 | `GET https://tdx.transportdata.tw/api{path}`，`Authorization: Bearer {token}`，`$format=JSON` |
| 限制 | token endpoint 每 IP 每分鐘 ≤ 20 次；API 額度依會員方案（2026-11-21 實測：新帳號在「加值應用」審核通過前每分鐘只有 5 次，回應標頭 `x-ratelimit-limit-minute: 5`、`ratelimit-reset`）；client 端排隊（同時 3 個、間隔 220ms）；遇 429 依 `Retry-After` 重試一次 |
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
| 公路客運 | 路線站序 `/basic/v2/Bus/StopOfRoute/InterCity`（含 `StopPosition`）、時刻表 `/basic/v2/Bus/Schedule/InterCity`（`$filter=RouteUID eq …`）；票價端點待確認；即時到站 `/EstimatedTimeOfArrival/InterCity` 尚未使用 | 24h／1h | ✅ ⚠️ | `intercity_bus` |
| 高速公路路況 | 路段形狀 `/v2/Road/Traffic/SectionShape/Freeway`（WKT）、路段 `/Section/Freeway`（名稱、速限、長度）、即時 `/Live/Freeway`（`TravelSpeed`）、事件 `/Live/News/Freeway` | 24h／24h／60s／60s | ✅ ⚠️ | `traffic_status` |
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
| 用到的資料集 | ✅ `O-A0001-001` 自動氣象站觀測、`O-A0003-001` 局屬氣象站觀測（10m，兩者合併取最近且有氣溫或天氣的站；局屬站失敗只用自動站；`WeatherElement.Now.Precipitation` 是當日累積雨量，**不**用來判斷下雨）、`O-A0002-001` 雨量站觀測（10m，取 5 公里內最近一站的 `RainfallElement.Past1hr.Precipitation` 當 `rainMm1h`；失敗或附近沒站時為 null）、`F-D0047-089` 鄉鎮天氣預報（1h，`LocationName={鄉鎮}`，取「3小時降雨機率」第一個時段；失敗時 `pop3h` 為 null；`weather_tomorrow` 取明天各時段的降雨機率最高值、溫度範圍、天氣現象） ⚠️ |
| 實作 | `core/cwa-client.js`、`core/services/weather.js`；`-99` 等異常觀測值視為沒有資料；座標取 `CoordinateName=WGS84` |
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

## 5.1 內政部警政署 165 開放資料（✅ M7，免金鑰）

| 資料集 | 網址 | 更新 | 用途 |
|---|---|---|---|
| 165 遭停止解析涉詐網站（[176455](https://data.gov.tw/dataset/176455)） | `opdadm.moi.gov.tw` no-auth CSV（網址在 `core/services/antifraud.js`） | 每月；2026-11-19 實測約 9.7 萬網域 | 網址比對 |
| 165 詐騙闢謠專區（[38262](https://data.gov.tw/dataset/38262)） | 同上 | 每 7 日；實測 89 篇 | 闢謠搜尋 |

- 伺服器啟動後先下載建索引（約 11 MB、6 秒），24 小時更新；更新失敗沿用舊索引。只下載資料、不送任何使用者內容。
- `DEMO_MODE=1` 或 `OPEN_DATA=0`：用 `core/data/demo/antifraud-*.csv`（真實資料片段）。
- 不使用：「詐騙 LINE ID」（2024-11 起停止更新，已下架）、「假投資(博弈)網站」（由停止解析清單取代）。

## 5.2 生活服務開放資料（✅ M10，2026-11-19 實測）

| 服務 | 來源（data.gov.tw） | 網址 | 金鑰 | 更新 | 快取 |
|---|---|---|---|---|---|
| 空氣品質 | 環境部 aqx_p_432（40448） | `data.moenv.gov.tw/api/v2/aqx_p_432?api_key=…&format=JSON` | `MOENV_API_KEY`（無金鑰回 200＋「api_key 不存在」） | 每小時 | 10 分 |
| 地震 | 氣象署 E-A0015-001（6068）、E-A0016-001（17202） | `opendata.cwa.gov.tw` datastore | `CWA_API_KEY` | 每次地震 | 5 分 |
| 藥局 | 健保署特約藥局（39284） | `info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21005-001`（CSV、BOM、約 5.7 MB） | 免 | 每日 | 24 小時 |
| 垃圾車 | 臺北市清運點位（136515）、新北市路線（125664）、新北市即時 GPS（122972） | `data.taipei`、`data.ntpc.gov.tw`（CSV、BOM） | 免 | 不定期／每日／約 2 分 | 24 小時／24 小時／60 秒 |
| 油價 | 中油主產品牌價（6339） | `vipmbr.cpc.com.tw/opendata/mainprodlistprice`（JSON；大寫路徑會 301） | 免 | 每週一 | 1 小時 |
| 發票對獎 | 財政部 RSS（非 data.gov.tw） | `invoice.etax.nat.gov.tw/invoice.xml`（最近 6 期） | 免 | 單月 25 日 | 1 小時 |

- 藥局資料**沒有座標**（政府資料都沒有；新北資料集座標欄全空），所以用地區／名稱搜尋；要「附近藥局」需地理編碼（TGOS，需金鑰）。
- 垃圾車目前只接臺北市、新北市；臺中、臺南、高雄有即時 GPS（免金鑰）可再擴充。臺北市資料沒有星期欄位，依環保局規定週日、週三停收。
- 發票：增開六獎已不在資料中；e-invoice API 需財政部 appID，未使用。
- 共用 `core/opendata-client.js`：逾時 30 秒、TTL 快取、同網址只下載一次、更新失敗沿用舊資料、錯誤訊息不含網址參數。

## 5.3 股市收盤行情（✅ 2026-11-19 實測）

| 資料 | 網址 | 金鑰 | 欄位重點 | 快取 |
|---|---|---|---|---|
| 上市個股＋ETF 收盤 | `openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`（約 1,400 筆、320 KB） | 免 | `Date`（民國 1151118）、`Code`、`Name`、`OpeningPrice`／`HighestPrice`／`LowestPrice`／`ClosingPrice`、`Change`（負數帶「-」）、`TradeVolume`（股） | 30 分 |
| 上櫃個股＋ETF 收盤 | `www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes`（約 14,000 筆、5.4 MB，多數是權證） | 免 | `SecuritiesCompanyCode`、`CompanyName`、`Close`（無成交為「 ---」）、`Change`（「+0.01」「-54.00 」「--- 」）、`TradingShares` | 30 分（解析後只留 4 碼股票與 00 開頭 ETF） |
| 加權指數 | `openapi.twse.com.tw/v1/exchangeReport/MI_INDEX` | 免 | `指數`＝「發行量加權股價指數」、`收盤指數`、`漲跌`（+／-）、`漲跌點數` | 30 分 |
| 櫃買指數 | `www.tpex.org.tw/openapi/v1/tpex_index`（當月每日） | 免 | 取最後一筆：`Date`（西元 20261119）、`Close`、`Change`（負數帶「-」） | 30 分 |

- **收盤資料，不是即時報價**：每個交易日收盤後更新；兩個市場更新時間不同（實測 18:00 時上櫃已是 11/19、上市仍是 11/18），所以每檔都帶自己的日期。
- 即時報價（`mis.twse.com.tw`）不是開放資料 API、有頻率限制，不使用。
- 解析後才快取（上櫃原始檔大）；解析結果為空視為上游錯誤，沿用舊資料。示範片段：`core/data/demo/stock-*.json`（上市 31 檔、上櫃 15 檔、指數）。

## 6. 下一階段來源

| 來源 | 用途 | 里程碑 |
|---|---|---|
| 全國法規資料庫開放資料 | 阿幫・開業 法規檢索 | M8 |
| 經濟部商工登記公示資料 | `company_lookup` | M8 |

## 7. 使用規則

- 所有外部呼叫只在 `core/`（`CLAUDE.md` 規則 1）；新端點必設 TTL（規則 7）。
- 端點、欄位未驗證時：防禦性解析（欄位缺失回 `null`），並列入 `PLAN.md` M1 待驗證表。
- 金鑰不得出現在前端、log、MCP 回傳、fixture。
- fixture 錄製前移除可能的個資（車牌可保留，屬公開資料；不錄使用者位置）。
