// 語音問阿幫（M14-01，2026-11-21，產品負責人：「讓阿幫聽得懂」、手機上優先）：
// 把你說的話在手機上轉成文字，文字當作一般提問送出（語音只在手機上轉成文字，不錄音、不上傳）。
// 2026-11-21 產品負責人：「語言包要協助用戶裝，除非真的手機無法支援；不支援就反白，點擊後顯示原因」——不退回系統／雲端辨識。
// 這個檔與平台無關：狀態機（純函式，test/voice.test.js）＋控制器（計時：停頓 1.5 秒自動結束）＋語言包下載＋兩種辨識來源：
//   手機 App：專案內原生外掛 AbangVoice（Android 手機上的 SpeechRecognizer、iOS SFSpeechRecognizer requiresOnDeviceRecognition）
//   網頁版：只有瀏覽器支援「在本機辨識」（Web Speech API 的 processLocally）才用；不支援就不顯示麥克風，
//          不把語音送給瀏覽器廠商的伺服器。
// 畫面在 agent/voice-ui.js（問阿幫輸入列的麥克風鍵、在聽的面板）與 abang-dock.js（長按中央鍵）。
const PLUGIN = 'AbangVoice';
/** 停頓這麼久就當作說完了（毫秒） */
export const SILENCE_MS = 1500;
/** 開始後這麼久都沒聽到字：結束並說「沒聽到」 */
export const NO_SPEECH_MS = 8000;
/** 說完了之後等最後的文字最多這麼久 */
export const FINAL_WAIT_MS = 3000;
/** 一次最多聽這麼久（避免一直開著麥克風） */
export const MAX_MS = 30000;
/** 語言包下載中：每隔這麼久再問一次系統好了沒（Android 13 沒有下載進度回呼） */
export const DOWNLOAD_POLL_MS = 3000;
/** 下載最多等這麼久（之後背景繼續下載，下次打開或回到畫面再查） */
export const DOWNLOAD_MAX_MS = 180000;
export const VOICE_KEY = 'abang.voice';
/** 錯誤種類（外掛與網頁版共用；畫面文字在 voice-i18n.js 的 err.*） */
export const VOICE_ERRORS = ['permission', 'speech-permission', 'no-service', 'no-speech', 'no-match', 'network', 'audio', 'busy', 'language', 'language-missing', 'service', 'client'];
/** 辨識引擎（外掛回報；#/ai 顯示）：都是在手機上（或瀏覽器本機）辨識 */
export const VOICE_ENGINES = ['android-ondevice', 'ios-speech', 'web-ondevice'];
/**
 * 不能用的原因（外掛回報；畫面文字 voice-i18n.js 的 why.*）：
 * os Android 12 以下｜no-ondevice 沒有手機上的辨識器｜language 手機上的辨識不支援這個語言｜ios-no-ondevice iPhone 現在不能在手機上辨識這個語言
 * language-download 語言包可以下載（第一次按麥克風時下載）｜downloading 語言包下載中｜no-plugin 這個版本沒有｜web-unsupported、web-download 網頁版
 */
export const VOICE_REASONS = ['os', 'no-ondevice', 'language', 'ios-no-ondevice', 'language-download', 'downloading', 'no-plugin', 'web-unsupported', 'web-download'];

/** 使用者可在設定關掉（讀不到就當開著） */
export function voiceEnabled() {
  try { return globalThis.localStorage?.getItem(VOICE_KEY) !== 'off'; } catch { return true; }
}
export function setVoiceEnabled(on) {
  try { if (on) globalThis.localStorage.removeItem(VOICE_KEY); else globalThis.localStorage.setItem(VOICE_KEY, 'off'); } catch { return false; }
  globalThis.dispatchEvent?.(new CustomEvent('abang:voice-setting', { detail: { on: !!on } }));
  return true;
}

/** 最近一輪是英文就用英文辨識，其他用台灣中文 */
export const voiceLang = (turnLang) => (turnLang === 'en' ? 'en-US' : 'zh-TW');

// ───── 狀態機（純函式） ─────
/**
 * phase：idle 沒在聽｜starting 開麥克風中（第一次會問權限）｜listening 在聽｜finishing 說完了、等最後的文字｜sent 送出了｜error 出錯
 * hold：長按中央鍵（放開才結束，不看停頓）
 */
export const voiceIdle = () => ({ phase: 'idle', text: '', level: 0, onDevice: null, engine: null, error: null, hold: false, sent: null, heard: false });

const active = (p) => p === 'starting' || p === 'listening' || p === 'finishing';
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const cleanText = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

/**
 * 事件 → 下一個狀態。
 * 使用者：start { hold }、stop（說完了）、release（放開中央鍵）、cancel、reset
 * 辨識：ready { onDevice, engine }、partial { text }、level { level }、final { text }、error { code }
 * @param {ReturnType<typeof voiceIdle>} s
 * @param {{ type: string, [k: string]: any }} e
 */
export function voiceStep(s, e) {
  if (!e) return s;
  switch (e.type) {
    case 'start':
      if (active(s.phase)) return s;
      return { ...voiceIdle(), phase: 'starting', hold: !!e.hold };
    case 'ready':
      if (s.phase !== 'starting') return s;
      return { ...s, phase: 'listening', onDevice: typeof e.onDevice === 'boolean' ? e.onDevice : null, engine: VOICE_ENGINES.includes(e.engine) ? e.engine : null };
    case 'partial': {
      if (s.phase !== 'listening' && s.phase !== 'finishing') return s;
      const text = cleanText(e.text);
      return text ? { ...s, text, heard: true } : s;
    }
    case 'level':
      if (s.phase !== 'listening') return s;
      return { ...s, level: clamp01(Number(e.level)) };
    case 'stop':
      if (s.phase !== 'listening') return s;
      return { ...s, phase: 'finishing', level: 0 };
    case 'release': // 放開中央鍵：還在開麥克風（例如第一次跳權限框）就改成停頓自動結束；在聽就當說完了
      if (s.phase === 'starting') return { ...s, hold: false };
      if (s.phase === 'listening') return { ...s, phase: 'finishing', level: 0, hold: false };
      return s;
    case 'final': {
      if (!active(s.phase)) return s;
      const text = cleanText(e.text) || s.text; // 有些引擎最後一筆是空的：用最後聽到的
      return text ? { ...s, phase: 'sent', text, sent: text, level: 0, heard: true } : { ...s, phase: 'error', error: 'no-speech', level: 0 };
    }
    case 'error': {
      if (!active(s.phase)) return s;
      const code = VOICE_ERRORS.includes(e.code) ? e.code : 'service';
      // 已經聽到字了才出「沒聽清楚／沒聽到」：把聽到的送出（Android 停頓太久有時回 no-match）
      if (s.text && (code === 'no-match' || code === 'no-speech')) return { ...s, phase: 'sent', sent: s.text, level: 0 };
      return { ...s, phase: 'error', error: code, level: 0 };
    }
    case 'cancel':
      return voiceIdle();
    case 'reset':
      return active(s.phase) ? s : voiceIdle();
    default:
      return s;
  }
}

// ───── 辨識來源 ─────
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && c.isPluginAvailable?.(PLUGIN) && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};
const codeOf = (err) => {
  const c = err?.code;
  if (VOICE_ERRORS.includes(c)) return c;
  const m = String(err?.message || '');
  return VOICE_ERRORS.find((k) => m.startsWith(`${k}:`)) || 'service';
};

/** 手機 App：原生外掛 AbangVoice（事件 partial／level／final／error；語言包 download） */
function nativeBackend(c) {
  let subs = null;
  let handler = () => {};
  const listen = () => {
    if (subs) return;
    subs = ['partial', 'level', 'final', 'error'].map((ev) => c.addListener?.(PLUGIN, ev, (d) => handler({ ...(d || {}), type: ev })));
  };
  return {
    kind: 'native',
    available: (lang = 'zh-TW') => c.nativePromise(PLUGIN, 'available', { lang }),
    async start(lang, onEvent) {
      handler = onEvent;
      listen();
      return c.nativePromise(PLUGIN, 'start', { lang });
    },
    stop: () => c.nativePromise(PLUGIN, 'stop', {}).catch(() => {}),
    cancel: () => { handler = () => {}; return c.nativePromise(PLUGIN, 'cancel', {}).catch(() => {}); },
    /** 請系統下載這個語言的手機上語言包；進度以 download 事件回報（Android 14 以上，其他版本只能再問 available） */
    download(lang, onEvent) {
      const sub = c.addListener?.(PLUGIN, 'download', (d) => onEvent({ ...(d || {}) }));
      this.unsub = () => sub?.remove?.(); // downloadPack 結束時拿掉
      return c.nativePromise(PLUGIN, 'download', { lang });
    },
    /** 開手機的語音輸入設定（下載語言包；Android）；打不開回 false */
    openSettings: () => c.nativePromise(PLUGIN, 'openSettings', {}).then(() => true, () => false),
  };
}

const WEB_ERR = { 'not-allowed': 'permission', 'service-not-allowed': 'permission', 'no-speech': 'no-speech', 'audio-capture': 'audio', network: 'network', 'language-not-supported': 'language', aborted: null };
const SR = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
/**
 * 只在 Google Chrome 問「能不能在本機辨識」：Chromium 156（無頭、沒有內建的本機語音元件）呼叫 SpeechRecognition.available() 會讓整頁當掉（2026-11-21 E2E 實測），
 * 其他 Chromium 系瀏覽器與 App 的 WebView 也不確定有沒有，寧可不顯示麥克風。
 */
const realChrome = () => { try { return !!globalThis.navigator?.userAgentData?.brands?.some((b) => b.brand === 'Google Chrome'); } catch { return false; } };

/**
 * 網頁版：Web Speech API，只在「在本機辨識」可用時（processLocally）。
 * 舊的草案是 availableOnDevice()／mode = 'ondevice-only'，一起支援；兩個都沒有就不支援。
 */
async function webAvailable(lang) {
  const R = SR();
  if (!R || !realChrome()) return { available: false, reason: 'web-unsupported' };
  try {
    let st = null;
    if (typeof R.available === 'function') st = await R.available({ langs: [lang], processLocally: true });
    else if (typeof R.availableOnDevice === 'function') st = await R.availableOnDevice(lang);
    if (st == null) return { available: false, reason: 'web-unsupported' };
    const ok = st === 'available' || st === true;
    return ok ? { available: true, onDevice: true, engine: 'web-ondevice', lang } : { available: false, reason: st === 'downloadable' || st === 'downloading' ? 'web-download' : 'web-unsupported', lang };
  } catch { return { available: false, reason: 'web-unsupported' }; }
}
function webBackend() {
  let rec = null;
  let handler = () => {};
  return {
    kind: 'web',
    available: webAvailable,
    async start(lang, onEvent) {
      handler = onEvent;
      const R = SR();
      if (!R) throw Object.assign(new Error('no-service'), { code: 'no-service' });
      const r = new R();
      // 一定要在本機辨識：屬性不存在就不開始（不讓語音送到瀏覽器廠商的伺服器）
      if ('processLocally' in r) r.processLocally = true;
      else if ('mode' in r) r.mode = 'ondevice-only';
      else throw Object.assign(new Error('no-service'), { code: 'no-service' });
      r.lang = lang;
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let finalText = null;
      r.onresult = (ev) => {
        let text = '';
        let done = false;
        for (let i = 0; i < ev.results.length; i++) { text += ev.results[i][0]?.transcript || ''; if (ev.results[i].isFinal) done = true; }
        if (done) finalText = text; else handler({ type: 'partial', text });
      };
      r.onerror = (ev) => { const code = WEB_ERR[ev.error]; if (code) handler({ type: 'error', code }); else if (code === undefined) handler({ type: 'error', code: 'service' }); };
      r.onend = () => { if (rec === r) { rec = null; handler({ type: 'final', text: finalText || '' }); } };
      rec = r;
      r.start();
      return { onDevice: true, engine: 'web-ondevice', lang };
    },
    stop: async () => { try { rec?.stop(); } catch { /* 已結束 */ } },
    cancel: async () => { const r = rec; rec = null; handler = () => {}; try { r?.abort(); } catch { /* 已結束 */ } },
    download: async () => { throw Object.assign(new Error('no-service'), { code: 'no-service' }); }, // 網頁版不下載：不能本機辨識就不顯示
    openSettings: async () => false,
  };
}

/** 這個環境用哪個辨識來源（App 有外掛用外掛，否則網頁版） */
export function voiceBackend() {
  const c = cap();
  return c ? nativeBackend(c) : webBackend();
}

/**
 * 外掛（或瀏覽器）回報 → 畫面要的樣子；只留真的拿得到、認得的欄位（不編造）。
 * state：ready 可以說｜download 語言包可下載（按麥克風就下載）｜downloading 語言包下載中（麥克風「準備中」）
 *        unsupported 這支手機不能在手機上辨識（App：麥克風反白、點了說原因）｜none 不顯示（網頁版不能本機辨識、沒有外掛）
 * @returns {{ state: string, available: boolean, platform: 'native'|'web', reason?: string, onDevice?: boolean, engine?: string, lang?: string, permission?: string, osVersion?: string, progress?: number }}
 */
export function normalizeVoiceInfo(raw, platform = 'web') {
  const r = raw && typeof raw === 'object' ? raw : {};
  // 只在手機上（或瀏覽器本機）辨識才算能用：不退回系統或雲端辨識
  const available = r.available === true && r.onDevice === true;
  const out = { state: 'ready', available, platform };
  if (available) out.onDevice = true;
  if (VOICE_ENGINES.includes(r.engine)) out.engine = r.engine;
  if (typeof r.lang === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(r.lang)) out.lang = r.lang;
  if (['granted', 'denied', 'prompt', 'prompt-with-rationale'].includes(r.permission)) out.permission = r.permission;
  if (typeof r.osVersion === 'string' && /^[\w.]{1,20}$/.test(r.osVersion)) out.osVersion = r.osVersion;
  if (Number.isFinite(r.progress) && r.progress >= 0 && r.progress <= 100) out.progress = Math.round(r.progress);
  if (available) return out;
  const reason = VOICE_REASONS.includes(r.reason) ? r.reason : platform === 'web' ? 'web-unsupported' : 'no-ondevice';
  out.reason = reason;
  if (platform === 'web' || reason === 'no-plugin') out.state = 'none'; // 網頁版沒有語言包可裝：不顯示就好
  else if (reason === 'language-download') out.state = 'download';
  else if (reason === 'downloading') out.state = 'downloading';
  else out.state = 'unsupported';
  return out;
}

let last = null;
/** 現在能不能用語音（每次都重新問；#/ai、設定頁、下載中用） */
export async function voiceStatus(lang = 'zh-TW') {
  const b = voiceBackend();
  try { last = normalizeVoiceInfo(await b.available(lang), b.kind); } catch { last = normalizeVoiceInfo({ available: false, reason: b.kind === 'native' ? 'no-plugin' : 'web-unsupported' }, b.kind); }
  return last;
}
let support = null;
/** 麥克風怎麼顯示（這次開 App 問一次；fresh：語言包下好了、從設定回來時重問） */
export const voiceSupport = ({ fresh = false } = {}) => (fresh || !support ? (support = voiceStatus()) : support);
/** 最近一次問到的（同步；長按中央鍵時用） */
export const voiceInfoNow = () => last;
/** 測試用 */
export const _resetVoice = () => { support = null; last = null; };

/**
 * 協助下載語言包（產品負責人 2026-11-21：Android 第一次按麥克風時自動下載）。
 * 外掛有進度就照進度（Android 14 以上）；沒有就每 3 秒問一次 available，好了就結束。
 * onUpdate({ status })：start 開始｜progress { percent }｜scheduled 系統排在之後（例如等 Wi-Fi）｜done 好了｜fail 失敗｜slow 等太久（背景繼續）
 * @returns {() => void} 停止追蹤（不會取消系統的下載）
 */
export function downloadPack({ backend = voiceBackend(), lang = 'zh-TW', onUpdate = () => {}, check = () => voiceStatus(lang), timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }, pollMs = DOWNLOAD_POLL_MS, maxMs = DOWNLOAD_MAX_MS } = {}) {
  let over = false;
  let poll = null, cap = null;
  const end = (u) => { if (over) return; over = true; if (poll) timers.clear(poll); if (cap) timers.clear(cap); backend.unsub?.(); onUpdate(u); };
  const tick = async () => {
    if (over) return;
    const v = await check().catch(() => null);
    if (over) return;
    if (v?.state === 'ready') return end({ status: 'done' });
    if (v?.state === 'unsupported') return end({ status: 'fail' });
    poll = timers.set(tick, pollMs);
  };
  onUpdate({ status: 'start' });
  cap = timers.set(() => end({ status: 'slow' }), maxMs);
  backend.download(lang, (e) => {
    if (over || !e) return;
    if (e.status === 'progress' && Number.isFinite(e.percent)) onUpdate({ status: 'progress', percent: Math.max(0, Math.min(100, Math.round(e.percent))) });
    else if (e.status === 'scheduled') onUpdate({ status: 'scheduled' });
    else if (e.status === 'done') tick(); // 系統說好了：再問一次確定能用
    else if (e.status === 'error') end({ status: 'fail' });
  }).then(() => { if (!over) poll = timers.set(tick, pollMs); }, () => end({ status: 'fail' }));
  return () => { over = true; if (poll) timers.clear(poll); if (cap) timers.clear(cap); backend.unsub?.(); };
}

// ───── 控制器 ─────
/**
 * 一次一段「說」：開麥克風 → 部分結果 → 停頓 1.5 秒或按「說完了」或放開中央鍵 → 最後的文字 → onSend。
 * @param {{ backend?: ReturnType<typeof voiceBackend>, lang?: () => string, onChange?: (s: object, e: object) => void, onSend?: (text: string) => void,
 *   timers?: { set: Function, clear: Function }, silenceMs?: number, noSpeechMs?: number, maxMs?: number }} o
 */
export function createVoice({ backend = voiceBackend(), lang = () => 'zh-TW', onChange = () => {}, onSend = () => {}, timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) }, silenceMs = SILENCE_MS, noSpeechMs = NO_SPEECH_MS, maxMs = MAX_MS } = {}) {
  let s = voiceIdle();
  let run = 0; // 第幾段：取消後晚到的事件不算
  let tSilence = null, tNoSpeech = null, tMax = null, tFinal = null;
  const clearAll = () => { for (const t of [tSilence, tNoSpeech, tMax, tFinal]) if (t) timers.clear(t); tSilence = tNoSpeech = tMax = tFinal = null; };
  const dispatch = (e) => {
    const prev = s;
    s = voiceStep(s, e);
    if (s === prev) return;
    if (!active(s.phase)) clearAll();
    onChange(s, e);
    if (s.phase === 'sent' && prev.phase !== 'sent') {
      const text = s.sent;
      s = voiceIdle(); // 送出後回到沒在聽（畫面交給「阿幫在想」）
      onChange(s, { type: 'reset' });
      onSend(text);
    }
  };
  /** 說完了：請辨識收尾；最後的文字 3 秒內沒來就用已經聽到的 */
  const endAudio = (type) => {
    if (s.phase !== 'listening') return;
    dispatch({ type });
    if (s.phase !== 'finishing') return;
    const my = run;
    backend.stop();
    tFinal = timers.set(() => { if (my === run) dispatch({ type: 'final', text: '' }); }, FINAL_WAIT_MS);
  };
  const finish = () => endAudio('stop');
  const armSilence = () => {
    if (tSilence) timers.clear(tSilence);
    tSilence = s.hold ? null : timers.set(finish, silenceMs);
  };
  const onEvent = (my) => (e) => {
    if (my !== run || !e) return;
    if (e.type === 'partial') {
      const before = s.text;
      dispatch(e);
      if (s.text !== before) { if (tNoSpeech) { timers.clear(tNoSpeech); tNoSpeech = null; } if (s.phase === 'listening') armSilence(); }
      return;
    }
    dispatch(e);
  };
  return {
    get state() { return s; },
    /** 開始聽；hold：長按中央鍵（放開才結束） */
    async start({ hold = false } = {}) {
      if (active(s.phase)) return;
      const my = ++run;
      dispatch({ type: 'start', hold });
      try {
        const r = await backend.start(lang(), onEvent(my));
        if (my !== run) return;
        dispatch({ type: 'ready', onDevice: r?.onDevice, engine: r?.engine });
        if (s.phase !== 'listening') return;
        tNoSpeech = timers.set(() => { if (my === run && s.phase === 'listening' && !s.heard) { backend.cancel(); dispatch({ type: 'error', code: 'no-speech' }); } }, noSpeechMs);
        tMax = timers.set(finish, maxMs); // 停頓計時從聽到第一個字開始（還沒開口交給 noSpeech）
      } catch (err) {
        if (my === run) dispatch({ type: 'error', code: codeOf(err) });
      }
    },
    /** 說完了（按鈕）：等最後的文字再送出 */
    stop: finish,
    /** 放開中央鍵 */
    release() {
      if (s.phase === 'listening') endAudio('release');
      else dispatch({ type: 'release' }); // 還在開麥克風（第一次跳權限框）：之後改用停頓自動結束
    },
    cancel() {
      if (s.phase === 'idle') return;
      run++;
      const wasActive = active(s.phase);
      clearAll();
      if (wasActive) backend.cancel();
      dispatch({ type: 'cancel' });
    },
    /** 錯誤訊息看完了 */
    reset() { dispatch({ type: 'reset' }); },
  };
}
