# 開放資料來源與使用方式

版本：v0.5（2026-11-22：TDX 免費額度策略 §1.1、北捷看板實測）。狀態：✅ 已串接（含 mock）　📝 待實作　⚠️ 端點／欄位待 M1 驗證　🔭 下一階段

## 1. 交通部 TDX 運輸資料流通服務（主要來源）

| 項目 | 內容 |
|---|---|
| 網站 | https://tdx.transportdata.tw （會員中心 → API 金鑰） |
| 授權 | 政府資料開放授權條款；畫面與 MCP 文字需標示「資料來源：交通部 TDX 運輸資料流通服務」 |
| 認證 | OIDC client credentials：`POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token`，`grant_type=client_credentials`、`client_id`、`client_secret`；token 有效 24 小時 |
| 呼叫 | `GET https://tdx.transportdata.tw/api{path}`，`Authorization: Bearer {token}`，`$format=JSON` |
| 限制 | token endpoint 每 IP 每分鐘 ≤ 20 次（不算 API 額度）；API：基本會員**每把金鑰每分鐘 5 次**（產品負責人決定不加值；2026-11-22 實測依時鐘整分重置，標頭 `x-ratelimit-limit-minute`、`x-ratelimit-remaining-minute`、`ratelimit-reset`）。策略見 §1.1 |
| 實作 | `core/tdx-client.js`：token single-flight、到期前 5 分換新、回應快取（TTL 由呼叫端指定）、同網址同時只打一次、每分鐘額度閘門、401 換 token 重試、逾時 30 秒、OData 空白編碼為 `%20`；`core/tdx-store.js` 靜態資料存檔；`core/tdx-prewarm.js` 背景預熱 |
| 環境變數 | `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`（留空 → 示範模式）；`TDX_PER_MINUTE`（預設 5）、`TDX_CACHE_DIR`（預設 `.cache/tdx`，`off` 不存檔）、`TDX_PREWARM_CITIES`（預設 `Taipei,NewTaipei,Taoyuan`）、`TDX_PREWARM=0`（不預熱） |

常用 OData：`$filter`、`$select`、`$top`、`$orderby`；空間：`$spatialFilter=nearby(lat,lon,radiusM)`（radius ≤ 1000）。

### 1.1 免費額度（每分鐘 5 次）下的策略（2026-11-22）

目標：一般使用時（台北、新北、桃園的市區行程）行程規劃拿得到真實資料，不退回示範。

| 做法 | 內容 |
|---|---|
| 靜態資料整個縣市一次取、存檔 | 公車站牌（`Bus/Station/City/{City}`，含 `LocationCityCode`）、路線站序（`Bus/DisplayStopOfRoute/City/{City}`）、路線起訖（`Bus/Route/City/{City}`）、YouBike 站點（`Bike/Station/City/{City}`）；捷運四系統、台鐵、高鐵車站。正規化後寫到 `TDX_CACHE_DIR`（預設 `.cache/tdx/`，已 gitignore；Docker 用 volume `/app/.cache`），重啟先讀檔。新鮮 1 天，過期 30 天內仍先用、背景更新。**只存正規化結果**：不存 token、金鑰、網址參數、使用者座標；即時資料（到站、車數、看板）不存檔 |
| 本機算附近站牌 | 預熱過的縣市不再打 `Bus/Station/NearBy`、`Bike/Station/NearBy`：最近的站在 1.5 公里內、且站位實際所在縣市（`LocationCityCode`）也預熱過才用本機資料（例：基隆市區有新北路線的站，但基隆自己的路線沒預熱 → 照舊問 NearBy） |
| 即時資料整個縣市一次取、共用 | 公車到站 `Bus/EstimatedTimeOfArrival/City/{City}`（`$select=RouteUID,Direction,StopUID,EstimateTime,StopStatus,PlateNumb,NextBusTime`；`StopStatus` 2 交管不停靠、3 末班已過、4 今日未營運的路線 plan_trip 不列入；1 尚未發車有 `NextBusTime` 才換算等車時間，⚠️ 新北實測沒有這個欄位（PLAN M1 待驗證）；台北約 2.9 萬筆、5 MB、0.4 秒）、YouBike 車數 `Bike/Availability/City/{City}`：30 秒，所有路線、所有人共用；捷運看板整個系統一份（20 秒） |
| 直達公車只查一個縣市 | 起訖共同路線最多的那個縣市（站牌代碼前三碼＝路線的主管縣市），最多 3 條；不查路線形狀 |
| 額度排程 | `tdx-client` 依時鐘整分計數，回應標頭校正；`x-ratelimit-remaining-minute` 是 0 才鎖這一分鐘，這分鐘用完就直接回 429 走示範資料，不白打（2.5 秒內就重置的使用者請求等一下）。同網址同時只打一次；逾時 30 秒（含讀 body 與 token 請求，逾時回 504）；先拿 token 再扣額度（token 失敗不扣） |
| 舊快取 | 即時資料在這分鐘只剩 ≤ 1 次、或被擋 429 時，先用 60 秒內的舊資料（`updatedAt` 是原本取得的時間，計量 `stale: true`），不退回示範 |
| 背景預熱 | 伺服器啟動後依序下載（台北公車站牌、站序、YouBike → 北捷車站 → 新北 → 桃園 → 台鐵高鐵車站 → 其他捷運 → 路線起訖，共 18 次），每分鐘最多 3 次、留 2 次給使用者，有使用者在排隊時先讓；已存檔且新鮮的跳過；之後每 6 小時檢查一次 |
| 行程規劃的捷運 | 只看起訖附近有路網的系統（台北的行程不查高雄捷運車站） |
| 背景讓位 | 背景請求拿不到額度、或碰到每秒上限（分鐘額度還有）時丟 `TdxYield`（只讓位，不鎖整分、不記成額度用完）；併入同一份下載的使用者看到就以前景身分自己下載，不跟著退回示範 |
| 空資料 | 整個縣市／系統的靜態資料回空陣列當上游失敗（502，預熱會再試），不存檔、不蓋掉舊的；逐條查回空只在記憶體放 10 分鐘、不存檔；記憶體裡的靜態資料最多 400 份（LRU，有存檔的之後再讀檔）；存檔先看檔案大小再讀，讀不到的 key 記 10 分鐘 |
| 舊資料的倒數 | 公車到站秒數、捷運看板分鐘扣掉資料取得後經過的時間（不小於 0），行程判斷與提醒用修正後的值 |
| 多台伺服器 | 同一把金鑰的額度是所有機器共用：**只讓一台預熱**（其他設 `TDX_PREWARM=0`），各台的閘門靠 TDX 回應標頭校正；`TDX_PER_MINUTE` ≤ 2 時預熱停用並在 log 說明（要留 2 次給使用者） |
| 計量 | 工具結果 `metrics.upstream`：這次真的打了 TDX 幾次（只記端點類別，例 `Bus/EstimatedTimeOfArrival/City`，不記縣市、路線、參數） |

每個工具每次大約用幾次 TDX（預熱完成後；「0」＝都是快取或存檔）：

| 工具 | 次數 | 說明 |
|---|---|---|
| `plan_trip`（同縣市市區，例 西門町→台北101） | 2 | 公車到站 1（整個縣市）＋ YouBike 車數 1；30 秒內再問 0 |
| `plan_trip`（跨縣市，例 板橋→台北車站） | 3 | YouBike 車數兩個縣市各 1 |
| `plan_trip`（長途 > 15 公里） | 3～6 | 再加國道車速／事件、客運時刻、台鐵高鐵時刻（各有快取） |
| `bus_route_eta` | 0～1 | 到站整個縣市一份；沒預熱的縣市第一次多 1～2（站序、形狀，存檔） |
| `bus_nearby_stations`、`youbike_nearby` | 0～1 | 預熱過的縣市本機算；車數 1 |
| `metro_live_board` | 0～1 | 看板整個系統一份；站別時刻表第一次 1（存檔） |
| `metro_stations`、`rail_stations` | 0 | 存檔 |

免費額度下的預期：預熱完成後（新的空目錄約 6～7 分鐘；之後重啟幾乎不用打），每分鐘約可服務 2 趟市區行程；同一分鐘、同一縣市的行程共用到站與車數資料，多人同時問不會倍增。超過時改用 60 秒內的舊資料，再不行才退回示範並照實說。預熱期間使用者每分鐘只有 2 次，跨縣市行程可能有一部分是示範資料。實測數字見 `docs/PROGRESS.md`（2026-11-22）。

### 1.2 北捷即時到站（2026-11-22 實測）

`/basic/v2/Rail/Metro/LiveBoard/TRTC` 有資料，但**只列「列車進站中」的站**（整個路網約 20～25 筆、`EstimateTime` 都是 0），沒有倒數分鐘；某一站大多時候不在清單裡，所以以前常說「台北車站目前沒有即時到站資料」——不是站名比對的問題（`BL12`、`R10` 都對得到）。現在：看板整個系統一次取（20 秒共用），這一站沒有進站中的車的方向，改用站別時刻表 `/basic/v2/Rail/Metro/StationTimeTable/TRTC`（`$filter=StationID eq …`；依 `ServiceDay` 的星期幾，凌晨看前一天的末班；**國定假日**（2026-11-22）：這條線、這個方向、這個終點的資料有 `ServiceDay.NationalHolidays: true` 的班表時（區間車那一筆沒標就照星期幾，不被整筆排除），台灣時間的國定假日（含補假）用那一份。清單 `core/data/tw-holidays.json`＋`core/holidays.js`（2026、2027 年）由 `scripts/build-holidays.js` 讀人事行政總處的政府行政機關辦公日曆表 CSV（data.gov.tw 資料集 14718，原檔放 `scripts/data/dgpa-calendar/`）產生，取「放假而且有備註」的日子，已與 115、116 年辦公日曆表核對；執行時期不下載。`test/holidays.test.js` 比對產生結果，今年或明年不在清單就失敗（每年官方公告後重新產生）；資料沒標或清單外的年份照星期幾；凌晨的前一天營運日也一樣看）估 60 分鐘內各方向下一班，標 `scheduled: true`、`source: 'timetable'|'mixed'` 與 `note`「北捷即時到站在開放資料只有「進站中」，其他班次依時刻表估算」。時刻表存檔。其他系統只在這一站沒有看板資料時才查時刻表。TDX 欄位 `DestinationStaionID`（原文拼錯）與 `DestinationStationID` 都讀。看板列的狀態正規化成代碼（`arriving`＝`EstimateTime` 0，北捷看板實測只有這一種；`approaching`、`minutes`、時刻表 `scheduled`、沒時間 `unknown`），卡片用字典顯示（CARDS.md），不把中文字串送到英文卡片。

### 端點清單

| 用途 | 端點 | TTL | 狀態 | 用於 |
|---|---|---|---|---|
| 公車路線 | `/basic/v2/Bus/Route/City/{City}`（搜尋；整個縣市的起訖名稱另外預熱、存檔） | 1h／1d | ✅ | `bus_search_routes`、`bus_route_eta` |
| 路線站序 | `/basic/v2/Bus/DisplayStopOfRoute/City/{City}`（整個縣市，預熱）；沒預熱的縣市 `/{Route}` 逐條查 | 1d（存檔） | ✅ | `bus_route_eta`、`plan_trip` |
| 公車預估到站 | `/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}`（整個縣市，`$select`） | 30s（舊資料最多 60s） | ✅ | `bus_route_eta`、`plan_trip` |
| 站位預估到站 | `/advanced/v2/Bus/EstimatedTimeOfArrival/City/{City}/PassThrough/Station/{StationID}`（已驗證 2026-11-22：在 `/advanced/` 底下；以前用 `/basic/` 一律 404「Resouce Not Found」→ 502。`StationID` 是站位代碼，例：臺北市 `1000` 內湖國中回 2 筆路線） | 20s | ✅ | `bus_station_eta` |
| 公車站位 | `/basic/v2/Bus/Station/City/{City}`（整個縣市，預熱，本機算附近）；沒涵蓋時 `/advanced/v2/Bus/Station/NearBy`（不存檔：座標是使用者位置） | 1d（存檔）／1h | ✅ | `bus_nearby_stations`、`plan_trip` |
| 路線形狀 | `/basic/v2/Bus/Shape/City/{City}/{Route}`（WKT，欄位 `Geometry`） | 1d（存檔） | ✅ ⚠️ | `bus_route_eta.shape` |
| YouBike 站點 | `/basic/v2/Bike/Station/City/{City}`（預熱，本機算附近）；沒涵蓋時 `/advanced/v2/Bike/Station/NearBy` | 1d（存檔）／1h | ✅ | `youbike_nearby`、`plan_trip` |
| YouBike 車數 | `/basic/v2/Bike/Availability/City/{City}`（依站點代碼的縣市） | 30s（舊資料最多 60s） | ✅ | `youbike_nearby`、`plan_trip` |
| 高鐵時刻 | `/basic/v2/Rail/THSR/DailyTimetable/OD/{O}/to/{D}/{Date}` | 10m | ✅ | `thsr_timetable` |
| 高鐵車站 | `/basic/v2/Rail/THSR/Station` | 1d（存檔） | ✅ | `rail_stations` |
| 台鐵時刻 | `/basic/v3/Rail/TRA/DailyTrainTimetable/OD/{O}/to/{D}/{Date}` | 10m | ✅ | `tra_timetable` |
| 台鐵車站 | `/basic/v3/Rail/TRA/Station` | 1d（存檔） | ✅ | `rail_stations` |
| 高鐵／台鐵票價 | `/basic/v2/Rail/THSR/ODFare/{O}/to/{D}`、`/basic/v3/Rail/TRA/ODFare/{O}/to/{D}`（已驗證 2026-11-22：台鐵 `ODFares` 每個「車種×方向」一筆，`TrainType` 是車種代碼（＝`/basic/v3/Rail/TRA/TrainType` 的 `TrainTypeCode`：1 太魯閣、2 普悠瑪、3 自強、4 莒光、5 復興、6 區間、7 普快、10 區間快、11 自強3000），沒有 `TrainTypeName`；同一組起訖有兩個 `Direction`，另一個是繞島另一邊（臺北→新竹 78.1 對 797.8 公里），只取 `TravelDistance` 最短的；只列成人單程，普快與不認得的代碼不列。快取鍵改 `tra-fare-v2-*`） | 1d（存檔） | ✅ | `rail_fare` |
| 捷運車站 | `/basic/v2/Rail/Metro/Station/{Operator}` | 1d（存檔） | ✅ | `metro_stations`、`metro_live_board`（站名→代碼） |
| 捷運即時看板 | `/basic/v2/Rail/Metro/LiveBoard/{Operator}`（整個系統一份；北捷只有進站中的站，§1.2） | 20s | ✅ | `metro_live_board` |
| 捷運站別時刻表 | `/basic/v2/Rail/Metro/StationTimeTable/{Operator}`（`$filter=StationID eq …`） | 1d（存檔） | ✅ | `metro_live_board`（看板沒有的方向） |
| 公路客運 | 路線站序 `/basic/v2/Bus/StopOfRoute/InterCity`（含 `StopPosition`；存檔）、時刻表 `/basic/v2/Bus/Schedule/InterCity`（`$filter=RouteUID eq …`）；票價端點待確認；即時到站 `/EstimatedTimeOfArrival/InterCity` 尚未使用 | 1d／1h | ✅ ⚠️ | `intercity_bus` |
| 高速公路路況 | 路段形狀 `/basic/v2/Road/Traffic/SectionShape/Freeway`（2026-11-22 前少了 `/basic` 前綴、真實資料一律 404）（WKT）、路段 `/Section/Freeway`（名稱、速限、長度）、即時 `/Live/Freeway`（`TravelSpeed`）、事件 `/Live/News/Freeway` | 1d 存檔／1d 存檔／60s／60s | ✅ ⚠️ | `traffic_status` |
| 導訂票 | 台鐵／高鐵導訂票 API（需申請「臺鐵訂票導訂」「高鐵訂票導訂」權限） | 不快取 | 📝 ⚠️ | `rail_booking_link` |

`{City}` 由 `core/cities.js` 解析（`Taipei`、`NewTaipei`、`Taoyuan`、`Taichung`、`Tainan`、`Kaohsiung`…）；`{Operator}`：`TRTC` 台北、`TYMC` 桃園、`TMRT` 台中、`KRTC` 高雄。

### 停車場（2026-11-23，自己開車）

- `/basic/v1/Parking/OffStreet/CarPark/City/{City}?$spatialFilter=nearby(lat,lon,600)`：路外停車場（名稱、座標、地址、收費說明、有沒有即時空位）。靜態，存檔 1 天，快取鍵用目的地座標約 100 公尺一格。
- `/basic/v1/Parking/OffStreet/ParkingAvailability/City/{City}?$filter=CarParkID in (...)`：剩餘車位（只查最近幾個有即時資料的），60 秒。
- 只在「我有車」或說開車時查（不是每趟行程都打 TDX）；查不到或逾時（2.5 秒）不影響開車方案。
- **台北市、新北市**（TDX `CarPark` 清單是空的，只有空位）：停車場座標改用市府開放資料（免金鑰，跟著 `OPEN_DATA`；`core/services/parking-open.js`），整市清單快取 1 天，程式自己挑 600 公尺內的。

| 縣市 | 停車場清單（靜態，快取 1 天） | 剩餘車位（快取 60 秒） |
|---|---|---|
| 台北市 | 「臺北市停車場資訊」（[128435](https://data.gov.tw/dataset/128435)，停管處，每月更新）`tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json`（約 2.9 MB，`data.park[]`：`id`、`name`、`address`、`payex`、`tw97x`／`tw97y`、`totalcar`、`EntranceCoord.EntrancecoordInfo[].Xcod`（緯度）／`Ycod`（經度）） | TDX `ParkingAvailability/City/Taipei`（ID 相同：`TPE0001`…；即時）。不用 `TCMSV_allavailable.*`：2026-11-23 實測 JSON 停在 10-19、XML 停在 11-19 |
| 新北市 | 「新北市路外公共停車場資訊」`data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json?page=N&size=1000`（每頁最多 1000 筆，實測 1,345 筆、2 頁；`ID`、`NAME`、`ADDRESS`、`PAYEX`、`TW97X`／`TW97Y`、`TOTALCAR`） | 「新北市公有路外停車場即時賸餘車位數」（[122902](https://data.gov.tw/dataset/122902)，約 3 分鐘更新）`…/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json?page=N&size=1000`（`ID`、`AVAILABLECAR`；-9＝沒有即時資料）。TDX 新北的空位是空的 |

- 座標：TWD97 二度分帶（EPSG:3826）用 `core/twd97.js` 換成經緯度（自己寫的橫麥卡托反算，不加套件；與台北入口座標比對中位數差約 30 公尺）。台北市有入口座標時用入口（車子開進去的地方）；入口是 0,0 的改用 TWD97；入口與 TWD97 差超過 300 公尺當位置不確定、不列（實測 1,767 筆中 14 筆）。新北市東距、北距寫反的換回來；座標 0 或不在台灣的不收。小型車 0 格（機車停車場）不收。
- 收費說明只留第一句（例「計時：100元/時」），完整費率以現場公告為準。

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
| 用到的資料集 | ✅ `O-A0001-001` 自動氣象站觀測、`O-A0003-001` 局屬氣象站觀測（10m，兩者合併取最近且有氣溫或天氣的站；局屬站失敗只用自動站；`WeatherElement.Now.Precipitation` 是當日累積雨量，**不**用來判斷下雨）、`O-A0002-001` 雨量站觀測（10m，取 5 公里內最近一站的 `RainfallElement.Past1hr.Precipitation` 當 `rainMm1h`；失敗或附近沒站時為 null）、鄉鎮天氣預報（1h，**所在縣市的資料集**＋`LocationName={鄉鎮}`，取「3小時降雨機率」尚未結束的時段；失敗時 `pop3h` 為 null；`weather_tomorrow` 取明天各時段的降雨機率最高值、溫度範圍、天氣現象；`weather_now` 與 `weather_tomorrow` 共用同一份快取） ✅ 已驗證 2026-11-22 |
| 鄉鎮預報資料集 | 已驗證 2026-11-22：`F-D0047-089` 是「全臺各縣市」層級（`Location` 是 22 個縣市），用鄉鎮名稱篩一律空的（以前 `weather_tomorrow` 一律 502、`pop3h` 永遠 null）。鄉鎮要用各縣市「未來 3 天」資料集（溫度逐 1 小時、3 小時降雨機率與天氣現象逐 3 小時）：宜蘭縣 001、桃園市 005、新竹縣 009、苗栗縣 013、彰化縣 017、南投縣 021、雲林縣 025、嘉義縣 029、屏東縣 033、臺東縣 037、花蓮縣 041、澎湖縣 045、基隆市 049、新竹市 053、嘉義市 057、臺北市 061、高雄市 065、新北市 069、臺中市 073、臺南市 077、連江縣 081、金門縣 085（`F-D0047-0xx`，`core/services/weather.js` `TOWN_FORECAST`；縣市取最近觀測站的 `GeoInfo.CountyName`）。`F-D0047-093?locationId=F-D0047-065&LocationName=三民區` 結果相同，但一次最多 5 個 locationId，不用。欄位：`records.Locations[].LocationsName`（縣市）→ `Location[].LocationName`（鄉鎮）→ `WeatherElement[]`（`ElementName` 中文：溫度、3小時降雨機率、天氣現象…）→ `Time[]`（溫度用 `DataTime`，其餘 `StartTime`／`EndTime`，都帶 `+08:00`）→ `ElementValue[0]`（`Temperature`、`ProbabilityOfPrecipitation`、`Weather`） |
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
- 問指數（已驗證 2026-11-22）：「加權指數」「大盤」「台股」「TAIEX」→ 加權指數，「櫃買指數」「上櫃指數」「OTC」→ 櫃買指數（`core/services/stock.js` `indexOf`）；不拿去個股清單找、不列「找不到」，問到的指數排第一個（speak 講它）；只問指數不下載個股清單。以前問「加權指數」先回收盤又說「找不到：加權指數」。

## 5.4 MyDrama 短劇（✅ 2026-11-22，ADR-0019；非政府開放資料的內容合作來源）

阿幫只用合作方的**公開讀取**資料：熱門與分類排行、關鍵字搜尋、單一部劇、簡介、熱搜詞（`core/services/drama.js` 只寫用到的那幾個路徑）。

| 用途 | 快取 |
|---|---|
| 排行、關鍵字搜尋、熱搜詞 | 10 分（搜尋每個關鍵字各自快取） |
| 單一部劇、簡介 | 1 小時 |

- **網址不進 repo**：`MYDRAMA_API_BASE`（只收 https；本機開發可 `http://localhost`）、`MYDRAMA_LINK_EPISODE`（App 連結範本，`{id}`、`{ep}`）、`MYDRAMA_LINK_EXERCISE`、`MYDRAMA_STORE_IOS`／`MYDRAMA_STORE_ANDROID` 都只放 `.env`（合作方提供）。沒有 `MYDRAMA_API_BASE` 或 `DEMO_MODE=1` 時用 `core/data/demo/drama.json`（**虛構**的劇名與簡介，`demo-` 開頭的 id）。
- 不用任何要登入或後台權限的資料；送出的只有搜尋關鍵字。
- 下載後先正規化再快取：一次最多 50 部、只留阿幫用的欄位（劇名、類型、集數、簡介等），回應超過 2 MB 不解析。id 只收英數、底線、連字號；數字不合格為 `null`；分級是限制級（中文或英文代碼）或缺分級的不列。找不到或已下架 → `UserError`；其他錯誤與格式不符 → 上游錯誤（訊息不含網址）。
- 一集多長拿不到：等車推劇用「等 ≥ 5 分」代替「一集看得完」（PLAN.md D-08）。

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
