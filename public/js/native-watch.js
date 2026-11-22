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

/** @returns {Promise<{ active: boolean, firedAt: number, endedAt?: number }|null>} endedAt：末班已過或今日未營運，服務自己取消了提醒 */
export async function watchServiceStatus() {
  if (!hasWatchService()) return null;
  try { return await cap().nativePromise(PLUGIN, 'status', {}); } catch { return null; }
}

// ── 下車提醒常駐服務（同一個外掛 AbangWatch，另一個服務 AbangAlightService；跟到站提醒可以同時進行）──
// 「我這台」怎麼找只寫在 core/alight.js：服務每 20 秒問阿幫伺服器 /api/v1/bus/alight，只送路線、方向、上下車站與設定時的估計，不送位置。

/**
 * 開始下車提醒常駐服務
 * @param {{ city?: string, routeName: string, direction?: number|null, board: string, boardSeq?: number, dest: string, destSeq?: number, plate?: string|null, boardAt: number, rideSec: number, until: number, lang?: string|null }} w
 * @returns {Promise<boolean>}
 */
export async function startAlightService(w) {
  if (!hasWatchService()) return false;
  try {
    await cap().nativePromise(PLUGIN, 'startAlight', {
      apiBase: API_BASE, routeName: w.routeName, board: w.board, dest: w.dest, boardAt: Math.round(w.boardAt), rideSec: Math.round(w.rideSec), until: Math.round(w.until), lang: w.lang === 'en' ? 'en' : 'zh',
      ...(w.city && { city: w.city }), ...(w.direction != null && { direction: w.direction }),
      ...(w.boardSeq != null && { boardSeq: w.boardSeq }), ...(w.destSeq != null && { destSeq: w.destSeq }), ...(w.plate && { plate: w.plate }),
    });
    return true;
  } catch { return false; } // 舊版 App 沒有這個方法：照原本方式（預排本機通知）
}

export async function stopAlightService() {
  if (!hasWatchService()) return;
  try { await cap().nativePromise(PLUGIN, 'stopAlight', {}); } catch { /* 沒在跑 */ }
}

/** @returns {Promise<{ active: boolean, firedAt: number, endedAt: number }|null>} firedAt：服務已經響過；endedAt：使用者在通知按了「停止」或超過 3 小時 */
export async function alightServiceStatus() {
  if (!hasWatchService()) return null;
  try { return await cap().nativePromise(PLUGIN, 'alightStatus', {}); } catch { return null; }
}
