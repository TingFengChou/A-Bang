// 輸出護欄（M7-05，AGENT_ANTIFRAUD.md §7、PLATFORM.md L2）：模型或示範總結送出前的最後一道檢查。
// 規則本體在 core/output-guards.js（純函式，手機寫的回答也用同一份，ADR-0017）；這裡維持原本的匯入路徑。
export { applyOutputGuardrails, NO_ADVICE_NOTE, OUTPUT_GUARDS } from '../output-guards.js';
