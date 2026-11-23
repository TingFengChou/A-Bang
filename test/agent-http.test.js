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
  http = spawn(process.execPath, ['server/http.js'], { env: { ...process.env, PORT: String(port), DEMO_MODE: '1', AGENT_RPM: '10', JUDGE: 'off' }, stdio: ['ignore', 'pipe', 'inherit'] });
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

test('client_tool_call：沒起點時請客戶端定位；拿到座標後用「你的位置」規劃；拒絕時用預設起點', async () => {
  const { runAgent } = await import('../public/js/agent/client.js');
  const msg = { messages: [{ role: 'user', content: '我想去台北101' }] };
  const collect = async (locate) => { const es = []; await runAgent(msg, (e) => es.push(e), { base: BASE, locate }); return es; };
  // 拿到定位
  const ok = await collect(async () => ({ lat: 25.0478, lon: 121.517 }));
  const call = ok.find((e) => e.type === 'client_tool_call');
  assert.deepEqual([call.name, call.id], ['device_location', 'loc1']);
  assert.deepEqual(ok.find((e) => e.type === 'client_tool_result'), { type: 'client_tool_result', id: 'loc1', name: 'device_location', ok: true }, '畫面用：定位完成（不含座標）');
  const trip = ok.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.equal(trip.data.from.name, '你的位置');
  assert.ok(!ok.find((e) => e.type === 'text').delta.includes('沒說從哪出發'));
  // 拒絕定位：照示範預設起點，總結說明
  const no = await collect(async () => null);
  assert.equal(no.find((e) => e.type === 'client_tool_result').ok, false);
  assert.match(no.find((e) => e.type === 'text').delta, /沒拿到你的位置，先從「臺北車站」算；告訴我從哪出發就重算/, '拒絕定位不是「你沒說」');
});


test('驗證 400、方法 405、超過每分鐘上限 429', async () => {
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await fetch(`${BASE}/api/v1/agent`)).status, 405);
  let last;
  for (let i = 0; i < 12; i++) { last = await post({ messages: [{ role: 'user', content: '今天天氣如何' }] }); if (last.status === 429) break; }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.match((await last.json()).error, /問太快了/);
});

test('手機 App 來源（ADR-0013）：預檢與回應帶 CORS；其他網站不帶', async () => {
  const pre = (origin) => fetch(`${BASE}/api/v1/agent`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  for (const o of ['capacitor://localhost', 'https://localhost']) {
    const r = await pre(o);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), o);
  }
  assert.equal((await pre('https://evil.example')).headers.get('access-control-allow-origin'), null);
  const r = await fetch(`${BASE}/api/v1/agent`, { method: 'POST', headers: { origin: 'capacitor://localhost', 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '今天天氣如何' }] }) });
  assert.equal(r.headers.get('access-control-allow-origin'), 'capacitor://localhost', '就算被限流（429）也要讓 App 讀得到訊息');
  await r.body?.cancel();
  const rest = (origin) => fetch(`${BASE}/api/v1/status`, { headers: { origin } }).then((x) => x.headers.get('access-control-allow-origin'));
  assert.equal(await rest('https://localhost'), 'https://localhost', 'REST 讀取路由（公車、天氣…）也給 App');
  assert.equal(await rest('https://evil.example'), null);
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

test('手機上的小模型（E3）：白名單檔案、App 來源的 CORS、其他路徑 404', async () => {
  const wasm = await fetch(`${BASE}/edge-model/ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD', headers: { origin: 'capacitor://localhost' } });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.ok(Number(wasm.headers.get('content-length')) > 1_000_000);
  const other = await fetch(`${BASE}/edge-model/ort-wasm-simd-threaded.asyncify.wasm`, { method: 'HEAD', headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  for (const bad of ['/edge-model/../package.json', '/edge-model/Xenova/multilingual-e5-small/../../../package.json', '/edge-model/package.json', '/edge-model/Xenova/multilingual-e5-small/onnx/model.onnx']) {
    const r = await fetch(`${BASE}${bad}`, { method: 'HEAD' });
    assert.notEqual(r.headers.get('content-type'), 'application/octet-stream', bad);
    assert.ok(r.status === 404 || r.headers.get('content-type')?.startsWith('text/html'), `${bad} → ${r.status}`); // fetch 會把 .. 正規化掉，落到 SPA index.html
  }
  assert.equal((await fetch(`${BASE}/edge-model/x`, { method: 'POST' })).status, 405);
  const js = await fetch(`${BASE}/vendor/transformers.min.js`, { method: 'HEAD' });
  assert.equal(js.status, 200);
  const cls = await fetch(`${BASE}/core/judge-classifier.json`);
  assert.equal(cls.status, 200);
  assert.ok((await cls.json()).intents.trip);
});
