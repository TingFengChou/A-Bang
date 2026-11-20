// 網頁 host（CARDS.md §3）：callTool → POST /api/v1/tools/:name；L2 連結先確認再開新分頁。
// MCP Apps 版（host-mcp-app.js）於 M4-04 實作。

import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID, EARLY_MS } from '../../js/native-notify.js';
import { addReminder, cancelReminder, notifyState } from '../../js/reminders.js';

// 到站提醒（L-14）：整個頁面共用一個；SPA 換頁仍繼續，網頁版關掉就停止（網頁沒有背景推播）。
// 手機 App（M11-02）：每次查到到站時間，就把「該出門了」的本機通知排到預估的時間（同一則覆蓋更新）；
// App 到背景或被關掉時，系統照最後一次的預估送出。
// 每 20 秒查一次上車站的到站時間（bus_route_eta 的 focus），剩下時間 ≤ 設定的分鐘數就通知一次後結束。
// 設定時這班已經在提醒範圍內（趕不上）→ 跳過這班，等到站時間跳回大數字（下一班）再開始算。
const POLL_MS = 20_000, MAX_MS = 90 * 60_000;
const watch = { w: null, poll: null, fire: null, until: 0, nativeAt: 0 };
// App 的通知能不能在背景送（權限被拒或排程失敗 → false，畫面就不能寫「App 關著也會提醒」）
const native = { granted: null, failed: false };
const canBackground = () => hasNativeNotify() && native.granted !== false && !native.failed;
// App 被系統關掉再打開：恢復提醒（只存路線與站，不存位置）
const STORE = 'abang.arrivalWatch';
const store = {
  save: () => { try { if (hasNativeNotify() && watch.w) localStorage.setItem(STORE, JSON.stringify({ w: { city: watch.w.city, routeName: watch.w.routeName, stop: watch.w.stop, direction: watch.w.direction, minutes: watch.w.minutes }, until: watch.until })); } catch { /* 無痕或停用 */ } },
  clear: () => { try { localStorage.removeItem(STORE); } catch { /* 無痕或停用 */ } },
  load: () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } },
};
let resumed = false;
const signal = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };
function stopWatch({ cancel = true } = {}) {
  clearInterval(watch.poll); clearTimeout(watch.fire);
  watch.w = null;
  if (cancel && watch.nativeAt) cancelNotify(NOTIFY_ID.arrival); // 使用者取消或逾時：排好的通知一起取消
  watch.nativeAt = 0;
  store.clear();
  signal('abang:arrival-watch', null);
}
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** 通知標題與內文（鎖定畫面先看到「該出門了」；預估時間放最後） */
export const NOTIFY_TITLE = '阿幫：該出門了';
export const nativeBody = (route, stop, minutes, at = new Date()) => `${route} 約 ${minutes} 分後到「${stop}」（${hm(at)} 的預估）`;
/** App：把「該出門了」排到 at（提早 EARLY_MS 吸收一般排程的延遲；差不到 20 秒就不重排；失敗下次再試） */
function planNative(w, at) {
  if (Math.abs(at - watch.nativeAt) < 20_000) return;
  watch.nativeAt = at;
  scheduleNotify(NOTIFY_ID.arrival, new Date(at - EARLY_MS), NOTIFY_TITLE, nativeBody(w.routeName, w.stop, w.minutes)).then((ok) => {
    if (ok) { if (native.failed) { native.failed = false; signal('abang:arrival-watch', watch.w); } return; }
    if (watch.w === w) watch.nativeAt = 0;
    if (!native.failed) { native.failed = true; signal('abang:arrival-watch', watch.w); } // 畫面改說「App 開著時才會提醒」
  });
}
/** 「601 約 3 分後到「西門」，該出門了！」；不到 1 分：「601 在「西門」進站中，快去搭！」 */
export const arrivalText = (route, stop, sec) => (sec < 60 ? `${route} 在「${stop}」進站中，快去搭！` : `${route} 約 ${Math.max(1, Math.round(sec / 60))} 分後到「${stop}」，該出門了！`);
function fireArrival(f) {
  const w = watch.w;
  if (!w) return;
  const text = arrivalText(w.routeName, w.stop, f.etaSec);
  const planned = watch.nativeAt;
  stopWatch({ cancel: false });
  if (hasNativeNotify()) {
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    // 前景：畫面上的提醒（toast）就夠了，排好的通知取消（不要同一件事出現兩次）
    // 背景：排好的通知在 5 秒內會送（或剛送過）就不重複；車比預估早到 → 改成馬上送
    if (visible) { if (planned) cancelNotify(NOTIFY_ID.arrival); }
    else if (!planned || planned > Date.now() + 5000) scheduleNotify(NOTIFY_ID.arrival, new Date(), NOTIFY_TITLE, text);
  } else {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('阿幫：公車快到站', { body: text, icon: '/icons/icon.svg', tag: 'abang-arrival' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* 不支援 */ }
  signal('abang:arrival', { text }); // App 顯示 toast（沒開通知權限時也看得到）
}
async function pollWatch(callTool) {
  const w = watch.w;
  if (!w) return;
  if (Date.now() > watch.until) { stopWatch(); return; } // 90 分鐘還沒到：放棄（排好的通知也取消）
  try {
    const r = await callTool('bus_route_eta', { city: w.city, routeName: w.routeName, stop: w.stop, ...(w.direction != null && { direction: w.direction }) });
    const f = r?.data?.focus;
    if (!f || watch.w !== w) return;
    w.last = { etaSec: f.etaSec, statusText: f.statusText, at: Date.now() };
    signal('abang:arrival-watch', w);
    if (f.status !== 0 || f.etaSec == null) return; // 未發車、末班已過：繼續看下一次
    const left = f.etaSec - w.minutes * 60;
    if (w.skip) {
      // 跳過的那班開走後，到站時間會變大（下一班）
      if (f.etaSec > w.skip + 60) w.skip = null;
      else { w.skip = f.etaSec; signal('abang:arrival-watch', w); return; }
    } else if (w.first && left <= 0) {
      w.first = false; w.skip = f.etaSec; signal('abang:arrival-watch', w); return;
    }
    w.first = false;
    clearTimeout(watch.fire);
    if (left > 0 && hasNativeNotify()) planNative(w, Date.now() + left * 1000);
    if (left <= 0) fireArrival(f);
    else if (left * 1000 < POLL_MS + 5000) watch.fire = setTimeout(() => fireArrival({ ...f, etaSec: w.minutes * 60 }), left * 1000); // 兩次更新之間到點也準時提醒
  } catch { /* 暫時查不到：下次再試 */ }
}

/**
 * @param {{ base?: string, ask?: (text: string) => void, setContext?: (text: string) => void, confirm?: (text: string) => boolean }} [opts]
 * @returns {import('./host.js').Host}
 */
export function createWebHost({ base = String(globalThis.__ABANG_API_BASE__ || '').replace(/\/+$/, ''), ask, setContext, confirm = (m) => window.confirm(m) } = {}) {
  const host = {
    kind: 'web', theme: 'light',
    async callTool(name, args) {
      const res = await fetch(`${base}/api/v1/tools/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    },
    ask: ask || (() => {}),
    setContext: setContext || (() => {}),
    /**
     * 出門提醒（UX.md §6、T7）：今天 HH:mm（裝置時間）。可以有多筆、可以取消（public/js/reminders.js）。
     * 手機 App 用系統本機通知（App 關著也會響）；網頁要允許通知、頁面開著才會響。
     * @returns {Promise<string|false>} 提醒 id（可傳給 cancelRemind）；失敗回 false
     */
    async remind(at, text) {
      const [h, m] = String(at).split(':').map(Number);
      const when = new Date(); when.setHours(h, m, 0, 0);
      return addReminder(when, text);
    },
    /** 取消出門提醒 */
    cancelRemind: (id) => cancelReminder(id),
    /** 通知權限現況（不跳對話框）：卡片在第一次要權限前先說明為什麼 */
    notifyState: () => notifyState(),
    /**
     * 公車到站提醒（L-14）：到站前 minutes 分通知一次。先要通知權限（拒絕時仍以 App 內 toast 提醒）。
     * @param {{ city: string, routeName: string, stop: string, direction?: number, minutes: number }} w
     */
    async watchArrival(w) {
      if (hasNativeNotify()) { native.granted = await ensureNotifyPermission(); native.failed = false; }
      else if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      stopWatch();
      watch.w = { ...w, first: true, skip: null };
      watch.until = w.until ?? Date.now() + MAX_MS;
      store.save();
      signal('abang:arrival-watch', watch.w);
      const call = (n, a) => this.callTool(n, a);
      await pollWatch(call);
      if (watch.w) watch.poll = setInterval(() => pollWatch(call), POLL_MS);
      return true;
    },
    unwatchArrival: () => stopWatch(),
    /** 提醒在 App 關掉後還會不會響（手機 App 有通知權限才會；網頁不會） */
    get background() { return canBackground(); },
    /** 設定提醒後的說明文字鍵（i18n busRoute.*）：App 關著也會提醒／頁面開著時／App 沒有通知權限 */
    arrivalNote() { return !hasNativeNotify() ? 'whenOpenPage' : canBackground() ? 'whenAlways' : 'whenNoPermission'; },
    /** 目前的到站提醒（沒有回 null） */
    arrivalWatch: () => watch.w,
    /** App 內頁面（例：#/bus/Taipei/601?stop=…）；只接受 #/ 開頭 */
    navigate(hash) { if (/^#\/[^\s<>"']*$/.test(hash)) location.hash = hash; },
    openLink(url, opts = {}) {
      if (!/^https:\/\//i.test(url)) return;
      // 確認文字由 tool 提供（訂票、叫車各自說明付款在哪裡完成）；這裡不再自行加句子
      if (opts.confirm && !confirm(opts.confirm)) return;
      window.open(url, '_blank', 'noopener');
    },
  };
  // App 被系統關掉再打開：恢復上次的到站提醒（沒過期才恢復；過期就清掉並取消排好的通知）
  if (!resumed && hasNativeNotify()) {
    resumed = true;
    const saved = store.load();
    if (saved?.w && saved.until > Date.now() && !watch.w) host.watchArrival({ ...saved.w, until: saved.until }).catch(() => {});
    else if (saved) { store.clear(); cancelNotify(NOTIFY_ID.arrival); }
  }
  return host;
}
