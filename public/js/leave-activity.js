// 鎖定畫面的出發倒數（iOS 即時動態，2026-11-28 Claude 與 Antigravity 第十四輪；App Functions 結合）：
// 行程卡設了台鐵、高鐵、末班車的「提醒我出門」（reminders.js 送 abang:reminder-rail）時，鎖定畫面與動態島倒數到該出門的時間，
// 寫「19:00 出門，趕 19:25 從臺北開的車」。時間照時刻表算的（不用連網也會走）；提醒取消就結束；同一時間只有一個。
// 不需要 App Group（資料由 App 直接交給 ActivityKit），所以個人開發團隊也能用。Android、網頁、舊版 App 什麼都不做。
const PLUGIN = 'AbangWatch';
const ROLE = { tra: ['台鐵', 'Train'], thsr: ['高鐵', 'HSR'] };
const TW = 8 * 3600e3;
const hhmm = (ms) => { const d = new Date(ms + TW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

/**
 * 出門提醒 → 即時動態要的資料（純函式）。時間不對（沒有開車時間、開車比出門早）回 null。
 * @param {number} at 出門提醒的時間（毫秒）
 * @param {{ role?: string, trainNo?: string, depart?: string, from?: string, to?: string, date?: string, lang?: string }} rail
 */
export function leavePayload(at, rail) {
  if (!Number.isFinite(at) || !rail || !/^\d{2}:\d{2}$/.test(rail.depart || '')) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rail.date || '') ? rail.date : new Date(at + TW).toISOString().slice(0, 10);
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = rail.depart.split(':').map(Number);
  const depart = Date.UTC(y, m - 1, d, hh, mm) - TW;
  if (!(depart >= at)) return null;
  const en = rail.lang === 'en';
  const name = ROLE[rail.role]?.[en ? 1 : 0] || '';
  const title = `${name} ${rail.trainNo || ''}`.trim() || (en ? 'Your train' : '你的車');
  const from = String(rail.from || '').slice(0, 20);
  const text = en
    ? `Leave at ${hhmm(at)} for the ${rail.depart} departure${from ? ` from ${from}` : ''}`
    : `${hhmm(at)} 出門，趕 ${rail.depart}${from ? ` 從${from}` : ''}開的車${rail.to ? `（往${String(rail.to).slice(0, 20)}）` : ''}`;
  return { title: title.slice(0, 30), from, leaveAt: at, depart, text, lang: en ? 'en' : 'zh' };
}

const iosApp = () => { const c = globalThis.Capacitor; try { return !!(c?.isNativePlatform?.() && c.getPlatform?.() === 'ios' && c.isPluginAvailable?.(PLUGIN)); } catch { return false; } };

/** App 啟動時掛上（app.js）：設了出門提醒就開、取消就關 */
export function mountLeaveActivity() {
  if (!iosApp()) return;
  let current = null;
  const native = (m, a = {}) => globalThis.Capacitor.nativePromise(PLUGIN, m, a).catch(() => null); // 即時動態關掉、舊版 App：照舊只有通知
  addEventListener('abang:reminder-rail', (e) => {
    const p = leavePayload(e.detail?.at, e.detail?.rail);
    if (!p) return;
    current = e.detail.id;
    native('startLeave', p);
  });
  addEventListener('abang:reminder-cancel', (e) => {
    if (!current || !(e.detail?.all || e.detail?.id === current)) return;
    current = null;
    native('stopLeave');
  });
}
