// 網頁 agent 客戶端（M5-07）：讀 /api/v1/agent 的 NDJSON 串流，逐一回呼事件；
// 收到 client_tool_call 時在裝置端執行（device_location），帶 clientToolResults 重送同一個請求（最多 2 次）。
// 瀏覽器與 Node 20 皆可用（fetch、TextDecoder、ReadableStream）。座標只送回本站伺服器，不寫入任何紀錄。

export const CLIENT_TOOLS = ['device_location'];
const MAX_CLIENT_ROUNDS = 2;

/** 瀏覽器定位（5 秒逾時；拒絕或失敗回 null） */
export function browserLocation(timeout = 5000) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => resolve(null),
    { timeout, maximumAge: 60_000, enableHighAccuracy: false },
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
export async function runAgent(body, onEvent, { base = '', agentId = 'life', locate = browserLocation, signal } = {}) {
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
      } else results.push({ id: c.id, ok: false });
    }
    clientToolResults = [...clientToolResults, ...results];
  }
}
