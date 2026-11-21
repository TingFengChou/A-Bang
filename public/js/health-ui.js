// 健康與運動的畫面（ADR-0018）：首頁「現在」的散步小卡、問阿幫回答下面的一句、設定頁與「我的」頁的開關。
// 文字都在手機上組（public/js/health.js → /core/health-nudge.js）；這裡只畫，不送任何東西到伺服器。
import { icons } from './icons.js';
import { esc } from './ui.js';
import { state } from './api.js';
import { dramaHintOn } from './drama-hint.js';
import { exerciseNudge } from '../../core/drama-say.js';
import { healthEnabled, setHealthEnabled, healthStatus, requestHealthPermission, openHealthSettings, dismissToday, healthSummary, HEALTH_WHY, HEALTH_DENIED } from './health.js';

const PRIVATE = '步數只在手機上看，不上傳';

/**
 * 建議去走走時的 MyDrama 運動活動頁（ADR-0019 D-05）：伺服器設定了連結（開 App 時查的服務狀態就帶來，不另外問），
 * 而且你沒在設定關掉短劇提示才給；沒設定就不顯示。只開合作 App 的固定連結，不帶任何健康資料。
 * @param {object} n 散步建議（只有 go 才給）
 * @returns {{ label: string, app: string, store: object|null }|null}
 */
export function dramaExercise(n, { partner = state.partner, lang = null, hintOn = dramaHintOn() } = {}) {
  if (n?.kind !== 'go' || !hintOn || !partner?.exercise) return null;
  const x = exerciseNudge({ weatherOk: true, movedLittle: true, lang, link: partner.exercise });
  return x?.cta && x.link ? { label: x.cta, app: x.link, store: partner.store || null } : null;
}
const PRIVATE_EN = 'Your steps stay on this phone';

/**
 * 首頁「現在」的小卡（go：去走走；cheer：達標了，只給一句鼓勵）。
 * @param {HTMLElement} box
 * @param {object|null} n health.js homeNudge() 的結果（null＝收起）
 * @param {{ openLink: (url: string) => void, toast?: Function }} o
 */
export function renderMoveCard(box, n, { openLink, openApp, toast } = {}) {
  if (!box) return;
  const drama = openApp ? dramaExercise(n) : null;
  const sig = n ? JSON.stringify([n.kind, n.text, n.demo, drama?.app || '']) : '';
  if (box.dataset.sig === sig) return; // 一樣就不重畫（焦點不掉）
  box.dataset.sig = sig;
  if (!n) { box.replaceChildren(); box.hidden = true; return; }
  box.hidden = false;
  const go = n.kind === 'go';
  box.innerHTML = `<div class="move-card" data-kind="${go ? 'go' : 'cheer'}" role="group" aria-labelledby="mv-title">
    <span class="ab-token sm" style="--c:${go ? '#15803d' : '#b45309'}" aria-hidden="true">${go ? icons.walk : icons.star}</span>
    <div class="mv-t">
      <b id="mv-title">${go ? '去走走吧' : '今天達標了'}</b>
      <p>${esc(n.text)}</p>
      <div class="mv-acts">${go && n.spot?.nav?.google ? `<button type="button" class="btn small" data-act="nav">走到${esc(n.spot.name)}</button>` : ''}<button type="button" class="btn small quiet" data-act="off">${go ? '今天不用' : '知道了'}</button>${drama ? `<button type="button" class="linkish mv-partner" data-act="drama">${esc(drama.label)}</button>` : ''}</div>
      <small class="mv-note">${n.demo ? '示範資料，不是你的步數・' : ''}${PRIVATE}</small>
    </div>${n.demo ? '<span class="tag demo" title="網頁版用示範健康資料">示範</span>' : ''}
  </div>`;
  box.querySelector('[data-act="nav"]')?.addEventListener('click', () => openLink?.(n.spot.nav.google)); // 官方地圖的步行導航（ADR-0011），只帶目的地
  box.querySelector('[data-act="drama"]')?.addEventListener('click', () => openApp({ app: drama.app, store: drama.store })); // 合作 App 的固定連結，不帶健康資料
  box.querySelector('[data-act="off"]').addEventListener('click', () => {
    dismissToday();
    renderMoveCard(box, null);
    toast?.(go ? '好，今天不提了，明天再說' : '明天見！');
  });
}

/**
 * 問阿幫回答下面在手機上補的一句（不進對話紀錄、不送伺服器）。
 * @param {object} n health.js agentNudge() 的結果
 * @param {{ avatar: HTMLElement, lang?: string|null, openLink: Function }} o
 */
export function healthBubble(n, { avatar, lang = null, openLink, openApp } = {}) {
  const en = lang === 'en';
  const wrap = document.createElement('div');
  wrap.className = 'bubble agent health-say';
  wrap.dataset.kind = n.kind;
  const say = document.createElement('div');
  say.className = 'say';
  say.textContent = en ? n.en : n.text;
  if (en) say.setAttribute('lang', 'en');
  const note = document.createElement('small');
  note.className = 'hs-note';
  note.textContent = `${n.demo ? (en ? 'Demo data, not your steps · ' : '示範資料，不是你的步數・') : ''}${en ? `${PRIVATE_EN}; not sent with your question` : `${PRIVATE}，也沒有跟問題一起送出`}`;
  const acts = document.createElement('div');
  acts.className = 'hs-acts';
  if (n.kind === 'go' && n.spot?.nav?.google) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: en ? `Walk to ${n.spot.en}` : `走到${n.spot.name}` });
    b.addEventListener('click', () => openLink?.(n.spot.nav.google));
    acts.append(b);
  }
  if (n.kind === 'go') {
    const off = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: en ? 'Not today' : '今天不用' });
    off.addEventListener('click', () => { dismissToday(); acts.replaceChildren(Object.assign(document.createElement('span'), { className: 'hs-done', textContent: en ? "OK, I won't mention it again today." : '好，今天不提了，明天再說。' })); });
    acts.append(off);
    const drama = openApp ? dramaExercise(n, { lang }) : null;
    if (drama) {
      const d = Object.assign(document.createElement('button'), { type: 'button', className: 'linkish hs-partner', textContent: drama.label });
      d.addEventListener('click', () => openApp({ app: drama.app, store: drama.store })); // 合作 App 的固定連結，不帶健康資料
      acts.append(d);
    }
  }
  wrap.append(avatar, say, note);
  if (acts.childElementCount) wrap.append(acts);
  return wrap;
}

const READY_SAY = { 'health-connect': '從 Health Connect 讀步數與運動時間', healthkit: '從「健康」App 讀步數與體能訓練時間', demo: '網頁版：用示範資料（不是你的步數）' };

/** 開關旁的一行狀態 */
export function healthStatusText(st, on) {
  if (st.state === 'unavailable') return `不能使用：${HEALTH_WHY[st.reason] || HEALTH_WHY.failed}`;
  if (st.where === 'demo') return on ? READY_SAY.demo : '關閉中（網頁版打開會用示範資料）';
  if (st.state === 'ready') return on ? `已打開：${READY_SAY[st.source] || '讀步數與運動時間'}` : '關閉中（已允許過，打開就能用）';
  if (st.state === 'denied') return on ? '沒有允許讀取' : '關閉中（沒有允許讀取；打開時會再問一次）';
  return '關閉中（打開時才會請你允許讀取步數與運動時間）';
}

/**
 * 設定頁與「我的」頁的開關（同一份）。預設關閉；打開時才跳系統權限；被拒或手機不能用時反白並說原因。
 * @param {HTMLElement} sec 放開關的容器
 * @param {{ toast: Function, prefix?: string }} o
 */
export function mountHealthSetting(sec, { toast, prefix = 'health' } = {}) {
  sec.innerHTML = `
    <label class="switch-row"><span><b>天氣好又動得少時，建議我去走走</b><small id="${prefix}-status">檢查中…</small></span>
      <input type="checkbox" id="${prefix}" class="switch" role="switch" aria-describedby="${prefix}-note" ${healthEnabled() ? 'checked' : ''}></label>
    <p class="health-why" id="${prefix}-why" role="status" hidden></p>
    <div class="health-acts" hidden></div>
    <p class="note" id="${prefix}-note">打開後，阿幫讀這支手機的步數與運動時間（今天與近 7 天；Android 的 Health Connect、iPhone 的「健康」App，只讀不寫）。步數只在手機上用來判斷「天氣好、你今天又動得少」，<b>不上傳、不存起來、不會跟問題一起送出</b>；天氣、空品照常用你的位置查。建議出現在首頁「現在」與問阿幫的回答下面，一天一次，按「今天不用」就到明天再說，不推通知。系統權限在你打開時才問；網頁版讀不到手機的健康資料，打開後用示範資料讓你看看效果。</p>`;
  const sw = sec.querySelector(`#${prefix}`);
  const status = sec.querySelector(`#${prefix}-status`);
  const why = sec.querySelector(`#${prefix}-why`);
  const acts = sec.querySelector('.health-acts');
  let st = null;
  const showWhy = (text, s) => {
    why.textContent = text || '';
    why.hidden = !text;
    acts.replaceChildren();
    if (s?.canInstall) acts.append(actBtn('到 Play 商店安裝 Health Connect', 'install'));
    else if (s?.state === 'denied' && s.canOpen) acts.append(actBtn('到 Health Connect 允許', 'manage'));
    acts.hidden = !acts.childElementCount;
  };
  const actBtn = (label, target) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: label });
    b.addEventListener('click', async () => { if (!(await openHealthSettings(target))) toast?.('開不了，請到手機的 Health Connect 設定', 5000); }); // 只開畫面，允許要使用者自己按
    return b;
  };
  const paint = () => {
    const on = healthEnabled();
    sw.checked = on && st?.state !== 'unavailable';
    status.textContent = st ? healthStatusText(st, on) : '檢查中…';
    const off = st?.state === 'unavailable';
    sw.classList.toggle('unavailable', off); // 反白（仍可按，按了說原因；比照語音）
    if (off) sw.setAttribute('aria-disabled', 'true'); else sw.removeAttribute('aria-disabled');
    if (off) showWhy(HEALTH_WHY[st.reason] || HEALTH_WHY.failed, st);
    else if (on && st?.state === 'denied') showWhy(HEALTH_DENIED[st.platform] || HEALTH_DENIED.android, st);
    else showWhy('', null);
  };
  const refresh = () => healthStatus().then((s) => { st = s; paint(); });
  refresh();
  sw.addEventListener('click', (e) => {
    if (st?.state !== 'unavailable') return;
    e.preventDefault(); // 手機不能用：不打開，說原因
    showWhy(HEALTH_WHY[st.reason] || HEALTH_WHY.failed, st);
    toast?.(HEALTH_WHY[st.reason] || HEALTH_WHY.failed, 6000);
  });
  sw.addEventListener('change', async () => {
    if (!sw.checked) {
      setHealthEnabled(false);
      paint();
      toast?.(st?.where === 'app' ? '已關閉：阿幫不再讀步數（要收回系統權限，到 Health Connect 或「健康」App）' : '已關閉：阿幫不再讀步數');
      return;
    }
    sw.disabled = true;
    status.textContent = '請在跳出的畫面允許讀取步數與運動時間…';
    st = st?.state === 'ready' ? st : await requestHealthPermission(); // 第一次打開才問；允許由使用者自己按
    sw.disabled = false;
    if (st.state === 'ready') {
      setHealthEnabled(true);
      paint();
      toast?.(st.where === 'demo' ? '已打開（網頁版用示範資料）' : '已打開：天氣好又動得少時，阿幫會建議你去走走');
      if (st.platform === 'ios') { // iPhone 不告訴 App 有沒有允許讀取：讀一次，什麼都沒有就說怎麼去「健康」App 打開
        const v = await healthSummary();
        if (!v?.days.some((d) => d.steps != null || d.exerciseMin != null)) showWhy(HEALTH_DENIED.ios, null);
      }
    } else {
      setHealthEnabled(false);
      paint();
      showWhy(st.state === 'unavailable' ? HEALTH_WHY[st.reason] || HEALTH_WHY.failed : HEALTH_DENIED[st.platform] || HEALTH_DENIED.android, { ...st, state: st.state === 'need-permission' ? 'denied' : st.state, canOpen: st.platform === 'android' && st.state !== 'unavailable' });
      toast?.('沒有允許讀取步數，開關先關著', 5000);
    }
  });
  return { refresh };
}
