// 首次使用引導（2026-11-21，PLAN「體驗與品質補強」）：第一次打開首頁時，說明阿幫怎麼用，並在這裡要定位（App 另要通知）權限。
// 權限在使用者看得懂為什麼之後才要（按了按鈕才跳系統對話框）；已經允許的步驟跳過；每一步都可以略過，之後在「設定與隱私」可以再看一次。
// 網頁版不在這裡要通知：設定到站提醒時（host-web.js）才要，比較看得懂為什麼（PR #49 設計審查）。
// <dialog> 原生：焦點留在對話框內、Esc 關閉；文字一律 textContent。
import { browserLocation, locationGranted } from './agent/client.js';
import { locationHelp } from './location-help.js';
import { ensureNotifyPermission, hasNativeNotify } from './native-notify.js';
import { areaPicker, setHomeArea, areaLabel } from './home-area.js';

const KEY = 'abang.onboarded';

/** 看過了嗎（無痕模式讀不到就當看過，不要每次都跳） */
export function onboarded() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}
function markDone() {
  try { localStorage.setItem(KEY, '1'); } catch { /* 無痕模式 */ }
}

/** App 的通知權限是否已允許（不跳對話框） */
async function notifyGranted() {
  const c = globalThis.Capacitor;
  try { return (await c.nativePromise('LocalNotifications', 'checkPermissions', {}))?.display === 'granted'; } catch { return false; }
}

const INTRO = {
  img: '/brand/abang-happy.svg',
  title: '嗨，我是阿幫',
  body: ['我用政府開放資料回答交通和生活問題：公車到哪了、怎麼去比較快、要不要帶傘、附近藥局。', '直接打字問我就好，例如「去台北101」「307 到哪了」。比較方案時，點決策圖上的其他方案就能改選。'],
};
const LOCATION = {
  img: '/brand/abang-think.svg',
  title: '用你現在的位置當起點',
  body: ['問「怎麼去」「附近 YouBike」時，我會用你現在的位置。位置只用來回答當下的問題，不會存到伺服器；常用地點要你自己設定，只存在這支手機。', '不給也能用：下一步選一個預設地區，或問的時候直接說地點。'],
  action: { label: '允許定位', done: '已允許定位', fail: () => { const h = locationHelp(); return `沒拿到位置：${h.why}之後可以${h.fix.replace(/^按「到設定開啟」，/, '到手機設定，')}；不開也能用，直接打地點就好。`; }, run: async () => Boolean(await browserLocation(8000)) },
  granted: locationGranted,
};
// 預設地區（T-HOMEAREA）：定位已允許就跳過；沒開定位也能用——選一個縣市＋區，問附近、怎麼去時先用那一區
const AREA = {
  img: '/brand/abang-think.svg',
  title: '沒開定位也能用',
  body: ['選一個預設地區：沒拿到位置時，問「附近藥局」「怎麼去」我先用這一區查，並說清楚是預設地區。只存在這支手機，隨時可在「設定與隱私」改。'],
  picker: true,
  granted: locationGranted,
};
const NOTIFY = {
  img: '/brand/abang-happy.svg',
  title: '公車快到時提醒你',
  body: ['選好公車後，我可以在車快到站前提醒你，App 關著也會響。'],
  action: { label: '允許通知', done: '已允許通知', fail: '沒有開通知，提醒只會在 App 開著時顯示。之後可到手機設定打開。', run: () => ensureNotifyPermission() },
  granted: notifyGranted,
};

/**
 * 顯示引導（看過就不再顯示，除非 force）。
 * @param {{ force?: boolean, onClose?: () => void }} [opts]
 * @returns {HTMLDialogElement|null}
 */
export function showOnboarding({ force = false, onClose } = {}) {
  if (!force && onboarded()) return null;
  // iOS 15.0～15.3 的 WKWebView 沒有 <dialog>（部署目標 15.0）：不顯示，也不記成看過（升級後還會出現）
  if (typeof HTMLDialogElement !== 'function' || typeof HTMLDialogElement.prototype.showModal !== 'function') return null;
  if (document.querySelector('dialog.onboard')) return null; // 連點「再看一次」不疊兩個
  const steps = [INTRO, LOCATION, AREA, ...(hasNativeNotify() ? [NOTIFY] : [])];
  // 已經允許的權限步驟跳過（背景檢查；第一步沒有權限，查完之前不會用到）
  const skip = new Set();
  for (const s of steps) if (s.granted) s.granted().then((ok) => { if (ok) skip.add(s); }).catch(() => {});
  const dlg = document.createElement('dialog');
  dlg.className = 'onboard';
  dlg.setAttribute('aria-labelledby', 'onboard-title');
  dlg.setAttribute('aria-describedby', 'onboard-body');
  let i = 0;
  const close = () => { markDone(); dlg.close(); };
  dlg.addEventListener('close', () => { markDone(); dlg.remove(); onClose?.(); dispatchEvent(new Event('abang:onboarded')); }); // 首頁「今天」卡看完引導才出現；預設地區也可能剛設好
  const rest = () => steps.slice(i + 1).filter((s) => !skip.has(s));

  const paint = () => {
    const s = steps[i];
    dlg.replaceChildren();
    const skipBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'onboard-skip', textContent: '略過' });
    skipBtn.setAttribute('aria-label', '略過使用說明');
    skipBtn.addEventListener('click', close);
    const img = Object.assign(document.createElement('img'), { src: s.img, alt: '', className: 'onboard-img', width: 96, height: 96 });
    const visible = steps.filter((x) => x === s || !skip.has(x));
    const dots = Object.assign(document.createElement('p'), { className: 'onboard-step', textContent: `第 ${visible.indexOf(s) + 1} 步，共 ${visible.length} 步` });
    const h = Object.assign(document.createElement('h2'), { id: 'onboard-title', textContent: s.title, tabIndex: -1 });
    const body = document.createElement('div');
    body.id = 'onboard-body';
    body.append(...s.body.map((t) => Object.assign(document.createElement('p'), { textContent: t })));
    const status = Object.assign(document.createElement('p'), { className: 'onboard-status', id: 'onboard-status' });
    status.setAttribute('role', 'status');
    const row = document.createElement('div');
    row.className = 'onboard-actions';
    const last = !rest().length;
    const next = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: last ? '開始使用' : '下一步' });
    next.addEventListener('click', () => {
      const k = steps.findIndex((x, n) => n > i && !skip.has(x)); // 已經允許的步驟跳過；後面都不用了就結束
      if (last || k < 0) { close(); return; }
      i = k;
      paint();
    });
    if (s.picker) { // 預設地區：選好縣市＋區才能儲存；「先跳過」照樣往下
      const box = document.createElement('div');
      body.append(box);
      let chosen = null;
      const save = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: '儲存', disabled: true });
      areaPicker(box, { onChange: (a) => { chosen = a; save.disabled = !a; } }).catch(() => {});
      next.className = 'btn quiet';
      next.textContent = last ? '先跳過，開始使用' : '先跳過';
      save.addEventListener('click', () => {
        if (!chosen) return;
        setHomeArea(chosen);
        status.textContent = `好，預設地區是${areaLabel(chosen)}。`;
        save.hidden = true;
        next.className = 'btn';
        next.textContent = last ? '開始使用' : '下一步';
        next.setAttribute('aria-describedby', status.id);
        next.focus();
      });
      row.append(save, next);
    } else if (s.action) {
      const act = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: s.action.label });
      next.className = 'btn quiet';
      next.textContent = last ? '先不要，開始使用' : '先不要';
      act.addEventListener('click', async () => {
        act.disabled = true;
        act.textContent = '等一下…';
        act.setAttribute('aria-busy', 'true');
        const ok = await s.action.run().catch(() => false);
        status.textContent = ok ? s.action.done : typeof s.action.fail === 'function' ? s.action.fail() : s.action.fail;
        status.classList.toggle('fail', !ok);
        act.hidden = true;
        next.className = 'btn';
        next.textContent = last ? '開始使用' : '下一步';
        next.setAttribute('aria-describedby', status.id); // 焦點移到按鈕時一起念出結果（VoiceOver 可能漏掉狀態更新）
        next.focus();
      });
      row.append(act, next);
    } else row.append(next);
    dlg.append(skipBtn, img, dots, h, body, status, row);
    // 第一步焦點在主要按鈕；換步驟時先停在標題，讀屏念出這一步在說什麼
    if (i > 0) h.focus(); else row.firstElementChild.focus();
  };
  document.body.append(dlg);
  dlg.showModal();
  paint();
  return dlg;
}
