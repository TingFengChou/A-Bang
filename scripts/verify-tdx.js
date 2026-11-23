// M1-01 TDX 端點實測：逐一呼叫 docs/MCP_TOOLS.md 標 ⚠️、PLAN.md M1 待驗證表裡的 TDX 端點，
// 印出狀態碼、筆數、第一筆的欄位名稱與補充檢查（座標完整度、WKT 類型、ServiceDay 型別…）。不印金鑰。
//   node --env-file=.env scripts/verify-tdx.js [--delay 13] [--only id1,id2]
// 每分鐘 5 次額度與本機伺服器共用：預設每次間隔 13 秒；碰到 429 等額度重置再試一次。
import { keysFromEnv, noKeysExit, runEndpoints } from './tdx/run.js';

const keys = keysFromEnv();
if (!keys) noKeysExit('verify-tdx.js');

const summary = [];
await runEndpoints(keys, ({ ep, status, rows, data, error, ctx }) => {
  const ok = status === 200;
  console.log(`\n${ok ? '✅' : '❌'} ${ep.id} — ${ep.title}`);
  console.log(`  狀態 ${status}${ok ? `，${rows.length} 筆` : `：${error}`}`);
  if (ok) {
    const first = rows[0] ?? (data && typeof data === 'object' ? data : null);
    console.log(`  第一筆欄位：${first && typeof first === 'object' ? Object.keys(first).join(', ') : JSON.stringify(first)}`);
    try { for (const line of ep.check?.(rows, data, ctx) || []) console.log(`  · ${line}`); } catch (e) { console.log(`  · 檢查失敗：${e.message}`); }
  }
  summary.push({ id: ep.id, status, n: ok ? rows.length : null });
});

console.log('\n── 總結 ──');
for (const s of summary) console.log(`${s.status === 200 ? (s.n ? '✅' : '⚪') : '❌'} ${s.id.padEnd(40)} ${s.status}${s.n != null ? `  ${s.n} 筆` : ''}`);
process.exit(summary.every((s) => s.status === 200) ? 0 : 2);
