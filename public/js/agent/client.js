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

/** 正在進行的原生定位（問阿幫先定位與 runAgent 同時要位置時共用，不發兩個原生呼叫） */
let pending = null;

/**
 * 定位（拒絕或失敗回 null）。座標只用來回答這一題，不存進伺服器 log。
 * @param {number} [timeout] 毫秒
 * @param {{ highAccuracy?: boolean, fresh?: boolean }} [opts] highAccuracy：附近站牌要精準（Android 12+ 才會要求「精確位置」）；fresh：不用 2 分鐘內的結果（「重新定位」）
 */
export function browserLocation(timeout = 5000, { highAccuracy = false, fresh = false } = {}) {
  if (!fresh && lastFix && Date.now() - lastFix.at < 120_000 && (lastFix.high || !highAccuracy)) return Promise.resolve(lastFix.pos);
  const keep = (lat, lon) => { const pos = { lat, lon }; lastFix = { pos, at: Date.now(), high: highAccuracy }; return pos; };
  const opts = { enableHighAccuracy: highAccuracy, timeout, maximumAge: fresh ? 0 : 60_000 };
  const c = nativeGeo();
  if (c) {
    if (pending && !fresh) return pending;
    let timer;
    pending = (async () => {
      // 第一次會跳系統權限框：使用者想一下的時間不算逾時（外掛的 timeout 從拿到權限後才開始）；已允許只多等 3 秒
      const granted = await nativeGranted(c).catch(() => false);
      const call = c.nativePromise('Geolocation', 'getCurrentPosition', opts)
        .then((p) => (Number.isFinite(p?.coords?.latitude) ? keep(p.coords.latitude, p.coords.longitude) : null)).catch(() => null);
      return Promise.race([call, new Promise((r) => { timer = setTimeout(() => r(null), timeout + (granted ? 3000 : 30_000)); })]);
    })().finally(() => { clearTimeout(timer); pending = null; });
    return pending;
  }
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => geo.getCurrentPosition(
    (p) => resolve(keep(p.coords.latitude, p.coords.longitude)),
    () => resolve(null),
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
        onEvent({ type: 'client_tool_result', id: c.id, name: c.name, ok: inTaiwan(loc), ...(loc && !inTaiwan(loc) && { reason: 'outside' }) });
      } else results.push({ id: c.id, ok: false });
    }
    clientToolResults = [...clientToolResults, ...results];
  }
}
