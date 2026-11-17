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
      assert.ok(await route.locator('[data-eta-sec]').count() > 0, '到站倒數');
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

  test(`${dname}：問阿幫（建議問題 → 討論串 → 卡片 → 總結；@ 點名；定位）`, async () => {
    await withPage(device, '#/agent', async (page) => {
      await page.waitForSelector('.suggest .chip');
      await page.locator('.suggest .chip').first().click(); // 從西門町到台北 101 怎麼去？
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(await page.locator('.msg.user').first().textContent(), /西門町/);
      assert.match(await page.locator('.thread-sum').first().textContent(), /小幫手討論完成・\d+ 個工具/);
      assert.ok(await page.locator('.thread .bubble.tool').count() >= 4, '小幫手發言');
      assert.ok(await page.locator('.thread .mention').count() >= 1, '@角色 chip');
      assert.equal(await page.locator('.results [data-card="trip"]').count(), 1);
      // 決策圖（M5-09）：四欄、勝出方案、理由；切換狀態即時重算（不呼叫伺服器）
      const dg = page.locator('.decision');
      await dg.locator('.dg-svg').waitFor();
      assert.ok(await dg.locator('.dg-opt').count() >= 3);
      assert.equal(await dg.locator('.dg-opt.win').count(), 1);
      assert.match(await dg.locator('.dg-why').textContent(), /選「/);
      const before = await dg.getAttribute('data-best');
      let calls = 0;
      page.on('request', (r) => { if (r.url().includes('/api/')) calls++; });
      await dg.locator('.dg-chip.add', { hasText: '想省錢' }).click();
      assert.equal(await dg.getAttribute('data-run'), '2');
      assert.notEqual(await dg.getAttribute('data-best'), before, '想省錢時建議應改變（叫車 → 大眾運輸）');
      assert.equal(await dg.locator('.dg-chip.on', { hasText: '你選的：想省錢' }).count(), 1);
      assert.equal(calls, 0, '重算不呼叫伺服器');
      await dg.locator('.dg-details summary').click();
      assert.ok(await dg.locator('.dg-bar.top').count() >= 2);
      assert.match(await page.locator('.bubble.final .say').textContent(), /^選「/);
      await shot(page, `${dname}-agent-trip`);
      // 展開討論串
      await page.locator('.thread-sum').first().click();
      assert.equal(await page.locator('.thread.open').count(), 1);
      // @ 點名
      await page.fill('.chat-input', '請 @');
      await page.locator('.chat-input').dispatchEvent('input');
      assert.ok(await page.locator('.mention-bar .chip').count() >= 5);
      await page.locator('.mention-bar .chip', { hasText: '@YouBike' }).click();
      assert.equal(await page.inputValue('.chat-input'), '請 @YouBike ');
      // 沒說起點：瀏覽器定位（測試 context 已給台北座標）
      await page.fill('.chat-input', '我想去台北101');
      await page.press('.chat-input', 'Enter');
      await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
      assert.equal(await page.locator('.results [data-card="trip"]').count(), 2);
      assert.match(await page.locator('.results [data-card="trip"] .ab-title').nth(1).textContent(), /^你的位置/);
      await shot(page, `${dname}-agent-location`);
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
