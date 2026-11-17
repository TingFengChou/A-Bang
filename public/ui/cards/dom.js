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
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
