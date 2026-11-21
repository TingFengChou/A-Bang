// 阿幫會看（M14-02，ADR-0015，UX.md §5.0.4）：拍照或選截圖 → 在手機上讀字與條碼 → 「阿幫看到了：…」→ 使用者確認後才交給既有流程。
//   可疑訊息：防詐 agent（scam_check_message，就像貼上文字）；生活頁先問「要幫你檢查這則訊息是不是詐騙嗎？」才轉到防詐頁。
//   站牌、路牌：組成問題（「307 公車到「敦化市場」還要多久？」）讓使用者改或補完再送。
//   發票：QR code 用 parseInvoiceCode（讀不到 QR 時從字找字軌號碼），存進「我的發票」並馬上對獎（invoice_check_batch，與發票頁相同）。
// 照片不上傳：App 用原生外掛 AbangVision（Android ML Kit、iOS Vision）；網頁版只用瀏覽器內建的 TextDetector／BarcodeDetector，
// 沒有就不提供（不把照片送伺服器）。分類與組問題的規則在 core/vision-text.js（純函式，伺服器以 /core/vision-text.js 提供）。
// 讀出來的字是使用者手機上的內容：一律用 textContent 顯示（不用 innerHTML），可能含個資，送出前提醒並可遮起來。
import { classifyText, normText } from '../../core/vision-text.js';
import { parseInvoiceCode } from './invoice-qr.js';
import { wallet, checkWallet, todayTW } from './invoice-wallet.js';
import { maskPrivate } from './chat-store.js';
import { confetti } from '../ui/cards/confetti.js';

const PLUGIN = 'AbangVision';
export const VISION_KEY = 'abang.vision';
/** 問阿幫一次最多送這麼多字（agent.js send 也是 500） */
export const VISION_MAX = 500;

const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' && (c.isPluginAvailable ? c.isPluginAvailable(PLUGIN) : true) ? c : null; } catch { return null; }
};
/** App 裡有原生的「看」（同步判斷，給發票頁決定要不要換成原生相機） */
export const nativeVisionReady = () => Boolean(cap());

/** 設定頁「讓阿幫看照片」：讀不到就當開著 */
export function visionEnabled() {
  try { return globalThis.localStorage?.getItem(VISION_KEY) !== 'off'; } catch { return true; }
}
export function setVisionEnabled(on) {
  try { if (on) globalThis.localStorage.removeItem(VISION_KEY); else globalThis.localStorage.setItem(VISION_KEY, 'off'); } catch { return false; }
  globalThis.dispatchEvent?.(new CustomEvent('abang:vision-setting'));
  return true;
}

// ───── 能力 ─────
const ENGINES = ['mlkit-text-chinese', 'mlkit-barcode', 'apple-vision'];
const DESCRIBE_STATES = ['supported', 'unsupported', 'untested'];
/**
 * 外掛回報 → 畫面要的樣子。只收認得的值（查不到就沒有那一項，不補預設、不編造）。
 * @returns {{ where: 'app'|'web', text: boolean, barcode: boolean, camera: boolean, photos: boolean, textEngine?: string, barcodeEngine?: string, describe?: { engine: string, state: string }, cameraPermission?: string }}
 */
export function normalizeVisionInfo(raw, where = 'app') {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { where, text: r.text?.available === true, barcode: r.barcode?.available === true, camera: r.camera === true, photos: r.photos === true };
  if (ENGINES.includes(r.text?.engine) && out.text) out.textEngine = r.text.engine;
  if (ENGINES.includes(r.barcode?.engine) && out.barcode) out.barcodeEngine = r.barcode.engine;
  if (r.describe?.engine === 'gemini-nano' && DESCRIBE_STATES.includes(r.describe.state)) out.describe = { engine: 'gemini-nano', state: r.describe.state };
  if (['granted', 'denied', 'prompt'].includes(r.cameraPermission)) out.cameraPermission = r.cameraPermission;
  return out;
}

/** 網頁版：只有瀏覽器內建的本機辨識（Shape Detection API）才提供；照片不送伺服器 */
function webVision() {
  const text = typeof globalThis.TextDetector === 'function';
  const barcode = typeof globalThis.BarcodeDetector === 'function';
  return { where: 'web', text, barcode, camera: text || barcode, photos: text || barcode, ...(text && { textEngine: 'browser' }), ...(barcode && { barcodeEngine: 'browser' }) };
}

/** 現在能看什麼（App：外掛；網頁：瀏覽器） */
export async function visionStatus() {
  const c = cap();
  if (c) { try { return normalizeVisionInfo(await c.nativePromise(PLUGIN, 'available', {})); } catch { /* 舊版 App：改看網頁能力 */ } }
  return webVision();
}

// ───── 取得影像並讀字（照片不離開手機）─────
const ERR_CODES = ['cancelled', 'denied', 'unavailable', 'failed', 'busy', 'unsupported'];
const fail = (code, msg = code) => Object.assign(new Error(msg), { code: ERR_CODES.includes(code) ? code : 'failed' });

/** 原生外掛回傳 → { text, lines, blocks, barcodes, describe?, engine, ms } */
export function normalizeReading(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const t = r.text && typeof r.text === 'object' ? r.text : {};
  const okBox = (b) => (b && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(b[k])) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null);
  const lines = (Array.isArray(t.lines) ? t.lines : []).filter((l) => typeof l?.text === 'string' && l.text.trim()).slice(0, 200).map((l) => ({ text: l.text.slice(0, 300), box: okBox(l.box) }));
  const blocks = (Array.isArray(t.blocks) ? t.blocks : []).filter((b) => typeof b?.text === 'string' && b.text.trim()).slice(0, 100).map((b) => ({ text: b.text.slice(0, 2000), box: okBox(b.box) }));
  const text = (typeof t.full === 'string' && t.full.trim() ? t.full : lines.map((l) => l.text).join('\n')).slice(0, 4000);
  const barcodes = (Array.isArray(r.barcodes) ? r.barcodes : []).filter((b) => typeof b?.raw === 'string' && b.raw).slice(0, 10).map((b) => ({ format: String(b.format || ''), raw: b.raw.slice(0, 1000) }));
  const kind = r.describe?.kind;
  return { text, lines, blocks, barcodes, ...(['sms', 'sign', 'invoice', 'other'].includes(kind) && { describe: { engine: 'gemini-nano', kind } }), engine: typeof r.engine === 'string' ? r.engine : '', ms: Number.isFinite(r.ms) ? r.ms : null };
}

/** 網頁版：選檔（camera 時帶 capture，手機瀏覽器會開相機）→ 瀏覽器內建辨識 */
function webCapture(source, want) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    if (source === 'camera') input.setAttribute('capture', 'environment');
    input.hidden = true;
    document.body.append(input);
    const done = () => input.remove();
    input.addEventListener('cancel', () => { done(); reject(fail('cancelled')); });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      done();
      if (!file) { reject(fail('cancelled')); return; }
      try {
        const bmp = await createImageBitmap(file);
        const W = bmp.width || 1, H = bmp.height || 1;
        const lines = [];
        const barcodes = [];
        if (want.includes('text') && typeof globalThis.TextDetector === 'function') {
          for (const d of await new globalThis.TextDetector().detect(bmp)) {
            const b = d.boundingBox;
            if (d.rawValue) lines.push({ text: d.rawValue, box: b ? { x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H } : null });
          }
        }
        if (want.includes('barcode') && typeof globalThis.BarcodeDetector === 'function') {
          for (const d of await new globalThis.BarcodeDetector({ formats: ['qr_code', 'code_39'] }).detect(bmp)) barcodes.push({ format: d.format, raw: d.rawValue });
        }
        bmp.close?.();
        resolve(normalizeReading({ text: { lines }, barcodes, engine: 'browser' }));
      } catch { reject(fail('failed')); }
    });
    input.click();
  });
}

/**
 * 拍照或選圖，在手機上讀字與條碼。
 * @param {'camera'|'photos'} source
 * @param {{ want?: string[], onReading?: () => void, literal?: boolean }} [o] onReading：相機或選擇器關了、開始讀（「阿幫在看」動畫從這裡開始）；literal：照原樣讀（發票）
 * @returns {Promise<ReturnType<typeof normalizeReading>>} 失敗丟 Error，code：cancelled／denied／unavailable／failed／busy
 */
export async function captureAndRead(source, { want = ['text', 'barcode'], onReading = () => {}, literal = false } = {}) {
  const c = cap();
  if (!c) return webCapture(source, want).then((r) => { onReading(); return r; });
  let handle = null;
  try { handle = c.addListener?.(PLUGIN, 'stage', (e) => { if (e?.stage === 'reading') onReading(); }); } catch { /* 舊版：沒有進度 */ }
  try {
    return normalizeReading(await c.nativePromise(PLUGIN, 'capture', { source, want, ...(literal && { literal: true }) })); // literal：發票不做語言校正（iOS）
  } catch (e) {
    throw fail(e?.code || (/denied|權限/.test(e?.message || '') ? 'denied' : /cancel|沒有(拍照|選)/.test(e?.message || '') ? 'cancelled' : 'failed'));
  } finally {
    Promise.resolve(handle).then((h) => h?.remove?.()).catch(() => {});
  }
}

// ───── 讀到的是什麼 ─────
/**
 * 讀出來的東西 → 要做什麼。條碼先看（發票左邊 QR），再看字（core/vision-text.js）。
 * @param {ReturnType<typeof normalizeReading>} reading
 * @param {{ profile?: string, only?: 'invoice'|null }} [o] only：發票頁的掃描只認發票
 * @returns {{ kind: 'invoice'|'invoice-right'|'scam'|'sign'|'text'|'empty', text: string, invoice?: object, sign?: object, signals?: string[], from?: 'qr'|'text' }}
 */
export function interpret(reading, { profile = 'life', only = null } = {}) {
  const codes = (reading?.barcodes || []).map((b) => parseInvoiceCode(b.raw)).filter(Boolean);
  const left = codes.find((c) => !c.side);
  const text = String(reading?.text || '').trim();
  if (left && profile !== 'antifraud') return { kind: 'invoice', text, invoice: left, from: 'qr' };
  const c = classifyText({ text, lines: reading?.lines }, { profile, hint: reading?.describe?.kind || null });
  if (only === 'invoice') {
    if (c.kind === 'invoice' || c.invoice) return { kind: 'invoice', text: c.text, invoice: c.invoice, from: 'text' };
    return { kind: codes.some((x) => x.side === 'right') ? 'invoice-right' : 'empty', text: c.text || '' };
  }
  if (c.kind === 'invoice') return { ...c, from: 'text' };
  if (codes.some((x) => x.side === 'right') && (c.kind === 'text' || c.kind === 'empty')) return { kind: 'invoice-right', text: c.text || '' };
  return c;
}

// ───── 個資 ─────
const ACCOUNT = /((?:帳號|帳戶|戶號|account)\s*[:：]?\s*)([\d-]{8,20})/gi;
/** 讀出來的字裡像個資的號碼種類（電話、身分證、卡號、帳號） */
export function privateKinds(text) {
  const s = normText(text);
  const out = [];
  if (/(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/.test(s)) out.push('phone');
  if (/(?<![A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)/.test(s)) out.push('id');
  if (/(?<!\d)\d{4}(?:[-\s]?\d{4}){2,3}(?!\d)/.test(s)) out.push('card');
  if (new RegExp(ACCOUNT.source, 'i').test(s)) out.push('account');
  return out;
}
/** 遮起來：手機、身分證、卡號（chat-store 的 maskPrivate）＋帳號 */
export const maskReading = (text) => maskPrivate(String(text)).replace(ACCOUNT, (_, k, n) => `${k}${'●'.repeat(Math.min(n.length, 12))}`);

// ───── 轉到防詐頁（記憶體，不放網址）─────
let handoff = null;
/** 交過去的文字只在這段時間內有效：切頁失敗時，不會在之後某次打開防詐頁才自動送出（已不是確認當下） */
export const HANDOFF_TTL_MS = 30_000;
/** 生活頁確認「要檢查」後：把文字交給防詐頁（只在記憶體；不放網址、不存） */
export function handOff(agentId, text, now = Date.now()) { handoff = { agentId, text: String(text).slice(0, VISION_MAX), at: now }; }
/** 防詐頁打開時取走（只取一次；超過 30 秒丟掉） */
export function takeHandoff(agentId, now = Date.now()) {
  if (!handoff || handoff.agentId !== agentId) return null;
  const { text, at } = handoff;
  handoff = null;
  return now - at <= HANDOFF_TTL_MS && now >= at ? text : null;
}

// ───── 文字（中英）─────
export const VZH = {
  'title.life': '讓阿幫看', 'title.antifraud': '拍可疑訊息', 'title.invoice': '拍發票',
  'camera.life': '拍照', 'camera.antifraud': '拍可疑訊息', 'camera.invoice': '拍發票 QR code',
  'photos.life': '選截圖或照片', 'photos.antifraud': '選截圖', 'photos.invoice': '選發票照片',
  'hint.life': '拍可疑簡訊、站牌路牌或發票：阿幫在手機上讀出上面的字，你確認後才送出。',
  'hint.antifraud': '拍下或選一張可疑訊息的截圖：阿幫在手機上讀出文字，你確認後再檢查。',
  'hint.invoice': '對準發票左邊的 QR code 拍一張；阿幫在手機上讀出號碼和日期。',
  'privacy': '照片只在手機上讀字，不上傳、不保存。選截圖用系統的相片選擇器，阿幫看不到整個相簿。',
  'web.noText': '這個瀏覽器不能在本機讀字；讀簡訊、站牌請用阿幫手機 App（照片不會上傳）。',
  'web.invoiceOnly': '網頁版只能讀發票的 QR code。',
  'cancel': '取消', 'close': '關閉', 'retry': '再試一次',
  'open.camera': '開啟相機…', 'open.photos': '開啟相片…',
  'looking': '阿幫在看…', 'lookingSub': '在手機上讀字，照片不會離開手機',
  'saw': '阿幫看到了', 'empty': '沒看到字。換個角度、靠近一點，或選清楚一點的截圖再試一次。',
  'scam.ask': '這看起來像一則訊息。要幫你檢查這則訊息是不是詐騙嗎？',
  'scam.yes': '要，幫我檢查', 'scam.check': '檢查是不是詐騙', 'scam.no': '不用',
  'scam.edit': '可以先刪掉不想送出的部分（例如你的名字），送出的只有這些字。',
  'private.found': '裡面有像{what}的號碼，送出前可以先遮起來。', 'private.mask': '遮住號碼', 'private.unmask': '顯示原文',
  'what.phone': '手機', 'what.id': '身分證', 'what.card': '卡號', 'what.account': '帳號', 'sep': '、',
  'sign.stop': '站名「{v}」', 'sign.routes': '公車 {v}', 'sign.roads': '路名 {v}', 'sign.toward': '往 {v}',
  'sign.lead': '要問阿幫這個嗎？可以先改：', 'sign.more': '補上要去哪裡再送出。', 'sign.label': '要問的問題',
  'send': '送出', 'text.lead': '沒認出是簡訊、站牌或發票。要把這些字放進輸入框，自己改成問題嗎？', 'text.use': '放進輸入框',
  'invoice.saw': '發票 {track}-{number}', 'invoice.when.date': '消費 {v}', 'invoice.when.period': '{v} 期',
  'invoice.save': '存起來並對獎', 'invoice.needDate': '沒讀到消費日期，請選一下：', 'invoice.date': '消費日期',
  'invoice.right': '這是發票右邊的明細 QR code，請拍左邊那個。',
  'invoice.won': '🎉 中獎了！{prize}・{amount} 元', 'invoice.lost': '這張沒中。', 'invoice.pending': '{date} 開獎，開獎後打開阿幫會自動對獎。',
  'invoice.unavailable': '這張超過可以查的期別。', 'invoice.waiting': '待對獎', 'invoice.checking': '存好了，對獎中…', 'invoice.saved': '已存進「我的發票」。',
  'invoice.open': '看我的發票', 'invoice.fail': '對獎失敗：{msg}（號碼已存，下次打開會再對）',
  'err.denied': '沒有相機權限。到手機設定允許「相機」後再試，或改用「選截圖」。', 'err.openSettings': '到設定開啟',
  'err.unavailable': '現在不能用相機，可以改用「選截圖」。', 'err.failed': '這次沒讀到，請再試一次。', 'err.busy': '上一張還在讀，請稍等。',
  'btn.life': '讓阿幫看：拍照或選截圖', 'btn.antifraud': '拍可疑訊息或選截圖',
  'truncated': '文字很長，只送前 {n} 字。',
};
export const VEN = {
  'title.life': 'Show Abang', 'title.antifraud': 'Snap a suspicious message', 'title.invoice': 'Snap a receipt',
  'camera.life': 'Take a photo', 'camera.antifraud': 'Snap the message', 'camera.invoice': 'Snap the QR code',
  'photos.life': 'Choose a screenshot or photo', 'photos.antifraud': 'Choose a screenshot', 'photos.invoice': 'Choose a receipt photo',
  'hint.life': 'Snap a suspicious text, a bus stop or street sign, or a receipt. Abang reads it on your phone and sends nothing until you confirm.',
  'hint.antifraud': 'Snap or choose a screenshot of the message. Abang reads it on your phone; you confirm before it is checked.',
  'hint.invoice': "Snap the QR code on the receipt's left side. Abang reads the number and date on your phone.",
  'privacy': "Photos are read on your phone only: never uploaded or kept. Screenshots come through the system picker, so Abang can't see your whole library.",
  'web.noText': "This browser can't read text on the device. Use the Abang app to read messages and signs (photos are never uploaded).",
  'web.invoiceOnly': 'On the web, Abang can only read receipt QR codes.',
  'cancel': 'Cancel', 'close': 'Close', 'retry': 'Try again',
  'open.camera': 'Opening the camera…', 'open.photos': 'Opening photos…',
  'looking': 'Abang is looking…', 'lookingSub': 'Reading on your phone; the photo never leaves it',
  'saw': 'Abang saw', 'empty': 'No text found. Try another angle, get closer, or pick a clearer screenshot.',
  'scam.ask': 'This looks like a message. Check whether it is a scam?',
  'scam.yes': 'Yes, check it', 'scam.check': 'Check for scams', 'scam.no': 'No thanks',
  'scam.edit': 'You can delete anything you do not want to send (like your name). Only this text is sent.',
  'private.found': 'It contains what looks like {what}. You can hide it before sending.', 'private.mask': 'Hide numbers', 'private.unmask': 'Show original',
  'what.phone': 'a phone number', 'what.id': 'an ID number', 'what.card': 'a card number', 'what.account': 'an account number', 'sep': ', ',
  'sign.stop': 'Stop: {v}', 'sign.routes': 'Bus {v}', 'sign.roads': 'Road: {v}', 'sign.toward': 'Toward {v}',
  'sign.lead': 'Ask Abang this? You can edit it first:', 'sign.more': 'Add where you want to go, then send.', 'sign.label': 'Your question',
  'send': 'Send', 'text.lead': "Abang didn't recognize a message, sign or receipt. Put the text in the box and turn it into a question?", 'text.use': 'Put in the box',
  'invoice.saw': 'Receipt {track}-{number}', 'invoice.when.date': 'bought {v}', 'invoice.when.period': 'period {v}',
  'invoice.save': 'Save and check', 'invoice.needDate': 'No purchase date found. Pick one:', 'invoice.date': 'Purchase date',
  'invoice.right': "That's the item QR code on the right. Snap the left one.",
  'invoice.won': '🎉 You won! {prize}, NT${amount}', 'invoice.lost': 'No prize this time.', 'invoice.pending': 'The draw is on {date}. Abang checks it automatically after that.',
  'invoice.unavailable': 'This period can no longer be checked.', 'invoice.waiting': 'Waiting to check', 'invoice.checking': 'Saved. Checking…', 'invoice.saved': 'Saved to My receipts.',
  'invoice.open': 'My receipts', 'invoice.fail': "Couldn't check: {msg} (saved; Abang will try again next time)",
  'err.denied': 'Camera access is off. Allow Camera in Settings and try again, or choose a screenshot.', 'err.openSettings': 'Open Settings',
  'err.unavailable': "The camera isn't available right now. Choose a screenshot instead.", 'err.failed': "Couldn't read it. Please try again.", 'err.busy': 'Still reading the last one. One moment.',
  'btn.life': 'Show Abang: take a photo or choose a screenshot', 'btn.antifraud': 'Snap a suspicious message or choose a screenshot',
  'truncated': 'The text is long; only the first {n} characters are sent.',
};
/** 字典：英文缺鍵退回中文、缺鍵回傳鍵本身（測試抓得到） */
export const visionT = (lang) => (k, v = {}) => String((lang === 'en' ? VEN[k] ?? VZH[k] : VZH[k]) ?? k).replace(/\{(\w+)\}/g, (_, n) => (v[n] ?? ''));

// ───── 畫面 ─────
const svg = (d, cls = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${d}</svg>`;
export const CAMERA_ICON = svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>');
const PHOTO_ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>');
const LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
/** 「阿幫在看」：對準框＋Λ＋琥珀核心＋軌道＋掃描線（常數 SVG，不含外部資料） */
const LOOK_SVG = `<svg viewBox="0 0 132 132" focusable="false" aria-hidden="true"><defs><linearGradient id="vs-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B3B39"/><stop offset=".6" stop-color="#0F766E"/><stop offset="1" stop-color="#14A396"/></linearGradient><linearGradient id="vs-line" x1="0" x2="1"><stop offset="0" stop-color="#FDE68A" stop-opacity="0"/><stop offset=".5" stop-color="#FDE68A"/><stop offset="1" stop-color="#FDE68A" stop-opacity="0"/></linearGradient></defs>
<rect width="132" height="132" rx="34" fill="url(#vs-bg)"/>
<path d="M18 36V22a4 4 0 0 1 4-4h14M96 18h14a4 4 0 0 1 4 4v14M114 96v14a4 4 0 0 1-4 4H96M36 114H22a4 4 0 0 1-4-4V96" fill="none" stroke="#CCFBF1" stroke-width="3.5" stroke-linecap="round"/>
<circle cx="66" cy="64" r="36" fill="none" stroke="#99F6E4" stroke-opacity=".3" stroke-width="2"/>
<g class="vs-orbit"><circle cx="66" cy="64" r="36" fill="none" stroke="#CCFBF1" stroke-width="3" stroke-linecap="round" stroke-dasharray="34 192"/><circle cx="102" cy="64" r="3.2" fill="#FDE68A"/></g>
<path d="M44 92L66 38L88 92" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<circle class="vs-halo" cx="66" cy="78" r="12" fill="#FBBF24" opacity=".35"/><circle class="vs-core" cx="66" cy="78" r="7.5" fill="#FBBF24"/>
<rect class="vs-scan" x="22" y="24" width="88" height="3" rx="1.5" fill="url(#vs-line)"/></svg>`;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v; // 只給本檔的常數 SVG
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const btn = (label, onclick, cls = 'btn') => h('button', { type: 'button', class: cls, onclick }, label);

const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
/** 對獎結果的一句話（wallet 裡那一張） */
export function invoiceResultText(x, t = visionT(null)) {
  if (!x) return t('invoice.saved');
  if (x.status === 'won') return t('invoice.won', { prize: x.prize, amount: Number(x.amount || 0).toLocaleString('zh-TW') });
  if (x.status === 'lost') return t('invoice.lost');
  if (x.status === 'unavailable') return t('invoice.unavailable');
  if (x.status === 'pending') return t('invoice.pending', { date: md(x.drawDate) });
  return t('invoice.waiting');
}

/**
 * 「讓阿幫看」視窗：選來源 → 看 → 阿幫看到了 → 確認。
 * @param {{ profile?: 'life'|'antifraud', lang?: 'en'|null, only?: 'invoice'|null, source?: 'camera'|'photos'|null,
 *   info?: object, callTool: Function, ask?: (q: string) => void, fill?: (t: string) => void, scam?: (t: string) => void, onSaved?: () => void }} o
 *   ask：送出問題（站牌）；fill：放進輸入框；scam：確認後檢查詐騙（防詐頁直接送、生活頁轉到防詐頁）；onSaved：發票存好、對完獎
 */
export async function openVision(o) {
  const profile = o.profile === 'antifraud' ? 'antifraud' : 'life';
  const mode = o.only === 'invoice' ? 'invoice' : profile;
  const t = visionT(o.lang);
  const info = o.info || await visionStatus();
  const dlg = h('dialog', { class: 'vision-dialog', 'aria-labelledby': 'vs-title' });
  if (o.lang === 'en') dlg.setAttribute('lang', 'en');
  const title = h('h2', { id: 'vs-title', tabindex: '-1' }, t(`title.${mode}`));
  const body = h('div', { class: 'vs-body' });
  // 無障礙（審查）：播報區開視窗時就在、一開始是空的，之後只改文字（帶內容插進去的 role=status，TalkBack／VoiceOver 常常不念）
  const live = h('p', { class: 'sr-only vs-live', role: 'status' });
  dlg.append(title, body, live);
  document.body.append(dlg);
  let closed = false;
  let sayTimer = 0;
  const close = () => { if (closed) return; closed = true; clearTimeout(sayTimer); if (dlg.open) dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('close', close);
  dlg.showModal();
  /** 播報：先清空再寫（同一句連續兩次也會念） */
  const say = (text) => { live.textContent = ''; clearTimeout(sayTimer); sayTimer = setTimeout(() => { live.textContent = text; }, 60); };
  /**
   * 換一個步驟：內容、要念的一句、焦點。焦點一定放好（行動裝置也是，不讓它掉到 body）：
   * 觸控裝置放標題（不自動跳鍵盤），有鍵盤滑鼠時放第一個輸入框或主要按鈕。
   */
  const show = (kids, { announce = null, focus = null } = {}) => {
    body.replaceChildren(...kids.filter(Boolean));
    if (announce) say(announce);
    const coarse = matchMedia('(pointer: coarse)').matches;
    const target = focus || (coarse ? title : body.querySelector('textarea, input, .vs-choice, .btn.primary, button'));
    (target || title).focus();
  };
  const want = mode === 'invoice' ? ['barcode', 'text'] : profile === 'antifraud' ? ['text'] : ['text', 'barcode', ...(info.describe && info.describe.state !== 'unsupported' && edgeOn() ? ['describe'] : [])];
  const canText = info.text;
  const canAny = mode === 'antifraud' ? canText : canText || info.barcode;

  function choose() {
    const kids = [h('p', { class: 'vs-note' }, t(`hint.${mode}`))];
    const choices = h('div', { class: 'vs-choices' });
    if (canAny && info.camera !== false) choices.append(h('button', { type: 'button', class: 'vs-choice', 'data-source': 'camera', html: CAMERA_ICON, onclick: () => run('camera') }));
    if (canAny && info.photos !== false) choices.append(h('button', { type: 'button', class: 'vs-choice', 'data-source': 'photos', html: PHOTO_ICON, onclick: () => run('photos') }));
    for (const b of choices.children) b.append(t(`${b.dataset.source}.${mode}`));
    kids.push(choices);
    if (info.where === 'web' && !canText) kids.push(h('p', { class: 'vs-note vs-web' }, mode === 'life' && info.barcode ? `${t('web.invoiceOnly')}${t('web.noText')}` : t('web.noText')));
    kids.push(h('p', { class: 'vs-lock', html: LOCK }, t('privacy')), h('div', { class: 'vs-acts' }, btn(t('cancel'), close, 'btn quiet')));
    show(kids);
  }

  function looking(source) {
    const box = h('div', { class: 'vs-look', 'data-stage': 'open', html: LOOK_SVG });
    const head = h('b', {}, t(`open.${source}`));
    const sub = h('small', {}, t('privacy'));
    box.append(head, sub);
    show([box, h('div', { class: 'vs-acts' }, btn(t('cancel'), close, 'btn quiet'))], { announce: t(`open.${source}`), focus: title }); // 網頁的檔案選擇器不一定回報取消：一定有路出去（晚到的結果丟掉）
    return () => { box.dataset.stage = 'look'; head.textContent = t('looking'); sub.textContent = t('lookingSub'); say(t('looking')); };
  }

  async function run(source) {
    const reading = looking(source);
    let r;
    try {
      r = await captureAndRead(source, { want, onReading: reading, literal: mode === 'invoice' });
    } catch (e) {
      if (closed) return;
      if (e.code === 'cancelled') { if (o.source) close(); else choose(); return; }
      return showError(e.code);
    }
    if (closed) return;
    result(interpret(r, { profile, only: mode === 'invoice' ? 'invoice' : null }));
  }

  /** 只有一句話＋按鈕的步驟（錯誤、沒看到字、拍到右邊 QR） */
  function message(text, acts, cls = 'vs-msg') {
    show([h('p', { class: cls }, text), h('div', { class: 'vs-acts' }, ...acts)], { announce: text });
  }

  function showError(code) {
    const text = t(`err.${code}`) === `err.${code}` ? t('err.failed') : t(`err.${code}`);
    const acts = [];
    if (code === 'denied' && globalThis.Capacitor?.isPluginAvailable?.('AbangSystem')) {
      acts.push(btn(t('err.openSettings'), () => globalThis.Capacitor.nativePromise('AbangSystem', 'openSettings', { target: 'app' }).catch(() => {}), 'btn primary'));
    }
    acts.push(btn(t('retry'), () => choose(), 'btn quiet'), btn(t('close'), close, 'btn quiet'));
    message(text, acts, 'vs-err');
  }

  /** 讀出來的字（可改、可遮）＋個資提醒 */
  function editor(text) {
    const area = h('textarea', { 'aria-label': t('saw'), maxlength: '2000' });
    area.value = text;
    const kinds = privateKinds(text);
    const kids = [area];
    let warn = '';
    if (kinds.length) {
      let masked = false;
      const original = text;
      const toggle = btn(t('private.mask'), () => {
        masked = !masked;
        area.value = masked ? maskReading(area.value) : original;
        toggle.textContent = t(masked ? 'private.unmask' : 'private.mask');
        toggle.setAttribute('aria-pressed', String(masked));
      }, 'btn small quiet vs-mask');
      toggle.setAttribute('aria-pressed', 'false');
      warn = t('private.found', { what: kinds.map((k) => t(`what.${k}`)).join(t('sep')) });
      kids.push(h('p', { class: 'vs-warn' }, warn, ' ', toggle));
    }
    if (text.length > VISION_MAX) kids.push(h('p', { class: 'vs-note' }, t('truncated', { n: VISION_MAX })));
    return { area, kids, warn };
  }

  function result(x) {
    const saw = (facts) => h('div', { class: 'vs-saw' }, h('b', {}, `${t('saw')}：`), facts);
    if (x.kind === 'empty') { message(t('empty'), [btn(t('retry'), choose, 'btn primary'), btn(t('close'), close, 'btn quiet')]); return; }
    if (x.kind === 'invoice-right') { message(t('invoice.right'), [btn(t('retry'), choose, 'btn primary'), btn(t('close'), close, 'btn quiet')]); return; }
    if (x.kind === 'invoice') return invoiceStep(x, saw);
    if (x.kind === 'scam') {
      const { area, kids, warn } = editor(x.text);
      const go = () => { const v = area.value.trim(); if (!v) { area.focus(); return; } close(); o.scam?.(v.slice(0, VISION_MAX)); };
      const lead = profile === 'antifraud' ? t('scam.edit') : t('scam.ask');
      show([h('p', { class: profile === 'antifraud' ? 'vs-note' : 'vs-ask' }, lead), ...kids,
        h('div', { class: 'vs-acts' }, btn(profile === 'antifraud' ? t('scam.check') : t('scam.yes'), go, 'btn primary vs-go'), btn(profile === 'antifraud' ? t('cancel') : t('scam.no'), close, 'btn quiet'))],
      { announce: [`${t('saw')}：${x.text.slice(0, 60)}`, profile === 'antifraud' ? '' : lead, warn].filter(Boolean).join(' ') });
      return;
    }
    if (x.kind === 'sign') {
      const s = x.sign;
      const facts = h('ul', { class: 'vs-facts' });
      if (s.stop) facts.append(h('li', {}, t('sign.stop', { v: s.stop })));
      if (s.routes.length) facts.append(h('li', {}, t('sign.routes', { v: s.routes.join(t('sep')) })));
      if (s.roads.length) facts.append(h('li', {}, t('sign.roads', { v: s.roads.join(t('sep')) })));
      if (s.toward) facts.append(h('li', {}, t('sign.toward', { v: s.toward })));
      const q = h('input', { class: 'vs-q', type: 'text', maxlength: String(VISION_MAX), enterkeyhint: 'send', 'aria-label': t('sign.label') });
      q.value = s.question || '';
      const go = () => { const v = q.value.trim(); if (!v) { q.focus(); return; } close(); o.ask?.(v); };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      const alts = (s.alternatives || []).length ? h('div', { class: 'vs-alt' }, ...s.alternatives.map((a) => btn(a, () => { q.value = a; q.focus(); }, 'chip'))) : null;
      show([saw(facts), h('p', {}, s.needsMore ? t('sign.more') : t('sign.lead')), q, alts, h('div', { class: 'vs-acts' }, btn(t('send'), go, 'btn primary vs-go'), btn(t('cancel'), close, 'btn quiet'))],
        { announce: `${t('saw')}：${[...facts.children].map((li) => li.textContent).join(t('sep'))}`, focus: s.needsMore ? q : null });
      if (s.needsMore) q.setSelectionRange(q.value.length, q.value.length);
      return;
    }
    // 只有字：放進輸入框讓使用者自己改成問題
    const { area, kids } = editor(x.text);
    show([h('p', {}, t('text.lead')), ...kids, h('div', { class: 'vs-acts' }, btn(t('text.use'), () => { const v = area.value.trim(); close(); if (v) o.fill?.(v.slice(0, VISION_MAX)); }, 'btn primary vs-go'), btn(t('cancel'), close, 'btn quiet'))],
      { announce: `${t('saw')}：${x.text.slice(0, 60)}` });
  }

  function invoiceStep(x, saw) {
    const inv = x.invoice;
    const when = inv.date ? t('invoice.when.date', { v: inv.date }) : inv.period ? t('invoice.when.period', { v: inv.period }) : '';
    const facts = h('ul', { class: 'vs-facts' }, h('li', {}, t('invoice.saw', inv)), when && h('li', {}, when));
    let dateIn = null;
    const kids = [saw(facts)];
    if (!inv.date && !inv.period) {
      dateIn = h('input', { type: 'date', 'aria-label': t('invoice.date'), max: todayTW(), value: todayTW() });
      kids.push(h('p', {}, t('invoice.needDate'), ' ', dateIn));
    }
    const out = h('p', { class: 'vs-result' }); // 結果的字照樣念（經常駐的播報區）
    const acts = h('div', { class: 'vs-acts' });
    const report = (text, cls = '') => { out.className = `vs-result${cls ? ` ${cls}` : ''}`; out.textContent = text; say(text); };
    const save = async () => {
      acts.replaceChildren();
      title.focus(); // 按鈕被拿掉：焦點不能掉到 body
      const code = { number: inv.number, ...(inv.date ? { date: inv.date } : inv.period ? { period: inv.period } : { date: dateIn?.value }) };
      let id = null;
      try { id = wallet.add(code).id; } catch (e) {
        const same = wallet.list().find((w) => w.number === code.number && (w.date === code.date || (code.period && w.period === code.period)));
        if (!same) { report(e.message, 'vs-err'); const c = btn(t('close'), close, 'btn quiet'); acts.append(c); c.focus(); return; }
        id = same.id;
      }
      report(t('invoice.checking'));
      try {
        await checkWallet(o.callTool, { all: true });
        const item = wallet.list().find((w) => w.id === id);
        report(invoiceResultText(item, t), item?.status === 'won' ? 'won' : '');
        if (item?.status === 'won') confetti(dlg);
      } catch (e) { report(t('invoice.fail', { msg: e.message })); }
      o.onSaved?.();
      if (closed) return;
      const link = h('a', { class: 'btn quiet', href: '#/s/invoice', onclick: close }, t('invoice.open'));
      const done = btn(t('close'), close, 'btn primary');
      acts.append(...(mode === 'invoice' ? [] : [link]), done);
      done.focus();
    };
    acts.append(btn(t('invoice.save'), save, 'btn primary vs-go'), btn(t('cancel'), close, 'btn quiet'));
    show([...kids, out, acts], { announce: `${t('saw')}：${[...facts.children].map((li) => li.textContent).join(t('sep'))}` });
  }

  if (o.source) run(o.source); else choose();
  return { close };
}
const edgeOn = () => { try { return globalThis.localStorage?.getItem('abang.edgeAI') !== 'off'; } catch { return true; } };

/**
 * 輸入列的相機鍵（問阿幫、底部對話、防詐頁）：能讀字才顯示；點了開「讓阿幫看」視窗。
 * @param {HTMLFormElement} form .chat-form
 * @param {{ profile: string, lang: () => ('en'|null), callTool: Function, ask: Function, fill: Function, scam: Function }} o
 */
export function mountVisionButton(form, o) {
  const profile = o.profile === 'antifraud' ? 'antifraud' : 'life';
  const b = h('button', { type: 'button', class: 'chat-cam', 'aria-haspopup': 'dialog', html: CAMERA_ICON });
  b.hidden = true;
  const label = (lang = null) => { const t = visionT(lang); b.setAttribute('aria-label', t(`btn.${profile}`)); b.title = t(`btn.${profile}`); }; // lang 在點的時候才問（頁面還在建立時不能讀）
  label();
  form.prepend(b);
  let info = null;
  const check = async () => {
    info = await visionStatus();
    b.hidden = !visionEnabled() || !info.text; // 要讀字才給（網頁版只有 BarcodeDetector 時拍簡訊會「沒看到字」；發票頁有自己的網頁掃描）
  };
  check();
  globalThis.addEventListener?.('abang:vision-setting', check);
  b.addEventListener('click', () => { const lang = o.lang?.() || null; label(lang); openVision({ ...o, profile, lang, info }); });
  return b;
}
