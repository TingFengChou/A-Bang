#!/usr/bin/env node
// 阿幫 HTTP 伺服器（零框架，Node 20+）
//   /api/v1/*            REST：PWA 頁面、卡片刷新（/api/v1/tools/:name）
//   /mcp、/mcp/:pack     遠端 MCP（Streamable HTTP，stateless）— Claude 自訂連接器
//   其他                 PWA 靜態檔
// TDX 金鑰只存在伺服器端，瀏覽器與 MCP client 都拿不到。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServices, loadEnv } from '../core/index.js';
import { listTools, listPacks, describeTool, callTool } from '../core/tools/index.js';
import { UserError } from '../core/util.js';
import { createMcpServer } from '../mcp/create-server.js';
import { createRateLimiter, clientIp } from './rate-limit.js';

const svc = createServices({ ...(await loadEnv()), log: console.log });
const PORT = Number(process.env.PORT) || 8787;
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 64 * 1024;

const limiters = {
  api: createRateLimiter({ limit: Number(process.env.RATE_LIMIT_API) || 120 }),
  mcp: createRateLimiter({ limit: Number(process.env.RATE_LIMIT_MCP) || 60 }),
};

// REST 路由（PWA 既有頁面使用；新功能請優先走 /api/v1/tools/:name）
const num = (v) => (v == null || v === '' ? undefined : Number(v));
const routes = {
  '/api/v1/status': () => ({ mode: svc.mode, time: new Date().toISOString(), packs: listPacks() }),
  '/api/v1/bus/routes': (p) => svc.bus.searchRoutes({ city: p.city, keyword: p.keyword || '' }),
  '/api/v1/bus/eta': (p) => svc.bus.routeEta({ city: p.city, routeName: p.route }),
  '/api/v1/bus/nearby': (p) => svc.bus.nearbyStations({ lat: num(p.lat), lon: num(p.lon), radius: num(p.radius) }),
  '/api/v1/bus/station-eta': (p) => svc.bus.stationEta({ city: p.city, stationId: p.station }),
  '/api/v1/bike/nearby': (p) => svc.bike.nearby({ lat: num(p.lat), lon: num(p.lon), radius: num(p.radius) }),
  '/api/v1/thsr/stations': () => svc.rail.thsrStations(),
  '/api/v1/thsr/timetable': (p) => svc.rail.thsrTimetable(p),
  '/api/v1/tra/stations': () => svc.rail.traStations(),
  '/api/v1/tra/timetable': (p) => svc.rail.traTimetable(p),
  '/api/v1/tools': (p) => listTools({ packs: p.pack ? p.pack.split(',') : undefined }).map(describeTool),
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
  try {
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
      const handler = routes[path];
      if (!handler) return send(res, 404, { error: 'Not found' });
      const data = await handler(Object.fromEntries(url.searchParams));
      return send(res, 200, { mode: svc.mode, data }, path === '/api/v1/tools' ? CORS : {});
    }

    // ── 靜態檔：防目錄穿越；找不到就回 index.html（SPA）──
    let file = normalize(join(PUBLIC, decodeURIComponent(path)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300' });
    res.end(await readFile(file));
  } catch (e) {
    const status = e instanceof UserError ? 400 : e.status === 413 ? 413 : e.status === 429 ? 429 : 502;
    if (status === 502) console.error(e);
    if (!res.headersSent) send(res, status, { error: e.message });
  }
}).listen(PORT, () => console.log(`阿幫 running → http://localhost:${PORT}  (mode=${svc.mode})  MCP: http://localhost:${PORT}/mcp`));

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
      if (size > MAX_BODY) { reject(Object.assign(new Error('請求內容過大'), { status: 413 })); req.destroy(); return; }
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
function end(res, status, headers = {}) { res.writeHead(status, headers); res.end(); }
