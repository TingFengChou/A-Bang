// 到站提醒常駐顯示（手機 App 外掛 AbangWatch）
// Android：前景服務，通知列常駐顯示還要多久、到點響鈴；App 關著也照常查真實到站時間（kind 'service'）。
// iOS：即時動態（Live Activity，鎖定畫面與動態島）顯示還要多久、倒數到預估到站；iOS 不讓 App 在背景一直查，
//   所以只有 App 開著時更新，提醒本身照舊用排好的本機通知（kind 'live'）。
// 網頁、舊版 App、不支援即時動態的 iPhone 回 false，照原本的方式提醒（畫面開著時每 20 秒查、App 關著靠預先排好的通知）。
import { API_BASE } from './base.js';

const PLUGIN = 'AbangWatch';
const cap = () => globalThis.Capacitor;

/** 這支手機有沒有常駐顯示的外掛 */
export function hasWatchService() {
  const c = cap();
  return Boolean(c?.isNativePlatform?.() && c.isPluginAvailable?.(PLUGIN) && /^https?:\/\//.test(API_BASE));
}

/**
 * 開始盯（Android 只送路線、站名、方向給阿幫伺服器，跟畫面查詢一樣；iOS 不連網，只在手機上顯示）
 * @param {{ city?: string, routeName: string, stop: string, direction?: number, minutes: number, until?: number, lang?: string|null }} w
 * @returns {Promise<'service'|'live'|false>} service：原生服務自己查、自己響（Android）；live：只顯示，App 開著時由畫面更新（iOS）
 */
export async function startWatchService(w) {
  if (!hasWatchService()) return false;
  try {
    const r = await cap().nativePromise(PLUGIN, 'start', {
      apiBase: API_BASE, routeName: w.routeName, stop: w.stop, leadSec: Math.max(1, w.minutes) * 60, lang: w.lang === 'en' ? 'en' : 'zh',
      ...(w.city && { city: w.city }), ...(w.direction != null && { direction: w.direction }), ...(w.until && { until: w.until }),
    });
    return r?.polls === false ? 'live' : 'service'; // Android 的 start 不回資料
  } catch { return false; }
}

/**
 * 更新常駐顯示（只有 iOS 即時動態需要；Android 服務自己查）
 * @param {{ text: string, etaSec?: number|null }} u
 */
export async function updateWatchService(u) {
  if (!hasWatchService()) return;
  try { await cap().nativePromise(PLUGIN, 'update', { text: u.text, ...(u.etaSec != null && { etaSec: Math.max(0, Math.round(u.etaSec)) }) }); } catch { /* 沒在跑 */ }
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

/**
 * 常駐顯示的一句（跟 Android 通知列同樣的說法）：
 * 「307 往撫遠街・約 5 分到「臺北車站(忠孝)」・到站前 2 分提醒你」；這班來不及：「…・這班來不及，等下一班」；
 * 沒有預估：「307 往撫遠街：尚未發車（臺北車站(忠孝)）」
 * @param {{ routeName: string, stop: string, minutes: number, lang?: string|null }} w
 * @param {{ status: number, etaSec: number|null, label?: string, stopName?: string, statusText?: string }} f
 * @param {{ skip?: boolean }} [o]
 */
export function watchLine(w, f, { skip = false } = {}) {
  const en = w.lang === 'en';
  const st = f.stopName || w.stop;
  const label = f.label ? ` ${f.label}` : '';
  if (f.status !== 0 || f.etaSec == null) return en ? `Bus ${w.routeName}${label}: ${f.statusText || ''} (${st})` : `${w.routeName}${label}：${f.statusText || ''}（${st}）`;
  const m = Math.max(1, Math.round(f.etaSec / 60));
  const head = en
    ? (f.etaSec < 60 ? `Bus ${w.routeName} is arriving at ${st}` : `Bus ${w.routeName}${label} · about ${m} min to ${st}`)
    : (f.etaSec < 60 ? `${w.routeName} 在「${st}」進站中` : `${w.routeName}${label}・約 ${m} 分到「${st}」`);
  if (skip) return head + (en ? ' · waiting for the next bus' : '・這班來不及，等下一班');
  return head + (en ? ` · I'll remind you ${w.minutes} min before` : `・到站前 ${w.minutes} 分提醒你`);
}
