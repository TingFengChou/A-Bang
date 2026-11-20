// 卡片多語（S12b，2026-11-21）：zh-TW（預設）與 en（觀光客用英文問時）。字典鍵相同（test/cards-i18n.test.js 比對）。
// 卡片在同步重畫時用 withLocale 切換語言，共用的按鈕（actions.js）與倒數（countdown.js）照當下語言取字；英文缺鍵退回中文。
import { MESSAGES as ZH } from './zh-TW.js';
import { MESSAGES as EN } from './en.js';

const DICTS = { 'zh-TW': ZH, en: EN };
export const LOCALES = Object.keys(DICTS);
let current = 'zh-TW';

/** 支援的語言（其他一律中文） */
export const localeOf = (lang) => (DICTS[lang] ? lang : 'zh-TW');

/** 指定語言的 t（不受目前語言影響） */
export function tFor(locale) {
  const dict = DICTS[localeOf(locale)];
  return (key, vars = {}) => {
    const msg = (vars.n === 1 && dict[`${key}.one`]) || dict[key] || ZH[key]; // 英文單數：key.one（只有英文有）
    if (msg == null) return key;
    return msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  };
}

/** 目前語言的 t（卡片同步重畫時由 withLocale 設定） */
export function t(key, vars) {
  return tFor(current)(key, vars);
}

/** 用指定語言執行 fn（同步）；結束後還原 */
export function withLocale(locale, fn) {
  const prev = current;
  current = localeOf(locale);
  try { return fn(); } finally { current = prev; }
}
