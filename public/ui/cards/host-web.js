// 網頁 host（CARDS.md §3）：callTool → POST /api/v1/tools/:name；L2 連結先確認再開新分頁。
// MCP Apps 版（host-mcp-app.js）於 M4-04 實作。

import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID } from '../../js/native-notify.js';

// 到站提醒（L-14）：整個頁面共用一個；SPA 換頁仍繼續，網頁版關掉就停止（網頁沒有背景推播）。
// 手機 App（M11-02）：每次查到到站時間，就把「該出門了」的本機通知排到預估的時間（同一則覆蓋更新）；
// App 到背景或被關掉時，系統照最後一次的預估送出。
// 每 20 秒查一次上車站的到站時間（bus_route_eta 的 focus），剩下時間 ≤ 設定的分鐘數就通知一次後結束。
// 設定時這班已經在提醒範圍內（趕不上）→ 跳過這班，等到站時間跳回大數字（下一班）再開始算。
const POLL_MS = 20_000, MAX_MS = 90 * 60_000;
const watch = { w: null, poll: null, fire: null, until: 0, nativeAt: 0 };
const signal = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };
function stopWatch({ cancel = true } = {}) {
  clearInterval(watch.poll); clearTimeout(watch.fire);
  watch.w = null;
  if (cancel && watch.nativeAt) cancelNotify(NOTIFY_ID.arrival); // 使用者取消或逾時：排好的通知一起取消
  watch.nativeAt = 0;
  signal('abang:arrival-watch', null);
}
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** App：把「該出門了」排到 at（差不到 20 秒就不重排，少打擾系統） */
function planNative(w, at) {
  if (Math.abs(at - watch.nativeAt) < 20_000) return;
  watch.nativeAt = at;
  scheduleNotify(NOTIFY_ID.arrival, new Date(at), '阿幫：公車快到站', `${arrivalText(w.routeName, w.stop, w.minutes * 60)}（依 ${hm(new Date())} 的到站時間估計）`);
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
    // 排好的通知在 5 秒內會送（或剛送過）就不重複；車比預估早到 → 改成馬上送
    if (!planned || planned > Date.now() + 5000) scheduleNotify(NOTIFY_ID.arrival, new Date(), '阿幫：公車快到站', text);
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
  return {
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
     * 裝置端提醒（UX.md §6）：今天 HH:mm（裝置時間）以系統通知提醒；需使用者允許通知、且頁面保持開啟。
     * @returns {Promise<boolean>} 是否設定成功
     */
    async remind(at, text) {
      const [h, m] = String(at).split(':').map(Number);
      const when = new Date(); when.setHours(h, m, 0, 0);
      const delay = when.getTime() - Date.now();
      if (!(delay > 0 && delay < 12 * 3600e3)) return false;
      // 手機 App：系統本機通知，App 關著也會響
      if (hasNativeNotify()) return (await ensureNotifyPermission()) && scheduleNotify(NOTIFY_ID.leave, when, '阿幫提醒', text);
      if (typeof Notification === 'undefined') return false;
      const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (perm !== 'granted') return false;
      setTimeout(() => { try { new Notification('阿幫提醒', { body: text, icon: '/icons/icon.svg' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ } }, delay);
      return true;
    },
    /**
     * 公車到站提醒（L-14）：到站前 minutes 分通知一次。先要通知權限（拒絕時仍以 App 內 toast 提醒）。
     * @param {{ city: string, routeName: string, stop: string, direction?: number, minutes: number }} w
     */
    async watchArrival(w) {
      if (hasNativeNotify()) await ensureNotifyPermission();
      else if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      stopWatch();
      watch.w = { ...w, first: true, skip: null };
      watch.until = Date.now() + MAX_MS;
      signal('abang:arrival-watch', watch.w);
      const call = (n, a) => this.callTool(n, a);
      await pollWatch(call);
      if (watch.w) watch.poll = setInterval(() => pollWatch(call), POLL_MS);
      return true;
    },
    unwatchArrival: () => stopWatch(),
    /** 提醒在 App 關掉後還會不會響（手機 App 的本機通知會；網頁不會） */
    background: hasNativeNotify(),
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
}
