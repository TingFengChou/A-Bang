# 架構決策紀錄（ADR）

改變決策時新增一份 ADR，不要改舊 ADR 的結論；舊 ADR 狀態改為「被 ADR-NNNN 取代」。

| # | 標題 | 狀態 | 影響範圍 |
|---|---|---|---|
| [0001](0001-shared-core.md) | 單一共用核心，多個出口 | 已採用 | 全部 |
| [0002](0002-tool-registry.md) | Tool 只定義一次（registry） | 已採用・M2 完成 | `core/tools/` |
| [0003](0003-mcp-apps-cards.md) | 互動卡片採 MCP Apps，渲染與網頁共用 | 已採用・M4 | `public/ui/cards/` |
| [0004](0004-agent-local-tool-loop.md) | 網頁 agent 在伺服器本地執行 tool 迴圈 | 已採用・M5 | `core/agent/` |
| [0005](0005-multi-agent-platform.md) | 多 agent 共用平台（agent profile） | 已採用方向・M7 | `core/agents/` |
| [0006](0006-mcp-sdk-version.md) | MCP SDK 先維持 v1 | 已採用；M4 評估後維持 v1，ext-apps 用 1.7.x | `mcp/` |
| [0007](0007-platform-phase-gate.md) | 阿幫平台列下一階段，以啟動門檻控管 | 已採用 | M9 |
| [0008](0008-client-agnostic-contracts.md) | 卡片資料契約與裝置端工具事件 | 已採用 | 卡片、事件 |
| [0009](0009-agent-visual-events.md) | 小幫手討論串呈現多 MCP 協作 | 已採用 | M5 UI、`speak` |
| [0010](0010-decision-engine.md) | MCP 資料＋使用者狀態決策，由程式計分 | 已採用・引擎完成 | `core/decide.js` |
| [0011](0011-actions-via-links-and-providers.md) | 導航、訂票、叫車以官方連結＋provider adapter 實作 | 已採用 | `core/providers/`、L2 tools |
| [0012](0012-model-providers.md) | 網頁 agent 的模型可選 Claude 或地端模型 | 已採用・M5-05 | `core/agent/` |
| [0013](0013-native-app-capacitor.md) | 手機 App 用 Capacitor 包現有網頁 | 已採用 | `android/`、`ios/`、`scripts/build-app.js` |
| [0014](0014-edge-ai.md) | 裝置端 AI：手機上判斷意圖與狀態（Apple Intelligence、Gemini Nano） | 已採用 | `AbangEdgeAI` 外掛、`public/js/edge-judge.js`、`judge.js` |
| [0015](0015-see-and-hear.md) | 裝置端的聽與看：手機上先讀懂，只送文字 | 已採用 | `AbangVision`／`AbangVoice` 外掛、`public/js/vision.js`、`core/vision-text.js` |
| [0016](0016-ask-the-user.md) | 阿幫問你：答案取決於使用者時問一句（事件 `ask`、pending、什麼時候問／不問） | 已採用 | `core/agent/ask.js`、`keyQuestion`、`public/ui/agent/ask.js` |
| [0017](0017-edge-write.md) | 回答也在手機上寫（Gemini Nano／Apple Intelligence，程式護欄檢查數字） | 已採用 | `AbangEdgeAI.write`、`core/edge-write.js`、`public/js/edge-write.js`、`answer_draft` |
| [0018](0018-health-on-device.md) | 健康資料只在手機、只讀、預設關閉（步數與運動時間；天氣好又動得少時建議去走走） | 已採用 | `AbangHealth` 外掛、`core/health-nudge.js`、`public/js/health.js` |
| [0020](0020-edge-ask.md) | 問什麼由手機上的 AI 決定（一次 judge 同時出題），程式驗證、規則保底 | 已採用 | `core/edge-ask.js`、`core/agent/ask.js` `deviceSlotAsk`／`deviceStateAsk`、`AbangEdgeAI.judge` |
| [0021](0021-device-actions.md) | 阿幫動手做：裝置動作（加到行事曆、分享）由系統畫面做最後確認；之後 iOS App Intents、Android AppFunctions | 已採用 | `core/device-actions.js`、`AbangSystem` 外掛、`public/js/device-actions.js`、`core/agent/device-turn.js` |
| [0022](0022-homophone-place-names.md) | 地名的同音字容錯：先把地名交給手機語音辨識當提示（iOS contextualStrings、Android 13+ biasing），聽錯了只在找不到地點時、有限候選裡比同音字並出題確認（不默默套用）；同音字先用手寫對照表，不加依賴 | 已採用（實作進行中） | （待實作）`core/homophone.js`、`AbangVoice` 外掛 |
| [0023](0023-home-night-and-light.md) | 首頁改版「夜色與光」：依時間變化的天空（首頁夜間是 ADR-0009 淺色原則的例外）、一張「現在的建議」卡（固定通勤方式的今日狀況、出發地可切換到目前位置）、底部輸入列取代分頁列（只在首頁與一級總覽頁）、特色依平台據實外顯、捷運標「依時刻表」不寫延誤分鐘；解凍範圍只限本次改版 | 已採用（實作進行中） | `docs/HOME_REDESIGN.md`、`docs/prototypes/home-night-light.html` |
| [0019](0019-drama-content-partner.md) | 第一個非政府開放資料的內容合作來源：MyDrama 短劇（只用公開讀取、網址在 env、不收個資、深層連結交給 MyDrama App） | 已採用 | `core/services/drama.js`、`core/tools/drama.js`、`core/agent/wait-drama.js`、`drama` 卡片 |

範本：

```markdown
# ADR-NNNN：標題

狀態：提議／已採用／被 ADR-NNNN 取代（日期）

## 背景
## 決策
## 不採用（選填）
## 影響
```
