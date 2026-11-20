# 裝置端判斷評測（ADR-0014 E6，2026-11-21）

評估集：`scripts/eval/decision-set.json`（172 題自行撰寫的繁中提問，與 `decision-eval.md` 相同）。驗收集＝雙數 id。
實機：Pixel 11 Pro XL（Android 17，Gemini Nano 經 AICore，ML Kit GenAI Prompt API 1.0.0-beta5），App debug 版，經 WebView 除錯通道逐題呼叫 `edgeJudge`。

| 方法 | 意圖 | 狀態 F1 | 全對 | 驗收集：意圖／全對 | 延遲 |
|---|---|---|---|---|---|
| A＋規則（伺服器，無模型；正式環境 Claude 模式的現況） | 86.0% | 76.7% | 77.9% | 87.2%／79.1% | < 5 ms |
| Gemini Nano 單獨（第一版指示詞） | 87.8% | 83.9% | 82.0% | 90.7%／84.9% | p50 251 ms／p95 309 ms |
| A＋規則＋Gemini Nano（第一版） | 91.3% | 88.2% | 86.6% | 91.9%／86.0% | 同上 |
| Gemini Nano 單獨（補捷運、高鐵台鐵、發票例句） | 90.1% | 83.9% | 85.5% | 91.9%／86.0% | p50 268 ms／p95 325 ms |
| **A＋規則＋Gemini Nano（採用：伺服器沒有 B 時）** | **92.4%** | **91.4%** | **89.0%** | **93.0%／88.4%** | 同上（送出前等待） |
| 參考：A＋規則＋地端 qwen3:8b（優化提示詞） | 94.2% | — | 89.5% | —／88.4% | 683 ms＋伺服器 GPU |

結論：手機組合與伺服器地端模型組合幾乎相同（驗收集全對都是 88.4%），延遲約 270 ms、不花伺服器 GPU。目前伺服器有地端模型時仍以伺服器模型為準；沒有時（Claude 模式、正式環境）由手機補上，全對 +11.1 個百分點。
注意：補例句是看了第一版答錯的類別才加的（例句不是評估集原句），驗收集也一起進步，但仍可能偏樂觀；之後新增題目再驗證。

第一版答錯集中在：捷運問下一班被當成公車（4 題）、高鐵／台鐵班次被當成行程（3 題）、發票對獎被當成其他（3 題），補例句後重測。每題結果在 `edge-eval-gemini-nano.json`。

Apple Intelligence：iOS 模擬器（Mac 的 Apple Intelligence）可執行，第一題冷啟動約 5 秒（超過 1.8 秒逾時就不等）；實機數據待 iPhone 15 Pro 以上。

重跑：
```bash
adb forward tcp:9334 localabstract:webview_devtools_remote_$(adb shell pidof tw.abang.app)
node scripts/eval-edge.js 9334
node scripts/eval-edge-combo.js gemini-nano
```
