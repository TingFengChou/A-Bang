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
    env: { ...process.env, PORT: String(port), DEMO_MODE: '1', TDX_CLIENT_ID: '', TDX_CLIENT_SECRET: '', CWA_API_KEY: '', ANTHROPIC_API_KEY: '', AGENT_RPM: '500', AGENT_RPD: '5000' },
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
      // 首頁以問阿幫為主要入口（M5-12）：輸入問題 → #/agent 自動送出
      assert.ok(await page.locator('.hero-ask .chip').count() >= 3);
      await page.fill('.hero .search input', '307 到哪了？我在臺北車站');
      await page.press('.hero .search input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(page.url(), /#\/agent$/);
      assert.equal(await page.locator('.results [data-card="bus-route"]').count(), 1);
      // 公車搜尋仍可從分頁列進入
      await page.goto(`${base}/#/bus?q=307`);
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
      // 行程卡：跨城建議（高鐵）有導航與訂票；有出門時間時可設定提醒（時間已過則不顯示）
      const tripRail = page.locator('[data-card="trip"]').first();
      assert.ok(await tripRail.locator('.ab-option.best .ab-btn', { hasText: '訂票' }).count() === 1);
      // 提醒我出門：以假 host 渲染一張今天、30 分鐘後出門的行程卡
      const reminded = await page.evaluate(async () => {
        const { renderCard } = await import('/ui/cards/index.js');
        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date(Date.now() + 30 * 60e3);
        const leaveAt = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const calls = [];
        const host = { remind: async (at, text) => { calls.push([at, text]); return true; }, openLink() {} };
        const el = document.createElement('div');
        document.body.append(el);
        const P = { name: 'A', lat: 25, lon: 121 };
        renderCard(el, { card: 'trip', mode: 'demo', data: { from: P, to: { ...P, name: 'B' }, date: today, departAt: '09:00', best: 'thsr', states: [],
          options: [{ id: 'thsr', role: 'thsr', name: '高鐵', minutes: 120, waitMin: 10, walkMin: 2, cost: 1300, arriveAt: '11:00', leaveAt, notes: [],
            legs: [{ mode: 'walk', from: P, to: P, minutes: 2, detail: '走', nav: null }] }],
          ranking: { ranked: [{ id: 'thsr', name: '高鐵', score: 90 }], excluded: [], reason: '選「高鐵」' } } }, host);
        el.querySelector('.ab-option.best .ab-btn').click();
        await new Promise((r) => setTimeout(r, 50));
        const out = { calls, text: el.querySelector('.ab-option.best [role="status"]')?.textContent, leaveAt };
        el.remove();
        return out;
      });
      assert.equal(reminded.calls.length, 1);
      assert.equal(reminded.calls[0][0], reminded.leaveAt);
      assert.match(reminded.text, /提醒你出門/);
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
      // 輕量 3D 降級（M5-11）：測試以 reduced motion 執行 → 精簡模式，不做翻轉
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lite-motion')), true);
      assert.equal(await dg.evaluate((n) => n.classList.contains('reranked')), false);
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

  test(`${dname}：完整動態時卡片 3D 進場、決策圖重算有排名翻轉`, async () => {
    const ctx = await browser.newContext({ ...device, reducedMotion: 'no-preference' });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }));
      await page.goto(`${base}/#/agent`);
      await page.waitForSelector('.suggest .chip');
      await page.locator('.suggest .chip').first().click();
      await page.waitForSelector('.decision .dg-svg', { timeout: 20000 });
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lite-motion')), false);
      assert.match(await page.locator('.results .enter3d').first().evaluate((n) => getComputedStyle(n).animationName), /ab-enter3d/);
      await page.locator('.decision .dg-chip.add', { hasText: '想省錢' }).click();
      assert.equal(await page.locator('.decision').evaluate((n) => n.classList.contains('reranked')), true);
    } finally {
      await ctx.close();
    }
  });

  test(`${dname}：示範模式 8 個建議問題（M5-13、M10）都有討論串、卡片與總結`, async () => {
    const want = ['trip', 'bus-route', 'trip', 'youbike', 'trip', 'timetable', 'pharmacy', 'invoice']; // 依 life.json 建議問題順序
    await withPage(device, '#/agent', async (page) => {
      await page.waitForSelector('.suggest .chip');
      const qs = await page.locator('.suggest .chip').allTextContents();
      assert.equal(qs.length, want.length);
      for (let i = 0; i < qs.length; i++) {
        await page.locator('.suggest .chip').nth(i).click();
        await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
        const turn = page.locator('.turn').nth(i);
        assert.equal(await turn.locator('.msg.error').count(), 0, qs[i]);
        assert.ok(await turn.locator('.thread .bubble.tool').count() >= 1, qs[i]);
        assert.equal(await turn.locator(`.results [data-card="${want[i]}"]`).count(), 1, `${qs[i]} → ${want[i]}`);
        if (want[i] === 'trip') assert.equal(await turn.locator('.decision .dg-svg').count(), 1, qs[i]);
        await turn.scrollIntoViewIfNeeded();
        await turn.screenshot({ path: new URL(`${dname}-suggest-${i + 1}.png`, SHOTS).pathname });
      }
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

// MCP Apps（M4-08，CARDS.md §6）：AppBridge 當 host（test/cards/mcp-host.js）經 /mcp 載入 ui://abang/cards.html，
// 每種卡片都在沙箱 iframe 內渲染；點站牌 → updateModelContext；訂票 → callServerTool 往返 → 卡片內 L2 確認 → openLink。
test('MCP Apps：AppBridge 載入 cards.html，7 種卡片、callServerTool 往返、L2 確認後開連結', async () => {
  const { build } = await import('esbuild');
  const js = (await build({ entryPoints: [new URL('../test/cards/mcp-host.js', import.meta.url).pathname], bundle: true, format: 'esm', write: false, logLevel: 'silent' })).outputFiles[0].text;
  const tomorrow = new Date(Date.now() + 32 * 3600e3).toISOString().slice(0, 10); // 台灣時間的明天（今天的班次可能都開走了）
  const P = { lat: 25.0478, lon: 121.517 };
  const CASES = [
    ['bus-route', 'bus_route_eta', { city: 'Taipei', routeName: '307' }],
    ['bus-station', 'bus_station_eta', { city: 'Taipei', stationId: 'M1000' }],
    ['nearby', 'bus_nearby_stations', P],
    ['youbike', 'youbike_nearby', P],
    ['metro', 'metro_live_board', { system: 'TRTC', station: '台北車站' }],
    ['timetable', 'thsr_timetable', { from: '台北', to: '左營', date: tomorrow }],
    ['trip', 'plan_trip', { from: '台北車站', to: '高雄車站', departAt: '09:00', prefs: { states: ['rush'], arriveBy: '12:00' } }],
  ];
  const ctx = await browser.newContext({ viewport: { width: 760, height: 900 }, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // 測試 host 的 MCP client 會試開 GET SSE，stateless 的 /mcp 回 405（預期行為），不算錯誤
    page.on('console', (m) => m.type() === 'error' && !/status of 405/.test(m.text()) && errors.push(`console: ${m.text()}`));
    await page.route(`${base}/__e2e/mcp-host.html*`, (r) => r.fulfill({ // 同源（瀏覽器擋公開網域連 127.0.0.1）；路徑只存在於測試攔截
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>MCP Apps host</title></head><body style="margin:16px;background:#f4f6f5;font-family:sans-serif"><div id="slots" style="display:grid;gap:12px"></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`,
    }));
    await page.goto(`${base}/__e2e/mcp-host.html?mcp=${encodeURIComponent(`${base}/mcp`)}`);
    await page.waitForFunction(() => typeof window.mountCard === 'function');
    for (const [card, name, args] of CASES) await page.evaluate(([id, n, a]) => window.mountCard(id, n, a), [`c-${card}`, name, args]);
    await page.waitForFunction((n) => window.__host.ready === n, CASES.length, { timeout: 20000 });
    for (const [card] of CASES) {
      const f = page.frameLocator(`#c-${card} iframe`);
      await f.locator(`.ab-card[data-card="${card}"]`).waitFor({ timeout: 10000 });
      assert.ok(await f.locator('.ab-demo').count() >= 1, `${card} 示範資料標示`);
    }

    // 點站牌 → 卡片經 updateModelContext 告訴模型使用者在看哪一站
    await page.frameLocator('#c-bus-route iframe').locator('.ab-stop-row').first().click();
    await page.waitForFunction(() => window.__host.context.length > 0);
    assert.match((await page.evaluate(() => window.__host.context))[0], /307/);

    // 訂票（L2）：callServerTool(rail_booking_link) → 卡片內確認框 → 前往官方網站 → host openLink
    const tt = page.frameLocator('#c-timetable iframe');
    await tt.locator('.ab-train .ab-btn').first().click();
    await tt.locator('.ab-confirm[role="alertdialog"]').waitFor();
    assert.ok((await page.evaluate(() => window.__host.calls)).includes('rail_booking_link'));
    assert.equal((await page.evaluate(() => window.__host.opened)).length, 0, '確認前不開連結');
    await page.waitForTimeout(300); // 等 autoResize 把 iframe 撐高，確認框才在畫面內
    // 每張卡片各自截圖（整頁截圖時畫面外的 iframe 可能沒有繪製）
    for (const [card] of CASES) {
      await page.locator(`#c-${card}`).scrollIntoViewIfNeeded();
      await page.locator(`#c-${card}`).screenshot({ path: new URL(`mcp-app-${card}.png`, SHOTS).pathname });
    }
    await tt.locator('.ab-confirm .ab-primary').click();
    await page.waitForFunction(() => window.__host.opened.length === 1);
    assert.match((await page.evaluate(() => window.__host.opened))[0], /^https:\/\//);
    assert.equal(await tt.locator('.ab-confirm').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

// 無障礙（M6-04）：鍵盤第一個 Tab 是「跳到主要內容」、焦點框看得到、分頁列 aria-current、卡片有常駐播報區、公車頁有 live region
test('無障礙：跳到主要內容、焦點框、aria-current、播報區', async () => {
  await withPage(DEVICES.desktop, '#/nearby', async (page) => {
    await page.waitForSelector('.tabbar a[aria-current="page"]');
    assert.equal(await page.getAttribute('.tabbar a[aria-current="page"]', 'data-h'), '#/nearby');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'skip');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.equal(outline, 'solid', '焦點框');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
    await page.goto(`${base}/#/bus/Taipei/307`);
    await page.waitForSelector('.timeline');
    assert.equal(await page.locator('#sr[aria-live="polite"]').count(), 1);
  });
  await withPage(DEVICES.desktop, 'ui/cards/preview.html', async (page) => {
    await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
    const cards = await page.locator('.ab-card').count();
    assert.equal(await page.locator('.ab-sr[aria-live="polite"]').count(), cards, '每張卡片一個播報區');
  });
});

// 首頁範例問題（M5-12）的文字要看得到：不能繼承 hero 的白字（M6-04 發現白底白字）
test('無障礙：首頁範例問題文字對比', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('.hero-ask .chip');
    const [fg, bg] = await page.locator('.hero-ask .chip').first().evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
    assert.notEqual(fg, bg);
    assert.notEqual(fg, 'rgb(255, 255, 255)');
  });
});

// 阿幫・防詐（M7-06）：首頁格子進入、5 個建議問題逐題、風險卡片、總結有 165、沒有「安全」保證
for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：防詐頁建議問題、風險卡片、L2 說法`, async () => {
    await withPage(device, '#/', async (page) => {
      await page.click('a.tile[href="#/agent/antifraud"]');
      await page.waitForSelector('.suggest .chip');
      assert.equal(await page.textContent('#title'), '阿幫・防詐');
      const qs = await page.locator('.suggest .chip').allTextContents();
      assert.equal(qs.length, 5);
      for (let i = 0; i < qs.length; i++) {
        await page.locator('.suggest .chip').nth(i).click();
        await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
        const turn = page.locator('.turn').nth(i);
        assert.equal(await turn.locator('.msg.error').count(), 0, qs[i]);
        const say = await turn.locator('.bubble.final .say').textContent();
        assert.match(say, /165/, qs[i]);
        assert.doesNotMatch(say.replace(/不代表一定安全/g, ''), /安全/, qs[i]);
        if (i < 2) {
          const card = turn.locator('.results [data-card="scam-risk"]');
          assert.equal(await card.count(), 1, qs[i]);
          assert.ok(await card.locator('.ab-risk.high, .ab-risk.medium').count() === 1, `${qs[i]} 應為高風險或有疑點`);
          await turn.screenshot({ path: new URL(`${dname}-antifraud-${i + 1}.png`, SHOTS).pathname });
        }
      }
      assert.match(await page.textContent('.agent-mode'), /示範模式/);
    });
  });
}

// 生活服務（M10）：首頁 8 個格子都進得去、各自顯示對應卡片、無錯誤；發票卡片內對獎
test('生活服務：首頁格子 → 服務頁卡片（捷運、天氣、空品、地震、藥局、垃圾車、油價、發票）', async () => {
  const CASES = [['metro', 'metro'], ['weather', 'weather'], ['aqi', 'aqi'], ['quake', 'quake'], ['pharmacy', 'pharmacy'], ['garbage', 'garbage'], ['fuel', 'fuel'], ['invoice', 'invoice']];
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('.grid .tile');
    assert.equal(await page.locator('.grid .tile.soon').count(), 0, '首頁沒有「規劃中」的格子');
    for (const [id, card] of CASES) {
      await page.goto(`${base}/#/`);
      await page.click(`a.tile[href="#/s/${id}"]`);
      await page.waitForSelector(`.ab-card[data-card="${card}"]`, { timeout: 15000 });
      assert.equal(await page.locator('.error').count(), 0, id);
      await shot(page, `phone-service-${id}`);
    }
    // 發票：卡片內輸入號碼對獎（host.callTool 往返）
    await page.fill('.ab-input', '12348835');
    await page.press('.ab-input', 'Enter');
    await page.waitForSelector('.ab-win');
    assert.match(await page.textContent('.ab-win'), /三獎/);
  });
});
