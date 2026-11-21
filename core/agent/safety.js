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

// 急症徵兆（胸痛、喘不過氣、中風、抽搐、嚴重過敏）：先叫 119（P4-10）；「胸口悶悶的」這類不確定的也寧可多給一次
const MEDICAL = [
  /胸(?:口|部)?(?:好|很|超|非常|突然)?(?:痛|悶痛|絞痛)|胸(?:口|部)?.{0,3}悶|心悸|心臟病發|流血不止|大量出血|流好多血|快昏倒|快不行了|一直抽筋|喘不過氣|呼吸困難|不能呼吸|沒辦法呼吸|吸不到氣|(?<![去到往])中風(?!路|站|復健|預防|後遺症|中心|險)|嘴歪|半邊.{0,4}(?:麻|無力|不能動)|說話.{0,2}不清楚|講話.{0,2}不清楚|抽搐|休克|意識不清|叫不醒|過敏.{0,6}(?:喘|腫|呼吸)|吐血|心臟.{0,4}(?:好痛|很痛|停)/,
  /\b(?:chest pain|can'?t breathe|cannot breathe|trouble breathing|short(?:ness)? of breath|having a stroke|seizure|unconscious|anaphyla)/i,
];
// 問用藥、病情（「頭很痛要吃什麼藥」）：阿幫不做醫療判斷，請問醫師、藥師（P4-9）；找藥局、去醫院照常幫忙
const HEALTH = /(?:要|該|可以|能)吃(?:什麼|哪種|哪一種|啥)藥|吃.{0,6}藥.{0,4}(?:有用|好嗎|可以嗎|會好)|(?:發燒|頭痛|頭很痛|頭好痛|肚子痛|拉肚子|咳嗽|喉嚨痛|感冒|過敏|腰痛|牙痛).{0,6}(?:怎麼辦|吃什麼|要吃|怎麼處理|會不會怎樣)|是不是(?:生病|得了|感染)|要不要看醫生|(?:看|掛)哪一?科|\b(?:what (?:medicine|medication|pill)s? should i take|should i take (?:medicine|aspirin|ibuprofen))/i;
// 個資（打了身分證字號、卡號、密碼）：不需要、不記，提醒不要輸入（P4-10）；只說「身分證被冒用」照常（防詐）
const PRIVATE = /(?<![A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)|(?:卡號|信用卡).{0,4}(?:是|：|:)?\s*\d{4}(?:[-\s]?\d{4}){3}|(?:我的)?密碼(?:是|：|:)\s*(?!什麼|啥|多少|幾)\S/; // 真的打了號碼（貼上的詐騙簡訊常有「驗證碼：123456」，不算）

/** 這次回應要給的電話（畫面做成一鍵撥號；資料決定，畫面不寫死） */
const CALLS = {
  selfHarm: [{ label: '撥 1925 安心專線', labelEn: 'Call 1925', tel: '1925' }, { label: '撥 1995 生命線', labelEn: 'Call 1995 Lifeline', tel: '1995' }, { label: '撥 119', labelEn: 'Call 119', tel: '119' }],
  medical: [{ label: '撥 119 叫救護車', labelEn: 'Call 119 ambulance', tel: '119' }],
  emergency: [{ label: '撥 119 救護消防', labelEn: 'Call 119 ambulance/fire', tel: '119' }, { label: '撥 110 警察', labelEn: 'Call 110 police', tel: '110' }],
};

/**
 * @param {string} text 使用者這一句
 * @param {{ profileId?: string }} [opt] 防詐 agent 不擋個資（使用者會貼上詐騙簡訊）
 * @returns {{ kind: 'selfHarm'|'emergency'|'medical'|'privacy'|'health', reply: string, calls: Array<{ label: string, tel: string }> }|null}
 */
export function safetyCheck(text, { profileId } = {}) {
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
  if (MEDICAL.some((re) => re.test(s))) {
    return {
      kind: 'medical',
      calls: calls('medical'),
      reply: en
        ? 'This could be an emergency. Call 119 for an ambulance now (free). Stop what you are doing, sit or lie down somewhere safe, and tell someone nearby. Don\'t drive yourself.'
        : '這可能是緊急狀況，請馬上撥 119 叫救護車（免費）。先停下來，找安全的地方坐下或躺下，請身邊的人幫忙；不要自己開車或騎車去醫院。',
    };
  }
  if (profileId !== 'antifraud' && PRIVATE.test(raw)) { // 防詐：使用者貼上的簡訊、對方要的資料本來就會有號碼，照常判斷詐騙
    return {
      kind: 'privacy',
      calls: [],
      reply: en
        ? "Please don't type ID numbers, card numbers or passwords here. Abang doesn't need personal data and won't keep it. I can help with transit and daily info instead."
        : '請不要在這裡輸入身分證字號、卡號、密碼這類個資。阿幫查交通和生活資訊不需要個資，也不會幫你記下來（手機上留的對話也會把號碼遮起來）。有需要查什麼再跟我說。',
    };
  }
  if (HEALTH.test(s) && !/公車|捷運|怎麼去|怎麼走|怎麼坐|幾號|搭|附近|藥局|診所/.test(s)) { // 「台大醫院掛哪科要搭幾號公車」「附近有診所嗎」照常查
    return {
      kind: 'health',
      calls: [],
      reply: en
        ? "I can't judge symptoms or recommend medicine. Please ask a doctor or pharmacist (pharmacists can advise for free). If it's severe or getting worse fast, call 119. I can find a nearby pharmacy or the way to a hospital."
        : '阿幫不能判斷病情或建議吃什麼藥，請問醫師或藥師（藥局的藥師可以免費諮詢）；症狀很嚴重或突然變嚴重，請撥 119。我可以幫你找附近的藥局，或查怎麼去醫院。',
    };
  }
  return null;
}
