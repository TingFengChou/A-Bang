// Siri、捷徑、Spotlight 交給 App 的事（M16-02，ADR-0021 第 1 階段；原生端 ios/App/App/AbangIntents.swift）：
// 問阿幫（帶問題）、查詐騙（帶可疑訊息到防詐）、打開某一頁。App 啟動、回到前景、收到 intent 事件時向 AbangSystem.takeIntent 拿一次。
// 只接受固定幾種、長度有限、沒有控制字元的內容；頁面只能是下面列的。資料照 App 原本的流程查。

/** 捷徑可以打開的頁面（AbangPage 的值 → App 內的頁面） */
export const INTENT_PAGES = { nearby: '#/nearby', weather: '#/s/weather', reminders: '#/reminders', antifraud: '#/agent/antifraud', invoice: '#/s/invoice' };
const LIMIT = { ask: 500, scam: 2000 };

/**
 * 捷徑交來的事 → 要開的 App 內頁面；不合格回 null。
 * @param {{ kind?: string, text?: string } | null | undefined} it
 */
export function intentHash(it) {
  const kind = it?.kind, text = typeof it?.text === 'string' ? it.text.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim() : '';
  if (kind === 'page') return Object.hasOwn(INTENT_PAGES, text) ? INTENT_PAGES[text] : null;
  if (!text || !LIMIT[kind]) return null;
  const q = encodeURIComponent([...text].slice(0, LIMIT[kind]).join(''));
  return kind === 'ask' ? `#/agent?q=${q}` : `#/agent/antifraud?q=${q}`;
}

/**
 * 開始接捷徑（只有 iOS App 有 takeIntent；其他平台什麼都不做）。
 * @returns {Promise<string|null>} 第一次拿到時開的頁面（測試用）
 */
export async function startAppIntents({ c = globalThis.Capacitor, go = (h) => { location.hash = h; }, doc = globalThis.document } = {}) {
  let ok;
  try { ok = c?.isNativePlatform?.() && c.getPlatform?.() === 'ios' && (c.isPluginAvailable ? c.isPluginAvailable('AbangSystem') : true) && typeof c.nativePromise === 'function'; } catch { ok = false; }
  if (!ok) return null;
  const take = async () => {
    let it;
    try { it = await c.nativePromise('AbangSystem', 'takeIntent', {}); } catch { return null; } // 舊版 App 沒有這個方法
    const h = intentHash(it);
    if (h) go(h);
    return h;
  };
  try { c.addListener?.('AbangSystem', 'intent', () => { take(); }); } catch { /* 舊版 */ }
  doc?.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'visible') take(); });
  return take();
}
