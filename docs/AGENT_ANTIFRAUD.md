# 阿幫・防詐（antifraud agent）規格

版本：v0.1（2026-11-19，M7）。決策：ADR-0005（多 agent）、ADR-0007（平台預留）、`PLATFORM.md` §風險分級（L2）。

## 1. 目標與範圍

民眾把可疑的簡訊、LINE 訊息、網址或來電內容貼給阿幫，阿幫用**公開資料＋人工維護的規則**指出可疑之處，並告訴他下一步（打 165、不要點連結、不要匯款）。

- 不判定「安全」：查不到只說「沒有發現已知的詐騙特徵」，並提醒仍要小心（L2 護欄）。
- 不開啟、不抓取使用者貼的連結；只比對網域。
- 不儲存使用者貼上的內容；log 不記內容（同 `AGENT.md` §7）。
- 不要求、不記錄個資；不代替使用者報案或聯絡任何人。

## 2. 資料來源（政府開放資料，免金鑰）

| 資料 | data.gov.tw | 更新 | 欄位 | 用途 | TTL |
|---|---|---|---|---|---|
| 165 遭停止解析涉詐網站 | [176455](https://data.gov.tw/dataset/176455) | 每月 | 民國年月、網域、網站性質、法律依據、聲請單位 | `scam_lookup_url`、`scam_check_message` 的網址比對（約 10 萬筆） | 24 小時 |
| 165 詐騙闢謠專區 | [38262](https://data.gov.tw/dataset/38262) | 每 7 日 | 編號、標題、發佈時間、發佈內容 | `scam_myth_search` | 24 小時 |
| 詐騙特徵規則庫 | `core/data/scam-rules.json`（人工維護、版本化） | 人工 | id、類別、說明、比對樣式、權重、建議 | `scam_check_message` | — |

下載網址（CSV，`opdadm.moi.gov.tw` no-auth）寫在 `core/services/antifraud.js`；欄位以名稱對應、防禦性解析（欄位改名時回清楚錯誤）。舊的「詐騙 LINE ID」資料集已下架（2024-11 起停止更新），不使用；需要時引導民眾到 165 打詐儀錶板查詢。

模式：伺服器預設使用真實開放資料（`openData`，`DEMO_MODE=1` 時改用示範資料）；測試與 CI 一律示範資料（`core/data/demo/antifraud-*.csv`，真實 CSV 的小片段）。

## 3. Tools（pack `antifraud`）

| tool | tier | 輸入 | 輸出 `data` | 卡片 |
|---|---|---|---|---|
| `scam_check_message` | L2 | `text`（≤ 2000 字） | `{ level: 'high'\|'medium'\|'low', score, findings: [{ id, category, label, excerpt }], urls: [{ input, domain, listed, category?, month? }], advice: string[], myths: [{ id, title, date }], rulesVersion }` | `scam-risk` |
| `scam_lookup_url` | L2 | `url`（網址或網域） | `{ input, domain, listed, matches: [{ domain, category, month, basis }] }` | — |
| `scam_myth_search` | L1 | `query` | `{ query, results: [{ id, title, date, summary }] }` | — |
| `sms_sender_check` | L2 | `sender`（簡訊顯示的號碼或名稱） | `{ sender, kind, risk: 'high'\|'medium'\|'low', note }` | — |

風險等級（`scam_check_message`）：網址命中停止解析清單 → `high`；否則規則權重加總 ≥ 6 → `high`、≥ 3 → `medium`、其他 `low`。`low` 的說法固定為「沒有發現已知的詐騙特徵，但不代表一定安全」。

`sms_sender_check` 規則：`111` 為政府機關簡訊專用短碼；`+` 開頭且非 `+886` 的國際號碼 → 高；`09` 開頭的個人手機號碼自稱機關／銀行／物流 → 中；4–6 碼短碼多為企業簡訊（仍要看內容）。

## 4. 規則庫（`core/data/scam-rules.json`）

`{ version, updatedAt, reviewedBy, rules: [{ id, category, label, patterns: [regex], weight, advice }] }`。類別參考 165 常見手法：假投資、解除分期付款、假冒檢警、假網拍、假交友、假中獎、冒充親友、釣魚簡訊（包裹、電費、罰單、帳戶異常）、假求職（收簿子）、遊戲點數、要求加 LINE、要求匯款、急迫施壓、索取驗證碼。`reviewedBy` 在專家審核前為「待審核」，卡片上照實標示。

## 5. 卡片 `scam-risk`

等級（高／中／低，色彩＋文字，不只靠顏色）、可疑字句（標出命中的片段）、網址比對結果、下一步（固定含「撥打 165」）、相關闢謠文章、免責聲明與規則庫版本。契約 `public/ui/cards/schema/scam-risk.v1.json`。

## 6. Agent profile（`core/agents/antifraud.json`）

- 網頁 `#/agent/antifraud`、API `POST /api/v1/agent/antifraud`、MCP `/mcp/antifraud`。
- 示範模式：貼上的內容 → `scam_check_message`；只有網址 → `scam_lookup_url`；「簡訊從 XXX 寄來」→ `sms_sender_check`；「…是真的嗎」「闢謠」→ `scam_myth_search`。

## 7. L2 輸出護欄（`core/agent/guardrails.js`）

模型或示範總結的文字經輸出檢查器：出現「安全」「可以放心」「不是詐騙」等保證字眼時改寫成「沒有發現已知的詐騙特徵」，並送 `guardrail` 事件（`{ tier: 'L2', rule: 'no-safety-claim' }`）；antifraud 的總結一律附上「有疑問請撥 165」。
