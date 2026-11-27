// 卡片用的最小 DOM 工具：一律以 textContent／setAttribute 建立節點，不用 innerHTML（資料來自上游，避免 XSS）。

/**
 * h('div', { class: 'x', onclick: fn, 'aria-label': '…' }, '文字', child, [more], null)
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } // CSS 變數要用 setProperty
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === '') continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

/** 只允許 http(s) 網址（地圖、訂票、叫車連結）；其他協定一律擋掉 */
export const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

/** 'HH:mm' 或 ISO → 'HH:mm'（台灣時間）；解析不了回原字串 */
export function hhmm(s) {
  if (typeof s !== 'string') return '';
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t + 8 * 3600e3).toISOString().slice(11, 16);
}

/**
 * 電話顯示格式統一（設計審查 2026-11-28：診所「(02)23038125」、戶政「02-23948838」不一致）：
 * 02-2303-8125、0912-345-678、037-123456、03-123-4567；分機照原樣接在後面；看不出格式就照原樣。
 */
export function fmtTel(p) {
  const raw = String(p ?? '').trim();
  const m = /^([^#,，轉]*)(.*)$/.exec(raw);
  const d = m[1].replace(/[^0-9]/g, '');
  const ext = m[2].trim();
  let out = null;
  if (/^09\d{8}$/.test(d)) out = `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  else if (/^0800\d{6}$/.test(d)) out = `0800-${d.slice(4, 7)}-${d.slice(7)}`;
  else if (/^02\d{8}$/.test(d)) out = `02-${d.slice(2, 6)}-${d.slice(6)}`;
  else if (/^(?:0826|0836)\d{5}$/.test(d)) out = `${d.slice(0, 4)}-${d.slice(4)}`;
  else if (/^(?:037|049|082|089)\d{6,7}$/.test(d)) out = `${d.slice(0, 3)}-${d.slice(3)}`;
  else if (/^0[3-8]\d{7}$/.test(d)) out = `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  else if (/^0[3-8]\d{8}$/.test(d)) out = `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (!out) return raw;
  return ext ? `${out} ${ext}` : out;
}
