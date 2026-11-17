# 交接：上 GitHub 與交給 Claude Code 循環開發

版本：v0.4（2026-11-17）

## 1. 本機整理（第一次）

```bash
cd ~/workspace/A-Bang
rm -rf node_modules && npm ci        # 雲端寫入的 node_modules 是 Linux 版，Mac 上要重裝
mkdir -p .github && cp -R _github/* .github/ && rm -rf _github   # 同步工具無法直接寫 .github
npm test                             # 應為 24 項全過
cp .env.example .env                 # 填金鑰（可先留空＝示範模式）
```

## 2. 上 GitHub（`TingFengChou/A-Bang`）

```bash
git init -b main          # 已有 .git 就跳過
git add -A
git status                # 確認沒有 .env、node_modules、dist
git commit -m "docs: v0.4 development-ready specs, loop protocol, decision engine"
git remote add origin https://github.com/TingFengChou/A-Bang.git   # 已設定就跳過
git push -u origin main
```

GitHub 設定：

| 項目 | 設定 |
|---|---|
| CI | `.github/workflows/ci.yml` 自動執行（示範模式） |
| 文件網站 | Settings → Pages → Source 選 **GitHub Actions**（`pages.yml` 發布 `docs/`） |
| 分支保護 | `main` 需 PR＋CI 通過（若要 Claude Code 直接在 main 提交，先不要開） |
| Secrets（M6） | `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`、`CWA_API_KEY`、`ANTHROPIC_API_KEY` |
| Labels | `for m in M1 M3 M4 M5 M6; do gh label create $m --color 0f766e; done` |

## 3. 交給 Claude Code

1. 在 repo 根目錄開 Claude Code（會自動讀 `CLAUDE.md`）。
2. 建議開一個工作分支：`git checkout -b dev/m3`。
3. 貼上 `docs/LOOP.md` §5 的 **Loop prompt**，或用 `/loop` 重複執行它。每輪做一個任務並 commit。
4. 每個里程碑完成時，貼 §5.1 的**里程碑收尾 prompt**，review 後開 PR 合併。

建議節奏：前 2–3 輪手動看結果（確認風格與品質），再交給 `/loop` 連續跑。

## 4. 需要 Austin 的地方（Claude Code 會在這些地方停下來）

| 事項 | 何時 | 做法 |
|---|---|---|
| TDX 金鑰 | M1 | 填 `.env`，本機跑 `node scripts/verify-tdx.js`、`record-fixtures.js` |
| 導訂票權限 | M3-12 | TDX 會員中心申請「臺鐵訂票導訂」「高鐵訂票導訂」 |
| CWA 授權碼 | M3-08 真實資料 | opendata.cwa.gov.tw 申請 |
| Claude 連接器實測 | M2／M4 | `cloudflared` → Claude 自訂連接器 |
| ADR-0006（SDK v1） | M4-04 前 | 確認或請 Claude Code 評估 v2 |
| 新增 npm 依賴 | 隨時 | Claude Code 會先說明理由 |
| Anthropic API Key | M5 Claude 模式 | 填 `.env`，設定每日預算 |
| 部署 | M6 | 選平台與網域；部署指令執行前確認 |

## 5. 安全提醒

- 金鑰只放 `.env` 或 GitHub Secrets，不要貼到對話或 issue。
- CI 一律示範模式，不放金鑰。
- Claude Code 預設不 push；要它 push 時在 prompt 明說。
