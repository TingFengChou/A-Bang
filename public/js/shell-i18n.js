// 外殼的文字字典（S12g，2026-11-21）：底部分頁列、返回鈕、跳到主要內容、浮動阿幫、底部對話面板、提醒泡泡。
// 目前頁面網址帶 lang=en（英文公車頁），或在問阿幫頁且最近一輪是英文時用英文；其他時候中文（每次換頁依網址決定，不存設定）。
// 跟公車頁字典（pages/bus-i18n.js）同一套做法：鍵相同、佔位符 {text}、英文缺鍵退回中文。中文的值與改版前一字不差。

export const ZH = {
  'skip': '跳到主要內容',
  'back': '返回',
  'tab.home': '首頁',
  'tab.nearby': '附近',
  'tab.bus': '公車',
  'tab.favs': '收藏',
  'fab': '問阿幫',
  'fabChat': '打開跟阿幫的對話（對話還在）',
  'sheetTitle': '問阿幫',
  'sheetFull': '放大成整頁',
  'sheetClose': '收起對話（對話會保留）',
  'bubbleAsk': '問阿幫',
  'bubbleOk': '知道了',
  'liveSays': '阿幫：{text}',
  'agentTitle': '問阿幫',
};

export const EN = {
  'skip': 'Skip to main content',
  'back': 'Back',
  'tab.home': 'Home',
  'tab.nearby': 'Nearby',
  'tab.bus': 'Bus',
  'tab.favs': 'Saved',
  'fab': 'Ask Abang',
  'fabChat': 'Open your chat with Abang (still here)',
  'sheetTitle': 'Ask Abang',
  'sheetFull': 'Open full page',
  'sheetClose': 'Minimize chat (it stays here)',
  'bubbleAsk': 'Ask Abang',
  'bubbleOk': 'Got it',
  'liveSays': 'Abang: {text}',
  'agentTitle': 'Ask Abang',
};

/**
 * 外殼用哪種語言（純函式）：網址帶 lang=en；或在問阿幫（生活）頁、最近一輪是英文。
 * @param {{ query?: Record<string, string>, onLifeAgent?: boolean, agentLang?: string|null }} o
 * @returns {'en'|null}
 */
export const shellLang = ({ query = {}, onLifeAgent = false, agentLang = null } = {}) => (query.lang === 'en' || (onLifeAgent && agentLang === 'en') ? 'en' : null);

/**
 * 指定語言的 t（英文缺鍵退回中文；缺鍵回傳鍵本身）。
 * @param {'en'|null} lang
 * @returns {(key: string, vars?: Record<string, any>) => string}
 */
export function shellT(lang) {
  const dict = lang === 'en' ? EN : ZH;
  return (key, vars = {}) => {
    const msg = dict[key] ?? ZH[key];
    if (msg == null) return key;
    return msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  };
}

/** 外殼現在的語言（看 <html lang>；abang-dock.js 等在換頁之間也讀得到） */
export const currentShellLang = (doc = globalThis.document) => (doc?.documentElement?.dataset?.shellLang === 'en' ? 'en' : null); // 外殼現在的語言（不一定等於 <html lang>）

/**
 * 把外殼的固定文字換成指定語言：<html lang>、[data-shell]（文字）、[data-shell-label]（aria-label）。
 * 讀屏照 <html lang> 念（英文 'en'、中文 'zh-Hant-TW'）。
 * @param {'en'|null} lang
 * @param {Document} [doc]
 */
export function applyShell(lang, doc = globalThis.document, { root = doc, docLang = lang } = {}) {
  const t = shellT(lang);
  // 整頁語言只跟網址（英文公車頁）；問阿幫頁的英文一輪只標外殼元素（上面還有中文對話，讀屏不該用英文唸，PR 審查）
  if (root === doc) { doc.documentElement.lang = docLang === 'en' ? 'en' : 'zh-Hant-TW'; doc.documentElement.dataset.shellLang = lang === 'en' ? 'en' : ''; }
  const mark = (el) => { if (lang === 'en' && docLang !== 'en') el.setAttribute('lang', 'en'); else el.removeAttribute('lang'); };
  for (const el of root.querySelectorAll('[data-shell]')) {
    const v = t(el.dataset.shell);
    if (el.textContent !== v) el.textContent = v;
    mark(el);
  }
  for (const el of root.querySelectorAll('[data-shell-label]')) { el.setAttribute('aria-label', t(el.dataset.shellLabel)); mark(el); }
}
