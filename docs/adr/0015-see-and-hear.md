# ADR-0015：裝置端的聽與看：手機上先讀懂，只送文字

狀態：已採用（2026-11-21，產品負責人：「讓阿幫會看」「處理在手機上優先，照片不上傳」）

## 背景
阿幫要能「看」（拍可疑簡訊或選截圖查詐騙、拍站牌路牌問怎麼走、拍發票自動對獎）和「聽」（說話問阿幫）。
照片和聲音比打的字更私人：簡訊截圖有電話、名字、帳號；錄音有旁人的聲音。阿幫的伺服器與模型（ADR-0012）只需要「文字」就能回答，
手機本身已經有不用下載、不經網路的文字辨識（Android ML Kit、iOS Vision）與語音辨識。ADR-0014 已經讓手機先判斷意圖；這份把同樣的原則延伸到看與聽。

## 決策
1. **手機上優先，只送文字**：照片與聲音只在手機上變成文字（或發票號碼），影像、錄音不上傳、不保存。讀出來的文字先顯示給使用者（「阿幫看到了：…」），**確認後才送出**（ADR-0011 行動需確認）；可以改、可以遮住號碼。
2. **看（M14-02）**：專案內 Capacitor 外掛 `AbangVision`（`available()`、`capture({ source: 'camera'|'photos', want: ['text','barcode','describe'] })`，讀到時送 `stage` 事件讓前端播「阿幫在看」）。
   - Android（`android/app/src/main/java/tw/abang/app/AbangVisionPlugin.java`）：
     - 拍照：系統相機（`MediaStore.ACTION_IMAGE_CAPTURE`）寫到 App 私有暫存檔 `cache/vision/shot.jpg`，讀完立刻刪除；App 已宣告 `CAMERA`（舊的網頁掃描），所以第一次拍照時才要權限（Capacitor `requestPermissionForAlias`）。
     - 選圖：系統相片選擇器（`ActivityResultContracts.PickVisualMedia`，ImageOnly；沒有 Photo Picker 的舊手機自動改文件選擇器），不需要相簿權限。
     - 讀字：ML Kit Text Recognition v2 中文模型 `com.google.mlkit:text-recognition-chinese:16.0.1`（打包在 App 內，離線可用）；條碼：`com.google.mlkit:barcode-scanning:17.3.0`（打包版，只找 QR、Code 39）。長邊縮到 2560 px、依 EXIF 轉正。
     - 影像理解（選用）：Gemini Nano（ML Kit GenAI Prompt API，`ImagePart`）回一個分類提示（sms／sign／invoice／other）。系統**沒有**「是否支援影像輸入」的查詢，第一次試了才知道；結果記在 SharedPreferences（只有 ok／no）。分類仍以讀字＋規則為主，提示只在規則認不出來時參考。
   - iOS（`ios/App/App/AbangVisionPlugin.swift`）：拍照 `UIImagePickerController`（`NSCameraUsageDescription`，第一次才問）、選圖 `PHPickerViewController`（在 App 之外執行，不需要相簿權限）；讀字 Vision `VNRecognizeTextRequest`（accurate、`zh-Hant`＋`en-US`、語言校正）；條碼 `VNDetectBarcodesRequest`（QR、Code 39）。照片只在記憶體。Foundation Models 不收圖片，**不回報**影像理解。
   - 前端 `public/js/vision.js`（與平台無關）＋規則 `core/vision-text.js`（純函式，伺服器以 `/core/vision-text.js` 提供，App 打包時一起複製）：條碼先看（發票左邊 QR → `parseInvoiceCode`），再看字：發票字樣 → 強烈詐騙訊號（網址、驗證碼、轉帳）→ 站牌路牌（路線號碼、站名、路名）→ 其他詐騙訊號 → 只有字。
   - 流向：可疑訊息 → 防詐 agent 的 `scam_check_message`（跟貼上文字一樣；生活頁先問「要幫你檢查這則訊息是不是詐騙嗎？」，答應才轉到防詐頁，文字只在記憶體交過去，不放網址）；站牌 → 組好的問題（「307 公車到「敦化市場」還要多久？」）讓使用者改了再送；發票 → 存進「我的發票」並馬上對獎（`invoice_check_batch`）。
3. **聽（M14-01，概要；細節由語音任務補）**：專案內外掛 `AbangVoice`，用系統的語音辨識（手機上能離線就離線），只把辨識出的文字放進輸入列，同樣由使用者送出。
4. **網頁版降級**：不把照片或聲音送伺服器。網頁版只有瀏覽器內建的本機辨識（Shape Detection API：`TextDetector`、`BarcodeDetector`）才提供；只有 `BarcodeDetector` 時只能讀發票（並說明讀簡訊、站牌要用 App）；都沒有就不顯示相機鍵。發票頁維持原本的連續掃描與手動輸入。
5. **可以關**：設定頁「讓阿幫看照片」（`localStorage abang.vision = off`）；關掉時輸入列不顯示相機鍵、發票頁改回網頁掃描。
6. **看得到**：「阿幫的腦袋」（`#/ai`）加「阿幫會看」卡：讀字引擎、條碼、影像理解（只在外掛回報時顯示）、相機權限、開關；只列系統真的回報的能力。

## 不採用
- **把照片送伺服器讓大模型看**（Claude vision 等）：效果較好，但照片含大量個資，且違反「手機上優先」；之後若要做，需另一份 ADR 與明確同意。
- **@capacitor/camera**：選圖在 Android 13 以上也用 Photo Picker、不需要相簿權限，但它把整張照片（base64 或檔案路徑）交回 JS，再傳回原生讀字要多一次大資料往返，且相機照片預設寫進檔案；自己的外掛讓照片從頭到尾只在原生端，讀完就丟。
- **CameraX 自己做取景畫面**：可以連續掃描，但要多寫一整個相機 UI；第一版用系統相機拍一張就夠（發票頁仍可一張接一張拍）。
- **不打包的 ML Kit（Google Play 服務下載模型）**：App 較小，但第一次要下載、Play 服務不在的手機（部分中國品牌）不能用；產品要求「不需要下載」。

## 影響
- 新增 Android 依賴 `com.google.mlkit:text-recognition-chinese:16.0.1`、`com.google.mlkit:barcode-scanning:17.3.0`（Google ML Kit，ML Kit 服務條款）。打包版帶各 CPU 架構的原生函式庫：debug APK（四種架構都包）從約 10 MB 變約 74 MB；上架用 App Bundle 時每支手機只下載自己的架構（arm64 約多 16 MB）。要更小可再評估 `abiFilters` 或改用不打包版。
- iOS 只用系統 framework（Vision、PhotosUI、AVFoundation），不增加套件；`Info.plist` 加 `NSCameraUsageDescription`。
- Android 拍照依賴手機上的相機 App；少數廠牌相機 App 可能另存一份到相簿（系統行為，阿幫無法控制），隱私權政策照實寫「阿幫不保存」。
- `core/agent/demo-intent.js` 認得問題裡的站名（`busStopOf`）；`bus_route_eta` 有站名但沒給縣市時用位置推縣市（不改成最近的站）。
- Service worker SHELL 加 `vision.css`、`vision.js`、`/core/vision-text.js`；`scripts/build-app.js` 複製 `core/vision-text.js`。
- 實機待確認：Pixel（ML Kit 中文辨識率、Gemini Nano 是否支援影像）、iPhone（Vision 繁體中文辨識率、相機權限流程）。
