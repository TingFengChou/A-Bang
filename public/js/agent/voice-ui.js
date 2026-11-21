// 語音問阿幫的畫面（M14-01，UX.md §5.0.3）：問阿幫輸入列的麥克風鍵＋「在聽」面板。
// 問阿幫頁與中央鍵拉出的底部對話是同一個畫面（abang-dock.js），所以兩邊都有麥克風。
// 在聽的動畫跟「阿幫的腦袋」、思考動畫同一套（Λ＋琥珀核心＋軌道），核心跟著音量脈動（--lv，只動 transform）；
// reduced motion／lite-motion：不動，只有「在聽…」與辨識中的文字。講完（停頓 1.5 秒、按「說完了」、放開中央鍵）自動送出，接上「阿幫在想」。
// 讀屏：只念「開始聽了」「取消了」與錯誤；辨識中的文字不念（一直變），送出後對話紀錄（role=log）會念你說的話。
// 只在手機上辨識（產品負責人 2026-11-21）：語言包沒裝 → 第一次按麥克風就協助下載（麥克風「準備中」）；
// 手機真的不支援 → 麥克風反白（aria-disabled，仍可點），點了說原因；網頁版不能本機辨識就不顯示。
import { createVoice, voiceSupport, voiceStatus, voiceEnabled, voiceLang, voiceBackend, downloadPack } from '../voice.js';
import { voiceT, voiceText, needsSettings, whyText, downloadText } from '../voice-i18n.js';

const MIC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/></svg>';
/** 在聽的核心（跟 thinking.js 的小核心同一套：深青綠底、亮白 Λ、琥珀核心、一圈軌道；核心與光暈跟著音量） */
const ORB = `<svg viewBox="0 0 48 48" width="52" height="52" focusable="false"><defs><linearGradient id="vc-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B3B39"/><stop offset=".6" stop-color="#0F766E"/><stop offset="1" stop-color="#14A396"/></linearGradient></defs>
<rect width="48" height="48" rx="14" fill="url(#vc-bg)"/><circle cx="24" cy="25" r="16" fill="none" stroke="#99F6E4" stroke-opacity=".3" stroke-width="1.5"/>
<g class="vc-orbit"><circle cx="24" cy="25" r="16" fill="none" stroke="#CCFBF1" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="16 85"/><circle cx="40" cy="25" r="1.8" fill="#FDE68A"/></g>
<path d="M14 37L24 12L34 37" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
<circle class="vc-halo" cx="24" cy="31" r="7" fill="#FBBF24" opacity=".35"/><circle class="vc-core" cx="24" cy="31" r="4.4" fill="#FBBF24"/></svg>`;

const btn = (cls, text) => Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: text });

/** 開系統的 App 設定（麥克風、語音辨識權限；專案內外掛 AbangSystem）。打不開回 false */
async function openAppSettings() {
  const c = globalThis.Capacitor;
  try { if (!c?.isNativePlatform?.() || !c.isPluginAvailable?.('AbangSystem')) return false; await c.nativePromise('AbangSystem', 'openSettings', { target: 'app' }); return true; } catch { return false; }
}
const canOpenSettings = () => { try { return !!globalThis.Capacitor?.isNativePlatform?.() && !!globalThis.Capacitor.isPluginAvailable?.('AbangSystem'); } catch { return false; } };
const isAndroidApp = (backend) => { try { return backend.kind === 'native' && globalThis.Capacitor?.getPlatform?.() === 'android'; } catch { return false; } };

/**
 * 掛到問阿幫的輸入列。
 * @param {{ form: HTMLFormElement, sendBtn: HTMLElement, dock: HTMLElement, send: (text: string, o: { voice: true }) => any }} o
 * @returns {{ ready: () => boolean, hold: () => void, release: () => void, cancel: () => void }}
 */
export function mountVoiceUI({ form, sendBtn, dock, send }) {
  let lang = document.documentElement.dataset.shellLang === 'en' ? 'en' : null; // 最近一輪的語言（agent.js 送 abang:agent-lang）
  let info = null; // voice.js normalizeVoiceInfo（zh-TW）
  let dl = null; // 語言包下載：{ status, percent }（這次按麥克風開始的）
  let stopDl = null;
  let note = null; // 面板顯示說明：'why' 不能用的原因｜'dl' 語言包下載
  let noteInfo = null; // 說明用的那一份（英文那一輪查的是 en-US）
  const t = () => voiceT(lang);
  const backend = voiceBackend();

  const mic = btn('chat-mic', '');
  mic.innerHTML = MIC;
  mic.hidden = true;
  mic.setAttribute('aria-label', t()('mic'));
  sendBtn.before(mic);

  const panel = document.createElement('div');
  panel.className = 'voice-panel';
  panel.hidden = true;
  panel.innerHTML = `<span class="vc-orb" aria-hidden="true">${ORB}</span><div class="vc-body"><b class="vc-title"></b><p class="vc-heard"></p><small class="vc-hint"></small><small class="vc-where"></small></div><div class="vc-acts"></div>`;
  const sr = document.createElement('p');
  sr.className = 'sr-only';
  sr.setAttribute('role', 'status');
  form.before(panel);
  dock.append(sr);
  const $ = (q) => panel.querySelector(q);
  const acts = $('.vc-acts');
  const say = (text) => { sr.textContent = ''; if (text) setTimeout(() => { sr.textContent = text; }, 50); };

  let holding = false; // 長按中央鍵中
  let shownPhase = 'idle';
  let userCancel = false;
  const ctrl = createVoice({
    backend,
    lang: () => voiceLang(lang),
    onChange: (st, e) => paint(st, e),
    onSend: (text) => send(text, { voice: true }),
  });

  /** 麥克風現在是哪一種：hidden｜ready｜download（按了下載語言包）｜preparing（下載中）｜off（反白：這支手機不能用） */
  const mode = () => {
    if (!info || info.state === 'none' || !voiceEnabled()) return 'hidden';
    if (dl && (dl.status === 'start' || dl.status === 'progress')) return 'preparing';
    return { ready: 'ready', download: 'download', downloading: 'preparing', unsupported: 'off' }[info.state] || 'hidden';
  };

  function paintMic() {
    const listening = ['starting', 'listening', 'finishing'].includes(ctrl.state.phase);
    const m = mode();
    const key = `${m}|${listening}|${lang}`;
    if (mic.dataset.state === key) return; // 部分結果一秒好幾次：沒變就不重畫（焦點、讀屏不受影響）
    mic.dataset.state = key;
    mic.hidden = m === 'hidden';
    mic.classList.toggle('on', listening);
    mic.classList.toggle('unavailable', m === 'off'); // 反白（仍可點，點了說原因）
    mic.classList.toggle('prep', m === 'preparing');
    if (m === 'off' || m === 'preparing') mic.setAttribute('aria-disabled', 'true'); else mic.removeAttribute('aria-disabled');
    mic.setAttribute('aria-pressed', String(listening));
    const T = t();
    const name = T(voiceLang(lang).startsWith('en') ? 'lang.en' : 'lang.zh');
    mic.setAttribute('aria-label', listening ? T('micStop') : m === 'off' ? T('mic.unsupported') : m === 'preparing' ? T('mic.preparing', { lang: name }) : m === 'download' ? T('mic.download', { lang: name }) : T('mic'));
    mic.innerHTML = listening ? STOP : MIC;
  }

  /** 「到手機設定下載」：Android 開語音輸入設定（下載語言包） */
  const voiceSettingsBtn = () => {
    const T = t();
    const o = btn('btn small', T('openVoiceSettings'));
    o.addEventListener('click', async () => { if (!(await backend.openSettings())) { o.disabled = true; o.textContent = T('openFailed'); } });
    return o;
  };

  /** 說明面板（沒在聽的時候）：不能用的原因、語言包下載的進度 */
  function paintNote({ announce = false } = {}) {
    const T = t();
    const tag = noteInfo?.lang || voiceLang(lang);
    let title = '', text = '', hint = '', where = '';
    const list = [];
    const ok = () => { const b = btn('btn small quiet', T('ok')); b.addEventListener('click', closeNote); return b; };
    const busy = dl?.status === 'start' || dl?.status === 'progress';
    if (note === 'why') {
      title = T('why.title');
      text = whyText(noteInfo || info, lang, tag);
      where = T('why.privacy');
      list.push(ok());
    } else if (note === 'dl') {
      title = downloadText(dl, lang, tag);
      if (busy) {
        hint = T('dl.note');
        const h = btn('btn small quiet', T('hide'));
        h.addEventListener('click', closeNote);
        list.push(h);
      } else if (dl?.status === 'done') {
        const go = btn('btn small vc-go', T('startNow'));
        go.addEventListener('click', () => { closeNote(); ctrl.start(); });
        list.push(go, ok());
      } else {
        if (isAndroidApp(backend)) list.push(voiceSettingsBtn());
        list.push(ok());
      }
    }
    panel.hidden = false;
    panel.dataset.phase = note === 'why' ? 'why' : busy ? 'download' : 'note';
    panel.classList.remove('hold');
    panel.style.setProperty('--lv', '0');
    if (lang === 'en') panel.setAttribute('lang', 'en'); else panel.removeAttribute('lang');
    $('.vc-title').textContent = title;
    const heard = $('.vc-heard');
    heard.textContent = text;
    heard.classList.remove('placeholder');
    heard.removeAttribute('aria-hidden');
    $('.vc-hint').textContent = hint;
    $('.vc-where').textContent = where;
    acts.replaceChildren(...list);
    if (announce) say([title, text].filter(Boolean).join(' '));
  }
  function openNote(kind, v = info) { note = kind; noteInfo = v; paintNote({ announce: true }); }
  function closeNote() { note = null; noteInfo = null; panel.hidden = true; mic.focus(); }

  function paintActs(st) {
    const T = t();
    const list = [];
    if (st.phase === 'error') {
      if (needsSettings(st.error) && canOpenSettings()) {
        const o = btn('btn small', T('openSettings'));
        o.addEventListener('click', async () => { if (!(await openAppSettings())) { o.disabled = true; o.textContent = T('openFailed'); } });
        list.push(o);
      } else if (st.error === 'language-missing' && isAndroidApp(backend)) list.push(voiceSettingsBtn());
      if (!needsSettings(st.error) && !['no-service', 'language', 'language-missing'].includes(st.error)) { const r = btn('btn small', T('retry')); r.addEventListener('click', () => ctrl.start()); list.push(r); }
      const ok = btn('btn small quiet', T('ok'));
      ok.addEventListener('click', () => { ctrl.reset(); mic.focus(); });
      list.push(ok);
    } else if (st.phase !== 'idle') {
      const c = btn('btn small quiet vc-cancel', T('cancel'));
      c.addEventListener('click', () => { userCancel = true; ctrl.cancel(); mic.focus(); });
      list.push(c);
      if (!st.hold) { const d = btn('btn small vc-done', T('done')); d.disabled = st.phase !== 'listening'; d.addEventListener('click', () => ctrl.stop()); list.push(d); }
    }
    acts.replaceChildren(...list);
  }

  function paint(st, e = {}) {
    if (e.type === 'level') { panel.style.setProperty('--lv', st.level.toFixed(2)); return; } // 一秒十幾次：只換音量
    paintMic();
    if (st.phase === 'idle' && note) { shownPhase = 'idle'; userCancel = false; paintNote(); return; }
    const x = voiceText(st, lang);
    panel.hidden = st.phase === 'idle';
    panel.dataset.phase = st.phase;
    panel.classList.toggle('hold', !!st.hold);
    panel.style.setProperty('--lv', st.level.toFixed(2));
    if (lang === 'en') panel.setAttribute('lang', 'en'); else panel.removeAttribute('lang');
    $('.vc-title').textContent = x.title;
    const heard = $('.vc-heard');
    heard.textContent = x.text;
    heard.classList.toggle('placeholder', !x.heard);
    heard.setAttribute('aria-hidden', 'true'); // 辨識中的文字一直變：不念
    $('.vc-hint').textContent = x.hint;
    $('.vc-where').textContent = x.where;
    if (st.phase !== shownPhase || e.type === 'release') {
      if (st.phase !== shownPhase && (st.phase === 'listening' || st.phase === 'error')) say(x.announce);
      if (st.phase === 'idle' && e.type === 'cancel' && userCancel) say(t()('announce.cancel'));
      paintActs(st);
    }
    userCancel = false;
    shownPhase = st.phase;
    if (st.phase === 'listening' && document.visibilityState === 'hidden') queueMicrotask(() => ctrl.cancel()); // 權限框之外的離開：不在背景聽
    document.getElementById('abang-fab')?.classList.toggle('listening', st.phase === 'listening' && st.hold);
  }

  /** 語言包：第一次按麥克風時協助下載（產品負責人同意自動下載）；下載中麥克風「準備中」，不退回雲端辨識 */
  function startDownload(tag) {
    stopDl?.();
    dl = { status: 'start' };
    note = 'dl'; noteInfo = { lang: tag };
    paintMic();
    paintNote({ announce: true });
    stopDl = downloadPack({
      backend, lang: tag,
      onUpdate: async (u) => {
        if (u.status === 'start') return;
        dl = u;
        if (u.status !== 'progress') { stopDl = null; info = await voiceSupport({ fresh: true }); } // 好了、失敗、排定、等太久：照系統現在說的
        paintMic();
        if (note === 'dl') paintNote({ announce: u.status !== 'progress' });
      },
    });
  }

  /** 按麥克風：在聽就說完了；能用就開始；語言包可下載就下載；下載中或不能用就說明 */
  async function onMic() {
    const p = ctrl.state.phase;
    if (p === 'listening') { ctrl.stop(); return; }
    if (p !== 'idle' && p !== 'error') return;
    const tag = voiceLang(lang);
    const v = tag === 'zh-TW' ? info : await voiceStatus(tag); // 英文那一輪：查英文的語言包
    if (!v) return;
    if (v.state === 'ready') { note = null; ctrl.start(); return; }
    if (v.state === 'download' && mode() !== 'preparing') { startDownload(tag); return; }
    if (v.state === 'downloading' || v.state === 'download') { if (!dl) dl = { status: 'slow' }; openNote('dl', { ...v, lang: tag }); return; }
    openNote('why', { ...v, lang: tag });
  }
  mic.addEventListener('click', onMic);
  // Esc：取消或收起說明（不關掉底部對話）
  dock.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ctrl.state.phase !== 'idle') { e.preventDefault(); e.stopPropagation(); userCancel = true; ctrl.cancel(); mic.focus(); }
    else if (note) { e.preventDefault(); e.stopPropagation(); closeNote(); }
  });
  const refresh = async () => { info = await voiceSupport({ fresh: true }); paintMic(); };
  // 切到別的 App、鎖螢幕：不在背景開著麥克風；回來時重查（可能剛在設定下載了語言包）
  // 第一次按麥克風時 Android 跳權限框，App 會暫時看不見（visibilitychange hidden）：這時（starting）不取消，等權限回來；
  // 開始聽時如果畫面真的不在前景，再取消（審查 1）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (ctrl.state.phase !== 'starting') ctrl.cancel(); }
    else if (info && info.state !== 'ready' && info.state !== 'none' && !stopDl) refresh();
  });
  addEventListener('abang:agent-lang', (e) => { lang = e.detail?.lang === 'en' ? 'en' : null; paintMic(); });
  const sync = () => { paintMic(); if (mode() === 'hidden') { ctrl.cancel(); if (note) { note = null; panel.hidden = true; } } };
  addEventListener('abang:voice-setting', sync);
  voiceSupport().then((r) => { info = r; sync(); });

  return {
    ready: () => mode() === 'ready',
    async hold() { // 對話剛建立時還不知道能不能用：等一下（已經問過，很快）；等的時候就放開了，就改用停頓自動結束
      holding = true;
      info = await voiceSupport();
      sync();
      if (mode() === 'ready') ctrl.start({ hold: holding });
      else if (mode() !== 'hidden') onMic(); // 語言包還沒好、不能用：跟按麥克風一樣（下載或說原因）
    },
    release: () => { holding = false; ctrl.release(); },
    cancel: () => { ctrl.cancel(); if (note) { note = null; noteInfo = null; panel.hidden = true; } },
  };
}
