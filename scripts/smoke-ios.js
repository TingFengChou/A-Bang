#!/usr/bin/env node
// T8c 原生 App 煙霧測試（iOS 模擬器，不在 CI）：對應 Android 的 scripts/smoke-android.js。
// 透過模擬器的 Web Inspector 通道（跟 Safari「開發」選單同一條，scripts/webinspector.js）連到 App 裡的 WKWebView（debug 版才可檢查），
// 逐頁檢查畫面、原生外掛、沒有錯誤，並用 simctl 截圖到 test/screenshots/ios-*.png；最後確認 App 沒有閃退、沒有新的當機報告。
// 先決條件：Xcode、開著一台模擬器（xcrun simctl boot）、本機 npm start（模擬器跟這台電腦共用網路，App 直接連 localhost:8787）。
// 用法：npm run smoke:ios              （重新啟動已安裝的 App 再測）
//       npm run smoke:ios -- --build   （先打包、建置 debug 版、裝到模擬器再測；ABANG_API_BASE 預設 http://localhost:8787）
//       npm run smoke:ios -- --keep    （不重開 App，接著現在的畫面測）
//       IOS_SIM=<UDID> npm run smoke:ios （開著好幾台模擬器時指定；否則用第一台開著的）
// 不改模擬器設定（不預先給定位、麥克風權限）；跳出權限框時截圖會看到，但不影響畫面檢查。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { attachPage, simulatorSocket } from './webinspector.js';

const APP = 'tw.abang.app';
const OUT = new URL('../test/screenshots/', import.meta.url);
const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const keep = process.argv.includes('--keep');
const build = process.argv.includes('--build');
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opt }).trim();
let udid = '';
const simctl = (...a) => run('xcrun', ['simctl', ...a]);

/** 每一頁要看到什麼（選擇器）；chrome：底部放什麼（ADR-0023 頁面矩陣：home 首頁輸入列、dock 總覽頁輸入列、fab 問阿幫浮動鍵、none 都不放；兩個煙霧測試同一份清單） */
const PAGES = [
  { name: 'home', hash: '#/', want: '#hs-card[aria-busy="false"]', chrome: 'home' },
  { name: 'services', hash: '#/services', want: '.svc-list', chrome: 'dock' },
  { name: 'reminders', hash: '#/reminders', want: '#rem-list', chrome: 'dock' },
  { name: 'me', hash: '#/me', want: '.me-ai', chrome: 'dock' },
  { name: 'agent', hash: '#/agent', want: '.chat-form', chrome: 'none' },
  { name: 'bus', hash: `#/bus/Taipei/307?stop=${encodeURIComponent('敦化市場')}&dir=0`, want: '.timeline', chrome: 'fab' },
  { name: 'weather', hash: '#/s/weather', want: '#pagehero .page-hero', chrome: 'fab' },
  { name: 'nearby', hash: '#/nearby', want: '#pagehero .page-hero', chrome: 'fab' },
  { name: 'settings', hash: '#/settings', want: '#saved', chrome: 'none' },
  { name: 'ai', hash: '#/ai', want: '.ai-hero #ai-chip:not([hidden])', chrome: 'fab' }
];
/** iOS 有註冊的原生外掛（AbangWatch：到站提醒的即時動態，只有 iOS 有） */
const PLUGINS = ['Geolocation', 'LocalNotifications', 'AbangEdgeAI', 'AbangSystem', 'AbangVision', 'AbangVoice', 'AbangHealth', 'AbangWatch'];

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
const js = (v) => JSON.stringify(v);

/** 第一台開著的模擬器 */
function bootedSimulator() {
  const list = JSON.parse(simctl('list', 'devices', 'booted', '-j')).devices;
  return Object.values(list).flat().find((d) => d.state === 'Booted')?.udid || '';
}

/** App 現在的 pid（沒在跑回 0） */
function appPid() {
  const line = simctl('spawn', udid, 'launchctl', 'list').split('\n').find((l) => l.includes(`UIKitApplication:${APP}`));
  const pid = Number(line?.trim().split(/\s+/)[0]);
  return Number.isFinite(pid) ? pid : 0;
}

/** 打包前端、建置 debug 版（未簽章）、裝到模擬器 */
function buildAndInstall() {
  const base = process.env.ABANG_API_BASE || 'http://localhost:8787';
  const dd = process.env.IOS_DERIVED_DATA || `${tmpdir()}/abang-ios-sim`;
  console.log(`打包（App 連 ${base}）、建置（幾分鐘）…`);
  run('node', [root('scripts/build-app.js')], { env: { ...process.env, ABANG_API_BASE: base } });
  run('npx', ['cap', 'sync', 'ios'], { cwd: root('.') });
  run('xcodebuild', ['-project', root('ios/App/App.xcodeproj'), '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', `id=${udid}`, '-derivedDataPath', dd, 'CODE_SIGNING_ALLOWED=NO', 'build']);
  simctl('install', udid, `${dd}/Build/Products/Debug-iphonesimulator/App.app`);
  console.log('✓ 建置並安裝');
}

/** 這次測試開始後產生的 App 當機報告 */
function newCrashReports(since) {
  const dir = `${homedir()}/Library/Logs/DiagnosticReports`;
  try { return readdirSync(dir).filter((f) => /^App[-_].*\.ips$/.test(f) && statSync(`${dir}/${f}`).mtimeMs >= since); } catch { return []; }
}

async function main() {
  udid = process.env.IOS_SIM || bootedSimulator();
  if (!udid) throw new Error('沒有開著的模擬器（xcrun simctl boot <UDID>，或開 Simulator.app）');
  const started = Date.now();
  if (build) buildAndInstall();
  try { simctl('get_app_container', udid, APP); } catch { throw new Error(`模擬器上沒有裝 ${APP}（加 --build 先建置安裝）`); }
  try { const r = await fetch('http://localhost:8787/healthz', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error(); } catch { console.warn('－ localhost:8787 沒有回應（npm start）：頁面資料可能載不到'); }
  let pid = keep ? appPid() : 0;
  if (!pid) {
    try { simctl('terminate', udid, APP); } catch { /* 沒在跑 */ }
    pid = Number(simctl('launch', udid, APP).match(/:\s*(\d+)/)?.[1] || 0);
  }
  if (!pid) throw new Error('App 沒有啟動');
  const socket = simulatorSocket();
  if (!socket) throw new Error('找不到模擬器的 Web Inspector 通道（webinspectord_sim）');
  let page = null, onboarded;
  try {
    page = await attachPage({ socket, pid, bundleId: APP });
    const { evaluate, waitFor, command } = page;
    // 不被首次使用引導擋住：先記下原本的值（結束時還原），設好再重新載入（開機時的錯誤也收得到）
    onboarded = await evaluate("localStorage.getItem('abang.onboarded')");
    await evaluate("localStorage.setItem('abang.onboarded', '1')");
    await command('Runtime.evaluate', { expression: 'setTimeout(() => location.reload(), 50); 0' });
    await sleep(800);
    if (!await waitFor("!!document.querySelector('#main')")) throw new Error('重新載入後 15 秒內沒看到 #main');
    await command('Console.enable').catch(() => {});
    // 原生外掛都註冊了（專案內外掛要在 MainViewController 手動註冊，漏了不會報錯）
    const plugins = await evaluate(`${js(PLUGINS)}.map((n) => [n, !!globalThis.Capacitor?.isPluginAvailable?.(n)])`);
    for (const [n, ok] of plugins) ok ? console.log(`✓ 外掛 ${n}`) : fail(`外掛 ${n} 沒有註冊`);
    mkdirSync(OUT, { recursive: true });
    for (const p of PAGES) {
      await evaluate(`(location.hash = ${js(p.hash)}, 0)`);
      if (!await waitFor(`!!document.querySelector(${js(p.want)})`)) fail(`${p.name}：15 秒內沒看到 ${p.want}`);
      else {
        const st = await evaluate("(() => { const d = document; const vis = (s) => { const e = d.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }; return { fab: vis('#abang-fab'), dock: vis('#sd-form'), home: vis('.hs-dock'), tabbar: !!d.querySelector('.tabbar') }; })()");
        const want = { home: { home: true, dock: false, fab: false }, dock: { home: false, dock: true, fab: false }, fab: { home: false, dock: false, fab: true }, none: { home: false, dock: false, fab: false } }[p.chrome];
        const bad = ['home', 'dock', 'fab'].filter((k) => st[k] !== want[k]);
        if (st.tabbar) fail(`${p.name}：還有分頁列（ADR-0023 已拿掉）`);
        else if (bad.length) fail(`${p.name}：底部不對（${bad.map((k) => `${k}=${st[k]}`).join('、')}；應該是 ${p.chrome}）`);
        else console.log(`✓ ${p.name}（${p.chrome}）`);
      }
      await sleep(600);
      try { simctl('io', udid, 'screenshot', '--type=png', fileURLToPath(new URL(`ios-${p.name}.png`, OUT))); } catch (e) { console.warn(`  （${p.name} 截圖失敗：${e.message}）`); }
    }
    // 語音問阿幫（M14-01）：外掛回報能不能用、是不是在手機上辨識；能用時問阿幫的輸入列有麥克風鍵（不按，不跳權限框、不開麥克風）
    await evaluate("(location.hash = '#/agent', 0)");
    const v = await evaluate("Capacitor.nativePromise('AbangVoice', 'available', { lang: 'zh-TW' }).catch((e) => ({ error: e.message }))");
    if (v.error) fail(`AbangVoice.available 失敗：${v.error}`);
    else {
      console.log(`✓ 語音辨識：${v.engine}，${v.available ? (v.onDevice ? '在手機上' : '不是在手機上') : `不能用（${v.reason}）`}，${v.lang}，麥克風權限 ${v.permission}`);
      const mic = await waitFor("!!document.querySelector('.chat-form .chat-mic:not([hidden])')", 5000);
      const on = await evaluate("localStorage.getItem('abang.voice') !== 'off'");
      if (v.available && on && !mic) fail('語音能用，但問阿幫沒有麥克風鍵'); else if (mic) console.log('✓ 麥克風鍵');
    }
    // 健康與運動（ADR-0018）：只問狀態（不跳權限框、不讀步數、不印數字）；未簽章的模擬器建置沒有 HealthKit entitlement
    const hs = await evaluate("Capacitor.nativePromise('AbangHealth', 'status', {}).catch((e) => ({ error: e.message }))");
    if (hs.error) fail(`AbangHealth.status 失敗：${hs.error}`);
    else console.log(`✓ 健康資料：${hs.available ? `HealthKit 可用，權限 ${hs.permission}` : `不能用（${hs.reason}）`}`);
    // 「問阿幫」浮動鍵拉出對話、收起鍵收回（iOS 沒有返回鍵；Esc、點背景走同一個 closeSheet）
    await evaluate("(location.hash = '#/s/weather', 0)");
    await waitFor("!!document.getElementById('abang-fab')", 5000);
    await evaluate("(document.getElementById('abang-fab').click(), 0)");
    if (!await waitFor("!!document.querySelector('#abang-sheet[open] .chat-form')", 8000)) fail('浮動鍵沒有拉出對話');
    else {
      console.log('✓ 浮動鍵拉出對話');
      await sleep(400);
      try { simctl('io', udid, 'screenshot', '--type=png', fileURLToPath(new URL('ios-sheet.png', OUT))); } catch { /* 截圖失敗不算 */ }
      await evaluate("(document.querySelector('#abang-sheet .sheet-close').click(), 0)");
      if (await waitFor("!document.getElementById('abang-sheet').open", 5000)) console.log('✓ 收起鍵收回對話'); else fail('收起鍵沒有收回對話');
    }
    // 手機上的 AI 在背景猜下一句失敗（模擬器多半沒有 Apple Intelligence、忙碌、逾時）會退回規則建議，不是畫面錯誤：列成警告
    const BG_AI = /(suggest failed|judge failed|write failed|timeout|cancelled|unavailable|busy|background|battery-quota)\b/;
    const errors = await page.errors();
    const bg = errors.filter((e) => BG_AI.test(e));
    if (bg.length) console.warn(`－ 手機上的 AI 這次沒用上 ${bg.length} 次（模擬器沒有模型、忙碌或逾時；改用伺服器或規則）：${[...new Set(bg)].slice(0, 2).map((e) => e.replace(/^console: /, '').slice(0, 120)).join('；')}`);
    const real = errors.filter((e) => !BG_AI.test(e) && !/favicon|Failed to load resource|OS-PLUG-GLOC-|kCLErrorDomain|CLLocationManager/.test(e)); // 模擬器沒設定位置、定位被拒是環境，不是畫面錯誤
    if (real.length) fail(`畫面錯誤：\n  ${real.join('\n  ')}`); else console.log('✓ 沒有畫面錯誤');
  } finally {
    if (page && onboarded !== undefined) await page.evaluate(`(${js(onboarded)} == null ? localStorage.removeItem('abang.onboarded') : localStorage.setItem('abang.onboarded', ${js(onboarded)}), 0)`).catch(() => {}); // 還原
    page?.close();
  }
  // 沒有閃退：還是同一個行程、沒有新的當機報告
  const now = appPid();
  if (now !== pid) fail(`App 行程換了或不見了（原本 ${pid}，現在 ${now || '沒在跑'}）`); else console.log('✓ App 沒有閃退');
  const crashes = newCrashReports(started);
  if (crashes.length) fail(`有新的當機報告：${crashes.join('、')}（~/Library/Logs/DiagnosticReports）`); else console.log('✓ 沒有新的當機報告');
  console.log(process.exitCode ? '\n有項目沒過（截圖在 test/screenshots/ios-*.png）' : '\n全部通過（截圖在 test/screenshots/ios-*.png）');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
