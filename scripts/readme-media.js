// README 的畫面（2026-11-29）：用示範模式真的操作幾段流程、錄成影片，再從影片裡取幾格拼成一張圖（docs/media/*.jpg）。
// 不加依賴：錄影用 Playwright 的 recordVideo；取格用 Chromium 播放錄好的影片再截圖；拼圖用一頁 HTML 截圖。
// 用法：node scripts/readme-media.js   （需要 npx playwright install chromium）
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'docs/media');
const W = 390, H = 844;
const tw = (m, d, h, mi) => new Date(Date.UTC(2026, m - 1, d, h - 8, mi));
const HOME = { name: '大安區', lat: 25.0263, lon: 121.5436 }, OFFICE = { name: '內湖區', lat: 25.0797, lon: 121.5752 };
const COMMUTE = { from: '家', to: '公司', legs: [{ mode: 'bus', route: '307', stop: '忠孝轉運站', city: 'Taipei', direction: 0 }, { mode: 'metro', line: 'BR', name: '文湖線', station: '大安' }] };

async function startServer() {
  const proc = spawn(process.execPath, ['server/http.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DEMO_MODE: '1', DEMO_CLOCK: '08:00', TDX_CLIENT_ID: '', TDX_CLIENT_SECRET: '', CWA_API_KEY: '', ANTHROPIC_API_KEY: '', JUDGE: 'off', MYDRAMA_API_BASE: '', RATE_LIMIT_API: '5000', AGENT_RPM: '500' } });
  const port = await new Promise((ok, no) => {
    let buf = '';
    proc.stdout.on('data', (d) => { buf += d; const m = /running → http:\/\/localhost:(\d+)/.exec(buf); if (m) ok(m[1]); });
    setTimeout(() => no(new Error('伺服器沒有啟動')), 15000);
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

/** 一段流程：錄影＋記下每個要取的瞬間（毫秒，從開始錄算起） */
async function record(browser, base, { at, seed = {}, geo = null, motion = true }, steps) {
  const dir = await mkdtemp(join(tmpdir(), 'abang-rec-'));
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei',
    reducedMotion: motion ? 'no-preference' : 'reduce', recordVideo: { dir, size: { width: W, height: H } }, ...(geo && { geolocation: geo, permissions: ['geolocation'] }) });
  const marks = [];
  const page = await ctx.newPage();
  const t0 = Date.now(); // 影片從開頁那一刻開始錄
  await page.clock.install({ time: at });
  await page.addInitScript((s) => {
    localStorage.setItem('abang.onboarded', '1');
    if (s.places) localStorage.setItem('abang.places', JSON.stringify(s.places));
    if (s.commute) localStorage.setItem('abang.commute', JSON.stringify(s.commute));
    if (s.intro) localStorage.setItem('abang.homeIntro', s.intro);
  }, seed);
  const mark = async (label) => { marks.push({ label, ms: Date.now() - t0 }); await page.waitForTimeout(700); }; // 記下後停一下：取格不會拍到下一個動作
  await steps(page, mark, base);
  await ctx.close();
  const file = (await readdir(dir)).find((f) => f.endsWith('.webm'));
  return { video: join(dir, file), marks, dir };
}

/** 從影片取格：Chromium 播放 webm、跳到那一刻、截圖 */
async function frames(browser, rec) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const html = join(rec.dir, 'play.html'); // 從 about:blank 讀不到 file:// 的影片：放一頁在影片旁邊
  await writeFile(html, `<body style="margin:0;background:#000"><video id="v" src="${rec.video.split('/').pop()}" muted preload="auto" style="width:${W}px;height:${H}px;display:block"></video></body>`);
  await page.goto(`file://${html}`);
  await page.waitForFunction(() => document.getElementById('v').readyState >= 1);
  const out = [];
  for (const m of rec.marks) {
    await page.evaluate((s) => new Promise((ok) => { const v = document.getElementById('v'); v.addEventListener('seeked', () => ok(), { once: true }); v.currentTime = Math.min(s, v.duration || s); }), m.ms / 1000);
    await page.waitForTimeout(120);
    out.push({ label: m.label, png: (await page.screenshot({ type: 'png' })).toString('base64') });
  }
  await page.close();
  return out;
}

/** 拼成一張：幾格並排，每格上面一行說明 */
async function strip(browser, name, title, shots) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f4f1ea;font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif">
    <div id="w" style="display:inline-flex;flex-direction:column;gap:12px;padding:20px 20px 24px">
      <div style="font-size:22px;font-weight:800;color:#14201D">${title}</div>
      <div style="display:flex;gap:14px">${shots.map((s, i) => `<figure style="margin:0;width:260px"><figcaption style="font-size:15px;font-weight:700;color:#1f2937;height:42px;line-height:1.35"><span style="color:#0F766E">${i + 1}</span> ${s.label}</figcaption><img src="data:image/png;base64,${s.png}" style="width:260px;border-radius:22px;display:block;box-shadow:0 8px 20px rgba(0,0,0,.18)"></figure>`).join('')}</div>
    </div></body>`;
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  await (await page.$('#w')).screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  await page.close();
}

const ready = (page) => page.waitForSelector('#hs-card[aria-busy="false"]');
const settle = (page, ms = 900) => page.clock.runFor(ms).then(() => page.waitForTimeout(ms));

const FLOWS = [
  ['home-night', '打開首頁：夜空亮起、手機上的 AI 只連這次用到的資訊、建議卡浮起', { at: tw(11, 28, 22, 40), seed: { places: { 家: HOME, 公司: OFFICE } }, geo: { latitude: 25.033, longitude: 121.5654 } }, async (page, mark, base) => {
    await page.goto(`${base}/#/`);
    await page.waitForSelector('#hs.play');
    await page.waitForTimeout(250); await mark('夜空與 101');
    await page.waitForTimeout(500); await mark('訊號連到核心');
    await page.waitForTimeout(700); await mark('建議卡浮起、藍鵲探頭');
    await ready(page); await page.waitForTimeout(1600); await mark('完成：末班車與返家路線');
  }],
  ['home-commute', '上班日早上：固定通勤方式的今天狀況，出發地可切到目前位置', { at: tw(12, 1, 7, 40), seed: { places: { 家: HOME, 公司: OFFICE }, commute: COMMUTE, intro: '2026-12-1' }, geo: { latitude: HOME.lat, longitude: HOME.lon } }, async (page, mark, base) => {
    await page.goto(`${base}/#/`);
    await ready(page); await settle(page, 1500); await mark('今日通勤（從住家）');
    await page.click('.hs-seg [data-o="here"]'); await settle(page); await mark('切到「目前位置」');
    await page.click('#hs-sum'); await settle(page, 600); await mark('按下後會做什麼');
    await page.click('#hs-why-btn'); await page.waitForSelector('#hs-why[open]'); await page.waitForTimeout(500); await mark('為何顯示此建議');
  }],
  ['ask', '問阿幫：小幫手討論串 → 決策圖 → 行程卡（導航、提醒、行事曆、分享）', { at: tw(12, 1, 10, 0), seed: { intro: '2026-12-1' }, geo: { latitude: 25.0421, longitude: 121.5081 } }, async (page, mark, base) => {
    await page.goto(`${base}/#/`);
    await ready(page); await page.waitForTimeout(400);
    await page.fill('.hs-dock input', '下雨了，從西門町到台北101怎麼去？');
    await mark('首頁輸入列直接問');
    await page.press('.hs-dock input', 'Enter');
    await page.waitForSelector('.thread .say, .turn .msg', { timeout: 20000 }); await page.waitForTimeout(900); await mark('阿幫點名小幫手查資料');
    await page.waitForSelector('.bubble.final', { timeout: 30000 });
    await page.locator('.dg, .decision, [class*="decision"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(900); await mark('決策圖：資料＋狀態 → 建議');
    await page.locator('[data-card="trip"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(900); await mark('行程卡：導航、提醒、加到行事曆');
  }],
  ['pages', '全部服務、資料頁與「問阿幫」浮動鍵', { at: tw(12, 1, 10, 0), seed: { places: { 家: HOME }, intro: '2026-12-1' }, geo: { latitude: 25.0478, longitude: 121.517 } }, async (page, mark, base) => {
    await page.goto(`${base}/#/services`);
    await page.waitForSelector('.svc-list .svc'); await page.waitForTimeout(700); await mark('全部服務＋輸入列');
    await page.click('.svc[href="#/bus"]');
    await page.waitForSelector('#pagehero .ph-bus'); await page.fill('#main input', '307').catch(() => {}); await page.keyboard.press('Enter').catch(() => {});
    await page.waitForSelector('.card.list a', { timeout: 15000 }); await page.click('.card.list a');
    await page.waitForSelector('.timeline', { timeout: 15000 }); await page.waitForTimeout(1200); await mark('公車即時到站與街景');
    await page.click('#abang-fab'); await page.waitForSelector('#abang-sheet[open]'); await page.waitForTimeout(700); await mark('浮動鍵拉出同一段對話');
  }],
];

const { proc, base } = await startServer();
const browser = await chromium.launch();
try {
  await mkdir(OUT, { recursive: true });
  const only = process.argv[2];
  for (const [name, title, opt, steps] of FLOWS) {
    if (only && only !== name) continue;
    const rec = await record(browser, base, opt, steps);
    const shots = await frames(browser, rec);
    await strip(browser, name, title, shots);
    await rm(rec.dir, { recursive: true, force: true });
    console.log(`docs/media/${name}.jpg`, shots.map((s) => s.label).join('｜'));
  }
  await writeFile(join(OUT, 'README.md'), '# README 用的畫面\n\n由 `node scripts/readme-media.js` 產生：示範模式真的操作、錄影，再從影片取格拼成一張。不要手改。\n');
} finally {
  await browser.close();
  proc.kill();
}
