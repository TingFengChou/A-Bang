// 等車推短劇（ADR-0019，產品負責人 2026-11-22）：到站卡片下方的小提示（伺服器 aside 事件，句子由程式產生、不經模型）。
// 設定頁可以關掉（預設開，存在這支手機）；關掉時送 dramaHint: false，伺服器就不查也不推。交通資訊是主角：這裡只是一行小字＋兩個按鈕。

export const DRAMA_HINT_KEY = 'abang.dramaHint';
/** 等車推短劇開著嗎（沒設定過＝開） */
export function dramaHintOn() {
  try { return localStorage.getItem(DRAMA_HINT_KEY) !== '0'; } catch { return true; }
}
export function setDramaHintOn(on) {
  try { if (on) localStorage.removeItem(DRAMA_HINT_KEY); else localStorage.setItem(DRAMA_HINT_KEY, '0'); } catch { /* 無痕模式 */ }
}

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/></svg>';

/**
 * 卡片下方的短劇提示。
 * @param {{ text: string, data: { title: string, appLink: string|null, store: object|null }, labels: { watch: string, dismiss: string, note: string } }} e aside 事件
 * @param {{ host: { openApp?: Function }, ask: (q: string) => void, lang?: 'en'|null }} opts
 * @returns {HTMLElement}
 */
export function mountDramaHint(e, { host, ask, lang = null }) {
  const en = lang === 'en';
  const box = document.createElement('aside');
  box.className = 'drama-hint';
  box.setAttribute('aria-label', en ? 'Short drama while you wait' : '等車時看短劇');
  const icon = document.createElement('span');
  icon.className = 'dh-icon';
  icon.innerHTML = PLAY; // 本機常數 SVG
  const say = document.createElement('p');
  say.className = 'dh-say';
  say.textContent = e.text;
  const note = document.createElement('small');
  note.className = 'dh-note';
  note.textContent = e.labels?.note || '';
  const acts = document.createElement('div');
  acts.className = 'dh-acts';
  const btn = (cls, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.addEventListener('click', fn); return b; };
  const canOpen = host?.openApp && (e.data?.appLink || e.data?.store);
  // 有 App 連結：開 MyDrama（沒裝到商店頁）；示範沒設定連結：改成問阿幫這部在演什麼
  acts.append(canOpen
    ? btn('btn small ghost', e.labels?.watch || (en ? 'Watch it' : '看這集'), () => host.openApp({ app: e.data.appLink, store: e.data.store }))
    : btn('btn small ghost', en ? 'What is it about?' : '在演什麼', () => ask(en ? `What is 《${e.data.title}》 about?` : `《${e.data.title}》在演什麼`)));
  acts.append(btn('btn small quiet', e.labels?.dismiss || (en ? 'No thanks' : '不用了'), () => { box.classList.add('gone'); setTimeout(() => box.remove(), 200); }));
  const main = document.createElement('div');
  main.className = 'dh-main';
  main.append(say, acts, note);
  box.append(icon, main);
  return box;
}
