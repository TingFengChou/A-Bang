// 阿幫常駐（2026-11-21 Austin：「請阿幫跳去看公車動態，整個紀錄都會不見」）：
// 1. 對話保留：問阿幫頁（生活、防詐）只建一次，換頁時把整個畫面先收起來（不重建、不清掉），回來原樣接上（卡片、決策圖、捲動位置都在）。
// 2. 中央「問阿幫」鍵（2026-11-21 首頁與導覽重新設計：取代原本右下角的浮動阿幫，不再兩個並存）：在分頁列正中間，
//    其他頁面點了從下方拉出同一段對話（背後的頁面還在、知道你在哪一頁）；在問阿幫頁點了回到輸入框。阿幫帶你去別頁時對話收回，不會不見。
// 3. 提醒與互動：到站、下車、公車一直不來時，中央鍵上方冒出對話泡泡（點了打開對話），同一句也記在對話裡；看不到對話時鍵上亮「有話跟你說」的點。
// 元素 id 沿用 abang-fab（中央鍵）、abang-bubble、abang-sheet。
// 只存在這次開著的 App／分頁裡（記憶體），不寫到手機或伺服器。

import { shellT, currentShellLang } from './shell-i18n.js';
import { voiceSupport, voiceEnabled, voiceInfoNow } from './voice.js';

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
  if (k?.root.parentNode && !k.root.closest('dialog')) { k.api.voiceCancel?.(); k.scrollY = window.scrollY; k.root.remove(); } // 換頁：不在背後開著麥克風
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

// ───── 中央「問阿幫」鍵與底部對話面板 ─────
let fab = null, sheet = null, bubble = null, live = null, sheetBody = null, buildLife = null, pageAsk = null, bubbleTimer = 0, quiet = false, unread = false;
const onLifePage = () => /^#\/agent(?:\?|$)/.test(location.hash);
const kbOpen = () => document.documentElement.classList.contains('kb-open');

/** 打開底部對話（不支援 <dialog> 的舊瀏覽器改到問阿幫頁） */
export function openSheet() {
  hideBubble();
  unread = false;
  if (!sheet?.showModal || !buildLife) { location.hash = '#/agent'; return; }
  const k = kept('agent', buildLife);
  k.api.setPage?.(pageAsk?.() || null); // 你在看哪一頁：建議問題＋說明（跟下一個問題一起送出）
  sheetBody.append(k.root);
  sheet.showModal();
  sheet.classList.add('open');
  // 手機不自動聚焦：鍵盤會跳出來蓋住半個對話，第一次按返回只會收鍵盤（與問阿幫頁相同）
  requestAnimationFrame(() => { sheetBody.scrollTop = sheetBody.scrollHeight; if (!matchMedia('(pointer: coarse)').matches) k.api.focus?.(); });
}
/** 收起底部對話（對話保留在記憶體）；收尾在 close 事件（Android 返回鍵直接 close() 也一樣） */
export function closeSheet({ silent = false } = {}) {
  if (!sheet?.open) return;
  quiet = silent;
  sheet.close();
}
function onSheetClosed() {
  sheet.classList.remove('open');
  const k = keptIf('agent');
  k?.api.voiceCancel?.(); // 收起對話：不在背後開著麥克風
  const root = k?.root;
  if (root?.parentNode === sheetBody) root.remove(); // 已經接到整頁的不動
  if (!quiet) fab?.focus();
  quiet = false;
  syncDot();
}
/** 中央鍵的小點與讀屏標籤（外殼語言跟著目前頁面，shell-i18n.js）：有對話＝小點；阿幫說了話你還沒看＝暖色點 */
export function syncFabLabel() {
  if (!fab) return;
  const has = !!keptIf('agent')?.api.hasChat?.();
  fab.classList.toggle('has-chat', has);
  fab.classList.toggle('unread', unread);
  fab.setAttribute('aria-label', shellT(currentShellLang())(unread ? 'fabUnread' : has ? 'fabChat' : 'fab'));
  fab.setAttribute('aria-haspopup', onLifePage() ? 'false' : 'dialog'); // 問阿幫頁：回到輸入框，不開面板
  if (currentShellLang() === 'en' && document.documentElement.lang !== 'en') fab.setAttribute('lang', 'en'); else fab.removeAttribute('lang');
}
const syncDot = syncFabLabel;

function hideBubble() { clearTimeout(bubbleTimer); if (bubble) { bubble.hidden = true; bubble.replaceChildren(); } }
/** 泡泡自動收起（手指或焦點在泡泡上時不收，WCAG 2.2.1） */
const armHide = () => { clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, 12000); };

/**
 * 阿幫主動說一句（提醒）：記在對話裡；不在問阿幫頁時浮動阿幫冒泡泡。
 * @param {string} text
 * @param {{ label?: string, ask?: string }} [action] 例：公車一直不來 →「改其他方式」（打開對話並問阿幫）
 */
export function abangSays(text, action = null) {
  const api = keptIf('agent')?.api;
  if (api?.say) { api.say(text, action); if (onLifePage() || sheet?.open) return true; } // 對話看得到：說在對話裡就好
  if (!fab) return false;
  unread = true; // 對話裡多了一句你還沒看到的（鍵盤開著改用提示時也亮，鍵盤收起就看得到）
  syncDot();
  if (kbOpen()) return false; // 打字中（鍵盤開著，分頁列收起）：交給提示
  clearTimeout(bubbleTimer);
  bubble.replaceChildren();
  const t = shellT(/[一-鿿]/.test(String(text)) ? null : currentShellLang()); // 提醒本文是中文就整個泡泡用中文（不混「Abang: 中文」）
  const p = document.createElement('p');
  p.textContent = text;
  bubble.append(p);
  const row = document.createElement('div');
  row.className = 'fab-bubble-acts';
  if (action?.ask) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: action.label || t('bubbleAsk') });
    b.addEventListener('click', () => { openSheet(); const api = keptIf('agent')?.api; api?.setPage?.(null); api?.ask?.(action.ask); }); // 提醒的問題跟現在這一頁無關：不帶頁面
    row.append(b);
  }
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: t('bubbleOk') });
  close.addEventListener('click', hideBubble);
  row.append(close);
  bubble.append(row);
  bubble.hidden = false;
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = t('liveSays', { text }); }, 50); } // 讀屏：常駐的即時區域只放文字
  fab.classList.remove('nudge'); void fab.offsetWidth; fab.classList.add('nudge'); // 藍鵲跳一下
  armHide();
  return true;
}

// 設定頁清除本機資料：開著的問阿幫對話也清掉
addEventListener('abang:clear-local', () => { keptIf('agent')?.api.clear?.(); syncDot(); });

/** 換頁時：面板開著就收起來（阿幫帶你去別頁）；到問阿幫頁＝看到對話了（清掉未讀、收泡泡） */
export function syncFab() {
  if (!fab) return;
  if (sheet?.open) closeSheet({ silent: true });
  if (onLifePage()) { unread = false; hideBubble(); }
  syncDot();
}

/** 點中央鍵：問阿幫頁回到輸入框（捲到最新）；其他頁拉出底部對話 */
function onKey() {
  if (held) { held = false; return; } // 剛剛是長按（用說的），不是點
  if (onLifePage()) {
    const k = keptIf('agent');
    window.scrollTo({ top: document.documentElement.scrollHeight });
    k?.api.focus?.();
    return;
  }
  openSheet();
}

// 長按中央鍵直接用說的（M14-01，放開送出）；短按照舊。長按對讀屏、鍵盤、切換控制不友善：
// 一樣的功能在輸入列的麥克風鍵（有可及名稱），長按只是捷徑。語音能用（voice.js）而且設定開著才有。
const HOLD_MS = 450;
let holdTimer = 0, held = false, holding = false;
const voiceOk = () => voiceInfoNow()?.state === 'ready'; // 手機上辨識能用（語言包下載好後也會變）
function onFabDown(e) {
  if (!voiceOk() || !voiceEnabled() || e.button !== 0 || !e.isPrimary) return;
  held = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    held = true; holding = true;
    if (!onLifePage()) openSheet();
    keptIf('agent')?.api.voiceHold?.();
  }, HOLD_MS);
  // 對話面板打開後中央鍵在背後（inert），放開的事件不一定送到它：在 window 上接
  addEventListener('pointerup', onFabUp, true);
  addEventListener('pointercancel', onFabUp, true);
}
function onFabUp() {
  removeEventListener('pointerup', onFabUp, true);
  removeEventListener('pointercancel', onFabUp, true);
  clearTimeout(holdTimer);
  if (holding) { holding = false; keptIf('agent')?.api.voiceRelease?.(); }
  setTimeout(() => { held = false; }, 400); // 放開後的 click 不算點；沒有 click 時也不擋下一次
}

/**
 * 掛上中央「問阿幫」鍵（app.js 外殼）。
 * @param {{ buildLife: (ctx: { root: HTMLElement, setTitle: Function }) => any, pageAsk?: () => ({ context?: string, chips?: string[] }|null) }} o 生活 agent 的建立方式（與問阿幫頁同一個）；pageAsk：現在這一頁可以問什麼
 */
export function mountFab(o) {
  buildLife = o.buildLife;
  pageAsk = o.pageAsk || null;
  fab = document.getElementById('abang-fab');
  bubble = document.getElementById('abang-bubble');
  live = document.getElementById('abang-live');
  bubble.addEventListener('pointerenter', () => clearTimeout(bubbleTimer));
  bubble.addEventListener('pointerleave', armHide);
  bubble.addEventListener('focusin', () => clearTimeout(bubbleTimer));
  bubble.addEventListener('focusout', armHide);
  sheet = document.getElementById('abang-sheet');
  sheetBody = sheet?.querySelector('.sheet-body');
  fab.addEventListener('click', onKey);
  fab.addEventListener('pointerdown', onFabDown);
  fab.addEventListener('contextmenu', (e) => { if (voiceOk() && voiceEnabled()) e.preventDefault(); }); // 長按不跳系統選單
  voiceSupport().catch(() => {}); // 先問一次（長按時要同步知道能不能用）
  sheet?.querySelector('.sheet-close')?.addEventListener('click', () => closeSheet());
  sheet?.querySelector('.sheet-full')?.addEventListener('click', () => { const k = keptIf('agent'); if (k) k.scrollY = 1e9; location.hash = '#/agent'; }); // 整頁：停在最新的對話
  sheet?.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); }); // Esc
  sheet?.addEventListener('close', onSheetClosed); // Esc、按鈕、點背景、Android 返回鍵（app.js 直接 close()）
  sheet?.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // 點背景收起
  syncFab();
}
