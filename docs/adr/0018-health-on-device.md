# ADR-0018：健康資料只在手機、只讀、預設關閉

狀態：已採用（2026-11-22，產品負責人定案：讀步數與運動時間，天氣好又動得少時建議去運動）；實作 `core/health-nudge.js`、`public/js/health.js`、`public/js/health-ui.js`、外掛 `AbangHealth`；測試 `test/health.test.js`、E2E「健康與運動」四項

## 背景
阿幫已經知道天氣、空品與使用者附近有什麼（首頁「現在」、問阿幫）。產品負責人希望在「天氣好、今天又動得少」時建議去走走，例如「天氣好、AQI 35，今天才走 2,100 步；走到大安森林公園約 15 分」。
步數與運動時間是健康資料：比位置更敏感（個資法的特種個資邊緣、Apple／Google 的健康資料政策都要求明確用途、最小範圍、不拿去做別的事）。阿幫的伺服器與模型（ADR-0012）不需要知道使用者走了幾步，判斷只要幾條規則。ADR-0014、ADR-0015 已確立「手機上先處理、只送需要的東西」，這份把它延伸到健康資料，而且更嚴：健康資料**一點都不送**。

## 決策
1. **只在手機上**：步數、運動分鐘，以及由它推出的「動得少」，都不送伺服器、不寫 log、不進 agent 的 `userState`、`deviceJudge` 或 prompt，也不寫進手機的儲存空間（只在記憶體快取 5 分鐘）。手機上只記開關（`abang.health`）與「今天提過沒有」（`abang.healthDay`：日期＋`off`／`agent` 兩個旗標）。
   - 判斷與文案在手機上組：純函式 `core/health-nudge.js`（伺服器以 `/core/health-nudge.js` 提供、App 打包時複製，比照 `core/vision-text.js`；用 `core/nav.js` 的步行時間與官方導航連結）。
   - 天氣、空品用既有 API（首頁「現在」已經查好的 `weather_now`、`aqi_nearby`；問阿幫那一輪的 `weather_now`／`outing_advice`／`aqi_nearby` 結果；只有其中一個時用首頁「現在」10 分鐘內的結果補），**不因為健康狀態多查任何東西**：伺服器從請求看不出使用者動得多或少。
   - 散步地點來自內建地標庫 `core/data/landmarks.json` 的 `walk` 欄位（park 公園、riverside 河濱、trail 步道），整份以同站靜態檔 `/core/landmarks.json` 提供、在手機上找最近的（打開功能時載一次，跟健康狀態無關）。
   - 問阿幫時補的那一句是手機上加的泡泡（`.bubble.health-say`），**不放進對話紀錄**（不會跟下一個問題送出、不存進 `abang.chat`）。
2. **只讀、最小範圍**：Android 只要 Health Connect 的 `READ_STEPS`、`READ_EXERCISE`；iPhone 只讀 HealthKit 的 `stepCount`、`appleExerciseTime`，`toShare` 是空的。外掛回傳正規化資料（每日 `{ date, steps, exerciseMin }`、`source`），不漏資料來源 App、樣本等原始欄位；JS 端再用 `normalizeHealth` 丟掉其他欄位。
3. **預設關閉、使用者自己開**：設定頁（`#/settings`）與「我的」（`#/me`）同一個開關＋隱私說明；**第一次打開時才跳系統權限**，允許由使用者自己按。被拒：開關回到關、說原因、Android 給「到 Health Connect 允許」（只開 Health Connect 的權限頁）；手機沒有 Health Connect、需要更新、iPad 沒有「健康」App、App 沒有 HealthKit entitlement：開關反白（`aria-disabled`、仍可按，按了說原因；比照語音），Android 給「到 Play 商店安裝 Health Connect」。不改任何系統設定。
4. **規則由程式決定**（ADR-0010 精神），門檻是 `core/health-nudge.js` 的常數：
   - 天氣好（`GOOD`）：沒下雨（`raining`、過去 1 小時雨量 > 0 都算下雨）、3 小時降雨機率 < 30%、體感溫度 15～31°C（`weather_now.feelsC`，沒有就用氣溫）、AQI ≤ 100、台灣時間 06:00～19:30；任何一項沒查到就不算好（寧可不推）。
   - 動得少（`MOVE`）：今天步數 < 目標 6,000 × 清醒時段（07:00～22:00）已過比例 × 60%（應有步數不到 600 的一大早不判斷），或近 7 天運動分鐘 < 150 × 有資料的天數比例；今天步數已達 6,000 或近 7 天運動已達 150 分就算達標。
   - 散步地點（`WALK`）：走路 10～25 分、最近的那一個；沒有就只給一句「附近走走 20 分鐘也好」。
   - 一天一次：首頁小卡今天按「今天不用」就到明天；問阿幫一天主動提一次；使用者自己問「要不要去運動」一定回答（天氣不好時說原因）。達標只給一句鼓勵，不推。不推本機通知。
5. **Mock 對等**：網頁版與示範模式用示範健康資料（`demoSummary`，介面與外掛相同；卡片與泡泡標「示範資料，不是你的步數」）。手機 App 裡沒有外掛（舊版）時回 `no-plugin`，不拿示範資料冒充。
6. **外掛 `AbangHealth`**：`status()`、`requestPermission()`、`summary({ days: 7 })`、`openSettings({ target: 'manage'|'install' })`。
   - Android（`AbangHealthPlugin.java`）：`androidx.health.connect:connect-client:1.1.0`（產品負責人同意的新依賴；需要 API 26，App 仍支援 24，外掛在 26 以下回 `os`）；`aggregateGroupByPeriod` 依手機時區每天加總（Health Connect 會去除重複來源）；Kotlin suspend 函式用 `Continuation` 從 Java 呼叫。Manifest：兩個權限、`<queries>` Health Connect、權限說明畫面 `HealthRationaleActivity`（Android 13 以下 `ACTION_SHOW_PERMISSIONS_RATIONALE`、14 以上 `VIEW_PERMISSION_USAGE`＋`HEALTH_PERMISSIONS` 的 activity-alias）。Health Connect 不分「被拒」與「還沒問」：這次執行中被拒過才回 `denied`。
   - iOS（`AbangHealthPlugin.swift`）：`HKStatisticsCollectionQuery` 每天加總；`App.entitlements`（`com.apple.developer.healthkit`）、`NSHealthShareUsageDescription`。iOS 不告訴 App 使用者有沒有允許「讀取」：問過就回 `asked`，讀不到資料時說怎麼到「健康」App 打開。
   - **免費個人開發團隊**：Apple 的免費帳號（Personal Team）可能不能簽 HealthKit capability。`scripts/ios-dev-install.js` 簽章失敗且錯誤提到 HealthKit 時，改用不含 entitlement 的建置（`CODE_SIGN_ENTITLEMENTS=`、`ABANG_HEALTHKIT=NO`）；外掛讀 Info.plist 的 `AbangHealthKit` 回 `no-entitlement`，App 裡開關反白並說原因。正式上架用付費開發者帳號就有 HealthKit。

## 不採用
- **把步數（或「動得少」）當 `userState` 送給 agent、讓模型決定要不要建議**：模型轉述會比較自然，但健康資料會離開手機、進到 Anthropic 的提示；規則本來就很簡單，由手機上的程式決定即可。
- **伺服器端新 tool（例如 `walk_spots`）查附近公園**：只在動得少時才呼叫，伺服器就能從請求推出「這個人今天動得少」。改成手機上讀整份內建地標庫。
- **本機通知推「去走走」**：產品負責人決定不推，只在使用者打開 App 時看得到。
- **也讀心率、睡眠、體重**：用不到；最小範圍。

## 影響
- 新增 Android 依賴 `androidx.health.connect:connect-client:1.1.0`；上架 Google Play 前要在 Play Console 填健康資料權限聲明（Health Connect 權限用途）與資料安全表單。
- iOS 正式版要在 App ID 打開 HealthKit capability（付費帳號）；App Store 審查要求隱私權政策說明健康資料用途（已寫在隱私權政策）。
- `weather_now`、`outing_advice` 多一個 `feelsC`（體感溫度，氣溫＋濕度＋風速，澳洲氣象局公式；氣象站濕度、風速欄位待 M1 驗證，缺資料為 null）。
- 內建地標庫多了 `walk` 欄位與 13 個公園、河濱、步道（座標仍是近似值，待校對）。
- Service worker SHELL 加 `/js/health.js`、`/js/health-ui.js`、`/core/health-nudge.js`、`/core/nav.js`、`/core/landmarks.json`；`scripts/build-app.js` 複製 `core/health-nudge.js`、`core/nav.js`、`core/data/landmarks.json`。
- 實機待確認：Pixel（Health Connect 權限畫面、rationale 畫面、步數與運動分鐘）、iPhone（個人開發團隊能不能簽 HealthKit、權限畫面、讀取）。
