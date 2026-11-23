// iOS 模擬器的 Web Inspector 用戶端（T8c；只給 scripts/smoke-ios.js 用，不在 CI、不進 App）。
// 模擬器的 webinspectord 在本機 unix socket（com.apple.webinspectord_sim.socket），訊息是「4 位元組長度＋二進位 plist」，
// 跟 Safari「開發」選單用的是同一條通道；debug 版的 App 的 WKWebView 才看得到（Capacitor debug 建置預設 isInspectable）。
// 不加新依賴：二進位 plist 的編解碼在這裡（只做協定用得到的型別），Node 內建 net 連 socket。
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

// ── 二進位 plist（bplist00）──────────────────────────────────────────

/** 物件 → bplist00（支援 null、布林、整數、浮點、字串、Buffer、陣列、一般物件） */
export function encodeBplist(root) {
  const objs = [];
  const flatten = (v) => {
    const i = objs.length;
    objs.push(null);
    if (Array.isArray(v)) objs[i] = { t: 'arr', refs: v.map(flatten) };
    else if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined);
      objs[i] = { t: 'dict', keys: keys.map(flatten), vals: keys.map((k) => flatten(v[k])) };
    } else objs[i] = { t: 'val', v };
    return i;
  };
  flatten(root);
  const refSize = objs.length < 256 ? 1 : objs.length < 65536 ? 2 : 4;
  const uint = (n, size) => { const b = Buffer.alloc(size); b.writeUIntBE(n, 0, size); return b; };
  const head = (type, len) => (len < 15 ? Buffer.from([(type << 4) | len]) : Buffer.concat([Buffer.from([(type << 4) | 0xf, 0x13]), int64(len)]));
  const int64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return b; };
  const one = (o) => {
    if (o.t === 'arr') return Buffer.concat([head(0xa, o.refs.length), ...o.refs.map((r) => uint(r, refSize))]);
    if (o.t === 'dict') return Buffer.concat([head(0xd, o.keys.length), ...o.keys.map((r) => uint(r, refSize)), ...o.vals.map((r) => uint(r, refSize))]);
    const v = o.v;
    if (v == null) return Buffer.from([0x00]);
    if (v === false) return Buffer.from([0x08]);
    if (v === true) return Buffer.from([0x09]);
    if (typeof v === 'number' && Number.isInteger(v)) return Buffer.concat([Buffer.from([0x13]), int64(v)]);
    if (typeof v === 'number') { const b = Buffer.alloc(9); b[0] = 0x23; b.writeDoubleBE(v, 1); return b; }
    if (Buffer.isBuffer(v)) return Buffer.concat([head(0x4, v.length), v]);
    const s = String(v);
    if ([...s].every((c) => c.charCodeAt(0) < 0x80)) return Buffer.concat([head(0x5, s.length), Buffer.from(s, 'ascii')]);
    const le = Buffer.from(s, 'utf16le');
    for (let k = 0; k < le.length; k += 2) { const t = le[k]; le[k] = le[k + 1]; le[k + 1] = t; } // → UTF-16BE
    return Buffer.concat([head(0x6, le.length / 2), le]);
  };
  const parts = [Buffer.from('bplist00')];
  const offsets = [];
  let pos = 8;
  for (const o of objs) { const b = one(o); offsets.push(pos); parts.push(b); pos += b.length; }
  const offSize = pos < 256 ? 1 : pos < 65536 ? 2 : 4;
  parts.push(...offsets.map((o) => uint(o, offSize)));
  const trailer = Buffer.alloc(32);
  trailer[6] = offSize; trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objs.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(pos), 24);
  parts.push(trailer);
  return Buffer.concat(parts);
}

/** bplist00 → 物件（日期回 Date、UID 回 { UID }） */
export function decodeBplist(buf) {
  if (buf.toString('ascii', 0, 6) !== 'bplist') throw new Error('不是二進位 plist');
  const t = buf.length - 32;
  const offSize = buf[t + 6], refSize = buf[t + 7];
  const num = Number(buf.readBigUInt64BE(t + 8)), top = Number(buf.readBigUInt64BE(t + 16)), table = Number(buf.readBigUInt64BE(t + 24));
  const off = (i) => buf.readUIntBE(table + i * offSize, offSize);
  const intAt = (p, n) => (n === 8 ? Number(buf.readBigInt64BE(p)) : buf.readUIntBE(p, n));
  const read = (i, depth = 0) => {
    if (i >= num || depth > 64) throw new Error('plist 格式錯誤');
    let p = off(i);
    const m = buf[p], hi = m >> 4, lo = m & 0xf;
    const len = () => { if (lo !== 0xf) { p += 1; return lo; } const n = 1 << (buf[p + 1] & 0xf); const v = intAt(p + 2, n); p += 2 + n; return v; };
    switch (hi) {
      case 0x0: return lo === 0x9 ? true : lo === 0x8 ? false : null;
      case 0x1: return intAt(p + 1, 1 << lo);
      case 0x2: return lo === 2 ? buf.readFloatBE(p + 1) : buf.readDoubleBE(p + 1);
      case 0x3: return new Date((978307200 + buf.readDoubleBE(p + 1)) * 1000);
      case 0x4: { const n = len(); return Buffer.from(buf.subarray(p, p + n)); }
      case 0x5: { const n = len(); return buf.toString('ascii', p, p + n); }
      case 0x6: { const n = len(); const b = Buffer.from(buf.subarray(p, p + n * 2)); for (let k = 0; k < b.length; k += 2) { const x = b[k]; b[k] = b[k + 1]; b[k + 1] = x; } return b.toString('utf16le'); }
      case 0x8: return { UID: buf.readUIntBE(p + 1, lo + 1) };
      case 0xa: { const n = len(); return Array.from({ length: n }, (_, k) => read(buf.readUIntBE(p + k * refSize, refSize), depth + 1)); }
      case 0xd: {
        const n = len(); const o = {};
        for (let k = 0; k < n; k++) o[read(buf.readUIntBE(p + k * refSize, refSize), depth + 1)] = read(buf.readUIntBE(p + (n + k) * refSize, refSize), depth + 1);
        return o;
      }
      default: throw new Error(`plist 不支援的型別 0x${m.toString(16)}`);
    }
  };
  return read(top);
}

/** 從累積的位元組切出完整訊息（4 位元組大端長度＋plist）；回傳 [訊息們, 剩下的位元組] */
export function splitFrames(buf) {
  const out = [];
  while (buf.length >= 4) {
    const n = buf.readUInt32BE(0);
    if (buf.length < 4 + n) break;
    out.push(decodeBplist(buf.subarray(4, 4 + n)));
    buf = buf.subarray(4 + n);
  }
  return [out, buf];
}

export const frame = (msg) => { const b = encodeBplist(msg); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]); };

/** Console.messageAdded 的訊息 → 一行文字（console.error(物件) 的 text 只有「[object Object]」：展開參數的預覽） */
export function consoleText(m) {
  const obj = (o) => {
    if (!o) return '';
    if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
    const props = o.preview?.properties;
    if (props?.length) return `{ ${props.map((x) => `${x.name}: ${x.value ?? x.valuePreview?.description ?? x.type}`).join(', ')} }`;
    return o.description || o.className || o.type || '';
  };
  const params = (m.parameters || []).map(obj).filter(Boolean);
  const text = params.length && /\[object \w+\]/.test(m.text || '') ? params.join(' ') : m.text || params.join(' ');
  return m.url ? `${text}（${String(m.url).replace(/^capacitor:\/\/localhost/, '')}:${m.line || 0}）` : text;
}

// ── webinspectord 通道 ───────────────────────────────────────────────

/** 模擬器 webinspectord 的 socket 路徑（launchd 開的，路徑每次開機不同；用 lsof 找） */
export function simulatorSocket() {
  let out;
  try { out = execFileSync('lsof', ['-a', '-U', '-c', 'launchd_sim'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch (e) { out = String(e.stdout || ''); }
  if (!/webinspectord_sim/.test(out)) { try { out = execFileSync('lsof', ['-U'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { out = String(e.stdout || ''); } }
  return out.match(/\/\S*com\.apple\.webinspectord_sim\.socket/)?.[0] || null;
}

/**
 * 連到模擬器上某個 App 的 WKWebView 頁面，回傳可以跑 JavaScript、收 console 錯誤的物件。
 * 未簽章的模擬器建置（CODE_SIGNING_ALLOWED=NO）回報的 bundle id 是「process-App」，所以用行程 id 找（simctl launch 會印出 pid）。
 * @param {{ socket: string, pid?: number, bundleId?: string, pageUrl?: RegExp, timeoutMs?: number }} opt
 */
export async function attachPage({ socket, pid, bundleId, pageUrl = /^(capacitor|https?):\/\/localhost/, timeoutMs = 20000 }) {
  const conn = randomUUID().toUpperCase(), sender = randomUUID().toUpperCase();
  const sock = connect(socket);
  await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
  const send = (selector, arg) => sock.write(frame({ __selector: selector, __argument: { WIRConnectionIdentifierKey: conn, ...arg } }));
  const listeners = new Set();
  let pending = Buffer.alloc(0);
  sock.on('data', (d) => {
    let msgs;
    [msgs, pending] = splitFrames(Buffer.concat([pending, d]));
    for (const m of msgs) for (const l of [...listeners]) l(m);
  });
  sock.on('error', () => {});
  const waitMsg = (pred, ms, what) => new Promise((res, rej) => {
    const timer = setTimeout(() => { listeners.delete(l); rej(new Error(`${ms / 1000} 秒內沒有${what}`)); }, ms);
    const l = (m) => { const v = pred(m); if (v) { clearTimeout(timer); listeners.delete(l); res(v); } };
    listeners.add(l);
  });

  // 1. 找 App（WKWebView 在 App 自己的行程裡；Safari 等其他 App 不理）
  const apps = {};
  const appListed = waitMsg((m) => {
    const a = m.__argument || {};
    if (m.__selector === '_rpc_reportConnectedApplicationList:') Object.assign(apps, a.WIRApplicationDictionaryKey || {});
    if (m.__selector === '_rpc_applicationConnected:' || m.__selector === '_rpc_applicationUpdated:') apps[a.WIRApplicationIdentifierKey] = a;
    return Object.values(apps).find((x) => (pid && x.WIRApplicationIdentifierKey === `PID:${pid}`) || (bundleId && x.WIRApplicationBundleIdentifierKey === bundleId));
  }, timeoutMs, `看到 App（${pid ? `pid ${pid}` : bundleId}；有開著嗎？要 debug 版）`);
  send('_rpc_reportIdentifier:', {});
  send('_rpc_getConnectedApplications:', {});
  const app = await appListed;
  const appId = app.WIRApplicationIdentifierKey;

  // 2. 找頁面（WebView 剛起來時清單可能還是空的：每秒再問一次）
  const listed = waitMsg((m) => {
    if (m.__selector !== '_rpc_applicationSentListing:' || m.__argument?.WIRApplicationIdentifierKey !== appId) return null;
    return Object.values(m.__argument.WIRListingKey || {}).find((p) => /WIRTypeWeb/.test(p.WIRTypeKey || '') && pageUrl.test(p.WIRURLKey || ''));
  }, timeoutMs, '找到 App 的 WebView 頁面（Capacitor debug 版才可檢查）');
  const ask = () => send('_rpc_forwardGetListing:', { WIRApplicationIdentifierKey: appId });
  ask();
  const again = setInterval(ask, 1000);
  const pg = await listed.finally(() => clearInterval(again));
  const pageId = pg.WIRPageIdentifierKey;

  // 3. 開檢查通道；較新的 WebKit 用 Target 包一層（targetCreated 之後指令要經 Target.sendMessageToTarget）
  let target = null, nextId = 1;
  const replies = new Map(), errors = [], pendingErrors = [], onEvent = new Set();
  listeners.add((m) => {
    if (m.__selector !== '_rpc_applicationSentData:' || m.__argument?.WIRDestinationKey !== sender) return;
    let msg;
    try { msg = JSON.parse(Buffer.from(m.__argument.WIRMessageDataKey).toString('utf8')); } catch { return; }
    if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') { if (!msg.params.targetInfo.isProvisional || !target) target = msg.params.targetInfo.targetId; }
    else if (msg.method === 'Target.didCommitProvisionalTarget') target = msg.params.newTargetId;
    else if (msg.method === 'Target.dispatchMessageFromTarget') { try { msg = JSON.parse(msg.params.message); } catch { return; } }
    if (msg.id && replies.has(msg.id)) { replies.get(msg.id)(msg); replies.delete(msg.id); return; }
    if (msg.method === 'Console.messageAdded' && msg.params?.message?.level === 'error') pendingErrors.push(errorText(msg.params.message).then((t) => errors.push(`console: ${t}`)));
    for (const l of onEvent) l(msg);
  });
  send('_rpc_forwardSocketSetup:', { WIRApplicationIdentifierKey: appId, WIRPageIdentifierKey: pageId, WIRSenderKey: sender, WIRAutomaticallyPause: false });
  const deadline = Date.now() + 1500;
  while (!target && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const rawSend = (obj) => send('_rpc_forwardSocketData:', { WIRApplicationIdentifierKey: appId, WIRPageIdentifierKey: pageId, WIRSenderKey: sender, WIRSocketDataKey: Buffer.from(JSON.stringify(obj), 'utf8') });
  /** 送一個 Web Inspector 指令，等回覆 */
  const command = (method, params = {}, ms = 15000) => new Promise((res, rej) => {
    const id = nextId++;
    const timer = setTimeout(() => { replies.delete(id); rej(new Error(`${method} 逾時`)); }, ms);
    replies.set(id, (msg) => { clearTimeout(timer); if (msg.error) rej(new Error(`${method}：${msg.error.message}`)); else res(msg.result); });
    const inner = { id, method, params };
    if (target) rawSend({ id: nextId++, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(inner) } });
    else rawSend(inner);
  });
  await command('Console.enable').catch(() => {}); // 錯誤（含沒接住的例外）從這裡來

  /** 錯誤訊息的文字；沒有預覽的物件參數（例如 Capacitor 外掛被拒時記下的錯誤物件）向頁面要 JSON 內容 */
  async function errorText(m) {
    const parameters = await Promise.all((m.parameters || []).map(async (o) => {
      if (!o?.objectId || o.preview?.properties?.length) return o;
      try {
        const r = await command('Runtime.callFunctionOn', { objectId: o.objectId, functionDeclaration: 'function () { try { return this instanceof Error ? String(this) : JSON.stringify(this); } catch { return String(this); } }', returnByValue: true }, 3000);
        return { value: r.result?.value };
      } catch { return o; }
    }));
    return consoleText({ ...m, parameters });
  }
  /** 在頁面裡跑一段 JavaScript 運算式（可以是 Promise），回傳 JSON 值 */
  const evaluate = async (expression) => {
    const r = await command('Runtime.evaluate', { expression: `(async () => (${expression}))()`, objectGroup: 'smoke', returnByValue: false });
    if (r.wasThrown) throw new Error(r.result?.description || '執行失敗');
    const done = await command('Runtime.awaitPromise', { promiseObjectId: r.result.objectId, returnByValue: true });
    if (done.wasThrown) throw new Error(done.result?.description || done.result?.value || '執行失敗');
    return done.result?.value;
  };
  /** 等運算式為真（每 250ms 看一次） */
  const waitFor = async (expression, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await evaluate(expression)) return true; } catch { /* 頁面重新載入中 */ }
      if (Date.now() > end) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  return {
    url: pg.WIRURLKey, evaluate, waitFor, command,
    /** 到目前為止的 console 錯誤（等物件內容都取回來） */
    errors: async () => { await Promise.all(pendingErrors); return [...errors]; },
    close: () => { try { send('_rpc_forwardDidClose:', { WIRApplicationIdentifierKey: appId, WIRPageIdentifierKey: pageId, WIRSenderKey: sender }); } catch { /* 已斷 */ } sock.end(); },
  };
}
