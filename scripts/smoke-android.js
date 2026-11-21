#!/usr/bin/env node
// T8b 原生 App 煙霧測試（Android 實機或模擬器，不在 CI）：
// 透過 Chrome DevTools 協定連到 App 裡的 WebView（debug 版預設開啟），逐頁檢查畫面、原生外掛、沒有錯誤，並截圖到 test/screenshots/android-*.png。
// 先決條件：adb 連得到手機、App 已安裝（npm run app:sync 後 gradlew installDebug）、本機 npm start（App 經 adb reverse 連 8787）。
// 用法：npm run smoke:android            （重新啟動 App 再測）
//       npm run smoke:android -- --keep  （不重開 App，接著現在的畫面測）
// 不解鎖手機、不改手機設定；手機鎖著或螢幕關著時 WebView 仍可測，但截圖可能是黑的。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const APP = 'tw.abang.app';
const PORT = 9333;
const OUT = new URL('../test/screenshots/', import.meta.url);
const keep = process.argv.includes('--keep');
let serial = '';
/** 手機現在的畫面（PNG） */
const screencap = () => execFileSync('adb', [...(serial ? ['-s', serial] : []), 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
const adb = (...a) => execFileSync('adb', [...(serial ? ['-s', serial] : []), ...a], { encoding: 'utf8' }).trim();

/** 每一頁要看到什麼（選擇器）；fab：浮動阿幫要不要出現 */
const PAGES = [
  { name: 'home', hash: '#/', want: '.hero', fab: true },
  { name: 'agent', hash: '#/agent', want: '.chat-form', fab: false },
  { name: 'bus', hash: `#/bus/Taipei/307?stop=${encodeURIComponent('敦化市場')}&dir=0`, want: '.timeline', fab: true },
  { name: 'weather', hash: '#/s/weather', want: '#pagehero .page-hero', fab: true },
  { name: 'nearby', hash: '#/nearby', want: '#pagehero .page-hero', fab: true },
  { name: 'settings', hash: '#/settings', want: '#saved', fab: true },
];

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }

async function main() {
  const devices = execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').slice(1).filter((l) => /\tdevice$/.test(l)).map((l) => l.split('\t')[0]);
  if (!devices.length) throw new Error('adb 找不到裝置（USB 偵錯要打開、允許這台電腦）');
  serial = process.env.ANDROID_SERIAL || devices[0]; // 接了好幾台：用 ANDROID_SERIAL 指定，否則第一台
  try { adb('reverse', 'tcp:8787', 'tcp:8787'); } catch { /* 模擬器可能用 10.0.2.2 */ }
  if (!keep) { adb('shell', 'am', 'force-stop', APP); adb('shell', 'am', 'start', '-n', `${APP}/.MainActivity`); }
  let pids = [];
  for (let i = 0; i < 20 && !pids.length; i++) { try { pids = adb('shell', 'pidof', APP).split(/\s+/).filter(Boolean); } catch { /* 還沒起來 */ } if (!pids.length) await sleep(500); }
  if (!pids.length) throw new Error('App 沒有啟動（有安裝嗎？）');
  let sock = '';
  for (let i = 0; i < 20 && !sock; i++) { sock = (adb('shell', 'cat', '/proc/net/unix').match(new RegExp(`webview_devtools_remote_(${pids.join('|')})\\b`)) || [''])[0]; if (!sock) await sleep(500); }
  if (!sock) throw new Error('找不到 WebView 偵錯通道（要用 debug 版）');
  let browser = null, page = null, onboarded;
  try {
    adb('forward', `tcp:${PORT}`, `localabstract:${sock}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => /^(https?|capacitor):\/\/localhost/.test(p.url()));
    if (!page) throw new Error('找不到 App 的頁面');
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    // 不被首次使用引導擋住：先記下原本的值（結束時還原，不改使用者手機上的資料），設好再重新載入（開機時的錯誤也收得到）
    onboarded = await page.evaluate(() => globalThis.localStorage.getItem('abang.onboarded'));
    await page.evaluate(() => globalThis.localStorage.setItem('abang.onboarded', '1'));
    await page.reload();
    await page.waitForSelector('#main', { timeout: 15000 });
    // 原生外掛都註冊了（專案內外掛要手動註冊，漏了不會報錯）
    const plugins = await page.evaluate(() => ['Geolocation', 'LocalNotifications', 'AbangEdgeAI', 'AbangSystem'].map((n) => [n, !!globalThis.Capacitor?.isPluginAvailable?.(n)]));
    for (const [n, ok] of plugins) ok ? console.log(`✓ 外掛 ${n}`) : fail(`外掛 ${n} 沒有註冊`);
    mkdirSync(OUT, { recursive: true });
    for (const p of PAGES) {
      await page.evaluate((h) => { globalThis.location.hash = h; }, p.hash);
      try {
        await page.waitForSelector(p.want, { timeout: 15000 });
        const fab = await page.evaluate(() => { const b = globalThis.document.getElementById('abang-fab'); return !!b && !b.hidden; });
        if (fab !== p.fab) fail(`${p.name}：浮動阿幫${p.fab ? '沒有出現' : '不該出現'}`);
        else console.log(`✓ ${p.name}`);
      } catch { fail(`${p.name}：15 秒內沒看到 ${p.want}`); }
      await sleep(600);
      try { writeFileSync(fileURLToPath(new URL(`android-${p.name}.png`, OUT)), screencap()); } catch (e) { console.warn(`  （${p.name} 截圖失敗：${e.message}）`); } // 用手機實際畫面（WebView 截圖在重新載入後可能卡住）
    }
    // 浮動阿幫拉出對話、Android 返回鍵收起（dialog.close）；沒拉出來就不按返回（--keep 時前面可能是別的 App）
    await page.evaluate(() => { globalThis.location.hash = '#/s/weather'; });
    await page.waitForSelector('#abang-fab:not([hidden])');
    await page.click('#abang-fab');
    const opened = await page.waitForSelector('#abang-sheet[open] .chat-form', { timeout: 8000 }).then(() => true, () => false);
    if (!opened) fail('浮動阿幫沒有拉出對話');
    else {
      console.log('✓ 浮動阿幫拉出對話');
      await sleep(400);
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await page.waitForFunction(() => !globalThis.document.getElementById('abang-sheet').open, null, { timeout: 5000 }).then(() => console.log('✓ 返回鍵收起對話'), () => fail('返回鍵沒有收起對話'));
    }
    const real = errors.filter((e) => !/favicon|net::ERR_|Failed to load resource/.test(e));
    if (real.length) fail(`畫面錯誤：\n  ${real.join('\n  ')}`); else console.log('✓ 沒有畫面錯誤');
  } finally {
    if (page && onboarded !== undefined) await page.evaluate((v) => { if (v == null) globalThis.localStorage.removeItem('abang.onboarded'); else globalThis.localStorage.setItem('abang.onboarded', v); }, onboarded).catch(() => {}); // 還原
    await browser?.close().catch(() => {});
    try { adb('forward', '--remove', `tcp:${PORT}`); } catch { /* 已移除 */ }
  }
  console.log(process.exitCode ? '\n有項目沒過（截圖在 test/screenshots/android-*.png）' : '\n全部通過（截圖在 test/screenshots/android-*.png）');
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
