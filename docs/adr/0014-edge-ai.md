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
5. **隱私**：只送意圖、狀態、引擎三個欄位（使用者的句子本來就會送伺服器回答）；外掛只記耗時與錯誤類型，不記句子。使用者可關閉（`localStorage abang.edgeAI = off`，設定畫面 E8 再做）。
6. **看得到**：status 事件的 `judge` 帶 `source: 'device'`、`engine`；問阿幫那一輪的回答上方寫一行「阿幫先在手機上用 Apple Intelligence／Gemini Nano 聽懂你要做什麼」；伺服器沒採用時寫「手機上的 … 先聽了一遍；這一輪以伺服器的判斷為準」（2026-11-21 改：原本放在頁底模式說明，與回答上方重複，英文提問時還是中文）；地端模型模式下裝置判斷與伺服器 B 一樣可縮小給模型的工具（`INTENT_TOOLS`）；伺服器 log 記 `judge` 來源（不含內容），作為計量。
7. **讓使用者看得到模型（2026-11-21）**：「阿幫的腦袋」頁（`#/ai`，UX.md §5.0.1；入口在設定頁的裝置端 AI 區塊）顯示手機上的模型資訊、現場試判斷、資料怎麼走。外掛 `status()` 多回系統查得到的欄位，**查不到就不回傳、畫面就不顯示，不編造版本或參數**：
   - Android（ML Kit GenAI Prompt API）：`featureStatus`（available／downloadable／downloading／unavailable）、`modelName`（`getBaseModelName()`）、`tokenLimit`（`getTokenLimit()`）、下載中的 `downloadTotalBytes`／`downloadedBytes`（`DownloadCallback`）、`aicoreVersion`（AICore 套件版本；manifest 加 `<queries>`）、`osVersion`、`device`。ML Kit 不回報支援語言與模型大小，所以不顯示。
   - iOS（Foundation Models）：`availability`（available／deviceNotEligible／appleIntelligenceNotEnabled／modelNotReady）、`languages`（`supportedLanguages`）、`contextSize`、`osVersion`。系統不回報模型名稱與版本，所以不顯示。
   - `judge()` 多回 `ms`（模型花多久）；JS 只在本機記「今天判斷幾次、上次花多久」（`localStorage abang.edgeStats`，只有數字），不上傳。`deviceJudge` 仍然只有意圖、狀態、引擎三個欄位。
8. **猜下一句（2026-11-21，AGENT.md §5.4）**：外掛多一個 `suggest({ context, instructions, lang, max })`，手機上的模型依只在手機上組的情境（不含座標）猜使用者接下來想問的 3～4 句；句子一律送伺服器用規則驗證查得到才顯示（只送句子），排序由程式計分，不可用或逾時 1.5 秒改用規則；設定可單獨關閉（`localStorage abang.edgeSuggest = off`）。judge 優先：送出問題時先 `cancelSuggest()`（原生端取消 future／Task），Android 的 suggest 用自己的執行緒，judge 不排在後面；驗證端點只記句數、不記句子。取消建議後 3 秒內的忙碌類錯誤（BUSY／CANCELLED、取消中、限流、同時有請求）不觸發 Android 的 10 分鐘暫停、也不跳 JS 斷路器，這一題交給伺服器判斷。另一分支的 `write()`（手機上寫回答）合進主線後，兩者共用同一個外掛與斷路器，可再整併。

## 評測（`scripts/eval-edge.js` 實機、`scripts/eval-edge-combo.js` 組合；`docs/research/edge-eval.md`）
同一份 172 題評估集：Pixel 11 Pro XL 上的 Gemini Nano 單獨意圖 90.1%、全對 85.5%，延遲 p50 約 270 ms；與 A＋規則組合後全對 89.0%、驗收集 88.4%（A＋規則 77.9%；伺服器 A＋qwen3:8b 89.5%、驗收集 88.4%）。兩者相當，之後若實機數據穩定，可改成「有裝置結果就不呼叫伺服器模型」省成本。iOS 模擬器（Mac 的 Apple Intelligence）第一題冷啟動約 5 秒、超過逾時，實機數據待 iPhone 15 Pro 以上。

## 不採用
- **在 WebView 跑 transformers.js 分類器**（E3）：模型約 120 MB、手機上首次載入慢；系統模型免下載。保留為之後的第三層備援。
- **手機上直接回答**（不經伺服器）：數字一定要來自工具資料、計分要一致（ADR-0010），第一階段只做判斷。手機上轉述（E7）另議。
- **讓裝置結果指定工具名稱**：等同讓用戶端決定伺服器執行什麼，信任邊界不清楚（只給意圖，工具範圍由伺服器對照）。

## 影響
- Android 模型下載只在不計流量的網路（Wi-Fi）進行；行動網路時 `status` 回 `needs-wifi`，判斷交給伺服器。
- iOS：FoundationModels 由編譯器自動弱連結（`LC_LOAD_WEAK_DYLIB`，已用 otool 確認），iOS 15～25 不會因找不到 framework 而無法啟動。
- 新增 Android 依賴 `com.google.mlkit:genai-prompt:1.0.0-beta5`（Google ML Kit，帶入 kotlin-stdlib、coroutines、guava listenablefuture；APK 約 +2 MB），`AndroidManifest.xml` 用 `tools:overrideLibrary` 保留 API 24。Gemini Nano 不能在解鎖 bootloader 的手機上使用；AICore 對每個 App 有呼叫配額。
- iOS 新增 `MainViewController`（註冊專案內外掛；`SceneDelegate` 與 storyboard 都改用它）；需要 Xcode 26 以上編譯（`#if canImport(FoundationModels)` 與 `#available(iOS 26, *)` 包住）。
- 卡住：iOS 實機數據要 Austin 提供 iPhone 15 Pro 以上並開啟 Apple Intelligence；Apple Intelligence 的繁體中文在台灣地區的可用性以 `supportsLocale(zh-Hant-TW)` 判斷，不支援就降級。
