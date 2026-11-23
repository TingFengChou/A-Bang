// 輸出護欄（M7-05，AGENT_ANTIFRAUD.md §7、PLATFORM.md L2）的規則本體：純函式、無相依。
// 伺服器經 core/agent/guardrails.js 使用；手機寫的回答（ADR-0017）由 core/edge-write.js 直接重用同一份規則（前端以 /core/output-guards.js 取得）。
// 依 profile 的工具包套用；有改寫時回傳命中的規則，由呼叫端送 guardrail 事件。

/** 防詐固定句（core/scam-check.js 重新匯出） */
export const CALL_165 = '有疑問請撥打 165 反詐騙諮詢專線（免付費）查證。';

/** 保證安全的說法（肯定句；「不代表一定安全」「安全嗎」「安全性」不算） */
const CLAIM = new RegExp([
  /(?<!不代表(一定)?|不一定|不保證|並非|不是|無法保證)(是|很|蠻|算|應該|絕對|百分之百|完全)?安全(?![嗎性帽])|可以放心|不是詐騙|(沒有|沒)(任何)?問題/.source,
  // 叫人放心去點、去付（「可以安心點開」）；「打 165 查證比較安心」不算
  /可以安心|(安心|放心)地?(點|開|使用|付款|匯款|轉帳|填|輸入|下載|登入|購買|回覆)/.source,
  // 叫人直接點、直接付（「可以直接點連結付款」）；「不要直接付款」「別直接匯款」是正確的提醒
  /(?<!不要|不要再|別|勿|不可以|不可|不能|不該|不應該|不應|不建議)(可以|可|就|請|放心)?直接(點|付款|匯款|轉帳)/.source,
  /不會有(什麼|任何)?(問題|事|風險)|(?<!不是|並非|有)沒有?(什麼|任何)?風險/.source,
  // 英文：「This link is safe」「It's legit」「safe to click」；「doesn't mean it's safe」「not sure it's safe」不算
  /(?<!(mean|means|guarantee|guarantees|prove|proves|assume|confirm|sure|say|know|whether|if|check)( that)? )\b(is|it's|it is|looks|seems|appears)( to be)? (completely |totally |perfectly |100% )?(safe|legit|legitimate|trustworthy|genuine)\b|\bsafe to (click|open|pay|use|visit)\b|\bnot a scam\b|\bnothing to worry about\b/i.source,
].join('|'), 'i');
const SAFE_NOTE = '沒有發現已知的詐騙特徵，但不代表一定安全。';
const SAFE_NOTE_EN = "No known scam signs were found, but that doesn't mean it's safe.";
const CJK = /[\u3400-\u9fff]/;

/** 以句為單位：含保證說法的句子整句換成固定說法（英文句子用英文；連續重複只留一句） */
function noSafetyClaim(text) {
  const parts = String(text).split(/(?<=[。！？!?\n]|[.](?=\s|$))/);
  const out = [];
  for (const p of parts) {
    const note = CJK.test(p) ? SAFE_NOTE : SAFE_NOTE_EN;
    const lead = p.match(/^\s*/)[0];
    const next = CLAIM.test(p) ? lead + note + (p.endsWith('\n') ? '\n' : '') : p;
    if (next.trim() === note && out.at(-1)?.trim() === note) continue;
    out.push(next);
  }
  return out.join('');
}

/** 投資建議與漲跌預測（finance）：買賣建議、看漲看跌、目標價、明牌；否定句（「不建議買進」）也一併換成固定說法。
 *  不比對單獨的「買／賣」「看多」：交通回答常有「建議買來回票」「幫你看多少錢」 */
const ADVICE = new RegExp([
  /(建議|推薦)(你|您)?(可以)?(買進|買入|賣出|加碼|減碼|出場|進場|逢低|停損|停利|布局|佈局)|(可以|適合|值得)(買進|買入|進場|布局|佈局|入手|投資|加碼)|(股價|指數|大盤|台股|臺股|它|這檔)[^。！？\n]{0,8}(會|將|可望|有望|應該會)(繼續)?(上漲|下跌|漲|跌|反彈|回檔)|看(漲|跌)(?!倒)|看好(這檔|後市|台股|臺股|大盤|它)|目標價|明牌/.source,
  // 主詞是公司名也算（「台積電明天會漲」「台積電應該會反彈」）：說了未來的時間、或用漲跌專用的詞
  /(明天|明日|下週|下周|下禮拜|下個月|短線|短期|接下來|未來|近期|後市|年底)[^。！？\n]{0,6}(會|將|可望|有望|應該|可能|恐)[^。！？\n]{0,3}(上漲|下跌|大漲|大跌|反彈|回檔|走高|走低|漲|跌)/.source,
  /(會|將|可望|有望|應該會?|可能會|恐將?|勢必)(繼續|再|持續)?(上漲|下跌|大漲|大跌|反彈|回檔|走高|走低|漲停|跌停)/.source,
  // 進出場時機（「現在是進場的好時機」）
  /(進場|出場|買進|買入|賣出|加碼|減碼|入手|抄底)[^。！？\n]{0,6}時機|時機[^。！？\n]{0,4}(進場|出場|買進|買入|賣出|加碼|抄底)|抄底|逢低(買|承接|布局|佈局)/.source,
].join('|'));
/** 被換掉的問句後面緊接的短回答（「這檔會漲嗎？不會，會跌」的「不會，會跌」）也一起拿掉 */
const ADVICE_ANSWER = /^\s*(不會|會|是|對|沒錯|應該|可能|不一定|有可能)[，,、\s][^。！？\n]{0,10}(漲|跌|反彈|回檔)/;
export const NO_ADVICE_NOTE = '阿幫不提供投資建議或漲跌預測，只能報開放資料的收盤數字。';

/** 以句為單位：含指定說法的句子整句換成固定說法（連續重複只留一句） */
const replaceSentences = (re, note, answer = null) => (text) => {
  const out = [];
  let prevHit = false;
  for (const p of String(text).split(/(?<=[。！？!?\n])/)) {
    const hit = re.test(p) || (prevHit && answer?.test(p));
    prevHit = hit;
    const next = hit ? note + (p.endsWith('\n') ? '\n' : '') : p;
    if (next.trim() === note && out.some((x) => x.trim() === note)) continue;
    out.push(next);
  }
  return out.join('');
};

export const OUTPUT_GUARDS = {
  finance: [{ rule: 'no-investment-advice', apply: replaceSentences(ADVICE, NO_ADVICE_NOTE, ADVICE_ANSWER) }],
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
