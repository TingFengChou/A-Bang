// 到站提醒常駐服務（手機 App；Android 外掛 AbangWatch：通知列常駐顯示還要多久、到點響鈴；App 關著也照常查真實到站時間）
// 網頁、舊版 App、iOS（還沒有這個外掛）回 false，照原本的方式提醒（畫面開著時每 20 秒查、App 關著靠預先排好的通知）。
import { API_BASE } from './base.js';

const PLUGIN = 'AbangWatch';
const cap = () => globalThis.Capacitor;

/** 這支手機能不能用常駐服務盯到站 */
export function hasWatchService() {
  const c = cap();
  return Boolean(c?.isNativePlatform?.() && c.isPluginAvailable?.(PLUGIN) && /^https?:\/\//.test(API_BASE));
}

/**
 * 開始盯（只送路線、站名、方向給阿幫伺服器，跟畫面查詢一樣）
 * @param {{ city?: string, routeName: string, stop: string, direction?: number, minutes: number, until?: number, lang?: string|null }} w
 * @returns {Promise<boolean>}
 */
export async function startWatchService(w) {
  if (!hasWatchService()) return false;
  try {
    await cap().nativePromise(PLUGIN, 'start', {
      apiBase: API_BASE, routeName: w.routeName, stop: w.stop, leadSec: Math.max(1, w.minutes) * 60, lang: w.lang === 'en' ? 'en' : 'zh',
      ...(w.city && { city: w.city }), ...(w.direction != null && { direction: w.direction }), ...(w.until && { until: w.until }),
    });
    return true;
  } catch { return false; }
}

export async function stopWatchService() {
  if (!hasWatchService()) return;
  try { await cap().nativePromise(PLUGIN, 'stop', {}); } catch { /* 沒在跑 */ }
}

/** @returns {Promise<{ active: boolean, firedAt: number }|null>} */
export async function watchServiceStatus() {
  if (!hasWatchService()) return null;
  try { return await cap().nativePromise(PLUGIN, 'status', {}); } catch { return null; }
}
