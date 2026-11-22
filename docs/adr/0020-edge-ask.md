# ADR-0020：問什麼由手機上的 AI 決定，程式驗證、規則保底

狀態：已採用（2026-11-22，產品負責人：「決定要問什麼應該交給 edge AI，應該有足夠的資訊讓它模擬。現在是 rule base 嗎？」）；部分取代 ADR-0016 第 4 點「問題由程式產生，不交給模型」

## 背景
「阿幫問你」（ADR-0016）要不要問、問什麼、給什麼選項，原本幾乎都是 core 的規則（`demo-intent.js` 的 `needs`、`core/agent/ask.js` 的 `slotAsk`／`originAsk`、`decide.js` 的 `keyQuestion`）。
手機上的模型（Android Gemini Nano、iOS Apple Intelligence，外掛 `AbangEdgeAI`，ADR-0014）本來就會先聽一遍這一句（意圖與狀態），而且手機知道規則看不到的情境（最近兩輪的結果、目前在哪一頁、有沒有定位、設了哪些常用地點、剛問過什麼）。
同一個原則已經用在兩個地方：ADR-0010「模型判斷、程式計分」、PR #112 動態建議「模型提候選、程式驗證」。

## 決策
1. **一次呼叫**：不多一次模型呼叫（延遲要緊）。手機 judge 的輸出從 `{ intent, states }` 擴成 `{ intent, states, ask? }`，`ask = { slot, state?, question, options[2～4] }`。
   - 可以問的種類（`EDGE_ASK_SLOTS`）：`route` 缺公車路線、`to` 缺目的地（只說起點也算）、`from` 沒定位又沒說起點、`state` 會改變建議的狀況（只能是 `rush`／`luggage`／`budget`／`lessWalk`，同 `keyQuestion`）。
   - 給模型的：判斷指示＋出題規則（`EDGE_ASK_GUIDE`：各意圖必要的欄位〔與試判斷共用 `INTENT_SLOTS`〕、可以問的種類、寧可不問、題目不要有數字、選項要是使用者會點的短答）；情境（`judgeContext`，**只在手機上組、只給手機上的模型看，不送伺服器**）：有沒有定位、常用地點的「標籤」、上一輪問過哪一題、最近兩輪的摘要（同動態建議 `suggestContext`／`contextText`）、目前頁面。不含座標、地址、健康資料，最多 400 字。
   - Android：要求只回一行 JSON（`"ask": null` 或物件），輸出上限 80 → 160 token；iOS：`@Generable struct EdgeAsk`（`slot`、`state` 用 `.anyOf`，選項 `.minimumCount(2)`／`.maximumCount(4)`），`EdgeJudgement.ask` 是 optional。
2. **程式驗證**（不信任模型；不通過就丟掉，照規則問）：
   - **形狀**（`core/edge-ask.js edgeAskShape`，手機送出前與伺服器收到後都跑；伺服器以 `/core/edge-ask.js` 提供給前端）：種類與狀態在清單裡；問題 ≤ 30 字（沒有中文的英文 ≤ 60 字元）、要是問句、**不能有數字**（還沒查資料，數字一定是編的，ADR-0009）；選項 2～4 個、每個 ≤ 12 字（英文 ≤ 24 字元）、不重複；套 #112 的 `unsafeAsk`（網址、網域、帳號、電話、LINE、匯款…）、L2 輸出護欄（`OUTPUT_GUARDS`）、代辦說法（`claimsDone`，ADR-0011）；語言跟這一輪一致；狀態題兩個選項要一個肯定一個否定（`stateAnswer`）；手機另外擋上一輪剛問過的同一題。形狀不過，手機就不送 `ask`（判斷照送）。
   - **內容**（伺服器，`core/agent/ask.js`）：`route`／`to`／`from`——規則也認為這一句缺這個欄位（`slotAsk`／`originAsk` 有結果；沿用 #115 的「寧可不問」判斷），每個選項都能用打字回答的同一套 `PENDING_SLOTS` 接回完整的一句（地名要在地標庫、或是家／公司／學校〔帶 `saved`，手機有設定才顯示〕；路線要像路線號；「附近公車」「用我的位置」；定位又失敗那一輪不收「用我的位置」）；`state`——使用者這一輪沒說狀況、沒指定方式，而且 `keyQuestion(options, ctx, [state])`（**只試那個狀態**）建議會換、差別值得問（≥ 5 分或 ≥ 50 元）。
   - 通過時用手機的**題目與選項文字**；說明（`why`，狀態題放程式算的「叫車快 5 分但多 270 元」）、`pending`、`key`（同一段起訖 24 小時內只問一次）、這一輪的一句回答都仍由程式產生。
3. **伺服器端**：`deviceJudge.ask` 用 zod 嚴格驗證（slot／state 列舉、長度、選項數、不能換行、沒有多的欄位；不對整個請求 400——所以手機一定先過形狀檢查）。通過驗證的手機題目與規則衝突時以手機為準（勝過習慣確認、說過的預設狀況、規則的關鍵因子）；手機沒給但規則要問就照規則（保底）。一輪最多一題不變。示範、edge、模型模式都一樣（模型模式只有 `route`／`to`／`state`，同 ADR-0016）。
4. **看得到**：`ask` 事件多 `askSource: 'device'|'rule'`；這一輪最後的 `done`（不是請定位那一次）在請求帶了手機題目時多 `askCheck: { slot, state?, verdict: 'used'|'rejected', reason? }`。原本規劃放在 `status.judge`，但狀態題要等行程比較完才知道結果，`status` 是第一個事件，所以改放 `ask` 與最後的 `done`。伺服器 log 只記 `ask: device|rule` 與 `deviceAsk: used|rejected:<原因代碼>`，不記題目與選項。
5. **試判斷**（`#/ai` 第 4 段）：寫明「這題由手機上的 Gemini Nano 決定，程式驗證通過」或「這題由規則問（保底）」「手機上的 AI 覺得不用問；規則認為要問」；手機提議但被擋的題目照列（刪除線、選項）與原因，分「在手機上就被擋下」與「伺服器沒採用」（原因字典 `askwhy.*`，中英文）。
6. **原生**：judge 逾時、斷路器、優先順序（judge ＞ write ＞ suggest）照舊；輸出解析失敗（JSON 被截斷、ask 不是物件）只當作沒有 ask，不跳斷路器、不暫停。

## 不採用
- **多一次模型呼叫專門出題**：多 0.3～1 秒；judge 本來就要讀這一句。
- **讓手機的題目帶數字**（「叫車快 5 分，你趕嗎？」）：出題時還沒查資料，數字只能來自程式（放在 `why`）。
- **手機說不用問就不問**：規則的缺欄位判斷經過 #115 審查（約 250 句），手機模型漏問的代價（亂算、答非所問）比多問一題高；規則仍是保底。
- **刪掉規則**：網頁版、手機 AI 不可用、題目被擋時都要靠它。
- **習慣確認與說過的預設狀況交給模型**：牽涉存偏好與次數，不是這一句的判斷，仍由程式問。

## 影響
- 新檔 `core/edge-ask.js`（`/core/` 白名單、App 打包、service worker 都加上；sw `v1.2.0`）；`INTENT_SLOTS` 從 `core/agent/trial.js` 移到這裡（trial.js 重新匯出）。
- `keyQuestion(options, ctx, only)` 多一個參數；`core/edge-write.js` 匯出 `claimsDone`。
- 測試：`test/edge-ask.test.js`（形狀、整理、請求驗證、採用、寧可不問、衝突順序、英文、模型與 edge 模式、log、試判斷；#115 情境 AR-*／AS-* 用假外掛「合理」與「亂來」各跑一遍全過）；E2E 兩項（手機題目、退回規則、網頁版不變、試判斷來源）。
- 卡住：實機出題品質與延遲（輸出多了 ask，Gemini Nano 的 1.5 秒原生逾時是否夠）要在 Pixel 與 iPhone 15 Pro 以上量。
