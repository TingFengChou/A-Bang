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

/** 開新的 browser context 與頁面、收集錯誤，跑完 fn（不論成敗）一定關閉 context；最後確認沒有頁面錯誤 */
async function withPage(device, path, fn) {
  const ctx = await browser.newContext({ ...device, geolocation: TAIPEI, permissions: ['geolocation'], reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    await page.goto(`${base}/${path}`);
    await fn(page);
    assert.deepEqual(errors, [], path);
  } finally {
    await ctx.close();
  }
}

const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname, fullPage: true });

const DEVICES = { phone: devices['iPhone 13'], desktop: { viewport: { width: 1280, height: 860 } } };

for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：首頁、示範橫幅、分頁列、搜尋公車`, async () => {
    await withPage(device, '#/', async (page) => {
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
    });
  });

  test(`${dname}：公車路線即時到站（去返程切換）`, async () => {
    await withPage(device, '#/bus/Taipei/307', async (page) => {
      await page.waitForSelector('.timeline .title');
      assert.equal(await page.locator('#dirs button').count(), 2);
      await page.click('#dirs button:not(.on)');
      await page.waitForSelector('#dirs button.on');
      assert.ok(await page.locator('.timeline .title').count() > 5);
      await shot(page, `${dname}-bus-route`);
    });
  });

  test(`${dname}：附近（定位）公車站與 YouBike`, async () => {
    await withPage(device, '#/nearby', async (page) => {
      await page.waitForSelector('.card.list .title');
      await shot(page, `${dname}-nearby-bus`);
      await page.click('.seg button[data-t="bike"]');
      await page.waitForFunction(() => document.querySelector('.card.list .sub')?.textContent.includes('YouBike'));
      await shot(page, `${dname}-nearby-bike`);
    });
  });

  test(`${dname}：高鐵、台鐵時刻表`, async () => {
    for (const sys of ['thsr', 'tra']) {
      await withPage(device, `#/rail/${sys}`, async (page) => {
        await page.click('#f .btn');
        await page.waitForSelector('.train');
        assert.ok(await page.locator('.train').count() > 5, sys);
        await shot(page, `${dname}-rail-${sys}`);
      });
    }
  });

  test(`${dname}：互動卡片預覽（7 種卡片、互動、不注入 HTML）`, async () => {
    await withPage(device, 'ui/cards/preview.html', async (page) => {
      await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
      assert.equal(await page.locator('.slot.err').count(), 0);
      const cards = await page.locator('.ab-card').evaluateAll((els) => els.map((e) => e.dataset.card));
      assert.deepEqual([...new Set(cards)].sort(), ['bus-route', 'bus-station', 'metro', 'nearby', 'timetable', 'trip', 'youbike']);
      assert.ok(await page.locator('.ab-demo').count() >= 7, '示範資料標示');
      // 公車路線：切換方向、點站牌展開
      const route = page.locator('[data-card="bus-route"]');
      await route.locator('.ab-tab:not(.on)').click();
      await route.locator('.ab-stop-row').first().click();
      assert.equal(await route.locator('.ab-stop.open').count(), 1);
      // 附近站牌：點站在卡片內展開到站
      const near = page.locator('[data-card="nearby"]');
      await near.locator('.ab-click').first().click();
      await near.locator('.ab-expand .ab-list, .ab-expand .ab-empty').first().waitFor();
      // YouBike：切換還車排序
      await page.locator('[data-card="youbike"] .ab-tab:not(.on)').click();
      assert.equal(await page.locator('[data-card="youbike"] .ab-tab.on').textContent(), '還車');
      // 行程：建議方案、分段條、理由、排除
      const trip = page.locator('[data-card="trip"]').first();
      assert.equal(await trip.locator('.ab-option.best').count(), 1);
      assert.ok(await trip.locator('.ab-leg').count() >= 2);
      assert.match(await trip.locator('.ab-reason').textContent(), /^選「/);
      // 高鐵時刻表每班有訂票按鈕（示範：開官方網站前先確認）
      const tt = page.locator('[data-card="timetable"]').first();
      assert.match(await tt.locator('.ab-title').textContent(), /^高鐵/);
      assert.ok(await tt.locator('.ab-btn', { hasText: '訂票' }).count() > 0);
      assert.equal(await page.locator('.ab-card script, .ab-card img[onerror]').count(), 0);
      // 自動刷新不會在第一次後停止：連續兩次 refresh 都會呼叫 tool
      const calls = await page.evaluate(async () => {
        const { renderCard } = await import('/ui/cards/index.js');
        let n = 0;
        const host = { callTool: async () => { n++; return { card: 'metro', name: 'metro_live_board', mode: 'demo', data: { system: 'TRTC', station: 'X', stationId: 'X', updatedAt: new Date().toISOString(), trains: [], nav: null } }; } };
        const el = document.createElement('div');
        const c = renderCard(el, { card: 'metro', tool: 'metro_live_board', args: {}, mode: 'demo', data: { system: 'TRTC', station: 'X', stationId: 'X', updatedAt: new Date().toISOString(), trains: [], nav: null } }, host);
        await c.refresh(); await c.refresh(); c.destroy();
        return n;
      });
      assert.equal(calls, 2);
      await shot(page, `${dname}-cards`);
    });
  });

  test(`${dname}：API 文件（Swagger UI）列出所有 tools`, async () => {
    await withPage(device, 'api/docs', async (page) => {
      await page.waitForSelector('.swagger-ui .opblock', { timeout: 15000 });
      const text = await page.textContent('.swagger-ui');
      for (const name of ['find_place', 'traffic_status', 'weather_now', 'bus_route_eta']) assert.ok(text.includes(name), name);
      await shot(page, `${dname}-api-docs`);
    });
  });
}
