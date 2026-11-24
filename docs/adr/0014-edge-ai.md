# ADR-0014：裝置端 AI（Edge AI）：手機上判斷意圖與狀態

狀態：已採用（2026-11-21，Austin：「edge ai 盡量開發，ios 需要用 apple intelligence」「pixel 手機應可以使用 edge ai」）

## 背景
判斷層（`core/agent/judge.js`，2026-11-20）在伺服器上判斷「使用者想做什麼（意圖）」與「使用者狀態（趕時間、帶行李…）」：A 嵌入分類器＋B 地端模型＋規則。
正式環境預計用 Claude 回答，伺服器不一定有地端模型（B），只剩 A＋規則（評測全對 77.9%）。
手機已內建系統模型：iOS 的 Apple Intelligence（Foundation Models）、Android 的 Gemini Nano（AICore／ML Kit GenAI）。不用下載到 App、不花伺服器成本、不經網路。

## 決策
1. **手機先判斷、伺服器採用（提示，不是指令）**：App 在送出問題前呼叫專案內的 Capacitor 外掛 `AbangEdgeAI`（`judge`），把結果以 `deviceJudge: { intent, states, engine }` 跟著 `/api/v1/agent` 請求送出。
   - iOS：`ios/App/App/AbangEdgeAIPlugin.swift`，Foundation Models，`@Generable` 結構化輸出（意圖用 `.anyOf` 限定），`GenerationOptions(sampling: .greedy)`；每題新的 session，先 `prewarm()` 一個備用。
   - Android：`android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java`，ML Kit GenAI Prompt API（`com.google.mlkit:genai-prompt:1.0.0-beta5`），溫度 0、要求只回 JSON；模型由系統 AICore 管理（多個 App 共用），可下載時背景下載。
   - 指示詞在 `public/js/edge-judge.js`（`EDGE_INSTRUCTIONS`，判斷層提示詞的精簡版），兩個平台共用。
2. **信任邊界**：`deviceJudge` 由使用者的裝置送來，視同使用者輸入。伺服器用 zod 只收列舉值（15 種意圖、6 種狀態、引擎 `apple`／`gemini-nano`），不合就整個請求 400。它只影響這位使用者自己的意圖與狀態判斷：**方案排序仍由 `decide.js` 計分（ADR-0010）**、數字只來自工具資料、L2 行動仍要確認（ADR-0011）；不能指定工具、不能跳過護欄。
3. **怎麼組合**（`createJudge`）：
   - 伺服器**沒有**自己的模型（B）時，裝置結果當 B：意圖＝A 有把握（≥ 0.8）用 A，否則用裝置；狀態＝規則 ∪（A ∩ 裝置）。伺服器連 A 都沒有（`JUDGE=off` 或模型還在載入）時：意圖用裝置、狀態只看規則（A ∩ 裝置為空；裝置狀態單獨不夠準）。
   - 地端模型模式下，裝置判斷與伺服器 B 一樣可讓伺服器依意圖縮小給模型的工具（`INTENT_TOOLS`，伺服器自己的對照表，仍在 profile 白名單內）；裝置不能指定工具名稱。
   - 伺服器**有** B 時，完整判斷仍用 B（評測較準），裝置結果只用在快速版（先說聽懂了什麼）。
4. **降級與斷路器**：上一題原生端還沒跑完就不呼叫（不排隊，晚到的結果丟掉）；外掛回不可用就這次開 App 不再試；Android 遇到配額或背景被擋暫停 10 分鐘。網頁版、iOS 26 以下、機型不支援、沒開 Apple Intelligence、模型下載中、語言不支援、外掛錯誤、超過 1.8 秒（`EDGE_TIMEOUT_MS`；Android 原生端 1.5 秒取消）→ 不帶 `deviceJudge`，伺服器照原本的判斷層。使用者看不出差別。不提高 App 最低版本（iOS 15、Android API 24；外掛在 iOS 26／API 26 以下直接回不可用）。
5. **隱私**：只送意圖、狀態、引擎三個欄位（2026-11-22 ADR-0020 加上手機提議的一題 `ask`：種類、題目、短答選項；出題用的情境只給手機上的模型看，不送伺服器）（使用者的句子本來就會送伺服器回答）；外掛只記耗時與錯誤類型，不記句子。使用者可關閉（`localStorage abang.edgeAI = off`，設定畫面 E8 再做）。
6. **看得到**：status 事件的 `judge` 帶 `source: 'device'`、`engine`；問阿幫那一輪的回答上方寫一行「阿幫先在手機上用 Apple Intelligence／Gemini Nano 聽懂你要做什麼」；伺服器沒採用時寫「手機上的 … 先聽了一遍；這一輪以伺服器的判斷為準」（2026-11-21 改：原本放在頁底模式說明，與回答上方重複，英文提問時還是中文）；地端模型模式下裝置判斷與伺服器 B 一樣可縮小給模型的工具（`INTENT_TOOLS`）；伺服器 log 記 `judge` 來源（不含內容），作為計量。
7. **讓使用者看得到模型（2026-11-21）**：「阿幫的腦袋」頁（`#/ai`，UX.md §5.0.1；入口在設定頁的裝置端 AI 區塊）顯示手機上的模型資訊、現場試判斷、資料怎麼走。外掛 `status()` 多回系統查得到的欄位，**查不到就不回傳、畫面就不顯示，不編造版本或參數**：
   - Android（ML Kit GenAI Prompt API）：`featureStatus`（available／downloadable／downloading／unavailable）、`modelName`（`getBaseModelName()`）、`tokenLimit`（`getTokenLimit()`）、下載中的 `downloadTotalBytes`／`downloadedBytes`（`DownloadCallback`）、`aicoreVersion`（AICore 套件版本；manifest 加 `<queries>`）、`osVersion`、`device`。ML Kit 不回報支援語言與模型大小，所以不顯示。
   - iOS（Foundation Models）：`availability`（available／deviceNotEligible／appleIntelligenceNotEnabled／modelNotReady）、`languages`（`supportedLanguages`）、`contextSize`、`osVersion`。系統不回報模型名稱與版本，所以不顯示。
   - `judge()` 多回 `ms`（模型花多久）；JS 只在本機記「今天判斷幾次、上次花多久」（`localStorage abang.edgeStats`，只有數字），不上傳。`deviceJudge` 仍然只有意圖、狀態、引擎三個欄位。
8. **猜下一句（2026-11-21，AGENT.md §5.5）**：外掛多一個 `suggest({ context, instructions, lang, max })`，手機上的模型依只在手機上組的情境（不含座標）猜使用者接下來想問的 3～4 句；句子一律送伺服器用規則驗證查得到才顯示（只送句子），排序由程式計分，不可用或逾時 1.5 秒改用規則；設定可單獨關閉（`localStorage abang.edgeSuggest = off`）。judge 優先：送出問題時先 `cancelSuggest()`（原生端取消 future／Task），Android 的 suggest 用自己的執行緒，judge 不排在後面；驗證端點只記句數、不記句子。取消建議後 3 秒內的忙碌類錯誤（BUSY／CANCELLED、取消中、限流、同時有請求）不觸發 Android 的 10 分鐘暫停、也不跳 JS 斷路器，這一題交給伺服器判斷。與 ADR-0017 的 `write()` 共用同一個外掛、斷路器與優先順序（judge ＞ write ＞ suggest；write 開始前也先取消 suggest、寫的時候與判斷的時候不猜）；suggest 失敗或不可用只停 suggest、原生端不暫停，不影響 judge／write。模型猜的句子一律擋掉網址、帳號、加好友、匯款、座標等誘導內容（伺服器與手機都擋）。另一分支的 `write()`（手機上寫回答）合進主線後，兩者共用同一個外掛與斷路器，可再整併。

### 錯誤碼與處理（2026-11-22，Pixel smoke：App 不在前景時 suggest 失敗）
ML Kit GenAI（`genai-common 1.0.0-beta5`，`GenAiException.ErrorCode`，javap 確認）與 Foundation Models 的錯誤，原生端回給 JS 的原因與處理：

| 平台 | 錯誤 | 原生端回 | 10 分鐘暫停（Android） | JS 斷路器 | 這一題 |
|---|---|---|---|---|---|
| Android | `BACKGROUND_USE_BLOCKED`（30）：App 不在前景、螢幕關著 | `background` | 不設 | 不跳 | judge→伺服器判斷、write→程式版、suggest→規則（不停掉 suggest） |
| Android | `PER_APP_BATTERY_USE_QUOTA_EXCEEDED`（27）：電量配額 | `battery-quota` | 不設 | 不跳 | 同上 |
| Android | `BUSY`（9）、`CANCELLED`（7），取消建議後 3 秒內 | `busy` | 不設 | 不跳 | 同上 |
| Android | 其他 `GenAiException`（例：`NOT_AVAILABLE` 8、其他配額） | `judge failed`／`write failed` | 設 | 不跳（不是 unavailable） | 同上，10 分鐘內原生端回 `unavailable` |
| iOS | App 不在前景（`UIApplication.applicationState != .active`）：不呼叫模型；呼叫中轉到背景的錯誤（含 `rateLimited`） | `background` | — | 不跳 | 同上 |
| iOS | 取消建議後 3 秒內的 `rateLimited`、同時有請求、取消中 | `busy` | — | 不跳 | 同上 |
| 兩者 | 機型不支援、沒開 Apple Intelligence、模型沒準備好、系統版本太舊 | `unavailable: <原因>` | — | 跳（這次開 App 不再用） | 同上 |

JS（`public/js/edge-judge.js`）另外在 `document.visibilityState !== 'visible'` 時不呼叫 judge、write、suggest、prewarm（`edgeForeground`／`edgeCanRun`），直接走伺服器或規則，回到前景照常。最近一次沒用上的原因（`hidden`／`background`／`battery-quota`，`edgeIssue`，一分鐘內）給「阿幫的腦袋」試判斷第 1 段與寫回答那一行照實說（字典 `trial.why.*`、`rw.*`，中英文）。

## 評測（`scripts/eval-edge.js` 實機、`scripts/eval-edge-combo.js` 組合；`docs/research/edge-eval.md`）
同一份 172 題評估集：Pixel 11 Pro XL 上的 Gemini Nano 單獨意圖 90.1%、全對 85.5%，延遲 p50 約 270 ms；與 A＋規則組合後全對 89.0%、驗收集 88.4%（A＋規則 77.9%；伺服器 A＋qwen3:8b 89.5%、驗收集 88.4%）。兩者相當，之後若實機數據穩定，可改成「有裝置結果就不呼叫伺服器模型」省成本。iOS 模擬器（Mac 的 Apple Intelligence）第一題冷啟動約 5 秒、超過逾時，實機數據待 iPhone 15 Pro 以上。

## E3 手機上的小模型（2026-11-23，Austin：「可以，做 E3」）
手機內建的模型不能用時（不支援的機型、沒開 Apple Intelligence、iOS 26 以下、Gemini Nano 逾時或上一題還在跑），由 App 裡的 transformers.js＋multilingual-e5-small 判斷意圖與狀態。它就是伺服器判斷層的 A（嵌入分類器），同一個模型、同一份分類器參數。
- **使用者按下載才下載**：設定頁「手機上的小模型（備援）」顯示概數約 160 MB，下載時依伺服器回報的大小顯示進度；實際 162 MB（.onnx 118 MB、詞表 17 MB、執行環境 .wasm 27 MB）。只從阿幫自己的伺服器 `/edge-model/` 下載（白名單 `server/edge-model.js`；串流送出；App 的 WebView 來源才加 CORS），不連 Hugging Face 或 CDN。存在 App 的 IndexedDB（不用 Cache API：iOS 的 capacitor:// 來源不一定有）。之後開 App 只從手機上載入：先檢查快取齊全，也擋掉下載，不會偷偷用行動網路再抓；快取被系統清掉就顯示「請重新下載」。可隨時刪除。只在手機 App 顯示，網頁版不下載。
- **程式在 App 裡、模型從伺服器下載**：`transformers.min.js` 與 onnxruntime 的 `.mjs` 在 App 打包時放進 `dist/app/vendor/`（網頁版由 `/vendor/` 提供）。分類器參數 `core/data/judge-classifier.json`（約 90 KB）由 `scripts/build-edge-classifier.js`（`npm run build:edge-classifier`）從 `judge-train.json` 算出。測試會檢查兩者同步，改了訓練範例要重跑。分類的純函式 `core/judge-classify.js` 由伺服器與手機共用。
- **在 Web Worker 跑**（`public/js/edge-embed-worker.js`），主執行緒不卡。實測每句：iOS 模擬器約 15 毫秒、Pixel 11 Pro XL 30～70 毫秒。從手機上載入：iOS 模擬器約 1 秒、Pixel 約 2 秒，在進問阿幫頁時進行（`edgePrewarm`）。Mac 瀏覽器、iOS 模擬器與 node 算出的意圖、狀態相同，信心只差約 0.02。需要 WebAssembly SIMD（iOS 16.4 以上、Android WebView），不支援就不顯示下載鍵。
- **伺服器怎麼用**：`deviceJudge` 多一種引擎 `e5`，一定要帶信心（0～1）；其他引擎不能帶信心（zod）。小模型不能寫回答（`clientCaps.engine` 仍只收系統模型）。伺服器**沒有**自己的 A（`JUDGE=off`、選用依賴沒裝、模型還在載入）時，小模型的結果就當作 A：信心門檻 0.8、0.5 以下當 unknown、規則優先都照 A 的規則。它不當作 B，狀態不單獨採用。伺服器有 A 就用自己的（同一個模型）。status 的 judge 是 `source: 'embed', engine: 'e5'`。回答上方照實寫「阿幫先在手機上用小模型聽懂你要做什麼」，沒被採用時寫「手機上的小模型先聽了一遍；這一輪以伺服器的判斷為準」。「阿幫的腦袋」的試判斷在系統模型不能用時，第 1 段由小模型判斷（標 multilingual-e5-small）。
- **效益（照實說）**：伺服器有 A 時（Docker 映像預設），手機上的小模型不會讓判斷變準，因為是同一個模型。效益在於：(1) 伺服器可以設 `JUDGE=off`，省下 A 的記憶體與 CPU，判斷品質不變；(2) 沒有內建 AI 的手機也能在「阿幫的腦袋」的試判斷看到手機上的判斷；(3) 之後做離線判斷的基礎。
- 依賴：沒有新增套件（`@huggingface/transformers` 原本就是選用依賴，`onnxruntime-web` 是它帶入的）。

## 不採用
- ~~**在 WebView 跑 transformers.js 分類器**（E3）：模型約 120 MB、手機上首次載入慢；系統模型免下載。保留為之後的第三層備援。~~ 2026-11-23 改為採用，限使用者按下載（見上方「E3 手機上的小模型」）。
- **手機上直接回答**（不經伺服器）：數字一定要來自工具資料、計分要一致（ADR-0010），第一階段只做判斷。手機上轉述（E7）另議。（2026-11-21：手機上轉述改由 ADR-0017「回答也在手機上寫」實作：伺服器照舊查資料與排序，手機把程式版總結改寫成一兩句，程式護欄檢查數字。）
- **讓裝置結果指定工具名稱**：等同讓用戶端決定伺服器執行什麼，信任邊界不清楚（只給意圖，工具範圍由伺服器對照）。

## 影響
- Android 模型下載只在不計流量的網路（Wi-Fi）進行；行動網路時 `status` 回 `needs-wifi`，判斷交給伺服器。
- iOS：FoundationModels 由編譯器自動弱連結（`LC_LOAD_WEAK_DYLIB`，已用 otool 確認），iOS 15～25 不會因找不到 framework 而無法啟動。
- 新增 Android 依賴 `com.google.mlkit:genai-prompt:1.0.0-beta5`（Google ML Kit，帶入 kotlin-stdlib、coroutines、guava listenablefuture；APK 約 +2 MB），`AndroidManifest.xml` 用 `tools:overrideLibrary` 保留 API 24。Gemini Nano 不能在解鎖 bootloader 的手機上使用；AICore 對每個 App 有呼叫配額。
- iOS 新增 `MainViewController`（註冊專案內外掛；`SceneDelegate` 與 storyboard 都改用它）；需要 Xcode 26 以上編譯（`#if canImport(FoundationModels)` 與 `#available(iOS 26, *)` 包住）。
- 卡住：iOS 實機數據要 Austin 提供 iPhone 15 Pro 以上並開啟 Apple Intelligence；Apple Intelligence 的繁體中文在台灣地區的可用性以 `supportsLocale(zh-Hant-TW)` 判斷，不支援就降級。
