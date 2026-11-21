# ADR-0016：阿幫問你——答案取決於使用者時，問一句

狀態：已採用（2026-11-21）；實作 `core/agent/ask.js`、`core/decide.js` `keyQuestion`、`core/agent/events.js` `ev.ask`、`public/ui/agent/ask.js`、`public/js/habits.js`；測試 `test/ask.test.js`、`test/habits.test.js`、E2E「阿幫問你」三項

## 背景
產品負責人（2026-11-21）：「如果多問使用者來判斷應該比較好，重要因子應可與用戶互動後完成。」「agent 不用每件事都自己決定，需要使用者互動得到答案會讓整體變快就問。」
先前的個人化（ADR-0010 習慣）會默默把「常選」的推測拿來加分；關鍵因子（趕不趕、帶不帶行李）也只能靠使用者自己說或自己點 chip。PM 盤點還發現：阿幫問「你要從哪一站出發？」，使用者回「台中」會被當成新的問題。

## 決策
1. **通用事件 `ask`**（`AGENT.md` §3.1）：
   ```jsonc
   { "type": "ask", "id": "ask-t7", "question": "叫車（Uber）快 5 分但多 270 元，你趕時間嗎？",
     "options": [{ "label": "趕", "kind": "state", "state": "rush", "say": "我趕時間" }, { "label": "不趕", "kind": "dismiss" }],
     "why": "（選填）為什麼問／存在哪", "about": "state:rush", "pending": { "slot": "state", "state": "rush" } }
   ```
   `options[].kind`（依 kind 帶不同欄位；`guess: true`＝阿幫猜的，放第一個、畫面標「猜的」）：
   - `state { state, say? }`：把狀態加進這一輪的決策，**前端用同一份 `/core/decide.js` 即時重算，不呼叫伺服器**；不能即時重算的客戶端改送 `say`。
   - `reply { say }`：把 `say` 當成使用者的下一句送出——**一定是完整的一句**（「高鐵台中到台北多少錢」，不是「台中」），pending 遺失也解析得對。
   - `store { value }`：存成手機上的偏好（例 `habit:yes:metro`、`ride:luggage`，`habits.js applyStore`），並把效果套到這一輪。
   - `action { action: { name: 'openLink'|'watchArrival'|'remind', ... } }`：手機做事，沿用卡片的 host 動作；連結類照 ADR-0011 先確認、只開 https。
   - `dismiss`：不做事（「不趕」「不用」也是回答）。
2. **等待中的答案（pending）**：`ask.pending = { slot, state?, intent? }` 說明在等什麼。使用者沒按按鈕、直接打字（或說話）時：
   - 前端先比對按鈕文字（`matchAnswer`：全字、包含〔長的先比，「我不趕」→ 不趕〕、兩個選項時「好／要／yes」＝第一個、「不用／no」＝第二個），對得上就當按了那個按鈕，**不送伺服器**。
   - 對不上就把 `pendingAsk: { id, ...pending }` 跟這一句一起送出（zod 驗證，≤ 1000 字元），`validateRequest` 用 `resolvePending` 依 slot 把短答改寫成完整的一句（slot `state`：「好」→「我趕時間」，接著上一輪的行程重算）；不是答案就照原句（＝略過）。新的情境（缺起站、地名有歧義…）在 `PENDING_SLOTS` 加一個 slot 即可。
3. **什麼時候問**
   - 答案取決於使用者、程式猜不到，而且**答案會改變結果**：`keyQuestion` 對這次的方案各試加上趕時間、想省錢、帶行李、少走路重算，建議會換、而且差別值得問（時間差 ≥ 5 分或費用差 ≥ 50 元）才問，挑影響最大的一個；不推明顯不合理的方案（比最快的慢 2 倍且多 20 分以上）。
   - 推測要變成會影響建議的偏好之前（習慣）：某種方式選過 ≥ 5 次且佔 6 成以上，問一次「以後要我優先推捷運嗎？」；常叫車問原因（有理由才推叫車）。
4. **什麼時候不問**
   - 使用者這一輪已經說了（或點了、之前說過）狀況、指定了方式；任何狀態都不會翻盤；差別太小。
   - 一輪最多一個問題（習慣確認優先，其次關鍵因子）。
   - 說「不用」的 90 天內不再問；問了沒回答（直接問別的）3 天內不再問；叫車原因答過就不再問。
   - 問題由程式產生，不交給模型；模型模式也由程式送 `ask`。
5. **畫面**：共用的「阿幫問你」區塊（問阿幫頁、底部對話面板）：有決策圖時放在它上方，否則接在後面；`role=group`＋`aria-labelledby`、問句 `aria-live=polite`、原生按鈕（≥ 44px）、可「略過」；不搶焦點，按了以後焦點留在結果句；reduced motion 不做進場動畫；英文那一輪問句與選項是英文。

## 不採用
- 讓模型自己決定要不要問、怎麼問：問句與選項要穩定、可測試，數字（快幾分、多幾元）要來自真實資料。
- 把習慣直接當加分（不問）：使用者看不出為什麼建議變了，也無從拒絕。

## 影響
- 事件型別加 `ask`（`EVENT_TYPES` 12 種）；請求加 `pendingAsk`、`userState.habitAsk`、`userState.usual`（`AGENT.md`）。
- `plan_trip` 輸出加 `ask`（關鍵問題）；狀態來源加 `usual`（你說過）。
- 情境檢查（`scripts/eval/scenario-check.js`）加 `asks`、`asksNone`、`askOptions`、`askKind`、`askGuess`、`toNot`；情境可指定 `here`；多輪情境會把上一輪的 `pending` 當 `pendingAsk` 帶回來（模擬前端）。
