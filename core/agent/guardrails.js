// 輸出護欄（M7-05，AGENT_ANTIFRAUD.md §7、PLATFORM.md L2）：模型或示範總結送出前的最後一道檢查。
// 依 profile 的工具包套用；有改寫時回傳命中的規則，由呼叫端送 guardrail 事件。
import { CALL_165 } from '../scam-check.js';

/** 保證安全的說法（肯定句；「不代表一定安全」「安全嗎」「安全性」不算） */
const CLAIM = /(?<!不代表(一定)?|不一定|不保證|並非|不是|無法保證)(是|很|蠻|算|應該|絕對|百分之百|完全)?安全(?![嗎性帽])|可以放心|不是詐騙|(沒有|沒)(任何)?問題/;
const SAFE_NOTE = '沒有發現已知的詐騙特徵，但不代表一定安全。';

/** 以句為單位：含保證說法的句子整句換成固定說法（連續重複只留一句） */
function noSafetyClaim(text) {
  const parts = String(text).split(/(?<=[。！？!?\n])/);
  const out = [];
  for (const p of parts) {
    const next = CLAIM.test(p) ? SAFE_NOTE + (p.endsWith('\n') ? '\n' : '') : p;
    if (next.trim() === SAFE_NOTE && out.at(-1)?.trim() === SAFE_NOTE) continue;
    out.push(next);
  }
  return out.join('');
}

const OUTPUT_GUARDS = {
  antifraud: [
    { rule: 'no-safety-claim', apply: noSafetyClaim },
    { rule: 'call-165', apply: (t) => (/165/.test(t) ? t : `${t.trim()}\n${CALL_165}`), silent: true },
  ],
};

/**
 * @param {{ packs: string[] }} profile
 * @param {string} text
 * @returns {{ text: string, hits: Array<{ tier: string, rule: string }> }} silent 規則（固定附 165）不算命中
 */
export function applyOutputGuardrails(profile, text) {
  let out = String(text ?? '');
  const hits = [];
  for (const pack of profile.packs) {
    for (const g of OUTPUT_GUARDS[pack] || []) {
      const next = g.apply(out);
      if (next !== out && !g.silent) hits.push({ tier: 'L2', rule: g.rule });
      out = next;
    }
  }
  return { text: out, hits };
}
