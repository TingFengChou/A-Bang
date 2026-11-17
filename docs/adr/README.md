# 架構決策紀錄（ADR）

改變決策時新增一份 ADR，不要改舊 ADR 的結論；舊 ADR 狀態改為「被 ADR-NNNN 取代」。

| # | 標題 | 狀態 | 影響範圍 |
|---|---|---|---|
| [0001](0001-shared-core.md) | 單一共用核心，多個出口 | 已採用 | 全部 |
| [0002](0002-tool-registry.md) | Tool 只定義一次（registry） | 已採用・M2 完成 | `core/tools/` |
| [0003](0003-mcp-apps-cards.md) | 互動卡片採 MCP Apps，渲染與網頁共用 | 已採用・M4 | `public/ui/cards/` |
| [0004](0004-agent-local-tool-loop.md) | 網頁 agent 在伺服器本地執行 tool 迴圈 | 已採用・M5 | `core/agent/` |
| [0005](0005-multi-agent-platform.md) | 多 agent 共用平台（agent profile） | 已採用方向・M7 | `core/agents/` |
| [0006](0006-mcp-sdk-version.md) | MCP SDK 先維持 v1 | **提議，待 Austin 確認**；M4-04 再評估 v2 | `mcp/` |
| [0007](0007-platform-phase-gate.md) | 阿幫平台列下一階段，以啟動門檻控管 | 已採用 | M9 |
| [0008](0008-client-agnostic-contracts.md) | 卡片資料契約與裝置端工具事件 | 已採用 | 卡片、事件 |
| [0009](0009-agent-visual-events.md) | 小幫手討論串呈現多 MCP 協作 | 已採用 | M5 UI、`speak` |
| [0010](0010-decision-engine.md) | MCP 資料＋使用者狀態決策，由程式計分 | 已採用・引擎完成 | `core/decide.js` |
| [0011](0011-actions-via-links-and-providers.md) | 導航、訂票、叫車以官方連結＋provider adapter 實作 | 已採用 | `core/providers/`、L2 tools |

範本：

```markdown
# ADR-NNNN：標題

狀態：提議／已採用／被 ADR-NNNN 取代（日期）

## 背景
## 決策
## 不採用（選填）
## 影響
```
