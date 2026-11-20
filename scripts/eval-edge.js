// 裝置端判斷評測（ADR-0014 E6）：在手機 App 的 WebView 裡，用評估集（scripts/eval/decision-set.json，172 題）
// 逐題呼叫 edgeJudge（Gemini Nano／Apple Intelligence），報告意圖正確率、狀態 F1、全對、延遲，與伺服器判斷層比較。
// 不進 CI（要實機）。用法（Android）：
//   1) App 開著（debug 版 WebView 可除錯）；adb forward tcp:9334 localabstract:webview_devtools_remote_$(adb shell pidof tw.abang.app)
//   2) node scripts/eval-edge.js 9334 [題數]
// 結果寫到 docs/research/edge-eval-<engine>.json（分數、延遲、每題判斷；評估集是自行撰寫的題目，沒有個資）。
// 與伺服器判斷層組合的分數：node scripts/eval-edge-combo.js <engine>
import { writeFile } from 'node:fs/promises';
import { loadItems, score, isHoldout } from './eval/lib.js';

const [port = '9334', limit] = process.argv.slice(2);
const items = (await loadItems('decision-set.json')).slice(0, limit ? Number(limit) : undefined);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.type === 'page');
if (!page) throw new Error('找不到 App 的 WebView（App 要開著、debug 版）');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const evaluate = (expression) => new Promise((resolve) => {
  const my = ++id;
  const h = (m) => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener('message', h); resolve(d.result?.result?.value); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

const st = await evaluate(`import('/js/edge-judge.js').then(async (m) => { window.__ej = m; m.edgePrewarm(); return m.edgeStatus(); })`);
if (!st?.available) throw new Error(`裝置模型不可用：${JSON.stringify(st)}`);
const rows = [], ms = [];
for (const it of items) {
  const r = await evaluate(`(async () => { const t = performance.now(); const j = await window.__ej.edgeJudge(${JSON.stringify(it.text)}, ${JSON.stringify(it.history || [])}, { timeout: 30000 }); return { ms: Math.round(performance.now() - t), j }; })()`);
  ms.push(r?.ms ?? 0);
  rows.push({ it, r: r?.j || { intent: 'unknown', states: [] } });
  if (r?.j?.intent !== it.intent) console.log(`✗ #${it.id} ${it.intent} → ${r?.j?.intent ?? '（失敗）'}`);
}
ws.close();
const pct = (p) => [...ms].sort((a, b) => a - b)[Math.min(ms.length - 1, Math.floor(ms.length * p))];
const all = score(rows), hold = score(rows.filter((x) => isHoldout(x.it)));
const out = { engine: st.engine, date: new Date().toISOString().slice(0, 10), n: items.length, all, holdout: hold, latencyMs: { p50: pct(0.5), p95: pct(0.95) }, failed: rows.filter((x) => x.r.intent !== x.it.intent).map((x) => ({ id: x.it.id, want: x.it.intent, got: x.r.intent })), results: rows.map((x) => ({ id: x.it.id, intent: x.r.intent, states: x.r.states })) };
const f = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`${st.engine}：意圖 ${f(all.intentAcc)}、狀態 F1 ${f(all.f1)}、全對 ${f(all.exact)}；驗收集 意圖 ${f(hold.intentAcc)}／全對 ${f(hold.exact)}；延遲 p50 ${out.latencyMs.p50} ms、p95 ${out.latencyMs.p95} ms`);
if (!limit) await writeFile(new URL(`../docs/research/edge-eval-${st.engine}.json`, import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
