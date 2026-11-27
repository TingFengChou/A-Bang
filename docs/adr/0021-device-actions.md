# ADR-0021：阿幫動手做——裝置動作由系統畫面做最後確認

狀態：已採用（2026-11-27）

## 背景

阿幫已經會「聽懂」（ADR-0014）、「查資料」（MCP tools）、「做決定」（ADR-0010），但結論停在卡片上：要加行事曆、傳給家人，使用者得自己抄。兩大平台都開始讓 AI 驅動 App 與系統功能：

- **Android**：AppFunctions（`androidx.appfunctions` 1.0.0，2026-11-18 穩定；Android 16 以上、Kotlin＋KSP；Gemini 呼叫要申請 Connected Apps Platform 預覽）。ML Kit Prompt API 的 function calling 仍是預覽（Gemini Nano 4、Kotlin 2.3、minSdk 26）。
- **iOS**：App Intents／App Schemas 讓 Siri 執行 App 的動作（schema 領域沒有大眾交通）；Foundation Models 的 `Tool` 讓手機上的模型呼叫 App 的功能（與 App Intent 是兩套協定，沒有官方橋接）。
- **Google AI Edge Gallery**：Mobile Actions 用 FunctionGemma 270M 把一句話對應到系統 Intent（手電筒、聯絡人、寄信、地圖、Wi-Fi 設定、行事曆）；每個工具背後就是一個 Intent。FunctionGemma 沒有宣稱支援中文。

研究紀錄見 2026-11-27 的 `PROGRESS.md`。

## 決策

分三個階段；本 ADR 決定第 0 階段，並訂下所有裝置動作共用的規則。

1. **裝置動作只「準備」，最後一步由系統畫面確認**：
   - 加到行事曆：開系統的新增行程畫面（iOS `EKEventEditViewController`、Android `Intent.ACTION_INSERT` 到 `CalendarContract.Events`），使用者在那裡按「加入」才寫進去。
   - 分享：開系統分享面板（iOS `UIActivityViewController`、Android `Intent.ACTION_SEND` chooser），使用者自己選對象、按送出。
   - 網頁：行事曆下載 `.ics` 檔；分享用 Web Share API，不支援就複製文字。
   - 這等同 ADR-0011 的「L2 需確認」：系統畫面就是確認畫面，阿幫不另外跳確認視窗，也不代替使用者按下最後一步。
2. **不要求新權限**：iOS 17 以上的新增行程畫面在 App 外執行，不需要行事曆權限；iOS 15～16 才會問一次（`NSCalendarsUsageDescription`）。Android 走 Intent，不需要權限。阿幫不讀行事曆、不讀聯絡人。
3. **內容由程式產生，不經模型**：事件標題、時間、地點、分享文字都由 `core/device-actions.js`（純函式，伺服器與手機共用）從卡片資料產生，數字與時間來自資料。
4. **兩個入口，同一套 host 動作**：
   - 卡片按鈕：行程卡片的建議方案下有「加到行事曆」「分享」。
   - 對話：使用者說「加到行事曆」「傳給我媽」，判斷層認出意圖 `calendar`／`share`，伺服器回「阿幫問你」的動作選項（`addCalendar`／`share`，ADR-0016），手機執行同一個 host 動作。對話裡沒有可用的行程時，請使用者先查一班車。
5. **MCP 與 REST 不執行裝置動作**：MCP Apps host 沒有這兩個 host 方法，按鈕不顯示；動作只在使用者自己的手機或瀏覽器上發生。
6. **之後的階段**（各自另開任務，需要時再寫 ADR）：
   - 第 1 階段：iOS App Intents＋App Shortcuts（查公車、規劃行程、天氣、查詐騙），Siri／捷徑／Spotlight 能叫到阿幫；實驗把 iOS 判斷改用 Foundation Models `Tool`，以 224 題評測決定。
   - 第 2 階段：Android AppFunctions（要加 Kotlin＋KSP，屬新依賴，等產品負責人決定）。
   - 暫不做：打包 FunctionGemma（288 MB、中文未驗證）、手機上的 MCP client（實驗中）、ML Kit function calling（預覽、需 minSdk 26）。

## 補充：第 1 階段的做法（2026-11-27，M16-02）

- App Intents 只「把事情交給 App」（`openAppWhenRun`）：問題、可疑訊息、要開的頁面放進收件匣，App 打開後照原本的流程查。原生端不呼叫 API、不讓 Siri 直接念工具結果——防詐要經過防詐 agent 的完整判斷與護欄（實測 `scam_check_message` 單獨的結果可能低估釣魚簡訊）。
- 捷徑說法用繁體中文（iOS 開發語言改成 zh-Hant），另附英文說法。
- 之後若要「不開 App 直接回答」，要先有答案也經過同一套程式護欄的設計，再另寫決定。

## 不採用

- **模型直接呼叫系統 API（function calling 自動執行）**：違反 ADR-0011；判錯時會在使用者沒看清楚前就動到行事曆或傳訊息。
- **阿幫直接寫入行事曆（EventKit 寫入權限、Calendar Provider）**：要權限，而且跳過系統確認畫面。
- **鬧鐘**：iOS 只有 AlarmKit（要授權、iOS 26 以上）；阿幫已有到站與出門提醒（本機通知），先不重複。

## 影響

- 新檔 `core/device-actions.js`（經 `/core/` 給前端，`SHARED_CORE`、`build-app.js`、`sw.js` 都要列）。
- host 介面多 `addCalendar(event)`、`share(payload)`（`CARDS.md` §3）；`ASK_ACTIONS` 多 `addCalendar`、`share`。
- 判斷層多兩個意圖 `calendar`、`share`（`JUDGE_INTENTS`、手機上的指令、Swift `edgeIntents`、訓練資料與評測集）。
- `AbangSystem` 外掛多 `addCalendarEvent`、`share`（iOS 加 `NSCalendarsUsageDescription`）。
