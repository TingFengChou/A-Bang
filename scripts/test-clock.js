// 不同時段跑一次全部單元測試（V1-2）：結果不能看跑測試的時間。
// 2026-11-28 抓到過：「9點前到」在早上 9 點後跑變 21:00（抵達時間已過推到晚上）、CI 白天才紅。
// 時段：清晨、上午、下午、晚上、跨日前後（台灣時間）；任一時段失敗就失敗，並印出是哪個時段、哪幾項。
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TIMES = (process.env.CLOCK_TIMES || '06:00,10:30,14:00,22:30,00:30').split(',').map((s) => s.trim()).filter(Boolean);
const files = readdirSync(new URL('../test/', import.meta.url)).filter((f) => f.endsWith('.test.js')).sort().map((f) => `test/${f}`);

let bad = 0;
for (const t of TIMES) {
  const r = spawnSync(process.execPath, ['--import=./test/support/fake-clock.mjs', '--test', '--test-reporter=tap', ...files], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FAKE_TW: t, TZ: 'UTC' },
  });
  const out = `${r.stdout}${r.stderr}`;
  const fails = out.split('\n').filter((l) => /^not ok /.test(l) && !/# (?:TODO|SKIP)/.test(l));
  const pass = /^# pass (\d+)/m.exec(out)?.[1] ?? '?';
  console.log(`台灣時間 ${t}：通過 ${pass}${fails.length ? `、失敗 ${fails.length}` : ''}`);
  for (const l of fails) console.log(`  ${l}`);
  if (r.status !== 0) bad++;
}
if (bad) { console.error(`\n${bad} 個時段有失敗：這些測試的結果會隨時間變，請給固定的 now（parseIntent 的 ctx.now、arriveByOf 的第二個參數、情境集的 "at"）`); process.exit(1); }
console.log('\n所有時段都通過');
