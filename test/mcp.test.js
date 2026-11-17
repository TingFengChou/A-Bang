// MCP 與 REST 出口：stdio、遠端 HTTP（/mcp）、REST（/api/v1/tools）三條路徑結果一致（M2）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const EXPECTED = ['bus_nearby_stations', 'bus_route_eta', 'bus_search_routes', 'bus_station_eta', 'find_place', 'intercity_bus', 'metro_live_board', 'metro_stations', 'rail_fare', 'rail_stations', 'thsr_timetable', 'tra_timetable', 'traffic_status', 'weather_now', 'youbike_nearby'];
const ARGS = { from: '台北', to: '左營', date: '2026-12-01' };
let http;

before(async () => {
  http = spawn(process.execPath, ['server/http.js'], { env: { ...process.env, PORT: String(PORT), DEMO_MODE: '1', RATE_LIMIT_API: '30' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    http.stdout.on('data', (d) => String(d).includes('running') && resolve());
    http.on('exit', (c) => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
});
after(() => http?.kill());

async function viaStdio(fn) {
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/server.js'], env: { ...process.env, DEMO_MODE: '1' }, stderr: 'ignore' }));
  try { return await fn(c); } finally { await c.close(); }
}
async function viaHttp(fn, path = '/mcp') {
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(BASE + path)));
  try { return await fn(c); } finally { await c.close(); }
}

test('stdio：tools 清單、metadata、示範標註、錯誤', () => viaStdio(async (c) => {
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED);
  const yb = tools.find((t) => t.name === 'youbike_nearby');
  assert.equal(yb.annotations.readOnlyHint, true);
  assert.equal(yb._meta['abang/pack'], 'transit');
  assert.equal(yb._meta['abang/tier'], 'L1');
  const r = await c.callTool({ name: 'youbike_nearby', arguments: { lat: 25.0478, lon: 121.517 } });
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /示範資料/);
  assert.equal(r.structuredContent.card, 'youbike');
  const bad = await c.callTool({ name: 'thsr_timetable', arguments: { from: '火星', to: '左營' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /找不到高鐵車站/);
  // 內建資料的 tool：不加示範提示、來源標示為阿幫內建地標
  const fp = await c.callTool({ name: 'find_place', arguments: { query: '台北101' } });
  assert.ok(!fp.isError);
  assert.doesNotMatch(fp.content[0].text, /示範資料/);
  assert.match(fp.content[0].text, /資料來源：阿幫內建地標資料/);
  assert.equal(fp.structuredContent.data[0].name, '台北101');
}));

test('遠端 HTTP /mcp 與 /mcp/transit', async () => {
  const names = await viaHttp(async (c) => (await c.listTools()).tools.map((t) => t.name).sort());
  assert.deepEqual(names, EXPECTED);
  const packNames = await viaHttp(async (c) => (await c.listTools()).tools.length, '/mcp/transit');
  assert.equal(packNames, 14);
  const res = await fetch(BASE + '/mcp/nope', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 404);
  const get = await fetch(BASE + '/mcp');
  assert.equal(get.status, 405);
});

test('stdio、HTTP、REST 三條路徑結果一致', async () => {
  const a = await viaStdio((c) => c.callTool({ name: 'thsr_timetable', arguments: ARGS }));
  const b = await viaHttp((c) => c.callTool({ name: 'thsr_timetable', arguments: ARGS }));
  const rest = await (await fetch(BASE + '/api/v1/tools/thsr_timetable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ARGS) })).json();
  assert.deepEqual(a.structuredContent, b.structuredContent);
  assert.deepEqual(a.structuredContent.data, rest.data);
  assert.equal(rest.card, 'timetable');
  assert.ok(a.content[0].text.includes(rest.text));
});

test('API 文件：openapi.json、Swagger UI 頁面與資源，只開放白名單檔案', async () => {
  const spec = await (await fetch(BASE + '/api/v1/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/api/v1/tools/weather_now']);
  const page = await fetch(BASE + '/api/docs');
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /swagger-ui-bundle\.js/);
  assert.equal((await fetch(BASE + '/api/docs/swagger-ui.css')).status, 200);
  assert.equal((await fetch(BASE + '/api/docs/package.json')).status, 404);
  assert.equal((await fetch(BASE + '/api/docs/..%2F..%2Fpackage.json')).status, 404);
  // 物件原型上的名稱不能穿過白名單（之前 constructor 會 502 並洩漏絕對路徑）
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await fetch(BASE + '/api/docs/' + name);
    assert.equal(r.status, 404, name);
    assert.doesNotMatch(await r.text(), /node_modules|\/Users\//, name);
  }
});

test('REST：tools 清單、參數錯誤、方法錯誤', async () => {
  const list = await (await fetch(BASE + '/api/v1/tools')).json();
  assert.equal(list.data.length, 15);
  assert.ok(list.data.every((t) => t.pack && t.tier && t.inputSchema));
  const bad = await fetch(BASE + '/api/v1/tools/youbike_nearby', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lat: 'x' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /參數錯誤/);
  assert.equal((await fetch(BASE + '/api/v1/tools/youbike_nearby')).status, 405);
  assert.equal((await fetch(BASE + '/api/v1/tools/x', { method: 'POST', body: 'not json' })).status, 400);
});

test('限流：超過上限回 429 與 Retry-After', async () => {
  let last;
  for (let i = 0; i < 40; i++) { last = await fetch(BASE + '/api/v1/status'); if (last.status === 429) break; }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});
