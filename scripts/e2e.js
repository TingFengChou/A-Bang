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
    env: { ...process.env, PORT: String(port), DEMO_MODE: '1', DEMO_CLOCK: '10:00', TDX_CLIENT_ID: '', TDX_CLIENT_SECRET: '', CWA_API_KEY: '', ANTHROPIC_API_KEY: '', AGENT_RPM: '500', AGENT_RPD: '5000', RATE_LIMIT_API: '2000', JUDGE: 'off' }, // 判斷層要下載模型，E2E 用規則（判斷層另有單元測試）; // 測試一分鐘內呼叫很多次 API，限流另在 mcp.test 測
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

/** 新的 browser context：預設已看過首次使用引導（其他測試不被對話框擋住）；onboard: true 時照第一次使用 */
async function newCtx(opts, { onboard = false } = {}) {
  const ctx = await browser.newContext(opts);
  if (!onboard) await ctx.addInitScript(() => { try { localStorage.setItem('abang.onboarded', '1'); } catch { /* 無痕 */ } });
  return ctx;
}

/** 開新的 browser context 與頁面、收集錯誤，跑完 fn（不論成敗）一定關閉 context；最後確認沒有頁面錯誤 */
/** @param {{ init?: Function, initArg?: any }} [opts] init：頁面載入前執行（page.addInitScript），例如假相機 */
async function withPage(device, path, fn, { init, initArg, ignore, geo = true } = {}) {
  const ctx = await newCtx({ ...device, ...(geo && { geolocation: TAIPEI, permissions: ['geolocation'] }), reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    if (init) await page.addInitScript(init, initArg);
    await page.goto(`${base}/${path}`);
    await fn(page);
    assert.deepEqual(errors.filter((e) => !ignore?.test(e)), [], path);
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
      // 示範資料標示：E2E 伺服器全部示範 → 每個格子都標「示範」
      await page.waitForSelector('a.tile .tag.demo');
      assert.equal(await page.locator('a.tile .tag.demo').count(), await page.locator('a.tile[data-source]').count());
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

  test(`${dname}：公車街景圖片載不到時只留文字（不顯示破圖）`, async () => {
    await withPage({ ...device, serviceWorkers: 'block' }, '#/bus/Taipei/601?stop=' + encodeURIComponent('民生捷運站(1號出口)') + '&dir=0', async (page) => { // service worker 會直接回快取，攔不到
      await page.route('**/img/scene/*', (r) => r.abort());
      await page.reload();
      await page.waitForSelector('#scene .ab-scene3d');
      await page.waitForFunction(() => [...document.querySelectorAll('#scene img')].every((i) => i.hidden));
      assert.equal(await page.locator('#scene .ab-scene-label.stop').textContent(), '民生捷運站(1號出口)');
    }, { ignore: /Failed to load resource/ }); // 故意擋掉圖片
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

  test(`${dname}：附近：拒絕定位時說原因、先用台北車站、可以再試一次（S1c）`, async () => {
    await withPage(device, '#/nearby', async (page) => {
      await page.waitForSelector('.loc-help');
      assert.match(await page.textContent('.loc-help'), /定位權限沒有打開.+網站設定.+台北車站附近/);
      assert.equal(await page.locator('.loc-help button', { hasText: '到設定開啟' }).count(), 0, '網頁版沒有開設定的按鈕');
      await page.waitForSelector('.card.list .title');
      await page.click('.loc-help button:has-text("再試一次")');
      await page.waitForSelector('.loc-help');
      assert.equal(await page.locator('.loc-help').count(), 1, '再試一次不會疊兩個說明');
    }, { geo: false });
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
      // 深夜（約 22 點後）示範班次都開走了：先展開已開出的班次再找訂票按鈕
      const gone = tt.locator('.ab-btn', { hasText: '顯示今天已開出' });
      if (await gone.count()) await gone.first().click();
      assert.ok(await tt.locator('.ab-btn', { hasText: '訂票' }).count() > 0);
      // 行程卡：跨城建議（高鐵）有導航與訂票；有出門時間時可設定提醒（時間已過則不顯示）
      const tripRail = page.locator('[data-card="trip"]').first();
      assert.ok(await tripRail.locator('.ab-option.best .ab-btn', { hasText: '訂票' }).count() === 1);
      // 提醒我出門：以假 host 渲染一張今天、30 分鐘後出門的行程卡。
      // 時鐘固定在台灣上午 10 點，避免「現在＋30 分」跨過午夜（CI 在 UTC 23:30 後跑會變成隔天而失敗）
      await page.clock.setFixedTime(new Date('2026-11-19T10:00:00+08:00'));
      const reminded = await page.evaluate(async () => {
        const { renderCard } = await import('/ui/cards/index.js');
        const leaveAt = '10:30';
        const today = '2026-11-19';
        const calls = [];
        const canceled = [];
        // 第一次要通知權限：先說明，按「好，允許通知並提醒我」才設定；設好後可以取消（T7）
        const host = { remind: async (at, text) => { calls.push([at, text]); return 'r1'; }, cancelRemind: (id) => canceled.push(id), notifyState: async () => 'prompt', openLink() {} };
        const el = document.createElement('div');
        document.body.append(el);
        const P = { name: 'A', lat: 25, lon: 121 };
        renderCard(el, { card: 'trip', mode: 'demo', data: { from: P, to: { ...P, name: 'B' }, date: today, departAt: '09:00', best: 'thsr', states: [],
          options: [{ id: 'thsr', role: 'thsr', name: '高鐵', minutes: 120, waitMin: 10, walkMin: 2, cost: 1300, arriveAt: '11:00', leaveAt, notes: [],
            legs: [{ mode: 'walk', from: P, to: P, minutes: 2, detail: '走', nav: null }] }],
          ranking: { ranked: [{ id: 'thsr', name: '高鐵', score: 90 }], excluded: [], reason: '選「高鐵」' } } }, host);
        const wait = () => new Promise((r) => setTimeout(r, 50));
        el.querySelector('.ab-option.best .ab-btn').click();
        await wait();
        const why = el.querySelector('.ab-explain')?.textContent || '';
        const before = calls.length;
        [...el.querySelectorAll('.ab-explain .ab-btn')].find((b) => /允許通知/.test(b.textContent)).click();
        await wait();
        const text = el.querySelector('.ab-remind p')?.textContent;
        const focused = document.activeElement?.textContent;
        [...el.querySelectorAll('.ab-remind .ab-btn')].find((b) => b.textContent === '取消提醒').click();
        await wait();
        const out = { calls, text, leaveAt, why, before, canceled, after: el.querySelector('.ab-remind')?.textContent, focused };
        el.remove();
        return out;
      });
      // 真實資料的卡片標「真實資料」，示範標「示範資料」
      const badges = await page.evaluate(async () => {
        const { renderCard } = await import('/ui/cards/index.js');
        const out = {};
        for (const mode of ['live', 'demo']) {
          const el = document.createElement('div');
          renderCard(el, { card: 'fuel', mode, data: { effectiveDate: '2026-11-16', prices: [{ name: '92無鉛汽油', price: 31.2 }] } });
          out[mode] = el.querySelector('.ab-badge')?.textContent;
        }
        return out;
      });
      assert.deepEqual(badges, { live: '真實資料', demo: '示範資料' });
      assert.match(reminded.why, /會問你是否允許通知/);
      assert.equal(reminded.before, 0, '說明前不要權限、不設定');
      assert.equal(reminded.calls.length, 1);
      assert.equal(reminded.calls[0][0], reminded.leaveAt);
      assert.match(reminded.text, /提醒你出門/);
      assert.deepEqual(reminded.canceled, ['r1']);
      assert.match(reminded.after, /已取消出門提醒/);
      assert.equal(reminded.focused, '取消提醒', '設好後焦點在「取消提醒」（整張卡重畫）');
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

  test(`${dname}：點決策圖上的其他方案＝改成它（沿用起訖點重算）；行程卡備案有「改成…」按鈕`, async () => {
    await withPage(device, '#/agent', async (page) => {
      await page.fill('.chat-input', '從西門町到台北101怎麼去');
      await page.press('.chat-input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      const pick = page.locator('.results [data-card="trip"] .ab-pick').first();
      assert.match(await pick.textContent(), /^改成/);
      assert.ok((await pick.boundingBox()).height >= 44, '點擊範圍 ≥ 44px');
      assert.ok(await page.locator('.decision .dg-hint').count() >= 1, '提示可以點方案');
      const opt = page.locator('.decision .dg-opt.pickable').first();
      await opt.click();
      await page.waitForFunction(() => document.querySelectorAll('.msg.user').length === 2);
      assert.match(await page.locator('.msg.user').nth(1).textContent(), /^改成/);
      await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
      assert.match(await page.locator('.dg-why').last().textContent(), /照你說的選/);
    });
  });

  test(`${dname}：系統深色模式下仍是淺色（外框與卡片一致）`, async () => {
    await withPage({ ...device, colorScheme: 'dark' }, '#/s/weather', async (page) => {
      await page.waitForSelector('.ab-card');
      const [bg, card] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.ab-card')).backgroundColor]);
      const light = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (r + g + b) / 3 > 200; };
      assert.ok(light(bg) && light(card), `${bg} / ${card}`);
    });
  });

  test(`${dname}：問阿幫（建議問題 → 討論串 → 卡片 → 總結；@ 點名；定位）`, async () => {
    await withPage(device, '#/agent', async (page) => {
      await page.waitForSelector('.suggest .chip');
      // 輸入框至少 16px（iOS 點進去才不會自動放大）
      assert.ok(parseFloat(await page.locator('.chat-input').evaluate((e) => getComputedStyle(e).fontSize)) >= 16);
      await page.locator('.suggest .chip').first().click(); // 去台北 101（起點用現在位置）
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      // 回答後：桌面自動聚焦輸入框；手機不聚焦（不跳鍵盤蓋住回答）
      await page.waitForFunction(() => !document.querySelector('.chat-send')?.disabled);
      const focused = await page.evaluate(() => document.activeElement?.classList.contains('chat-input'));
      assert.equal(focused, dname === 'desktop', `${dname}：回答後${dname === 'desktop' ? '' : '不'}聚焦輸入框`);
      assert.match(await page.locator('.msg.user').first().textContent(), /台北 101/);
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
      assert.equal(await page.locator('.turn').nth(1).locator('.say.typing').count(), 0, '定位完成後不再顯示「定位中」');
      assert.match(await page.locator('.turn').nth(1).textContent(), /拿到了，用你現在的位置/);
      await shot(page, `${dname}-agent-location`);
    });
  });

  test(`${dname}：完整動態時卡片 3D 進場、決策圖重算有排名翻轉`, async () => {
    const ctx = await newCtx({ ...device, reducedMotion: 'no-preference' });
    try {
      const page = await ctx.newPage();
      await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }));
      await page.goto(`${base}/#/agent`);
      await page.waitForSelector('.suggest .chip');
      await page.locator('.suggest .chip').first().click();
      await page.waitForSelector('.decision .dg-svg', { timeout: 20000 });
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lite-motion')), false);
      assert.match(await page.locator('.results .enter3d').first().evaluate((n) => getComputedStyle(n).animationName), /ab-enter3d/);
      // 決策出爐（GSAP 時間軸）：中途截圖檢查編排；播完後節點都看得到、勝出路徑開始流動
      assert.equal(await page.evaluate(() => typeof window.gsap), 'object', 'GSAP 有載入');
      assert.ok(await page.locator('.decision.gsap').count(), '決策圖由 GSAP 編排');
      await page.waitForTimeout(900);
      await shot(page, `${dname}-motion-decision-mid`);
      await page.waitForFunction(() => document.querySelector('.decision .dg-edge.win.flow'), null, { timeout: 6000 });
      await shot(page, `${dname}-motion-decision-done`);
      assert.ok(await page.locator('.decision .dg-node').evaluateAll((ns) => ns.every((n) => Number(getComputedStyle(n).opacity) > 0.3)), '播完後節點都看得到');
      assert.equal(await page.locator('.decision .dg-dot').count(), 0, '光點播完就移除');
      await page.locator('.decision .dg-chip.add', { hasText: '想省錢' }).click();
      assert.equal(await page.locator('.decision').evaluate((n) => n.classList.contains('reranked')), true);
    } finally {
      await ctx.close();
    }
  });

  test(`${dname}：示範模式 8 個建議問題（M5-13、M10）都有討論串、卡片與總結`, async () => {
    const want = ['trip', 'bus-route', 'youbike', 'weather', 'trip', 'trip', 'timetable', 'invoice']; // 依 life.json 建議問題順序（起點與所在地用現在位置）
    await withPage(device, '#/agent', async (page) => {
      await page.waitForSelector('.suggest .chip');
      const qs = await page.locator('.suggest .chip').allTextContents();
      assert.equal(qs.length, want.length);
      for (let i = 0; i < qs.length; i++) {
        // 回答後建議會換成「接下來可以…」；按「其他問題」回到一般建議再點下一題
        if (await page.locator('.suggest.next').count()) await page.locator('.suggest .chip', { hasText: '其他問題' }).click();
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
  const ctx = await newCtx({ viewport: { width: 760, height: 900 }, reducedMotion: 'reduce' });
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

// 生活服務（M10）：首頁 9 個格子都進得去、各自顯示對應卡片、無錯誤；發票卡片內對獎
test('生活服務：首頁格子 → 服務頁卡片（捷運、天氣、空品、地震、藥局、垃圾車、油價、股市、發票）', async () => {
  const CASES = [['metro', 'metro'], ['weather', 'weather'], ['aqi', 'aqi'], ['quake', 'quake'], ['pharmacy', 'pharmacy'], ['garbage', 'garbage'], ['fuel', 'fuel'], ['stock', 'stock'], ['invoice', 'invoice']];
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

test('選公車就盯到站（L-14）：想省錢 → 公車卡片聚焦上車站 → 到站前 5 分提醒 → 開公車頁（同一個提醒）→ 到點通知', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-input', '我想省錢，從西門町到台北101怎麼去？');
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    const card = page.locator('.results [data-card="bus-route"]');
    await card.waitFor();
    assert.equal(await card.locator('.ab-focus').count(), 1, '上車站大倒數');
    assert.equal(await card.locator('.ab-stop.me').count(), 1, '標出你在這上車');
    assert.match(await card.locator('.ab-stop.me').textContent(), /你在這上車/);
    assert.match(await page.locator('.bubble.final .say').textContent(), /要我在(公車快到站|下一班快到)時提醒你嗎/);
    // 示範到站時間隨時間變化；之後的查詢固定成 15 分，提醒才不會一設定就到點（到點通知在 test/bus-follow.test.js 測）
    await page.route('**/api/v1/tools/bus_route_eta', async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j.data?.focus) Object.assign(j.data.focus, { etaSec: 900, status: 0, statusText: '15 分' });
      await route.fulfill({ response: res, json: j });
    });
    // 接下來可以…：輸入框上方換成這一輪的下一步（到站提醒、開公車頁、回程…），不是一開始的通用範例
    await page.waitForSelector('.suggest.next .next-title');
    const nextLabels = await page.locator('.suggest.next .chip').allTextContents();
    assert.ok(nextLabels.includes('上車後提醒我下車') && nextLabels.includes('其他問題'), nextLabels.join('、')); // 行程中模式：有車要來時建議下車提醒（卡片上仍有開公車頁）
    assert.ok(!nextLabels.includes('307 到哪了？我在臺北車站'), '通用範例收起來');
    await card.getByRole('button', { name: '到站前 5 分提醒我' }).click();
    await card.locator('.ab-alert-on').waitFor();
    assert.match(await card.locator('.ab-alert-on').textContent(), /到站前 5 分提醒你/);
    assert.equal(await card.locator('.ab-map-btn, .ab-map3d').count(), 0, '問阿幫公車卡沒有地圖（改在公車頁看街景）');
    await shot(page, 'phone-agent-bus-follow');
    // 開公車頁：同一個上車站、同一個提醒
    await card.getByRole('button', { name: '開公車頁看動態' }).click();
    await page.waitForSelector('.bus-focus');
    assert.match(page.url(), /#\/bus\/Taipei\/[^?]+\?stop=/);
    assert.equal(await page.locator('.timeline .me').count(), 1);
    assert.match(await page.textContent('.bus-focus'), /已設定：到站前 5 分提醒你/);
    // 公車街景（Blender）：站名標籤＝上車站；說明有分鐘；站名不超出畫面
    const scene = page.locator('#scene .ab-scene3d');
    await scene.waitFor();
    const stopName = await page.locator('.timeline .me .title').evaluate((e) => e.firstChild.textContent.trim());
    assert.equal(await scene.locator('.ab-scene-label.stop').textContent(), stopName);
    assert.match(await scene.locator('.ab-scene-label.bus').textContent(), /\d+ 分|進站|即將/);
    const [sb, lb] = await Promise.all([scene.boundingBox(), scene.locator('.ab-scene-label.stop').boundingBox()]);
    assert.ok(lb.x >= sb.x && lb.x + lb.width <= sb.x + sb.width + 1, '站名在畫面內');
    assert.match(await scene.getAttribute('aria-label'), new RegExp(`你在「${stopName.replace(/[()]/g, '\\$&')}」等車`));
    await shot(page, 'phone-bus-follow-page');
    // 到點：App 內 toast（通知權限另外）
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('abang:arrival', { detail: { text: '601 約 5 分後到「測試站」，該出門了！' } })));
    await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some((e) => /🚌 601 約 5 分後到「測試站」/.test(e.textContent)));
    await page.click('.bus-focus #unwatch');
    await page.waitForFunction(() => /到站前 3 分提醒我/.test(document.querySelector('.bus-focus')?.textContent || ''));
  }, { init: () => { window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } }; } });
});

test('股市：預設查台積電、0050，漲紅跌綠有 ▲▼；卡片內查別檔；問阿幫追問「那聯發科呢？」與問買賣', async () => {
  await withPage(DEVICES.phone, '#/s/stock', async (page) => {
    await page.waitForSelector('.ab-card[data-card="stock"] .ab-stk');
    assert.equal(await page.inputValue('#f input[name=query]'), '台積電、0050');
    assert.equal(await page.locator('.ab-card[data-card="stock"] .ab-stat').count(), 2, '加權指數與櫃買指數');
    assert.match(await page.locator('.ab-stk').first().textContent(), /台積電.*2330.*上市/);
    assert.match(await page.locator('.ab-stk .ab-chg.up').first().textContent(), /^▲5/);
    assert.match(await page.textContent('.ab-card[data-card="stock"] .ab-foot'), /不構成投資建議/);
    // 卡片內查別檔（host.callTool 往返）
    await page.fill('.ab-card .ab-input', '環球晶');
    await page.press('.ab-card .ab-input', 'Enter');
    await page.waitForFunction(() => /環球晶/.test(document.querySelector('.ab-stk')?.textContent || ''));
    assert.match(await page.locator('.ab-stk .ab-chg.down').first().textContent(), /^▼54/);
    assert.equal(await page.locator('.error').count(), 0);
    await shot(page, 'phone-service-stock-query');
  });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const ask = async (q, n) => {
      await page.fill('.chat-input', q);
      await page.press('.chat-input', 'Enter');
      await page.waitForFunction((k) => document.querySelectorAll('.bubble.final').length === k, n, { timeout: 20000 });
      return page.locator('.turn').nth(n - 1);
    };
    const t1 = await ask('台積電股價多少', 1);
    assert.match(await t1.locator('.results [data-card="stock"] .ab-stk').first().textContent(), /台積電/);
    const t2 = await ask('那聯發科呢？', 2);
    assert.match(await t2.locator('.results [data-card="stock"] .ab-stk').first().textContent(), /聯發科/, '追問沿用股市');
    const t3 = await ask('我該買台積電嗎？', 3);
    assert.match(await t3.locator('.bubble.final .say').textContent(), /^阿幫不提供投資建議/);
    await shot(page, 'phone-agent-stock');
  });
});

// 掃發票：假的 BarcodeDetector 依序吐出條碼、假相機（canvas 串流）；CI 的 Linux Chromium 本來就沒有 BarcodeDetector
const LEFT_QR = 'AB54348835115080312340000006400000069000000001234567800000000000000000000000:**********:1:1:1:咖啡:1:65';
function fakeScanner(codes) {
  const queue = [...codes];
  window.BarcodeDetector = class {
    static async getSupportedFormats() { return ['qr_code', 'code_39']; }
    async detect() { return queue.length ? [{ rawValue: queue.shift() }] : []; }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d').fillRect(0, 0, 64, 64);
    return c.captureStream(5);
  };
}

test('掃發票：右邊 QR 提示掃左邊、同一張只存一次、一維條碼存期別；完成後一次對獎；不支援的瀏覽器改手動', async () => {
  await withPage(DEVICES.phone, '#/s/invoice', async (page) => {
    await page.click('#inv-scan');
    await page.waitForSelector('dialog.scan-dialog[open]');
    await page.waitForFunction(() => /這次已存 2 張/.test(document.querySelector('.scan-status')?.textContent || ''), null, { timeout: 10000 });
    await shot(page, 'phone-invoice-scan');
    await page.click('.scan-done');
    assert.equal(await page.locator('dialog.scan-dialog').count(), 0, '關閉後移除視窗並停止相機');
    await page.waitForSelector('#inv-list .inv-st.won');
    assert.match(await page.textContent('#inv-list .inv-st.won'), /頭獎/);
    await page.waitForFunction(() => [...document.querySelectorAll('#inv-list .inv-st.wait')].some((e) => /1\/25 開獎/.test(e.textContent)));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invoices')).map((x) => [x.number, x.date || x.period]));
    assert.deepEqual(saved.sort(), [['12345678', '11511'], ['54348835', '2026-08-03']]);
  }, { init: fakeScanner, initArg: ['**咖啡:1:65', LEFT_QR, LEFT_QR, '11512XY123456780000'] });
  await withPage(DEVICES.phone, '#/s/invoice', async (page) => {
    await page.waitForSelector('#inv-add');
    assert.equal(await page.locator('#inv-scan').count(), 0);
    assert.match(await page.textContent('.inv-noscan'), /不支援掃描/);
  }, { init: () => { window.BarcodeDetector = undefined; } });
});

test('我的發票（本機）：存起來立刻對獎、待開獎顯示開獎日、打開 App 時自動對獎並通知中獎', async () => {
  await withPage(DEVICES.phone, '#/s/invoice', async (page) => {
    await page.waitForSelector('#inv-add');
    // 已開獎的期別（示範資料 11507）：存起來就出結果
    await page.fill('#inv-add input[name=number]', '54348835');
    await page.fill('#inv-add input[name=date]', '2026-08-03');
    await page.click('#inv-add button');
    await page.waitForSelector('#inv-list .inv-st.won');
    assert.match(await page.textContent('#inv-list .inv-st.won'), /頭獎/);
    // 還沒開獎的期別：顯示開獎日
    await page.fill('#inv-add input[name=number]', '11111111');
    await page.fill('#inv-add input[name=date]', '2026-10-01');
    await page.click('#inv-add button');
    await page.waitForFunction(() => [...document.querySelectorAll('#inv-list .inv-st.wait')].some((e) => /11\/25 開獎/.test(e.textContent)));
    assert.equal(await page.locator('#inv-list [data-id]').count(), 2);
    await shot(page, 'phone-invoice-wallet');
    // 只存在本機
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invoices')).map((x) => x.number));
    assert.deepEqual(saved.sort(), ['11111111', '54348835']);
    // 模擬「上次存時還沒開獎、現在開獎了」：打開 App（首頁）就自動對獎並通知
    await page.evaluate(() => localStorage.setItem('invoices', JSON.stringify([{ id: 'x', number: '12348835', period: '11507', status: 'pending', drawDate: '2026-09-25' }])));
    await page.goto(`${base}/#/`);
    await page.reload();
    await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some((e) => /中獎了.+12348835 三獎/.test(e.textContent)), null, { timeout: 10000 });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('invoices'))[0]);
    assert.equal(after.status, 'won');
  });
});

// Android 返回手勢（PR #31）：下一層按返回回到上一層；首頁再按返回離開 App（不是卡在首頁）
test('Android 返回：高鐵頁 → 首頁 → 離開 App', async () => {
  const init = () => {
    const calls = (window.__capCalls = []);
    window.Capacitor = {
      isNativePlatform: () => false, getPlatform: () => 'android',
      addListener: (plugin, ev, fn) => { if (plugin === 'App' && ev === 'backButton') window.__back = fn; return { remove() {} }; },
      nativePromise: (plugin, method) => { calls.push(`${plugin}.${method}`); return Promise.resolve({}); },
    };
  };
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('a.tile[href="#/rail/thsr"]');
    await page.click('a.tile[href="#/rail/thsr"]');
    await page.waitForFunction(() => location.hash === '#/rail/thsr');
    await page.evaluate(() => window.__back({ canGoBack: true }));
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '');
    await page.evaluate(() => window.__back({ canGoBack: false }));
    assert.deepEqual(await page.evaluate(() => window.__capCalls), ['App.exitApp']);
  }, { init });
});

// 裝置端 AI（ADR-0014）：App 裡先用系統模型判斷，請求帶 deviceJudge，畫面說明「在手機上判斷」；外掛壞掉時照常回答
test('裝置端 AI：deviceJudge 跟著請求送出、說明來源；外掛失敗時照常回答', async () => {
  const init = (fail) => {
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'ios', addListener: () => ({ remove() {} }),
      nativePromise: (plugin, method) => {
        if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
        if (fail) return Promise.reject(new Error('unavailable'));
        return Promise.resolve(method === 'judge' ? { engine: 'apple', result: { intent: 'aqi', states: [] } } : {});
      },
    };
  };
  for (const fail of [false, true]) {
    await withPage(DEVICES.phone, '#/agent', async (page) => {
      const bodies = [];
      page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
      await page.fill('.chat-form input', '今天空氣好嗎');
      await page.press('.chat-form input', 'Enter');
      await page.waitForSelector('.bubble.final', { timeout: 20000 });
      assert.equal(await page.locator('.msg.error').count(), 0);
      if (fail) {
        assert.ok(bodies.every((b) => !b.deviceJudge), '外掛失敗：不帶提示');
        assert.doesNotMatch(await page.textContent('.agent-mode'), /Apple Intelligence/);
      } else {
        assert.deepEqual(bodies[0].deviceJudge, { intent: 'aqi', states: [], engine: 'apple' });
        assert.match(await page.textContent('.agent-mode'), /先在手機上用 Apple Intelligence 聽懂你要做什麼/);
      }
    }, { init, initArg: fail, ignore: /not in test/ });
  }
});

// 手機鍵盤打開時收起底部分頁列（iOS 鍵盤彈出時分頁列會浮在鍵盤上方）：可見高度變矮＋在打字；鍵盤收起恢復
test('手機：鍵盤打開時收起分頁列', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.chat-form input');
    const full = page.viewportSize();
    assert.ok(await page.locator('.tabbar').isVisible());
    await page.focus('.chat-form input');
    assert.ok(await page.locator('.tabbar').isVisible(), '只有焦點、沒有鍵盤：不收（避免點按鈕時版面跳動）');
    await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) }); // 模擬鍵盤佔掉下半部
    await page.waitForFunction(() => document.documentElement.classList.contains('kb-open'));
    assert.equal(await page.locator('.tabbar').isVisible(), false);
    await page.setViewportSize(full);
    await page.waitForFunction(() => !document.documentElement.classList.contains('kb-open'));
    assert.ok(await page.locator('.tabbar').isVisible());
  });
});

// 拒絕定位：「定位中」換成「沒拿到你的位置」並說下一步；照常回答（示範預設起點，總結說明）
test('手機：拒絕定位時說下一步、照常回答', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '我想去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const t = await page.locator('.turn').first().textContent();
    assert.match(t, /定位權限沒有打開；可以直接打地點/); // 說原因（S1c）
    assert.equal(await page.locator('.turn .say.typing').count(), 0);
  }, { geo: false });
});

// 接著說「不要叫車」（A3）：同一段行程重算、叫車被標「不要」、建議不是叫車
test('問阿幫：接著說「不要叫車」→ 排除叫車重算', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    for (const [i, q] of ['從西門町叫車去台北101', '不要叫車'].entries()) {
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
    }
    const turn = page.locator('.turn').nth(1);
    assert.equal(await turn.locator('.msg.error').count(), 0);
    assert.match(await turn.textContent(), /沿用：西門町 → 台北101｜改：不要叫車/, '第一句說清楚沿用什麼、改了什麼');
    assert.equal(await turn.locator('.dg-opt.avoided').count(), 1, '叫車標「不要」（灰色、不劃線）');
    assert.match(await turn.locator('.dg-opt.avoided').getAttribute('aria-label'), /已排除：你說不要叫車/);
    assert.doesNotMatch(await turn.locator('.bubble.final .say').textContent(), /選「叫車/);
    await shot(page, 'phone-agent-avoid');
  });
});

// 討論串體驗（2026-11-21 設計審查）：接著問時沒變的天氣、空品收合「同上」；「重來」加分隔線、前面的對話變淡
test('問阿幫：接著問時天氣空品收合同上；重來有分隔線', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    for (const [i, q] of ['從西門町去台北101', '改坐公車', '重來'].entries()) {
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
    }
    const second = page.locator('.turn').nth(1);
    assert.ok(await second.locator('.card-same summary').count() >= 1, '第二輪天氣或空品收合');
    assert.match(await second.locator('.card-same summary').first().textContent(), /同上（.+）看完整/);
    assert.equal(await second.locator('.card-same .ab-card').count(), 0, '收合時還沒畫卡片');
    await second.locator('.card-same summary').first().click();
    await page.waitForFunction(() => document.querySelector('.card-same[open] .ab-card'));
    assert.equal(await page.locator('.thread-reset[role=separator]').count(), 1);
    assert.equal(await page.locator('.turn.past').count(), 2, '前兩輪變淡');
    assert.equal(await page.locator('.msg.user.past').count(), 2, '前兩輪的提問也變淡');
    assert.equal(await page.locator('.thread-reset + .msg.user').count(), 1, '分隔線在「重來」泡泡前面');
    const pastColor = await page.locator('.turn.past').first().evaluate((e) => getComputedStyle(e).opacity);
    assert.equal(pastColor, '1', '變淡用字色，不降不透明度（對比）');
    await shot(page, 'phone-agent-same-reset');
  });
});

// 路線時間軸點站名＝設成上車站（到站提醒、下車提醒從這裡開始）
test('路線時間軸：點站名設成上車站', async () => {
  await withPage(DEVICES.phone, '#/bus/Taipei/307', async (page) => {
    await page.waitForSelector('.timeline .stop-pick');
    assert.equal(await page.locator('#pick-hint').isVisible(), true);
    const name = await page.locator('.timeline .stop-pick').nth(4).textContent();
    await page.locator('.timeline .stop-pick').nth(4).click();
    await page.waitForSelector('.bus-focus .alight select');
    assert.match(await page.locator('.bus-focus').textContent(), new RegExp(`到「${name}」`));
    assert.match(await page.evaluate(() => location.hash), /stop=/);
    assert.match(await page.locator('#pick-hint').textContent(), /點其他站名可以改上車站/);
    assert.equal(await page.locator('.timeline .stop-pick[aria-pressed="true"]').textContent(), name);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('bus-focus')), true, '焦點移到上車站卡片');
    // 設了到站提醒後改上車站：原本的提醒還在、看得到、可以取消
    const alert = page.locator('.bus-focus [data-min="5"]');
    if (await alert.count()) {
      await alert.click();
      await page.waitForSelector('#unwatch');
      await page.locator('.timeline .stop-pick').nth(8).click();
      await page.waitForSelector('.bus-focus .other-watch');
      assert.match(await page.locator('.bus-focus .other-watch').textContent(), new RegExp(`另有提醒：「${name}」到站前 5 分`));
      await page.locator('.bus-focus .other-watch button').click();
      await page.waitForSelector('.bus-focus .other-watch', { state: 'detached' });
    }
    // 換方向：網址的 dir 跟著改
    await page.locator('#dirs button:not(.on)').click();
    assert.match(await page.evaluate(() => location.hash), /dir=1/);
  });
});

// 下車提醒：公車頁選了上車站，上車後選下車站 → 進行中顯示剩多久與取消
test('下車提醒：選下車站、進行中、取消', async () => {
  await withPage(DEVICES.phone, '#/bus/Taipei/307?stop=%E6%95%A6%E5%8C%96%E5%B8%82%E5%A0%B4&dir=0', async (page) => {
    await page.waitForSelector('.bus-focus .alight select');
    const options = await page.locator('#alight-dest option').allTextContents();
    assert.ok(options.length > 3 && !options.includes('敦化市場'), '只列上車站之後的站');
    const far = options.at(-1); // 選最遠的站（太近的站設定當下就會提醒並結束）
    await page.selectOption('#alight-dest', far);
    await page.click('.bus-focus .alight .btn');
    await page.waitForFunction((d) => document.querySelector('.bus-focus .alight .ok')?.textContent.includes(`快到「${d}」前約 2 分提醒你`), far);
    await shot(page, 'phone-alight');
    // 行程中模式：坐車中大字是到下車站還要多久、時間軸標下車站、不再給到站提醒按鈕
    assert.match(await page.textContent('.bus-focus.riding .sub'), /坐車中・從「敦化市場」上車/);
    assert.match(await page.textContent('.bus-focus.riding .big'), new RegExp(`(約 \\d+ 分到|快到)「${far}」`));
    assert.equal(await page.locator('.bus-focus [data-min]').count(), 0, '坐車中不給到站提醒');
    assert.match(await page.locator('.timeline .me-tag.off').locator('..').textContent(), new RegExp(far));
    assert.match(await page.getAttribute('.ab-scene3d', 'aria-label'), new RegExp(`你在車上，在「${far}」下車`));
    assert.equal(await page.locator('#tripbar').isHidden(), true, '在這條路線的公車頁不顯示進行中列');
    // 到首頁：上方有進行中列，點了回到公車頁
    await page.goto(`${base}/#/`);
    await page.waitForSelector('#tripbar.riding');
    assert.match(await page.textContent('#tripbar'), new RegExp(`307 坐車中・.*${far}.*看行程`));
    await shot(page, 'phone-tripbar');
    await page.click('#tripbar a');
    await page.waitForSelector('.bus-focus.riding');
    assert.equal(await page.locator('#tripbar').isHidden(), true);
    await page.click('.bus-focus .alight .btn.ghost');
    await page.waitForSelector('#alight-dest');
    assert.equal(await page.locator('.bus-focus.riding').count(), 0, '取消後回到等車中');
  });
});

// 問阿幫「上車後提醒我下車」：到公車頁、焦點在選下車站
test('上車後提醒我下車：公車頁直接選下車站', async () => {
  await withPage(DEVICES.phone, '#/bus/Taipei/307?stop=%E6%95%A6%E5%8C%96%E5%B8%82%E5%A0%B4&dir=0&alight=1', async (page) => {
    await page.waitForSelector('#alight-dest');
    await page.waitForFunction(() => document.activeElement?.id === 'alight-dest');
  });
});

// 公車一直不來（S15）：盯著的這班延誤時，公車卡片說明並給「改其他方式」（送給阿幫：沿用起訖、排除公車）
test('公車一直不來：卡片建議改其他方式', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    const out = await page.evaluate(async () => {
      const { renderCard } = await import('/ui/cards/index.js');
      const call = (a) => fetch('/api/v1/tools/bus_route_eta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }).then((x) => x.json());
      const stop = (await call({ city: 'Taipei', routeName: '307' })).data.directions[0].stops[3].stopName;
      const r = await call({ city: 'Taipei', routeName: '307', stop });
      const asked = [];
      const f = r.data.focus;
      const host = { ask: (q) => asked.push(q), arrivalWatch: () => ({ routeName: r.data.routeName, stop: f.stopName, minutes: 3, stuck: 'late' }), watchArrival() {}, unwatchArrival() {}, openLink() {} };
      const el = document.createElement('div');
      document.body.append(el);
      renderCard(el, { card: r.card, mode: r.mode, data: r.data }, host);
      const box = el.querySelector('.ab-stuck');
      box?.querySelector('button')?.click();
      const res = { text: box?.textContent || '', asked };
      el.remove();
      return res;
    });
    assert.match(out.text, /晚了 10 分以上/);
    assert.deepEqual(out.asked, ['不要坐公車了，改別的方式']);
  });
});

// 觀光客用英文問（S12b）：卡片標籤用英文（lang=en）、地名維持中文；接著用中文問又回到中文卡片
test('英文提問：卡片用英文標籤', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', 'How do I get to Taipei 101?');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const card = page.locator('[data-card="trip"]').first();
    assert.equal(await card.getAttribute('lang'), 'en');
    assert.equal(await card.locator('.ab-badge.ab-best').first().textContent(), 'Best');
    assert.match(await card.textContent(), /台北101|臺北車站/, '地名維持中文');
    // S12d：資料裡的中文（空品狀態、你的位置）走字典；小幫手回報英文
    const aqi = page.locator('[data-card="aqi"] .ab-aqi strong').first();
    if (await aqi.count()) assert.doesNotMatch(await aqi.textContent(), /[一-鿿]/);
    assert.doesNotMatch(await card.locator('.ab-title').textContent(), /你的位置/);
    const says = await page.locator('.thread .bubble.tool .say').allTextContents();
    assert.ok(says.some((x) => /Compared \d+ options/.test(x)), says.join('|'));
    assert.doesNotMatch(await page.locator('.bubble.final').last().textContent(), /in Chinese for now/);
    // S12c：討論串標題、決策圖固定文字、接下來可以 都是英文
    assert.match(await page.locator('.thread-sum').first().textContent(), /Checked \d+ source/);
    await page.waitForSelector('.decision .dg-step');
    assert.match(await page.locator('.decision .dg-step').first().textContent(), /Decision/);
    assert.match(await page.locator('.decision .dg-why').textContent(), /^[^一-鿿]+ (wins|is the only option)/, '英文理由（程式依分數組）');
    assert.doesNotMatch(await page.locator('.decision .dg-step').first().textContent(), /[一-鿿]/);
    const chips = await page.locator('.suggest .chip').allTextContents();
    assert.ok(chips.length && chips.every((c) => !/[一-鿿]/.test(c)), chips.join('|'));
    await shot(page, 'phone-agent-english');
    await page.fill('.chat-form input', '去西門町');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    assert.equal(await page.locator('[data-card="trip"]').last().getAttribute('lang'), null, '中文提問回到中文卡片');
  });
});

// S12e：英文問出門建議 → 出門建議卡片的建議也是英文（數字來自資料）
test('英文出門建議：卡片建議英文', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', 'What should I bring today?');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('[data-card="outing"] .ab-out', { timeout: 20000 });
    const items = await page.locator('[data-card="outing"] .ab-out').allTextContents();
    assert.ok(items.length && items.every((x) => !/[一-鿿]/.test(x)), items.join('|'));
    assert.match(await page.locator('.bubble.final').last().textContent(), /^Before you head out/);
  });
});

// T8：公車街景（DOM）——說明與讀屏標籤、公車位置依還有幾站、推估不出不畫車、圖片載不到只留文字；天氣卡日夜（台灣時間）
test('公車街景與天氣卡日夜', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    const out = await page.evaluate(async () => {
      const { busScene } = await import('/ui/cards/bus-scene.js');
      const mk = (o) => { const el = busScene({ routeName: '307', stopName: '西門', etaText: '5 分', ...o }); document.body.append(el); return el; };
      const far = mk({ away: 3, etaSec: 300 });
      const near = mk({ away: 0, etaSec: 40, etaText: '即將進站' });
      const none = mk({ away: null, etaText: '尚未發車' });
      const x = (el) => Number(/translate\(([-\d.]+)%/.exec(el.querySelector('.ab-scene-bus')?.style.transform || '')?.[1]);
      const res = {
        farLabel: far.getAttribute('aria-label'), nearLabel: near.getAttribute('aria-label'), nearCls: near.querySelector('.ab-scene-label.bus').className,
        farX: x(far), nearX: x(near), noneBus: none.querySelectorAll('.ab-scene-bus').length,
      };
      // 圖片載不到：隱藏圖片（不顯示破圖），文字還在
      const img = far.querySelector('img.ab-scene-bg');
      img.dispatchEvent(new Event('error'));
      res.imgHidden = img.hidden;
      res.textStill = far.querySelector('.ab-scene-label.stop').textContent;
      // 天氣卡：台灣時間 21 點＝夜晚、10 點＝白天
      const { renderCard } = await import('/ui/cards/index.js');
      const wx = (iso) => { const el = document.createElement('div'); document.body.append(el); renderCard(el, { card: 'weather', mode: 'demo', data: { station: '示範測站', town: '', county: '', distanceM: 100, observedAt: iso, tempC: 22, rainMm1h: 0, pop3h: 10, raining: false, summary: 'x' } }); return el.querySelector('.ab-scene').className; };
      res.night = wx('2026-11-21T13:00:00Z');
      res.day = wx('2026-11-21T02:00:00Z');
      return res;
    });
    assert.match(out.farLabel, /307・還有 3 站・5 分；你在「西門」等車/);
    assert.match(out.nearLabel, /就在你這站/);
    assert.match(out.nearCls, /near/);
    assert.ok(out.nearX > out.farX, '近的公車比遠的更靠右（靠近站牌）');
    assert.equal(out.noneBus, 0, '推估不出還有幾站：不畫公車');
    assert.equal(out.imgHidden, true);
    assert.equal(out.textStill, '西門');
    assert.match(out.night, /night/);
    assert.match(out.day, /sun/);
  });
});

// S19 安全情境：提到自傷 → 回答下面有一鍵撥號（tel:1925 等），不出現小幫手討論與卡片
test('安全情境：求助電話一鍵撥號', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '我真的不想活了');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final .call-row a', { timeout: 20000 });
    const tels = await page.locator('.bubble.final .call-row a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    assert.deepEqual(tels, ['tel:1925', 'tel:1995', 'tel:119']);
    assert.match(await page.locator('.bubble.final .say').textContent(), /安心專線 1925/);
    assert.equal(await page.locator('[data-card]').count(), 0, '不查工具、不出卡片');
  });
});

// 離線與弱網：看過的公車路線離線時仍顯示上次的資料，最上面說是幾點存下的；沒看過的說連不上；連回來後標示消失
test('離線：顯示上次存下的資料與時間、連回來恢復', async () => {
  const ctx = await newCtx({ ...DEVICES.phone, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/#/bus/Taipei/307`);
    await page.waitForSelector('.timeline .title');
    await page.goto(`${base}/#/`);
    await page.waitForSelector('.tabbar');
    await ctx.setOffline(true);
    await page.evaluate(() => { location.hash = '#/bus/Taipei/307'; });
    await page.waitForSelector('.timeline .title');
    await page.waitForSelector('#offline:not([hidden])');
    const banner = await page.locator('#offline').textContent();
    assert.match(banner, /目前離線：顯示 \d{2}:\d{2} 存下的資料/);
    assert.match(await page.locator('#upd').textContent(), /存下的資料/, '頁尾不說「更新於」現在時間');
    await shot(page, 'phone-offline');
    await ctx.setOffline(false);
    await page.waitForSelector('#offline', { state: 'hidden' }); // 連回來：重新載入這一頁
    await page.waitForFunction(() => /更新於/.test(document.querySelector('#upd')?.textContent || ''));
  } finally {
    await ctx.close();
  }
});

// 首次使用引導：第一次打開首頁跳出、按「允許定位」才要權限（失敗說原因）、已允許的步驟跳過、可略過、看過不再跳、設定頁可再看一次
test('首次使用引導：要權限、失敗說原因、看過不再顯示、深層連結不跳', async () => {
  const ctx = await newCtx({ ...DEVICES.phone, reducedMotion: 'reduce' }, { onboard: true }); // 沒給定位權限
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/#/`);
    const dlg = page.locator('dialog.onboard[open]');
    await dlg.waitFor();
    assert.match(await dlg.locator('h2').textContent(), /我是阿幫/);
    assert.match(await dlg.locator('.onboard-step').textContent(), /共 2 步/, '網頁版不在這裡要通知');
    await shot(page, 'phone-onboarding');
    await dlg.getByRole('button', { name: '下一步' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'onboard-title', '換步驟時焦點在標題');
    await dlg.getByRole('button', { name: '允許定位' }).click();
    await page.waitForFunction(() => /沒拿到位置/.test(document.querySelector('.onboard-status')?.textContent || ''));
    assert.doesNotMatch(await page.textContent('.onboard-status'), /再試一次/, '引導沒有重試按鈕，不說再試一次（S1c）');
    assert.match(await page.textContent('.onboard-status'), /網站設定.+直接打地點/);
    await dlg.getByRole('button', { name: '開始使用' }).click();
    await page.locator('dialog.onboard').waitFor({ state: 'detached' }); // close 事件之後才移除
    await page.reload();
    await page.waitForSelector('.tabbar');
    assert.equal(await page.locator('dialog.onboard').count(), 0, '看過不再顯示');
    // 深層連結（直接打開問阿幫）不跳引導
    await page.evaluate(() => localStorage.removeItem('abang.onboarded'));
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('.chat-form input');
    assert.equal(await page.locator('dialog.onboard').count(), 0);
    // 設定頁「再看一次使用說明」，Esc 關閉
    await page.goto(`${base}/#/settings`);
    await page.click('#guide');
    await page.locator('dialog.onboard[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog.onboard').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('首次使用引導：已允許定位就跳過那一步、略過、清除資料後再出現', async () => {
  const ctx = await newCtx({ ...DEVICES.phone, geolocation: TAIPEI, permissions: ['geolocation'], reducedMotion: 'reduce' }, { onboard: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/#/`);
    const dlg = page.locator('dialog.onboard[open]');
    await dlg.waitFor();
    await page.waitForTimeout(300); // 背景檢查權限
    await dlg.getByRole('button', { name: /下一步|開始使用/ }).click();
    await page.locator('dialog.onboard').waitFor({ state: 'detached' }); // 定位已允許：不再問
    await page.goto(`${base}/#/settings`);
    await page.click('#guide');
    await page.locator('dialog.onboard[open]').waitFor();
    await page.getByRole('button', { name: '略過使用說明' }).click();
    await page.locator('dialog.onboard').waitFor({ state: 'detached' });
    // 設定頁清除本機資料 → 下次打開首頁再顯示
    page.once('dialog', (d) => d.accept());
    await page.click('#clear');
    await page.goto(`${base}/#/`);
    await page.reload();
    await page.locator('dialog.onboard[open]').waitFor();
  } finally {
    await ctx.close();
  }
});

// 設定與隱私（M11-04、E8）：首頁連結進入、權限狀態、網頁版裝置端 AI 開關停用、隱私權政策頁、清除本機資料要確認
test('設定與隱私：首頁進入、狀態、隱私權政策', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.click('a[href="#/settings"]');
    await page.waitForSelector('#edge-status:not(:empty)');
    await page.waitForFunction(() => document.querySelector('#edge-status').textContent !== '檢查中…');
    assert.match(await page.textContent('#edge-status'), /網頁版不使用/);
    assert.equal(await page.locator('#edge').isHidden(), true, '網頁版不顯示開關');
    await page.waitForFunction(() => document.querySelector('#loc').textContent !== '檢查中…');
    assert.match(await page.textContent('#loc'), /已允許|已拒絕|還沒問過/);
    page.once('dialog', (d) => d.dismiss()); // 取消：不清除
    await page.evaluate(() => localStorage.setItem('invoices', '[]'));
    await page.click('#clear');
    assert.equal(await page.evaluate(() => localStorage.getItem('invoices')), '[]', '取消時不清除');
    // 常用地點：把現在位置設成「家」，問阿幫說「回家」就規劃到家（座標只在提到時送出）
    await page.locator('.saved-row', { hasText: '家' }).first().locator('button').first().click();
    await page.waitForFunction(() => /已設定/.test(document.querySelector('.saved-row').textContent));
    // S1b：不在那裡也能設：「輸入地點」打地名、選結果，列上顯示設成哪裡
    const work = page.locator('.saved-row', { hasText: '公司' }).first();
    await work.getByRole('button', { name: '輸入地點設成「公司」' }).click();
    await work.locator('.saved-find input').fill('板橋車站');
    await work.locator('.saved-find input').press('Enter');
    await work.getByRole('listitem').getByRole('button', { name: /設成 板橋車站（新北市）/ }).click();
    await page.waitForFunction(() => /已設定：板橋車站/.test([...document.querySelectorAll('.saved-row')].find((r) => r.textContent.includes('公司')).textContent));
    assert.equal(await work.locator('.saved-find').isHidden(), true, '選好就收起來');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('abang.places')).公司.name), '板橋車站');
    await shot(page, 'phone-settings');
    await page.click('a[href="#/privacy"]');
    await page.waitForSelector('.privacy h2');
    const text = await page.textContent('.privacy');
    for (const w of ['IP 位址', 'Anthropic', '相機', '你的權利', '不提供的影響', '常用地點']) assert.ok(text.includes(w), w);
    await shot(page, 'phone-privacy');
    const bodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
    await page.goto(`${base}/#/agent`);
    await page.fill('.chat-form input', '回家');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.ok(bodies[0].savedPlaces?.家, '提到家才送家');
    assert.equal(bodies[0].savedPlaces.公司, undefined);
    assert.match(await page.locator('.results [data-card="trip"] .ab-title').first().textContent(), /→ 家/);
  });
});
