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
  'where.system': '這支手機不能在手機上辨識，這次由系統的語音服務轉文字（可能經過網路）',
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
  'where.system': "This phone can't recognize speech on the device, so the system speech service is used this time (it may go online)",
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

/**
 * 在聽的面板上的字（純函式）：title 大字、text 聽到的（還沒有就是提示）、hint 怎麼結束、where 在哪裡轉文字、announce 要讓讀屏念的（部分結果不念）
 * @param {{ phase: string, text: string, onDevice: boolean|null, hold: boolean, error: string|null }} s voice.js 的狀態
 * @param {'en'|null} lang
 */
export function voiceText(s, lang = null) {
  const t = voiceT(lang);
  const where = s.onDevice === true ? t('where.device') : s.onDevice === false ? t('where.system') : '';
  switch (s.phase) {
    case 'starting': return { title: t('starting'), text: '', hint: '', where: '', announce: null };
    case 'listening': return { title: t('listening'), text: s.text || t('placeholder'), heard: !!s.text, hint: t(s.hold ? 'hint.hold' : 'hint.auto'), where, announce: t('announce.start') };
    case 'finishing': return { title: t('finishing'), text: s.text, heard: !!s.text, hint: '', where, announce: null };
    case 'error': return { title: t(`err.${s.error}`), text: '', hint: '', where: '', announce: t(`err.${s.error}`) };
    default: return { title: '', text: '', hint: '', where: '', announce: null };
  }
}
