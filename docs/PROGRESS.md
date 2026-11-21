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

## 2026-11-22 M12-E7 審查修正：回答也在手機上寫（PR #108 獨立審查）
- 做了：程式護欄改成比對「數字＋單位」（同義單位正規化），其他方案的數字只能用在提到它的那一句，關鍵數字順序要一樣；國字（一小時、半小時、一一九、八成、八點）、英文數量（two-minute、one hour、dozen、eighty）、時段（早上…）擋下；ADR-0011 代辦說法（已幫你安排／預約、司機已在路上、已幫你設好提醒、Your Uber is on its way）；L2 輸出護欄直接重用（規則本體搬到 `core/output-guards.js`，`guardrails.js` 改為重新匯出，前端以 /core/ 取得）；提醒或數字前加否定（不用帶傘、不是末班、不用打 119）；沒加引號的站名路名、裸網域、markdown 連結。多輪：送伺服器的前文用程式版總結（畫面顯示改寫）。「聽不懂」與 reply 選項只接受全字相符。上一題還在寫回 busy、逾時 5 秒後強制放掉；給模型的事實帶鍵名與單位、不截掉其他方案；常用地點沒設定那一輪不改寫；原生 write() 輸入超過 4000 字拒絕；頁底照實說、「今天寫了幾次」只算通過的、聽不懂的問句也檢查一輪只問一個。順手修 test/en-notes.test.js 的時間相依（固定時間）。
- 測試：npm test、npm run e2e 全過（test/edge-write.test.js 新增審查案例 9 項；E2E 加接著問的前文檢查、頁底說明）
- 文件：ADR-0017（護欄細節與限制照實寫）、AGENT.md §3.5、PROGRESS.md
- 下一個：實機量 Gemini Nano／Apple Intelligence 的通過率（規則變嚴，預期通過率下降，看實機數據再調）
- 卡住：無

## 2026-11-21 R1 判斷看得到：討論串與決策圖逐項說明天氣、空品、路況怎麼影響建議
- 做了：`core/services/trip-considered.js`：`plan_trip` 輸出 `considered`（天氣、空品、國道路況各一筆：值、資料一句、影響一句、`effect`＝none／score／自動狀態 key、查不到、示範標記）與 `single`（只有一種方式時，依各方式沒列出的原因組說明＋建議）。`execTools` 在行程結論前送三個 `data_note`（新事件；示範與模型模式相同，不經模型），前端以工具發言樣式排在行程發言前面，示範模式另外查過的角色不重複。決策圖資料欄改用 `decision.considered`：每個來源一個節點、帶值與影響，不影響與查不到淡色、不標成勝出關鍵。最近的空品測站超過 25 公里不採用（之前墾丁會拿台中大里測站判斷）；另外查的 `aqi_nearby` 影響也一樣。只有一種方式：`speak`「只找到叫車一種方式」、討論串影響與示範總結說原因（太遠、附近沒有站、幾點以後沒有趕得上的班次、示範資料是模擬的），「接下來可以」給「改成明天早上出發」「改從台北車站出發比較看看」。模型看到的工具文字多「判斷用到的資料」「只有一種方式」兩行。合併主線（#101～#105）後：TDX 額度用完改用示範資料時，路況那一行標示範並說明。審查修正：建議 chip 帶著使用者說的起點；只有一種方式的說明看這次有沒有 TDX fallback（`currentFallback()`）；data_note 去重改在 tool_start 記角色（工具平行時天氣可能晚到）。SW v0.9.9。
- 重現與判斷（第 4 點）：示範的公車、YouBike、天氣本來就以使用者位置產生；「只比了叫車」是 20 公里以上的行程在 23 點後（示範客運 06～23 點、火車沒有班次）。捷運與空品的示範資料是真實站名與真實數值片段，在台北以外「以位置為中心產生示範站」會變成假的捷運站與假測站讀數，所以不做；改成照實說原因（查不到、太遠、沒有班次）並標明示範資料範圍。
- 測試：npm test 新增 13 項（trip-considered.test.js）、agent-model／agent-events 更新；E2E 新增 2 項（模擬模型模式的討論串與資料欄、桃園深夜只剩叫車）
- 文件：AGENT.md §3.1、§5.2.10b；UX.md §4、§5；MCP_TOOLS.md plan_trip 7.1；ADR-0009 補充；PLAN.md R1；PROGRESS.md
- 下一個：「阿幫問你」合進來後，single.suggest 改用它
- 卡住：無

## 2026-11-21 M12-E7 回答也在手機上寫（ADR-0017）
- 做了：手機 App 的系統模型可用、外掛回 `write: true`、開關開著時，請求帶 `clientCaps: { edgeWrite, engine }`（zod strict）；伺服器不論 Claude／地端設定都不呼叫任何 AI 模型（判斷層只用快速版），走規則路徑查資料、`decide.js` 計分，送 `answer_draft { text: 程式版總結, facts: 事實清單（不含座標與起訖點）, lang }` 取代 `text`，`status.mode = 'edge'`。外掛 `AbangEdgeAI.write`：Android ML Kit GenAI Prompt API（Gemini Nano）、iOS Foundation Models（Apple Intelligence），原生 2.3 秒取消、JS 等 2.5 秒。程式護欄 `core/edge-write.js`（`checkRewrite`，經 `/core/` 給前端）：數字與時間只能來自草稿或事實清單、關鍵數字不能少、國字／英文數量、ADR-0011「已幫你叫好／訂好／付款」、投資建議、重要提醒（示範、末班…）、引號名稱、語言、長度；不過、逾時、失敗、草稿太長 → 程式版。防詐不改寫、安全情境照舊。畫面：思考動畫「在手機上寫回答」、回答上方合成一行（「手機上的 Gemini Nano 聽懂你的問題，也寫了這次的回答。」／只有寫回答「這次的回答由手機上的 Gemini Nano 寫。」／「手機上的 Gemini Nano 聽懂你的問題；回答用阿幫的固定說法（沒通過檢查／逾時）。」，產品負責人決定）、設定頁開關「回答也在手機上寫」（預設開）與隱私權政策、`#/ai`「寫回答」一格（引擎、今天幾次、上次多久、通過比例，只存手機）。sw.js `v0.9.9-write`。
- 測試：npm test 739 項全過（新增 test/edge-write.test.js 17 項）；npm run e2e 98 項全過（新增 3 項，截圖 phone-edge-write.png、phone-edge-write-fallback.png）；Android assembleDebug、iOS xcodebuild（不簽署）編譯成功
- 文件：ADR-0017（新）、adr/README.md、ADR-0014、AGENT.md §3.1／§3.5／§7、UX.md §5.0.2、PLAN.md、CLAUDE.md
- 合主線（阿幫問你 #107）後：edge 模式聽不懂時改用 `ask` 給 4 個查得到的選項（`unknownAsk`，產品負責人：edge 模式一律不用伺服器模型）；sw.js `v1.0.1`
- 下一個：實機量 Gemini Nano／Apple Intelligence 的改寫通過率與延遲
- 卡住：實機（Pixel、iPhone 15 Pro 以上）改寫品質待 Austin 確認

## 2026-11-21 真實資料接上：TDX、氣象署、環境部金鑰；TDX 頻率限制
- 做了：Austin 申請並放好 TDX、氣象署、環境部金鑰（只在 .env），交通、天氣、空品、地震都變成即時資料。實測 TDX 新帳號在「加值應用」審核前每分鐘只有 5 次（429），行程比較會連續呼叫而失敗：tdx-client 加請求排隊（同時 3 個、間隔 220ms）、429 時照 Retry-After 重試一次；Austin 決定先不申請加值應用，所以額度用完時這一次改用示範資料（`withTdxFallback`，結果標示範並說明），不讓查詢失敗。
- 測試：npm test 722 項全過（test/tdx-rate-limit.test.js 5 項）
- 文件：DATA_SOURCES.md、PROGRESS.md
- 下一個：TDX 加值應用審核通過後重測額度；行程比較減少 TDX 呼叫次數（快取、合併查詢）
- 卡住：TDX 加值應用審核（Austin）

## 2026-11-21 M14-02 阿幫會看（＋M11-03 原生相機掃發票）
- 做了：專案內外掛 `AbangVision`（Android：系統相機寫 App 暫存檔讀完即刪、Photo Picker、ML Kit 中文文字辨識 16.0.1 與條碼掃描 17.3.0 打包版、Gemini Nano 看圖分類〔選用，試過才回報〕；iOS：UIImagePickerController、PHPicker、Vision 讀字與條碼）。前端 `public/js/vision.js`：輸入列相機鍵（問阿幫、底部對話、防詐頁）、「阿幫在看」動畫、「阿幫看到了：…」確認後才送；可疑訊息走防詐（生活頁先問）、站牌組問題可改、發票存進我的發票並對獎；個資提醒與遮號碼；網頁版只用瀏覽器本機辨識。規則 `core/vision-text.js`（共用給前端）；demo-intent 認得問題裡的站名、`bus_route_eta` 有站名沒縣市時用位置推縣市。設定頁「讓阿幫看照片」、隱私權政策、`#/ai`「阿幫會看」卡。SW v0.9.7-vision。
- 測試：npm test 新增 18 項（vision.test.js）；E2E 新增 6 項（假外掛：簡訊、站牌、發票、權限被拒、網頁降級、reduced motion）；Android assembleDebug、iOS xcodebuild（不簽署）成功
- 文件：ADR-0015、adr/README、UX.md §5.0.4、AGENT_ANTIFRAUD.md §1、PLAN.md（M14-02、M11-03）、CLAUDE.md、PROGRESS.md
- 下一個：Pixel、iPhone 實機確認讀字品質與權限流程
- 卡住：無（APK 大小：打包版 ML Kit 讓 debug APK 約 10→74 MB；產品負責人同意打包在 App 裡）
- 審查修正：拍照暫存檔在 App 被回收時也刪、外掛啟動清空、FileProvider 只開放 cache/vision/；讀圖接住 OutOfMemoryError、解碼時就縮；Gemini Nano 只有 NOT_SUPPORTED 才記不支援；網址降為 1 分、讀到路線時不蓋過站牌；常駐播報區與每步焦點；輸入列相機鍵只在能讀字時顯示；交給防詐頁的文字 30 秒過期；iOS 擋重入、發票不做語言校正。
- 合併主線（語音 M14-01，PR #102）：輸入列＝相機（左）、輸入框、麥克風、送出（375px 不溢出，輸入框 min-width 0，E2E 量寬度）；AbangVision＋AbangVoice 都註冊、Info.plist 相機／麥克風／語音權限都在；設定頁兩個開關與隱私段落、#/ai「聽」「看」兩張卡；「阿幫會看」改為 UX.md §5.0.4；ADR-0015 補語音細節；SW v0.9.8。


## 2026-11-21 M14-01c 語音審查修正
- 做了：權限框與取消的競爭（原生 start 記號碼、權限回來先比對，被取消就 reject client 不開麥克風；Android 權限框的 onPause 不拆；JS 準備聽時的 visibilitychange 不取消）；長按真的放開才結束（start 帶 hold：iOS 不因停頓收尾、Android 停頓 8 秒；提早收尾時 JS 累加那一段接著聽）；Android available 的 checkRecognitionSupport 包 try/catch＋3 秒逾時；Android 13 下載語言包的辨識器延後拆（待實機驗證）；iOS teardown 把音訊類別設回 ambient、監聽音訊中斷與引擎設定改變；原生到背景時送 error 事件。
- 測試：voice.test.js 14 項；E2E 新增權限框不取消、長按帶 hold
- 文件：UX.md §5.0.3、PROGRESS.md
- 下一個：合併主線、送 PR
- 卡住：無

## 2026-11-21 M14-01a 語音只在手機上辨識、協助下載語言包、不支援就反白
- 做了：依產品負責人決定拿掉「退回系統／雲端辨識」：Android 只用手機上的辨識器，API 33+ 看語言包（可下載 → 第一次按麥克風就 `triggerModelDownload`，Android 14+ 用 ModelDownloadListener 回報進度，13 每 3 秒再問；下載中麥克風「準備中」；排在 Wi-Fi／失敗 → 「到手機設定下載」開語音輸入設定）；API 31、32 語言不能用回 `language-missing`。iOS 只在 `supportsOnDeviceRecognition` 時用（SFSpeechRecognizer 沒有下載 API，說怎麼開聽寫）。不支援就反白（`aria-disabled`、仍可按、按了說原因）；網頁版不能本機辨識仍不顯示。`#/ai`「聽」卡片、設定頁、隱私權政策、Info.plist 文案改成「語音只在手機上轉成文字，不錄音、不上傳」。
- 測試：voice.test.js 12 項（新增語言包下載）；E2E 新增 2 項（反白與原因、語言包下載），截圖 phone-voice-unsupported.png
- 文件：UX.md §5.0.3、PLAN.md、PROGRESS.md
- 下一個：M14-01b 實機確認
- 卡住：無

## 2026-11-21 M14-01 阿幫聽得懂：語音問阿幫（手機上辨識）
- 做了：原生外掛 `AbangVoice`（Android `AbangVoicePlugin.java`：API 31+ 手機上辨識器、API 33+ 查語言包、否則系統辨識＋EXTRA_PREFER_OFFLINE；iOS `AbangVoicePlugin.swift`：SFSpeechRecognizer＋AVAudioEngine、`requiresOnDeviceRecognition`、停頓 1.5 秒收尾；都回報 onDevice、partial／level／final／error 事件、錯誤碼對應、到背景就停）。前端 `voice.js`（狀態機、控制器、原生與網頁兩種來源）、`voice-i18n.js`、`agent/voice-ui.js`（麥克風鍵、在聽面板、核心跟著音量）；長按中央鍵放開送出（`abang-dock.js`）；用說的那一句泡泡有小麥克風；設定頁開關與麥克風權限、隱私權政策、`#/ai`「聽」卡片。網頁版只在 Google Chrome 能本機辨識時顯示（無頭 Chromium 呼叫 `available()` 會當掉）。SW v0.9.7。
- 測試：npm test 新增 11 項（voice.test.js）；E2E 新增 6 項（假外掛：麥克風鍵、在聽與即時文字、自動送出接上阿幫在想、長按中央鍵、停頓自動結束、英文辨識、取消、權限被拒、網頁版不顯示／本機辨識才顯示、reduced motion、`#/ai` 與設定）；截圖 phone-voice-listening.png、phone-voice-sent.png；`smoke:android` 外掛清單加 AbangVoice 並檢查麥克風鍵；Android assembleDebug、iOS xcodebuild（不簽署）成功
- 文件：UX.md §5.0.3、PLAN.md M14、CLAUDE.md、PROGRESS.md
- 下一個：M14-01b 實機確認（Pixel、iPhone）
- 卡住：無（實機需 Austin 的手機）

## 2026-11-21 P2 阿幫問你（調整）：同一題 24 小時只問一次；說過的狀況改成每次確認
- 做了：關鍵問題事件帶 `key`（狀態＋起訖座標到小數 2 位），手機 24 小時內問過就不顯示（`habits.js` `seenQ` 只存 8 碼雜湊、最多 50 筆、點「不趕」也算問過）。叫車原因（常帶東西／趕時間／不想走路）不再自動套用：這一輪沒說條件、而且會換建議時問「這次也帶東西嗎？」〔是（猜的）〕〔這次沒有〕，點〔是〕才加上「你說過：常帶東西」重算（`tripAsk` 的 `usualAsk`；kind state＋source usual）。移除 `withUsual`。習慣上限維持 8 分。
- 測試：npm test 全過（`test/ask.test.js`、`test/habits.test.js` 新增題目鍵與「這次也…嗎」）；E2E「阿幫問你」3 項（截圖 `phone-key-question.png`、`phone-usual-ask.png`）
- 文件：ADR-0016、ADR-0010、AGENT.md、UX.md、PROGRESS.md
- 下一個：合併主線（判斷看得到、語音、視覺）
- 卡住：無

## 2026-11-21 P2 阿幫問你：答案取決於使用者時問一句（習慣要確認、叫車問原因、關鍵因子）
- 做了：產品負責人「重要因子應可與用戶互動後完成」「需要使用者互動得到答案會讓整體變快就問」。通用機制 ADR-0016：事件 `ask`（`core/agent/events.js`；options 的 kind：state 加狀態即時重算、reply 送完整的一句、store 存手機偏好、action 手機做事、dismiss；guess；pending）、`core/agent/ask.js`（`tripAsk`、`resolvePending`／`PENDING_SLOTS`）、`core/decide.js` `keyQuestion`（試加趕時間／想省錢／帶行李／少走路，建議會換且差 ≥ 5 分或 ≥ 50 元才問，挑影響最大的）、前端共用區塊 `public/ui/agent/ask.js`（`mountAsk`、`matchAnswer`：直接打「我不趕」「好」也是答案，對不上＝略過並帶 `pendingAsk`）。一輪最多一個（execTools 整輪共用）。習慣改成問過才用：≥ 5 次且 6 成以上問「以後要我優先推捷運嗎？」，說好才送 `userState.habit`；常叫車問原因 → `userState.usual`（你說過的預設狀況，沒說條件時帶入）或叫車加分或不再問。決策圖 chip「你同意：優先推捷運」「你說過：常帶東西」、`addState`／`setHabit`；設定頁列出同意與說過的、可撤銷。情境檢查加 asks／asksNone／askOptions／askKind／askGuess／toNot，情境可指定 `here`、多輪帶 pendingAsk。
- 測試：npm test 717 項（新增 `test/ask.test.js` 14 項、`test/habits.test.js` 改寫 12 項）；E2E「阿幫問你」3 項（截圖 `phone-habit-ask.png`、`phone-key-question.png`、`phone-habit-settings.png`）
- 文件：ADR-0016（新）、adr/README、ADR-0010、AGENT.md §2／§3.1／§3.3、UX.md §5／§5.0、MCP_TOOLS.md、CARDS.md、PLAN.md、PROGRESS.md
- 下一個：P2b PM 的 27 個情境接上 `PENDING_SLOTS`
- 卡住：無

## 2026-11-21 P1 個人化：記住常選的交通方式（只在手機、可關、程式計分）
- 做了：`public/js/habits.js`（localStorage `abang.habits`：只記交通方式與時間，最近 50 次、60 天半衰期、180 天前不算、30 分鐘內同一方式算一次、選滿 5 次才送比例；開關預設開、清除時關著的仍是關的）。「選了」＝行程卡建議方案按導航／叫車／訂票（卡片送 `abang:choice`）、指定方式的決策（「改成 X」、決策圖點方案）、設公車到站提醒或下車提醒（App 重開恢復的不算）。問阿幫送 `userState.habit`（zod：鍵限定、0～1、總和 ≤ 1.01），`execTools` 一律以手機送來的帶進 `plan_trip` `prefs.habit`（模型帶的不採用），示範與模型模式相同。`decide.js` 新增 `HABIT`（最多 +8 分、比例 60% 加滿）：說了／點了狀況、指定方式、不要、抵達時間優先；比最快慢 2 倍且多 20 分以上不加分；理由句「你常搭捷運、省 230 元」。決策圖「你常選：捷運」chip（紫色、可點掉即時重算、「為什麼」看次數、第一次說明一次）、明細「習慣 +8.0」。設定頁「個人化」開關、次數、清除；本機資料清單與隱私權政策補上。sw.js `v0.9.7-habit`。
- 測試：npm test 700 項（新增 19 項：`test/habits.test.js`、`test/decide-habit.test.js`）；E2E 新增 1 項（截圖 `phone-habit-chip.png`、`phone-habit-settings.png`）
- 文件：ADR-0010 權重調整紀錄、UX.md §5 與 §5.0、AGENT.md §2／§3.3、MCP_TOOLS.md plan_trip、PLAN.md、PROGRESS.md
- 下一個：Austin 確認加分上限（8 分）與「常叫車也會推叫車」是否 OK
- 卡住：無

## 2026-11-21 決策權重調整：沒有狀態時以大眾運輸為主，有理由才推叫車
- 做了：Austin 回饋「點去 101 幾乎都是叫車」。叫車在等車、走路、戶外、體力四項永遠最好（合計 45%），費用只佔 15%，無狀態 11 種常見起訖有 10 種推叫車。調整基本權重（費用 20%、戶外 3%、體力 5%、走路 12%）並等比例調高相關狀態倍數；想省錢 ×5 → ×3。結果：無狀態推捷運或公車；趕時間、帶行李、下雨、帶長輩推叫車。ADR-0010 權重調整紀錄。
- 測試：npm test 全過（固定起訖 OD 測試「市區短程（無狀態）」期望改為捷運）
- 文件：ADR-0010、PROGRESS.md
- 下一個：個人化（依使用者過去的選擇微調，只存在手機）
- 卡住：無

## 2026-11-21 模型模式 P5：明確的規則不交給小模型、判斷層不改判
- 做了：PM 第五批地端模型模式 5／8 → 8／8。禮貌話、只有標點、一句多件事、「去火車站」、說了站名的捷運改由規則回答（`ruleFirst`）；runDemo 裡判斷層不再把這幾種改判（「捷運西門站下一般」原本被嵌入分類器判成行程）。另修 ios:dev 在 iPhone 鎖著時誤報失敗、英文公車頁 E2E 隨示範資料時間偶發失敗。
- 測試：npm test 680 項全過
- 文件：AGENT.md §5.2.11、PROGRESS.md
- 下一個：完整模型模式評測（情境 127 個）
- 卡住：無

## 2026-11-21 E9c 合併主線（首頁與導覽重新設計）＋審查修正
- 做了：合進主線（PM 第五批、Λ 圖示、ios:dev、公車街景、首頁與導覽重新設計）。入口接起來：首頁「手機上的 AI」狀態列改連 `#/ai`、我的頁「手機上的 AI」區塊加「看阿幫的腦袋」；`#/ai` 屬於「我的」分區（tabs.js SECTIONS），返回鍵照 backTarget。思考動畫在中央鍵拉出的底部對話面板也正常（E2E）。審查修正：手機判斷那句只在回答上方說一次（頁底不重複，英文提問時英文）；iOS `contextSize` 在 26.x 是 SDK back-deploy 寫死的 4096，改成 iOS 27 起才回報；Android 查模型名稱與 token 上限移到另一條執行緒且只查一次（不擋 judge）；測試不綁 SW 版本號。SW v0.9.6。
- 測試：npm test 678 項全過；E2E 80 項全過；Android assembleDebug、iOS 實機目標 xcodebuild（不簽署）都成功
- 文件：UX.md §5.0.1、§5.0.2、ADR-0014 第 6 點、PROGRESS.md、CLAUDE.md
- 下一個：實機確認（Pixel、iPhone）
- 卡住：無

## 2026-11-21 E9b 思考時的動畫（阿幫在想、試試看至少 1.2 秒）
- 做了：Austin「思考時候一定要有動畫」。問阿幫（含底部對話面板）送出後在回答的位置顯示核心小版本＋「阿幫在想…」，依真實事件換成「手機上聽懂了：行程規劃・趕時間」／「伺服器判斷中」→「正在查：公車・天氣」→「整理答案中」，第一段回答來了就拿掉（`public/js/agent/thinking.js`，取代原本 0.6 秒後才出現的泡泡）。回答上方照實說手機判斷有沒有被伺服器採用。腦袋頁試試看：結果文字立刻寫出，動畫至少播 1.2 秒；訊號改成依序亮起的小光點（只動 opacity）。
- 測試：npm test 新增 test/thinking.test.js 4 項；E2E 新增 4 項（思考指示出現、正在查、收起；手機判斷小標＋回答上方說明；reduced motion 靜態；試試看動畫 ≥ 1.2 秒）
- 文件：UX.md §5.0.1、§5.0.2、CLAUDE.md
- 下一個：實機看動畫流暢度（Pixel）
- 卡住：無

## 2026-11-21 E9 阿幫的腦袋——裝置端 AI 視覺與模型資訊頁（#/ai）
- 做了：新頁 `#/ai`（設定頁裝置端 AI 區塊進入）。主視覺用 App 圖示的「Λ＋琥珀色發光核心＋軌道」：待機呼吸、判斷時脈動、訊號流到「意圖」「狀態」並點亮；圖下方 role=status 的一句話是等義文字，reduced motion 直接顯示結果。「現場試試看」只呼叫手機上的外掛（沒有網路請求）。模型資訊只列系統回報的：外掛 `status()` 擴充（Android：featureStatus、modelName、tokenLimit、下載進度、aicoreVersion、osVersion、device；iOS：availability、languages、contextSize、osVersion），`judge()` 回 `ms`；本機計數 `abang.edgeStats`。`/api/v1/status` 加 `agent`（由誰回答、判斷層成員）。沒有裝置端模型（網頁版、不支援、關掉）時核心不點亮、照實說判斷在伺服器做。設定頁與本頁共用開關（`setEdgeEnabled`）。字典 `ai-i18n.js`（`lang=en`）。
- 測試：npm test 648 項全過（新增 test/ai-info.test.js 11 項）；E2E 64 項全過（新增 3 項：網頁版手機／桌面、假外掛的模型資訊＋試試看＋開關＋英文＋入口）；Android `assembleDebug`、iOS 模擬器 `xcodebuild` 都編譯成功
- 文件：UX.md §5.0.1、ADR-0014 第 7 點、AGENT.md §5.3、PLAN.md E9、README、CLAUDE.md；SW v0.9.3-ai
- 下一個：首頁「手機上的 AI」狀態列接到 `#/ai`（另一個分支）；實機確認欄位
- 卡住：外掛新欄位還沒在實機看過（Pixel：`getBaseModelName`／`getTokenLimit`／AICore 版本實際回什麼；iPhone：`supportedLanguages` 的寫法）——查不到時畫面只是少那一列

## 2026-11-21 首頁與導覽重新設計（阿幫為中心）
- 做了：Austin 回饋「最下面都是公車相關，跟全方位資料整合＋edge AI 的 App 不相符」。底部分頁列改成 首頁｜服務｜問阿幫（中央大鍵）｜提醒｜我的（public/js/tabs.js；子頁標在所屬那一區 aria-current="true"）。中央鍵取代右下角浮動阿幫（同一個 #abang-fab，不兩個並存）：其他頁拉出同一段對話、問阿幫頁回到輸入框；有對話小點、阿幫說了你還沒看的橘點（讀屏「問阿幫（阿幫有話跟你說）」）；提醒泡泡從中央鍵上方冒出（防詐頁也看得到）。首頁：「手機上的 AI」照實說誰在判斷、主視覺「有事問阿幫」＋各領域範例、「現在」（天氣、空品、最近一個提醒；沒定位用台北車站附近並寫明、查不到只留提醒、離線說離線；用現有 /api/v1/tools，不新增端點）、防詐大卡放在格子前面、格子一組一塊面板。新頁：#/services（四組服務＋一句說明，含附近、公車）、#/reminders（到站、下車、出門提醒逐一取消、教怎麼設；設定頁的出門提醒清單搬過來）、#/me（我存的、手機上的 AI 說明、設定與隱私、關於與資料來源）。附近、公車搜尋、收藏不再是分頁（有返回鈕）；舊網址都可用。英文外殼鍵更新（Home／Services／Ask Abang／Reminders／Me）。
- 測試：npm test 全過（新增 test/home-nav.test.js 8 項、shell-en 更新）；E2E 全過（新增服務、提醒取消、我的、舊網址、現在降級、桌面分頁列；常駐、英文外殼、無障礙、設定測試改成新導覽）；smoke-android 的 PAGES 改成檢查中央鍵與分頁列目前位置（要接實機再跑）
- 文件：UX.md §3.1（新）、§4.13、§4.14、§5.0；CLAUDE.md 目錄；SW v0.9.5（新檔加入 SHELL；合併主線後）
- 審查後修正：提醒頁與「現在」內容沒變不重畫（焦點不掉）；「現在」快取記有沒有用到定位（允許定位後作廢）、兩者都查到才快取、回首頁不閃骨架、示範資料標示範；提醒數字的讀屏文字跟著語言；鍵盤開著時阿幫說話也亮未讀點；Android 返回鍵在分頁本身回首頁、只有首頁才離開 App。
- 下一個：Android／iOS 實機看中央鍵與安全區（文案、防詐卡位置、沒定位用台北車站附近先照現在做法）
- 卡住：無

## 2026-11-21 公車街景更有變化
- 做了：使用者回饋「只有即將進站似乎很少」→ 街景疊 SVG 生活感圖層（public/ui/cards/bus-scene-art.js，跟 Blender 同一台相機投影）：中間兩個小站牌與「還有 k 站」（開過的變淡）、你這站越近越亮；台灣時間白天／傍晚／夜晚（柔和的罩子、路燈、店面與車窗亮燈、車頭燈）；等車的人 1～3 個（依站名＋第幾班固定），到站開門上車；這班已過你這站時往右開走、下一班從左邊進來（`departed`）；未發車／末班已過畫空的路與「目前路上沒有這班車」；店面遮雨棚、近側人行道（機車、郵筒、花台…依站名）、偶爾經過的機車與計程車；坐車中車身貼「你」。同一頁沿用同一個街景（`state.box`），不每 20 秒重建；減少動態直接畫最終狀態、不畫經過的車。中英字典 scene.mark／empty／you。
- 測試：npm test 651 項全過（合併主線後；新增 test/bus-scene.test.js 9 項：時段、小站牌、等車的人、固定亂數與洗牌、投影對 scene.json、圖層、開走判斷、字典）；E2E 64 項全過（新增 3 項：遠近時段與沿用、開走與上車、公車頁夜晚；截圖 test/screenshots/bus-scene-*.png）
- 文件：UX.md §4.15、PROGRESS.md；SW v0.9.4（合併主線後）
- 下一個：手機實機看夜晚對比與動畫順不順

## 2026-11-21 iPhone 實機安裝（npm run ios:dev）與 Apple Intelligence 實機確認
- 做了：Austin 的 iPhone 17 Pro Max 第一次裝上開發版（個人開發團隊簽署；要先在 Xcode 登入 Apple 帳號）。iPhone 走同一個 Wi-Fi 連本機伺服器，建置時暫時加 NSAllowsLocalNetworking（建置完還原）。做成 `npm run ios:dev`（scripts/ios-dev-install.js）。伺服器紀錄確認 iPhone 的提問帶著 Apple Intelligence 的判斷（device: apple）；Pixel 上 Gemini Nano 判斷一句約 0.4 秒。
- 發現：伺服器自己有判斷器時，畫面不會顯示手機判斷過（待修：照實顯示一行）。
- 測試：test/ios-dev-install.test.js 2 項
- 文件：CLAUDE.md 指令、PROGRESS.md
- 下一個：手機判斷的顯示、阿幫的腦袋頁
- 卡住：無

## 2026-11-21 App 圖示改用 Λ 標誌（C2），藍鵲留在 App 內
- 做了：產品負責人決定 App 圖示不用藍鵲、改用比較有科技感的標誌（定稿 C2：品牌青綠漸層底、亮白薄荷色的 Λ、琥珀色發光核心、一圈軌道）。`scripts/build-brand.py` 產生 `icon.svg`（圓角）、`icon-square.svg`（方形不透明）、`icon-fg.svg`／`icon-bg.svg`（Android 自適應：前景縮成 2/3 在 66dp 安全區內、背景漸層對齊露出的 72dp，遮罩裁出來和 iOS 一樣）、新增 `icon-mono.svg`（Λ＋核心剪影）。`scripts/build-icons.js` 整理掉藍鵲的換色與位移特例：iOS 深色＝前景放大 1.5 倍（不換色）、著色＝同一張灰階；Android 主題單色用 `icon-mono.svg`；啟動畫面改成圓角圖示＋Abang；Android 12+ `splash_icon` 改放整個圓角圖示（白色 Λ 單獨放在淺色底看不到）。順手修：PWA maskable 改用方形不透明版 `icon-maskable-512.png`、`apple-touch-icon.png`（180，透明角在 iOS 會變黑）；Android 通知小圖示原本沒設定（用系統的 i 圖示），新增 `ic_stat_abang`（Λ 剪影）並在 `capacitor.config.json` 指定（找不到資源時外掛會退回系統圖示）。吉祥物 `abang-*.svg`、對話頭像不動。
- 測試：npm test 642 項全過（test/brand.test.js 新增 5 項：圖示是 Λ 不是藍鵲、前景與單色在安全區內、iOS 深色／著色透明底、通知小圖示、啟動畫面）；lint 零錯誤；重跑 build-brand.py 後 git diff 無差異
- 文件：BRAND.md §2.1（Λ 標誌、檔案、顏色）、UX.md、PLAN.md、README、CLAUDE.md、docs/index.html（品牌區的 App 圖示）；SW 0.9.3-icon
- 下一個：合併後裝到手機看桌面圖示、主題圖示、通知小圖示、啟動畫面
- 卡住：實機確認（Pixel 主題圖示與通知小圖示、iOS 深色／著色）；商標圖形要不要改用 Λ 標誌由營運單位決定

## 2026-11-21 PM 第五批情境 P5-1～P5-10（更正、出發時間、台語、錯字、一句多件事、防詐話術與事後求助）
- 做了：PM 提 10 個（34 輪只過 11 輪），分兩組同時修：生活 agent——中途更正保留起點、出發時間解析（明天早上 8 點出發）、台語與錯字正規化、「去火車站」最近車站、英文 there 與 YouBike near X、一句問多件事都查、禮貌話；防詐 agent——規則疊加計分（stack）與正常通知例外（except）、補假檢警／假親友／投資群組／誤設批發商／和解金／按 9／欠費停話寫法、貼上的詐騙訊息不被 119 攔、「已經匯款了」給 165／110／止付步驟。
- 測試：npm test 637 項全過（test/pm5-intents.test.js、test/pm5-antifraud.test.js；情境 127 個＋防詐情境 2 個）；E2E 61 項全過。審查修正：防詐頁急症仍給 119、事後求助不誤判擔心或一般付款、宣導新聞不疊加、半夜 12 點、一句多件事不丟件、出發與抵達衝突、禮貌詞開頭；實機發現叫車提醒重複一句已修
- 文件：AGENT.md §5.2.15、AGENT_ANTIFRAUD.md、PROGRESS.md、CLAUDE.md
- 下一個：模型模式評測 P5；英文出發時間
- 卡住：防詐規則權重與寫法上架前要專家審核

## 2026-11-21 S12g 外殼英文
- 做了：目前頁面網址帶 `lang=en`（英文公車頁）或問阿幫頁最近一輪是英文時，外殼（底部分頁列、返回鈕、跳到主要內容、浮動阿幫與對話面板、提醒泡泡）用英文；英文公車頁整頁 `<html lang="en">`，問阿幫頁只把外殼元素標 `lang="en"`（上面還有中文對話）；浮動面板開著時問英文，面板也跟著；提醒本文是中文就整個泡泡用中文；離開就回中文（不存設定）。字典 public/js/shell-i18n.js（`data-shell`／`data-shell-label`）。
- 測試：npm test 604 項全過（test/shell-en.test.js）；E2E 61 項全過（英文公車頁、英文提問後外殼英文、回中文）
- 文件：UX.md §4.13、PLAN.md、PROGRESS.md；SW 0.9.2
- 下一個：格子頁英文（頁首、資料來源）；PM 第五批情境
- 卡住：無

## 2026-11-21 S12g 更多英文地名
- 做了：106 個觀光客常去的景點、夜市、車站、機場、醫院加英文名稱（`en`）與英文別名（Taroko、Pier-2、Kenting、Tamsui Fisherman's Wharf、Taipei Fine Arts Museum…），有英文名稱的地標 41 → 147 個；英文別名不重複（測試）。
- 測試：npm test 598 項全過
- 文件：PLAN.md（S12g 完成）、PROGRESS.md
- 下一個：外殼（底部分頁列、返回鈕）英文；PM 第五批情境
- 卡住：英文名稱是常見譯名，上架前可請在地導覽確認

## 2026-11-21 S12g 公車頁英文
- 做了：觀光客用英文問、從卡片或下一步開公車頁時網址帶 `lang=en`，公車頁（到站、到站提醒、坐車中、下車提醒、街景、無障礙文字、錯誤）用英文；到站與下車提醒通知、進行中列也跟著英文；站名、路線名照原文；沒帶 lang 中文畫面不變（審查逐字比對）。字典 public/js/pages/bus-i18n.js。P4-6 情境改成穩定的期望（示範 YouBike 資料隨時間變）。
- 測試：npm test 597 項全過（test/bus-page-en.test.js）；E2E 61 項全過（英文公車頁）
- 文件：UX.md §4.13、PLAN.md（S12g 公車頁英文完成，更多英文地名留待辦）、PROGRESS.md；SW 0.9.1
- 下一個：更多英文地名；底部分頁列等外殼英文
- 卡住：無

## 2026-11-21 模型模式 P4：查數字的生活資料由規則回答、說了地點的附近查詢沿用
- 做了：P4 模型模式 5／10 → 失敗的重跑全過。油價、發票、股市、地震（`RULE_ANSWERS`）地端模型模式由規則回答；「那邊有 YouBike 嗎」模型改用現在位置再查時沿用目的地的結果；P4-6 情境的期望站名改成示範資料真的有的。
- 測試：npm test 590 項全過（新增 2 項）
- 文件：AGENT.md §5.2.11、PROGRESS.md
- 下一個：PM 第五批情境或 S12g 英文公車頁
- 卡住：無

## 2026-11-21 PM 第四批情境 P4-1～P4-10（安全、生活追問、口語）
- 做了：PM 提 10 個情境全部沒過，逐一修；安全優先：胸痛喘不過氣先叫 119、問用藥不做醫療判斷、打了個資提醒且手機上的對話遮掉號碼；油價、發票、股市、地震、慢跑的追問；「那邊有 YouBike」、「市府」、常見醫院、捷運幾點收、注音文；PM 探查到的電梯、站名、代付說法。審查修正：防詐 agent 不擋貼上的號碼、急症常見說法（胸悶、心悸）、「中風復健中心」不誤判、「垃圾車今天收幾點」不是股市。
- 測試：npm test 588 項全過（情境 119 個；回歸測試 test/pm4-intents.test.js）；E2E 60 項全過
- 文件：AGENT.md §5.2.14、PROGRESS.md、CLAUDE.md、docs/index.html
- 下一個：模型模式評測 P4
- 卡住：急症與用藥的說明文字上架前要請醫療專業人員確認

## 2026-11-21 模型模式：起訖相同不再查、明天天氣要說明天
- 做了：完整評測 105／109（地端 qwen3:8b）；P3-8 回程時小模型查「台北101 → 台北101」又出一張卡 → 起訖相同不查；S1-3 問明天天氣模型沒說「明天」→ 程式補；S10-3 是偶發重複卡（已由上一筆修正涵蓋，連跑兩次都過）。
- 測試：npm test 573 項全過（新增 2 項）；失敗的 3 個以地端模型連跑兩次都過
- 文件：AGENT.md §5.2.11、PROGRESS.md、CLAUDE.md（模型模式 105／109）
- 下一個：PM 第四批情境
- 卡住：無

## 2026-11-21 模型模式：同一輪不出兩張行程卡、常用地點附近、叫車付款提醒
- 做了：模型模式完整評測 103／109（PR #84 修正前的程式）；失敗的 6 個裡 4 個是重複行程卡（小模型給沒座標的 `{ name }` 或錯座標再查一次），改成同一輪同目的地沿用；「垃圾車幾點會到我家這邊」模型模式也用家的座標；說要叫車時補付款提醒。PR #84 審查修正（狀態延續、正常分期通知、回程、票價起站、常用地點、英文）已合併。
- 測試：npm test 571 項全過（新增 4 項；審查修正：付款句只在卡片上有叫車時補、地名比對不把「台北車站東三門」當「台北車站」、同一輪可記多趟）；失敗的 6 個重跑剩 A1b-1（「每人分攤」重複，已知）
- 文件：AGENT.md §5.2.11、PROGRESS.md
- 下一個：完整評測確認；PM 第四批情境
- 卡住：無

## 2026-11-21 PM 第三批情境 P3-1～P3-10
- 做了：PM 提 10 個（長輩、觀光客英文、多輪；防詐沒有情境測試框架，改測規則），8 個原本沒過，逐一修；另修 PM 探查到的 4 個錯：高鐵高雄＝左營、英文查不到時說「Here you go」、「高鐵到高雄多少錢」沒說起站、英文下一班高鐵說成當天第一班；防詐解除分期常見寫法判高風險。
- 測試：npm test 566 項全過（情境 109 個；回歸測試）；E2E 60 項全過
- 文件：AGENT.md §5.2.13、PROGRESS.md
- 下一個：模型模式完整評測結果
- 卡住：防詐規則庫仍待專家審核

## 2026-11-21 文件同步（PR #77～#82）
- 做了：CLAUDE.md 進度（App 重開後的對話、情境 99 個與模型模式 97／99、smoke:android）、PLAN 狀態看板、文件網站加「Agent 聰明度」一列
- 測試：無程式變更
- 下一個：PM 第三批情境
- 卡住：無

## 2026-11-21 PM 第二批情境 P2-1～P2-10
- 做了：PM 提 10 個真實說法情境（全部原本沒過），逐一修：口語公車與「那 X 咧」、一句兩件事、「101」、「怎麼坐」、同目的地接著改、比較快、問下雨不是正在下雨、明天行程看明天預報、相對時間（`relMinutes`、`parseIntent` 帶 `now`）、趕車是去車站的行程、「剛剛那班」「那裡」、慢箋、帶小孩去公園、叫一台車、界線（代按代付代訂只給官方連結）、`railOD` 時間詞吃進站名的錯。審查修正（不誤判平常的話）：生活服務換地點不搶行程與 YouBike、明天帶過去；相對時間只在「要到／車要開」才算抵達；「三十分」不是十分老街、中文數字到九十九、時數上限；代按代付不抓「按照、按電梯、按讚、預約、訂位」；數字地名與公車說法共用；問末班不算趕車；說了地點又問怎麼去不算出門建議；連續追問；「來得及」不當站名、「從板橋怎麼去」起點是板橋。模型模式：規則聽得懂時程式先查、工具照規則縮減、`mustSay` 補叫車付款與訂票官方連結、判斷層的下雨問句拿掉。
- 測試：npm test 554 項全過（情境 99 個、新增 test/pm2-intents.test.js）；E2E 60 項全過；模型模式完整 99 個情境 97／99（A1b-1 小模型重複與偶發重複卡、S12-11 已補「照你說的，」）
- 文件：AGENT.md §5.2.12、PROGRESS.md
- 下一個：PM 第三批或其他待辦
- 卡住：無

## 2026-11-21 對話在 App 重開後還在
- 做了：Austin：「阿幫應該是所有資料的擁有者」。`chat-store.js`：只存文字、最近 10 則、12 小時過期；問阿幫打開時收合顯示「上次的對話」（今天／昨天＋時間），只顯示；按「接著上次問」才接回 history（審查：沒按就不送，常用地點不會因昨天說過「回家」又送出），「不用了，重新開始」清掉；清除時還在回答的那一輪不寫回（gen）、排隊的問題丟掉；設定頁本機資料清單、清除時連開著的對話一起清（`abang:clear-local`）；隱私權政策補一句。SW v0.8.9。另：PR #80 煙霧測試在手機螢幕關著時也穩。
- 測試：npm test 540 項全過（chat-store 2 項）；E2E 60 項全過（重新整理後上次的對話、接著問帶前文、清除後畫面也清）
- 文件：UX.md §4.14、PLAN.md、PROGRESS.md
- 下一個：待辦總表其他項目
- 卡住：無

## 2026-11-21 模型模式情境評測：72／89 → 88／89
- 做了：PM 最在意的 agent 聰明度：用地端 qwen3:8b 跑完整情境集。評測腳本補上情境時間與常用地點（原本是腳本的錯）；地端英文改用規則回答；後天天氣照實說；`mustSay` 補模型漏講的「照你說的」與深夜收班／末班；同一輪同一段路只比較一次（不出現兩張行程卡）；`nightNote` 示範與模型模式共用。
- 測試：npm test 537 項全過（新增 test/model-mustsay.test.js）；E2E 59 項全過；模型模式情境 88／89（剩 A1b-1 小模型重複寫分攤，已知）
- 文件：AGENT.md §5.2.11、PROGRESS.md
- 下一個：待辦總表其他項目
- 卡住：無

## 2026-11-21 S12g 第一部分：伺服器說這一輪的語言
- 做了：`status` 事件帶 `lang: 'en'|'zh'`（示範與模型模式都用 `isEnglish`）；問阿幫收到後改用伺服器的判斷（送出前的猜測只用在「討論中」等第一個畫面）。
- 測試：npm test 535 項全過（status lang、英文問 en／中文問 zh）；E2E 59 項全過
- 文件：AGENT.md 事件表、PLAN.md、PROGRESS.md
- 下一個：模型模式情境評測結果的改進
- 卡住：無

## 2026-11-21 T8b Android 實機煙霧測試
- 做了：`scripts/smoke-android.js`（`npm run smoke:android`）：adb＋WebView 偵錯通道＋Playwright connectOverCDP，檢查原生外掛註冊、6 頁、浮動阿幫、返回鍵、沒有錯誤、截圖。審查修正：多個 pid、多台裝置（ANDROID_SERIAL）、forward 與連線失敗也清掉、先設引導旗標再重新載入（開機錯誤也收）、結束時還原手機上的旗標、截圖改用 adb screencap（手機實際畫面）、沒拉出對話不按返回；打開浮動對話時焦點在「問阿幫」標題（讀屏先念）。實機跑出一個真問題：浮動阿幫打開時自動聚焦輸入框，手機會跳鍵盤蓋住半個對話、第一次按返回只收鍵盤 → 手機不自動聚焦（與問阿幫頁相同）。Pixel 實機全過。
- 測試：npm test 534 項全過；E2E 59 項全過；smoke:android 全過
- 文件：TESTING.md、CLAUDE.md、PLAN.md（T8b ✅、T8c iOS 列入）、PROGRESS.md
- 下一個：T8c iOS 或待辦總表其他項目
- 卡住：無

## 2026-11-21 文件同步（PR #65～#75）
- 做了：CLAUDE.md 進度與目錄（abang-dock、page-hero、trip-bar、location-help、metro-colors）、PLAN 狀態看板與待辦總表（對話重開後保留、油價週漲跌）、文件網站加「阿幫常駐與頁面質感」一列
- 測試：無程式變更
- 下一個：待辦總表中可做的項目
- 卡住：無

## 2026-11-21 S12f 英文其餘
- 做了：用英文實際問 8 種問題、逐一找畫面上的中文。伺服器：行程每段說明帶 `detailEn`（`leg()` 收 [中文, 英文]）、決策事件帶 `signalsEn`（km、City、Clear、Rain）。卡片：公車到站文字依狀態與秒數自己說（Arriving、5 min、Not departed yet）、方向「To X」；行程方案名稱（Bus 棕9、MRT 淡水信義線、Taxi）；藥局星期。問阿幫：英文那一輪的 @點名、頭像讀屏、「Demo data」「Abang is thinking」；點名認得程式自己用的角色（定位、行程）。地名、站名、路線名維持中文（S12b 決定）。審查修正：英文到站文字跟每秒倒數同一套規則（不會一秒後換字）；客運留路線號（Coach 1610）、叫車留平台（Taxi (Uber)）、捷運轉乘括號改半形；單複數（1 bike）；(est.)；路況 Local roads／Slow；防詐角色英文。
- 測試：npm test 534 項全過（新增 test/english-s12f.test.js 4 項）；E2E 59 項全過
- 文件：PLAN.md（S12f ✅、S12g 列入）、CARDS.md、PROGRESS.md
- 下一個：S12g 或其他
- 卡住：無

## 2026-11-21 各頁資料小巧思（第二批）
- 做了：捷運官方路線色（`core/metro-colors.js`，真實與示範都帶 `lineColor`）、進站中閃點（6 次就停）；YouBike 可借比例條；公車搜尋「最近查過」（`rememberRoute`）；回首頁圖示飛回格子（app.js 把換頁拆成 `navigate`／`render`，回首頁時 `startViewTransition`；飛完拿掉名稱，點格子前先清掉其他格子的名稱）。SW v0.8.8。審查修正：連按返回不畫兩次、換頁出錯不被吞掉、附近切 YouBike 後回首頁飛回 YouBike 格子、canMorph 共用、閃點 4 次（4.8 秒）、黃橘色條加邊、最近查過資料壞了不出錯且只記縣市代碼、隱私清單寫出最近查過。
- 測試：npm test 530 項全過；E2E 59 項全過（捷運板南線藍、YouBike 比例條、最近查過）
- 文件：UX.md、CARDS.md（lineColor）、PLAN.md、PROGRESS.md
- 下一個：S12f 英文其餘
- 卡住：油價週漲跌需要上週牌價

## 2026-11-21 浮動阿幫知道你在哪一頁
- 做了：頁面宣告 `askHint({ params, query })` → `{ context, chips }`（公車路線、各生活服務、高鐵台鐵、附近）；app.js 抽出 `resolve()`，浮動阿幫打開時讀現在的頁面；問阿幫 `setPage()` 顯示「在這頁可以問」、點了建議問題才把這一頁的說明一起送（自己打的不帶，隱私權政策補一句；與既有 context 合併、≤ 200 字；阿幫忙著時排隊也帶著）；提醒泡泡代問不帶頁面；系統提示把 context 包在［資料開始／結束］並改名「正在看的頁面」；整頁時拿掉。建議問題都用示範規則聽得懂的說法（逐一確認 parseIntent）。
- 測試：npm test 529 項全過；E2E 58 項全過（公車頁打開有「307 到哪了？我在…」；天氣頁打開點建議問題，請求帶「使用者正在看「天氣」頁」、問了就收起來）
- 文件：UX.md §4.14、PLAN.md、PROGRESS.md
- 下一個：S12f 英文其餘、各頁小巧思第二批
- 卡住：無

## 2026-11-21 各頁資料小巧思（第一批）
- 做了：依設計審查（審查修正：用「今天{時段}有登記營業」、分機不進 tel:、垃圾車時段用結束時間判斷並有「現在這個時段」、英文卡片的時段與震度、空品黃色對比）：藥局「今天下午有登記營業」（健保署只登記上午、下午、晚上，所以不說營業中）、電話 `tel:` 一鍵撥；地震最大震度分色；垃圾車兩小時內倒數「再 N 分」、已過變淡；股市每列漲跌色條；天氣頁首依氣溫、空品頁首依 AQI 變色；卡片動作按鈕 ≥ 44px。
- 測試：npm test 529 項全過（藥局時段、垃圾車倒數、震度分色、頁首變色）；E2E 57 項全過
- 文件：UX.md、PLAN.md（第二批列入）、PROGRESS.md
- 下一個：第二批小巧思、S12f 英文其餘
- 卡住：油價週漲跌需要上週牌價資料

## 2026-11-21 首頁格子點進去的頁首（動畫與圖示）
- 做了：Austin：「首頁裡面每個項目點進去都要有美美的動畫與圖示」。新增 `page-hero.js`，外殼 `#pagehero` 依頁面的 `hero` 顯示：格子代表色淡色頁首、56px 立體圖示、一句說明、資料來源；點格子時圖示從格子飛進頁首（View Transitions：home.js 送 `abang:go`，app.js `startViewTransition` 等換頁完成）；14 個服務各自的圖示小動作；reduced motion／精簡模式不動。`TILE_COLOR` 移到 `registry.js` 並新增 `HERO`。SW v0.8.7。設計審查修正：附近切 YouBike 頁首跟著換；小動作做 3 次就停、點圖示再做；發票空狀態不截斷；圖示邊緣不鋸齒；內容多的頁面精簡頁首；說明改成「在這裡可以做什麼」（不重複卡片標題）；台鐵、空品顏色分開；位置併到頁首資料來源一行；天氣欄位名稱不斷行；地震輸入提示不截斷。其餘建議（各頁資料小巧思）列入 PLAN。
- 測試：npm test 528 項全過；E2E 57 項全過（新增：天氣、地震、附近、高鐵、股市點進去有頁首、說明、資料來源、圖示在動；設定頁沒有頁首）
- 文件：UX.md §4.16、PLAN.md、PROGRESS.md
- 下一個：各頁設計審查的修正
- 卡住：無

## 2026-11-21 公車街景會動
- 做了：Austin：「公車會動吧，讓他動起來」。審查修正：存起終點與開始時間、重畫時算現在實際位置（不往前跳）；只開這筆資料剩下的時間（dataAt，提早重畫不多開、舊資料不開）；同一台站數變少不往回開、不超過下一站；剛到站才煞車點一下；開到了就不再震動；推估不出來時清掉狀態。`bus-scene.js` 新增 `driveTo`（兩次更新之間照到站時間往站牌開，最多到站牌前一點；太遠不動）；開車中 `.moving`（震動、前後晃）、到站 `.at-stop`（煞車點一下再停著）；站數沒變的更新從剛剛開到的地方繼續、不往回跳。reduced motion、精簡模式不動。
- 測試：npm test 528 項全過（driveTo）；E2E 56 項全過（新增：公車往站牌開、資料更新不往回跳）
- 文件：UX.md §4.15、PLAN.md、PROGRESS.md
- 下一個：首頁各項目頁面動畫與圖示（Austin）
- 卡住：無

## 2026-11-21 阿幫常駐：對話保留＋浮動阿幫＋提醒泡泡
- 做了：Austin 回報「請阿幫跳去看公車動態，整個紀錄都會不見」、希望阿幫浮在整個 App 上、能提醒與互動。新增 `public/js/abang-dock.js`：問阿幫頁 `keepAlive`（只建一次，換頁收起不清掉、回來原樣與捲動位置）；浮動阿幫（右下角，`<dialog>` 從下方拉出同一段對話，阿幫帶你去別頁時自動收回）；提醒由阿幫說（到站、下車、公車一直不來：記在對話裡，其他頁浮動阿幫冒泡泡，「改其他方式」直接問）。`agent.js` render 回傳 `{ show, say, focus, ask, hasChat }`；`app.js` 換頁先 `detachMain`。SW v0.8.6。審查修正：卡片不在畫面上不刷新、只有最近兩輪的卡片自動刷新（`stop()`）；iOS 鍵盤時面板跟著可見高度（`--vvh`／`--kb`）；打字中提醒改用提示；阿幫還在回答時的新問題排隊不丟；Android 返回鍵直接 close() 也收尾（close 事件）；「放大成整頁」停在最新對話；讀屏用常駐即時區域、泡泡在手指或焦點上時不自動收；防詐對話不保留（貼上的內容離開就清掉）；捲動時浮動阿幫縮小變淡；收起按鈕 44px；有對話小點即時更新。重新建置手機 App 並裝到 Pixel。
- 測試：npm test 527 項全過；E2E 56 項全過（新增：開公車頁再回來對話還在、浮動阿幫拉出同一段對話、Esc 收回焦點回按鈕、提醒泡泡與改其他方式、回到問阿幫頁兩輪與提醒都在）
- 文件：UX.md §4.14、PLAN.md、PROGRESS.md
- 下一個：首頁各項目頁面的動畫與圖示（Austin）、公車街景會動（Austin）
- 卡住：無

## 2026-11-21 行程中模式
- 做了：公車頁坐車中畫面（設了下車提醒：大字「約 N 分到「下車站」」、不再給到站提醒、街景站牌換下車站且看得出是我這台才畫車、時間軸標「你在這下車」）；每一頁上方的進行中列 `trip-bar.js`（坐車中／等車中，點了回公車頁，在那條路線的公車頁不顯示）；問阿幫選公車後「上車後提醒我下車」（公車頁 `?alight=1` 焦點在選下車站）；`alight.js` 新增 `rideLeftSec`／`rideLeftText`；街景 `riding`（讀屏與「快到了，準備下車」）；`host-web.js` 匯出 `currentArrivalWatch`。SW v0.8.5。審查修正：設下車提醒時取消同路線的到站提醒（坐車中畫面也列出還在的提醒並可取消）；重畫保留焦點（選下車站、取消、提醒按鈕）；只有坐車中⇄等車中切換才整頁重畫；進行中列每 30 秒與回到前景更新、等車中說「在 X 上車・約 N 分到站」、同路線別站或別方向照樣顯示、›不念；「上車後提醒我下車」取代開公車頁（有車要來、還沒設時），沒車或已在坐車中不建議；還沒上車不把前一班當我這台；網址 dir 改為方向值（環狀線）。
- 測試：npm test 525 項全過（新增 test/trip-bar.test.js 3 項、next-steps 更新）；E2E 55 項全過（下車提醒加：坐車中畫面、進行中列、點回公車頁、取消回等車中；新增上車後提醒我下車）
- 文件：UX.md §4.13、PLAN.md、PROGRESS.md
- 下一個：S12f 英文其餘
- 卡住：無（第二版 Doze 備援、鎖定畫面倒數需原生評估）

## 2026-11-21 S1c 定位失敗說原因＋到設定開啟
- 做了：`locationReason` 把原生外掛錯誤碼與網頁錯誤分成權限沒開、定位服務關閉、逾時、其他；`lastLocationError` 記最近一次原因。新增 `public/js/location-help.js`（說明文字、開設定、頁面說明區塊）與專案內外掛 `AbangSystem.openSettings`（Android：權限開 App 設定、定位服務開系統定位設定；iOS：App 設定）。附近、生活服務頁定位失敗時說原因＋再試一次（App 多「到設定開啟」，回來自動再定位）；問阿幫定位泡泡依原因說並附按鈕；設定頁權限區「到設定開啟」、Android 拒絕過一次另外顯示、回到畫面重新檢查；引導失敗說原因。SW v0.8.4。審查修正：先掛好「回來就重試」再開設定（iOS 回前景才收到結果）、離開頁面拿掉；設定頁定位服務關閉另外顯示（checkPermissions 丟 0007）；iOS 定位服務關閉不給按鈕（App 設定頁沒有總開關）；各平台設定路徑（Android 權限 → 位置資訊、iOS 設定 → App → Abang → 位置）、網頁「瀏覽器的網站設定」；只有文字是即時區域；開不了設定要說、Android 找不到定位設定改開系統設定且用 Activity 開；引導不說「再試一次」；逾時放棄的舊呼叫晚到不蓋掉原因。
- 測試：npm test 521 項全過（新增 test/location-help.test.js 5 項）；E2E 53 項全過（新增：附近拒絕定位說原因、再試一次不重疊）；Android 編譯、iOS 模擬器編譯
- 文件：UX.md §4.12、PLAN.md、CLAUDE.md、PROGRESS.md
- 下一個：行程中模式
- 卡住：實機確認「到設定開啟」（Android、iPhone）

## 2026-11-21 文件同步與待辦總表
- 做了：PLAN 狀態看板（M13 到 S19、下一個任務）、新增「待辦總表」（開發可繼續做的 vs. 需要 Austin）、被卡住的項目加安全情境審核、隱私權政策〔待補〕、門牌地址；CLAUDE.md 進度、文件網站 M13 列同步
- 測試：無程式變更
- 文件：PLAN.md、CLAUDE.md、docs/index.html、PROGRESS.md
- 下一個：S1c 定位失敗原因與開啟 App 設定
- 卡住：無

## 2026-11-21 S1b 常用地點用地名設定
- 做了：設定頁每個常用地點多一個「輸入地點」：打車站、捷運站、地標名稱，用 `find_place` 查、列最多 5 個台灣範圍內的結果，選一個就存（已設定時先確認）；不必人在那裡。列上顯示「已設定：板橋車站」，用現在位置設的顯示「已設定（用當時的位置）」。畫面照實說「目前查不到門牌地址」。按鈕改成一組，放不下時換行（地點名稱不再被擠成直排）；搜尋框在同一個 listitem 裡。沒設定「家」時的回答也提到「輸入地點」。隱私權政策加一句：輸入地點時，打的地名送到伺服器查座標（不送位置）。SW 快取 v0.8.3。審查修正：結果是按鈕（外層 listitem）、只採用最後一次搜尋、搜尋中停用按鈕、存不了要說、結果帶縣市（`find_place` 新增 `cityName`）、狀態文字與結果分開、伺服器英文錯誤換成中文、Esc 收起、一次只開一個、隱私權政策補「與名稱」。
- 測試：npm test 516 項全過；E2E 51 項全過（設定頁 E2E 加：輸入地點設公司、選結果、收起、存的名稱；find_place 測 cityName）
- 文件：UX.md §設定、MCP_TOOLS.md（find_place cityName）、PLAN.md（S1b ✅、新增 S1e 門牌地址）、PROGRESS.md
- 下一個：S1c 定位失敗原因與開啟 App 設定；文件同步與待辦清單
- 卡住：門牌地址需要地址轉座標的資料來源（S1e）

## 2026-11-21（續）S18 安全情境

- 做了：`core/agent/safety.js`（自傷、正在發生的緊急狀況；中英文；排除口語誤判）；示範與模型模式、所有 agent 都在最前面判斷，回固定求助說明與 guardrail 事件，不查工具、不請定位、不問模型。
- 測試：npm test 516 項全過（新增 safety 四項、情境 S19-1～3）；E2E 50 項。
- 文件：AGENT §5.2.10、PLAN、PROGRESS。
- 下一個：行程中模式或 S12f。
- 卡住：電話與用語建議請專業人員（心理衛生、緊急應變）確認後再上架。

---

## 2026-11-21（續）S12e 英文：到站通知、出門建議與藥局

- 做了：卡片 ctx 帶 `locale`，英文公車卡設的到站提醒記下 `lang`，通知標題與內文英文（App 重開恢復也保留）；英文意圖 outing（bring/wear/umbrella/go out）、pharmacy；出門建議項目帶數字，英文卡片用字典組句；英文總結與小幫手回報（出門建議、藥局）；藥局的說明英文。
- 測試：npm test 507 項全過；E2E 49 項（英文出門建議卡）。
- 文件：AGENT §5.2.7、PLAN、PROGRESS。
- 下一個：行程中模式或 S5。
- 卡住：無。

---

## 2026-11-21（續）S12d 英文：小幫手回報、卡片資料

- 做了：`core/tools/speak-en.js`（找地點、行程、天氣、明天、空品、出門建議、YouBike、附近公車、公車路線、捷運、高鐵台鐵、路況）；`execTools` 的 `lang`（示範與模型模式）；英文那一輪不附中文「→ 影響」；公車盯到站說明英文；字典加空品狀態、主要污染物、「你的位置」，空品卡、出門建議卡、行程卡標題套用。
- 測試：npm test 505 項全過；E2E 48 項（英文提問的小幫手回報、空品狀態、行程卡標題）。
- 文件：AGENT §5.2.7、PLAN（S12e 待做）、PROGRESS。
- 下一個：行程中模式或 S5。
- 卡住：無。

---

## 2026-11-21（續）S12c 英文：討論串、決策圖、接下來可以

- 做了：`en-notes.js`（英文那一輪的小幫手說明；@標籤保留）；討論串標題、收合摘要、「同上」英文；決策圖 `lang` 選項（步驟、欄位、狀態、排除標籤、明細；中文理由句不顯示）；「接下來可以」英文（狀態、提醒、公車頁）；狀態建議改用 `data-state` 對應（不看文字）；點決策圖方案送「Switch to MRT instead」。
- 測試：npm test 504 項全過（新增 en-notes 兩項）；E2E 48 項（英文提問的討論串、決策圖、建議）。
- 文件：AGENT §5.2.7、PLAN（S12d 待做）、PROGRESS。
- 下一個：S12d 或 S5。
- 卡住：無。

---

## 2026-11-21（續）下車提醒

- 做了：`public/js/alight.js`（從到站時間的順序找「我這台」、站序對站、設定前後上車都估得準、看不出來才照時間；App 設定當下就排通知、重開時已響過不重響）；公車頁下車站選單、進行中與取消；App 本機通知與重開恢復；清除本機資料一併取消。順手修上車站卡片的兩欄格線讓新區塊與「一直不來」整列顯示。
- 測試：npm test 502 項全過（新增 alight 六項）；E2E 47 項（選下車站、進行中、取消）。
- 文件：UX §4.11、PLAN、PROGRESS。
- 下一個：S12c 或行程中模式。
- 卡住：無。

---

## 2026-11-21（續）S15 公車一直不來：建議改其他方式

- 做了：`stuckReason`（比第一次預估晚 10 分以上、連續 3 次未發車／末班已過；換下一班不算）；公車卡片警示＋「改其他方式」（送給阿幫沿用起訖、排除公車）；App 外殼 toast；同一句又提到又說不要的方式算不要。
- 測試：npm test 496 項全過（新增 bus-stuck 四項）；E2E 46 項（卡片建議與送出的話）。
- 文件：CARDS、AGENT §5.2.7b、PLAN、PROGRESS。
- 下一個：S12c 或 S5。
- 卡住：無。

---

## 2026-11-21（續）S16 附近的藥局依位置查行政區

- 做了：`weather.district`（真實：最近觀測站的縣市鄉鎮＋測站與距離；示範：`weather-mock.js` 內建 17 個行政區大約中心，6 公里內）；`pharmacy_search` 收 `lat`／`lon`（沒說地區時依位置推估並說明，有 query 也限在那一區）；示範與模型模式「附近的藥局」先定位、說了地標用地標推估、說了哪一區直接查（模型模式不問位置）；「附近的社區藥局」不再被當成行政區。
- 測試：npm test 492 項全過（新增 pharmacy-near 四項）；E2E 45 項。
- 文件：MCP_TOOLS、PLAN、PROGRESS。
- 下一個：S11／S15 公車一直不來時重新規劃或 S12c。
- 卡住：無。

---

## 2026-11-21（續）S12b 卡片英文

- 做了：`i18n/en.js`（237 鍵，子代理翻譯、鍵與佔位符比對）、`i18n/index.js`（tFor、withLocale；缺鍵退回中文）；`renderCard` 依 `payload.lang` 用英文、`<section lang="en">`；共用按鈕與倒數同語言；問阿幫英文提問那一輪卡片英文；改選方案送交通方式；英文總結不再說卡片是中文；「估算」標籤不用全形括號。順手修出門提醒「同一分鐘同文字＝同一筆」（測試偶發失敗）。
- 測試：npm test 487 項全過（新增英文字典與 runtime 兩項）；E2E 45 項（英文提問 → 英文卡片、地名中文、再用中文問回到中文）。
- 文件：CARDS、AGENT §5.2.7、PLAN（S12c 待做）、PROGRESS。
- 下一個：S12c 或 S5。
- 卡住：無。

---

## 2026-11-21（續）離線與弱網

- 做了：`api.js` 只存允許的查詢（到站 10 分鐘、路線與時刻表 24 小時；有座標不存；30 筆、300 KB；過期刪掉）；連不上、逾時、閘道錯誤、Wi-Fi 登入頁時顯示上次的資料與常駐黃底提示；舊的到站資料不念、不給提醒；連回來重新載入；連線錯誤說中文；隱私權政策照實寫。
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
