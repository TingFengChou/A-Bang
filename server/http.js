#!/usr/bin/env node
// 阿幫 HTTP 伺服器（零框架，Node 20+）
//   /api/v1/*            REST：PWA 頁面、卡片刷新（/api/v1/tools/:name）
//   /api/docs            API 文件（Swagger UI，規格 /api/v1/openapi.json）
//   /mcp、/mcp/:pack     遠端 MCP（Streamable HTTP，stateless）— Claude 自訂連接器
//   /healthz             健康檢查（容器、Cloud Run；不限流、不碰上游）
//   其他                 PWA 靜態檔
// TDX 金鑰只存在伺服器端，瀏覽器與 MCP client 都拿不到。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServices, loadEnv } from '../core/index.js';
import { listPacks, callTool } from '../core/tools/index.js';
import { UserError, publicMessage } from '../core/util.js';
import { createMcpServer } from '../mcp/create-server.js';
import { createRateLimiter, clientIp } from './rate-limit.js';
import { restRoutes } from './rest.js';
import { buildOpenApi } from './openapi.js';
import { createAgentHandler } from './agent.js';
import { judgeFromEnv } from '../core/agent/judge.js';
import { checkRequest } from '../core/agent/suggest-check.js';
import { createLogger, routeOf } from './log.js';
import { hasProfile } from '../core/agents/index.js';

const log = createLogger(); // 一行一個 JSON（M6-02）
const VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;

const svc = createServices({ ...(await loadEnv()), log: (m) => log.info(m) });
const PORT = Number(process.env.PORT) || 8787;
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 64 * 1024;

const limiters = {
  api: createRateLimiter({ limit: Number(process.env.RATE_LIMIT_API) || 120 }),
  mcp: createRateLimiter({ limit: Number(process.env.RATE_LIMIT_MCP) || 60 }),
};

// REST 路由表在 server/rest.js（同時產生 Swagger 文件）
// agent 計量 log：模式、次數、耗時、token；不含對話內容與座標（AGENT.md §7）
// 判斷層（core/agent/judge.js）：嵌入分類器在背景載入（首次會下載約 120 MB 模型），載入前與載入失敗時都退回規則；JUDGE=off 關閉
const judgeSetup = judgeFromEnv(process.env, { log: ({ message, ...o }) => log.info(message, o) });
const agent = createAgentHandler({ svc, judge: judgeSetup.judge, log: ({ agent: agentId, ...o }) => log.info('agent request', { agentId, ...o }) }); // 模式依 env（ADR-0012）
// /api/v1/status 的 agent：由誰回答（claude／local／demo、模型名稱）與判斷層成員（嵌入分類器、伺服器模型有沒有）；「阿幫的腦袋」頁（#/ai）照實顯示。不含金鑰與網址
const routes = restRoutes(svc, { agentInfo: () => { const j = judgeSetup.info(); return { ...agent.mode, judge: { embed: Boolean(j.embed), llm: Boolean(j.llm) } }; } });
const OPENAPI = JSON.stringify(buildOpenApi(svc));
// Swagger UI：只提供這幾個檔（白名單，不開放整個 node_modules）
const SWAGGER_DIR = fileURLToPath(new URL('../node_modules/swagger-ui-dist/', import.meta.url));
const SWAGGER_FILES = { 'swagger-ui.css': 'text/css; charset=utf-8', 'swagger-ui-bundle.js': 'text/javascript; charset=utf-8' };
// 前端動畫套件（GSAP，Standard no-charge license）：同樣只開放白名單檔案，讀一次就快取
const VENDOR_DIR = fileURLToPath(new URL('../node_modules/gsap/dist/', import.meta.url));
const VENDOR_FILES = { 'gsap.min.js': 1, 'MotionPathPlugin.min.js': 1, 'Flip.min.js': 1 };
const vendorCache = new Map();
const vendorFile = (name) => {
  if (!vendorCache.has(name)) vendorCache.set(name, readFile(join(VENDOR_DIR, name)).catch((e) => { vendorCache.delete(name); throw e; }));
  return vendorCache.get(name);
};
const swaggerCache = new Map(); // 檔名 → Promise<Buffer>：只讀一次磁碟（約 1.5 MB）
const swaggerFile = (name) => {
  if (!swaggerCache.has(name)) swaggerCache.set(name, readFile(join(SWAGGER_DIR, name)).catch((e) => { swaggerCache.delete(name); throw e; }));
  return swaggerCache.get(name);
};
const DOCS_HTML = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>阿幫 API 文件</title><link rel="stylesheet" href="/api/docs/swagger-ui.css"></head><body><div id="ui"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script src="/api/docs/init.js"></script></body></html>`;
// 前端共用的核心純函式（決策圖即時重算用同一份 decide.js，UX.md §5）：只開放白名單檔案
const SHARED_CORE = { 'decide.js': fileURLToPath(new URL('../core/decide.js', import.meta.url)), 'vision-text.js': fileURLToPath(new URL('../core/vision-text.js', import.meta.url)), 'edge-write.js': fileURLToPath(new URL('../core/edge-write.js', import.meta.url)), 'output-guards.js': fileURLToPath(new URL('../core/output-guards.js', import.meta.url)), 'drama-say.js': fileURLToPath(new URL('../core/drama-say.js', import.meta.url)), 'suggest.js': fileURLToPath(new URL('../core/suggest.js', import.meta.url)), 'edge-ask.js': fileURLToPath(new URL('../core/edge-ask.js', import.meta.url)) }; // vision-text：阿幫會看在手機上分類讀到的字（M14-02）；edge-write：手機寫的回答的程式護欄（ADR-0017）；drama-say：短劇連結檢查與句子（ADR-0019）；edge-ask：手機上的 AI 出的題目的形狀檢查（ADR-0020）
const DOCS_INIT = "window.ui = SwaggerUIBundle({ url: '/api/v1/openapi.json', dom_id: '#ui', deepLinking: true, tryItOutEnabled: true });";

// 手機 App（ADR-0013）的 WebView 來源：問阿幫端點只對這些來源加 CORS（不用 *）
const APP_ORIGINS = new Set((process.env.APP_ORIGINS ?? 'capacitor://localhost,https://localhost').split(',').map((s) => s.trim()).filter(Boolean));
const appCors = (req) => {
  const o = req.headers.origin;
  return o && APP_ORIGINS.has(o) ? { 'access-control-allow-origin': o, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' } : { vary: 'Origin' };
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const t0 = Date.now();
  // 存取 log：方法、路徑（不含 query：可能有座標）、狀態碼、耗時；健康檢查不記
  if (path !== '/healthz') res.on('finish', () => log.info('request', { method: req.method, route: routeOf(path), status: res.statusCode, ms: Date.now() - t0 }));
  try {
    if (path === '/healthz') return send(res, 200, { ok: true, version: VERSION, mode: svc.mode, agent: agent.mode.mode });

    // ── 遠端 MCP ──
    if (path === '/mcp' || path.startsWith('/mcp/')) {
      if (req.method === 'OPTIONS') return end(res, 204, CORS);
      if (!limit(req, res, 'mcp')) return;
      if (req.method !== 'POST') {
        return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: '本服務為 stateless，請以 POST 呼叫。' }, id: null }, { ...CORS, allow: 'POST, OPTIONS' });
      }
      const pack = path.split('/')[2];
      if (pack && !listPacks().includes(pack)) return send(res, 404, { error: `沒有這個工具包：${pack}` }, CORS);
      const body = await readJson(req);
      const server = createMcpServer(svc, { packs: pack ? [pack] : undefined });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // ── API 文件（Swagger）──
    if (path === '/api/v1/openapi.json') return sendRaw(res, 200, OPENAPI, 'application/json; charset=utf-8', CORS);
    if (path === '/api/docs' || path === '/api/docs/') return sendRaw(res, 200, DOCS_HTML, 'text/html; charset=utf-8');
    if (path === '/api/docs/init.js') return sendRaw(res, 200, DOCS_INIT, 'text/javascript; charset=utf-8');
    const doc = path.match(/^\/api\/docs\/([\w.-]+)$/);
    if (doc && Object.hasOwn(SWAGGER_FILES, doc[1])) return sendRaw(res, 200, await swaggerFile(doc[1]), SWAGGER_FILES[doc[1]], { 'cache-control': 'public, max-age=86400' });

    // ── 前端動畫套件（白名單）──
    const vend = path.match(/^\/vendor\/([\w.-]+)$/);
    if (vend && Object.hasOwn(VENDOR_FILES, vend[1])) return sendRaw(res, 200, await vendorFile(vend[1]), 'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=604800' });

    // ── 網頁 agent（NDJSON 串流；給本站網頁與手機 App，App 來源見 APP_ORIGINS）──
    // /api/v1/agent（生活）或 /api/v1/agent/:id（例：antifraud；ADR-0005 多 agent）
    const agentPath = path.match(/^\/api\/v1\/agent(?:\/([a-z][a-z0-9-]*))?$/);
    if (agentPath && agentPath[1] !== 'profile') {
      const agentId = agentPath[1] || 'life';
      const cors = appCors(req);
      if (req.method === 'OPTIONS') return end(res, 204, cors);
      if (!hasProfile(agentId)) return send(res, 404, { error: `沒有這個 agent：${agentId}` }, cors);
      if (req.method !== 'POST') return send(res, 405, { error: '請以 POST 呼叫' }, { ...cors, allow: 'POST' });
      const lim = agent.limit(agentId, clientIp(req));
      if (!lim.ok) return send(res, 429, { error: `問太快了，請 ${lim.retryAfterSec} 秒後再試`, retryAfterSec: lim.retryAfterSec }, { ...cors, 'retry-after': String(lim.retryAfterSec) });
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      return await agent.handle(res, await readJson(req), { agentId });
    }

    // 動態「下一句」建議的驗證（core/agent/suggest-check.js）：只收候選句子，不收情境；規則解析，不呼叫模型
    if (path === '/api/v1/suggest/check') {
      const cors = appCors(req);
      if (req.method === 'OPTIONS') return end(res, 204, cors);
      if (req.method !== 'POST') return send(res, 405, { error: '請以 POST 呼叫' }, { ...cors, allow: 'POST' });
      if (!limit(req, res, 'api')) return;
      const body = await readJson(req);
      return send(res, 200, { data: checkRequest(body, { log: (m, o) => log.info(m, o) }) }, cors); // log 只記數量，不記句子
    }

    const core = path.match(/^\/core\/([\w.-]+)$/);
    if (core && Object.hasOwn(SHARED_CORE, core[1])) return sendRaw(res, 200, await readFile(SHARED_CORE[core[1]]), 'text/javascript; charset=utf-8', { 'cache-control': 'no-cache' });

    // ── REST ──
    if (path.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return end(res, 204, CORS);
      if (!limit(req, res, 'api')) return;
      const m = path.match(/^\/api\/v1\/tools\/([a-z0-9_]+)$/);
      if (m) {
        if (req.method !== 'POST') return send(res, 405, { error: '請以 POST 呼叫，參數放在 JSON body' }, { ...CORS, allow: 'POST, OPTIONS' });
        const r = await callTool(svc, m[1], await readJson(req));
        return send(res, 200, r, CORS);
      }
      const route = routes[path];
      if (!route) return send(res, 404, { error: 'Not found' });
      const data = await route.handler(Object.fromEntries(url.searchParams));
      return send(res, 200, { mode: svc.mode, data }, path === '/api/v1/tools' ? CORS : appCors(req)); // 其他 REST 只給本站與手機 App
    }

    // ── 靜態檔：防目錄穿越；找不到就回 index.html（SPA）──
    let file = normalize(join(PUBLIC, decodeURIComponent(path)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
    res.end(await readFile(file));
  } catch (e) {
    // UserError（含 413 請求過大）回原訊息；其他錯誤只在伺服器 log，對外回通用訊息
    const status = e instanceof UserError ? e.status || 400 : e.status === 429 ? 429 : 502;
    if (!(e instanceof UserError)) log.error('request failed', e, { method: req.method, route: routeOf(path) });
    // API 與 MCP 的錯誤也要帶 CORS，跨網域的 client 才讀得到錯誤訊息；413 回完就關連線（剩下的 body 不讀）
    const headers = { ...(path.startsWith('/api/') || path.startsWith('/mcp') ? CORS : {}), ...(path.startsWith('/api/v1/agent') && appCors(req)), ...(status === 413 && { connection: 'close' }) };
    if (!res.headersSent) send(res, status, { error: publicMessage(e) }, headers);
  }
}).listen(PORT, () => {
  // 165 開放資料約 10 萬筆，啟動後先載入，第一位使用者不用等（失敗不影響啟動，查詢時會再試）
  if (svc.antifraudMode === 'live') svc.antifraud.stats().then((s) => log.info('antifraud data loaded', s)).catch((e) => log.warn('antifraud data not loaded', { error: e.message }));
  // TDX 靜態資料背景預熱（每分鐘最多用 3 次，留 2 次給使用者；已存檔的跳過）；TDX_PREWARM=0 關閉
  if (svc.tdxPrewarm && process.env.TDX_PREWARM !== '0') svc.tdxPrewarm({ log: (m) => log.info(m) });
  log.info(`阿幫 running → http://localhost:${PORT}  (mode=${svc.mode}, agent=${agent.mode.mode}${agent.mode.model ? `:${agent.mode.model}` : ''})  MCP: http://localhost:${PORT}/mcp`, { port: PORT, version: VERSION, mode: svc.mode, agentMode: agent.mode.mode });
});

function limit(req, res, group) {
  const r = limiters[group](`${group}:${clientIp(req)}`);
  res.setHeader('x-ratelimit-limit', r.limit);
  res.setHeader('x-ratelimit-remaining', r.remaining);
  if (r.ok) return true;
  send(res, 429, { error: `請求太頻繁，請 ${r.retryAfterSec} 秒後再試` }, { 'retry-after': String(r.retryAfterSec), ...CORS });
  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // 不直接 destroy（client 會收到連線重置而不是 413）：停止讀取，回 413 並以 connection: close 結束
        req.pause(); req.removeAllListeners('data');
        reject(Object.assign(new UserError('請求內容過大'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new UserError('JSON 格式錯誤')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function sendRaw(res, status, body, type, headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache', ...headers });
  res.end(body);
}
function end(res, status, headers = {}) { res.writeHead(status, headers); res.end(); }
