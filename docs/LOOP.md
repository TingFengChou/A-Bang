# Claude Code 循環開發協定（LOOP）

給在 Claude Code 中以 `/loop`（或重複貼同一個 prompt）持續開發的 session。每一輪做**一個任務**，做完就停，下一輪重新讀狀態。這樣每輪的 context 都小、可中斷、可 review。

## 1. 每一輪的步驟

1. **讀狀態**：`CLAUDE.md` → `docs/PLAN.md` 的「狀態看板」→ `docs/PROGRESS.md` 最後 5 筆 → `git status`、`git log --oneline -5`。
2. **檢查上一輪**：工作區有未提交的變更 → 先判斷是否完成（跑 `npm test`）；完成就提交，壞掉就修好或還原，**不要疊加新任務**。
3. **選任務**：PLAN.md 中目前里程碑第一個未勾選、未標 ⛔ 的任務（依代號順序）。前置未完成就選前置。目前里程碑都做完 → 進下一個里程碑。
4. **讀規格**：只讀該任務需要的文件（見 §3 對照表）。
5. **實作**：最小可行的完整做法；真實服務＋mock 一起寫；新 tool 附 `pack`、`tier`、`speak`。
6. **驗證**（依序，全部要過）：
   1. `npm run lint`（ESLint）
   2. `npm test`（單元＋整合；新增或更新測試）
   3. `npm run e2e`（Playwright 冒煙測試；有 UI 的任務打開 `test/screenshots/` 的截圖自己看過）
   4. `/code-review`（正確性）與 `/security-review`（安全）；有發現就修完再往下。需要第二意見時請 agy 獨立審查（只讀），結果貼到 PR 留言保存。
7. **同步文件**：規格有變就改 `MCP_TOOLS.md`／`CARDS.md`／`AGENT.md`／`UX.md`；新增環境變數就改 `.env.example` 與 README；決策改變就寫新 ADR。
8. **勾選與紀錄**：PLAN.md 勾選（加日期與一行備註）、更新狀態看板「下一個任務」；在 `docs/PROGRESS.md` 最上面加一筆。
9. **提交並推到 PR 分支**：確認沒有 `.env`、金鑰、`test/screenshots/`、`dist/` 進版控後，`git add -A && git commit -m "feat(<scope>): <任務代號> <摘要>"`（Conventional Commits），再 `git push` 到目前的開發分支（例 `dev/m3-2`，已有對應的 PR）。**絕不直接推 `main`**；合併 PR 需 Austin 授權。
10. **結束本輪**：輸出 3–5 行摘要（做了什麼、測試數、下一個任務、是否有卡住）。

## 2. 停止條件（遇到就停下來，在摘要中說明，不要硬做）

- 需要金鑰、權限或外部網路（標 ⛔、或 TDX／CWA／Anthropic 實際連線）。
- 需要改變 ADR 的決策，或規格互相矛盾。
- 需要新增 npm 依賴（先說明理由，等確認）。
- 同一個測試修 3 次仍失敗。
- 任務會刪除或大幅改寫既有功能（超過該任務範圍）。
- 所有未卡住的任務都完成。

卡住時：在 PLAN.md 狀態看板「卡住」欄與 `PROGRESS.md` 記錄原因與需要 Austin 做的事，然後選下一個不受影響的任務；若沒有，停止。

## 3. 任務 → 必讀文件

| 任務 | 必讀 |
|---|---|
| M1-* | `DATA_SOURCES.md`、`TESTING.md` §3 |
| M3-01、M3-09、M3-12 | `MCP_TOOLS.md` §6、ADR-0011 |
| M3-02～08 | `MCP_TOOLS.md` 對應章節、`DATA_SOURCES.md` |
| M3-10、M3-11 | `MCP_TOOLS.md` §7、ADR-0010、`core/decide.js` |
| M3-13 | `ARCHITECTURE.md` §6、`AGENT.md` §3.1（`metrics`） |
| M4-* | `CARDS.md`、ADR-0003、ADR-0008、`UX.md` §6 |
| M5-* | `AGENT.md`、`UX.md`、ADR-0004、ADR-0009、ADR-0010、原型 `docs/prototypes/transit-discussion.html` |
| M6-* | `ARCHITECTURE.md` §7–8 |

## 4. 品質底線（每輪都要符合）

- `CLAUDE.md` 架構規則 1–11 全部遵守。
- 示範模式（無任何金鑰）下整個系統可跑。
- 不加假延遲、不捏造數字；`speak` 不經模型；排序走 `decide.js`。
- 淺色主題；使用者看得到的文字為繁體中文（台灣用語）。
- 不把 `.env`、金鑰、座標紀錄提交進 repo。
- lint、單元測試、E2E 全綠；CI（`.github/workflows/ci.yml`）在 PR 上也要綠。

## 5. Loop prompt

在 repo 根目錄開 Claude Code，貼上（或用 `/loop` 搭配這段）：

```
你是阿幫（A-Bang）專案的開發者。照 docs/LOOP.md 的協定做「一輪」：
1) 讀 CLAUDE.md、docs/PLAN.md 狀態看板、docs/PROGRESS.md 最後 5 筆、git status。
2) 若有上一輪未完成的變更，先收尾（npm test 通過後提交），本輪就結束。
3) 否則選 PLAN.md 目前里程碑第一個未勾選、未標 ⛔ 的任務，只讀 LOOP.md §3 列的必讀文件。
4) 實作＋測試，同步更新規格文件；依序跑 npm run lint、npm test、npm run e2e（有 UI 就看截圖）、/code-review、/security-review，有問題修完再往下。
5) 在 PLAN.md 勾選並更新狀態看板，在 docs/PROGRESS.md 最上面加一筆紀錄，git commit 後 push 到目前的開發分支（PR 分支，不推 main）。
6) 遇到 LOOP.md §2 的停止條件就停下並說明需要我做什麼。
最後用 3–5 行回報：完成的任務代號、測試數、下一個任務、卡住事項。
```

## 5.1 里程碑收尾 prompt（每個里程碑完成時用一次）

```
目前里程碑的任務都完成了。請照 docs/PLAN.md 該里程碑的「驗收」逐條驗證（npm test、示範模式實際操作、必要的 Playwright 截圖），
把結果寫進 docs/PROGRESS.md，更新狀態看板與 docs/index.html 對應章節的狀態，提交後告訴我是否可以開 PR。
```
