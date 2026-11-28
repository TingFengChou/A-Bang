// 主畫面小工具「阿幫・今天」（Android AbangTodayWidget；App Functions 結合）：首頁「今天」卡算好之後，把那幾句存給小工具。
// 只在打開 App、首頁算完時更新（跟今天卡同一個原則：不背景、不連網、不讀位置），所以小工具一定寫出「幾點打開阿幫時的資料」。
// 只送文字（日子、一句話、兩個提醒、時間），不送座標、常用地點的名稱或「依據」。
// 網頁版、iOS（還沒有小工具）什麼都不做。
import { twClock } from '../../core/suggest.js';

/** 今天卡的結果 → 小工具要的幾個字串（純函式） */
export function widgetPayload(p, now = Date.now()) {
  if (!p?.show) return null;
  const { hour, min } = twClock(now);
  return {
    title: `阿幫・今天 ${p.date}`,
    kind: p.kind?.label || '',
    say: p.say,
    tip1: p.tips?.[0]?.text || '',
    tip2: p.tips?.[1]?.text || '',
    updated: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
  };
}

const androidApp = () => { const c = globalThis.Capacitor; try { return !!(c?.isNativePlatform?.() && c.getPlatform?.() === 'android' && typeof c.nativePromise === 'function'); } catch { return false; } };
/** 這支手機能放「阿幫・今天」小工具嗎（只有 Android App） */
export const widgetAvailable = androidApp;
/** 「放到主畫面」：開系統的新增小工具畫面（使用者按「新增」才放）；不支援回 false */
export async function pinTodayWidget() {
  if (!androidApp()) return false;
  try { return !!(await globalThis.Capacitor.nativePromise('AbangSystem', 'pinTodayWidget', {}))?.supported; } catch { return false; }
}

let lastSig = '';
/** 送給原生小工具（只有 Android App；內容一樣不重送） */
export async function pushTodayWidget(p, now = Date.now()) {
  const c = globalThis.Capacitor;
  if (!androidApp()) return false;
  const w = widgetPayload(p, now);
  if (!w) return false;
  const sig = JSON.stringify({ ...w, updated: '' }); // 只有時間變了不重送（每 20 秒的提醒事件會重畫今天卡）
  if (sig === lastSig) return false;
  lastSig = sig;
  try { await c.nativePromise('AbangSystem', 'setTodayWidget', w); return true; } catch { lastSig = ''; return false; } // 舊版 App 沒有這個方法
}
