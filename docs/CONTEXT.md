# 專案脈絡與決策紀錄（給接手者與 Claude Code）

這份文件整理規劃階段（2026-11-17）與 Austin 討論後確定的事項，讓接手的人不用回頭翻對話。細節以各規格文件為準。

## 已確定

| 主題 | 決定 | 詳見 |
|---|---|---|
| 品牌 | 名稱「阿幫」（A-Bang），吉祥物台灣藍鵲；repo／套件名 `abang` | `BRAND.md` |
| 第一階段範圍 | 大眾運輸（公車、捷運、YouBike、台鐵、高鐵、從 A 到 B） | `PRD.md` |
| 平台優先順序 | **網頁優先**（PWA）；MCP 要「做完整」 | `PLAN.md` |
| MCP 形式 | stdio（本機）＋遠端 Streamable HTTP `/mcp`（Claude 自訂連接器）；結果附互動卡片（MCP Apps） | `MCP_TOOLS.md`、ADR-0003 |
| 民眾 agent | **兩者都做**：自家網頁 agent（Claude API）＋ Claude 連接器；兩邊卡片一致 | `AGENT.md`、ADR-0004 |
| 模型金鑰 | 目前沒有 Anthropic API Key → 先做**示範模式**（規則式意圖解析），之後填 `ANTHROPIC_API_KEY` 切換；預設 `claude-haiku-5-5` | `AGENT.md` |
| 架構 | 單一核心 `core/`，多個出口；tool 只定義一次（registry） | ADR-0001、ADR-0002 |
| Agent 產品線 | 阿幫・生活（M1–M6）→ 阿幫・防詐（M7）→ 阿幫・開業概念驗證（M8） | ADR-0005 |
| 平台化 | 「阿幫平台／Builder」列為 **M9 下一階段**，需先達啟動門檻；現在只做 🧩 預留 | `PLATFORM.md`、ADR-0007 |
| 多端 | Web、iOS、Android 共用同一套 MCP；卡片資料契約＋裝置端工具事件 | ADR-0008 |
| 文件 | `docs/index.html` 給人看（GitHub Pages）；`CLAUDE.md`＋`docs/*.md` 給 Claude Code（UX、CARDS、DATA_SOURCES、TESTING、LOOP 為 v0.4 新增） | `HANDOFF.md` |
| 開發方式 | 交給 Claude Code，一次一個里程碑，上 GitHub（`TingFengChou/A-Bang`） | `HANDOFF.md` |
| Agent 體驗 | 要「很自動」、看得到多 MCP 互相討論；**先以交通為主、簡單、淺色**。採「小幫手討論串」：阿幫點名工具、工具一句話回報、結論卡片即時更新。深色 HUD 版本已退回不用 | ADR-0009、`prototypes/transit-discussion.html` |
| 導航 | TDX 站牌、站位、YouBike、車站都有經緯度；卡片提供「導航」按鈕開啟 Google／Apple 地圖；App 內提供「出發時機」與到站提醒，不做完整逐步導航 | `MCP_TOOLS.md` |
| 訂票 | 先做 TDX「導訂票」：產生具時效性的官方訂票連結（自動帶入車次、張數），付款在官方網站完成；需先申請 TDX 權限。站內直接購票需與台鐵、高鐵洽談 | `MCP_TOOLS.md`、`PLAN.md` M3 |
| 決策 | 阿幫依「MCP 資料＋使用者狀態」決策：比較時間、等車、走路、費用、淋雨、體力、塞車風險；狀態可自動判斷（天氣、路況）、使用者說或點選；由 `core/decide.js` 計分，模型不計分；決策過程有動畫 | ADR-0010 |
| 叫車 | YouBike 保留；叫車以 provider adapter 預留，先做 Uber 深層連結 | `MCP_TOOLS.md` |
| 3D | 先做輕量 CSS 3D（卡片立體進場、排名翻轉）；3D 吉祥物與 3D 地圖待評估 | `PLAN.md` M5 |
| 進度（v0.4） | M0、M2、決策引擎、`speak` 完成（24 項測試通過）；下一步 M3；Claude 實機連線待本機驗證 | `PLAN.md` 狀態看板 |
| 天氣與路況 | 決策的「自動狀態」來源：`weather_now`（氣象署）→ 下雨；`traffic_status`（TDX 路況）→ 塞車中（塞車時建議台鐵／高鐵） | `MCP_TOOLS.md`、`DATA_SOURCES.md` |
| 行動 | 導航、訂票、叫車只產生官方連結，L2 需使用者確認 | ADR-0011 |
| 開發方式 v0.4 | Claude Code 以 `/loop` 每輪一個任務（任務代號），紀錄在 `PROGRESS.md` | `LOOP.md` |

## 市場現況（2026-11 調查，影響定位）

- 交通部 TDX 已有官方 MCP（臺鐵／高鐵、道路事件）→ 不重複包 API，差異化在組合工具、互動卡片、免帳號民眾 agent。
- 歐噴資料庫（g0v 背景）、Twinkle Hub：政府資料給 AI 用 → 資料層優先評估串接。
- LINE 官方帳號 AI 代理平台（目標 2027 Q1）：店家自建 agent，與 M9 Builder 重疊 → 把 LINE 當通路，不正面競爭。
- 中華電信「防詐守衛」：AI 判斷可疑訊息，與阿幫・防詐重疊 → 需結合台灣大哥大自身能力做出差異。

## 尚未確定／待驗證

- TDX 部分端點（PassThrough Station、Bus Shape、Metro LiveBoard、路況、客運、票價、導訂票、地理編碼）與 CWA 欄位 → M1 實測（`PLAN.md` 待驗證表）
- MCP SDK v1 或 v2 → ADR-0006 提議維持 v1，待 Austin 確認；M4-04 再評估
- 阿幫商標可否註冊（建議組合商標）→ `BRAND.md` §5
- 平台相關法務問題 → `PLATFORM.md` §12
- 吉祥物正式設計（目前為程式產生的示意草圖）

## 環境限制備忘

- 雲端開發環境連不到 TDX；**M1 必須在本機（Austin 的 Mac）用 TDX 金鑰執行**。
- CI 一律示範模式，不放金鑰。
