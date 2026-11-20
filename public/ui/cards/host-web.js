// 網頁 host（CARDS.md §3）：callTool → POST /api/v1/tools/:name；L2 連結先確認再開新分頁。
// MCP Apps 版（host-mcp-app.js）於 M4-04 實作。

// 到站提醒（L-14）：整個頁面共用一個；SPA 換頁仍繼續，App 關掉就停止（網頁沒有背景推播）。
// 每 20 秒查一次上車站的到站時間（bus_route_eta 的 focus），剩下時間 ≤ 設定的分鐘數就通知一次後結束。
// 設定時這班已經在提醒範圍內（趕不上）→ 跳過這班，等到站時間跳回大數字（下一班）再開始算。
const POLL_MS = 20_000, MAX_MS = 90 * 60_000;
const watch = { w: null, poll: null, fire: null, until: 0 };
const signal = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };
function stopWatch() {
  clearInterval(watch.poll); clearTimeout(watch.fire);
  watch.w = null;
  signal('abang:arrival-watch', null);
}
/** 「601 約 3 分後到「西門」，該出門了！」；不到 1 分：「601 在「西門」進站中，快去搭！」 */
export const arrivalText = (route, stop, sec) => (sec < 60 ? `${route} 在「${stop}」進站中，快去搭！` : `${route} 約 ${Math.max(1, Math.round(sec / 60))} 分後到「${stop}」，該出門了！`);
function fireArrival(f) {
  const w = watch.w;
  if (!w) return;
  const text = arrivalText(w.routeName, w.stop, f.etaSec);
  stopWatch();
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('阿幫：公車快到站', { body: text, icon: '/icons/icon.svg', tag: 'abang-arrival' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* 不支援 */ }
  signal('abang:arrival', { text }); // App 顯示 toast（沒開通知權限時也看得到）
}
async function pollWatch(callTool) {
  const w = watch.w;
  if (!w) return;
  if (Date.now() > watch.until) { stopWatch(); return; }
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
    if (left <= 0) fireArrival(f);
    else if (left * 1000 < POLL_MS + 5000) watch.fire = setTimeout(() => fireArrival({ ...f, etaSec: w.minutes * 60 }), left * 1000); // 兩次更新之間到點也準時提醒
  } catch { /* 暫時查不到：下次再試 */ }
}

/**
 * @param {{ base?: string, ask?: (text: string) => void, setContext?: (text: string) => void, confirm?: (text: string) => boolean }} [opts]
 * @returns {import('./host.js').Host}
 */
export function createWebHost({ base = '', ask, setContext, confirm = (m) => window.confirm(m) } = {}) {
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
      if (typeof Notification === 'undefined') return false;
      const [h, m] = String(at).split(':').map(Number);
      const when = new Date(); when.setHours(h, m, 0, 0);
      const delay = when.getTime() - Date.now();
      if (!(delay > 0 && delay < 12 * 3600e3)) return false;
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
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
      stopWatch();
      watch.w = { ...w, first: true, skip: null };
      watch.until = Date.now() + MAX_MS;
      signal('abang:arrival-watch', watch.w);
      const call = (n, a) => this.callTool(n, a);
      await pollWatch(call);
      if (watch.w) watch.poll = setInterval(() => pollWatch(call), POLL_MS);
      return true;
    },
    unwatchArrival: stopWatch,
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
