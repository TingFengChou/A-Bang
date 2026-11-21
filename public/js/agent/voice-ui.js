// 語音問阿幫的畫面（M14-01，UX.md §5.0.3）：問阿幫輸入列的麥克風鍵＋「在聽」面板。
// 問阿幫頁與中央鍵拉出的底部對話是同一個畫面（abang-dock.js），所以兩邊都有麥克風。
// 在聽的動畫跟「阿幫的腦袋」、思考動畫同一套（Λ＋琥珀核心＋軌道），核心跟著音量脈動（--lv，只動 transform）；
// reduced motion／lite-motion：不動，只有「在聽…」與辨識中的文字。講完（停頓 1.5 秒、按「說完了」、放開中央鍵）自動送出，接上「阿幫在想」。
// 讀屏：只念「開始聽了」「取消了」與錯誤；辨識中的文字不念（一直變），送出後對話紀錄（role=log）會念你說的話。
import { createVoice, voiceSupport, voiceEnabled, voiceLang } from '../voice.js';
import { voiceT, voiceText, needsSettings } from '../voice-i18n.js';

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

/**
 * 掛到問阿幫的輸入列。
 * @param {{ form: HTMLFormElement, sendBtn: HTMLElement, dock: HTMLElement, send: (text: string, o: { voice: true }) => any }} o
 * @returns {{ ready: () => boolean, hold: () => void, release: () => void, cancel: () => void }}
 */
export function mountVoiceUI({ form, sendBtn, dock, send }) {
  let lang = document.documentElement.dataset.shellLang === 'en' ? 'en' : null; // 最近一輪的語言（agent.js 送 abang:agent-lang）
  let supported = false;
  const t = () => voiceT(lang);

  const mic = btn('chat-mic', '');
  mic.innerHTML = MIC;
  mic.hidden = true;
  mic.setAttribute('aria-label', t()('mic'));
  sendBtn.before(mic);

  const panel = document.createElement('div');
  panel.className = 'voice-panel';
  panel.hidden = true;
  panel.innerHTML = `<span class="vc-orb" aria-hidden="true">${ORB}</span><div class="vc-body"><b class="vc-title"></b><p class="vc-heard" aria-hidden="true"></p><small class="vc-hint"></small><small class="vc-where"></small></div><div class="vc-acts"></div>`;
  const sr = document.createElement('p');
  sr.className = 'sr-only';
  sr.setAttribute('role', 'status');
  form.before(panel);
  dock.append(sr);
  const $ = (s) => panel.querySelector(s);
  const acts = $('.vc-acts');
  const say = (text) => { sr.textContent = ''; if (text) setTimeout(() => { sr.textContent = text; }, 50); };

  let holding = false; // 長按中央鍵中
  let shownPhase = 'idle';
  let userCancel = false;
  const ctrl = createVoice({
    lang: () => voiceLang(lang),
    onChange: (s, e) => paint(s, e),
    onSend: (text) => send(text, { voice: true }),
  });

  function setMic(listening) {
    if (mic.dataset.state === `${listening}|${lang}`) return; // 部分結果一秒好幾次：沒變就不重畫（焦點、讀屏不受影響）
    mic.dataset.state = `${listening}|${lang}`;
    mic.classList.toggle('on', listening);
    mic.setAttribute('aria-pressed', String(listening));
    mic.setAttribute('aria-label', t()(listening ? 'micStop' : 'mic'));
    mic.innerHTML = listening ? STOP : MIC;
  }

  function paintActs(s) {
    const T = t();
    const list = [];
    if (s.phase === 'error') {
      if (needsSettings(s.error) && canOpenSettings()) {
        const o = btn('btn small', T('openSettings'));
        o.addEventListener('click', async () => { if (!(await openAppSettings())) { o.disabled = true; o.textContent = T('openFailed'); } });
        list.push(o);
      }
      if (!needsSettings(s.error) && s.error !== 'no-service' && s.error !== 'language') { const r = btn('btn small', T('retry')); r.addEventListener('click', () => ctrl.start()); list.push(r); }
      const ok = btn('btn small quiet', T('ok'));
      ok.addEventListener('click', () => { ctrl.reset(); mic.focus(); });
      list.push(ok);
    } else if (s.phase !== 'idle') {
      const c = btn('btn small quiet vc-cancel', T('cancel'));
      c.addEventListener('click', () => { userCancel = true; ctrl.cancel(); mic.focus(); });
      list.push(c);
      if (!s.hold) { const d = btn('btn small vc-done', T('done')); d.disabled = s.phase !== 'listening'; d.addEventListener('click', () => ctrl.stop()); list.push(d); }
    }
    acts.replaceChildren(...list);
  }

  function paint(s, e = {}) {
    if (e.type === 'level') { panel.style.setProperty('--lv', s.level.toFixed(2)); return; } // 一秒十幾次：只換音量
    const x = voiceText(s, lang);
    const on = s.phase !== 'idle';
    panel.hidden = !on;
    panel.dataset.phase = s.phase;
    panel.classList.toggle('hold', !!s.hold);
    panel.style.setProperty('--lv', s.level.toFixed(2));
    if (lang === 'en') panel.setAttribute('lang', 'en'); else panel.removeAttribute('lang');
    $('.vc-title').textContent = x.title;
    const heard = $('.vc-heard');
    heard.textContent = x.text;
    heard.classList.toggle('placeholder', !x.heard);
    $('.vc-hint').textContent = x.hint;
    const where = $('.vc-where');
    where.textContent = x.where;
    where.classList.toggle('system', s.onDevice === false);
    setMic(s.phase === 'starting' || s.phase === 'listening' || s.phase === 'finishing');
    if (s.phase !== shownPhase || e.type === 'engine' || e.type === 'release') {
      if (s.phase !== shownPhase && (s.phase === 'listening' || s.phase === 'error')) say(x.announce);
      if (s.phase === 'idle' && e.type === 'cancel' && userCancel) say(t()('announce.cancel'));
      paintActs(s);
    }
    userCancel = false;
    shownPhase = s.phase;
    document.getElementById('abang-fab')?.classList.toggle('listening', s.phase === 'listening' && s.hold);
  }

  mic.addEventListener('click', () => {
    const p = ctrl.state.phase;
    if (p === 'listening') ctrl.stop();
    else if (p === 'idle' || p === 'error') ctrl.start();
  });
  // Esc：取消（不關掉底部對話）
  dock.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || ctrl.state.phase === 'idle') return;
    e.preventDefault(); e.stopPropagation();
    userCancel = true; ctrl.cancel(); mic.focus();
  });
  // 切到別的 App、鎖螢幕：不在背景開著麥克風
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ctrl.cancel(); });
  addEventListener('abang:agent-lang', (e) => { lang = e.detail?.lang === 'en' ? 'en' : null; if (ctrl.state.phase === 'idle') setMic(false); });
  const sync = () => {
    const on = supported && voiceEnabled();
    mic.hidden = !on;
    if (!on) ctrl.cancel();
  };
  addEventListener('abang:voice-setting', sync);
  voiceSupport().then((r) => { supported = !!r.available; sync(); });

  return {
    ready: () => supported && voiceEnabled(),
    async hold() { // 對話剛建立時還不知道能不能用：等一下（已經問過，很快）；等的時候就放開了，就改用停頓自動結束
      holding = true;
      supported = !!(await voiceSupport()).available;
      sync();
      if (supported && voiceEnabled()) ctrl.start({ hold: holding });
    },
    release: () => { holding = false; ctrl.release(); },
    cancel: () => ctrl.cancel(),
  };
}
