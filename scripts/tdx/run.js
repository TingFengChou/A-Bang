// M1 TDX 實測的共用執行器：讀 .env、建 TDX client、依序呼叫端點（每次間隔 --delay 秒），429 等到額度重置再試一次。
// 不印、不存金鑰與 token；錯誤訊息只取 TDX 回應的前 200 字（tdx-client.js）。
import { createTdxClient } from '../../core/tdx-client.js';
import { ENDPOINTS, parseArgs, rowsOf } from './endpoints.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 讀 .env（已用 node --env-file 帶入就不再讀）；沒有金鑰回 null */
export function keysFromEnv() {
  if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
    try { process.loadEnvFile?.(new URL('../../.env', import.meta.url)); } catch { /* 沒有 .env */ }
  }
  const { TDX_CLIENT_ID: clientId, TDX_CLIENT_SECRET: clientSecret } = process.env;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function noKeysExit(script) {
  console.error(`沒有 TDX 金鑰：請在 .env 設定 TDX_CLIENT_ID、TDX_CLIENT_SECRET（到 https://tdx.transportdata.tw 申請），再執行 node --env-file=.env scripts/${script}`);
  process.exit(1);
}

/** 把查詢字串的 %20 換成 +（驗證 OData 空白編碼用） */
const plusFetch = (url, opts) => fetch(String(url).includes('/token') ? url : String(url).replace(/%20/g, '+'), opts);

/**
 * 依序呼叫端點。
 * @param {{ clientId: string, clientSecret: string }} keys
 * @param {(r: { ep: object, status: number, data?: any, rows?: any[], error?: string, ctx: object }) => void | Promise<void>} onResult
 * @param {{ argv?: string[], filter?: (ep: object) => boolean }} [opts]
 */
export async function runEndpoints(keys, onResult, { argv = process.argv.slice(2), filter = () => true } = {}) {
  const { delaySec, only } = parseArgs(argv);
  const limit = { timeoutMs: 120000 };
  const tdx = createTdxClient({ ...keys, limit });
  const tdxPlus = createTdxClient({ ...keys, limit, fetchImpl: plusFetch });
  const ctx = {};
  const list = ENDPOINTS.filter((ep) => (!only || only.has(ep.id)) && filter(ep));
  console.log(`共 ${list.length} 個端點，每次間隔 ${delaySec} 秒（約 ${Math.ceil((list.length * delaySec) / 60)} 分鐘）`);
  let first = true;
  for (const ep of list) {
    if (!first) await sleep(delaySec * 1000);
    first = false;
    const path = typeof ep.path === 'function' ? ep.path(ctx) : ep.path;
    const query = typeof ep.query === 'function' ? ep.query(ctx) : ep.query || {};
    const client = ep.plus ? tdxPlus : tdx;
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await client.get(path, query, 1);
        res = { status: 200, data, rows: rowsOf(data) };
        break;
      } catch (e) {
        res = { status: e?.status || 0, error: String(e?.message || e) };
        if (e?.status !== 429 || attempt) break;
        // 額度用完（與其他程式共用）：等到這一分鐘重置再試一次，不連續重打
        const wait = Math.max(5000, client.quota().resetMs + 1500);
        console.log(`  · ${ep.id} 碰到 429，等 ${Math.ceil(wait / 1000)} 秒再試一次`);
        await sleep(wait);
      }
    }
    await onResult({ ep, ...res, ctx });
  }
}
