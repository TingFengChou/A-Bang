// 語音問阿幫的文字字典（voice.js、agent/voice-ui.js）：最近一輪是英文時用英文。
// 跟外殼、公車頁字典（shell-i18n.js、pages/bus-i18n.js）同一套做法：鍵相同、佔位符 {text}、英文缺鍵退回中文、缺鍵回傳鍵本身。

export const ZH = {
  'mic': '用說的問阿幫',
  'micStop': '說完了，送出',
  'starting': '準備聽…',
  'listening': '在聽…',
  'finishing': '聽好了…',
  'hint.auto': '說完停一下就會送出',
  'hint.hold': '放開就送出',
  'placeholder': '請說，例如：去台北 101 怎麼走',
  'where.device': '在手機上轉成文字，語音不離開手機',
  'mic.download': '用說的問阿幫（第一次要先下載{lang}語音包）',
  'mic.preparing': '準備中：正在下載{lang}語音包',
  'mic.unsupported': '用說的問阿幫（這支手機不能用，按了看原因）',
  'lang.zh': '中文',
  'lang.en': '英文',
  'pack.zh': '中文（台灣）',
  'pack.en': '英文（美國）',
  'why.title': '這支手機現在不能用說的問阿幫',
  'why.os': '這支手機不支援在手機上辨識語音（需要 Android 12 以上，並安裝{lang}語音包）。可以直接打字。',
  'why.no-ondevice': '這支手機沒有「在手機上辨識語音」的功能（需要 Android 12 以上，並有 Google 的語音服務）。可以直接打字。',
  'why.language': '這支手機在手機上辨識語音還不支援{lang}。可以直接打字。',
  'why.ios-no-ondevice': '這支 iPhone 現在不能在手機上辨識{lang}語音。到「設定 → 一般 → 鍵盤」打開「啟用聽寫」，並在「聽寫語言」加入{pack}；iPhone 會在背景下載語音資料，好了再回來按麥克風。較舊的 iPhone 可能不支援。',
  'why.privacy': '阿幫只在手機上把語音轉成文字，不錄音、不上傳，所以不改用網路上的語音辨識。',
  'dl.start': '正在下載{lang}語音包…',
  'dl.progress': '正在下載{lang}語音包…{pct}%',
  'dl.note': '下載好之後，語音只在手機上轉成文字。可以先收起來打字，好了麥克風就能用。',
  'dl.scheduled': '{lang}語音包排定在連上 Wi-Fi 時下載。好了之後麥克風就能用；也可以到手機設定立刻下載。',
  'dl.done': '{lang}語音包好了，可以用說的了。',
  'dl.fail': '{lang}語音包沒有下載成功。到手機設定搜尋「離線語音辨識」或「語音」，下載{pack}後再試；或稍後再按一次麥克風。',
  'dl.slow': '還在下載{lang}語音包，可以先打字；好了麥克風就能用。',
  'startNow': '開始說',
  'hide': '先打字',
  'openVoiceSettings': '到手機設定下載',
  'cancel': '取消',
  'done': '說完了',
  'ok': '知道了',
  'retry': '再說一次',
  'openSettings': '到設定開啟',
  'openFailed': '打不開設定，請自己到手機的設定開啟。',
  'announce.start': '開始聽了，請說。',
  'announce.sent': '送出：{text}',
  'announce.cancel': '取消了，沒有送出。',
  'err.permission': '麥克風權限沒有打開。可以直接打字，或到設定允許麥克風。',
  'err.speech-permission': '語音辨識權限沒有打開。可以直接打字，或到設定允許語音辨識。',
  'err.no-service': '這支手機沒有可以用的語音辨識。請直接打字。',
  'err.no-speech': '沒有聽到聲音。再說一次，或直接打字。',
  'err.no-match': '沒聽清楚。再說一次，或直接打字。',
  'err.network': '語音辨識連不上。請直接打字，或稍後再試。',
  'err.audio': '麥克風收不到聲音（可能有其他 App 正在用）。請直接打字。',
  'err.busy': '語音辨識正在忙，稍後再試一次。',
  'err.language': '這支手機的語音辨識還不支援這個語言。請直接打字。',
  'err.language-missing': '這支手機還沒有這個語言的手機上語音包。到手機設定搜尋「離線語音辨識」或「語音」下載後再試，或直接打字。',
  'err.service': '語音辨識出了問題。請直接打字，或稍後再試。',
  'err.client': '語音辨識被中斷了。再說一次，或直接打字。',
};

export const EN = {
  'mic': 'Ask Abang by voice',
  'micStop': 'Done, send it',
  'starting': 'Getting ready…',
  'listening': 'Listening…',
  'finishing': 'Got it…',
  'hint.auto': 'Pause when you are done and it sends',
  'hint.hold': 'Let go to send',
  'placeholder': 'Say something like: how do I get to Taipei 101',
  'where.device': 'Turned into text on your phone; your voice never leaves it',
  'mic.download': 'Ask Abang by voice (downloads the {lang} speech pack first)',
  'mic.preparing': 'Getting ready: downloading the {lang} speech pack',
  'mic.unsupported': "Ask Abang by voice (not available on this phone; tap to see why)",
  'lang.zh': 'Chinese',
  'lang.en': 'English',
  'pack.zh': 'Chinese (Taiwan)',
  'pack.en': 'English (US)',
  'why.title': "Voice input isn't available on this phone",
  'why.os': "This phone can't recognize speech on the device (needs Android 12 or later with the {lang} speech pack). Please type instead.",
  'why.no-ondevice': "This phone has no on-device speech recognition (needs Android 12 or later with Google's speech services). Please type instead.",
  'why.language': "On-device speech recognition on this phone doesn't support {lang} yet. Please type instead.",
  'why.ios-no-ondevice': "This iPhone can't recognize {lang} speech on the device right now. Go to Settings → General → Keyboard, turn on Enable Dictation and add {pack} under Dictation Languages; the iPhone downloads the speech data in the background, then come back and tap the mic. Older iPhones may not support it.",
  'why.privacy': "Abang only turns speech into text on your phone, with no recording and no upload, so it doesn't switch to online speech recognition.",
  'dl.start': 'Downloading the {lang} speech pack…',
  'dl.progress': 'Downloading the {lang} speech pack… {pct}%',
  'dl.note': "Once it's downloaded, speech is turned into text on your phone only. You can type in the meantime; the mic works when it's ready.",
  'dl.scheduled': "The {lang} speech pack will download on Wi-Fi. The mic works once it's ready, or download it now in your phone's settings.",
  'dl.done': 'The {lang} speech pack is ready. You can ask by voice now.',
  'dl.fail': "The {lang} speech pack didn't download. Search your phone's settings for \"offline speech recognition\" or \"speech\", download {pack}, then try again; or tap the mic again later.",
  'dl.slow': "Still downloading the {lang} speech pack. Type for now; the mic works when it's ready.",
  'startNow': 'Start talking',
  'hide': 'Type instead',
  'openVoiceSettings': 'Open phone settings',
  'cancel': 'Cancel',
  'done': 'Done',
  'ok': 'OK',
  'retry': 'Try again',
  'openSettings': 'Open Settings',
  'openFailed': "Couldn't open Settings. Please open it yourself.",
  'announce.start': 'Listening. Go ahead.',
  'announce.sent': 'Sent: {text}',
  'announce.cancel': 'Cancelled. Nothing was sent.',
  'err.permission': 'Microphone permission is off. Type instead, or allow the microphone in Settings.',
  'err.speech-permission': 'Speech recognition permission is off. Type instead, or allow it in Settings.',
  'err.no-service': 'No speech recognition is available on this phone. Please type instead.',
  'err.no-speech': "I didn't hear anything. Try again, or type instead.",
  'err.no-match': "I didn't catch that. Try again, or type instead.",
  'err.network': "Speech recognition can't connect. Type instead, or try later.",
  'err.audio': "The microphone isn't picking up sound (another app may be using it). Please type instead.",
  'err.busy': 'Speech recognition is busy. Try again in a moment.',
  'err.language': "This phone's speech recognition doesn't support this language yet. Please type instead.",
  'err.language-missing': "This phone doesn't have the on-device speech pack for this language yet. Search your phone's settings for \"offline speech recognition\" to download it, or type instead.",
  'err.service': 'Something went wrong with speech recognition. Type instead, or try later.',
  'err.client': 'Speech recognition was interrupted. Try again, or type instead.',
};

/**
 * @param {'en'|null} lang
 * @returns {(key: string, vars?: Record<string, any>) => string}
 */
export function voiceT(lang) {
  const dict = lang === 'en' ? EN : ZH;
  return (key, vars = {}) => {
    const msg = dict[key] ?? ZH[key];
    if (msg == null) return key;
    return msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  };
}

/** 有沒有「到設定開啟」：權限被拒的錯誤 */
export const needsSettings = (code) => code === 'permission' || code === 'speech-permission';
/** 語言的名稱（zh-TW → 中文） */
export const langName = (voiceLangTag, lang = null) => voiceT(lang)(String(voiceLangTag || '').startsWith('en') ? 'lang.en' : 'lang.zh');
const packName = (voiceLangTag, lang = null) => voiceT(lang)(String(voiceLangTag || '').startsWith('en') ? 'pack.en' : 'pack.zh');

/**
 * 麥克風不能用時、語言包下載時的說明（純函式）。
 * @param {{ state: string, reason?: string, lang?: string }} info voice.js normalizeVoiceInfo
 * @param {'en'|null} lang 畫面語言
 * @param {string} [voiceLangTag] 要辨識的語言（zh-TW／en-US）
 */
export function whyText(info, lang = null, voiceLangTag = 'zh-TW') {
  const t = voiceT(lang);
  const name = langName(voiceLangTag, lang);
  if (info?.state !== 'unsupported') return '';
  return t(`why.${info.reason}`, { lang: name, pack: packName(voiceLangTag, lang) });
}
/** 下載中的一句：{ status, percent } → 字 */
export function downloadText(u, lang = null, voiceLangTag = 'zh-TW') {
  const t = voiceT(lang);
  const name = langName(voiceLangTag, lang);
  if (!u) return '';
  if (u.status === 'progress') return t('dl.progress', { lang: name, pct: u.percent });
  return t(`dl.${u.status}`, { lang: name, pack: packName(voiceLangTag, lang) });
}

/**
 * 在聽的面板上的字（純函式）：title 大字、text 聽到的（還沒有就是提示）、hint 怎麼結束、where 在哪裡轉文字、announce 要讓讀屏念的（部分結果不念）
 * @param {{ phase: string, text: string, onDevice: boolean|null, hold: boolean, error: string|null }} s voice.js 的狀態
 * @param {'en'|null} lang
 */
export function voiceText(s, lang = null) {
  const t = voiceT(lang);
  const where = s.onDevice === true ? t('where.device') : ''; // 只在手機上辨識（不退回雲端）
  switch (s.phase) {
    case 'starting': return { title: t('starting'), text: '', hint: '', where: '', announce: null };
    case 'listening': return { title: t('listening'), text: s.text || t('placeholder'), heard: !!s.text, hint: t(s.hold ? 'hint.hold' : 'hint.auto'), where, announce: t('announce.start') };
    case 'finishing': return { title: t('finishing'), text: s.text, heard: !!s.text, hint: '', where, announce: null };
    case 'error': return { title: t(`err.${s.error}`), text: '', hint: '', where: '', announce: t(`err.${s.error}`) };
    default: return { title: '', text: '', hint: '', where: '', announce: null };
  }
}
