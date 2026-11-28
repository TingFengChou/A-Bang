// 網頁 host（CARDS.md §3）：callTool → POST /api/v1/tools/:name；L2 連結先確認再開新分頁。
// MCP Apps 版（host-mcp-app.js）於 M4-04 實作。

import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify, NOTIFY_ID, EARLY_MS } from '../../js/native-notify.js';
import { startWatchService, stopWatchService, watchServiceStatus, updateWatchService, watchLine } from '../../js/native-watch.js';
import { addReminder, cancelReminder, notifyState, reminderFor, canNotify, listReminders, MAX_REMINDERS } from '../../js/reminders.js';
import { isAppLink, isStoreLink } from '../../../core/drama-say.js';
import { addCalendar, share } from '../../js/device-actions.js';

// 到站提醒（L-14）：整個頁面共用一個；SPA 換頁仍繼續，網頁版關掉就停止（網頁沒有背景推播）。
// 手機 App（M11-02）：每次查到到站時間，就把「該出門了」的本機通知排到預估的時間（同一則覆蓋更新）；
// App 到背景或被關掉時，系統照最後一次的預估送出。
// 每 20 秒查一次上車站的到站時間（bus_route_eta 的 focus），剩下時間 ≤ 設定的分鐘數就通知一次後結束。
// 設定時這班已經在提醒範圍內（趕不上）→ 跳過這班，等到站時間跳回大數字（下一班）再開始算。
const POLL_MS = 20_000, MAX_MS = 90 * 60_000;
// service：Android 常駐服務自己查、自己響；live：iOS 即時動態只顯示，App 開著時由這裡更新（提醒照舊靠排好的通知）
const watch = { w: null, poll: null, fire: null, until: 0, at: 0, nativeAt: 0, service: false, live: false };
// App 的通知能不能在背景送（權限被拒或排程失敗 → false，畫面就不能寫「App 關著也會提醒」）
const native = { granted: null, failed: false };
const canBackground = () => hasNativeNotify() && native.granted !== false && !native.failed;
// App 被系統關掉再打開：恢復提醒（只存路線與站，不存位置）
const STORE = 'abang.arrivalWatch';
const store = {
  save: () => { try { if (hasNativeNotify() && watch.w) localStorage.setItem(STORE, JSON.stringify({ w: { city: watch.w.city, routeName: watch.w.routeName, stop: watch.w.stop, direction: watch.w.direction, minutes: watch.w.minutes, ...(watch.w.trip && { trip: watch.w.trip }), ...(watch.w.lang && { lang: watch.w.lang }) }, until: watch.until, at: watch.at || 0, nativeAt: watch.nativeAt || 0 })); } catch { /* 無痕或停用 */ } },
  clear: () => { try { localStorage.removeItem(STORE); } catch { /* 無痕或停用 */ } },
  load: () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } },
};
let resumed = false;

/** 沒裝 App 時多久改開商店頁（毫秒）：開得了 App 的話畫面會在這之前離開（visibilitychange／pagehide） */
export const STORE_FALLBACK_MS = 1600;
/** 商店頁：iPhone／iPad 用 App Store，其他用 Google Play（沒有就用另一個）；只收 https */
export function storePage(store, ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  if (!store) return null;
  const ios = /iPhone|iPad|iPod/i.test(ua) || globalThis.Capacitor?.getPlatform?.() === 'ios';
  const u = ios ? store.ios || store.android : store.android || store.ios;
  return isStoreLink(u) ? u : null;
}
/**
 * 開合作 App（目前只有 MyDrama 看短劇，ADR-0019）：連結格式由伺服器設定（環境變數），這裡再檢查一次（只收安全的 App 連結、https 商店頁）。
 * 先開 App；1.6 秒內畫面沒離開＝沒裝（或開不了），改開商店頁。不帶使用者資料。
 * @param {{ app?: string|null, store?: { ios: string|null, android: string|null }|null }} target
 * @returns {'app'|'store'|null} 做了什麼（測試用）
 */
export function openApp({ app, store } = {}, { win = globalThis.window, doc = globalThis.document, wait = STORE_FALLBACK_MS } = {}) {
  const shop = storePage(store);
  const link = isAppLink(app) ? app : null;
  // 計時器裡的 window.open 可能被擋（iOS Safari 等）：被擋就在這一頁開商店頁
  const openShop = () => { const w = win.open(shop, '_blank'); if (w) { try { w.opener = null; } catch { /* 跨來源 */ } } else win.location.href = shop; };
  if (!link) { if (shop) openShop(); return shop ? 'store' : null; }
  let left = false;
  const away = () => { if (doc.visibilityState === 'hidden') left = true; };
  const gone = () => { left = true; };
  doc.addEventListener('visibilitychange', away);
  win.addEventListener('pagehide', gone);
  win.setTimeout(() => {
    doc.removeEventListener('visibilitychange', away);
    win.removeEventListener('pagehide', gone);
    if (!left && shop) openShop();
  }, wait);
  if (/^https:\/\//i.test(link)) win.open(link, '_blank', 'noopener'); // universal link／app link
  else win.location.href = link; // 自訂 scheme：App 內 WebView 交給系統開 App
  return 'app';
}

/** 目前的到站提醒（不用建 host；進行中列用） */
export const currentArrivalWatch = () => watch.w;
const signal = (type, detail) => { try { window.dispatchEvent(new CustomEvent(type, { detail })); } catch { /* 非瀏覽器 */ } };
/** 取消現在的到站提醒（B 方案：改坐別的之前，舊公車的提醒不要再響；P1-5 v2） */
export const cancelArrivalWatch = () => { if (watch.w) stopWatch(); };
function stopWatch({ cancel = true, keepService = false } = {}) {
  clearInterval(watch.poll); clearTimeout(watch.fire);
  // keepService：App 在背景、畫面這邊先算到該提醒了——讓 Android 常駐服務自己響、自己結束（停掉它就沒人響了，審查 2026-11-23）
  if (watch.service || watch.live) { const stop = !(keepService && watch.service); watch.service = false; watch.live = false; if (stop) stopWatchService(); } // Android 常駐服務／iOS 即時動態一起停（App 內提醒過、取消、逾時、末班已過）
  watch.w = null;
  if (cancel && watch.nativeAt) cancelNotify(NOTIFY_ID.arrival); // 使用者取消或逾時：排好的通知一起取消
  watch.nativeAt = 0;
  store.clear();
  signal('abang:arrival-watch', null);
}
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** 通知標題與內文（鎖定畫面先看到「該出門了」；預估時間放最後） */
export const NOTIFY_TITLE = '阿幫：該出門了';
export const STUCK_TITLE = '阿幫：公車一直不來';
/** 「307 一直不來，可以到「問阿幫」改其他方式」 */
export const stuckText = (w) => (w.lang === 'en' ? `Bus ${w.routeName} ${w.stuck === 'late' ? 'is running 10+ min late' : "isn't coming"}. Ask Abang for another way.` : `${w.routeName} ${w.stuck === 'late' ? '比預估晚了 10 分以上' : '一直沒有要來'}，可以到「問阿幫」改其他方式`);
/** 改其他方式要送給阿幫的話：知道行程目的地就帶上（換頁後對話不在了也能重算） */
export const stuckAsk = (w) => (w.lang === 'en' ? (w.trip?.to ? `No bus, find another way to ${w.trip.to}` : "The bus isn't coming. No bus, find another way") : w.trip?.to ? `不要坐公車，改別的方式去${w.trip.to}` : '不要坐公車了，改別的方式');
export const NOTIFY_TITLE_EN = 'Abang: time to go';
export const STUCK_TITLE_EN = 'Abang: bus not coming';
export const ARRIVING_TITLE_EN = 'Abang: bus arriving';
export const nativeBody = (route, stop, minutes, at = new Date(), lang = null) => (lang === 'en' ? `Bus ${route} reaches ${stop} in about ${minutes} min (estimated at ${hm(at)})` : `${route} 約 ${minutes} 分後到「${stop}」（${hm(at)} 的預估）`);
/** App：把「該出門了」排到 at（提早 EARLY_MS 吸收一般排程的延遲；差不到 20 秒就不重排；失敗下次再試） */
function planNative(w, at) {
  if (Math.abs(at - watch.nativeAt) < 20_000) return;
  watch.nativeAt = at;
  store.save(); // 記下排好的時間：App 被關掉、通知響過再打開時不要再提醒一次（前端審查 #1）
  scheduleNotify(NOTIFY_ID.arrival, new Date(at - EARLY_MS), w.lang === 'en' ? NOTIFY_TITLE_EN : NOTIFY_TITLE, nativeBody(w.routeName, w.stop, w.minutes, new Date(), w.lang)).then((ok) => {
    if (ok) { if (native.failed) { native.failed = false; signal('abang:arrival-watch', watch.w); } return; }
    if (watch.w === w) watch.nativeAt = 0;
    if (!native.failed) { native.failed = true; signal('abang:arrival-watch', watch.w); } // 畫面改說「App 開著時才會提醒」
  });
}
/** 「601 約 3 分後到「西門」，該出門了！」；不到 1 分：「601 在「西門」進站中，快去搭！」 */
export const arrivalText = (route, stop, sec, lang = null) => (lang === 'en'
  ? (sec < 60 ? `Bus ${route} is arriving at ${stop}. Go now!` : `Bus ${route} reaches ${stop} in about ${Math.max(1, Math.round(sec / 60))} min. Time to go!`)
  : (sec < 60 ? `${route} 在「${stop}」進站中，快去搭！` : `${route} 約 ${Math.max(1, Math.round(sec / 60))} 分後到「${stop}」，該出門了！`));
function fireArrival(f) {
  const w = watch.w;
  if (!w) return;
  const text = arrivalText(w.routeName, w.stop, f.etaSec, w.lang);
  const planned = watch.nativeAt;
  const svc = watch.service;
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  stopWatch({ cancel: false, keepService: !visible });
  if (hasNativeNotify()) {
    // 前景：畫面上的提醒（toast）就夠了，排好的通知取消（不要同一件事出現兩次）
    // 背景：排好的通知在 5 秒內會送（或剛送過）就不重複；車比預估早到 → 改成馬上送
    if (visible) { if (planned) cancelNotify(NOTIFY_ID.arrival); }
    else if (!svc && (!planned || planned > Date.now() + 5000)) scheduleNotify(NOTIFY_ID.arrival, new Date(), w.lang === 'en' ? NOTIFY_TITLE_EN : NOTIFY_TITLE, text); // 常駐服務在跑：它自己會響，不重複
  } else {
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(w.lang === 'en' ? ARRIVING_TITLE_EN : '阿幫：公車快到站', { body: text, icon: '/icons/icon.svg', tag: 'abang-arrival' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* 不支援 */ }
  signal('abang:arrival', { text }); // App 顯示 toast（沒開通知權限時也看得到）
}
/** 公車一直不來（S15）：預估抵達比第一次說的晚 10 分以上；末班已過／今日未營運；未發車超過 10 分鐘；交管不停靠 */
export const LATE_SEC = 600;
export const NOT_DEPARTED_MS = 10 * 60_000;
/**
 * 盯著的這班是不是「一直不來」。
 * @param {{ base?: { etaSec: number, at: number }|null, notDepartedSince?: number|null }} w  盯的狀態（會被更新）
 * @param {{ status: number, etaSec: number|null }} f  上車站這次的到站資訊（status：0 正常、1 尚未發車、2 交管不停靠、3 末班已過、4 今日未營運）
 * @returns {'late'|'notRunning'|'notDeparted'|'noStop'|null}
 */
export function stuckReason(w, f, now = Date.now()) {
  if (f.status === 3 || f.status === 4) return 'notRunning'; // 確定不會來：馬上說
  if (f.status === 2) return 'noStop';
  if (f.status !== 0 || f.etaSec == null) { // 尚未發車：起站附近幾分鐘很正常，超過 10 分鐘才說
    w.notDepartedSince ??= now;
    return now - w.notDepartedSince >= NOT_DEPARTED_MS ? 'notDeparted' : null;
  }
  w.notDepartedSince = null;
  if (!w.base) { w.base = { etaSec: f.etaSec, at: now }; return null; }
  const expected = w.base.etaSec - (now - w.base.at) / 1000; // 照第一次預估，現在應該剩幾秒（過了就是負的）
  return f.etaSec - expected >= LATE_SEC ? 'late' : null; // 預估抵達時間往後延了多少
}

/** 查一次上車站到站時間（每 20 秒；測試直接呼叫） */
export async function pollWatch(callTool) {
  const w = watch.w;
  if (!w) return;
  if (Date.now() > watch.until) { stopWatch(); return; } // 90 分鐘還沒到：放棄（排好的通知也取消）
  if (watch.service) {
    const st = await watchServiceStatus();
    if (st && !st.active && (st.firedAt || st.endedAt)) { stopWatch({ cancel: false }); return; }
    if (st && !st.active) watch.service = false; // 服務被系統關掉（沒響、沒被取消）：改回畫面這邊查＋預排通知，不要變成永遠不響（審查 2026-11-23）
  } // 常駐服務已經提醒過、或末班已過自己取消了（App 關著時）：畫面跟著結束
  try {
    const r = await callTool('bus_route_eta', { city: w.city, routeName: w.routeName, stop: w.stop, ...(w.direction != null && { direction: w.direction }) });
    const f = r?.data?.focus;
    if (!f || watch.w !== w) return;
    w.last = { etaSec: f.etaSec, statusText: f.statusText, at: Date.now() };
    if (!w.stuck && !w.skip) {
      const why = stuckReason(w, f);
      if (why) { // 只說一次
        w.stuck = why;
        const ended = why === 'notRunning'; // 末班已過、今日未營運：這班不會來了，提醒自動取消（產品負責人 2026-11-22：過期的提醒要清掉）
        signal('abang:arrival-stuck', { routeName: w.routeName, stop: w.stop, reason: why, ask: stuckAsk(w), lang: w.lang || null, ...(ended && { ended: true }) });
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (hidden && hasNativeNotify()) scheduleNotify(NOTIFY_ID.stuck, new Date(), w.lang === 'en' ? STUCK_TITLE_EN : STUCK_TITLE, stuckText(w)); // App 在背景：畫面上的提示看不到
        if (ended) { stopWatch(); return; }
      }
    }
    signal('abang:arrival-watch', w);
    // iOS 即時動態：每次查到就更新（鎖定畫面倒數到預估到站）；App 在背景時 iOS 不讓查，停在最後一次的預估
    const live = (o) => { if (watch.live) updateWatchService({ text: watchLine(w, f, o), etaSec: f.status === 0 && !o?.skip ? f.etaSec : null }); }; // 這班來不及：不倒數這班
    if (f.status !== 0 || f.etaSec == null) { live(); return; } // 未發車、末班已過：繼續看下一次
    const left = f.etaSec - w.minutes * 60;
    if (w.skip) {
      // 跳過的那班開走後，到站時間會變大（下一班）
      if (f.etaSec > w.skip + 60) { w.skip = null; w.base = null; } // 下一班：延誤從這班重新算
      else { w.skip = f.etaSec; live({ skip: true }); signal('abang:arrival-watch', w); return; }
    } else if (w.first && left <= 0) {
      w.first = false; w.skip = f.etaSec; live({ skip: true }); signal('abang:arrival-watch', w); return;
    }
    w.first = false;
    if (left > 0) live();
    clearTimeout(watch.fire);
    if (left > 0 && hasNativeNotify() && !watch.service) planNative(w, Date.now() + left * 1000); // 常駐服務在跑：由它準時提醒
    if (left <= 0) fireArrival(f);
    else if (left * 1000 < POLL_MS + 5000) watch.fire = setTimeout(() => fireArrival({ ...f, etaSec: w.minutes * 60 }), left * 1000); // 兩次更新之間到點也準時提醒
  } catch { /* 暫時查不到：下次再試 */ }
}

/**
 * @param {{ base?: string, ask?: (text: string) => void, setContext?: (text: string) => void, confirm?: (text: string) => boolean }} [opts]
 * @returns {import('./host.js').Host}
 */
/**
 * 出門前檢核表（T-CHECKLIST，2026-11-28 Antigravity 第七輪）：去政府辦事的應備文件勾了哪幾項，只存在這支手機。
 * 鍵＝申辦項目 id；只存勾了第幾項（不存文件內容）；最多 20 份、30 天沒動就清掉。
 */
export const CHECKLIST_KEY = 'abang.checklist';
const CHECKLIST_MAX = 20, CHECKLIST_DAYS = 30;
function checklistStore() {
  let all;
  try { all = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || '{}') || {}; } catch { all = {}; }
  const fresh = Object.entries(all).filter(([, v]) => v && Array.isArray(v.done) && Date.now() - Number(v.at) < CHECKLIST_DAYS * 864e5);
  return Object.fromEntries(fresh.sort((a, b) => b[1].at - a[1].at).slice(0, CHECKLIST_MAX));
}
export function checklistGet(id) { return new Set((checklistStore()[String(id)]?.done || []).filter(Number.isInteger)); }
export function checklistSet(id, done) {
  const all = checklistStore();
  const list = [...done].filter(Number.isInteger).sort((a, b) => a - b);
  if (list.length) all[String(id)] = { done: list, at: Date.now() }; else delete all[String(id)];
  const keep = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CHECKLIST_MAX)); // 加了新的一份之後再剪（最多 20 份）
  try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(keep)); } catch { /* 無痕模式：這次畫面上還是勾得起來 */ }
}

export function createWebHost({ base = String(globalThis.__ABANG_API_BASE__ || '').replace(/\/+$/, ''), ask, setContext, confirm = (m) => window.confirm(m), tripContext } = {}) {
  const host = {
    kind: 'web', theme: 'light',
    async callTool(name, args) {
      let res;
      try {
        res = await fetch(`${base}/api/v1/tools/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args || {}), signal: AbortSignal.timeout?.(15000) });
      } catch { throw new Error('目前連不上網路，連上後再試一次'); } // Safari 是英文「Load failed」
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    },
    ...(ask && { ask }), // 沒有對話的頁面（公車頁）不給：卡片上要問阿幫的按鈕就不顯示
    setContext: setContext || (() => {}),
    /**
     * 出門提醒（UX.md §6、T7）：今天 HH:mm（裝置時間）。可以有多筆、可以取消（public/js/reminders.js）。
     * 手機 App 用系統本機通知（App 關著也會響）；網頁要允許通知、頁面開著才會響。
     * @returns {Promise<string|false>} 提醒 id（可傳給 cancelRemind）；失敗回 false
     */
    async remind(at, text, meta) {
      // at 是台灣時間（伺服器算的）：不看裝置時區（觀光客手機可能是別的時區，PR #50 審查）
      const [h, m] = String(at).split(':').map(Number);
      const tw = new Date(Date.now() + 8 * 3600e3);
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meta?.date || ''); // 指定哪一天（明早帶傘）；沒給＝今天
      const when = d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], h - 8, m)) : new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate(), h - 8, m));
      const { date: _d, ...rest } = meta || {};
      return addReminder(when, text, rest);
    },
    /** 出門前檢核表（T-CHECKLIST）：去政府辦事的應備文件勾了哪幾項（只存在手機） */
    checklist: { get: (id) => checklistGet(id), set: (id, done) => checklistSet(id, done) },
    /** 這段路線目前的出門提醒（卡片重畫、重新規劃後也知道已經設了） */
    reminderFor: (key) => reminderFor(key),
    /** 提醒已經滿了（設不了新的時卡片照實說） */
    remindersFull: () => listReminders().length >= MAX_REMINDERS,
    /** 這個裝置能不能發通知（iOS Safari 沒加到主畫面就不能：不顯示提醒按鈕） */
    get canNotify() { return canNotify(); },
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
      if (w.until == null) signal('abang:choice', { role: 'bus' }); // 設到站提醒＝選了公車（habits.js；App 重開恢復的不算）
      const trip = w.trip || tripContext?.(); // 問阿幫規劃的行程目的地（公車一直不來時改其他方式用）
      watch.w = { ...w, ...(trip?.to && { trip: { to: trip.to } }), first: true, skip: null };
      watch.until = w.until ?? Date.now() + MAX_MS;
      watch.at = w.at ?? Date.now(); // 設定的時間（恢復時拿來比對常駐服務是不是已經響過）
      store.save();
      // Android：通知列常駐、App 關著也每 20 秒查真實到站時間；iOS：鎖定畫面與動態島的即時動態（沒有通知權限就不顯示：到點不會響，不能說「會提醒你」）
      const kind = native.granted !== false && await startWatchService({ ...watch.w, until: watch.until });
      watch.service = kind === 'service'; watch.live = kind === 'live';
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
    /** 加到行事曆（ADR-0021）：App 開系統的新增行程畫面（使用者按加入才寫入），網頁下載 .ics */
    addCalendar: (event) => addCalendar(event),
    /** 分享（ADR-0021）：App 開系統分享面板（使用者自己選對象），網頁用 Web Share，不支援就複製 */
    share: (payload) => share(payload),
    /** 開合作 App（MyDrama，ADR-0019）：先開 App 連結，沒裝（畫面一直沒離開）就到商店頁 */
    openApp: (target) => openApp(target),
  };
  // App 被系統關掉再打開：恢復上次的到站提醒（沒過期才恢復；過期就清掉並取消排好的通知）
  if (!resumed && hasNativeNotify()) {
    resumed = true;
    const saved = store.load();
    if (saved?.w && saved.until > Date.now() && !watch.w) {
      // 已經提醒過（排好的通知時間過了、或常駐服務已經響過／結束）就不恢復：恢復會把這班當「來不及」改等下一班、再提醒一次（前端審查 #1）
      (async () => {
        const st = await watchServiceStatus().catch(() => null);
        const firedNative = saved.nativeAt > 0 && saved.nativeAt <= Date.now();
        const firedSvc = !!st && !st.active && Math.max(st.firedAt || 0, st.endedAt || 0) >= (saved.at || 0) && (saved.at || 0) > 0;
        if (firedNative || firedSvc) { store.clear(); return; }
        await host.watchArrival({ ...saved.w, until: saved.until, at: saved.at });
      })().catch(() => {});
    } else if (saved) { store.clear(); cancelNotify(NOTIFY_ID.arrival); }
  }
  return host;
}
