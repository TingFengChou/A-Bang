// 一題問阿幫實際打了哪些 TDX 端點、各幾次（P0-2，2026-11-28，與 Antigravity 討論：先量再改；不進 CI）。
// 用法：node scripts/tdx-budget.js            （預設三題：市區行程、長途行程、公車到站）
//       QS='去台北101|307 還要多久' node scripts/tdx-budget.js
// 假 TDX：認得的端點回 test/fixtures 錄下的真實回應，其他回空陣列。注意：空結果依設計不存檔（下一題會再打），
// 所以「同一題再問」的次數會偏高；要可信的數字請補錄 fixture（scripts/record-fixtures.js）或用真金鑰量（Austin）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const fx = (id) => JSON.parse(readFileSync(`${R}/test/fixtures/tdx-${id}.json`, 'utf8'));
const ROUTES = [
  [/Bus\/Station\/NearBy/, () => fx('bus-station-nearby')],
  [/Bus\/(Display)?StopOfRoute\/City\/Taipei(\?|$)/, () => fx('bus-display-stop-of-route-taipei')],
  [/Bus\/Route\/City\/Taipei\/307/, () => fx('bus-route-taipei-307')],
  [/Bus\/EstimatedTimeOfArrival\/City\/Taipei\/PassThrough\/Station/, () => fx('station-eta-taipei-1000')],
  [/Freeway.*Live|LiveTraffic/, () => fx('freeway-live')],
  [/Rail\/THSR\/Station/, () => fx('thsr-station')],
  [/Rail\/TRA\/Station/, () => fx('tra-station')],
];
let calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = decodeURIComponent(String(url));
  if (!u.includes('tdx.transportdata.tw')) return realFetch(url, opts);
  if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
  calls.push(u.replace(/^https:\/\/tdx\.transportdata\.tw\/api/, '').replace(/\?.*$/, ''));
  const hit = ROUTES.find(([re]) => re.test(u));
  return new Response(JSON.stringify(hit ? hit[1]() : []));
};
const { createServices } = await import(`${R}/core/index.js`);
const { runDemo } = await import(`${R}/core/agent/run.js`);
const shape = (u) => u.replace(/\/City\/[A-Za-z]+/, '/City/{city}').replace(/\/\d{2,}[^/]*$/, '/{id}').replace(/NearBy.*$/, 'NearBy');
const turn = async (q, svc0 = null, label = '冷快取') => {
  const svc = svc0 || createServices({ clientId: 'a', clientSecret: 'b', tdx: { perMinute: 1000 } }); // 冷快取、不限額度（只數）
  calls = [];
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: q }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0423, lon: 121.5079 } }] }, (e) => es.push(e), { now: Date.parse('2026-11-28T10:00:00+08:00') });
  // 等排隊中的請求都送完（400 毫秒沒有新請求）才算這一題，不把它們量到下一題頭上（Antigravity 第三輪）
  for (let n = -1; n !== calls.length;) { n = calls.length; await new Promise((r) => setTimeout(r, 400)); }
  const tools = es.filter((e) => e.type === 'tool_start').map((e) => e.name);
  const by = {};
  for (const c of calls) by[shape(c)] = (by[shape(c)] || 0) + 1;
  console.log(`\n「${q}」［${label}］工具：${tools.join('、')}\n  TDX 呼叫 ${calls.length} 次`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(2)}  ${k}`);
};
const svc = createServices({ clientId: 'a', clientSecret: 'b', tdx: { perMinute: 1000 } });
calls = [];
// 預熱要有快取存檔（TDX_CACHE_DIR）才會跑；這裡量的是冷快取的第一題與 10 秒內同一題再問
for (const q of (process.env.QS || '從西門町到台北101|從台北車站到台中|307 還要多久').split('|')) { await turn(q, svc, '第一次（冷快取）'); await turn(q, svc, '同一題 10 秒內再問'); }
process.exit(0);
