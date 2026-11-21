// 網頁 agent 客戶端（M5-07）：讀 /api/v1/agent 的 NDJSON 串流，逐一回呼事件；
// 收到 client_tool_call 時在裝置端執行（device_location），帶 clientToolResults 重送同一個請求（最多 2 次）。
// 瀏覽器與 Node 20 皆可用（fetch、TextDecoder、ReadableStream）。座標只送回本站伺服器，不寫入任何紀錄。
import { API_BASE } from '../base.js';

export const CLIENT_TOOLS = ['device_location'];
const MAX_CLIENT_ROUNDS = 2;

/** 最近一次的定位（2 分鐘內重用：起點預設是現在位置，連問幾題不用每次等定位） */
let lastFix = null;
/** 手機 App 的原生定位外掛（@capacitor/geolocation）：iOS 只問 App 權限一次，不會再跳 WebView 的「localhost 想使用你的位置」 */
const nativeGeo = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && c.isPluginAvailable?.('Geolocation') && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};

/** 台灣範圍（與伺服器 core/agent/run.js deviceLocation 相同）：範圍外伺服器不採用，畫面也不能說「拿到了」 */
export const inTaiwan = (p) => !!p && p.lat >= 21 && p.lat <= 27 && p.lon >= 118 && p.lon <= 123;

/** 原生外掛的權限是否已允許（Android 12+ 使用者可能只給「大概位置」：coarseLocation） */
const nativeGranted = async (c) => {
  const r = await c.nativePromise('Geolocation', 'checkPermissions', {});
  return r?.location === 'granted' || r?.coarseLocation === 'granted';
};

/** 定位權限是否已允許（App：原生外掛；網頁：Permissions API）；不確定回 false */
export async function locationGranted() {
  const c = nativeGeo();
  try {
    if (c) return await nativeGranted(c);
    return (await globalThis.navigator?.permissions?.query({ name: 'geolocation' }))?.state === 'granted';
  } catch { return false; }
}

/**
 * 定位失敗的原因（S1c）：denied 權限沒開、off 手機定位服務關閉、timeout 太久沒回應、unavailable 其他。
 * 原生外掛的錯誤碼（@capacitor/geolocation，iOS 與 Android 相同）：OS-PLUG-GLOC-0003／0008 拒絕或受限、0007／0009／0017 定位服務關閉、0010 逾時。
 * 網頁：GeolocationPositionError 1 拒絕、2 拿不到、3 逾時。
 * @returns {'denied'|'off'|'timeout'|'unavailable'}
 */
export function locationReason(err) {
  const n = Number(/^OS-PLUG-GLOC-(\d+)$/.exec(String(err?.code ?? ''))?.[1]);
  if (Number.isFinite(n)) return n === 3 || n === 8 ? 'denied' : n === 7 || n === 9 || n === 17 ? 'off' : n === 10 ? 'timeout' : 'unavailable';
  if (err?.code === 1) return 'denied';
  if (err?.code === 3) return 'timeout';
  const m = String(err?.message || '');
  return /denied/i.test(m) && !/enable/i.test(m) ? 'denied' : /not enabled|turned off|disabled|enable location/i.test(m) ? 'off' : /time/i.test(m) ? 'timeout' : 'unavailable';
}
/** 最近一次定位失敗的原因（成功後清掉）；畫面用來說明怎麼辦 */
let lastError = null;
export const lastLocationError = () => lastError;
/** 第幾次定位：只有最新一次、還沒結束的定位能寫 lastError（被逾時放棄的舊呼叫晚到不蓋掉） */
let attempt = 0;

/** 正在進行的原生定位（問阿幫先定位與 runAgent 同時要位置時共用，不發兩個原生呼叫） */
let pending = null;

/**
 * 定位（拒絕或失敗回 null）。座標只用來回答這一題，不存進伺服器 log。
 * @param {number} [timeout] 毫秒
 * @param {{ highAccuracy?: boolean, fresh?: boolean }} [opts] highAccuracy：附近站牌要精準（Android 12+ 才會要求「精確位置」）；fresh：不用 2 分鐘內的結果（「重新定位」）
 */
export function browserLocation(timeout = 5000, { highAccuracy = false, fresh = false, withAccuracy = false } = {}) {
  if (!fresh && lastFix && Date.now() - lastFix.at < 120_000 && (lastFix.high || !highAccuracy)) return Promise.resolve(lastFix.pos);
  // withAccuracy：多回誤差公尺數（設定常用地點時檢查「大概位置」）；一般定位不帶，送給伺服器的還是只有 lat／lon
  if (pending && !fresh && nativeGeo()) return pending; // 共用進行中的原生定位（不算新的一次）
  const my = ++attempt;
  let settled = false;
  const fail = (why) => { if (!settled && my === attempt) lastError = why; settled = true; return null; };
  const keep = (lat, lon, acc) => { const pos = { lat, lon }; lastFix = { pos, at: Date.now(), high: highAccuracy }; if (my === attempt) lastError = null; settled = true; return withAccuracy ? { ...pos, accuracy: Number.isFinite(acc) ? acc : null } : pos; };
  const opts = { enableHighAccuracy: highAccuracy, timeout, maximumAge: fresh ? 0 : 60_000 };
  const c = nativeGeo();
  if (c) {
    let timer;
    const p = (async () => {
      // 第一次會跳系統權限框：使用者想一下的時間不算逾時（外掛的 timeout 從拿到權限後才開始）；已允許只多等 3 秒
      const granted = await nativeGranted(c).catch(() => false);
      const call = c.nativePromise('Geolocation', 'getCurrentPosition', opts)
        .then((r) => (Number.isFinite(r?.coords?.latitude) ? keep(r.coords.latitude, r.coords.longitude, r.coords.accuracy) : fail('unavailable')))
        .catch((e) => fail(locationReason(e)));
      return Promise.race([call, new Promise((r) => { timer = setTimeout(() => r(fail('timeout')), timeout + (granted ? 3000 : 30_000)); })]);
    })().finally(() => { clearTimeout(timer); if (pending === p) pending = null; }); // fresh 另起的呼叫不被舊的清掉
    if (!fresh) pending = p;
    return p;
  }
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return Promise.resolve(fail('unavailable'));
  return new Promise((resolve) => geo.getCurrentPosition(
    (p) => resolve(keep(p.coords.latitude, p.coords.longitude, p.coords.accuracy)),
    (e) => resolve(fail(locationReason(e))),
    opts,
  ));
}

/** 逐行解析 NDJSON 串流 */
async function* readNdjson(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/**
 * 送出一輪對話。
 * @param {{ messages: Array<{ role: string, content: string }>, userState?: object, context?: string }} body
 * @param {(e: object) => void} onEvent 每個事件（含 client_tool_call 本身，讓畫面顯示「定位中」）
 * @param {{ base?: string, agentId?: string, locate?: () => Promise<{ lat: number, lon: number } | null>, signal?: AbortSignal }} [opts] agentId：預設生活 agent
 */
export async function runAgent(body, onEvent, { base = API_BASE, agentId = 'life', locate = browserLocation, signal } = {}) {
  let clientToolResults = [];
  for (let round = 0; round <= MAX_CLIENT_ROUNDS; round++) {
    const res = await fetch(`${base}/api/v1/agent${agentId === 'life' ? '' : `/${encodeURIComponent(agentId)}`}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ ...body, clientTools: CLIENT_TOOLS, ...(clientToolResults.length && { clientToolResults }) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onEvent({ type: 'error', message: err.error || `HTTP ${res.status}`, retryable: res.status === 429, ...(err.retryAfterSec && { retryAfterSec: err.retryAfterSec }) });
      return;
    }
    const pending = [];
    for await (const e of readNdjson(res)) {
      onEvent(e);
      if (e.type === 'client_tool_call') pending.push(e);
    }
    if (!pending.length) return;
    const results = [];
    for (const c of pending) {
      if (c.name === 'device_location') {
        const loc = await locate();
        results.push(loc ? { id: c.id, ok: true, result: loc } : { id: c.id, ok: false });
        // 只給畫面用（不含座標）；台灣以外伺服器不採用，畫面要一致
        onEvent({ type: 'client_tool_result', id: c.id, name: c.name, ok: inTaiwan(loc), ...(loc && !inTaiwan(loc) ? { reason: 'outside' } : !loc && lastError && { reason: lastError }) }); // reason：畫面說明原因（S1c）
      } else results.push({ id: c.id, ok: false });
    }
    clientToolResults = [...clientToolResults, ...results];
  }
}
