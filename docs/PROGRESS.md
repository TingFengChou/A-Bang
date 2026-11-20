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

## 2026-11-21（續）離線與弱網

- 做了：`api.js` 成功的回應存在手機（24 小時、30 筆；附近查詢含座標不存），連不上時顯示上次的資料與黃底橫幅「目前離線：顯示 HH:mm 存下的資料」；連回來或下一次成功時消失；隱私權政策與清除清單加上離線資料。
- 測試：npm test 485 項全過（新增 offline 三項）；E2E 44 項（看過的公車路線離線仍顯示、連回來恢復）。
- 文件：UX §4.10、PLAN、PROGRESS。
- 下一個：S12b 卡片英文。
- 卡住：無。

---

## 2026-11-21（續）T6 iOS 名稱與深色／著色圖示

- 做了：確認主畫面、設定、權限畫面的名稱（`CFBundleDisplayName`）已是 Abang，`PRODUCT_NAME` 維持 App；`scripts/build-icons.js` 產生 iOS 18 深色（透明底、放大置中、深色部分調亮）與著色（灰階、頭用中灰）圖示，`AppIcon.appiconset` 加 luminosity dark／tinted。
- 測試：xcodebuild 模擬器 Debug 編譯成功（actool 通過）；深色主畫面圖示在模擬器仍顯示淺色（推測圖示快取），待實機確認。
- 文件：PLAN T6、PROGRESS。
- 下一個：離線與弱網、S12b 卡片英文。
- 卡住：實機確認深色圖示需 Austin 的 iPhone。

---

## 2026-11-21（續）T7 通知體驗：出門提醒可多筆、可取消、先說明再要權限

- 做了：`public/js/reminders.js`（多筆、同一段路線一筆、取消、打開時過期的從通知列移除；Android 關機錯過的開機後仍會補送一次、擋不住；網頁用 service worker 通知、重新整理後還原、台灣時間）；行程卡「提醒我出門」第一次先說明為什麼要通知、被拒說怎麼開、設好可取消；設定頁「出門提醒」列表可取消；清除本機資料一起取消。
- 測試：npm test 482 項全過（新增 reminders 四項）；E2E 43 項（行程卡說明 → 允許 → 取消、焦點）。
- 文件：CARDS host 介面、PLAN、PROGRESS。
- 下一個：S12b 卡片英文或 T6 iOS 名稱與圖示。
- 卡住：無。

---

## 2026-11-21（續）首次使用引導

- 做了：第一次打開首頁的三步引導（能問什麼、允許定位、允許通知與改選方案），權限按了才要；可略過、Esc；設定頁可再看一次；E2E 其他測試預設已看過。
- 測試：npm test 478 項全過；E2E 42 項（新增引導：三步、要定位、看過不再顯示、深層連結不跳、設定頁再看一次）。
- 文件：UX §4.9、PLAN、PROGRESS。
- 下一個：T7 通知體驗或 S12b 卡片英文。
- 卡住：無。

---

## 2026-11-21（續）出門建議小卡（outing_advice）

- 做了：新工具 `outing_advice`（天氣＋空品，一邊查不到也能用；`with` 小孩／長輩）與 `outing` 卡片（建議最多 3 點，帶傘／防曬／保暖／口罩／安心出門線條圖示，要注意的警示色；氣溫・降雨機率・AQI）；示範與模型模式的出門建議改成一張卡；建議帶 kind／level。
- 測試：npm test 476 項全過（新增 outing 三項、卡片契約兩組）。
- 文件：MCP_TOOLS、CARDS、AGENT §5.2.4、PLAN。
- 下一個：S5 YouBike 空位預測或 S12b 卡片英文。
- 卡住：無。

---

## 2026-11-21（續）A1b 第二批狀態：多人同行（叫車每人分攤）、可能下雨、時間很緊

- 做了：人數解析（中文、數字、一家幾口、英文）與接著改；`plan_trip` `prefs.party` → 叫車每人分攤（4 人一輛）、自動狀態 `group`／`rainSoon`、`tight`、`tips`；卡片理由下方提醒列、決策圖標籤、英文總結；模型模式人數只採使用者說的。
- 測試：npm test 469 項全過（新增 agent-states-2 六項、情境 A1b-1、A1b-2）。
- 文件：AGENT §5.2.9、MCP_TOOLS 6.5、CARDS trip、PLAN。
- 下一個：S5 YouBike 空位預測或出門建議小卡。
- 卡住：無。

---

## 2026-11-21（續）S1 常用地點

- 做了：設定頁「常用地點」（家、公司、學校設成現在位置／重設／清除，台灣範圍外與大概位置不存）；問阿幫只送句子提到的那個座標（`savedPlaces`，「重來」前的不算）；規則與模型模式「回家」「從公司回家」「從家去公司」「下班回家」直接成行程，只是提到（「我家附近的藥局」「明天上班會下雨嗎」）不算；沒設定時告訴他到哪裡設定並附按鈕；接著改沿用；隱私權政策、iOS 定位說明與本機資料清單加上常用地點。
- 審查（PR #46）：設計（焦點、定位中、確認、按鈕層級、文案）、架構（只是提到被當行程、從家去公司、範圍外 400、模型模式解析）、手機（大概位置、範圍外、iOS 權限說明、pending 互清）都已修；S1b～S1d 列入 PLAN。
- 測試：npm test 463 項全過（新增情境 S1-6～S1-11、agent-grounded 兩項、saved-places 三項）；E2E（設定家 → 「回家」只送家）。
- 文件：AGENT §5.2.8、UX §5.0、PLAN。
- 下一個：A1b 第二批狀態或 S5／S6。
- 卡住：無。

---

## 2026-11-21（續）Agent 情境補齊：明天天氣、高鐵台鐵最近站、深夜末班車、捷運與轉乘、英文（PR #38～#42）

- 做了：
  - PR #38：`weather_tomorrow` 明天天氣（白天降雨機率、沒有時區當台灣時間、後天以後明說查不到）。
  - PR #39：高鐵／台鐵沒說起站用最近的車站（最近 3 站依序查、排除迄站、句中地名、票價走 rail_fare）。
  - PR #40：深夜與末班車（示範規則；真實看到站狀態）、示範時鐘 `DEMO_CLOCK`、測試不受跑的時間影響。
  - PR #41：`plan_trip` 捷運方案與轉乘（轉乘站、各系統估算、機捷票價）。
  - PR #42：英文提問（觀光客）：英文地名與官方譯名、英文規則與總結、英文接上一輪、防詐英文不給錯誤安心。
  - 情境集（`test/scenarios/life.json`）全部情境都有第一版，**todo 0**。
- 測試：npm test 451 項全過；npm run e2e 39 項全過。
- 文件：MCP_TOOLS（weather_tomorrow、時刻表 near、捷運方案、深夜）、AGENT §5.2.5～§5.2.7、DATA_SOURCES、CARDS、PLAN（M1 待驗證：預報欄位、車站座標、捷運線別）、.env.example（DEMO_CLOCK）。
- 下一個：設計審查待辦（出門建議小卡、重來分隔線、沒變的卡片收合、決策圖收班節點）、M11-03／04、M12 E8、S12b 卡片英文。
- 卡住：同前（金鑰、iOS 實機、上架帳號、MyDrama）。

## 2026-11-21 App 品牌與返回手勢、裝置端 AI、App 體驗、Agent 聰明度（PR #31～#36）

- 做了：
  - PR #31：App 名稱 Abang、藍鵲 agent 造型（冠羽層次、耳麥、HUD 鏡片）與圖示（保留尾巴、Android 主題單色）；Android 返回手勢；模型模式預先查詢沿用比對與失敗原因。
  - PR #32（ADR-0014）：裝置端 AI——iOS Apple Intelligence、Android Gemini Nano 在手機上判斷意圖與狀態（`deviceJudge`）；Pixel 實機 172 題意圖 90.1%、p50 約 270 ms；組合全對 89.0%（與伺服器地端模型相當）。
  - PR #33：原生定位（iOS 只問一次）、鍵盤打開收起分頁列、定位泡泡更新、同一輪不重複說明、iOS 隱私清單、離線快取補齊。
  - PR #34：轉述受程式約束（模型不能自加時間與方式、下一步依建議方式、不露出工具名稱）、起訖點已知的行程由程式先比較、捷運最近站、情境對話測試集。
  - PR #35：結構化上下文（接著改起點／目的地／時間、不要某方式、重來；決策圖「不要」）。
  - PR #36：帶長輩、帶小孩、行動不便狀態（排除不適合的方式、明講時照選並提醒）、出門建議（天氣＋空品）；判斷層訓練集改標。
  - 每個 PR 由架構師、網頁、Android、iOS、設計師、QA 角色審查後修正再合併。
- 測試：npm test 402 項全過（todo 4）；npm run e2e 39 項全過；情境（地端 qwen3:8b）已實作情境全過；Pixel 實機與 iOS 模擬器驗證。
- 文件：ADR-0014、AGENT.md §5.2.2～§5.2.4、MCP_TOOLS.md、CARDS.md、TESTING.md、BRAND.md、`docs/research/edge-eval.md`、PLAN.md（M12、M13）。
- 下一個：M13 剩餘情境（末班車、轉乘、英文、明天天氣）、M11-03／04、M12 E3／E7／E8。
- 卡住：iOS 實機（iPhone 15 Pro 以上）；TDX／CWA／MOENV 金鑰；MyDrama 短劇串接需 workpack 與公司 repo；上架需 HTTPS 環境與開發者帳號。

## 2026-11-20 以現在位置為起點、接著改交通方式、點方案就改選

- 做了（Austin 回饋：起點都可以用現在位置、提示應該是「要去哪」；選了汽車想改公車卻又選汽車，缺少上下文；點公車圖示應該有作用；「我聽懂了」每次都講沒必要）：
  - 規則：「去 X」、只打地名、「坐公車去 X」都是行程，起點用現在位置；「會下雨嗎」「空氣好嗎」查現在位置；「307 到哪了？」沒說站就聚焦離你最近的站（`bus_route_eta` 新增 `near`、`cityNear` 用最近地標推估縣市）。
  - 上下文：「改坐公車」「那叫車呢」「不要叫車，改公車」「我很趕」沿用上一輪的起訖點與狀態重算（`followUp`）；判斷層遇到改行程以規則為準（分類器只看這一句會誤判成查公車）；天氣、YouBike 等查詢不算改行程。
  - 決策：`plan_trip` 新增 `prefs.mode`（使用者指定交通方式），`decide()` 分數與排名照算、建議改成該方式裡分數最高的，理由「照你說的選…」；決策圖重算也照指定方式。
  - 點方案：決策圖上沒被選的方案、行程卡備案的「改成這個」＝送出「改成 公車 601」，走同一套流程（公車會自動盯到站）。
  - 「我聽懂了」拿掉：只在行程前說一句有資訊的話（你的狀況、或照你說的改成哪種方式）。
  - 建議問題與輸入提示改成「去台北 101」「會下雨嗎？」「附近還有 YouBike 嗎？」；App 打開問阿幫就先定位（2 分鐘內重用），Android／iOS 加定位權限與說明。
  - 起點交給程式：手機實測出現「台北101 → 台北101」（地端模型把目的地也填成起點，所以只剩步行與叫車、看不到公車）。模型模式下使用者沒說起點時，`plan_trip` 的起點一律換成手機定位（還沒定位先請 App 定位；拒絕定位又同點時請模型改問從哪出發）。
  - YouBike 兩端（Austin：起點有車、終點常常沒空位還車）：起點優先選 ≥ 3 台、終點優先選 ≥ 3 個空位的站（多走不到 300 公尺就選它，終點找到 800 公尺）；很緊時警告並給備用站；起點沒車或終點沒空位寫出「沒列入」原因（`skipped`）；卡片顯示「借車：A・5 台」「還車：B・21 位」；討論串行程回報多一行 YouBike 結論。
  - 決策圖點方案後不再出現瀏覽器的橘色焦點框。
  - 有位置就先查好：Pixel 實測地端模型仍會只查目的地就反問「從哪出發」→ 模型模式改成程式先依現在位置跑 `plan_trip`（或天氣、YouBike 等），再請模型轉述；模型重複呼叫時沿用結果（曾出現兩個叫車）。
  - 需要現在位置時（沒說起點的行程、沒說地點的天氣／YouBike 等），模型模式在問模型之前就先請 App 定位，再把位置寫進系統提示（地端模型曾直接反問「請問你現在在哪裡」）。Pixel 實測「去台北 101」→「你的位置 → 台北101」。
- 測試：npm test 296 項全過；npm run e2e 28 項全過
- 文件：AGENT.md、PROGRESS
- 下一個：MyDrama 短劇（等 repo）、判斷層 A 放進 App
- 卡住：無

## 2026-11-20 公車街景（Blender）取代立體路線圖

- 做了：Austin 回饋傾斜的立體路線圖看不懂。`scripts/blender/bus-scene.py`（Blender 4.5，Cycles，程式建模）算出街景 `street.png`、公車 `bus.png` 與 `scene.json`；`public/ui/cards/bus-scene.js` 把公車依 `railOf` 的站數放到路上（停靠、一站、兩站以上停在左邊），站名與「601・還有 N 站・約 M 分」用網頁文字，刷新時開到新位置；公車頁取代立體路線圖，問阿幫公車卡拿掉地圖按鈕（保留進度軌）；刪除 `route3d.js`。SW v0.6.7。
- 測試：npm test 全過（街景座標與 scene.json 一致、站數對應位置）；npm run e2e 28 項全過；Playwright 截圖確認遠近兩種位置文字不被切。
- 文件：UX.md §9
- 下一個：判斷層 A 放進 App（Edge AI）
- 卡住：無

## 2026-11-20 M11-02 到站提醒改手機本機通知

- 做了：`@capacitor/local-notifications` 8.3.1（devDependency，`cap sync` 會帶進原生專案）；`public/js/native-notify.js` 經 `Capacitor.nativePromise` 呼叫（免建置）；`host-web` 的到站提醒每次查到到站時間就把「該出門了」排到預估時間（同一則 id 覆蓋、差不到 20 秒不重排），App 到背景或被關掉時由系統送出，文字註明「依 HH:mm 的到站時間估計」；車比預估早到就馬上送；取消或逾時會取消排好的通知；出發提醒（`remind`）也改本機通知；`host.background` → 文字「App 關著也會提醒」（網頁仍「App 開著時」）。iOS `contentInset: never`（原本頂端重複留白）。
- 實機：iOS 模擬器允許通知 → 排程成功（系統記錄 Added notification request）→ App 關掉後到點送達。Android 實機（Pixel 11 Pro XL）允許通知後排程，App 程序結束後由系統準時送達。
- 測試：npm test 292 項全過（新增 App 到站提醒 1 項）；npm run e2e 28 項全過
- 文件：PLAN（M11-02）、UX、ADR-0013
- 下一個：M11-03 原生相機掃 QR、定位
- 卡住：無（Android 精準鬧鐘權限沒開時系統可能延後幾十秒送；上架前確認 Google Play 政策）

## 2026-11-20 M11-01 手機 App 殼（Capacitor，ADR-0013）

- 做了：ADR-0013（Capacitor 8 包現有網頁、前端打包進 App、API 位址可設定、App 來源 CORS、App 內不註冊 service worker）。`npm run build:app`（`scripts/build-app.js`：複製 public／GSAP／`core/decide.js` 到 `dist/app`，注入 `__ABANG_API_BASE__`、`__ABANG_APP__`；正式版 `APP_RELEASE=1` 只收 https）；前端 API 呼叫改經 `public/js/base.js`；伺服器 `APP_ORIGINS`（預設 `capacitor://localhost`、`https://localhost`）對問阿幫與 REST 讀取路由加 CORS（不用 `*`）；`android/`、`ios/` 原生專案，App ID `tw.abang.app`；Android 網路安全設定只對 localhost／127.0.0.1／10.0.2.2 允許明碼 http。Capacitor 套件 8.6.0 都放 devDependencies（不進 Docker 映像）。
- 實機：Android 模擬器（API 35）裝 debug APK，首頁、狀態、問阿幫串流與決策圖正常；iOS 模擬器（iPhone 18 Pro）編譯、安裝、首頁與問阿幫正常（「我聽懂了」、影響行、自動盯公車）。第一次在 Android 上連不到：WebView 擋明碼 http → 加網路安全設定；REST 讀取路由原本沒有 CORS → 對 App 來源補上。
- 測試：npm test 291 項全過（新增 `test/build-app.test.js` 2 項、agent-http CORS 1 項）；npm run e2e 28 項全過；lint 忽略 `android/`、`ios/`。
- 文件：ADR-0013、adr/README、PLAN（M11、Austin 待辦：開發者帳號）、README（手機 App）、CLAUDE.md、.env.example
- 下一個：M11-02 到站提醒改手機本機通知
- 卡住：給別人用需要 HTTPS 測試環境（M6-06）與 Apple／Google 開發者帳號

## 2026-11-20 動態第四批：分段條、3D 吉祥物、立體路線圖（動畫清單完成）

- 做了：行程分段條依真實分鐘比例（`legShares`）、代幣每段換交通方式並在轉乘點彈一下；首頁 3D 吉祥物（厚度陰影、自己轉身、跟著手指轉頭）；立體路線圖（`route3d.js`：`projector` 經緯度投影、CSS 3D 傾斜地面、路線畫出、「你」圖釘與公車代幣立起來；公車頁預設、公車卡可展開）。修：公車頁沒有卡片色彩變數時路線看不到（地圖內建預設色）。SW v0.6.4。
- 測試：npm test 288 項全過（`test/motion-helpers.test.js` 新增 2 項）；npm run e2e 28 項全過；Playwright 截圖確認分段條換代幣、首頁吉祥物、公車頁與卡片路線圖，無主控台錯誤。
- 文件：UX.md §9
- 下一個：（動畫清單完成）正式 3D 吉祥物渲染圖需設計師
- 卡住：無

## 2026-11-20 動態第三批：公車站間滑動、空品儀表、天氣氛圍

- 做了：公車刷新後同一台車（車牌）從舊站滑到新站（`public/ui/cards/slide.js`；公車頁 `paint({ fresh })`、卡片 `draw({ fresh })` 只在資料刷新時滑）；空品卡改成六級半圓儀表＋指針轉動＋數字跳動（`gauge.js`）；天氣卡上方情境畫面（雨、雲、月亮星星、太陽）。SW v0.6.3。
- 測試：npm test 286 項全過（新增 `test/motion-helpers.test.js` 3 項）；npm run e2e 28 項全過；Playwright 截圖確認儀表與下雨畫面、公車頁實際觸發滑動。
- 文件：UX.md §9
- 下一個：分段條依真實分鐘比例
- 卡住：無

## 2026-11-20 動態第二批：討論串決策感、公車進度軌、中獎紙花

- 做了：討論串從「loading」變成「依資料做決定」：一送出阿幫先說聽懂了什麼（判斷層快速版 `judge.quick`，不等模型；實機原本要 5 秒才出現），完整判斷多找到的狀態再補一句；每筆資料回報下多一行「→ 影響」（`core/agent/impact.js`，`tool_result.impact`，紅扣分／綠有利／灰不影響）；最後回答前超過 600ms 無事件時出現「阿幫在想」。公車卡上車站區塊：「公車還有 N 站到你這」進度軌（`railOf`，公車代幣滑動）、倒數翻牌、進度環、快到時轉綠發光。發票：號碼從最後一碼逐位亮起、對中位數綠底（`hitDigits`）、中獎灑紙花（`confetti.js`，我的發票也會）。修：車已在視窗第一站時公車代幣位置算成負值（跑出軌道）。SW v0.6.2。
- 測試：npm test 283 項全過（新增 `test/decision-feel.test.js` 6 項）；npm run e2e 28 項全過；另以 Playwright 截圖確認討論串影響行與進度軌。
- 文件：UX.md §9、AGENT.md（`tool_result.impact`、§5.3 快速判斷）
- 下一個：站間 FLIP、空品儀表、天氣氛圍
- 卡住：無

## 2026-11-20 L-17 判斷層導入問阿幫

- 做了：依實驗結果把判斷層放進 `core/agent/judge.js`。狀態組合另做比較：規則 ∪（A ∩ B）全對 89.5%（驗收集 88.4%）最好，多數決 87.8%、規則單獨 86.0%（皆以混合意圖計）；為省模型呼叫，B 只在 A 沒把握或行程問題時問。示範模式（`runDemo`）意圖與狀態以判斷層為準、參數照判斷意圖由規則抽（`parseIntent(text, { intent })`，抽不出退回規則）；模型模式（`runModel`）`plan_trip` 狀態改用判斷層＋點選、地端模型有把握時只給該意圖工具（`INTENT_TOOLS`）；`status` 帶 judge。`@huggingface/transformers` 改選用依賴；伺服器背景載入（`judgeFromEnv`，`JUDGE=off`、`JUDGE_MODEL_DIR`）；Docker 建置時先下載模型（`scripts/fetch-judge-model.js`）；CI／E2E `JUDGE=off`。修模型照抄內部備註（followUpText 改成［內部備註，不要照抄］）。
- 實機（8787，地端 qwen3:8b）：「我在等的那班 299 怎麼還沒來」判斷公車（0.98，規則原本判不出）；「很趕，而且想省點錢，從公館到市政府」狀態趕時間＋想省錢、自動盯 212，約 18 秒。
- 測試：npm test 274 項全過（新增 `test/judge.test.js` 6 項）；npm run e2e 28 項全過
- 文件：AGENT.md §5.3、CLAUDE.md、README、.env.example、PLAN.md（L-17）、docs/index.html 實驗結論
- 另：使用者回饋「輸入框上方應該是建議下一步，不是一開始的通用範例」→ `public/js/agent/next-steps.js`（依這一輪工具結果推導：到站提醒、開公車頁、決策圖加狀態、回程、目的地天氣、股市與發票的延伸），「其他問題」換回通用範例；設定到站提醒後建議跟著更新。回報的「回答出現兩次」在頁面上重現不到（DOM 只有一次），待使用者提供截圖。新增 `test/next-steps.test.js` 3 項；E2E 加「接下來可以」檢查。SW v0.6.1
- 下一個：狀態信心低時在決策圖請使用者確認；真實提問擴充評估集（隱私做法待定）
- 卡住：無

## 2026-11-20 實驗（續）：A 嵌入分類器、B 自動優化提示詞、混合

- 做了：使用者會議提到 Google Harness²、Pi agent（都開源）。評估後：Pi 是 TypeScript agent 執行核心（不影響判斷準確度，之後要多模型或裝置上 agent 再考慮）；Harness² 是研究程式碼、偏 coding agent，採用其概念（提出修改 → 試跑 → 只留變好的）。A：`@huggingface/transformers`（dev 依賴）＋multilingual-e5-small，類別中心＋信心、狀態 logistic regression，參數只用訓練範例（`decision-train.json` 176 筆，不與評估集重複）交叉驗證挑；B：`scripts/eval-optimize-prompt.js`，優化集（單數 id）提出／試跑／保留，驗收集（雙數 id）驗收；共用 `scripts/eval/lib.js`。
- 結果（172 題）：規則 68.0%／全對 64.0%；A 86.6%／73.3%（< 5 ms）；混合（A 信心 ≥ 0.8 用 A，否則 qwen3:8b）94.2%／80.2%、驗收集全對 84.9%、69% 題目不用問模型；qwen3:8b 94.8%／58.7%；B 94.2%／81.4%、狀態 F1 45.7% → 70.5%、驗收集全對 61.6% → 80.2%（20.5 分鐘，兩個候選讓分數掉到 21–26%，被擋掉）。
- 文件：`docs/research/decision-eval.md`、`prompt-optimization.json`、`docs/index.html` 新增「13 實驗紀錄」
- 下一個：混合＋B 組合、Jev 待金鑰、A 在瀏覽器／App 實測
- 卡住：Jev 金鑰

## 2026-11-20 實驗：意圖與狀態判斷（規則 vs 地端模型 vs Jev）

- 做了：使用者想評估 TypeSafe Jev（System One 決策模型）能不能用在阿幫的「判斷層」（不取代 `decide.js` 計分）。`scripts/eval/decision-set.json` 172 題自行撰寫的繁中提問（63 容易、109 困難：口語、沒有關鍵字、追問；15 類意圖、6 種狀態，29 題有狀態）。`scripts/eval-decision.js`（`npm run eval:decision`，Node 內建 fetch、不加依賴）：規則（`parseIntent`）、地端模型（OpenAI 相容、JSON 輸出、關閉思考）、Jev（`/v1/systemone`：意圖 choice＋各狀態 noul，信心門檻涵蓋率與正確率）；報告寫到 `docs/research/decision-eval.md`。
- 結果（Jev 待金鑰）：規則意圖 68.0%（困難 51.4%）、狀態 F1 76.7%、0 ms；qwen3:8b 意圖 94.8%（困難 91.7%）、狀態 F1 45.7%（precision 30.2%：常自己加「少走路」「想省錢」）、約 0.7 秒。
- 下一個：取得 Jev 金鑰（TypeSafe console waitlist，或 Requesty／APIMaster 代理）放 `.env` 的 `JEV_API_KEY` 後重跑，比較意圖正確率、狀態 precision、信心門檻
- 卡住：Jev 金鑰（使用者申請）

## 2026-11-20「阿幫在想」會議感（原型的思考過程動畫）

- 做了：使用者希望思考過程像原型 `transit-discussion.html` 一樣以動畫呈現、有 agent 感。decision 事件加 `signals`（`tripSignals`：天氣、空品、路況、地點的一句真實重點）。決策圖改成原型版面（來源圓點 → 阿幫吉祥物 → 方案膠囊、狀態膠囊在上方）；GSAP 編排四步驟（資料膠囊沿線飛進阿幫、狀態彈出、逐項累加真實分數讓連線變粗、決定後阿幫換開心與光點持續流動），步驟列、7 秒保險；方案連線粗細改 inline（原本被 CSS 蓋掉）。討論串會議感：討論中虛線框＋標題跳點，結束收合成頭像堆摘要。
- 測試：npm test 268 項全過；npm run e2e 28 項全過（完整動態截圖：中途「① 收集資料」資料膠囊飛向阿幫、播完「④ 決定」光點流動）
- 文件：UX.md §9、PROGRESS.md
- 下一個：設計 review 第 3 批（公車進度軌）等使用者看過
- 卡住：無

## 2026-11-20 動態設計第一輪（設計 review 建議 1–5、9、決策出爐、交棒）

- 做了：請設計師角色 review（診斷：動畫沒串成故事、結論重複三次、首頁格子扁平、討論串沒生命感）。使用者放寬「可以加套件，以最佳體驗為主」→ 引入 GSAP 3（`npm i gsap`，伺服器 `/vendor/` 白名單、SW 預載；`motion()` 漸進增強）。按壓手感、泡泡進場與三點打字、阿幫表情（think／happy）、首頁立體代幣格子與吉祥物浮動、捲動進場、決策圖 GSAP 時間軸（畫線、彈出、光點沿勝出路徑、4 秒保險）、勝出代幣飛進行程卡、行程卡不重複理由。SW v0.6.0
- 測試：npm test 268 項全過；npm run e2e 全過（完整動態測試加：GSAP 有載入、中途與播完截圖、播完節點都看得到、光點移除）；8787 實機看首頁格子
- 文件：UX.md §9、PROGRESS.md
- 下一個：下一批（公車進度軌、中獎動畫、空品儀表…）等使用者看過
- 卡住：無

## 2026-11-20 交通方式圖示＋3D 動畫

- 做了：使用者覺得設計不夠吸引人（「公車、步行…都要用 icon，之前都會用圖示加動畫，3D 更好」）。新增 `public/ui/cards/mode-icons.js`：交通方式與資料來源線條圖示、立體代幣 `token()`、決策圖用 `svgIcon()`。行程卡：方案代幣（建議的較大且浮動）、分段條加高並立體、每段圖示＋分鐘、依序長出、小代幣沿路線跑一趟、分段明細與排除方案也有圖示。決策圖：來源與方案節點有圖示、勝出節點厚度陰影、建議節點呼吸光暈、勝出路徑虛線流動（修 `.dg-node rect` 誤套到圖示裡的 rect → 改 `> rect`）。公車卡片與公車頁：車的位置用浮動公車代幣、上車站脈衝光圈、倒數旁公車代幣。`dom.js` 的 `style` 支援 CSS 變數。全部只用 CSS，reduced motion 與精簡模式不動。SW v0.5.1
- 測試：npm test 268 項全過；npm run e2e 28 項全過；8787 實機（地端模型）看行程卡、決策圖、公車卡片
- 文件：UX.md §9、CARDS.md、PROGRESS.md
- 下一個：等使用者看過再調整
- 卡住：無

## 2026-11-20 M10 L-14 選公車就盯到站＋到站提醒

- 做了：使用者希望「決定搭公車後，agent 要開公車動態並在快到站時提醒」。core：`matchDirect` 上車站帶站序與方向；`plan_trip` 公車方案帶 `follow`；示範 `directTrips` 用示範路線真的站名（規劃用的到站時間仍固定，測試可重現）；`bus_route_eta` 加 `stop`／`direction` → `focus`（`focusStop`、`focusText`）。agent：`run.js` `busFollowUp`，`execTools` 在 `plan_trip` 的 `decision` 後自動送 `@公車` 與 `bus_route_eta`（示範與模型模式相同，查不到不影響行程）；示範總結說公車多久到、走過去幾分、趕不上就提醒下一班；模型拿到 `followUpText`；life 規則。網頁：`bus-route` 卡片聚焦上車站（大倒數、你在這上車、到站前 3／5 分提醒、開公車頁看動態）；`host-web` `watchArrival`（整頁共用、每 20 秒查、到點通知一次、設定時已趕不上就跳過這班、最多 90 分）、`navigate`；公車頁 `?stop=&dir=` 顯示上車站與同一個提醒；App toast。另：問阿幫頭像改吉祥物與線條圖示；互動模型原型（PR #16）。SW v0.4.9
- 測試：npm test 268 項全過（新增 `test/bus-follow.test.js` 6 項：聚焦、上車站方向、tool focus、`busFollowUp`、示範事件流與總結、網頁 host 提醒的跳過與準時；`agent-model` 更新：模型模式也自動盯、結果接給模型）；npm run e2e 28 項全過（新增：想省錢 → 公車卡片聚焦 → 到站前 5 分提醒 → 開公車頁同一個提醒 → toast；截圖已檢查）
- 文件：AGENT.md §5.2、MCP_TOOLS.md、CARDS.md、UX.md §6–7、PLAN.md（L-14）、PROGRESS.md
- 下一個：L-15 財政部載具（需公司申請 AppID）、L-16 排程（推播需 ADR）——等使用者決定
- 卡住：提醒只在 App 開著時有效；準時推播需推播伺服器（ADR）

## 2026-11-19 M10 L-13 掃發票 QR code

- 做了：`public/js/invoice-qr.js`：`parseInvoiceCode` 依財政部電子發票證明聯條碼規格解析（左邊 QR 前 77 碼：字軌、號碼、民國開立日期…；右邊 `**` 開頭 → 提示掃左邊；一維條碼 Code 39 → 期別，雙數月轉單數起始月）；`openScanner` 用 `BarcodeDetector`＋後鏡頭的 `<dialog>`，連續掃描、同一張只存一次、存到時震動，完成或 Esc 停相機；只取號碼與日期，不保存統編、金額、品項。「我的發票」加「掃發票 QR code」按鈕，關閉後一次對獎；不支援的瀏覽器（iPhone Safari、Firefox）顯示改手動輸入。問阿幫的提議提到可以掃 QR code。SW v0.4.7
- 測試：npm test 新增 `test/invoice-qr.test.js` 5 項（左右 QR、一維條碼、非發票、不支援、期別可直接對獎）；npm run e2e 新增掃發票（假 BarcodeDetector 依序吐右邊 QR、左邊 QR 兩次、一維條碼；canvas 假相機；完成後中獎與待開獎、只存號碼與日期；不支援時改手動），共 27 項全過。E2E 伺服器 `RATE_LIMIT_API` 調高（整套一分鐘內呼叫超過 120 次會被限流，限流本身在 `mcp.test` 測）
- 文件：UX.md §6、PLAN.md（L-13）、PROGRESS.md
- 下一個：等使用者決定
- 卡住：真實發票的實機掃描要使用者在 Android Chrome 或這台 Mac 的瀏覽器試

## 2026-11-19 M10 L-12 股市收盤行情

- 做了：`core/services/stock.js`（證交所上市、櫃買中心上櫃收盤＋加權／櫃買指數；民國／西元日期、「+」「---」與尾端空白、權證略過；解析後才快取、空資料視為上游錯誤）＋示範片段 `core/data/demo/stock-*.json`。tool `stock_quote`（新工具包 `finance`，L1）：代號或名稱、多檔、找不到列 `notFound`、部分相同附 `similar`；文字固定附「不構成投資建議」，漲跌寫成「漲／跌」文字。`stock` 卡片：指數、收盤、漲紅跌綠＋▲▼、卡片內查別檔並 `setContext`。首頁「股市」格子、服務頁記住上次查的股票。問阿幫（互動模型，`AGENT.md` §5.1）：股市意圖與名稱擷取、追問（「那聯發科呢？」「0056 呢」，`parseIntent(text, { history })`）、股市脈絡下「該買嗎」也接著查；問買賣先說不提供投資建議；`PACK_GUARDRAILS.finance`；輸出護欄 `no-investment-advice`（買賣建議、看漲看跌、目標價、明牌整句換掉）。SW v0.4.6
- 量測：真實 API 4 檔查詢 1.2 秒（含上櫃 5.4 MB），第二次 0 ms（快取）。地端 qwen3:8b 5 種情境（查一檔、追問、問買賣、大盤、卡片脈絡「它」）都正確呼叫工具；原本有一次把指數漲說成跌，工具文字改成「漲 102.8 點」後正確
- 測試：npm test 新增 `test/stock.test.js`（解析、指數、比對、tool、fetchers、追問事件流、輸出護欄）、股市意圖與追問、計畫與總結；npm run e2e 新增股市服務頁（預設查詢、漲紅跌綠、卡片內查別檔）與問阿幫（查股價 → 追問 → 問買賣）
- 文件：DATA_SOURCES.md §5.3、MCP_TOOLS.md、CARDS.md、AGENT.md（§5 意圖、§5.1 股市互動模型）、UX.md §6–7、PLAN.md（L-12）、README、CLAUDE.md、docs/index.html
- 下一個：掃發票 QR code
- 卡住：無

## 2026-11-19 M10 L-11 我的發票（本機自動對獎）

- 做了：使用者希望發票能自動對獎、主動提醒。評估 Gmail（讀信是 Google 高敏感權限、需安全審查，且多數發票在載具不在信箱）與財政部載具 API（需保存使用者載具驗證碼）都會保存使用者帳號資料，屬 ADR 變更，先做本機版。core：`invoicePeriodOf`、`invoiceDrawDate`、`invoiceCheckMany`；tool `invoice_check_batch`（1–50 張，號碼只比對不保存）。網頁：`public/js/invoice-wallet.js`（localStorage `invoices`，最多 100 張；新增驗證與去重；`checkWallet` 只送需要對的；`autoCheckOnOpen` 打開 App 時開獎日已到自動對獎，中獎 toast＋已允許時系統通知）；服務頁發票卡片下方「我的發票」。問阿幫：示範總結與 life 規則主動提議存到「我的發票」，不向使用者要載具、Email 或密碼。SW v0.4.5
- 測試：npm test 245 項全過（新增批次對獎 1 項、`test/invoice-wallet.test.js` 4 項）；npm run e2e 25 項全過（新增：存起來立刻對獎、待開獎顯示開獎日、只存本機、打開 App 自動對獎並通知中獎；截圖已檢查）
- 文件：MCP_TOOLS.md、UX.md §6、AGENT.md、PLAN.md（L-11）、PROGRESS.md
- 下一個：掃發票 QR code 自動填號碼（相機，`BarcodeDetector` 支援時）；股市行情（TWSE OpenAPI）
- 卡住：無

## 2026-11-19 地端模型提速：回給模型的工具結果精簡

- 做了：量測地端模型（qwen3:8b）發現兩個問題：① 藥局清單 20 筆全回給模型，模型照抄成長篇回答（30–70 秒）；② 「這期發票號碼是多少」模型把「這期」放進 `number`，工具報錯、回答錯誤。`core/agent/model-loop.js` 新增 `modelText`：有卡片的工具清單最多 6 筆、前面加 `speak`、註明完整清單已用卡片顯示、不要逐條列出（沒有卡片的工具照原文）。`invoice_lottery` 的 `number` 沒有任何數字時視為沒給，描述改為「只查中獎號碼時不要給」。
- 量測（同 4 題，真實開放資料）：油價＋大同區藥局 66.9→23.2 秒（回答 968→143 字）；大安區藥局 34.9→6.8 秒（561→107 字）；發票 12.1 秒錯誤回答 → 7.0 秒正確列出特別獎、特獎、頭獎；行程 7.2→12.7 秒（本次未改，屬模型波動）
- 測試：npm test 240 項全過（新增 modelText、發票非數字參數 2 項）；npm run e2e 24 項全過
- 文件：AGENT.md §4、MCP_TOOLS.md、PROGRESS.md
- 下一個：等使用者決定
- 卡住：無

## 2026-11-19 M10 L-10 空品進決策引擎

- 做了：`core/decide.js` 新增狀態 `badAir`（空品不佳：`exposure` ×3、`effort` ×2），比較項目 `exposure` 標籤改「戶外」，理由句在空品不佳且沒下雨時說「少待在戶外」。`plan_trip` 同時查起點空品（`svc.life.aqiNearby`，失敗不影響規劃），最近測站 AQI > 100 自動加「空品不佳」（detail 帶測站與 AQI），輸出 `air`。卡片契約 states 加 `badAir`、`air`；決策圖 空品 → 空品不佳、勝出關鍵「戶外」在空品不佳時連到空品。示範模式行程第二段多查 `aqi_nearby`；「空氣很差」→ badAir。示範情境 `DEMO_AIR=bad`。
- 測試：npm test 238 項全過（新增 decide 空品、planTrip 空品自動狀態／正常／查不到、OD 市區短程＋空品不佳、意圖關鍵字）；npm run e2e 24 項全過；示範伺服器 `DEMO_AIR=bad` 實測：西門町→101 自動「空品不佳」、選叫車、理由「因為空氣品質不佳…少待在戶外」，決策圖畫出 空品 → 空品不佳
- 文件：ADR-0010（狀態與權重紀錄）、MCP_TOOLS.md、CARDS.md、UX.md、AGENT.md、TESTING.md、README、.env.example、PLAN.md（L-10）
- 下一個：地端模型提速（給模型的工具結果精簡）
- 卡住：無

## 2026-11-19 UI 標示真實／示範資料

- 做了：使用者看不出哪些是真實資料。`core/index.js` 加 `dataSources(svc)`（交通、天氣、空氣品質、地震、藥局等開放資料、防詐各自 live／demo；不含金鑰或環境變數名稱），`/api/v1/status` 回 `sources`。首頁橫幅依來源說明（原本只看 TDX，誤說「全部模擬」）：部分示範時列出示範的類別；首頁格子加 `source`，示範資料的格子標「示範」；卡片角落 live 標「真實資料」、demo 標「示範資料」；問阿幫討論串的工具回報用示範資料時標「示範資料」。SW v0.4.3
- 測試：npm test 235 項全過（新增 dataSources 1 項）；npm run e2e 24 項全過（示範伺服器每個格子都標「示範」；卡片 live／demo 標籤）；本機混合模式（開放資料真實、交通與需金鑰的示範）截圖確認
- 文件：CARDS.md、PROGRESS.md
- 下一個：等使用者決定
- 卡住：無

## 2026-11-19 修正：「提醒我出門」以台灣時間判斷、E2E 不再跨午夜失敗

- 做了：PR #6 的 CI 在 UTC 23:49 跑時 E2E 失敗（測試用「現在＋30 分」當出門時間，跨過午夜變成 00:19，提醒按鈕不出現）。行程卡抽出 `canRemind(leaveAt, date, now)`，日期與時間一律用台灣時間比較（原本時間用裝置時區、日期用台灣時間，裝置不在台灣時區會判錯）；E2E 以 `page.clock.setFixedTime` 固定在台灣上午 10 點。SW v0.4.2
- 測試：npm test 234 項全過（新增 `test/cards-trip.test.js` 3 項：今天／1 分鐘內／已過／明天、UTC 與台灣日期不同、台灣深夜跨午夜）；npm run e2e 24 項全過
- 文件：PROGRESS.md
- 下一個：等使用者決定
- 卡住：GitHub Pages 需在 repo 設定開啟（Source：GitHub Actions）

## 2026-11-19 M10 L-09 問阿幫接上生活服務

- 做了：`core/agents/life.json` v2：packs 加 `life`、工具加 `aqi_nearby`、`earthquake_recent`、`pharmacy_search`、`garbage_truck_nearby`、`fuel_price`、`invoice_lottery`；persona 與規則改為交通＋生活（座標類先 `find_place`、藥局用地區、範圍外問題說明能幫什麼）；建議問題加「大安區有哪些健保藥局？」「這期發票號碼是多少？」。`prompt.js` 加生活工具包護欄（數字以工具為準、不預測地震、藥局與發票以公告為準）。示範模式 `demo-intent.js` 加 7 種意圖（天氣、空品、地震、藥局、垃圾車、油價、發票），座標類共用 NEARBY 表與裝置定位；沒說地點／地區時用示範預設並在總結說明。網頁 @點名加空品、地震、藥局、垃圾車、油價、發票。示範藥局資料補 15 筆臺北市中正區（真實資料片段）。
- 測試：npm test 231 項全過（新增 2 項、調整 3 項）；npm run e2e 24 項全過（建議問題改 8 題，截圖已檢查）；以真實開放資料跑示範規劃：油價、發票、藥局、垃圾車都正確
- 文件：AGENT.md（profile、示範意圖表、定位）、PLAN.md（L-09）、PROGRESS.md、TESTING.md
- 下一個：等使用者決定（M8 產業下一階段；M1 等 TDX）
- 卡住：空品需 `MOENV_API_KEY`、地震需 `CWA_API_KEY`

## 2026-11-19 M10 生活開放資料（首頁格子全部接上）
- 做了：背景 agent 實測 6 種開放資料（網址、金鑰、欄位、樣本）；`#/s/:id` 服務頁；pack `life` 6 個 tools＋7 張卡片（含 `weather_now` 補卡片）；`core/opendata-client.js`；示範片段 `core/data/demo/`（真實資料）；首頁沒有「規劃中」格子了。實測真實資料：油價、發票、藥局（1 萬筆，5.5 秒首次下載）、垃圾車（雙北 3 萬筆）。看截圖修：示範地震類型標錯、垃圾車示範點不在預設位置附近、對獎結果色彩。M8 產業移到下一階段（Austin）
- 測試：npm run lint 無錯誤；npm test 229 項全過（新增 16 項）；npm run e2e 全過（新增首頁 8 格逐一進入）
- 文件：PLAN、MCP_TOOLS、CARDS、DATA_SOURCES §5.2、README、.env.example、CLAUDE、index.html
- 下一個：問阿幫加入生活服務工具（profile 與 persona 調整）；藥局地理編碼、垃圾車其他縣市
- 卡住：空品需 `MOENV_API_KEY`、地震需 `CWA_API_KEY`

## 2026-11-19 M7 阿幫・防詐
- 做了：查證 165 開放資料（停止解析涉詐網站每月約 9.7 萬網域、詐騙闢謠每週；LINE ID 資料集已下架不用）；`AGENT_ANTIFRAUD.md` 規格；零依賴 CSV 解析與 `core/services/antifraud.js`（24 小時快取、更新失敗沿用舊索引、啟動預載；示範片段 `core/data/demo/`）；規則庫 17 條（待專家審核）與 `scam_check_message`／`scam_lookup_url`／`scam_myth_search`／`sms_sender_check`；`scam-risk` 卡片；多 agent 路由（`/api/v1/agent/:id`、`#/agent/:id`、`profile?id=`、首頁防詐格子）；防詐示範意圖；L2 輸出護欄（保證安全的句子整句改寫、guardrail 事件、固定附 165，示範與模型模式都套用）。SW v0.3.6
- 測試：npm run lint 無錯誤；npm test 213 項全過（新增 15 項）；npm run e2e 全過（新增防詐手機＋桌面）；真實 165 資料實測查詢正確
- 文件：AGENT_ANTIFRAUD（新）、MCP_TOOLS、CARDS、AGENT、DATA_SOURCES、README、.env.example、PLAN、CLAUDE、index.html
- 下一個：M8 中小企業概念驗證
- 卡住：規則庫需防詐專家審核；M1 TDX 金鑰

## 2026-11-19 M6 地端部署驗證
- 做了：`docker-compose.yml`（讀 `.env`、地端模型指向主機 Ollama、唯讀、no-new-privileges）；`docker compose up -d --build` 實測：`/healthz` agent=local、網頁 agent 以 qwen3:8b 回答高鐵最早班（約 18 秒、答案正確）、MCP 18 個 tools、卡片資源 404 KB
- 決定：Austin 指示雲端部署、Redis、Lighthouse 留到正式環境階段，先衝刺功能
- 下一個：M7 反詐騙 agent
- 卡住：M1 TDX 金鑰

## 2026-11-18 M6-01、02、04、07 上線準備
- 做了：`Dockerfile`（兩階段、只裝正式依賴、node 使用者、檔案唯讀、HEALTHCHECK）＋`.dockerignore`＋`/healthz`；本機 docker build／run 驗證（發現本機 `core/tools` 等目錄權限 700，COPY 後 node 讀不到 → 映像內統一 `chmod a+rX`）。`server/log.js` 結構化 log（JSON、severity、tenantId、agentId、存取 log 不含 query、錯誤遮金鑰）。無障礙：跳到主要內容、焦點框、`aria-current`、`--off` 對比 3.1 → 5.0、卡片與公車頁播報到站；看截圖發現首頁範例問題白底白字（M5-12 起）→ 已修。`.github/workflows/pages.yml` 發布 docs。SW v0.3.5
- 測試：npm run lint 無錯誤；npm test 198 項全過（新增 7 項）；npm run e2e 21 項全過（新增 2 項）
- 文件：ARCHITECTURE §7／§8、UX §10、README（Docker、/healthz）、TESTING、PLAN、CLAUDE、index.html
- 下一個：M6-03／05 待新依賴同意（Redis、lighthouse）；M6-06 待部署帳號
- 卡住：M1 TDX 金鑰；Pages 需在 repo 設定啟用

## 2026-11-18 M4-04～06、M4-08 MCP Apps 互動卡片
- 做了：新增 devDependency `@modelcontextprotocol/ext-apps` 1.7.5（2.x 需 SDK v2；1.7.x peer 為 v1 → ADR-0006 維持 v1）；`host-mcp-app.js`（callServerTool／sendMessage／updateModelContext／openLink；iframe 沙箱不能 `window.confirm`，L2 確認框與複製連結在卡片下方）；`mcp-app.js` 入口；`scripts/build-cards.js`（`npm run build:cards` → `dist/cards.html`，單檔約 394 KB）；MCP 資源 `ui://abang/cards.html` 與 tool `_meta.ui.resourceUri`（開發時記憶體內打包、正式環境讀 dist）；卡片色彩變數也套到確認框；CI 加 build:cards
- 測試：npm run lint 無錯誤；npm test 191 項全過（新增 4 項）；npm run e2e 19 項全過（新增 AppBridge 經 `/mcp` 載入 7 種卡片、updateModelContext、訂票 → 確認 → openLink；每張卡片截圖已檢查，發現確認框按鈕因色彩變數只在 `.ab-card` 而看不見 → 已修）
- 文件：ADR-0006、CARDS §3／§3.1／§6、TESTING、PLAN、README、CLAUDE、ARCHITECTURE、index.html、CI
- 下一個：M4-09 Claude 實測（Austin：本機 npm start＋cloudflared）；M6 上線準備
- 卡住：M1 TDX 金鑰申請中

## 2026-11-18 M5-05 模型模式（Claude＋地端模型）
- 做了：ADR-0012 三種模式（claude／local／demo，`AGENT_PROVIDER` 或自動選）；`core/agent/claude.js`（`@anthropic-ai/sdk` 串流、prompt cache、effort low）、`local.js`（OpenAI 相容 fetch，Ollama 等，去 `<think>`、可關閉思考）、共用 `model-loop.js`（agent_note、5 輪上限、refusal／截斷、device_location、參數去 null）、`provider.js`；`server/agent.js` 接上每日預算降級與 log（不記內容）；問阿幫頁標示模式與資料去向；plan_trip 自動併入畫面點選的狀態。用地端 qwen3:8b 實玩發現並修正：高鐵／台鐵「下一班」原本回當天第一班 → 工具文字與 speak 只講未開出班次、卡片收起已開出班次；SW 更新會裝進 HTTP 快取的舊檔 → 安裝時 `cache: 'reload'`（v0.3.4）
- 測試：npm run lint 無錯誤；npm test 187 項全過（新增 `test/agent-model.test.js` 等 16 項）；npm run e2e 全過
- 文件：ADR-0012、AGENT §3／§4／§6／§7／§8、ARCHITECTURE、README、.env.example、MCP_TOOLS、CARDS、TESTING、PLAN、CLAUDE、index.html
- 下一個：M5 完成；剩 M4-04／05／06／08（待新依賴 `@modelcontextprotocol/ext-apps` 同意）、M1（TDX 金鑰）
- 卡住：Claude 實機需 `ANTHROPIC_API_KEY`；市區短程權重待決定

## 2026-11-18 M5-13 示範模式建議問題截圖（部分）
- 做了：E2E 逐題點 6 個建議問題（手機＋桌面），檢查討論串、對應卡片（trip／bus-route／youbike／timetable）、行程有決策圖，每題截圖；E2E 伺服器放寬 `AGENT_RPM`。看截圖發現並修正 3 件事：①「明天 8 點前要到左營」在示範資料下全部遲到 → 建議題改 9 點；② 全部遲到時行程卡改說「所有方式都趕不上指定時間…」；③ 高鐵顯示「182 分」（很早出發把 67 分等車算進去）→ 班次制等車最多算 10 分、`leaveAt` 往後延、抵達以實際班次計算（ADR-0010 紀錄；跨城塞車最後一名變叫車）
- 測試：npm run lint 無錯誤；npm test 171 項全過（新增 1 項）；npm run e2e 18 項全過
- 文件：MCP_TOOLS §7、ADR-0010、AGENT、TESTING、PLAN、CLAUDE
- 下一個：無不受阻的任務——M5-05（Claude 模式，待決定 SDK 或 fetch）、M4-04／05／06／08（待新依賴同意）
- 卡住：PR #2 合併、市區短程權重、兩個新依賴決定

## 2026-11-18 M5-12 首頁以問阿幫為入口
- 做了：首頁搜尋框改為「問阿幫」（`#/agent?q=` 自動送出、送出後網址換成 `#/agent`）、3 個範例問題；功能格子與分頁列保留；離線 Demo 版維持公車搜尋；SW v0.3.3
- 測試：npm run lint 無錯誤；npm test 170 項全過；npm run e2e 16 項全過（首頁問題 → bus-route 卡片；公車搜尋改由 `#/bus?q=` 進入）；`npm run build:demo` 正常
- 文件：UX §3、TESTING、PLAN、CLAUDE
- 下一個：M5-13（Playwright 示範 6 個建議問題截圖；Claude 模式 mock 測試待 M5-05）
- 卡住：同前

## 2026-11-18 M5-11 輕量 3D
- 做了：結果卡片與決策圖 `.enter3d` 立體進場（`rotateX(8deg)`＋`translateZ`，依序延遲）；決策圖重算 FLIP 排名翻轉（Web Animations、最多 3 個）；`lite()`（`hardwareConcurrency ≤ 4` 或 reduced motion）→ `html.lite-motion` 只淡入；SW v0.3.2
- 測試：npm run lint 無錯誤；npm test 170 項全過；npm run e2e 16 項全過（新增完整動態模式：3D 進場與翻轉；reduced motion 模式不翻轉）
- 文件：UX §9、TESTING、PLAN、CLAUDE
- 下一個：M5-12（首頁以 agent 為主要入口）
- 卡住：同前

## 2026-11-18 M5-10 結論卡行動
- 做了：trip 卡（M4-02 已有建議、分段條、備案、導航、叫車、訂票）補「提醒我出門」：`plan_trip` 高鐵／台鐵／客運方案帶 `leaveAt`（發車 − 到站時間）；`host-web.remind`（系統通知、需允許、12 小時內）；卡片只對今天且 1 分鐘後的出門時間顯示按鈕，設定後顯示「好，HH:mm 提醒你出門」
- 測試：npm run lint 無錯誤；npm test 170 項全過（trip 測 leaveAt）；npm run e2e 14 項全過（假 host 驗證提醒）
- 文件：MCP_TOOLS Option、CARDS host、TESTING、PLAN、CLAUDE
- 下一個：M5-11（輕量 3D 與排名翻轉）
- 卡住：同前

## 2026-11-18 M5-09 決策圖
- 做了：`public/ui/agent/decision-graph.js`（資料 → 你的狀態 → 方案 → 建議四欄 SVG；自動狀態虛線連回天氣／路況；連線粗細＝分數；排除方案灰階刪除線；勝出路徑與關鍵資料來源亮起；狀態 chips 切換／加選即時以同一份 `decide.js` 重算，關掉自動狀態時理由句加「不考慮『…』的話」；明細長條標示前兩項；SVG `title`／`desc` 文字替代）；伺服器白名單提供 `/core/decide.js`；`plan_trip`／`decision` 帶 `arriveBy`／`arriveByMin`；CSS 分段動畫、reduced motion 直接顯示；SW v0.3.1
- 測試：npm run lint 無錯誤；npm test 170 項全過（新增重算一致性）；npm run e2e 14 項全過（決策圖互動、截圖已檢查）
- 文件：UX §5、TESTING、PLAN、CLAUDE
- 下一個：M5-10（結論卡：建議＋分段條＋備案＋行動）
- 卡住：同前

## 2026-11-18 M5-08 問阿幫頁面
- 做了：`public/js/pages/agent.js`（`#/agent`：使用者泡泡、小幫手討論串 `role=log`／角色色彩頭像／@角色 chip／metrics／討論完成收合與展開、卡片以 `renderCard`、狀態與理由、總結泡泡、建議問題、@ 點名列、裝置定位流程、離線 Demo 版提示）；`public/css/agent.css`；`GET /api/v1/agent/profile`；Service Worker 版本 v0.3.0 並快取新檔
- 測試：npm run lint 無錯誤；npm test 169 項全過；npm run e2e 14 項全過（新增問阿幫流程，手機截圖已檢查）
- 文件：UX、TESTING、README、PLAN、CLAUDE
- 下一個：M5-09（決策圖）
- 卡住：同前

## 2026-11-18 M5-07 裝置端工具（定位）
- 做了：`run.js` 需要位置且客戶端支援時送 `client_tool_call device_location`，`deviceLocation` 只採台灣範圍座標（「你的位置」）；`demo-intent.js` 行程／YouBike／附近公車可用定位座標；`T.point` 座標可帶 `name`；`public/js/agent/client.js`（`runAgent` 讀 NDJSON、執行 client tool、重送；`browserLocation`）
- 測試：npm run lint 無錯誤；npm test 169 項全過（新增 2 項）
- 文件：AGENT §3.4、MCP_TOOLS 共用型別、TESTING、PLAN、CLAUDE
- 下一個：M5-08（網頁 agent 頁面）
- 卡住：同前

## 2026-11-18 M5-06 Agent 端點
- 做了：`server/agent.js` `createAgentHandler`（先驗證、NDJSON 串流 `runDemo`、例外以 `error`＋`done` 結束；限流每分鐘／每日 key＝agent id＋IP；每日計量 requests／toolCalls／modelCalls；log 不記對話與座標）；`server/http.js` 掛上 `POST /api/v1/agent`（無 CORS、405、429 帶 retry-after）；OpenAPI 加 `/api/v1/agent`
- 測試：npm run lint 無錯誤；npm test 167 項全過（新增 3 項）
- 文件：AGENT §6、ARCHITECTURE、README、TESTING、PLAN、CLAUDE
- 下一個：M5-08（網頁 agent 頁面；M5-05 Claude 模式待決定 SDK／fetch，M5-07 client tools 可並行）
- 卡住：同前

## 2026-11-18 M5-04 Agent 共用執行器
- 做了：`core/agent/run.js`：`validateRequest`、`execTools`（平行、先 start 後依完成順序 result、plan_trip 後 decision、profile 白名單、錯誤經 publicMessage）、`runDemo`（示範模式完整事件流；picked 狀態帶進 plan_trip 並在 decision 標 `picked`）
- 測試：npm run lint 無錯誤；npm test 164 項全過（新增 5 項）
- 文件：AGENT §3.3、TESTING、PLAN、CLAUDE
- 下一個：M5-06（`POST /api/v1/agent` NDJSON；M5-05 Claude 模式待決定 SDK 或 fetch）
- 卡住：同前

## 2026-11-18 M5-03 示範模式意圖
- 做了：`core/agent/demo-intent.js`：`placesInText`（內建地標名稱／別名，長的優先、車站短名）、`arriveByOf`、狀態關鍵字、`parseIntent`（trip、bus_route、youbike、nearby_bus、metro、rail、unknown）、`demoSteps`（分段計畫，`agent_note` 以 @角色開頭）、`demoSummary`
- 測試：npm run lint 無錯誤；npm test 159 項全過（新增 6 項；profile 的 6 個建議問題都能以示範資料完整執行）
- 文件：AGENT §5、TESTING、PLAN、CLAUDE
- 下一個：M5-04（共用執行器 run.js）
- 卡住：同前

## 2026-11-18 M5-02 Agent 事件
- 做了：`core/agent/events.js`（11 種事件的建立函式、registry 帶入 title／role／pack／tier、`tool_result` 帶卡片 payload 與 metrics、`decision` 由 plan_trip 資料組成、`toNdjson`、`mergeStates`、`TOOL_ROLES`）；AGENT.md 狀態來源 `said` 統一為 `user`（與 plan_trip／CARDS 一致）
- 測試：npm run lint 無錯誤；npm test 153 項全過（新增 4 項）
- 文件：AGENT §3.1／§3.2、TESTING、PLAN、CLAUDE
- 下一個：M5-03（示範模式意圖）
- 卡住：同前（PR #2 合併、權重、新依賴）

## 2026-11-18 M5-01 Agent profile 與 system prompt
- 做了：`core/agents/life.json`（加 `version`、`persona`、`rules`，建議問題 6 個）；`core/agents/index.js`（zod `.strict()` 驗證、tools 必須在 registry、pack 必須列在 packs、不可重複）；`core/agent/prompt.js`（平台政策 → 工具包護欄 → 角色 → 情境；工具結果與情境只當資料）。新分支 `dev/m5`（疊在 `dev/m4`）
- 測試：npm run lint 無錯誤；npm test 149 項全過（新增 3 項）
- 文件：AGENT §1／§4、ARCHITECTURE、TESTING、PLAN、CLAUDE
- 下一個：M5-02（事件）
- 卡住：M4-04 起新依賴；M5-05 Claude 模式需決定用 `@anthropic-ai/sdk` 或 fetch（新依賴待同意）

## 2026-11-18 M4-07 卡片動態
- 做了：`public/ui/cards/countdown.js`（`etaLabel` 與伺服器 `busStatusText` 同規則；`startCountdown` 每秒依重畫後經過時間遞減 `[data-eta-sec]`、跨門檻換 `soon`、數字變化 `.ab-tick` 提示；reduced motion 只換文字）；bus-route／bus-station 加 `data-eta-sec`（只限正常營運狀態）；公車車牌標記 `.ab-bus`
- 測試：npm run lint 無錯誤；npm test 146 項全過（新增 2 項）；npm run e2e 12 項全過
- 文件：CARDS §1.1、TESTING、PLAN、CLAUDE
- 下一個：M4-04 `host-mcp-app.js`（⛔ 需新增依賴 `@modelcontextprotocol/ext-apps`，等 Austin 同意）；M4-05／06／08 都依賴它
- 卡住：新依賴待同意

## 2026-11-18 M4-02 卡片渲染
- 做了：`public/ui/cards/` 7 種卡片（bus-route 方向切換與點站牌、bus-station、nearby 卡片內展開到站、youbike 借／還排序、metro、timetable 塞車延誤／隔日／排除／訂票、trip 建議＋分段條＋備案＋排除＋狀態 chips）；`index.js` 外框與刷新；`dom.js`（不用 innerHTML、https 白名單）；`actions.js`；`cards.css`（淺色）；`host-web.js`（M4-04 的網頁 host，無新依賴）；`preview.html`；`thsr_timetable`／`tra_timetable` 補 `system`（卡片標題與訂票依它判斷）
- 測試：npm run lint 無錯誤；npm test 144 項全過；npm run e2e 12 項全過（新增卡片預覽，手機＋桌面截圖已檢查）
- 文件：CARDS §1.1、ARCHITECTURE、MCP_TOOLS、TESTING、PLAN、CLAUDE
- 下一個：M4-04 `host-mcp-app.js`（需新增依賴 `@modelcontextprotocol/ext-apps`，停下等 Austin）
- 卡住：新依賴待同意

## 2026-11-18 M4-03 卡片文字字典
- 做了：`public/ui/cards/i18n/zh-TW.js`：`t(key, vars)`、`MESSAGES`（共通、L2 確認視窗、bus-route、bus-station、nearby、youbike、metro、timetable、trip）
- 測試：npm run lint 無錯誤；npm test 144 項全過（新增 3 項）
- 文件：CARDS §1、TESTING、PLAN、CLAUDE
- 下一個：M4-02（卡片渲染）
- 卡住：M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`（待 Austin）

## 2026-11-18 M4-01 卡片資料契約
- 做了：`public/ui/cards/schema/` 7 種契約（bus-route、bus-station、nearby、youbike、metro、timetable、trip；JSON Schema 2020-12 子集）＋零依賴驗證器 `validate.js`；`bus_nearby_stations`、`youbike_nearby`、`bus_station_eta` 的 `data` 改物件（`stations`／`arrivals`＋查詢參數）；`callTool` 回 `v`（有卡片時）與 `args`，MCP `structuredContent` 帶 `v`／`tool`／`args`；OpenAPI 更新。新分支 `dev/m4`（疊在 PR #2 上）
- 測試：npm run lint 無錯誤；npm test 141 項全過（新增 14 項 cards-schema）；npm run e2e 10 項全過
- 文件：CARDS §4／§6、MCP_TOOLS §1／§3／§4、TESTING、PLAN、CLAUDE
- 下一個：M4-03（卡片文字字典）→ M4-02（卡片渲染）
- 卡住：M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`（待 Austin）

## 2026-11-18 M3 里程碑收尾驗收
- 驗收（PLAN M3）：`npm test` 127 項全過 ✅；`plan_trip` 10 組 OD 排序與理由句（`test/trip-od.test.js`）✅；示範模式逐一呼叫 18 個 tools 全部成功 ✅；`GET /api/v1/tools` 列出 18 個（≥ 17）✅；`npm run lint` 無錯誤、`npm run e2e` 10 項全過
- 未完成：M3-12 真實導訂票（⛔ TDX 導訂票權限）；所有 TDX／CWA 真實欄位待 M1
- 文件：PLAN 狀態看板、`docs/index.html`（M3 狀態、tools 表、資料來源、架構）
- 待 Austin：① 授權合併 PR #2；② 無狀態市區短程叫車第一是否調整權重（ADR-0010）；③ M4-04 起需新增依賴 `@modelcontextprotocol/ext-apps`
- 下一個：M4-01（卡片資料契約）

## 2026-11-18 M3-12 導訂票（權限前部分）
- 做了：`core/services/booking.js`（`validateBooking`：車次、張數 1～4、日期今天～28 天、車廂只限高鐵、車站比對；真實版在權限前回 `UserError`「尚未開通」並附官方訂票網站，不呼叫 TDX）、`booking-mock.js`（官方網站首頁、15 分時效、標示示範）；tool `rail_booking_link`（transit、L2、`confirmText`）
- 測試：npm run lint 無錯誤；npm test 127 項全過（新增 4 項；tools 18 個）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§6、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3 里程碑收尾驗收
- 卡住：真實導訂票需 Austin 在 TDX 申請「臺鐵訂票導訂」「高鐵訂票導訂」權限

## 2026-11-18 M3-14 英文名稱保留
- 做了：`util.en`／`enField`（TDX `En` 非空才輸出）；公車 `routeNameEn`／`stopNameEn`／站位 `nameEn`、YouBike `nameEn`（去前綴）、高鐵台鐵車站 `nameEn`、捷運 `nameEn`／`stationEn`／`lineEn`／`destinationEn`、路況路段 `nameEn`
- 測試：npm run lint 無錯誤；npm test 123 項全過（新增 3 項）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §1、TESTING、PLAN、CLAUDE
- 下一個：M3 里程碑收尾驗收（M3-12 ⛔ 需 TDX 導訂票權限）
- 卡住：M3-12 需導訂票權限；無狀態市區短程叫車第一待 Austin 決定

## 2026-11-18 M3-13 計量 metrics
- 做了：`core/metrics.js`（`measure`、`recordFetch`、`countRecords`；`AsyncLocalStorage` 隔開同時進行的請求）；`tdx-client`、`cwa-client` 在快取命中與上游回應時記錄；`callTool` 回傳 `metrics: { calls, cacheHits, cacheHit, scanned, ms }`；MCP 放結果 `_meta['abang/metrics']`；OpenAPI `ToolResult` 加 `metrics`
- 測試：npm run lint 無錯誤；npm test 120 項全過（新增 5 項 metrics）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §1、AGENT §3.1、ARCHITECTURE、TESTING、PLAN、CLAUDE
- 下一個：M3-14（英文名稱 `nameEn`）
- 卡住：無（計量帶 agent id 於 M5）

## 2026-11-18 M3-11 plan_trip 固定 OD 測試
- 做了：`test/trip-od.test.js` 10 組 OD（市區短程無狀態／下雨／想省錢／帶行李＋少走路、1.5 公里、台中下雨、跨城無狀態／塞車／趕時間＋12:00 前到、新竹想省錢），先確認兩次執行結果相同；「想省錢」`cost` 倍數 3 → 5（×3 時市區叫車與公車同分、叫車勝出），記錄於 ADR-0010 並在 `decide.test.js` 加情境
- 測試：npm run lint 無錯誤；npm test 115 項全過（新增 10 項 OD、1 項 decide）
- 文件：ADR-0010（權重調整紀錄）、TESTING、PLAN、CLAUDE
- 下一個：M3-13（metrics）；M3-12 需 TDX 導訂票權限
- 卡住：待 Austin 決定——無狀態時市區短程（1.5～5 公里）叫車排第一是否符合產品預期（ADR-0010 權重調整紀錄）

## 2026-11-18 M3-10 行程規劃 plan_trip
- 做了：`core/services/trip.js` `planTrip()`：起點天氣＋沿途路況 → 自動狀態（下雨、塞車中）；7 種候選方案（步行、YouBike、公車直達、高鐵、台鐵、國道客運、叫車）各自容錯，失敗列 `unavailable`；`decide()` 排序與理由；`stationPoint` 由內建地標對照車站座標。`core/services/bus-direct.js`（`matchDirect` 以站點座標驗方向、`commonRoutes`）＋ `bus.directTrips`（live 與 mock）。tool `plan_trip`（卡片 `trip`，輸出對齊 `CARDS.md`）
- 測試：npm run lint 無錯誤；npm test 104 項全過（新增 9 項 trip、1 項 decide 跨午夜；tools 17 個）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§7（方案門檻與估算表）、CARDS `trip`、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3-11（10 組固定 OD 測試）
- 卡住：無；公車直達、客運、軌道真實欄位待 M1

## 2026-11-18 M3-09 叫車連結
- 做了：`core/providers/ridehail/`（`uber.js` 深層連結：無上車點用 `my_location`、座標 6 位小數、暱稱編碼；`index.js` provider 註冊、`estimateFare` 以臺北市計程車費率＋直線 × 1.3 估區間並標 `estimated`、`createRidehailServices`）；tool `ridehail_link`（pack `ridehail`、L2、`static`，description 要求先確認，回傳 `confirmText` 給 M4 確認視窗）；PR #1 已合併，改在 `dev/m3-2` 開發
- 測試：npm run lint 無錯誤；npm test 93 項全過（新增 4 項 ridehail；tools／REST 數量改 16、packs 加 ridehail）；npm run e2e 10 項全過
- 文件：MCP_TOOLS §2／§6、ARCHITECTURE、TESTING、README、PLAN、CLAUDE
- 下一個：M3-10（`plan_trip`）
- 卡住：無

## 2026-11-18 M3-QA 品質基礎與 review 修正
- 做了：Playwright E2E（`scripts/e2e.js`，手機＋桌面 5 個流程、截圖、每個 context try/finally 關閉）；Swagger（`server/rest.js` 路由表、`server/openapi.js` 產生 OpenAPI 3.1、`/api/docs` Swagger UI 白名單）；ESLint（`eslint.config.js`）；CI 加 `npm run lint` 與 E2E（截圖上傳 artifact）。review 修正：`weather_now` 的 `rainMm1h` 改取雨量站 `O-A0002-001` `Past1hr`（氣象站 `Now.Precipitation` 是當日累積）、新增 `rainStation`；`intercity` ISO 出發用該日星期、深夜列出 3 小時內隔日班次 `nextDay`；REST／MCP 非 `UserError` 只回通用訊息（`publicMessage`）；`/api/docs/constructor` 不再 502 洩漏路徑；`traffic_status` 改 `from`／`to` 名稱＋`fromPoint`／`toPoint`；`zh`／`arr`／`odataStr` 移到 `util.js`；路況 `congestionOf()`、`shapesOf()` 快取
- 測試：npm run lint 無錯誤；npm test 89 項全過（新增 errors、OpenAPI、weather 雨量站與同名鄉鎮、intercity 隔日／跨午夜／ISO、metro 轉乘站代碼、413 與錯誤 CORS）；npm run e2e 10 項全過
- 文件：LOOP（每輪 lint → test → e2e → /code-review → /security-review → push PR 分支）、TESTING、CLAUDE、README、ARCHITECTURE、MCP_TOOLS、DATA_SOURCES、PLAN
- 審查：code-review、security-review、agy 獨立審查結果貼在 PR #1
- 下一個：M3-09（`ridehail_link`）
- 卡住：無

## 2026-11-18 M3-08 現在天氣
- 做了：`core/cwa-client.js`（授權碼只在請求網址、快取鍵不含）；`core/services/weather.js`（自動站＋局屬站取最近有資料者、`-99` 視為無資料、鄉鎮 3 小時降雨機率、`isRaining`）＋ `weather-mock.js`（clear／rain）；tool `weather_now`（pack `weather`）；`defineTool` 加 `modeOf`／`demoNote`，天氣的 live／demo 只看 `CWA_API_KEY`；`loadEnv` 讀 `CWA_API_KEY`、`DEMO_WEATHER`
- 測試：npm test 75 項全過（新增 6 項 weather；tools 15 個、packs transit＋weather）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §1／§2／§7、DATA_SOURCES §3、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-09（`ridehail_link`）
- 卡住：真實天氣需 Austin 申請 CWA 授權碼（已列 Austin 待辦）；欄位待驗證

## 2026-11-17 M3-07 國道客運班次
- 做了：`core/services/intercity.js`（站牌 1.5 km 配對與方向、`ServiceDay`、站序備援、沒有下車時間時估算、跨日、路況延誤 `arriveWithDelay`、`delayRisk`）＋ `intercity-mock.js`；tool `intercity_bus`（卡片 `timetable`）；`util.nowTW／toMin／toHHMM`；`T.point` 共用（traffic 也改用）
- 測試：npm test 69 項全過（新增 6 項 intercity；tools／mcp 數量改為 14）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§7、CARDS `timetable`、DATA_SOURCES、ARCHITECTURE、TESTING、README、PRD、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-08（`weather_now`；真實資料需 CWA 授權碼，先做 mock 與介面）
- 卡住：無；客運端點欄位待 M1 驗證，票價端點未確認

## 2026-11-17 M3-06 沿途國道路況
- 做了：`core/services/traffic.js`（路段形狀走廊＋方向判斷、依行進順序、`summarize`：壅塞累計 5 km 即 jam、延誤只計慢路段、沒資料回 null）＋ `traffic-mock.js`（smooth／jam）；tool `traffic_status`（地名或座標，`core/tools/traffic.js`）；`places.resolvePoint` 供 plan_trip 共用；`createServices({ demo })` 與 `DEMO_TRAFFIC` 接上
- 測試：npm test 63 項全過（新增 6 項 traffic；tools／mcp 數量改為 13）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§7、DATA_SOURCES、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 另：程式推上 GitHub，`main`＝初始匯入，M3 在 `dev/m3`，PR #1
- 下一個：M3-07（`intercity_bus`）
- 卡住：無；國道路況端點與欄位待 M1 驗證

## 2026-11-17 M3-05 高鐵／台鐵票價
- 做了：`rail.thsrFare`、`rail.traFare`（`normFares`：票種、身分、車廂代碼轉中文，成人單程在前，未知代碼顯示「代碼 N」，無效價格略過；台鐵 v3 依車種展開）＋示範版（依站距估算）；tool `rail_fare`
- 測試：npm test 57 項全過（新增 3 項；tools／mcp 數量改為 12）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§5、DATA_SOURCES、README、PRD、TESTING、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-06（`traffic_status`）
- 卡住：無；票價代碼對照與台鐵車種代碼待 M1 驗證

## 2026-11-17 M3-04 捷運車站與即時到站
- 做了：`core/services/metro.js`（四系統、同名多線合併、看板依分鐘排序、目的地備援 `TripHeadSign`）＋ `metro-mock.js`（真實站名、近似座標、模擬每 6 分一班）；tools `metro_stations`、`metro_live_board`（卡片 `metro`、附 `nav`），放在 `core/tools/metro.js`；`createServices` 改為 transit 與 metro 共用同一個 TDX client
- 測試：npm test 54 項全過（新增 6 項 metro；tools／mcp 數量改為 11）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §2／§5、CARDS `metro`、DATA_SOURCES、ARCHITECTURE、TESTING、README、PLAN（M1 待驗證表）、CLAUDE
- 下一個：M3-05（`rail_fare`）
- 卡住：無；捷運看板欄位待 M1 驗證

## 2026-11-17 M3-03 內建地標與 find_place
- 做了：`core/data/landmarks.json` 201 筆（車站、機場、景點、夜市商圈、學校、醫院、機關，涵蓋本島與離島各縣市）；`core/services/places.js`（`normPlace` 不省略「站」、分數排序、縣市篩選）；tool `find_place`（附 `nav`）；`defineTool` 新增選填 `source`／`static`，MCP 依 tool 標示資料來源、內建資料不加示範提示
- 測試：npm test 48 項全過（新增 8 項 places；tools／mcp 數量改為 9）；`npm run build:demo` 正常
- 文件：MCP_TOOLS §1／§2／§7、DATA_SOURCES §5、ARCHITECTURE、TESTING、README、PLAN（Austin 待辦加座標校對）、CLAUDE
- 下一個：M3-04（捷運 `metro_stations`、`metro_live_board`）
- 卡住：無；地標座標是近似值待 Austin 校對（`verified: false`）；外部地理編碼待 M1

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
