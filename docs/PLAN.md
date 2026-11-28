# 開發計畫與里程碑

版本：v0.6（2026-11-21）

規則：

- 一次做一個任務（以任務代號為單位，例如 `M3-04`），照 `docs/LOOP.md` 的循環執行。
- 任務完成要符合 `CLAUDE.md` 的「完成的定義」，並在此勾選、寫日期與一行備註。
- 標 ⛔ 的任務被外部條件卡住（金鑰、權限、網路）：先做不受影響的部分，其餘寫進 §狀態看板的「卡住」欄，不要猜測欄位。
- 標 🧩 的任務是為 M9 平台預留的擴充點（ADR-0007、`PLATFORM.md` §11），範圍很小但不可省略。

```
M0 基礎 ✅ ─▶ M2 Registry＋遠端 MCP ✅ ─▶ M3 交通完整版 ✅ ─▶ M4 互動卡片 ✅ ─▶ M5 網頁 agent ✅ ─▶ M6 上線 🚧
     M1 TDX 實測 ✅（2026-11-23）
─▶ M7 反詐騙 ─▶ M8 中小企業概念驗證 ─▶【啟動門檻】─▶ M9 阿幫平台（Agent Builder）
```

## 狀態看板

| 里程碑 | 狀態 | 下一個任務 | 卡住 |
|---|---|---|---|
| **V 整體驗證（2026-11-28 起，暫停新功能）** | 🚧 **V1 ✅**；V5-1、V5-2 ✅（Pixel 實機）；V2-1 ✅；V2-2 ✅ 地端模型 227／260；V3 巡檢開始；發現 F1、F3（等決定）、F2、F4（已修） | V2-2 評測結果；V3 手動驗收 | V5 實機語音與出門一趟、V6 CWA 授權碼、V7 Claude 連接器與金鑰要 Austin |
| **H 首頁改版「夜色與光」（2026-11-29 起，ADR-0023；驗證期唯一解凍項目）** | 🚧 H0～H4 ✅ | H5 全站「您」 | — |
| M0 基礎 | ✅ | — | — |
| M1 TDX 實測 | ✅（2026-11-23：`verify-tdx.js`、`record-fixtures.js`、真實 fixture 測試；導訂票 API 待權限） | — | 導訂票 API 需權限 |
| M2 Registry＋遠端 MCP | ✅（Claude 實機連線待驗） | — | Austin 以 cloudflared 實測 |
| M3 交通完整版 | ✅（2026-11-18 驗收；M3-12 真實導訂票 ⛔） | — | 待 Austin：無狀態市區短程叫車排第一是否合理（ADR-0010）；`rail_booking_link` 需導訂票權限；`weather_now` 真實資料需 CWA 授權碼（mock 與介面已完成） |
| M4 互動卡片 | ✅（2026-11-18；M4-09 Claude 實測 ⛔） | M4-09（Austin） | 本機 `npm start`＋cloudflared，在 Claude 自訂連接器實測卡片 |
| M5 網頁 agent | ✅（2026-11-18；Claude 實機待金鑰） | — | Claude 模式需 `ANTHROPIC_API_KEY`；地端模式需自架 Ollama 等（示範模式都不需要） |
| M10 生活開放資料 | ✅（2026-11-19） | — | 空品需 `MOENV_API_KEY`、地震需 `CWA_API_KEY`（沒有時示範片段）；藥局資料沒有座標 |
| M7 反詐騙 agent | ✅（2026-11-19；規則庫待專家審核） | — | 規則庫 `reviewedBy` 待防詐專家審核 |
| M11 行動 App | 🚧（M11-01 殼、M11-02 本機通知、M11-03 原生相機掃發票、M11-04 啟動畫面與隱私權政策、名稱 Abang、iOS 18 深色／著色圖示、返回手勢、原生定位、鍵盤、首次使用引導、離線顯示上次資料 ✅） | M11-05 測試環境與上架 | 給別人用需 HTTPS 測試環境（M6-06）與開發者帳號；iOS 實機需 Austin 的 iPhone |
| M12 裝置端 AI（ADR-0014） | 🚧 第一階段 ✅（2026-11-21：Gemini Nano 實機、Apple Intelligence 模擬器、E8 設定開關 ✅；E7 回答也在手機上寫 ✅ ADR-0017；E3 手機上的小模型 ✅ 2026-11-23） | — | iOS 實機數據需 iPhone 15 Pro 以上並開啟 Apple Intelligence |
| 阿幫常駐與頁面質感（Austin 2026-11-21） | ✅（PR #69～#81：對話保留、浮動阿幫、提醒泡泡、知道你在哪一頁、App 重開後上次的對話、公車會動、格子頁首動畫、各頁小巧思兩批、英文其餘、Android 實機煙霧測試） | — | — |
| Agent 聰明度：模型模式與 PM 第二批（2026-11-21） | ✅（PR #79、#82：地端模型模式 72→97／99；PM P2-1～10 全過） | PM 第三批 | — |
| M13 Agent 聰明度（PM 情境 S1～S19） | 🚧（情境集 89 個＋PM「該問就問」Q 情境 27 個（`life-q.json`，全過）、todo 0：位置當起點、接著改、新狀態、出門建議、明天天氣、末班車、捷運轉乘、高鐵台鐵最近站、英文與卡片／討論串／決策圖英文、常用地點、多人同行／可能下雨／時間很緊、出門建議小卡、出門提醒多筆、附近藥局依位置、公車一直不來、下車提醒、安全情境（求助電話）、常用地點用地名設定、定位失敗說原因、行程中模式 ✅） | S12f 英文其餘 | 真實末班車、捷運路網需 TDX 金鑰 |
| M14 阿幫聽得懂、看得懂（產品負責人 2026-11-21；ADR-0015） | 🚧（M14-01 語音問阿幫 ✅、M14-02 看 ✅） | 實機確認（Pixel、iPhone） | iOS 實機需 Austin 的 iPhone；打包版 ML Kit 讓 APK 變大（產品負責人已同意） |
| M15 健康與運動（產品負責人 2026-11-22；ADR-0018） | 🚧（M15-01 天氣好又動得少時建議去走走 ✅，待產品負責人看截圖） | 實機確認（Pixel Health Connect、iPhone HealthKit） | iOS 免費個人開發團隊可能不能簽 HealthKit（開發版改用不含 entitlement 的建置，App 裡反白說原因）；上架前 Play Console 健康資料聲明 |
| 阿幫・短劇（MyDrama，產品負責人 2026-11-22，ADR-0019） | 🧩（等車推短劇、問阿幫找劇、運動建議提示句 ✅；示範片庫可跑） | 產品負責人看截圖決定是否合併；運動建議接線 | 真實片庫與連結需 `.env` 的 `MYDRAMA_*`（合作方提供）；每集長度欄位 |
| M16 阿幫動手做（ADR-0021，2026-11-27） | 🚧（M16-01 加到行事曆、分享 ✅；M16-02 iOS App Intents ✅；M16-04a 去政府辦事要帶什麼 ✅；M16-04b 最近的戶政事務所 ✅；M16-04c 護照等待人數 ✅；M16-04d 官方入口 ✅；M16-04e 現在有看診的診所 ✅） | M16-02b 實機 Siri；M16-04 待驗證項目 | M16-03 Android AppFunctions 要加 Kotlin＋KSP（新依賴，等產品負責人決定）；Gemini 呼叫要申請 Connected Apps Platform 預覽 |
| M6 上線 | 🚧（M6-01／02／04／07 ✅、地端部署驗證 ✅） | 正式環境階段再做 | 2026-11-19 Austin 決定：雲端部署（M6-06）、Redis 快取（M6-03）、Lighthouse（M6-05）留到正式環境階段；先衝刺功能。M6-07 需在 repo 設定啟用 Pages |

建議順序：M1、M4、M5、M7、M10 已完成；M6 正式環境項目延後；目前衝刺 M11 行動 App、M12 裝置端 AI、M13 Agent 聰明度（PM 情境清單見 `test/scenarios/life.json`）；M8 中小企業概念驗證移到下一階段。

## V 整體驗證（Austin 2026-11-28：「先停下開發，等完整驗證過後繼續往下」）

暫停新功能，基準 main `af139ae`。驗證期間只修驗證找到的問題（一樣 PR、CI 綠燈才合併）。開著的功能 PR（#219 上游錯誤說明、#170、#139）暫停。iOS 用模擬器，Android 用實機 Pixel 11 Pro XL。

| 階段 | 內容 | 完成條件 | 狀態 |
|---|---|---|---|
| V1 自動化測試可信 | V1-1 時鐘測試固定時間；V1-2 `npm run test:clock`（5 個時段）進 CI；V1-3 main 連續 3 次 CI 全綠；V1-4 覆蓋盤點 | 各時段全綠、CI 不用重跑、缺口清單 | ✅ V1-1～V1-4（V1-3：#220、#221、#222 合併後 main CI 連續 3 次全綠、沒有重跑） |
| V2 情境集與判斷 | 示範模式情境集全過、TODO／known 列出；地端模型模式沒過的原因；英文 | 清單與原因 | 🚧 V2-1 ✅：260 個情境（life 215、life-q 45）示範模式全過，known 只有 Q-7「去信義」（直接排或先問，等 Austin）→ ✅ 2026-11-28 有了行政區後衝突消失：「信義」附近不只信義商圈（還有臺北市信義區），照 #121「附近只有一個候選才不問」本來就該問，跟 PM 期望一致；現在沒有 known；V2-2 ✅ qwen3:8b（地端模型模式）227／260：life 193／204（沒過的 AS-4、AR-17、S20、LA-8、P2-10 已修；LA-17／18／26 只差說法）、life-q 與 S21 共 34／56。沒過的大多是「先猜一個算給你看、再問一句」的題（去機場、票價沒說起站、拒絕定位問天氣、同名地名）：模型模式直接問、不先算——規則模式的「先猜再問」體驗較好，列入下一步讓模型模式也先算（`model-loop.js` 預抓 `plan_trip` 擴到這幾類） |
| V3 網頁手動驗收 | 首頁與 10 個格子、問阿幫各類、決策圖重算、提醒／設定／我的／腦袋、無障礙、離線與錯誤 | 桌面＋手機 375px 走完 | 🚧 27 個網址巡檢：沒有 JS 錯誤、不存在的網址有處理；發現 F4（已修）；無障礙巡檢 21 頁：每頁 1 個 h1、lang、圖片 alt 都對，發現 F5（已修）；問阿幫 9 類 27 句走查（示範與真實開放資料各一次）：回答正確，發現 F6（已修） |
| V4 iOS 模擬器 | `smoke:ios --build`；定位、通知、相機讀字、行事曆、分享、Live Activity、App Intents | 煙霧測試過＋手動清單 | 🚧 V4-1 ✅ `smoke:ios` 全過（外掛 8、10 頁、語音在手機上、沒有閃退或當機報告）；健康、裝置端 AI 模擬器做不到，留給 iPhone 實機 |
| V5 Android 實機 | `smoke:android`；Gemini Nano、手機寫回答、E3 小模型、語音、相機、提醒常駐、Health Connect；實際搭一趟 | 煙霧測試過＋手動清單 | 🚧 V5-1 煙霧測試全過（Pixel 11 Pro XL、Android 17）；V5-2 Gemini Nano 判斷 0.5～1 秒、手機寫回答可用 |
| V6 真實資料 | TDX（`verify-tdx.js`、額度降級）、氣象署、免金鑰開放資料逐一、MyDrama | 每個來源可用或列原因 | 🚧 V6-3 ✅ 免金鑰開放資料 14 個工具都拿到真資料（藥局、診所、垃圾車、油價、發票、股市、165 網址與闢謠、辦事須知、戶政、護照、官方入口）；交通、天氣、空品、地震、短劇要金鑰（CWA 授權碼待取得） |
| V7 MCP 與 Claude | 連接器實測 7 種卡片與 L2 確認（M4-09）、REST／OpenAPI、Claude 模式（M5-05） | Austin 實測 | 🚧 V7-2 ✅ OpenAPI 3.1：59 條路由、41 個工具路由都有 summary；`/api/docs`、`/healthz` 200。V7-1、V7-3 待 Austin |
| V8 安全與效能 | 全 repo 安全審查、git 歷史掃描（座標、金鑰、個資）、Lighthouse 基準、伺服器 1 小時壓測 | 報告 | 🚧 V8-4 ✅ 壓測（本機，8 併發混合端點）：10 分鐘 1,220 萬次、5 分鐘 607 萬次，連線錯誤 0、限流正常（約 83% 429）；記憶體開始 820 MB（啟動載入嵌入模型、165 九萬多筆、開放資料）→ 高峰 938 MB → 回落 720 MB，沒有洩漏。**部署至少 1 GB 記憶體**；V8-3 Lighthouse 待正式環境；V8-1 ✅ 全 repo 安全審查（4 項：F8 三項已修、F9 等決定；npm audit 0、XSS／路徑穿越／ReDoS／隱私沒發現問題）；V8-2 ✅：678 個 commit 沒有 `.env`、金鑰檔、常見金鑰格式；`TDX_CLIENT_SECRET=` 只有文件裡的中文範例；本機路徑與信箱只在 F7 那兩個檔 |
| V10 主動助手實機驗收（2026-11-28 晚，第十六輪） | #253～#264 上線後 9 項實機清單（iPhone 鎖定畫面倒數、Pixel 通知列倒數與小工具、定位拒絕、飛航模式、大字＋系統大字、阿幫記得你刪除、週末／上班日、快打烊）；清單在 `docs/collab/REVIEW_PRODUCT_AGENT.md` 第十六輪 | Austin 在 iPhone、Pixel 走完 | ⬜ 等 Austin |
| V9 彙整 | 問題分阻擋／重要／小；修完重跑 V1、V2 與受影響的 V3～V5；驗證報告 | Austin 決定恢復開發 | ⬜ |

驗證發現（V9 清單）：
- **F1（重要，等 Austin）**：附近藥局、「附近有醫院嗎」在台北以外查不到（「沒辦法從位置判斷在哪一區」）。座標轉行政區靠氣象署測站；沒有 CWA 授權碼時只有 17 個示範行政區（6 公里內）。藥局、診所資料本身是真的全台資料。修法：CWA 授權碼（V6-2），或內建全台 368 鄉鎮中心點
- **F3（要 Austin 決定）**：main 上 `pages` workflow 每次都失敗（repo 沒開 GitHub Pages），main 一直掛紅叉。開 Pages，或先停用 workflow
- **F8（中，已修）**：V8-1 安全審查
  - (a) `/api/v1/agent`、`/api/v1/suggest/check` 不檢查 content-type，別的網站用 no-cors 的跨站請求就能用光全站每日模型額度 → 只收本站與 App 來源的 JSON（403／415），錯誤回應不帶 `*`
  - (b) 站牌到站、路線搜尋直接打 TDX → 路線搜尋在預熱清單本機篩；清單外的站位 ID 走每分鐘 1 次的關卡
  - (c) `resolveCity('constructor')` 當成縣市 → 只認自己的鍵
- **F9（低，等 Austin 決定）**：Android `allowBackup="true"`：WebView 的 localStorage（常用地點座標、發票號碼）會進雲端備份。取捨：隱私 vs 換手機時資料跟著走。選項：關掉備份，或用 dataExtractionRules 排除 `app_webview`
- **F7（小，已修）**：`private/tmp/…/scratchpad/` 兩個評測報告（2026-11-20 判斷小實驗）不小心進了版控，內容無金鑰，但路徑帶本機使用者名稱 → 移出版控、`.gitignore` 加 `/private/`（歷史保留，內容無害）
- **F6（小，已修）**：示範模式（`DEMO_MODE=1`、CI、公開示範站）問台北中正／大安以外的藥局、診所、垃圾車，回「沒有找到」像那一區真的沒有；示範資料只收了少數地區 → 補一句「現在用的是示範資料，只收了少數地區」（真實開放資料查得到：萬華區藥局 20 家、牙科 17 家、垃圾車 90 公尺）
- **F5（中，已修）**：無障礙巡檢（手機 21 頁）：時刻表頁起訖站、日期沒有讀屏名稱；觸控目標小於 44px——建議 chip、設定頁跳轉、防詐範例 36px，附近／公車分段按鈕 39px，下拉選單 42px，「再看一次使用說明」32px，「跳到主要內容」39px，首頁搜尋框只有中間 26px 點得到 → 補 aria-label、全部 44px
- **F4（中，已修）**：換頁時分頁標題（`document.title`）在首頁、服務、提醒、我的、設定、腦袋、附近、公車沒更新，留著上一頁的（讀屏換頁念錯頁名、瀏覽器分頁名稱錯）→ 換頁先設這一頁的預設標題；e2e 守住
- **F2（小，已修 #221）**：`#/ai` 試判斷第 2 段寫「手機沒給定位」、第 3 段卻用了定位 → 改「會先問手機的定位」

驗證找到、但屬於新功能的（驗證期不做，列入 V9 清單）：PM 第三輪 #4 觀光地名與長途轉車、#6 颱風假／停水／高鐵剩餘座位、坐輪椅推叫車、健保卡掉了；設計第三輪 #3 決策圖手機字級；架構第三輪 #5 前端重複的時間與距離。

## H 首頁改版「夜色與光」（Austin 2026-11-29：採用設計 A；ADR-0023）

規格：`docs/HOME_REDESIGN.md`；原型：`docs/prototypes/home-night-light.html`。驗證期間（V）唯一解凍的開發項目，範圍只限下表；細部取捨照 Claude 與 Antigravity 共同決議（`docs/collab/REVIEW_PRODUCT_AGENT.md` 第十七～十九輪）。Austin 明講不能違反：功能不可以少、特色外顯、用詞正式（「您」）、能從目前位置出發。

| 任務 | 內容 | 驗收 | 狀態 |
|---|---|---|---|
| H0 文件 | ADR-0023、規格（功能對照表、規則優先序、`ContextSnapshot`、頁面矩陣、出發地切換、班次寫法、分期）、原型與截圖、協作紀錄 | 文件 PR 合併 | 🚧 |
| H1 建議規則 ✅ | `core/home-suggest.js` 純函式：`ContextSnapshot` → 決策＋訊號清單＋理由；互斥優先序；自動位置與手動覆寫分開 | 單元測試、`test:clock` | ✅ `test/home-suggest.test.js` 17 項 |
| H2 新首頁 | 天空（五個時段）、核心與頭腦、建議卡（出發地切換）、即時資料兩格、服務列、更多功能（依平台）、您可能想問 | e2e＋截圖＋實機煙霧測試 | ✅ `public/js/pages/home.js`、`home-sky.js`、`home-data.js`、`css/home.css`；e2e 改寫 29 項 |
| H3 輸入列取代分頁列 | 頁面矩陣、浮動「問阿幫」鍵、提醒泡泡、Android 返回鍵、鍵盤與 Safe Area | e2e＋實機煙霧測試 | ✅ `tabs.js` `chromeOf`、`app.js`；e2e 改寫 |
| H4a 為何顯示此建議 | 用到的資料、阿幫記得的東西（可刪） | e2e | ✅ 對話框（H2）＋固定通勤方式列進「阿幫記得的東西」 |
| H4b 快速設定 | 快速設定住家（逆地理確認預覽）、設為固定通勤方式（自動推導反向與時段） | e2e＋實機 | ✅ 首頁「設定住家」、行程卡「設為固定通勤方式」；實機待確認 |
| H5 全站「您」 | 使用者看得到的文字稱呼改「您」（獨立 PR，與 H2 同版上線） | 文案測試 | ⬜ |
| H6 實機驗收 | Pixel、iPhone、iOS 模擬器全流程；功能對照表逐項 | Austin 看過 | ⬜ |

## 待辦總表（2026-11-21 彙整）

**開發可以繼續做的（不需要外部條件）**

| 項目 | 說明 |
|---|---|
| 行程中模式第二版 | Doze 備援通知、鎖定畫面倒數（Live Activity／持續通知） |
| 油價週漲跌 | 需要上週牌價資料 |
| S12g 英文 | 更多英文地名 |
| E3 裝置端 AI | ✅ App 內分類器備援（2026-11-23）；E7 手機上寫回答 ✅ ADR-0017 |
| S1d 本機資料改存 Capacitor Preferences | 新依賴，要先寫 ADR |
| S1e 常用地點用門牌地址 | 需要地址轉座標資料來源（例如 TGOS），先評估 |
| S5 YouBike 空位預測 | 需要歷史車位資料 |
| T-MIX 公車／台鐵接捷運 | 起點或目的地附近沒有捷運站（三峽、桃園、高鐵桃園站→台北捷運）時，組合「公車接捷運」「台鐵接捷運」「機捷接北捷」多段方案（大工程；2026-11-22 真實健檢先把「捷運沒列入」的原因說清楚：哪一端、最近的站多遠、跨系統）。✅ 2026-11-28 第一步（P1-3(b)，與 Antigravity 討論）：高鐵／台鐵進出站接真實捷運（已存路網、比估算慢 15 分以上不用）。剩：公車接捷運（要公車路網，性價比低，先不做） |
| T-CHECKLIST 出門前檢核表（Antigravity 第七輪） | ✅ 2026-11-28：「去政府辦事要帶什麼」卡片的應備文件變成勾選框（網頁、App），「已備好 2／6 項」；只存項目編號在手機（30 天、最多 20 份）；Claude 裡照舊列清單。零個資、減少補件白跑（不代填、不代預約） |
| T-HOMEAREA 預設地區（Antigravity 第七、八輪） | ✅ 2026-11-28：首次引導第 3 步（定位已允許就跳過）與設定頁「預設地區」：縣市＋區兩層選單（六都置頂）、「用目前位置帶入」（只抓這一次、換成最近的區）、清除；沒授權定位或定位服務關著時用那一區的代表點（各區戶政事務所座標，`/api/v1/areas`，365 區），回答第一句「未取得目前位置，先依你設定的預設地區（臺北市大安區）查詢；隨時可在設定調整。」；暫時抓不到照舊可重試；不放進常用地點 |
| T-DG-GRAY 決策圖畫出查不到的方案（第四輪） | ✅ 2026-11-28：決策圖原本就把沒列入的方式畫成灰色；這次把「資料沒來」（`unavailable`、額度用完、查詢失敗）標「暫缺」，跟本來就不適用的「沒列入」分開 |
| T-QUOTA 一題行程少打 TDX | 2026-11-28 P0-2 量測（`scripts/tdx-budget.js`）：`traffic_status` 與 `plan_trip` 的路況共用 60 秒快取，**沒有多打**，不砍。真正的風險是靜態清單下載失敗不記住、每題重打 → ✅ 失敗退避（`core/tdx-client.js`）＋啟動檢查存檔目錄。剩：降級時說清楚用了什麼替代（逐工具盤點）、補錄捷運站表與國道路段 fixture 再量正常路徑、Austin 用真金鑰記額度標頭 |

**需要 Austin 或其他人**：見下方「Austin 待辦」與「被卡住的項目」；另外上架前：安全情境（S19）的用語與電話請心理衛生、緊急應變專業人員確認；隱私權政策〔待補〕欄位（營運單位、目的代號、伺服器所在地、聯絡方式）由營運單位與法務填寫；實機確認 `tel:` 一鍵撥號、iOS 深色主畫面圖示。

## Austin 待辦（外部條件）

- [ ] 申請 TDX 會員，取得 Client ID／Secret，填入本機 `.env`（**不要貼到對話、不要 commit**）
- [ ] 在 TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」權限
- [ ] 申請中央氣象署開放資料平臺授權碼 → `.env` 的 `CWA_API_KEY`
- [ ] 本機 `npm start` ＋ `cloudflared tunnel --url http://localhost:8787`，在 Claude 新增自訂連接器 `https://<隨機>.trycloudflare.com/mcp`，確認能列出並呼叫 tools
- [x] 本機執行 `node scripts/verify-tdx.js`、`node scripts/record-fixtures.js`（M1 完成後），把 fixtures commit（2026-11-23）
- [ ] 校對 `core/data/landmarks.json` 座標（現在 230 筆，含 2026-11-22 新增的 13 個散步地點；Claude 依記憶整理的近似值；可對照 Google 地圖或 M1 的 TDX／TGOS 結果，校對完把 `verified` 改為 `true`）
- [ ] （M5）取得 `ANTHROPIC_API_KEY`，設定每日預算；或不付費改用地端模型（`LOCAL_LLM_URL`＋`LOCAL_LLM_MODEL`，Ollama 需 `OLLAMA_CONTEXT_LENGTH=16384`）
- [ ] （M6）選定部署平台與網域；部署時設定環境變數（金鑰）並用 `Dockerfile` 建置
- [ ] （M11）決定 App 名稱與 App ID（目前 `tw.abang.app`）；申請 Apple Developer（每年 99 美元）與 Google Play 開發者帳號（一次 25 美元），公司或個人名義
- [ ] （M6）repo Settings → Pages → Source 選「GitHub Actions」，文件站才會發布（`.github/workflows/pages.yml`）

---

## M0 基礎 ✅

- [x] 共用核心 `core/`：TDX client（token 快取、回應快取）、交通服務、示範資料
- [x] HTTP API `/api/v1/*` + PWA（附近、公車、YouBike、高鐵、台鐵、收藏）
- [x] MCP server（stdio，8 個 tools）
- [x] 測試：正規化 fixture 測試、MCP 整合測試
- [x] 單檔 Demo（`npm run build:demo`）

## M1 TDX 實測與 fixture 錄製 ✅（2026-11-23）

前置：TDX Client ID／Secret（`.env`）、可連到 tdx.transportdata.tw 的網路。雲端沙盒無法連 TDX，**只能在 Austin 本機執行**；Claude Code 可先寫好腳本（不需金鑰即可完成的部分）。

- [x] M1-01 `scripts/verify-tdx.js`：逐一呼叫 `MCP_TOOLS.md` 所有 ⚠️ 端點，印出狀態碼、筆數、第一筆欄位名稱（不印金鑰）；無金鑰時清楚提示並 exit 1（2026-11-23：端點清單 `scripts/tdx/endpoints.js` 與錄製共用，另印座標完整度、WKT 類型、`ServiceDay` 型別等；每次間隔 13 秒 `--delay`、`--only`；`npm run tdx:verify`）
- [x] M1-02 `scripts/record-fixtures.js`：把真實回應（每端點截前 5 筆）存到 `test/fixtures/<endpoint>.json`，移除可能的個資（2026-11-23：`test/fixtures/tdx-<id>.json` 20 個；只存回應內容，丟掉名稱像 token／secret 的欄位；國道三份對齊同一批 `SectionID`；`npm run tdx:record`）
- [x] M1-03 本機執行 M1-01／02；`test/transit.test.js` 改讀新 fixtures；修正與實際欄位不符的正規化（2026-11-23：新測試 `test/tdx-fixtures.test.js` 12 項讀真實 fixture。修正三處：公車站序 DisplayStopOfRoute 只收 5 個縣市 → 其他縣市改 StopOfRoute（每個子路線一筆）；國道事件 `Live/News` 沒有路名 → 改 `RoadEvent/LiveEvent` 依位置與方向篩；客運時刻表只有起站時間的班次以前整班被丟掉 → 由起站時間沿站牌距離估上車時間，標 `departEstimated`、`departFrom`）
- [x] M1-04 把驗證結果寫進下表與 `DATA_SOURCES.md`；額度方案寫進 `ARCHITECTURE.md` §快取與額度（2026-11-22：額度方案 ✅——每分鐘 5 次下的快取存檔、縣市整批取、背景預熱、額度排程，DATA_SOURCES.md §1.1；其他端點仍待驗證）

驗收：`npm test` 用真實 fixture 通過；`verify-tdx.js` 全綠或有明確「不支援」紀錄。

| 待驗證 | 狀態 |
|---|---|
| `Bus/EstimatedTimeOfArrival/.../PassThrough/Station/{id}` | 已驗證 2026-11-22：在 `/advanced/v2/` 底下（`/basic/` 404 → 以前一律 502）；欄位 `RouteName`、`Direction`、`EstimateTime`（秒，沒有就不帶）、`StopStatus`（臺北市站位 1000 實測） |
| 公車到站 `StopStatus` 與 `NextBusTime` | 部分 ✅ 2026-11-22（新北 939、三峽-臺北市信義區）；2026-11-23 臺北 307 也一樣（狀態 1 沒有 `NextBusTime`、路線端點沒有 `PlateNumb`）：`StopStatus` 0～4 都看得到（4 今日未營運整條路線每站都是 4；2 交管不停靠只有個別站）；狀態 1 尚未發車的站**沒有** `NextBusTime`。`etaOf` 有 `NextBusTime` 才換算等車時間（沒寫時區當 +08:00），沒有照舊算「到站時間不明」；台北市與其他縣市未驗證 |
| `Bus/Shape/City/{City}/{Route}` WKT 格式 | 已驗證 2026-11-23（臺北 307）：欄位 `Geometry`，去返程各一筆 `LINESTRING (經度 緯度, …)`（`LINESTRING` 後有空格），約 290 點；`core/geo.js` 解析成功；另有 `EncodedPolyline`（未用） |
| 站牌 `StopPosition` 於各縣市完整度 | 已驗證 2026-11-23：臺北 28,826、臺中 37,565、高雄 19,281、花蓮 519、公路客運 61,807 站全部有座標（沒有 0,0）。**DisplayStopOfRoute 只收 Taipei、NewTaipei、Taoyuan、Taichung、Tainan**（其他縣市 400）→ 其他縣市改用 `StopOfRoute`（`core/services/transit-data.js` `stopOfRoutePath`） |
| `Rail/Metro/LiveBoard/{Op}` 各系統欄位 | 各系統 2026-11-23 已實測（DATA_SOURCES.md §1.2）。北捷 ✅ 2026-11-22：欄位 `LineID`、`LineName`、`StationID`、`DestinationStationName`、`EstimateTime`（分鐘）符合；但只列「進站中」的站（約 20～25 筆、`EstimateTime` 都是 0）→ 看板整個系統一次取，其他方向用 `StationTimeTable` 估（DATA_SOURCES.md §1.2）。其他系統未驗證 |
| 台鐵／高鐵 ODFare 欄位 | 已驗證 2026-11-22：`Fares[].TicketType／FareClass／CabinClass／Price` 符合；高鐵代碼對照符合（台北→左營 自由座 1,445、標準 1,490、商務 2,440）。台鐵 v3 `ODFares[]` 每個車種×方向一筆、沒有 `TrainTypeName`，`TrainType` 是車種代碼（1 太魯閣、2 普悠瑪、3 自強、4 莒光、5 復興、6 區間、7 普快、10 區間快、11 自強3000，對照 `/basic/v3/Rail/TRA/TrainType`）；兩個 `Direction` 之一是繞島另一邊，取 `TravelDistance` 最短的。臺北→新竹成人單程 區間 163、莒光 195、自強 253 |
| 高速公路旅行時間、道路事件、國道客運端點 | 已驗證 2026-11-23：`SectionShape`／`Section`／`Live` 的 Freeway 端點與 `SectionShapes`、`Sections`、`LiveTraffics` 包裝都對；`TravelSpeed` 0 只有 1～2 筆、沒有負數（維持當無資料）；形狀與路段對得上 453／474。**事件**：`Live/News` 的 `Newses` 沒有路名與位置（標題只有「施工維護」），依路名篩一律對不到 → 改 `/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway`（`Positions` POINT、`Location.FreeExpressHighway.Direction`），依位置 500 公尺內與方向篩。客運 `StopOfRoute/InterCity`、`Schedule/InterCity`（`ServiceDay` 0／1）都對，但有些班次 `StopTimes` 只有起站 → 由起站時間沿站牌距離估上車時間、標 `departEstimated`；票價 `/basic/v2/Bus/RouteFare/InterCity`（`StageFares`）存在、尚未串接。待做：走廊同時納入平行國道（國 1／國 3）時是否只取一條主線 |
| 地理編碼（TDX 或 TGOS） | 已驗證 2026-11-23：TDX `/advanced/V3/Map/GeoCode/Coordinate/Address/{地址}`、`/Markname/{地標}` 可用（`Geometry` POINT；地標回多筆、第一筆不一定是本身），尚未串接（`DATA_SOURCES.md` §5）；TGOS 未評估 |
| 導訂票 API 端點與參數（需權限） | 未驗證 |
| CWA 觀測與鄉鎮預報欄位 | 鄉鎮預報已驗證 2026-11-22：`F-D0047-089` 是縣市層級，鄉鎮要用各縣市的 `F-D0047-001～085`（DATA_SOURCES.md §3）；`LocationsName`、`LocationName`、元素名「3小時降雨機率」「溫度」「天氣現象」、`StartTime`／`EndTime`／`DataTime`（帶 +08:00）都符合。觀測與雨量站欄位實際在用、結果合理（高雄三民 25.8°C、雨量 0 mm）。以下是原本的假設，`-998` 等特殊值仍未確認：（M3-08 假設 `records.Station[]`（`GeoInfo.Coordinates` WGS84、`WeatherElement.AirTemperature／Weather`）、雨量站 `O-A0002-001` 的 `RainfallElement.Past1hr.Precipitation`（`-998` 雨跡等特殊值目前視為沒有資料）、`F-D0047-089` 可用 `LocationName` 篩、上層縣市欄位 `LocationsName`（同名鄉鎮以縣市區分）、時段 `EndTime`、元素名「3小時降雨機率」；`weather_tomorrow` 另假設時段 `StartTime`（或 `DataTime`）、元素「溫度／最高溫度／最低溫度」「天氣現象」） |
| 機場捷運直達車參數 | 已驗證 2026-11-23：`Metro/S2STravelTime/TYMC` 直達車（`TrainType` 2）臺北車站到第一航廈 36 分、到第二航廈 39 分（`AIRPORT_EXPRESS` 已改成 36／39，2026-11-23）；票價 160 元未另驗 |
| 捷運線別與估算 | 未驗證（2026-11-21：線別由站代碼字首推（台中數字代碼→綠線、高雄 RK→紅線、機捷 A）；時間票價依距離估，真實改用 `Metro/S2STravelTime`、`Metro/ODFare`） |
| 高鐵／台鐵車站座標與等級 | 已驗證 2026-11-23：高鐵 12 站、台鐵 245 站 `StationPosition` 都有；台鐵 v3 包在 `Stations`，`StationClass` 是字串 '0'～'5'（目前沒用，「最近車站」仍是最近 3 站依序查） |
| OData 空白用 `%20`（已實作）是否必要 | 已驗證 2026-11-23：同一個 `$filter` 用 `+` 與 `%20` 結果相同 → 不是必要，保留無妨 |
| 捷運站別時刻表的國定假日班表 | 2026-11-22 已實作（國定假日用 `ServiceDay.NationalHolidays` 的班表，看路線＋方向＋終點）；國定假日清單 `core/data/tw-holidays.json` 已與人事行政總處 115、116 年辦公日曆表核對（data.gov.tw 資料集 14718，`scripts/build-holidays.js` 由官方 CSV 產生）。2026-11-23 實測（北捷 BL12）：有帶 `NationalHolidays`（布林），平日與假日分成兩份，假日那份 `NationalHolidays: true`，`normStationTimetable` 讀法相符 |
| 停車場 `/basic/v1/Parking/OffStreet/CarPark/City/{City}` 的 `$spatialFilter` | 2026-11-23 實測：台中 500 公尺內回 1,558 筆（不像真的有篩），程式自己算距離、取 600 公尺內；台北市、新北市 `CarParks` 是空的（只有 `ParkingAvailability`、沒有座標）→ 2026-11-23 改用市府開放資料（`docs/DATA_SOURCES.md` 停車場）。`$select` 沒有作用。待驗證：附近篩選的實際範圍 |
| 颱風停班停課（2026-11-28 第十四輪） | data.gov.tw 資料集 20457「天然災害停止上班、停止上課情形」（人事行政總處）：資源是 NCDR 示警 RSS `https://alerts.ncdr.nat.gov.tw/RssAtomFeed.ashx?AlertType=33`（CAP）與 KMZ；中繼資料標「每 1 年」「統計整理」。2026-11-28 實測 RSS 回「請先登入會員」——要 NCDR 會員才拿得到。待 Austin 決定是否申請（帳號屬停止條件）；拿到後由伺服器定時抓、快取，手機不直連 |
| 台北市、新北市停車場開放資料（`core/services/parking-open.js`） | 2026-11-23 實測：台北 `TCMSV_alldesc.json` 1,767 筆（收 1,695；`EntranceCoord` 的 `Xcod` 是緯度、`Ycod` 是經度，128 筆入口是 0,0（改用 TWD97），14 筆入口與 TWD97 差超過 300 公尺（不列））；`TCMSV_allavailable.json`／`.xml` 的空位停在 10-19／11-19，改用 TDX 台北空位（ID 相同）。新北 `size` 上限 1000（要分頁）；空位欄位實際是 `AVAILABLECAR`（說明寫 `AVAILABLE`，兩個都收）；有幾筆 `TW97X`／`TW97Y` 寫反或是 0。待驗證：台北入口座標與 TWD97 哪個準（目前差太多就不列）、台北 blob 空位檔是否恢復更新、新北私有停車場是否會有空位 |

## M2 Tool registry＋遠端 MCP ✅

- [x] `core/tools/`：`defineTool()`、registry；8 個 tools 搬入（行為不變）
- [x] `mcp/create-server.js`；stdio 入口 `mcp/server.js`（`npm run mcp`）
- [x] `/mcp`、`/mcp/:pack`（Streamable HTTP，stateless，`enableJsonResponse`）
- [x] `GET /api/v1/tools`、`POST /api/v1/tools/:name`
- [x] 每 IP 限流（`RATE_LIMIT_API` 120/分、`RATE_LIMIT_MCP` 60/分、`TRUST_PROXY=1`）
- [x] 🧩 `pack`、`tier`；`MCP_PACKS` 與 `/mcp/:pack` 過濾
- [x] 測試：stdio、HTTP、REST 三路徑一致（24 項測試全過）
- [x] README：Claude 自訂連接器設定（cloudflared）
- [x] ADR-0006：M2 維持 SDK v1，M4 再評估 v2（2026-11-18：評估後維持 v1）

## M3 交通完整版 ✅

規格：`MCP_TOOLS.md`、`DATA_SOURCES.md`、ADR-0010。每個新服務都要：真實 service ＋ mock（示範模式）＋ TDX 形狀 fixture 單元測試 ＋ tool 註冊（含 `speak`）＋ MCP 整合測試列出。

- [x] M3-00 決策引擎 `core/decide.js`（7 項測試，2026-11-17）
- [x] M3-00b 每個 tool 的 `speak`（2026-11-17）
- [x] M3-01 導航：`core/nav.js`（`navLinks(lat, lon, mode)`、`leaveAt(etaSec, distanceM)`）；`bus_nearby_stations`、`youbike_nearby` 每筆附 `nav`（2026-11-17：另有 `walkMinutes`、`withNav`；nav 在 tool 層包裝，7 項測試）
- [x] M3-02 `bus_route_eta` 站點加 `lat/lon`；`core/geo.js` 解析 Bus Shape WKT → `shape`（mock 也要有）（2026-11-17：站點另附 `nav`；形狀端點失敗時省略 `shape` 不影響到站；9 項測試）
- [x] M3-03 `core/data/landmarks.json`（≥ 150 筆：名稱、別名、座標、縣市）＋ `core/services/places.js` ＋ tool `find_place`（2026-11-17：201 筆、座標待校對；tool 加 `source`／`static` 正確標示來源；8 項測試）
- [x] M3-04 `core/services/metro.js` ＋ mock ＋ tools `metro_stations`、`metro_live_board`（卡片 `metro`）（2026-11-17：四系統；同名多線合併；看板空資料回空 trains；tools 在 `core/tools/metro.js`；6 項測試）
- [x] M3-05 `rail_fare`（台鐵／高鐵票價）（2026-11-17：代碼轉中文、成人單程在前、未知代碼保留；台鐵車種只用資料自帶名稱；3 項測試）
- [x] M3-06 `traffic_status`（pack transit；mock 提供「順暢」「壅塞」兩種情境，以 `DEMO_TRAFFIC=jam` 切換）（2026-11-17：沿途路段以走廊＋方向判斷；壅塞累計 5 km 即 jam；查不到為 null；`resolvePoint` 供 plan_trip 共用；6 項測試）
- [x] M3-07 `intercity_bus`（國道客運；`delayRisk` 依路況）（2026-11-17：站牌 1.5 km 配對、時刻表、含延誤抵達；票價端點未確認先回 null；`T.point` 共用；6 項測試）
- [x] M3-08 `weather_now`（pack weather；`CWA_API_KEY`；mock 以 `DEMO_WEATHER=rain` 切換）（2026-11-18：`cwa-client`、觀測＋鄉鎮預報、`weatherMode` 與 TDX 獨立；tool 加 `modeOf`／`demoNote`；6 項測試；真實資料待授權碼驗證）
- [x] M3-QA 品質基礎（使用者追加）：Playwright E2E 冒煙測試（`npm run e2e`）、Swagger／OpenAPI 3.1（`server/rest.js` 路由表＋`server/openapi.js`，`/api/docs`）、ESLint（`npm run lint`）、CI 加 lint 與 E2E；code-review／security-review／agy 審查修正（雨量改取雨量站 `Past1hr`、客運 ISO 出發日與隔日班次、5xx 不外洩訊息、Swagger 白名單 `Object.hasOwn`、`traffic_status` 輸出與 `intercity_bus` 一致）（2026-11-18；`npm test` 89 項、E2E 10 項）
- [x] M3-09 `core/providers/ridehail/uber.js` ＋ tool `ridehail_link`（pack ridehail、L2）；估價先以距離估算並標 `estimated`（2026-11-18：provider 註冊與 `createRidehailServices`；臺北市計程車費率＋道路距離估區間；`confirmText` 供 M4 確認視窗；4 項測試）
- [x] M3-10 `core/services/trip.js` `planTrip()`：候選方案（`MCP_TOOLS.md` §7 規則 1–7）→ 自動狀態 → `decide()` → `ranking`；tool `plan_trip`（卡片 `trip`）（2026-11-18：7 種方案、`bus.directTrips`（live 以站點座標驗方向／mock 示範路線）、車站座標由內建地標對照、來源失敗只略過並列 `unavailable`；輸出對齊 CARDS `trip`；7 項測試）
- [x] M3-11 `plan_trip` 固定 10 組 OD fixture 測試（含：雨天、塞車、趕時間＋arriveBy、帶行李、跨城），斷言第一名與理由句關鍵字（2026-11-18：`test/trip-od.test.js`；「想省錢」cost 倍數 3→5 並記錄於 ADR-0010；無狀態市區短程叫車第一待 Austin 決定）
- [ ] M3-12 ⛔ `rail_booking_link`（L2；導訂票權限到位前先完成介面、mock 與「未授權」錯誤訊息）（2026-11-18：權限前部分 ✅——參數驗證、示範版、真實版回「尚未開通」並附官方網站、tool L2；4 項測試。待權限：串 TDX 導訂票端點）
- [x] M3-13 `tdx-client` 回報 `metrics`（呼叫數、筆數、快取命中、耗時）；`callTool` 回傳 `metrics`（2026-11-18：`core/metrics.js` 以 `AsyncLocalStorage` 隔開同時請求；CWA 也計量；MCP 放 `_meta`；OpenAPI 更新；5 項測試；計量帶 agent id 待 M5）
- [x] M3-14 🧩 來源有英文名稱時保留（`nameEn`、`stopNameEn`）（2026-11-18：`util.en`／`enField`；公車、YouBike、高鐵台鐵車站、捷運、路況路段；3 項測試）

驗收：`npm test` 全過；`plan_trip` 對 10 組 OD 排序合理且理由句正確；所有 tools 在示範模式可用；`GET /api/v1/tools` 列出 ≥ 17 個 tools。

## M4 互動卡片（MCP Apps）

規格：`CARDS.md`、ADR-0003、ADR-0008。

- [x] M4-01 卡片資料契約 `public/ui/cards/schema/<card>.v1.json`（7 種），測試以 schema 驗證 tools 的 `structuredContent.data`（2026-11-18：零依賴驗證器；三個 tool 改物件格式；payload 帶 `v`／`tool`／`args`；14 項測試）
- [x] M4-02 `public/ui/cards/`：`index.js`（依 `card` 分派）、7 種卡片、`cards.css`（淺色）（2026-11-18：`dom.js` 只用 textContent／https 連結白名單；外框、示範標示、刷新與失敗狀態共用；`actions.js` 導航／L2 確認／訂票；`preview.html`＋E2E 截圖；`thsr_timetable`／`tra_timetable` 補 `system`）
- [x] M4-03 🧩 卡片文字集中於 `public/ui/cards/i18n/zh-TW.js`（2026-11-18：`t(key, vars)`、共通／L2 確認／7 種卡片的文字；3 項測試）
- [x] M4-04 host 介面兩種實作：`host-web.js`、`host-mcp-app.js`（`@modelcontextprotocol/ext-apps` 的 `App`）；先評估 SDK v2 並更新 ADR-0006（2026-11-18：ext-apps 1.7.5（devDependency，peer 為 SDK v1）；ADR-0006 維持 v1；`host-mcp-app.js` callServerTool／sendMessage／updateModelContext／openLink，iframe 內 L2 確認框與複製連結；`mcp-app.js` 入口；4 項測試）
- [x] M4-05 `scripts/build-cards.js`：esbuild 打包 `dist/cards.html`（2026-11-18：`npm run build:cards`；單檔、零外部資源，約 394 KB）
- [x] M4-06 MCP 出口：`ui://abang/cards.html` 資源；有卡片的 tool 加 `_meta.ui.resourceUri`（2026-11-18：`mcp/cards-resource.js`：開發時記憶體內打包、正式環境讀 `dist/cards.html`；也加舊鍵 `ui/resourceUri`；1 項測試）
- [x] M4-07 動態：倒數每秒遞減、數字變化、公車在時間軸移動；`prefers-reduced-motion` 關閉（2026-11-18：`countdown.js` 本地倒數（規則同 `busStatusText`）、數字變化提示、車牌標記；reduced motion 只換文字；2 項單元＋E2E）
- [x] M4-08 Playwright：以 `AppBridge` 當 host 載入每種卡片 fixture，截圖並檢查無 console error（2026-11-18：`test/cards/mcp-host.js` 經真正的 `/mcp` 取結果與資源、沙箱 iframe；7 種卡片、點站牌 → updateModelContext、訂票 → callServerTool → 確認框 → openLink；每張卡片截圖已檢查）
- [ ] M4-09 ⛔ 以 ext-apps `basic-host` 與 Claude 實測（Austin）

驗收：Claude 中呼叫 `bus_route_eta` 顯示互動卡片，能自行刷新、點站牌產生延伸提問。

## M5 民眾網頁 agent

規格：`AGENT.md`、`UX.md`、ADR-0004、ADR-0009、ADR-0010；視覺依原型 `docs/prototypes/transit-discussion.html`（以真實事件驅動，不照抄假資料）。

- [x] M5-01 🧩 `core/agents/life.json` ＋ zod 驗證；prompt 組裝順序：平台政策 → 工具包護欄 → agent 設定 → 使用者（2026-11-18：`core/agents/index.js` 與 registry 交叉檢查；`core/agent/prompt.js`；3 項測試）
- [x] M5-02 `core/agent/events.js`：事件型別與建立函式（`AGENT.md` §事件）＋測試（2026-11-18：`ev.*`、`toNdjson`、`mergeStates`、`TOOL_ROLES`；狀態來源統一 `user`；4 項測試）
- [x] M5-03 `core/agent/demo-intent.js`：規則式意圖（`AGENT.md` 示範模式表），產生與 Claude 模式相同事件（2026-11-18：地標比對擷取地點、抵達時間、狀態關鍵字、6 種意圖的分段計畫與總結；6 個建議問題皆可完整執行；6 項測試）
- [x] M5-04 `core/agent/run.js`：共用執行器（呼叫 tool → `tool_start`/`tool_result` → `plan_trip` 時發 `decision`）（2026-11-18：`validateRequest`、`execTools`（白名單、錯誤不外洩）、`runDemo`；picked 狀態帶進計分並標示；5 項測試）
- [x] M5-05 `core/agent/claude.js`：Claude tool-use 迴圈（`claude-haiku-5-5`），`agent_note` 來自模型、`speak` 來自資料（2026-11-18：ADR-0012 三種模式 claude／local／demo；`@anthropic-ai/sdk`；地端 OpenAI 相容 fetch；共用 `model-loop.js`；預算降級；頁面標示模式；地端 qwen3:8b 實測；順手修高鐵／台鐵「下一班」：今天只列未開出班次、卡片收起已開出班次）
- [x] M5-06 `POST /api/v1/agent` NDJSON 串流；🧩 限流與計量以 agent id 為單位；每日預算（2026-11-18：`server/agent.js`；預算降級 M5-05 接上；OpenAPI 文件；3 項測試）
- [x] M5-07 🧩 `client_tool_call`／`clientToolResults`；網頁實作 `device_location`（2026-11-18：伺服器請求定位、`deviceLocation` 驗證台灣範圍；`public/js/agent/client.js` NDJSON 串流＋client tool 重送；2 項測試）
- [x] M5-08 `public/js/pages/agent.js`：對話 UI、討論串、`@` 點名、建議問題（2026-11-18：`#/agent`；討論串 role=log、角色色彩頭像、metrics、收合；卡片以 renderCard 呈現；定位流程；`/api/v1/agent/profile`；E2E 截圖已檢查。決策圖 M5-09、首頁入口 M5-12）
- [x] M5-09 決策圖（`decision` 事件）：資料膠囊 → 狀態標籤連回來源 → 方案連線依分數變粗 → 勝出路徑亮起；狀態 chip 可切換並即時重算（前端呼叫同一份 `decide.js`）（2026-11-18：`decision-graph.js`、`/core/decide.js`、重算一致性測試、E2E 驗證切換想省錢會改變建議且不呼叫伺服器；FLIP／3D 於 M5-11）
- [x] M5-10 結論卡：建議方案＋分段時間條＋備案＋行動按鈕（導航、訂票、叫車、提醒我）（2026-11-18：trip 卡（M4-02）補「提醒我出門」：高鐵／台鐵／客運方案帶 `leaveAt`，web host `remind` 以系統通知；只提醒今天且 1 分鐘後的出門時間）
- [x] M5-11 輕量 3D：卡片立體進場、排名翻轉；低階手機與 `prefers-reduced-motion` 降級（2026-11-18：CSS `enter3d`、決策圖 FLIP（最多 3 個）、`lite-motion` 降級；E2E 驗證兩種模式）
- [x] M5-12 首頁改以 agent 為主要入口，舊功能保留在格子（2026-11-18：首頁搜尋框改為問阿幫（`#/agent?q=` 自動送出）＋3 個範例；格子與分頁列不變；離線 Demo 版維持公車搜尋）
- [x] M5-13 Playwright：示範模式 6 個建議問題的手機與桌面截圖；Claude 模式以本地 mock API 測迴圈與錯誤（2026-11-18：示範模式部分 ✅——6 題 × 手機桌面皆有討論串、正確卡片、行程有決策圖、截圖已檢查；截圖發現並修正：建議題改「明天 9 點前要到左營」（示範資料 8 點前無班次）、全部遲到時卡片改說「都趕不上」、班次制等車最多算 10 分。模型模式以本地假 API 測迴圈與錯誤：`test/agent-model.test.js`）

驗收：無 API Key 時完整展示；填入 `ANTHROPIC_API_KEY` 後切換 Claude，事件流與卡片相同；無假延遲。

## M6 上線準備

- [x] M6-01 `Dockerfile`、`.dockerignore`、`/healthz`（2026-11-18：兩階段建置（build 階段打包 `dist/cards.html`、執行階段只裝正式依賴）、node 使用者、檔案唯讀、HEALTHCHECK；`/healthz` 不限流不記 log；本機 docker build／run 驗證：healthz、首頁、MCP 卡片資源讀 dist、healthy）
- [x] M6-02 結構化 log（不含座標與對話內容）；🧩 欄位含 `agentId`、`tenantId`（第一方 `first-party`）（2026-11-18：`server/log.js` 一行一個 JSON、Cloud Logging 欄位 severity／message；存取 log 不含 query；錯誤遮蔽金鑰值、堆疊只留 6 行；MCP 寫 stderr；4 項測試）
- [ ] M6-03 ⏸ 選用 Redis 快取（`REDIS_URL` 有設才啟用）（正式環境階段；需新增依賴；單一實例不需要）
- [x] M6-04 無障礙：鍵盤、對比、`aria-live` 播報到站（2026-11-18：「跳到主要內容」、全站焦點框、分頁列 `aria-current`、toast `role=status`；`--off` 文字對比 3.1 → 5.0；修首頁範例問題白底白字；卡片常駐播報區（公車路線點開的站／即將進站、站牌最快 3 班、捷運最近 2 班），PWA 公車頁同樣播報，第一次不念、沒變不重念；4 項單元＋2 項 E2E）
- [ ] M6-05 ⏸ Lighthouse PWA／Performance ≥ 90（正式環境階段；需新增 dev 依賴 `lighthouse`，或用 Chrome DevTools 手動跑）
- [ ] M6-06 ⏸ 部署 Cloud Run 或 Zeabur，HTTPS 與自訂網域（正式環境階段。2026-11-19 地端部署驗證 ✅：`docker-compose.yml` 啟動、`/healthz`、網頁 agent 以地端 qwen3:8b 回答（約 18 秒、正確）、MCP 18 個 tools 與卡片資源）
- [x] M6-07 GitHub Pages 發布 `docs/`（`index.html`、原型）（2026-11-18：`.github/workflows/pages.yml`，推 main 且 docs 有變時發布；待 Austin 在 repo 設定啟用 Pages）

驗收：公開 HTTPS 網址可用網頁 agent；Claude 自訂連接器可連；文件站上線。

## M7 反詐騙 agent

規格：`AGENT_ANTIFRAUD.md`、ADR-0005、ADR-0007、`PLATFORM.md`（L2）。

- [x] M7-01 多 agent 路由：`antifraud.json` profile、網頁 `#/agent/:id`、API `/api/v1/agent/:id`、`/api/v1/agent/profile?id=`、首頁入口；MCP `/mcp/antifraud`（2026-11-19：`antifraud.json`、`hasProfile`；`/api/v1/agent/:id`（未知 404）、`profile?id=`、OpenAPI；網頁 `#/agent/:id`（標題、提示、@點名依 agent）；首頁「防詐」格子；`/mcp/antifraud` 由 pack 自動提供）
- [x] M7-02 165 開放資料：`core/services/antifraud.js`（停止解析涉詐網站、詐騙闢謠，CSV、24 小時快取）＋ mock／fixtures（2026-11-19：零依賴 CSV 解析；網域正規化（punycode）與上層網域比對；闢謠搜尋；24 小時快取、更新失敗沿用舊索引；啟動時預載；實測 9.7 萬網域、89 篇；示範片段在 `core/data/demo/`）
- [x] M7-03 詐騙特徵規則庫 `core/data/scam-rules.json`（版本化、待專家審核）＋ tools `scam_check_message`、`scam_lookup_url`、`scam_myth_search`、`sms_sender_check`（2026-11-19：17 條規則（版本 2026.11.19-1，待審核）；網址抽取；風險分數與等級；寄件號碼規則；8 項測試）
- [x] M7-04 風險卡片 `scam-risk`（契約、渲染、字典）（2026-11-19：契約 `scam-risk.v1.json`、渲染（色彩＋符號＋文字、不提供開啟使用者網址）、字典；MCP Apps 同一份）
- [x] M7-05 示範意圖（antifraud）與 L2 輸出護欄（不宣稱安全、固定附 165）（2026-11-19：`demo-antifraud.js`；`guardrails.js` 以句為單位改寫保證安全的說法、送 guardrail、固定附 165；示範與模型模式都套用；prompt 加防詐護欄）
- [x] M7-06 E2E：防詐頁建議問題、風險卡片、護欄（2026-11-19：手機＋桌面從首頁格子進入、5 個建議問題逐題、風險卡片高／中、總結有 165 且無安全保證；截圖已檢查）
- [x] M7-07 規則補強：包裹、罰單釣魚簡訊（2026-11-27，規則庫 2026.11.27-1）：典型「地址有誤＋24 小時內更新＋附網址」到高風險；正常取貨、出貨、帳單、開徵、颱風停配、免運促銷維持低風險（`test/scam-parcel.test.js`）；仍待防詐專家審核
- [x] M7-08 冒用機關名義＋非官方網址、假檢警轉述說法、低風險有特徵時照實說（2026-11-28，規則庫 2026.11.28-1，`test/scam-brand.test.js`）；仍待防詐專家審核

## M10 生活開放資料（首頁格子）

2026-11-19 Austin：首頁「規劃中」的格子全部接上開放資料；M8 產業移到下一階段。每個服務＝一個 tool（pack `life`）＋一種卡片＋`#/s/:id` 服務頁（`public/js/pages/service.js`），網頁、問阿幫、MCP 共用。

- [x] L-01 服務頁框架 `#/s/:id`（定位、表單、卡片、重新定位）；捷運（既有 tool）、天氣（`weather` 卡片）
- [x] L-02 地震（中央氣象署，`CWA_API_KEY`）（2026-11-19：`earthquake_recent`（E-A0015-001 顯著有感＋E-A0016-001 小區域、最大震度、指定縣市震度、報告連結）；`quake` 卡片；無授權碼用示範片段）
- [x] L-03 空氣品質（環境部）（2026-11-19：`aqi_nearby`（aqx_p_432，`MOENV_API_KEY`；無金鑰用示範片段；回應不是 JSON 視為金鑰無效）；`aqi` 卡片（等級色彩＋文字））
- [x] L-04 藥局（健保署）（2026-11-19：`pharmacy_search`（健保署 CSV 每日、約 1 萬家；**資料沒有座標**→以地區／名稱搜尋、地圖搜尋連結；排除已歇業；今天營業時段）；`pharmacy` 卡片）
- [x] L-05 垃圾車（縣市環保局）（2026-11-19：`garbage_truck_nearby`（臺北市清運點位＋時間，週日週三停收；新北市路線＋星期欄位＋即時 GPS；其他縣市待擴充）；`garbage` 卡片）
- [x] L-06 油價（台灣中油）（2026-11-19：`fuel_price`（中油 JSON，民國生效日）；`fuel` 卡片）
- [x] L-07 發票對獎（財政部）（2026-11-19：`invoice_lottery`（財政部 RSS 最近 6 期；8 碼或末 3 碼對獎；增開六獎已不在資料中）；`invoice` 卡片內可再對獎）
- [x] L-08 E2E、文件（2026-11-19：首頁 8 格逐一進入（手機）、卡片、無「規劃中」格子、發票卡片內對獎；截圖已檢查）
- [x] L-09 問阿幫也能用生活服務（2026-11-19：life profile v2 加 `life` 工具包 6 個 tool、persona／規則／生活護欄；示範模式 7 種新意圖（天氣、空品、地震、藥局、垃圾車、油價、發票）；建議問題 8 個；@點名角色；示範藥局補臺北市中正區片段）
- [x] L-10 空品進決策引擎（2026-11-19：狀態 `badAir`「空品不佳」（`exposure` ×3、`effort` ×2）；`plan_trip` 起點 AQI > 100 自動加入、輸出 `air`；決策圖 空品 → 空品不佳；示範 `DEMO_AIR=bad`；ADR-0010 權重紀錄）
- [x] L-11 我的發票（本機自動對獎）（2026-11-19：`invoice_check_batch`（期別、開獎日、中獎／沒中／待開獎／超過範圍）；網頁「我的發票」存在手機、打開 App 時開獎日已到自動對獎並通知；問阿幫主動提議。不串 Gmail／載具（需保存使用者憑證，屬 ADR 變更））
- [ ] L-15 財政部手機條碼載具（2026-11-19 規劃；互動模型情境「載具」）：連結表單（同意事項＋手機條碼＋驗證碼，只存手機、不在對話輸入）→ `invoice_carrier_list` 抓發票存進「我的發票」→ 開獎自動對。⛔ 前提：公司以營業人身分向財政部財政資訊中心申請電子發票 API AppID／APIKey（審查、授權最長 3 年、流量管制；APIKey 只放伺服器加簽）；驗證碼屬個資、伺服器轉查不保存 → 需 ADR
- [x] L-17 判斷層導入（2026-11-20：`core/agent/judge.js`；意圖＝嵌入分類器有把握用它、否則問地端模型；狀態＝規則 ∪（A ∩ B）；示範模式照判斷意圖抽參數、模型模式狀態以判斷層為準＋地端模型縮減工具；實驗意圖 94.2%、全對 89.5%）
- [ ] L-16 指揮阿幫排程＋綜合知識（2026-11-19 規劃；互動模型情境「排程」「綜合知識」）：「開獎後幫我自動對發票」「每天 8 點跟我說天氣和台積電」建立排程（存手機、可暫停刪除；只排 L1 查詢與通知，L2 只提醒）；「今天要注意什麼」組合多來源成可展開的「今日重點」卡片。網頁版只在打開 App 時補跑；準時推播需推播伺服器與使用者訂閱 → 需 ADR
- [x] L-14 選公車就盯到站＋到站提醒（2026-11-20：`plan_trip` 公車方案 `follow`；`bus_route_eta` 加 `stop`／`direction` → `focus`；執行器 `busFollowUp` 決策選公車後自動盯上車站（示範與模型相同）；卡片大倒數、你在這上車、到站前 3／5 分提醒（`host.watchArrival`，趕不上這班就提醒下一班）、開公車頁看動態；公車頁 `?stop=&dir=`；提醒只在 App 開著時。2026-11-19 使用者提出；互動模型見 `docs/prototypes/agent-interaction.html` 情境 9：決策選公車 → 自動 `bus_route_eta` 上車站即時到站、開公車頁看動態、「到站前 N 分提醒我」通知）
- [x] L-13 掃發票 QR code（2026-11-19：`public/js/invoice-qr.js` `parseInvoiceCode`（左邊 QR：字軌＋號碼＋民國日期；右邊 `**` 提示；一維條碼 → 期別）；`BarcodeDetector`＋相機的連續掃描視窗，完成後一次對獎；不支援時改手動輸入；E2E 以假 BarcodeDetector 與 canvas 相機測試）
- [x] L-12 股市收盤行情（2026-11-19：`stock_quote`（pack `finance`；證交所 STOCK_DAY_ALL、櫃買中心收盤、加權與櫃買指數，免金鑰，30 分快取；代號或名稱、多檔、找不到不丟錯、`similar`）；`stock` 卡片（漲紅跌綠＋▲▼、卡片內查別檔、`setContext`）；首頁「股市」格子；問阿幫：股市意圖、追問（「那聯發科呢？」）、問買賣先說不提供投資建議；`PACK_GUARDRAILS.finance`＋輸出護欄 `no-investment-advice`；地端模型 5 種情境實測）

## M8 中小企業概念驗證（概要）— 下一階段（2026-11-19 決定）

詳細規格屆時寫 `docs/AGENT_SME.md`。

- [ ] 選定一個產業與縣市（建議化粧品製造）
- [ ] 申辦知識庫 `core/data/permits/<industry>.json`：項目、條件、主管機關、法源條號、官方連結、審核日期與審核人
- [ ] 法規檢索（全國法規資料庫）、`company_lookup`（商工登記公示資料）
- [ ] `permit_checklist`、`regulation_search`、`compliance_calendar` 與清單卡片
- [ ] 法規專家審核流程；標示「非法律意見」

## M9 阿幫平台（Agent Builder）— 需先達啟動門檻

規格：`PLATFORM.md`；決策：ADR-0005、ADR-0007。

啟動門檻（全部達成才開始）：

- [ ] 第一方 agent ≥ 2 個上線，tool 成功率 ≥ 99%，連續 8 週無重大護欄事故
- [ ] ≥ 5 家設計夥伴有具體用例並願意試用
- [ ] 每次對話成本已知，初步定價經夥伴驗證
- [ ] L2 護欄在真實流量下驗證，輸出檢查器上線
- [ ] `PLATFORM.md` 未決問題中的法律與條款確認完成

分段：M9a 內部化 → M9b 封閉測試（L1、網頁／內嵌／QR）→ M9c 公開（L2、LINE、MCP、多語）。L3 另行決定。

## M11 行動 App（ADR-0013，2026-11-20 開始）

Capacitor 8 把現有網頁包成 Android／iOS App（同一份前端），呼叫同一 agent API 與卡片契約（ADR-0008）。

- [x] M11-01 App 殼（2026-11-20：ADR-0013；`npm run build:app` 打包 `dist/app`＋注入 API 位址；`public/js/base.js` 的 `API_BASE`；伺服器對 App 來源加 CORS（`APP_ORIGINS`）；App 內不註冊 service worker；`android/`、`ios/` 原生專案；Android 只對本機位址允許明碼 http；Android 模擬器實測問阿幫可用、iOS 模擬器版編譯成功）
- [x] M11-02 到站提醒改手機本機通知（2026-11-20：`@capacitor/local-notifications` 8.3.1；`public/js/native-notify.js` 經原生橋接呼叫；每次查到到站時間就把通知排到預估時間（同一則覆蓋、差不到 20 秒不重排），App 到背景或被關掉時系統照最後一次預估送出；車比預估早到就馬上送；取消提醒＝取消排好的通知；出發提醒也改本機通知；文字「App 關著也會提醒」；網頁維持現狀。iOS 模擬器與 Android 實機（Pixel）：權限、排程、App 關閉後送達 ✅）
- [x] M11 名稱 Abang、藍鵲 agent 造型（冠羽、耳麥、HUD）與 App 圖示（含 Android 主題單色圖示）（2026-11-21，PR #31）
- [x] M11 Android 返回手勢回上一層、首頁離開 App（PR #31）
- [x] M11 原生定位 `@capacitor/geolocation`（iOS 只問一次權限）、鍵盤打開收起分頁列、iOS 隱私清單（2026-11-21，PR #33）
- [x] M11-03 原生相機掃發票 QR（網頁退路保留）（2026-11-21，M14-02 一起做：App 的發票頁「拍發票 QR code」「選發票照片」用 `AbangVision`；網頁維持 BarcodeDetector 連續掃描與手動輸入）
- [x] App 圖示改用科技感的 Λ 標誌（C2：青綠漸層、Λ、琥珀核心、軌道），藍鵲留在 App 內；啟動畫面改放圖示＋Abang；Android 通知小圖示 `ic_stat_abang`；PWA maskable 與 apple-touch-icon 用方形不透明版（2026-11-21；實機的桌面圖示、主題圖示、通知小圖示、iOS 深色／著色待確認）
- [x] M11-04 啟動畫面（藍鵲＋Abang〔2026-11-21 改成 Λ 圖示＋Abang〕，iOS／Android 舊版圖片、Android 12+ 系統啟動畫面底色與圖示）、隱私權政策頁 `#/privacy`、設定頁 `#/settings`（2026-11-21；聯絡方式待營運單位補上）
- [ ] M11-05 ⛔ 測試環境部署（HTTPS，M6-06）＋ Google Play 內部測試、TestFlight（需開發者帳號）

## M12 裝置端 AI（ADR-0014，2026-11-21）

- [x] E1 ADR-0014：手機先判斷意圖與狀態，以 `deviceJudge` 提示伺服器；只收列舉值；方案仍由 `decide.js` 計分
- [x] E2 前端降級鏈 `public/js/edge-judge.js`（1.8 秒逾時、斷路器、外掛失敗照常）
- [x] E4 iOS Apple Intelligence（Foundation Models，`AbangEdgeAIPlugin.swift`）：模擬器可執行；實機待 iPhone 15 Pro 以上
- [x] E5 Android Gemini Nano（ML Kit GenAI Prompt API）：Pixel 11 Pro XL 實機意圖 90.1%、p50 約 270 ms；只在 Wi-Fi 下載模型（新依賴 `com.google.mlkit:genai-prompt`：依 Austin 2026-11-21「edge ai 盡量開發」加入，正式上架前請 Austin 再確認授權條款）
- [x] E6 實機評測 `scripts/eval-edge.js`、組合分數 `eval-edge-combo.js`（A＋規則＋Gemini Nano 全對 89.0%，`docs/research/edge-eval.md`）
- [x] E3 App 內 transformers.js 分類器（第三層備援，2026-11-23）：使用者在設定頁按下載（約 160 MB，只從阿幫伺服器 `/edge-model/`，存在 IndexedDB），Web Worker 跑 multilingual-e5-small＋共用的分類器參數（`core/judge-classify.js`、`core/data/judge-classifier.json`）；系統模型不能用時送 `deviceJudge.engine = 'e5'`＋信心，伺服器沒有 A 時當作 A。iOS 模擬器、Pixel 實機下載、判斷、從快取載入都確認過
- [x] E7 回答也在手機上寫（ADR-0017，2026-11-21）：手機支援時伺服器不呼叫任何 AI 模型（`clientCaps.edgeWrite` → `answer_draft`），`AbangEdgeAI.write`（Gemini Nano／Apple Intelligence）改寫程式版總結，程式護欄 `core/edge-write.js` 檢查數字、時間、ADR-0011；防詐不改寫；設定開關、`#/ai`「寫回答」、思考動畫「在手機上寫回答」（實機改寫品質與通過率待 Pixel／iPhone 量）
- [x] E8 設定頁可關閉裝置端 AI、顯示模型狀態（下載中、需要 Wi-Fi…）、隱私權政策說明（2026-11-21）
- [x] E9 阿幫的腦袋 `#/ai`：核心動畫、系統回報的模型資訊（外掛 `status()` 擴充）、現場試判斷、資料怎麼走（2026-11-21；實機欄位待 Pixel／iPhone 確認，首頁「手機上的 AI」狀態列入口另一個分支接）

## M13 Agent 聰明度（PM 情境清單，2026-11-21）

情境集：`test/scenarios/life.json`（`npm test` 示範模式；`scripts/eval-scenarios.js` 模型模式）。

- [x] A0 情境對話測試集（2026-11-21 晚：78 個情境，todo 0）
- [x] A2 轉述受程式約束：抵達時間、交通方式、不要的方式、狀態只採使用者說的；`plan_trip` 下一步；回答不露出工具名稱；起訖點已知的行程由程式先比較（PR #34）
- [x] S16 位置當起點：捷運沒說站找最近的站（指定路線只找該線）、拒絕定位先從臺北車站算並說明（PR #34）
- [x] A3 結構化上下文：接著改起點、目的地、時間、不要某方式、重來；「沿用：…｜改：…」（PR #35）
- [x] A1 新狀態（第一批）：帶長輩、帶小孩、行動不便（排除不適合的方式）；S13 出門建議（天氣＋空品）（PR #36）
- [x] A1b 新狀態（第二批）：`group` 多人（叫車人均）、`rainSoon`（降雨機率 ≥ 60% 提醒帶傘）、`tight` 時間很緊（快趕不上）；`night` 由 S10 末班車規則處理（2026-11-21）
- [x] S10 深夜末班車（示範規則：00～05 時公車不列入、23 時後提醒末班；真實以 TDX 到站狀態為準）（2026-11-21）
- [x] S7 捷運方案與轉乘（捷運線間轉乘一次，估算；2026-11-21）
- [x] S7b 公車＋捷運混合轉乘、真實捷運路網（2026-11-23：行程規劃的捷運段改用 StationOfLine 路網與 ODFare，跟 `metro_route` 共用；只用已存的資料、不多花額度；接駁到站仍是公車／YouBike 估算。站間時間依站數估，沒用 S2STravelTime 以省額度）
- [x] S12 觀光客英文對話（第一版：英文規則、地名別名、英文總結；2026-11-21）
- [x] S12b 卡片英文（`public/ui/cards/i18n/en.js`，英文提問的那一輪卡片 `lang: 'en'`；地名維持中文）（2026-11-21）
- [x] S12c 第一部分：討論串說明與標題、決策圖固定文字、「接下來可以」、收合（2026-11-21）
- [x] S12d 工具回報英文、空品狀態與「你的位置」走字典（2026-11-21）
- [x] S12e 英文：到站提醒通知（英文卡片設的）、英文問出門建議與藥局、出門建議卡英文（2026-11-21）
- [x] S12f 英文其餘（2026-11-21）：行程每段說明 `detailEn`、決策圖資料膠囊 `signalsEn`、公車到站文字與方向（Arriving、5 min、To X）、行程方案名稱（Bus 棕9、MRT 淡水信義線、Taxi）、藥局星期、討論串 @點名與頭像讀屏、「示範資料」「阿幫在想」；地名站名路線名維持中文
- [x] S12g 第一部分：`status` 事件帶 `lang`，前端照伺服器的判斷（送出前的猜測只用在第一個畫面）（2026-11-21）
- [x] S12g 公車頁英文（2026-11-21）：網址帶 `lang=en`（英文對話的「Open bus page」「Remind me to get off」、英文卡片的「Open live bus page」、英文設的提醒的進行中列）整頁英文，字典 `public/js/pages/bus-i18n.js`；街景（`scene.*`）、到站文字與方向、頂端示範／離線說明；到站、下車、出門提醒的通知標題與內文用英文；站名路線名照原文
- [x] S12g 外殼英文（2026-11-21）：網址帶 `lang=en`、或問阿幫最近一輪是英文時，分頁列、返回、浮動阿幫、底部對話面板、提醒泡泡、`<html lang>` 用英文；離開回中文（字典 `public/js/shell-i18n.js`）
- [x] S12g 其餘：更多英文地名（2026-11-21：106 個景點、夜市、車站、機場、醫院加英文名稱與別名，共 147 個）
- [x] S1 明天天氣（預報）：`weather_tomorrow`（2026-11-21）
- [x] S11／S15 多筆提醒（T7）、公車一直不來時建議改其他方式（晚 10 分以上或連續未發車；沿用起訖、排除公車）（2026-11-21）
- [x] 主動助手第一版：首頁「今天」卡＋「阿幫記得你」（2026-11-28，Claude 與 Antigravity 第十三輪；Austin：「讓版本看起來有大改動」）：打開 App 時在前景算（時段 × 辦公日曆的上班日／補班日／放假 × 常用地點 × 天氣空品），一句話、帶傘雨衣口罩提醒、馬上能按的問題；「依據」點開看得到、一項一項忘掉。✅ Android 主畫面小工具「阿幫・今天」（只在打開 App 時更新、寫明幾點的資料）。剩：iOS 小工具（WidgetKit extension）、颱風停班停課（資料來源待驗證）、打烊前提早停止掛號的提醒、出門前 N 分鐘有異常才通知（要原生背景，等 Austin）
- [x] P1-5 v2 行程中出狀況主動給 B 方案（2026-11-28，Antigravity 第六輪）：公車一直不來、末班已過時，泡泡直接說「可以改坐捷運，大約 10:42 到（比原本晚 10 分）」（`core/b-plan.js`，手機上重算、不打 API）；按了取消舊提醒、用最新資料重查。✅ 2026-11-28 趕不上下一段：台鐵／高鐵／末班車的出門提醒響後問一次「要我用一次位置幫你看還趕不趕得上嗎？」（`core/catch-train.js`、`public/js/catch-train.js`；Antigravity 第九輪）。剩：國道塞車變嚴重
- [x] 「重來」分隔線、沒變的卡片收合、決策圖收班節點（2026-11-21）
- [x] 出門建議小卡（傘、衣著、口罩）：`outing_advice` 工具＋`outing` 卡片（2026-11-21）
- [x] S1 常用地點（家、公司、學校：「回家」直接成行程；座標只在手機、提到才送）（2026-11-21）
- [x] R1 判斷看得到（產品負責人 2026-11-21：「他說會看天氣空氣品質，但都只顯示詢問定位」）：`plan_trip.considered`（天氣、空品、路況的值與影響）→ 討論串 `data_note` 各一行（示範與模型模式相同、不經模型）、決策圖資料欄每個來源一個節點（不影響淡色、查不到照實寫）；空品測站 > 25 公里不採用；只有一種方式時 `single` 說明原因＋「改成明天早上出發」「改從台北車站出發比較看看」建議（之後改用「阿幫問你」）
- [x] R2 深夜與沒列入的原因（產品負責人 2026-11-22：半夜 00:10 問「去台北101」沒有公車和捷運，以為是 bug）：捷運營運時間常數（收班不列入、收班前 30 分提醒末班；⚠️ 大約值）、`plan_trip.missing`（任何時候都說公車、捷運等為什麼沒列入）與 `night`（深夜第一句）；卡片「沒列入」清單與橘底深夜一行、決策圖灰色節點＋原因、討論串與回答（中、英）；TDX 額度用完時公車收班照實說依時間估（2026-11-22）
- [x] S1b 常用地點：「輸入地點」打車站、捷運站、地標名稱（`find_place` 最多 5 個結果選一個），不必人在現場；列上顯示「已設定：板橋車站」讓人確認。門牌地址要等地址定位服務（列入 S1e）
- [ ] S1e 常用地點用門牌地址設定（需要地址轉座標的資料來源，例如 TGOS；屬新資料來源，需評估）
- [x] S1c 定位失敗分原因（權限／定位服務關閉／逾時）＋「到設定開啟」（專案內外掛 `AbangSystem`）；附近、生活服務、問阿幫、設定、引導都說原因；Android `prompt-with-rationale` 顯示「拒絕過一次」（2026-11-21）
- [ ] S1d 本機資料改存 Capacitor Preferences（iOS 可能清掉 WKWebView 的 localStorage；新依賴要 ADR，PrivacyInfo 加 UserDefaults CA92.1；收藏、我的發票同理）
- [x] S16 高鐵／台鐵「最近車站」當起站（2026-11-21：`near`；「下一班高鐵到台中」「台鐵回高雄幾點有車」）
- [x] S16 藥局定位轉行政區（「附近的藥局」先定位，真實用最近氣象站的縣市鄉鎮並說是推估；說了地標用地標推估）（2026-11-21）；英文「pharmacy near me」待 S12c
- [x] S6 叫車人均（多人：4 人一輛、超過叫多輛）（2026-11-21）
- [ ] S5 YouBike 空位預測（騎到時可能沒位）：要有各站歷史車位資料才預測得準（TDX 只有即時快照）；目前以「只剩 N 個空位＋備用站」提醒代替
- [x] S19 安全情境：自傷與緊急狀況先給求助電話（1925、119／110／112），不查交通、不交給模型（2026-11-21）
- [ ] S17 長途訂票（導訂票權限 ⛔）
- [x] P2 阿幫問你（ADR-0016）：通用事件 `ask`（kind state／reply／store／action／dismiss、guess、pending）、共用區塊（問阿幫頁、底部面板）、直接打字回答（matchAnswer、pendingAsk→resolvePending）；關鍵因子 `keyQuestion`（趕不趕、省不省、行李、少走路）；習慣改成問過「好」才加分、叫車問原因（你說過的預設狀況）；情境檢查 asks／asksNone／askOptions／askKind／askGuess／toNot、情境 `here`（2026-11-21）
- [x] P2b PM 第六批：27 個「阿幫問你」Q 情境（該問就問、不該問就不問；`test/scenarios/life-q.json` Q-1～Q-27 全過）（2026-11-22）：`core/agent/clarify.js`（題目）＋`clarify-plan.js`（stop 只問／after 先用猜的查再問）；`PENDING_SLOTS` 加 railFrom、railTo、place、topic、where、busStop、invoiceNo，`to` 帶叫車；地名歧義（同名跨縣市、同城多義、連鎖、區名、只打名字、路名）、高鐵台鐵缺起站（有定位用最近的站）／迄站（最近站兩個方向先查）、只說類別、沒定位問在哪、公車沒定位問哪一站、公車往某方向（`bus_route_eta` `toward`、兩個方向都說）、捷運站名省略「捷運」、路線名不當地名、我中獎了嗎、要出門了、你就在那裡、防詐請他貼上、公車快到改問提醒、只回「好」；關鍵因子：走路 15 分內不問、趕時間快 5 分以上才問；手機出題新種類（railFrom／railTo／place／where／topic）選項要是程式的候選；模型模式也由程式先問（不用位置的那幾題）
- [x] P2b 後續三項（2026-11-22）：①「去機場」沒說哪個——有定位先用最近的機場排行程並問（選項最近的放第一、最多 3 個，第一個標猜的），沒定位只問，說了明確的機場或航廈不問，英文 to the airport 同理（情境 Q-28～Q-35、`test/airport-ask.test.js`）②北捷看板狀態正規化成代碼（arriving／approaching／minutes／scheduled／unknown），卡片中英字典、英文播報與摘要不出現中文，`metro.v1.json` 的 `trains[]` 改 enum＋`additionalProperties: false` ③站別時刻表看國定假日（`ServiceDay.NationalHolidays`、2026／2027 清單 `core/data/tw-holidays.json` 由官方辦公日曆 CSV 產生並核對、台灣時間）；PR #122 審查修正：去機場不搶天氣、空品、路況、否定、別人去、多站、提醒、帶什麼；從家／公司去機場；那去機場呢沿用起點；搭機捷＝桃園機場；台北＝松山機場；看板狀態舊值相容、英文卡片用英文線名與終點
- [x] P1 個人化：記住常選的交通方式（只在手機 `abang.habits`、只記方式與時間、最近 50 次、60 天半衰期、選滿 5 次生效；`userState.habit` → `plan_trip` `prefs.habit`，`decide.js` 最多加 8 分、說了狀況／指定方式／不要／抵達時間優先；決策圖「你常選」chip 可點掉、看為什麼；設定頁開關（預設開）與清除；ADR-0010 習慣）（2026-11-21）

## 體驗與品質補強（審查與 PM 建議，2026-11-21）

- [x] T6 iOS 名稱 Abang（主畫面、設定、權限畫面用的 `CFBundleDisplayName` 早已是 Abang；`PRODUCT_NAME` 維持 App 以免動到 Capacitor 的目標與路徑）；iOS 18 深色／著色圖示（`scripts/build-icons.js`；Xcode 編譯通過，實機深色主畫面待確認）（2026-11-21）
- [x] T7 通知體驗：第一次提醒前的說明（為什麼要通知）、`remind()` 可取消與多筆、重開機後過期通知不補送；設定頁列出出門提醒（2026-11-21）
- [x] T8 測試補強：公車街景 DOM（讀屏標籤、公車位置、推估不出不畫車、圖片載不到）、天氣卡日夜（台灣時間）（2026-11-21）
- [x] T8b Android 原生 App 煙霧測試 `npm run smoke:android`（adb＋WebView 偵錯通道：原生外掛都註冊、6 頁、浮動阿幫、返回鍵收起；Pixel 實機全過，2026-11-21）
- [x] T8c iOS 模擬器煙霧測試 `npm run smoke:ios`（simctl＋模擬器 Web Inspector 通道，不加依賴、不動 Xcode 專案：原生外掛 8 個都註冊、10 頁、中央鍵拉出與收起對話、沒有畫面錯誤、沒有閃退與當機報告；iPhone 18 Pro 模擬器全過，2026-11-23）
- [x] 首次使用引導（起點用現在位置、點方案改選、提醒 App 關著也會響；在這裡要定位與通知權限）（2026-11-21）
- [x] 路線時間軸點站名設成上車站（2026-11-21）
- [x] 下車提醒（公車頁選上車站後選下車站，快到時提醒；知道車牌時等目的站下一班就是這台且 ≤ 2 分，否則照乘車時間估；App 關著也會響、重開恢復）（2026-11-21）
- [x] 行程中模式（2026-11-21）：坐車中畫面（到下車站還要多久、街景站牌換下車站、時間軸標下車站）、每一頁上方的進行中列、問阿幫「上車後提醒我下車」
- [ ] 行程中模式第二版：Doze 時的備援通知（Android 精準鬧鐘權限）、Live Activity／持續通知顯示倒數（需原生、另評估）
- [x] 離線與弱網：快取最近一次結果，顯示「上次更新時間」（公車、時刻表；附近查詢不存）（2026-11-21）
- [x] 真實資料健檢 S1（2026-11-22）：TDX 額度用完改用示範資料時，示範的公車、客運、高鐵、台鐵、捷運站、YouBike 方案不參加排名（`skipped` 照實說、`limited` 一句；大眾運輸全部沒有時先比走路、叫車並建議稍後再問）；估算值保守看（`UNCERTAIN`、客運與鐵路票價保守估）；機場捷運直達車公告參數；捷運沒列入的原因說哪一端；尚未發車的說法卡片與行程一致（ADR-0010 2026-11-22）

## 阿幫常駐（Austin 2026-11-21）

- [x] 對話保留（換頁不清掉，回來原樣）、浮動阿幫（每一頁右下角，從下方拉出同一段對話）、提醒由阿幫說（對話裡＋浮動泡泡）（2026-11-21）
- [x] 對話在 App 重開後還在（2026-11-21）：只存文字（不存卡片、座標）、最近 10 則、12 小時後清掉；收合顯示「上次的對話」，接著問接得上；設定頁本機資料清單與清除、隱私權政策
- [x] 公車街景會動：兩次更新之間照到站時間往站牌開、開車震動、到站煞車（2026-11-21）
- [x] 首頁格子點進去的頁首：同色立體圖示從格子飛進來、各自的小動作、說明與資料來源（2026-11-21）
- [x] 各頁資料小巧思（第一批，2026-11-21）：藥局「現在這個時段有開」、電話可撥；地震震度分色；垃圾車「再 N 分」與「今天的已經過了」；股市漲跌色條；天氣頁首依氣溫、空品頁首依 AQI 變色；卡片按鈕 ≥ 44px
- [x] 各頁資料小巧思（第二批，2026-11-21）：捷運官方路線色（`core/metro-colors.js`）與進站中閃點、YouBike 可借比例條、公車搜尋「最近查過」、回首頁時圖示飛回格子
- [x] 長對話（產品負責人 2026-11-21，UX.md §4.17）：舊的輪收成一行摘要（程式產生、可展開）、決策圖與卡片只在最新一輪、換話題或隔 30 分鐘分段、「這次問過」目錄、回到最新、提醒頁「看當時的對話」；底部對話面板一樣收合
- [ ] 油價週漲跌（需要上週牌價資料）
- [x] 浮動阿幫知道你在哪一頁：從公車、天氣、空品、地震、藥局、垃圾車、油價、發票、股市、捷運、高鐵台鐵、附近打開時「在這頁可以問」，這一頁的說明跟下一個問題一起送（2026-11-21）
- [x] 動態「下一句」建議（產品負責人 2026-11-21，UX.md §3.2、AGENT.md §5.5）：placeholder、輸入框上方建議（問阿幫頁與底部對話面板）、首頁範例依情境變；App 裡手機上的 AI 猜（外掛 `suggest()`）、伺服器規則驗證（`/api/v1/suggest/check`，只收句子）、丟掉查不到與畫面上重複的；網頁版與不足 3 句用情境規則；程式排序（即時資料優先）；設定開關
- [ ] 動態建議實機確認：Pixel（Gemini Nano 句子品質、延遲）、iPhone（Foundation Models）；之後跟另一分支的 `write()` 整併外掛
- [x] 「阿幫的腦袋」現場試判斷升級（產品負責人 2026-11-22：「除了意圖狀態外，可以多是否有足夠資料、最後預計回答的內容、下一個預計詢問使用者的內容」，UX.md §5.0.1、AGENT.md §3.6）：按一次逐段出現四段——意圖與狀態（手機；不能用改伺服器規則）、資料夠不夠（`trial` 事件，`core/agent/trial.js` 程式算欄位與資料來源真實／示範與原因）、預計回答（真的跑一次 edge 模式拿程式版，手機改寫與護欄結果兩版都列）、下一個預計問你（`ask` 事件＋動態建議前 3 句標來源）；每段標來源、耗時、有沒有用網路，可展開原始 JSON、複製結果；5 個測試句（含資料不夠、英文、防詐）；不送定位、常用地點、習慣；重用 `/api/v1/agent`（`clientCaps.trial`），不加新端點
- [x] 試判斷看出來的缺口（2026-11-22，「該問就問、不要自己猜」）：缺路線問「哪一路公車？」、只說起點當起點並問「要去哪裡？」、沒定位而目的地就在預設起點旁邊時問「你從哪裡出發？」；`PENDING_SLOTS` 加 `route`／`to`／`from`，打字回答接回原問題；中英文；情境 AS-1～AS-7
- [x] 問什麼由手機上的 AI 決定（2026-11-22，產品負責人：「決定要問什麼應該交給 edge AI」，ADR-0020）：手機 judge 一次回意圖、狀態與要不要問一題（route／to／from／state），情境只在手機上組；程式驗證（形狀：`core/edge-ask.js`，手機與伺服器共用；內容：缺的欄位要真的缺、狀態題要真的會換建議、選項要接得回），不通過照規則問（保底）；`ask.askSource`、`done.askCheck`；試判斷第 4 段標來源、列被擋的手機題目與原因；Android JSON、iOS `@Generable`；#115 情境用假外掛「合理／亂來」各跑一遍全過
- [ ] 手機出題實機確認：Pixel（Gemini Nano）、iPhone 15 Pro 以上（Apple Intelligence）的出題品質、採用率、judge 延遲（輸出多了 ask，原生 1.5 秒逾時是否夠）

## M14 阿幫聽得懂、看得懂（產品負責人，2026-11-21）

- [x] M14-01 語音問阿幫（2026-11-21，UX.md §5.0.3）：原生外掛 `AbangVoice`（Android SpeechRecognizer 手機上優先、iOS SFSpeechRecognizer `requiresOnDeviceRecognition`；照實回報是不是在手機上辨識）、`public/js/voice.js` 狀態機與控制器（停頓 1.5 秒自動送出、取消、錯誤）、輸入列麥克風鍵與在聽面板（核心跟著音量）、長按中央鍵放開送出、網頁版只在能本機辨識時顯示、英文那一輪用英文、設定開關、隱私權政策、`#/ai`「聽」卡片
- [x] M14-01a 只在手機上辨識（產品負責人 2026-11-21）：不退回系統／雲端辨識；語言包第一次按麥克風時協助下載（Android 13+，進度、準備中、到設定）；真的不支援就反白、點了說原因（iPhone 說怎麼開聽寫）；`#/ai` 照實顯示可用／下載中／不支援
- [ ] M14-01b 實機確認：Pixel（手機上 zh-TW 語言包、音量、停頓收尾、長按中央鍵）、iPhone（權限框文字、`supportsOnDeviceRecognition`、收尾）
- [x] M14-02 看：拍可疑簡訊或選截圖查詐騙、拍站牌路牌問怎麼走、拍發票自動對獎（2026-11-21，UX.md §5.0.4、ADR-0015：外掛 `AbangVision`〔Android ML Kit 中文讀字＋條碼打包版、Photo Picker、系統相機；iOS Vision、PHPicker、UIImagePickerController〕、`public/js/vision.js`、`core/vision-text.js`；設定頁開關、隱私權政策、`#/ai` 卡片；E2E 假外掛三條流程＋權限被拒＋網頁降級＋reduced motion。實機讀字品質、Gemini Nano 看圖支援待 Pixel／iPhone 確認）
- [ ] M14-02b 實機確認：Pixel（ML Kit 中文讀字品質、相機權限流程、Photo Picker、Gemini Nano 是否能看圖）、iPhone（Vision 繁體中文讀字、相機權限文案、PHPicker）；用實拍站牌、真實簡訊截圖校正分類規則

## M15 健康與運動（產品負責人，2026-11-22；ADR-0018）

- [x] M15-01 天氣好又動得少時建議去走走（2026-11-22，UX.md §5.0.5、AGENT.md §5.2.16）：外掛 `AbangHealth`（Android Health Connect `connect-client:1.1.0`，READ_STEPS／READ_EXERCISE、權限說明畫面；iOS HealthKit stepCount／appleExerciseTime、entitlement、NSHealthShareUsageDescription）、`core/health-nudge.js`（門檻常數、時段比例、天氣好、動得少＝步數少而且運動未達進度〔沒有運動紀錄只看步數〕、散步地點 10～25 分、文案、一天一次）、`public/js/health.js`（預設關閉、示範資料、權限、只在記憶體）、`public/js/health-ui.js`（首頁小卡、問阿幫補一句、設定頁與「我的」開關）；`weather_now` 加體感溫度 `feelsC`；地標庫加 `walk` 欄位與 13 個公園河濱步道；健康資料不送伺服器（單元測試＋E2E 檢查請求內容）。npm test 新增 18 項、E2E 4 項
- [ ] M15-01b 實機確認：Pixel（Health Connect 權限畫面與 rationale 畫面、步數與運動分鐘、沒裝 Health Connect 的舊手機）、iPhone（個人開發團隊能不能簽 HealthKit、權限畫面、讀取）
- [ ] M15-02 上架準備：Play Console 健康資料權限聲明與資料安全表單、App Store HealthKit 用途說明（付費開發者帳號）

## 阿幫・短劇（MyDrama，產品負責人 2026-11-22，ADR-0019）

- [x] D-01 片庫 adapter（2026-11-22）：`core/services/drama.js`（只用公開讀取：排行、搜尋、單劇、簡介、熱搜；網址只在 `MYDRAMA_API_BASE`；防禦解析、正規化、限制級不列；快取 10 分／1 小時）＋`drama-mock.js`（虛構示範片庫，介面相同）
- [x] D-02 工具 `drama_picks`、`drama_search`、`drama_series`（pack `drama`、L1、卡片 `drama`；JSON Schema `drama.v1.json`、字典 zh-TW／en）
- [x] D-03 問阿幫找劇：示範意圖 `drama`（排行、類型、其他題材、劇名問劇情、沒找到改熱門、英文）；情境 D1-1～D1-8；地端模型模式由規則回答
- [x] D-04 等車推短劇：`core/agent/wait-drama.js`、事件 `aside`、卡片下方提示（看這集／不用了）、設定頁開關（預設開）、`host.openApp`（App 連結＋商店頁備援）；一輪最多一次、≥ 5 分才推、英文不推
- [x] D-05 運動建議提示句與連結（`core/drama-say.js` `exerciseNudge`、`svc.drama.exerciseLink()`）；2026-11-22 已在健康與運動分支接上（散步小卡與問阿幫補句的「看 MyDrama 活動頁」，連結經 `/api/v1/status` 的 `partner`，健康資料不交出去）
- [ ] D-06 產品負責人看截圖（`test/screenshots/phone-drama-wait.png`、`phone-drama-card.png`、`desktop-drama-card.png`、`phone-drama-setting.png`）後決定合併
- [ ] D-07 ⛔ 合作方提供 `.env`（產品負責人 2026-11-22：連結與商店網址先留空，`.env.example` 只有變數名）：`MYDRAMA_API_BASE`、`MYDRAMA_LINK_EPISODE`、`MYDRAMA_LINK_EXERCISE`、`MYDRAMA_STORE_IOS`／`ANDROID`；實機確認 App 連結與商店備援（Pixel、iPhone）
- [x] D-09 推薦輪替（產品負責人 2026-11-22）：熱門前 5 部裡可看的，依台灣日期＋對話輪次輪替；同一輪重問同一部
- [ ] D-08 待辦：請 MyDrama 片庫加「每集長度」欄位；之後把「一集看得完」從 ≥ 5 分改成精準比較（門檻維持 ≥ 5 分、< 40 分，產品負責人 2026-11-22）

## M16 阿幫動手做（產品負責人 2026-11-27；ADR-0021）

- [x] M16-00 研究（2026-11-27）：Android AppFunctions（1.0.0 穩定、Android 16、Kotlin＋KSP、Gemini 要申請預覽）、ML Kit function calling（預覽、Gemini Nano 4、minSdk 26）、Apple App Intents／App Schemas（Siri，沒有交通領域）與 Foundation Models `Tool`、Google AI Edge Gallery（Mobile Actions：FunctionGemma 270M＋系統 Intent）
- [x] M16-01 加到行事曆、分享（2026-11-27）：`core/device-actions.js`（事件、分享文字、.ics、檢查；不帶使用者座標）、行程卡片按鈕、意圖 `calendar`／`share`（31 類）、`ask` 動作 `addCalendar`／`share`、請求 `deviceActions`、`AbangSystem.addCalendarEvent`／`share`（iOS EventKitUI＋UIActivityViewController、Android ACTION_INSERT＋chooser）、網頁 .ics 與 Web Share／複製。npm test 新增 12 項、E2E 1 項
- [ ] M16-01b 實機確認：Pixel ✅（2026-11-27：Google 日曆新增畫面帶好標題與時間、分享選單；修正 Android 讀不到毫秒時間戳記）；iOS 模擬器 ✅（不問權限的新增行程畫面帶好標題、時間、地點、路線；取消後卡片說「沒有加入」；分享面板）；實體 iPhone 待接上確認
- [x] M16-02 iOS App Intents＋App Shortcuts（2026-11-27）：「問阿幫」（帶問題）、「查詐騙」（帶可疑訊息到防詐）、「打開阿幫的頁面」（附近、天氣、提醒、防詐、發票對獎）；Siri、捷徑、Spotlight、動作按鈕都叫得到。原生端只把事情交給 App（`AbangIntents.swift` 收件匣 → `AbangSystem.takeIntent`／`intent` 事件 → `public/js/app-intents.js` 開頁面），不打 API、不念工具結果（防詐要經過防詐 agent 的完整判斷）。iOS 開發語言改成繁體中文（捷徑的中文說法才對得上 Siri）。模擬器實測三種交接與冷啟動
- [x] M16-02c 捷徑加「辦事要帶什麼」「找有開的診所」（2026-11-28，產品負責人：每個功能都想 App Functions）：`GovServiceIntent`（問要辦的事，交「X 要帶什麼」）、`ClinicNearbyIntent`（不用參數，交「附近現在有開的診所」）；一樣只把事情交給 App，走問阿幫原本的流程
- [ ] M16-02b 實機用 Siri 說「問 Abang」「用 Abang 查詐騙」確認（實體 iPhone）；實驗把 iOS 判斷改用 Foundation Models `Tool`，以 224 題評測決定
- [ ] M16-03 ⛔ Android AppFunctions：要加 Kotlin＋KSP（新依賴），只在 Android 16 以上有效；Gemini 呼叫要申請 Connected Apps Platform 預覽（等產品負責人決定）
- [x] M16-04a 去政府辦事要帶什麼（2026-11-27）：我的E政府申辦服務資訊（data.gov.tw 146973，三個 JSON、快取一天、失敗沿用上一份）、`core/services/govservice.js`（合併、口語換公文用字、中央優先的搜尋、應備證件分條）、示範用真實片段、工具 `gov_service_info`（pack `gov`）、卡片 `gov-service`、意圖 `gov`（32 類）、討論串 @辦事
- [x] M16-04b 找最近的戶政事務所、今天是不是上班日（2026-11-27）：自然人憑證點位（177793）的座標＋戶政通訊（7437）的電話、辦公日曆（14718，從資料集資訊找當年網址；沒有今天就照週末推並標示）；工具 `gov_office_nearby`、卡片 `gov-office`、規則 `GOV_OFFICE`（用現在位置）
- [x] M16-04c 護照現場等待人數（2026-11-27）：領務局 RSS（165115，TTL 60 秒）、工具 `passport_waiting`、卡片 `passport-wait`、規則 `PASSPORT_WAIT`（可指定據點）
- [x] M16-04d 官方入口（2026-11-27）：內建 11 個官方入口（`core/data/gov-links.json`，只收政府網域 https，逐一確認有回應）、工具 `gov_official_link`（L2）、卡片 `gov-links`（確認後開、提醒不要點簡訊連結）
- [x] M16-04e 現在有看診的診所（2026-11-27）：健保署特約診所（39283，每日、24 小時快取）、`core/services/clinic.js`（7×3 時段、西醫／牙醫／中醫、科別只認明講的）、工具 `clinic_search`（依位置推估在哪一區，這個時段有登記看診的排前面）、卡片 `clinic`、規則（藥局意圖＋`clinic` 旗標，不新增意圖；去醫院看病是行程；急症先 119）。資料沒有座標、不做地理編碼：說「這一區」，不說走路幾分鐘
- [x] 阿幫的腦袋加「行動」（2026-11-28，產品負責人：大腦示意圖加入 take action；PM 與設計收斂）：試判斷第 5 段「阿幫可以幫你做」（確認方式、在哪裡發生、iOS 的 Siri 一句）、主視覺「行動」節點、資料怎麼走第 7 步；`public/js/ai-actions.js`、`test/ai-actions.test.js`、e2e `phone-ai-act.png`。下一版：「阿幫在想」動畫加「準備行動」階段
- [ ] M16-04 待驗證：`www.gov.tw`（Cloudflare）伺服器每天下載是否穩定；監理所站等候人數（86565）資料網址被防機器人擋住，要問公路局正式介接方式；研究全文在 side-session notes `gov-services-research.md`

## 被卡住的項目（2026-11-21 彙整）

| 項目 | 卡在哪 | 誰 |
|---|---|---|
| 真實交通資料、M1 驗證、真實末班車與轉乘 | TDX Client ID／Secret | Austin |
| 高鐵／台鐵導訂票（M3-12、S17） | TDX 導訂票權限 | Austin |
| 真實天氣、地震／空品 | CWA 授權碼／MOENV 金鑰 | Austin |
| iOS Apple Intelligence 實機（E4） | iPhone 15 Pro 以上並開啟 Apple Intelligence | Austin |
| App 給別人用（TestFlight、Play 內測） | HTTPS 測試環境（M6-06）、Apple／Google 開發者帳號 | Austin |
| App 名稱 Abang 商標與商店撞名 | 智慧局檢索、商店搜尋 | Austin／法務 |
| Claude 模式與 MCP 連接器實測（M4-09） | `ANTHROPIC_API_KEY`、cloudflared | Austin |
| MyDrama 短劇真實片庫與深層連結（ADR-0019 已接好，示範資料可跑） | `.env` 設 `MYDRAMA_API_BASE`、`MYDRAMA_LINK_*`、`MYDRAMA_STORE_*`（合作方提供，不進 repo）；授權與分潤 | Austin／公司 |
| 推播排程（L-16）／手機條碼載具（L-15） | 推播伺服器與 ADR／財政部 AppID | Austin／公司 |
| 文件站發布 | repo Settings → Pages | Austin |
| 地標座標校對（201 筆）、正式 3D 吉祥物圖 | 人工校對、設計師 | Austin／設計資源 |
| Jev 實驗 | Jev 金鑰（可不做） | Austin |
| 安全情境用語與電話（S19） | 心理衛生、緊急應變專業人員確認 | Austin／專業人員 |
| 隱私權政策〔待補〕欄位 | 營運單位資料、法務確認 | Austin／法務 |
| 常用地點門牌地址（S1e） | 地址轉座標資料來源（TGOS 等）評估 | Austin |
| iPhone 讀步數（M15-01b） | 免費個人開發團隊可能不能簽 HealthKit；需付費 Apple 開發者帳號（2026-11-22 決定：維持簽不過就裝不含健康的版本、反白說原因；之後 iOS 改用模擬器安裝） | Austin |
| 健康資料上架（M15-02） | Play Console 健康資料權限聲明與資料安全表單；App Store HealthKit 用途說明與 App ID capability（付費帳號）；13 個新散步地點座標校對 | Austin |
- [ ] 之後：推播伺服器（排程，另寫 ADR，L-16）、地端 AI（判斷層放手機）、Siri 捷徑／App Intents、Android 小工具、App Attest／Play Integrity

## 其他候選（未排程）

地震、AQI（環境部）、藥局（健保署）、發票對獎（財政部）、TDX MaaS 多段轉乘、使用者帳號、民眾需求報表（給交通主管機關）。

## 市場現況備忘（2026-11）

- 交通部 TDX 已有官方 MCP（臺鐵／高鐵班次與票價、導訂票、道路事件；遠端 HTTP、需會員金鑰）。本專案不重複包裝 API，差異化在：跨資料組合（`plan_trip`）、討論串與決策圖、互動卡片、免帳號民眾 agent。M3-05／06 可評估直接介接官方 MCP（ARCHITECTURE「外部 MCP」）。
- 民間已有 data.gov.tw 資料集、政府採購、法規等 MCP；M8 先評估接用。
