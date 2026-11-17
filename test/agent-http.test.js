// POST /api/v1/agent（M5-06）：NDJSON 串流、請求驗證 400、方法 405、限流 429（agent id＋IP）、計量
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createAgentHandler } from '../server/agent.js';
import { createServices } from '../core/index.js';

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
let http, BASE;

before(async () => {
  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  http = spawn(process.execPath, ['server/http.js'], { env: { ...process.env, PORT: String(port), DEMO_MODE: '1', AGENT_RPM: '3' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    http.stdout.on('data', (d) => String(d).includes('running') && resolve());
    http.on('exit', (c) => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
});
after(() => http?.kill());

const post = (body) => fetch(`${BASE}/api/v1/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('NDJSON 串流：示範模式完整事件，不帶 CORS', async () => {
  const r = await post({ messages: [{ role: 'user', content: '從西門町到台北 101 怎麼去？' }] });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-ndjson/);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const events = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([events[0].type, events[0].mode, events.at(-1).type], ['status', 'demo', 'done']);
  assert.ok(events.some((e) => e.type === 'decision'));
});

test('驗證 400、方法 405、超過每分鐘上限 429', async () => {
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await fetch(`${BASE}/api/v1/agent`)).status, 405);
  let last;
  for (let i = 0; i < 5; i++) last = await post({ messages: [{ role: 'user', content: '今天天氣如何' }] });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.match((await last.json()).error, /問太快了/);
});

test('handler：計量以 agent id 為單位、上游錯誤以 error 事件結束', async () => {
  const svc = createServices({ forceMock: true });
  const h = createAgentHandler({ svc, env: { AGENT_RPM: '2', AGENT_RPD: '100' } });
  assert.deepEqual([h.limit('life', '1.1.1.1').ok, h.limit('life', '1.1.1.1').ok, h.limit('life', '1.1.1.1').ok], [true, true, false]);
  assert.ok(h.limit('life', '2.2.2.2').ok, '不同 IP 各自計算');
  const chunks = [];
  const res = { writableEnded: false, writeHead() {}, write: (c) => chunks.push(c), end() { this.writableEnded = true; } };
  await h.handle(res, { messages: [{ role: 'user', content: '307 到哪了？我在臺北車站' }] });
  const u = h.usage('life');
  assert.deepEqual([u.requests, u.toolCalls >= 1, u.budget], [1, true, 5000]);
  assert.equal(JSON.parse(chunks.at(-1)).type, 'done');
});
