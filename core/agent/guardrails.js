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

/** 投資建議與漲跌預測（finance）：買賣建議、看漲看跌、目標價、明牌；否定句（「不建議買進」）也一併換成固定說法。
 *  不比對單獨的「買／賣」「看多」：交通回答常有「建議買來回票」「幫你看多少錢」 */
const ADVICE = /(建議|推薦)(你|您)?(可以)?(買進|買入|賣出|加碼|減碼|出場|進場|逢低|停損|停利|布局|佈局)|(可以|適合|值得)(買進|買入|進場|布局|佈局|入手|投資|加碼)|(股價|指數|大盤|台股|臺股|它|這檔)[^。！？\n]{0,8}(會|將|可望|有望|應該會)(繼續)?(上漲|下跌|漲|跌|反彈|回檔)|看(漲|跌)(?!倒)|看好(這檔|後市|台股|臺股|大盤|它)|目標價|明牌/;
export const NO_ADVICE_NOTE = '阿幫不提供投資建議或漲跌預測，只能報開放資料的收盤數字。';

/** 以句為單位：含指定說法的句子整句換成固定說法（連續重複只留一句） */
const replaceSentences = (re, note) => (text) => {
  const out = [];
  for (const p of String(text).split(/(?<=[。！？!?\n])/)) {
    const next = re.test(p) ? note + (p.endsWith('\n') ? '\n' : '') : p;
    if (next.trim() === note && out.some((x) => x.trim() === note)) continue;
    out.push(next);
  }
  return out.join('');
};

const OUTPUT_GUARDS = {
  finance: [{ rule: 'no-investment-advice', apply: replaceSentences(ADVICE, NO_ADVICE_NOTE) }],
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
