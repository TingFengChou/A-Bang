// 安全情境（S18，2026-11-21）：提到自傷、或正在發生的緊急狀況時，先給求助管道，不查交通、不交給模型自由發揮。
// 只認明確的說法（「笑死」「跳樓大拍賣」「國道有車禍嗎」不算）；誤判的代價小（多給一次電話），漏判的代價大。
// 電話：安心專線 1925（衛福部，24 小時免費）、生命線 1995、張老師 1980、119（救護、消防）、110（警察）。

const SELF_HARM = [
  /想死|不想活|活不下去|活著沒意思|不如死了|想自殺|要自殺|自殺|輕生|結束(?:自己的)?生命|割腕|想跳樓|想跳下去|吞藥自|傷害自己/,
  /\b(?:kill(?:ing)? myself|suicid(?:e|al)|end(?:ing)? my life|want to die|hurt(?:ing)? myself|self[- ]harm)\b/i,
];
const NOT_SELF_HARM = /笑死|累死|熱死|冷死|餓死|忙死|嚇死|氣死|跳樓大拍賣|快死了.{0,4}(?:手機|電池|電腦)|死忠/;
// 正在發生的緊急狀況（第一人稱或眼前）：問路況的「國道有車禍嗎」不算
const EMERGENCY = [
  /(?:我|我們|朋友|家人|有人|這裡|這邊|前面).{0,6}(?:出車禍|發生車禍|被車撞|被撞|昏倒|暈倒|倒地|不省人事|沒有呼吸|沒呼吸|大量出血|流很多血|受重傷|被搶|被打|被跟蹤|失火|著火|火災)/,
  /(?:救命|快叫救護車|叫救護車|需要救護車|報警|幫我報警)/,
  /\b(?:help me|call (?:an )?ambulance|need (?:an )?ambulance|call the police|someone (?:collapsed|fainted|is (?:hurt|bleeding|unconscious))|(?:i|we) (?:had|were in) an accident|there(?:'s| is) a fire|i(?:'m| am) being (?:followed|attacked))\b/i,
];

/**
 * @param {string} text 使用者這一句
 * @returns {{ kind: 'selfHarm'|'emergency', reply: string }|null}
 */
export function safetyCheck(text) {
  const s = String(text || '');
  const en = /[A-Za-z]{3,}/.test(s) && !/[一-鿿]/.test(s);
  if (SELF_HARM.some((re) => re.test(s)) && !NOT_SELF_HARM.test(s)) {
    return {
      kind: 'selfHarm',
      reply: en
        ? "I'm really sorry you're feeling this way. You don't have to go through it alone. In Taiwan you can call the 1925 Mental Health Hotline (24 hours, free) or Lifeline at 1995. If you are in immediate danger, call 119 now. If it helps, I can find you a quiet place nearby or the way to someone you trust."
        : '聽起來你現在很辛苦，謝謝你願意說出來。你不用一個人撐：可以撥安心專線 1925（24 小時、免費），或生命線 1995、張老師 1980。如果有立即的危險，請馬上撥 119。需要的話，我也可以幫你找附近可以待的地方，或查怎麼去找信任的人。',
    };
  }
  if (EMERGENCY.some((re) => re.test(s))) {
    return {
      kind: 'emergency',
      reply: en
        ? 'If anyone is hurt or in danger, call 119 now (ambulance and fire) or 110 (police). Calls are free; if your phone has no SIM card or signal, dial 112. Stay somewhere safe. When things are under control, I can help you find the nearest hospital or how to get there.'
        : '如果有人受傷或有危險，請先撥 119（救護、消防）或 110（警察），免費；手機沒有 SIM 卡或收不到訊號時可撥 112。先待在安全的地方。狀況穩定後，我可以幫你找最近的醫院或怎麼過去。',
    };
  }
  return null;
}
