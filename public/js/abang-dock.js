// 阿幫常駐（2026-11-21 Austin：「請阿幫跳去看公車動態，整個紀錄都會不見」）：
// 1. 對話保留：問阿幫頁（生活、防詐）只建一次，換頁時把整個畫面先收起來（不重建、不清掉），回來原樣接上（卡片、決策圖、捲動位置都在）。
// 2. 浮動阿幫：其他頁面右下角有藍鵲按鈕，點了從下方拉出同一段對話（背後的頁面還在）；阿幫帶你去別頁時對話收回按鈕，不會不見。
// 3. 提醒與互動：到站、下車、公車一直不來時，浮動阿幫冒出對話泡泡（點了打開對話），同一句也記在對話裡。
// 只存在這次開著的 App／分頁裡（記憶體），不寫到手機或伺服器。

/** @type {Map<string, { root: HTMLElement, api: { show?: Function, say?: Function, focus?: Function }, title: string, scrollY: number }>} */
const alive = new Map();
let current = null; // 目前接在 #main 上的那一個（key）

/**
 * 取得（第一次就建立）保留的頁面。
 * @param {string} key 例：'agent'、'agent/antifraud'
 * @param {(ctx: { root: HTMLElement, setTitle: (t: string) => void }) => any} build 第一次建立時呼叫（頁面的 render），可回傳 { show, say, focus }
 */
export function kept(key, build) {
  let k = alive.get(key);
  if (!k) {
    const root = document.createElement('div');
    root.className = 'kept-page';
    k = { root, api: {}, title: '', scrollY: 0 };
    alive.set(key, k);
    k.api = build({ root, setTitle: (t) => { k.title = t; } }) || {};
  }
  return k;
}
/** 已經建立過的（沒有回 null；不會建立） */
export const keptIf = (key) => alive.get(key) || null;

/** 換頁前：把接在 #main 上的保留頁面收起來（記下捲動位置） */
export function detachMain() {
  if (!current) return;
  const k = alive.get(current);
  if (k?.root.parentNode && !k.root.closest('dialog')) { k.scrollY = window.scrollY; k.root.remove(); }
  current = null;
}

/**
 * 接到 #main（問阿幫頁）：第一次建立，之後原樣接回並回到原本的捲動位置。
 * @returns {{ fresh: boolean, k: object }}
 */
export function attachMain(main, key, build, query) {
  const had = alive.has(key);
  const k = kept(key, build);
  closeSheet({ silent: true }); // 浮動對話開著：收回（同一段對話接到整頁）
  main.append(k.root);
  current = key;
  if (had) {
    requestAnimationFrame(() => window.scrollTo(0, k.scrollY));
    k.api.show?.(query);
  } else window.scrollTo(0, 0);
  return { fresh: !had, k };
}

// ───── 浮動阿幫與底部對話面板 ─────
let fab = null, sheet = null, bubble = null, sheetBody = null, buildLife = null, bubbleTimer = 0;
const onAgentPage = () => /^#\/agent(?:[/?]|$)/.test(location.hash);

/** 打開底部對話（不支援 <dialog> 的舊瀏覽器改到問阿幫頁） */
export function openSheet() {
  hideBubble();
  if (!sheet?.showModal || !buildLife) { location.hash = '#/agent'; return; }
  const k = kept('agent', buildLife);
  sheetBody.append(k.root);
  sheet.showModal();
  sheet.classList.add('open');
  requestAnimationFrame(() => { sheetBody.scrollTop = sheetBody.scrollHeight; k.api.focus?.(); });
}
/** 收起底部對話（對話保留在記憶體） */
export function closeSheet({ silent = false } = {}) {
  if (!sheet?.open) return;
  sheet.classList.remove('open');
  sheet.close();
  keptIf('agent')?.root.remove();
  if (!silent) fab?.focus();
}

function hideBubble() { clearTimeout(bubbleTimer); if (bubble) { bubble.hidden = true; bubble.replaceChildren(); } }

/**
 * 阿幫主動說一句（提醒）：記在對話裡；不在問阿幫頁時浮動阿幫冒泡泡。
 * @param {string} text
 * @param {{ label?: string, ask?: string }} [action] 例：公車一直不來 →「改其他方式」（打開對話並問阿幫）
 */
export function abangSays(text, action = null) {
  keptIf('agent')?.api.say?.(text, action);
  if (onAgentPage() || sheet?.open || !fab || fab.hidden) return false;
  clearTimeout(bubbleTimer);
  bubble.replaceChildren();
  const p = document.createElement('p');
  p.textContent = text;
  bubble.append(p);
  const row = document.createElement('div');
  row.className = 'fab-bubble-acts';
  if (action?.ask) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: action.label || '問阿幫' });
    b.addEventListener('click', () => { openSheet(); keptIf('agent')?.api.ask?.(action.ask); });
    row.append(b);
  }
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: '知道了' });
  close.addEventListener('click', hideBubble);
  row.append(close);
  bubble.append(row);
  bubble.hidden = false;
  fab.classList.remove('nudge'); void fab.offsetWidth; fab.classList.add('nudge'); // 藍鵲跳一下
  bubbleTimer = setTimeout(hideBubble, 12000);
  return true;
}

/** 換頁時：問阿幫頁不顯示浮動按鈕；面板開著就收起來（阿幫帶你去別頁） */
export function syncFab() {
  if (!fab) return;
  if (sheet?.open) closeSheet({ silent: true });
  fab.hidden = onAgentPage();
  if (fab.hidden) hideBubble();
  fab.classList.toggle('has-chat', !!keptIf('agent')?.api.hasChat?.());
  fab.setAttribute('aria-label', fab.classList.contains('has-chat') ? '打開跟阿幫的對話（對話還在）' : '問阿幫');
}

/**
 * 掛上浮動阿幫（app.js 外殼）。
 * @param {{ buildLife: (ctx: { root: HTMLElement, setTitle: Function }) => any }} o 生活 agent 的建立方式（與問阿幫頁同一個）
 */
export function mountFab(o) {
  buildLife = o.buildLife;
  fab = document.getElementById('abang-fab');
  bubble = document.getElementById('abang-bubble');
  sheet = document.getElementById('abang-sheet');
  sheetBody = sheet?.querySelector('.sheet-body');
  fab.addEventListener('click', openSheet);
  sheet?.querySelector('.sheet-close')?.addEventListener('click', () => closeSheet());
  sheet?.querySelector('.sheet-full')?.addEventListener('click', () => { location.hash = '#/agent'; });
  sheet?.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); }); // Esc、Android 返回
  sheet?.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // 點背景收起
  syncFab();
}
