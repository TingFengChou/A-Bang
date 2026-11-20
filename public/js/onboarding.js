// 首次使用引導（2026-11-21，PLAN「體驗與品質補強」）：第一次打開首頁時，三步說明阿幫怎麼用，並在這裡要定位與通知權限。
// 權限在使用者看得懂為什麼之後才要（按了按鈕才跳系統對話框）；每一步都可以略過，之後在「設定與隱私」可以再看一次。
// <dialog> 原生：焦點留在對話框內、Esc 關閉；文字一律 textContent。
import { browserLocation } from './agent/client.js';
import { ensureNotifyPermission, hasNativeNotify } from './native-notify.js';

const KEY = 'abang.onboarded';

/** 看過了嗎（無痕模式讀不到就當看過，不要每次都跳） */
export function onboarded() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}
function markDone() {
  try { localStorage.setItem(KEY, '1'); } catch { /* 無痕模式 */ }
}

/** 網頁版通知：瀏覽器的通知權限（網頁開著時才會跳） */
async function webNotify() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

const STEPS = [
  {
    img: '/brand/abang-happy.svg',
    title: '嗨，我是阿幫',
    body: ['我用政府開放資料回答交通和生活問題：公車到哪了、怎麼去比較快、要不要帶傘、附近藥局。', '直接打字問我就好，例如「去台北101」「307 到哪了」。'],
  },
  {
    img: '/brand/abang-think.svg',
    title: '用你現在的位置當起點',
    body: ['問「怎麼去」「附近 YouBike」時，我會用你現在的位置。位置只用來回答問題，不會保存。', '不給也能用，只是要自己說從哪出發。'],
    action: { label: '允許定位', done: '已允許定位', fail: '沒拿到位置，之後可到手機設定打開', run: async () => Boolean(await browserLocation(8000)) },
  },
  {
    img: '/brand/abang-happy.svg',
    title: '公車快到時提醒你',
    body: () => [hasNativeNotify() ? '選好公車後，我可以在車快到站前提醒你，App 關著也會響。' : '選好公車後，我可以在車快到站前提醒你（網頁版要開著這個頁面）。', '比較方案時，點決策圖上的其他方案就能改選。'],
    action: { label: '允許通知', done: '已允許通知', fail: '沒有開通知，提醒只會在畫面上顯示', run: async () => (hasNativeNotify() ? ensureNotifyPermission() : webNotify()) },
  },
];

/**
 * 顯示引導（看過就不再顯示，除非 force）。
 * @param {{ force?: boolean, onClose?: () => void }} [opts]
 * @returns {HTMLDialogElement|null}
 */
export function showOnboarding({ force = false, onClose } = {}) {
  if (!force && onboarded()) return null;
  const dlg = document.createElement('dialog');
  dlg.className = 'onboard';
  dlg.setAttribute('aria-labelledby', 'onboard-title');
  let i = 0;
  const close = () => { markDone(); dlg.close(); };
  dlg.addEventListener('close', () => { markDone(); dlg.remove(); onClose?.(); });

  const paint = () => {
    const s = STEPS[i];
    dlg.replaceChildren();
    const img = Object.assign(document.createElement('img'), { src: s.img, alt: '', className: 'onboard-img', width: 96, height: 96 });
    const h = Object.assign(document.createElement('h2'), { id: 'onboard-title', textContent: s.title });
    const dots = document.createElement('p');
    dots.className = 'onboard-step';
    dots.textContent = `第 ${i + 1} 步，共 ${STEPS.length} 步`;
    const body = (typeof s.body === 'function' ? s.body() : s.body).map((t) => Object.assign(document.createElement('p'), { textContent: t }));
    const status = document.createElement('p');
    status.className = 'onboard-status';
    status.setAttribute('role', 'status');
    const row = document.createElement('div');
    row.className = 'onboard-actions';
    const last = i === STEPS.length - 1;
    const next = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: last ? '開始使用' : '下一步' });
    next.addEventListener('click', () => { if (last) close(); else { i += 1; paint(); } });
    if (s.action) {
      const act = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: s.action.label });
      next.className = 'btn quiet';
      next.textContent = last ? '先不要，開始使用' : '先不要';
      act.addEventListener('click', async () => {
        act.disabled = true;
        act.setAttribute('aria-busy', 'true');
        const ok = await s.action.run().catch(() => false);
        act.removeAttribute('aria-busy');
        status.textContent = ok ? s.action.done : s.action.fail;
        act.hidden = true;
        next.className = 'btn';
        next.textContent = last ? '開始使用' : '下一步';
        next.focus();
      });
      row.append(act, next);
    } else row.append(next);
    const skip = Object.assign(document.createElement('button'), { type: 'button', className: 'onboard-skip', textContent: '略過' });
    skip.setAttribute('aria-label', '略過使用說明');
    skip.addEventListener('click', close);
    dlg.append(skip, img, dots, h, ...body, status, row);
    (row.firstElementChild || next).focus();
  };
  document.body.append(dlg);
  paint();
  dlg.showModal();
  (dlg.querySelector('.onboard-actions .btn') || dlg).focus();
  return dlg;
}
