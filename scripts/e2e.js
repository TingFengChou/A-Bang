// E2E 冒煙測試（docs/TESTING.md §2、§5）：示範模式起伺服器，用 Playwright 在手機與桌面開各頁，
// 檢查沒有 console／頁面錯誤、關鍵元素存在，截圖存 test/screenshots/（不進版控）。
// 執行：npm run e2e（node --test scripts/e2e.js）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, devices } from 'playwright';

const SHOTS = new URL('../test/screenshots/', import.meta.url);
const TAIPEI = { latitude: 25.0478, longitude: 121.517 };
let server, base, browser;

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });

before(async () => {
  await mkdir(SHOTS, { recursive: true });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // 示範模式：清掉金鑰，確保不連外
  server = spawn(process.execPath, ['server/http.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DEMO_MODE: '1', TDX_CLIENT_ID: '', TDX_CLIENT_SECRET: '', CWA_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('伺服器 10 秒內沒有啟動')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('running')) { clearTimeout(t); res(); } });
    server.on('exit', (c) => rej(new Error(`伺服器結束 ${c}`)));
  });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** 開新頁並收集錯誤（service worker 註冊失敗等環境訊息除外） */
async function open(device, path) {
  const ctx = await browser.newContext({ ...device, geolocation: TAIPEI, permissions: ['geolocation'], reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`${base}/${path}`);
  return { ctx, page, errors };
}

const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname, fullPage: true });

const DEVICES = { phone: devices['iPhone 13'], desktop: { viewport: { width: 1280, height: 860 } } };

for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：首頁、示範橫幅、分頁列、搜尋公車`, async () => {
    const { ctx, page, errors } = await open(device, '#/');
    await page.waitForSelector('.hero .search input');
    assert.match(await page.textContent('.demo-banner'), /示範模式/);
    assert.equal(await page.locator('.tabbar a').count(), 4);
    assert.ok(await page.locator('.grid .tile').count() > 0);
    await shot(page, `${dname}-home`);
    await page.fill('.hero .search input', '307');
    await page.press('.hero .search input', 'Enter');
    await page.waitForSelector('.card.list a');
    assert.match(page.url(), /#\/bus\?q=307/);
    await shot(page, `${dname}-bus-search`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`${dname}：公車路線即時到站（去返程切換）`, async () => {
    const { ctx, page, errors } = await open(device, '#/bus/Taipei/307');
    await page.waitForSelector('.timeline .title');
    assert.equal(await page.locator('#dirs button').count(), 2);
    await page.click('#dirs button:not(.on)');
    await page.waitForSelector('#dirs button.on');
    assert.ok(await page.locator('.timeline .title').count() > 5);
    await shot(page, `${dname}-bus-route`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`${dname}：附近（定位）公車站與 YouBike`, async () => {
    const { ctx, page, errors } = await open(device, '#/nearby');
    await page.waitForSelector('.card.list .title');
    await shot(page, `${dname}-nearby-bus`);
    await page.click('.seg button[data-t="bike"]');
    await page.waitForFunction(() => document.querySelector('.card.list .sub')?.textContent.includes('YouBike'));
    await shot(page, `${dname}-nearby-bike`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  test(`${dname}：高鐵、台鐵時刻表`, async () => {
    for (const sys of ['thsr', 'tra']) {
      const { ctx, page, errors } = await open(device, `#/rail/${sys}`);
      await page.click('#f .btn');
      await page.waitForSelector('.train');
      assert.ok(await page.locator('.train').count() > 5, sys);
      await shot(page, `${dname}-rail-${sys}`);
      assert.deepEqual(errors, [], sys);
      await ctx.close();
    }
  });

  test(`${dname}：API 文件（Swagger UI）列出所有 tools`, async () => {
    const { ctx, page, errors } = await open(device, 'api/docs');
    await page.waitForSelector('.swagger-ui .opblock', { timeout: 15000 });
    const text = await page.textContent('.swagger-ui');
    for (const name of ['find_place', 'traffic_status', 'weather_now', 'bus_route_eta']) assert.ok(text.includes(name), name);
    await shot(page, `${dname}-api-docs`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
