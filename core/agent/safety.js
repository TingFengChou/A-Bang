// 安全情境（S18，2026-11-21）：提到自傷、或正在發生的緊急狀況時，先給求助管道，不查交通、不交給模型自由發揮。
// 只認明確的說法；口語（「笑死」「累死」「氣死」）先拿掉再判斷，同一句裡真的說了「想死」還是會認出來。
// 誤判的代價小（多給一次電話），漏判的代價大。上架前電話與用語請心理衛生、緊急應變專業人員確認。
// 電話：安心專線 1925（衛福部，24 小時免費）、生命線 1995、張老師 1980、119（救護、消防）、110（警察）、113（保護專線）。

const SELF_HARM = [
  /想死|不想活|不想再活|活不下去|活著沒意思|不如死了|死了算了|一了百了|(?:我要|我想)去死|想自殺|要自殺|自殺|輕生|結束(?:自己的)?生命|割腕|想跳樓|想跳下去|(?:想|要)從.{0,6}跳下|想撞車|吞藥自|傷害自己/,
  /\b(?:kill(?:ing)? myself|kms|suicid(?:e|al)|end(?:ing)? my life|end it all|want to die|don'?t want to (?:live|be alive)|hurt(?:ing)? myself|self[- ]harm)\b/i,
];
/** 口語：先拿掉再判斷（不讓整句被放過） */
const CASUAL = /笑死|累死|熱死|冷死|餓死|忙死|嚇死|氣死|煩死|跳樓大拍賣|快死了.{0,4}(?:手機|電池|電腦)|手機.{0,4}快死了|死忠|死線/g;
// 正在發生的緊急狀況（第一人稱或眼前）：問路況的「國道有車禍嗎」不算
const EMERGENCY = [
  /(?:我|我們|朋友|家人|有人|這裡|這邊|前面).{0,6}(?:出車禍|發生車禍|被車撞|被撞|昏倒|暈倒|倒地|倒在地上|不省人事|沒有呼吸|沒呼吸|大量出血|流很多血|受重傷|受傷了|被搶|被打|被跟蹤|失火|著火|火災)/,
  /(?:快叫救護車|叫救護車|需要救護車|幫我報警|快報警)/,
  /^\s*(?:救命|救救我)[啊呀！!。.\s]*$/, // 「救命」單獨說（「救命 307 怎麼還不來」是抱怨，不算）
  /^\s*help(?: me)?(?: please)?[\s!.]*$/i, // 只有「help」（「help me get to Taipei 101」是問路）
  /\b(?:call (?:an )?ambulance|need (?:an )?ambulance|call the police|someone (?:collapsed|fainted|is (?:hurt|bleeding|unconscious))|(?:i|we) (?:had|were in) an accident|there(?:'s| is) a fire|i(?:'m| am) being (?:followed|attacked)|help me,? (?:please|i'?m hurt))\b/i,
];

/** 這次回應要給的電話（畫面做成一鍵撥號；資料決定，畫面不寫死） */
const CALLS = {
  selfHarm: [{ label: '撥 1925 安心專線', labelEn: 'Call 1925', tel: '1925' }, { label: '撥 1995 生命線', labelEn: 'Call 1995 Lifeline', tel: '1995' }, { label: '撥 119', labelEn: 'Call 119', tel: '119' }],
  emergency: [{ label: '撥 119 救護消防', labelEn: 'Call 119 ambulance/fire', tel: '119' }, { label: '撥 110 警察', labelEn: 'Call 110 police', tel: '110' }],
};

/**
 * @param {string} text 使用者這一句
 * @returns {{ kind: 'selfHarm'|'emergency', reply: string, calls: Array<{ label: string, tel: string }> }|null}
 */
export function safetyCheck(text) {
  const raw = String(text || '');
  const s = raw.replace(CASUAL, ' ');
  const en = /[A-Za-z]{2,}/.test(raw) && !/[一-鿿]/.test(raw);
  const calls = (k) => CALLS[k].map((c) => ({ label: en ? c.labelEn : c.label, tel: c.tel }));
  if (SELF_HARM.some((re) => re.test(s))) {
    return {
      kind: 'selfHarm',
      calls: calls('selfHarm'),
      reply: en
        ? "I'm really sorry you're feeling this way. You don't have to go through it alone. In Taiwan you can call the 1925 Suicide Prevention Hotline (24 hours, free) or Lifeline at 1995. If you are in immediate danger, call 119 now. If you'd like, tell me where someone you trust is and I'll find the way there."
        : '聽起來你現在很辛苦，謝謝你願意說出來。你不用一個人撐：可以撥安心專線 1925（24 小時、免費），或生命線 1995、張老師 1980。如果有立即的危險，請馬上撥 119。如果你願意，可以繼續跟我說；也可以告訴我信任的人在哪，我幫你查怎麼過去。',
    };
  }
  if (EMERGENCY.some((re) => re.test(s))) {
    const protect = /被打|被跟蹤|being (?:followed|attacked)/i.test(s);
    return {
      kind: 'emergency',
      calls: [...calls('emergency'), ...(protect ? [{ label: en ? 'Call 113 protection' : '撥 113 保護專線', tel: '113' }] : [])],
      reply: en
        ? `If anyone is hurt or in danger, call 119 now (ambulance and fire) or 110 (police). Calls are free; if you have no SIM card or your carrier has no coverage, dial 112. Stay somewhere safe.${protect ? ' For violence or being followed, the 113 protection hotline can also help.' : ''} When things are under control, tell me where you need to go and I'll find the way.`
        : `如果有人受傷或有危險，請先撥 119（救護、消防）或 110（警察），免費；手機沒有 SIM 卡、或自己的電信收不到訊號時，可撥 112。先待在安全的地方。${protect ? '遇到暴力或被跟蹤，也可以撥 113 保護專線。' : ''}狀況穩定後，告訴我要去哪裡，我幫你查怎麼過去。`,
    };
  }
  return null;
}
