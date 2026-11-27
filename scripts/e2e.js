// E2E 冒煙測試（docs/TESTING.md §2、§5）：示範模式起伺服器，用 Playwright 在手機與桌面開各頁，
// 檢查沒有 console／頁面錯誤、關鍵元素存在，截圖存 test/screenshots/（不進版控）。
// 執行：npm run e2e（node --test scripts/e2e.js）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, devices } from 'playwright';

const SHOTS = new URL('../test/screenshots/', import.meta.url);
const TAIPEI = { latitude: 25.0478, longitude: 121.517 };
let server, base, browser;

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });

/** 起一個示範模式的伺服器（env 可覆寫，例：DEMO_CLOCK 換成深夜） */
async function startServer(env = {}) {
  const port = await freePort();
  // 示範模式：清掉金鑰，確保不連外
  const proc = spawn(process.execPath, ['server/http.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DEMO_MODE: '1', DEMO_CLOCK: '10:00', TDX_CLIENT_ID: '', TDX_CLIENT_SECRET: '', CWA_API_KEY: '', ANTHROPIC_API_KEY: '', AGENT_RPM: '500', AGENT_RPD: '5000', RATE_LIMIT_API: '2000', JUDGE: 'off', MYDRAMA_API_BASE: '', MYDRAMA_LINK_EPISODE: 'example-drama://watch/{id}/{ep}', MYDRAMA_LINK_EXERCISE: '', MYDRAMA_STORE_IOS: 'https://example.com/drama-ios', MYDRAMA_STORE_ANDROID: 'https://example.com/drama-android', ...env }, // 判斷層要下載模型，E2E 用規則（判斷層另有單元測試）; // 測試一分鐘內呼叫很多次 API，限流另在 mcp.test 測
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('伺服器 10 秒內沒有啟動')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('running')) { clearTimeout(t); res(); } });
    proc.on('exit', (c) => rej(new Error(`伺服器結束 ${c}`)));
  });
  return { proc, base: `http://127.0.0.1:${port}` };
}

before(async () => {
  await mkdir(SHOTS, { recursive: true });
  ({ proc: server, base } = await startServer());
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
/** motion: true＝動畫開著（不是 reduced motion、不是精簡動畫），用來檢查會動的畫面 */
async function withPage(device, path, fn, { init, initArg, ignore, geo = true, motion = false, origin = base } = {}) { // geo：true＝台北車站、物件＝指定位置、false＝不給定位
  const ctx = await newCtx({ ...device, ...(geo && { geolocation: geo === true ? TAIPEI : geo, permissions: ['geolocation'] }), reducedMotion: motion ? 'no-preference' : 'reduce' });
  try {
    const page = await ctx.newPage();
    if (motion) await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    if (init) await page.addInitScript(init, initArg);
    await page.goto(`${origin}/${path}`);
    await fn(page);
    assert.deepEqual(errors.filter((e) => !ignore?.test(e)), [], path);
  } finally {
    await ctx.close();
  }
}

const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname, fullPage: true });

const DEVICES = { phone: devices['iPhone 13'], desktop: { viewport: { width: 1280, height: 860 } } };
/** 問阿幫（生活）一開始是動態建議（依時段與情境）：按「更多例子」列出固定範例（life.json） */
async function moreExamples(page) {
  await page.waitForSelector('.suggest .chip');
  const more = page.locator('.suggest .chip.ghost', { hasText: '更多例子' });
  if (await more.count()) { await more.click(); await page.waitForFunction(() => !document.querySelector('.suggest .chip.ghost')); }
}

for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：首頁、示範橫幅、分頁列、搜尋公車`, async () => {
    await withPage(device, '#/', async (page) => {
      await page.waitForSelector('.hero .search input');
      // 首頁重新設計（阿幫為中心）：手機上的 AI 照實說（網頁版由伺服器判斷）、現在（天氣、空品、提醒）、防詐大卡在格子前面
      await page.waitForFunction(() => document.querySelector('#ai-line')?.dataset.tone !== 'wait');
      assert.match(await page.textContent('#ai-line'), /網頁版.*伺服器判斷/);
      assert.equal(await page.getAttribute('.search input', 'placeholder'), '想查什麼？');
      await page.waitForSelector('#now[aria-busy="false"] [data-now="weather"]');
      assert.deepEqual(await page.locator('#now .now-item').evaluateAll((els) => els.map((e) => e.dataset.now)), ['weather', 'aqi', 'reminder']);
      assert.match(await page.textContent('#now [data-now="weather"]'), /°C.*你附近/);
      assert.equal(await page.locator('#now [data-now="weather"] .tag.demo').count(), 1, '示範資料標示範');
      assert.equal(await page.locator('#now [data-now="aqi"] .tag.demo').count(), 1);
      const order = await page.locator('#main section h2').allTextContents();
      assert.ok(order.indexOf('防詐') > -1 && order.indexOf('防詐') < order.indexOf('交通'), order.join('|'));
      assert.match(await page.textContent('.demo-banner'), /示範模式/);
      // 示範資料標示：E2E 伺服器全部示範 → 每個格子都標「示範」
      await page.waitForSelector('a.tile .tag.demo');
      assert.equal(await page.locator('a.tile .tag.demo').count(), await page.locator('a.tile[data-source]').count());
      // 分頁列：首頁｜服務｜問阿幫（中央鍵）｜提醒｜我的
      assert.deepEqual(await page.locator('.tabbar [data-shell^="tab."]').allTextContents(), ['首頁', '服務', '問阿幫', '提醒', '我的']);
      assert.equal(await page.getAttribute('.tabbar nav', 'aria-label'), '主要分頁');
      assert.equal(await page.getAttribute('.tabbar [data-tab="home"]', 'aria-current'), 'page');
      assert.equal(await page.getAttribute('#abang-fab', 'aria-haspopup'), 'dialog');
      for (const box of await page.locator('.tabbar [data-tab]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) assert.ok(box[0] >= 44 && box[1] >= 44, `觸控目標 ${box}`);
      assert.ok(await page.locator('.grid .tile').count() > 0);
      await shot(page, `${dname}-home`);
      // 首頁以問阿幫為主要入口（M5-12）：輸入問題 → #/agent 自動送出
      assert.ok(await page.locator('.hero-ask .chip').count() >= 4);
      assert.equal(await page.getAttribute('.hero-ask .chip:has-text("詐騙")', 'href'), '#/agent/antifraud');
      await page.fill('.hero .search input', '307 到哪了？我在臺北車站');
      await page.press('.hero .search input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(page.url(), /#\/agent$/);
      assert.equal(await page.locator('.results [data-card="bus-route"]').count(), 1);
      // 公車搜尋（舊網址）仍可用
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

  test(`${dname}：互動卡片預覽（8 種卡片、互動、不注入 HTML）`, async () => {
    await withPage(device, 'ui/cards/preview.html', async (page) => {
      await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
      assert.equal(await page.locator('.slot.err').count(), 0);
      const cards = await page.locator('.ab-card').evaluateAll((els) => els.map((e) => e.dataset.card));
      assert.deepEqual([...new Set(cards)].sort(), ['bus-route', 'bus-station', 'metro', 'metro-route', 'nearby', 'timetable', 'trip', 'youbike']);
      // 捷運怎麼坐：每段一列、兩段之間有轉乘列、第一段有下一班
      const mr = page.locator('[data-card="metro-route"]');
      assert.equal(await mr.locator('.ab-item').count(), 3, '三鶯線 → 板南線 → 松山新店線');
      assert.equal(await mr.locator('.ab-route-xfer').count(), 2);
      assert.match(await mr.locator('.ab-next').first().textContent(), /下一班/);
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
        document.body.append(el); // 不在畫面上的卡片不刷新（收起的阿幫對話）
        const c = renderCard(el, { card: 'metro', tool: 'metro_live_board', args: {}, mode: 'demo', data: { system: 'TRTC', station: 'X', stationId: 'X', updatedAt: new Date().toISOString(), trains: [], nav: null } }, host);
        await c.refresh(); await c.refresh(); c.destroy(); el.remove();
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
      await moreExamples(page);
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
      // 沒有狀態時以大眾運輸為主（ADR-0010 2026-11-21）；加「帶行李」才改推叫車
      assert.notEqual(before, 'ridehail', '沒有狀態時不推叫車');
      await dg.locator('.dg-chip.add', { hasText: '帶行李' }).click();
      assert.equal(await dg.getAttribute('data-run'), '2');
      assert.equal(await dg.getAttribute('data-best'), 'ridehail', '帶行李時改推叫車');
      assert.equal(await dg.locator('.dg-chip.on', { hasText: '你選的：帶行李' }).count(), 1);
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
      await moreExamples(page);
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
      await moreExamples(page);
      const qs = await page.locator('.suggest .chip').allTextContents();
      assert.equal(qs.length, want.length);
      for (let i = 0; i < qs.length; i++) {
        // 回答後建議會換成「接下來可以…」（動態的下一句）；按「其他問題」回到一般建議再點下一題
        if (i > 0) { await page.waitForSelector('.suggest.next'); await page.locator('.suggest .chip', { hasText: '其他問題' }).click(); }
        assert.equal(await page.locator('.suggest:not(.page-ask) .chip').nth(i).textContent(), qs[i]);
        await page.locator('.suggest:not(.page-ask) .chip').nth(i).click();
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
    await page.waitForSelector('.tabbar [aria-current]');
    assert.equal(await page.getAttribute('.tabbar [data-tab="services"]', 'aria-current'), 'true', '附近屬於服務這一區（子頁 aria-current=true）');
    assert.equal(await page.locator('.tabbar [aria-current="page"]').count(), 0);
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
    // 到點：阿幫說（浮動阿幫冒泡泡、讀屏念、也記在對話裡；通知權限另外）
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('abang:arrival', { detail: { text: '601 約 5 分後到「測試站」，該出門了！' } })));
    await page.waitForFunction(() => /🚌 601 約 5 分後到「測試站」/.test(document.querySelector('#abang-bubble:not([hidden])')?.textContent || ''));
    await page.waitForFunction(() => /阿幫：🚌 601 約 5 分後到「測試站」/.test(document.getElementById('abang-live')?.textContent || ''));
    await page.click('.bus-focus #unwatch');
    await page.waitForFunction(() => /到站前 3 分提醒我/.test(document.querySelector('.bus-focus')?.textContent || ''));
  }, { init: () => { window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } }; } });
});

// 阿幫問你（ADR-0016）＋個人化（ADR-0010 習慣）：不默默套用推測，在關鍵時刻問一句
/** 問阿幫：送出一句、等這一輪回答完；回傳這一輪送出的請求內容 */
async function askAbang(page, q, n, bodies) {
  await page.fill('.chat-input', q);
  await page.press('.chat-input', 'Enter');
  await page.waitForFunction((k) => document.querySelectorAll('.bubble.final').length === k, n, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.chat-send')?.disabled);
  return bodies.at(-1);
}
/** 截「阿幫問你」＋決策圖那一段（不截整串卡片） */
async function shotAsk(page, ask, name) {
  await ask.scrollIntoViewIfNeeded();
  const a = await ask.boundingBox(), d = await page.locator('.decision').last().boundingBox();
  const hidden = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((n) => /fixed|sticky/.test(getComputedStyle(n).position) && !n.closest('.results')).map((n) => { n.dataset.shotHide = n.style.visibility; n.style.visibility = 'hidden'; return 1; }).length); // 截圖時藏起固定在底部的輸入列、分頁列
  await page.screenshot({ path: new URL(name, SHOTS).pathname, fullPage: true, clip: { x: 0, y: a.y + (await page.evaluate(() => scrollY)) - 8, width: page.viewportSize().width, height: d.y + d.height - a.y + 16 } });
  if (hidden) await page.evaluate(() => document.querySelectorAll('[data-shot-hide]').forEach((n) => { n.style.visibility = n.dataset.shotHide; delete n.dataset.shotHide; }));
}
const recordBodies = (page) => { const bodies = []; page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData() || '{}')); }); return bodies; };
/** 手機上已經記了的選擇（只有方式與時間；1～N 小時前）；導航不真的開地圖 */
const seedPicks = ({ mode, n }) => { // page.addInitScript 只傳函式原始碼：參數用 initArg 帶
  window.open = () => null;
  try { if (!sessionStorage.getItem('habit-seeded')) { sessionStorage.setItem('habit-seeded', '1'); localStorage.setItem('abang.habits', JSON.stringify({ v: 2, on: true, picks: Array.from({ length: n }, (_, i) => ({ m: mode, t: Date.now() - (n - i) * 3600e3 })) })); } } catch { /* 無痕 */ }
};

test('阿幫問你：常搭捷運 → 問要不要優先推 → 好 →「你同意」chip 與加分；設定頁撤銷、關閉、清除', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    const b1 = await askAbang(page, '從西門町去台北101', 1, bodies);
    assert.deepEqual(b1.userState, { habitAsk: { mode: 'metro', count: 6 } }, '沒同意之前不送比例，只說「可以問」');
    const ask = page.locator('.turn').last().locator('.ask');
    await ask.waitFor();
    assert.equal(await ask.locator('.ask-q').textContent(), '我注意到你最近常搭捷運（6 次）。以後你沒說條件時，要我優先推捷運嗎？');
    assert.equal(await ask.getAttribute('role'), 'group');
    assert.match(await ask.locator('.ask-opt').first().textContent(), /^好 猜的$/, '最可能的選項在第一個、標「猜的」');
    const dg = page.locator('.decision').last();
    assert.equal(await dg.locator('.dg-chip.src-habit').count(), 0, '未確認的習慣不顯示、不加分');
    assert.match(await dg.getAttribute('data-best'), /^bus/);
    assert.ok(await ask.evaluate((n) => n.nextElementSibling?.classList.contains('decision')), '問題在決策圖上方');
    await shotAsk(page, ask, 'phone-habit-ask.png');
    await ask.getByRole('button', { name: /^好/ }).click();
    assert.match(await ask.locator('.ask-done').textContent(), /以後你沒說條件時，優先推捷運/);
    assert.equal(await dg.locator('.dg-chip.src-habit').textContent(), '你同意：優先推捷運 ✕');
    assert.match(await dg.getAttribute('data-best'), /^metro/, '同意後即時重算：捷運');
    assert.match(await dg.locator('.dg-why').textContent(), /你想優先搭捷運/);
    assert.equal(bodies.length, 1, '按了不呼叫伺服器');
    // 下一次：送同意的比例、不再問
    const b2 = await askAbang(page, '從西門町去台北101', 2, bodies);
    assert.ok(b2.userState.habit.metro > 0.9 && !b2.userState.habitAsk);
    const dg2 = page.locator('.decision').last();
    await dg2.locator('.dg-svg').waitFor();
    assert.equal(await dg2.locator('.dg-chip.src-habit').count(), 1);
    assert.match(await dg2.getAttribute('data-best'), /^metro/);
    // 點掉「你同意」：不看偏好重算
    await dg2.locator('.dg-chip.src-habit').click();
    assert.match(await dg2.getAttribute('data-best'), /^bus/);
    assert.match(await dg2.locator('.dg-why').textContent(), /^不看你的偏好的話，/);
    // 設定頁：同意的列出來、可撤銷；開關與清除
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('#habit-status:not(:empty)');
    assert.match(await page.textContent('#habit-status'), /記了 6 次（捷運 6）/);
    assert.match(await page.textContent('#habit-agreed'), /已同意：優先推捷運/);
    await page.locator('#habits-card').scrollIntoViewIfNeeded();
    await page.locator('#habits-card').screenshot({ path: new URL('phone-habit-settings.png', SHOTS).pathname });
    await page.getByRole('button', { name: '撤銷「已同意：優先推捷運」' }).click();
    assert.equal(await page.locator('#habit-agreed').isHidden(), true);
    await page.locator('#habit').uncheck();
    assert.match(await page.textContent('#habit-status'), /已關閉/);
    await page.goto(`${base}/#/agent`);
    const b3 = await askAbang(page, '從西門町去台北101', 3, bodies);
    assert.equal(b3.userState, undefined, '關閉：不送、不問');
    await page.goto(`${base}/#/settings`);
    await page.locator('#habit').check();
    page.once('dialog', (d) => d.accept());
    await page.click('#habit-clear');
    assert.match(await page.textContent('#habit-status'), /還沒有紀錄/);
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.habits')), null);
  }, { init: seedPicks, initArg: { mode: 'metro', n: 6 } });
});

test('阿幫動手做（ADR-0021）：行程卡片「加到行事曆」下載 .ics；還沒有行程時說「傳給我媽」請先排；有行程後問 →「分享行程」複製文字', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    const b0 = await askAbang(page, '傳給我媽', 1, bodies);
    assert.deepEqual(b0.deviceActions, { can: ['addCalendar', 'share'], trip: false });
    assert.match(await page.locator('.bubble.final').last().textContent(), /先告訴我要去哪裡/);
    await askAbang(page, '從西門町去台北101', 2, bodies);
    const dev = page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-device-btn') });
    await dev.waitFor();
    assert.equal(await dev.locator('.ab-device-btn').count(), 2, '加到行事曆、分享');
    assert.equal(await dev.locator('.ab-device-btn').first().evaluate((b) => b.parentElement.querySelector('.ab-btn') !== b), true, '跟導航在同一列（設計審查）');
    const [dl] = await Promise.all([page.waitForEvent('download'), dev.getByRole('button', { name: '加到行事曆' }).click()]);
    assert.equal(dl.suggestedFilename(), 'abang-trip.ics');
    const ics = await readFile(await dl.path(), 'utf8');
    assert.match(ics, /SUMMARY:去台北101（/);
    assert.match(ics, /LOCATION:西門町/);
    await dev.locator('.ab-device-status').waitFor();
    assert.match(await dev.locator('.ab-device-status').textContent(), /已下載行事曆檔/);
    await dev.scrollIntoViewIfNeeded();
    await dev.screenshot({ path: new URL('phone-device-actions.png', SHOTS).pathname });
    const b2 = await askAbang(page, '傳給我媽', 3, bodies);
    assert.equal(b2.deviceActions.trip, true);
    const ask = page.locator('.turn').last().locator('.ask');
    await ask.waitFor();
    assert.equal(await ask.locator('.ask-q').textContent(), '要把剛剛的行程分享出去嗎？');
    await ask.getByRole('button', { name: '分享行程' }).click();
    await page.waitForFunction(() => window.__copied);
    assert.match(await page.evaluate(() => window.__copied), /^從西門町到台北101：坐.+（阿幫）\nhttps:\/\/www\.google\.com\/maps\/dir\//s);
    await page.waitForFunction(() => /已複製/.test(document.querySelector('.agent-say:last-of-type')?.textContent || ''));
    assert.equal(bodies.length, 3, '按了不呼叫伺服器');
  }, { init: () => { window.open = () => null; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true }); } });
});

test('去政府辦事（M16-04a）：「換身分證要帶什麼」→ @辦事 → 辦事須知卡片（要帶什麼、官方說明、資料日期）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '換身分證要帶什麼', 1, bodies);
    const card = page.locator('.turn').last().locator('.ab-gov').first();
    await card.waitFor();
    assert.match(await card.locator('.ab-name').textContent(), /國民身分證初發、補發、換發/);
    assert.ok(await card.locator('.ab-gov-docs li').count() >= 3, '要帶什麼條列');
    assert.equal(await card.getByRole('button', { name: '官方說明' }).count(), 1);
    assert.match(await card.locator('.ab-gov-note').textContent(), /資料 \d{4}-\d{2}-\d{2} 更新，以機關公告為準/);
    assert.equal(await card.locator('.ab-gov-head').getAttribute('aria-expanded'), 'true', '第一項展開');
    assert.match(await page.locator('.bubble.final').last().textContent(), /當日完成/);
    await card.scrollIntoViewIfNeeded();
    await page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-gov') }).screenshot({ path: new URL('phone-gov-service.png', SHOTS).pathname });
  }, { init: () => { window.open = () => null; } });
});

test('找戶政事務所（M16-04b）：「最近的戶政事務所在哪」→ 用位置找 → 今天是不是上班日、距離、電話、導航', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '最近的戶政事務所在哪', 1, bodies);
    const slot = page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-gov-day') });
    await slot.waitFor();
    assert.match(await slot.locator('.ab-gov-day').textContent(), /^今天 \d+\/\d+（.）(?:是上班日|放假)/);
    assert.ok(await slot.locator('.ab-gov-office').count() >= 1);
    assert.match(await slot.locator('.ab-gov-office .ab-name').first().textContent(), /戶政事務所/);
    assert.equal(await slot.getByRole('button', { name: '導航' }).count() >= 1, true);
    assert.match(await slot.locator('a[href^="tel:"]').first().getAttribute('href'), /^tel:\d{6,}$/);
    assert.match(await page.locator('.bubble.final').last().textContent(), /最近的是.+戶政事務所/);
    await slot.scrollIntoViewIfNeeded();
    await slot.screenshot({ path: new URL('phone-gov-office.png', SHOTS).pathname });
  }, { init: () => { window.open = () => null; } });
});

test('找有看診的診所：「附近有開的小兒科嗎」→ 用位置推估在哪一區 → 小兒科診所、登記時段、電話、地圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '附近有開的小兒科嗎', 1, bodies);
    const slot = page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-clinic') });
    await slot.waitFor();
    assert.ok(await slot.locator('.ab-clinic').count() >= 1);
    assert.match(await slot.locator('.ab-body > .ab-sub').first().textContent(), /臨時休診不會反映，出門前先打電話/);
    assert.match(await slot.locator('.ab-foot').textContent(), /119/);
    assert.match(await slot.locator('.ab-clinic .ab-btn').first().getAttribute('aria-label'), /診所 地圖$/);
    assert.match(await slot.locator('a[href^="tel:"]').first().getAttribute('href'), /^tel:\d{6,}$/);
    assert.equal(await slot.getByRole('button', { name: '地圖' }).count() >= 1, true);
    assert.match(await page.locator('.bubble.final').last().textContent(), /小兒科診所/);
    await slot.scrollIntoViewIfNeeded();
    await slot.screenshot({ path: new URL('phone-clinic.png', SHOTS).pathname });
  }, { init: () => { window.open = () => null; } });
});

test('護照現場等待人數（M16-04c）：「現在去辦護照人多嗎」→ 各據點人數、網路預約按鈕', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '現在去辦護照人多嗎', 1, bodies);
    const slot = page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-pw-office') });
    await slot.waitFor();
    assert.ok(await slot.locator('.ab-pw-office').count() >= 3);
    assert.match(await slot.locator('.ab-pw-office .ab-name').first().textContent(), /領務局（臺北）/);
    assert.equal(await slot.getByRole('button', { name: '網路預約' }).count(), 1);
    assert.match(await page.locator('.bubble.final').last().textContent(), /人在等/);
    await slot.scrollIntoViewIfNeeded();
    await slot.screenshot({ path: new URL('phone-passport-wait.png', SHOTS).pathname });
  }, { init: () => { window.open = () => null; } });
});

test('官方入口（M16-04d）：「我想查有沒有罰單」→ 監理服務網入口；按了先確認才開（L2）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '我想查有沒有罰單', 1, bodies);
    const slot = page.locator('.turn').last().locator('.card-slot', { has: page.locator('.ab-gov-office') });
    await slot.waitFor();
    assert.match(await slot.locator('.ab-name').first().textContent(), /交通罰單查詢與繳納/);
    assert.match(await slot.locator('.ab-gov-note').textContent(), /不要點簡訊/);
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    await slot.getByRole('button', { name: '開監理服務網' }).click();
    assert.match(asked, /要開啟「監理服務網」官方網站嗎/);
    assert.equal(await page.evaluate(() => window.__opened || null), null, '按取消就不開');
    await slot.scrollIntoViewIfNeeded();
    await slot.screenshot({ path: new URL('phone-gov-links.png', SHOTS).pathname });
  }, { init: () => { window.open = (u) => { window.__opened = u; return null; }; } });
});

test('阿幫問你：常叫車 → 問原因 → 常帶東西（不自動套用）→ 下次「這次也帶東西嗎？」→ 是 →「你說過：常帶東西」重算', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '從西門町去台北101', 1, bodies);
    const ask = page.locator('.turn').last().locator('.ask');
    await ask.waitFor();
    assert.equal(await ask.locator('.ask-q').textContent(), '你常叫車（5 次），通常是因為？');
    assert.deepEqual(await ask.locator('.ask-opt').allTextContents(), ['趕時間', '常帶東西', '不想走路', '就是喜歡叫車', '不一定']);
    await ask.getByRole('button', { name: '常帶東西' }).click();
    assert.match(await ask.locator('.ask-done').textContent(), /會影響建議時，我會先問你/);
    const dg = page.locator('.decision').last();
    assert.equal(await dg.locator('.dg-chip.src-usual').count(), 0, '不自動套用');
    assert.match(await dg.getAttribute('data-best'), /^bus/);
    const b2 = await askAbang(page, '從西門町去台北101', 2, bodies);
    assert.deepEqual(b2.userState.usual, ['luggage']);
    const dg2 = page.locator('.decision').last();
    await dg2.locator('.dg-svg').waitFor();
    assert.equal(await dg2.locator('.dg-chip.src-usual').count(), 0, '沒點「是」之前不出現「你說過」');
    assert.match(await dg2.getAttribute('data-best'), /^bus/);
    const ask2 = page.locator('.turn').last().locator('.ask');
    await ask2.waitFor();
    assert.equal(await ask2.locator('.ask-q').textContent(), '這次也帶東西嗎？');
    assert.match(await ask2.locator('.ask-opt').first().textContent(), /^是 猜的$/);
    assert.match(await ask2.locator('.ask-why').textContent(), /你說過常帶東西；是的話改推叫車/);
    await shotAsk(page, ask2, 'phone-usual-ask.png');
    await ask2.getByRole('button', { name: /^是/ }).click();
    assert.equal(await dg2.locator('.dg-chip.src-usual').textContent(), '你說過：常帶東西 ✕');
    assert.equal(await dg2.getAttribute('data-best'), 'ridehail');
    assert.equal(bodies.length, 2, '按了不呼叫伺服器');
  }, { init: seedPicks, initArg: { mode: 'ridehail', n: 5 } });
});

test('阿幫問你：關鍵因子「叫車快 5 分但多 270 元，你趕時間嗎？」→ 趕 → 即時重算成叫車；同一段 24 小時內不再問；直接打「沒有」也是回答', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '從西門町去台北101', 1, bodies);
    const ask = page.locator('.turn').last().locator('.ask');
    await ask.waitFor();
    assert.equal(await ask.locator('.ask-q').textContent(), '叫車（Uber）快 5 分但多 270 元，你趕時間嗎？');
    assert.equal(await ask.locator('.ask-q').getAttribute('aria-live'), 'polite', '讀屏念問句');
    await shotAsk(page, ask, 'phone-key-question.png');
    const dg = page.locator('.decision').last();
    assert.match(await dg.getAttribute('data-best'), /^bus/);
    await ask.getByRole('button', { name: '趕', exact: true }).click();
    assert.equal(await dg.getAttribute('data-best'), 'ridehail');
    assert.equal(await dg.locator('.dg-chip.on', { hasText: '你選的：趕時間' }).count(), 1);
    assert.equal(await ask.locator('.ask-done').evaluate((n) => n === document.activeElement), true, '焦點留在結果句');
    assert.equal(bodies.length, 1);
    // 同一段起訖、同一題：24 小時內不再問（手機只存雜湊）
    await askAbang(page, '西門町到台北101怎麼去', 2, bodies);
    await page.locator('.decision').last().locator('.dg-svg').waitFor();
    assert.equal(await page.locator('.turn').last().locator('.ask').count(), 0);
    assert.doesNotMatch(await page.evaluate(() => localStorage.getItem('abang.habits')), /25\.0|121\./, '不存地點');
    // 換一段：直接打字回答
    await askAbang(page, '從台北車站去台北101', 3, bodies);
    const ask3 = page.locator('.turn').last().locator('.ask');
    await ask3.waitFor();
    assert.match(await ask3.locator('.ask-q').textContent(), /^有帶行李或大包小包嗎？/);
    await page.fill('.chat-input', '沒有');
    await page.press('.chat-input', 'Enter');
    await ask3.locator('.ask-done').waitFor();
    assert.match(await ask3.locator('.ask-done').textContent(), /照原本的建議/);
    assert.equal(bodies.length, 3, '是答案：不送伺服器');
    // 問了之後直接問別的＝略過（問題收起來、照常送出）
    await askAbang(page, '從台北車站去高雄車站', 4, bodies);
    const ask4 = page.locator('.turn').last().locator('.ask');
    await ask4.waitFor();
    await askAbang(page, '台北101附近有 YouBike 嗎', 5, bodies);
    assert.equal(await ask4.isHidden(), true);
  });
});

test('阿幫問你（PM Q 情境）：只說「高鐵」→ 問要查什麼（不列功能清單）→ 票價 → 問到哪一站 → 直接打「台中」＝按那一個 → 用離你最近的站算', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askAbang(page, '高鐵', 1, bodies);
    const ask = page.locator('.turn').last().locator('.ask');
    await ask.waitFor();
    assert.equal(await ask.locator('.ask-q').textContent(), '要查高鐵的什麼？');
    assert.doesNotMatch(await page.locator('.bubble.final').last().textContent(), /我可以幫你查交通/);
    await ask.getByRole('button', { name: '票價', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    assert.equal(bodies.at(-1).messages.at(-1).content, '高鐵票價', '按了選項：送出完整的一句');
    const ask2 = page.locator('.turn').last().locator('.ask');
    await ask2.waitFor();
    assert.equal(await ask2.locator('.ask-q').textContent(), '你要去哪一站？');
    await page.waitForFunction(() => !document.querySelector('.chat-send')?.disabled);
    await page.fill('.chat-input', '台中');
    await page.press('.chat-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 3, null, { timeout: 20000 });
    assert.equal(bodies.filter((b) => !b.clientToolResults).at(-1).messages.at(-1).content, '高鐵到台中多少錢', '打的字對到選項：送出選項的完整一句');
    assert.match(await page.locator('.bubble.final').last().textContent(), /離你最近的高鐵站「台北」/, '有定位：用最近的站，不猜、不問');
  });
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
    // 分頁本身（服務、我的、問阿幫）：回首頁，不走分頁之間的歷史
    for (const tab of ['services', 'me', 'reminders']) {
      await page.click(`.tabbar [data-tab="${tab}"]`);
      await page.waitForFunction((t) => location.hash === `#/${t}`, tab);
    }
    await page.evaluate(() => window.__back({ canGoBack: true }));
    await page.waitForFunction(() => location.hash === '#/');
    assert.deepEqual(await page.evaluate(() => window.__capCalls), [], '還沒離開');
    // 底部對話開著：先收面板
    await page.goto(`${base}/#/services`);
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open]');
    await page.evaluate(() => window.__back({ canGoBack: true }));
    await page.waitForFunction(() => !document.getElementById('abang-sheet').open);
    assert.equal(await page.evaluate(() => location.hash), '#/services');
    await page.evaluate(() => window.__back({ canGoBack: true }));
    await page.waitForFunction(() => location.hash === '#/');
    // 首頁：有上一頁也離開 App
    await page.evaluate(() => window.__back({ canGoBack: true }));
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
        assert.equal(await page.locator('.device-line').count(), 0, '外掛失敗：回答上方不說');
      } else {
        assert.deepEqual(bodies[0].deviceJudge, { intent: 'aqi', states: [], engine: 'apple' });
        assert.deepEqual(await page.locator('.device-line').allTextContents(), ['阿幫先在手機上用 Apple Intelligence 聽懂你要做什麼。'], '一輪只說一次（在回答上方）');
        assert.doesNotMatch(await page.textContent('.agent-mode'), /Apple Intelligence/, '頁底不重複');
        // 英文提問：那一行跟著用英文
        await page.fill('.chat-form input', 'How is the air today');
        await page.press('.chat-form input', 'Enter');
        await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
        const lines = await page.locator('.device-line').allTextContents();
        assert.equal(lines.length, 2);
        assert.match(lines[1], /^(Abang first worked out what you want on your phone with Apple Intelligence\.|Apple Intelligence on your phone listened first; this time the server's own judgment was used\.)$/, '英文提問：英文、沒有中文');
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
    await page.locator('.round').nth(1).locator('.round-sum').click(); // 長對話：舊的輪收成一行，先展開（UX.md §4.17）
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
    assert.match(await page.textContent('.bus-focus.riding .sub'), /坐車中・從「敦化市場」上車|車快到「敦化市場」了，上車後開始算/); // 示範資料車剛好要進站時：還沒上車
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

// S12g 公車頁英文：觀光客從英文對話「Open bus page」來（lang=en）：阿幫自己寫的字全英文，站名、路線名照原文；提醒也用英文
test('公車頁英文：標題、到站、提醒、下車提醒都是英文', async () => {
  await withPage(DEVICES.phone, '#/bus/Taipei/307?stop=%E6%95%A6%E5%8C%96%E5%B8%82%E5%A0%B4&dir=0&lang=en', async (page) => {
    await page.waitForSelector('.bus-focus .alight select');
    await page.waitForFunction(() => /^Updated /.test(document.querySelector('#upd')?.textContent || ''));
    assert.equal(await page.textContent('#title'), 'Bus 307');
    await page.waitForSelector('#banner .demo-banner');
    assert.equal(await page.textContent('#banner'), 'Demo mode: all data here is sample data, not live.', '頂端示範說明也用英文');
    // 外殼也跟著英文（分頁列、返回、浮動阿幫、底部對話面板；<html lang> 讓讀屏念對）
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    assert.deepEqual(await page.locator('.tabbar [data-shell^="tab."]').allTextContents(), ['Home', 'Services', 'Ask Abang', 'Reminders', 'Me']);
    assert.equal(await page.getAttribute('.tabbar nav', 'aria-label'), 'Main tabs');
    assert.equal(await page.getAttribute('#back', 'aria-label'), 'Back');
    assert.equal(await page.getAttribute('#abang-fab', 'aria-label'), 'Ask Abang');
    assert.equal(await page.textContent('#abang-sheet-title'), 'Ask Abang');
    assert.equal(await page.getAttribute('#abang-sheet .sheet-close', 'aria-label'), 'Minimize chat (it stays here)');
    assert.equal(await page.textContent('#focus-at'), 'At 敦化市場', '站名照原文');
    assert.match(await page.textContent('.bus-focus .big'), /^(\d+ min|Arriving|Arriving soon|Not departed yet|Last bus has left|No service today|Not stopping \(traffic control\))$/);
    assert.match(await page.textContent('#upd'), /^Updated .+ · refreshes every 20 sec$/);
    assert.equal(await page.textContent('#pick-hint'), 'Tap another stop to change where you get on.');
    assert.equal(await page.textContent('.timeline .me-tag'), 'You get on here');
    for (const b of await page.locator('#dirs button').allTextContents()) assert.doesNotMatch(b, /^往/, '方向：To X');
    for (const e of await page.locator('.timeline .eta').allTextContents()) assert.match(e, /^(\d+ min|Arriving|Arriving soon|Not departed yet|Last bus has left|No service today|Not stopping \(traffic control\))$/, e);
    assert.match(await page.getAttribute('.ab-scene3d', 'aria-label'), /You're waiting at 敦化市場/);
    assert.match(await page.getAttribute('.timeline .stop-pick >> nth=0', 'aria-label'), /, set as your stop$/);
    // 阿幫自己寫的中文 UI 字都不在（站名例外：檢查前先拿掉站名）
    const ui = await page.evaluate(() => {
      const main = document.querySelector('#main');
      const names = new Set([...main.querySelectorAll('.stop-pick, #alight-dest option')].map((x) => x.textContent));
      let text = main.innerText + [...main.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).join(' ');
      for (const n of [...names].sort((a, b) => b.length - a.length)) text = text.split(n).join('');
      return text;
    });
    for (const zh of ['到站前', '提醒我', '更新於', '點站名', '點其他', '上車站', '你在這', '即將', '進站', '坐車中', '尚未發車', '設為', '公車在這', '要在哪一站下車', '等車', '還有']) assert.ok(!ui.includes(zh), `不該有「${zh}」`);
    await shot(page, 'phone-bus-en');
    // 到站提醒（有車要來時）：英文
    const alert = page.locator('.bus-focus [data-min="3"]');
    if (await alert.count()) {
      assert.equal(await alert.textContent(), 'Remind me 3 min before');
      await alert.click();
      await page.waitForSelector('#unwatch');
      // 示範資料隨時間變：這班快到了會改提醒下一班（兩種都是英文）
      assert.match(await page.textContent('.bus-focus .ok'), /^(?:Set: I'll remind you 3 min before it arrives|This bus is almost here and you may miss it\. I'll remind you 3 min before the next one) \(while this page is open\)/);
      assert.equal(await page.textContent('#unwatch'), 'Cancel reminder');
      await page.click('#unwatch');
      await page.waitForSelector('.bus-focus [data-min="3"]');
    }
    // 下車提醒：英文；網址的 lang 保留
    const far = (await page.locator('#alight-dest option').allTextContents()).at(-1);
    await page.selectOption('#alight-dest', far);
    assert.equal(await page.textContent('.bus-focus .alight .btn'), 'Remind me before my stop');
    await page.click('.bus-focus .alight .btn');
    await page.waitForFunction((d) => document.querySelector('.bus-focus .alight .ok')?.textContent === `Get-off reminder: I'll alert you about 2 min before ${d}`, far);
    assert.match(await page.textContent('.bus-focus.riding .sub'), /^(On the bus · got on at 敦化市場|Bus is almost at 敦化市場\. Timing starts once you get on\.)$/);
    assert.match(await page.textContent('.bus-focus.riding .big'), new RegExp(`^(\\d+ min to|Almost at) ${far}$`));
    assert.equal(await page.textContent('.timeline .me-tag.off'), 'You get off here');
    await shot(page, 'phone-bus-en-riding');
    await page.click('.bus-focus .alight .btn.ghost');
    await page.waitForSelector('#alight-dest');
    await page.locator('#dirs button:not(.on)').click();
    assert.match(await page.evaluate(() => location.hash), /dir=1&lang=en$/, '換方向後網址仍帶 lang=en');
    assert.equal(await page.getAttribute('html', 'lang'), 'en', '換方向後外殼仍英文');
    // 回到首頁（沒帶 lang）：外殼恢復中文
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForFunction(() => document.documentElement.lang === 'zh-Hant-TW');
    assert.deepEqual(await page.locator('.tabbar [data-shell^="tab."]').allTextContents(), ['首頁', '服務', '問阿幫', '提醒', '我的']);
    assert.equal(await page.getAttribute('#abang-fab', 'aria-label'), '問阿幫');
    assert.equal(await page.textContent('#abang-sheet-title'), '問阿幫');
    assert.equal(await page.textContent('#skip'), '跳到主要內容');
  });
});

// 阿幫常駐（2026-11-21 Austin：跳去看公車動態，對話不能不見）：換頁回來對話原樣；浮動阿幫拉出同一段對話；提醒由阿幫說
test('阿幫常駐：開公車頁再回來對話還在、浮動阿幫拉出同一段對話、提醒泡泡', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    // 中央「問阿幫」鍵取代浮動阿幫：在問阿幫頁是目前這一頁，點了回到輸入框（不開面板）
    assert.equal(await page.locator('.abang-fab').count(), 0, '沒有另一個浮動按鈕');
    assert.equal(await page.getAttribute('#abang-fab', 'aria-current'), 'page');
    assert.equal(await page.getAttribute('#abang-fab', 'aria-haspopup'), 'false');
    await page.click('#abang-fab');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('chat-input')), true, '回到輸入框');
    assert.equal(await page.evaluate(() => document.getElementById('abang-sheet').open), false);
    await page.fill('.chat-form input', '307 到哪了？我在臺北車站');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const answer = await page.locator('.bubble.final .say').textContent();
    await page.locator('.results [data-card="bus-route"]').getByRole('button', { name: '開公車頁看動態' }).click();
    await page.waitForSelector('.bus-focus');
    // 其他頁面：中央鍵（有對話的小點），點了拉出同一段對話，背後還是公車頁
    await page.waitForSelector('#abang-fab.has-chat');
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .bubble.final');
    assert.equal(await page.locator('#abang-sheet .bubble.final .say').textContent(), answer, '同一段對話');
    // 浮動阿幫知道你在看哪一頁：公車頁打開 →「在這頁可以問」這條路線到哪了（帶上車站）
    assert.match(await page.textContent('#abang-sheet .page-ask'), /在這頁可以問\s*307 到哪了？我在/);
    assert.equal(await page.locator('#main .bus-focus').count(), 1, '背後的公車頁還在');
    await shot(page, 'phone-abang-sheet');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('abang-sheet').open);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'abang-fab', '收起後焦點回到中央鍵');
    // 提醒：中央鍵上方冒泡泡、鍵上亮「有話跟你說」，也記在對話裡；點「改其他方式」打開對話並問阿幫
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('abang:arrival-stuck', { detail: { routeName: '307', stop: 'x', reason: 'late', ask: '不要坐公車了，改別的方式' } })));
    await page.waitForSelector('#abang-bubble:not([hidden])');
    assert.match(await page.textContent('#abang-bubble'), /307 一直沒來，要我幫你改其他方式嗎？/);
    assert.equal(await page.getAttribute('#abang-fab', 'aria-label'), '問阿幫（阿幫有話跟你說）');
    assert.match(await page.getAttribute('#abang-fab', 'class'), /unread/);
    await shot(page, 'phone-abang-bubble');
    await page.click('#abang-bubble button:has-text("改其他方式")');
    await page.waitForSelector('#abang-sheet[open]');
    await page.waitForFunction(() => [...document.querySelectorAll('#abang-sheet .msg.user')].some((m) => m.textContent.includes('改別的方式')));
    await page.waitForFunction(() => document.querySelectorAll('#abang-sheet .bubble.final').length === 2, null, { timeout: 20000 });
    // Android 返回鍵（app.js 直接 dialog.close()）：一樣收尾，對話不留在關掉的面板裡
    await page.evaluate(() => document.getElementById('abang-sheet').close());
    await page.waitForFunction(() => !document.querySelector('#abang-sheet .kept-page') && document.activeElement?.id === 'abang-fab');
    assert.equal(await page.getAttribute('#abang-fab', 'aria-label'), '問阿幫（對話還在）', '打開過對話：未讀清掉');
    // 回到問阿幫頁：兩輪對話與提醒都在
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('#main .bubble.final');
    assert.equal(await page.locator('#main .msg.user').count(), 2);
    assert.equal(await page.locator('#main .agent-say').count(), 1, '阿幫說過的提醒記在對話裡');
  });
});

// 對話在 App 重開後還在（只有文字、12 小時內）：重新整理後收合顯示「上次的對話」，接著問帶著前面的話；設定頁清除會清掉
test('問阿幫：重新整理後還有上次的對話，接著問接得上；清除本機資料會清掉', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '從西門町叫車去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    await page.reload();
    await page.waitForSelector('.chat-past summary');
    assert.match(await page.textContent('.chat-past summary'), /上次的對話（今天 \d{2}:\d{2}，2 則）/);
    await page.click('.past-acts button:has-text("接著上次問")'); // 按了才把上次的話當前文送（隱私）
    const bodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
    await page.fill('.chat-form input', '不要叫車');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(bodies[0].messages[0].content, '從西門町叫車去台北101', '接著問帶著上次的話');
    assert.match(await page.locator('.turn').last().textContent(), /沿用：西門町 → 台北101/);
    // 沒按「接著上次問」：上次的話只顯示、不送
    await page.reload();
    await page.waitForSelector('.chat-past summary');
    bodies.length = 0;
    await page.fill('.chat-form input', '會下雨嗎？');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.turn .bubble.final', { timeout: 20000 });
    assert.equal(bodies[0].messages.length, 1, '沒按接著問：只送這一句');
    assert.match(await page.textContent('.past-acts'), /這次重新問/);
    // 設定頁清除本機資料：對話也清掉
    await page.goto(`${base}/#/settings`);
    page.once('dialog', (d) => d.accept());
    await page.click('#clear');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.chat')), null);
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('.chat-form');
    assert.equal(await page.locator('.chat .turn, .chat-past').count(), 0, '畫面上的對話也清掉');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.chat')), null, '清除後不會被寫回');
  });
});

// 浮動阿幫知道你在看哪一頁：天氣頁打開 → 建議天氣的問題；點了送出，這一頁的說明跟著送（只送這一次）
test('浮動阿幫：在天氣頁打開，建議天氣問題並帶上這一頁', async () => {
  await withPage(DEVICES.phone, '#/s/weather', async (page) => {
    await page.waitForSelector('.ab-card[data-card="weather"]');
    const bodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .page-ask:not([hidden])');
    await page.click('#abang-sheet .page-ask button:has-text("明天會下雨嗎？")');
    await page.waitForSelector('#abang-sheet .bubble.final', { timeout: 20000 });
    assert.match(bodies[0].context, /使用者正在看「天氣」頁/);
    assert.equal(await page.locator('#abang-sheet .page-ask').isHidden(), true, '問了就收起來');
  });
});

// 各頁小巧思第二批：捷運官方路線色、YouBike 可借比例條、公車最近查過、回首頁圖示飛回格子
test('小巧思第二批：捷運路線色、YouBike 比例條、最近查過的路線', async () => {
  await withPage(DEVICES.phone, '#/s/metro', async (page) => {
    await page.waitForSelector('.ab-card[data-card="metro"] .ab-line');
    const colors = await page.$$eval('.ab-card[data-card="metro"] .ab-line', (els) => els.map((e) => getComputedStyle(e).borderLeftColor));
    assert.ok(colors.some((c) => c === 'rgb(0, 112, 189)'), `板南線藍 ${colors.join(',')}`);
    await page.goto(`${base}/#/nearby?tab=bike`);
    await page.waitForSelector('.card.list .bike-fill i');
    await page.goto(`${base}/#/bus/Taipei/307`);
    await page.waitForSelector('.timeline');
    await page.goto(`${base}/#/bus`);
    await page.waitForSelector('.chips.recent a.chip');
    assert.match(await page.textContent('.chips.recent'), /307\s*臺北/);
    await shot(page, 'phone-bus-recent');
  });
});

// 捷運到站頁：8 個系統都在選單、填了要去哪一站就給轉乘建議（2026-11-23 使用者「有辦法做到轉乘建議嗎？」）
test('捷運到站：選新北捷運、填要去哪一站 → 怎麼坐（三鶯線轉板南線）', async () => {
  await withPage(DEVICES.phone, '#/s/metro', async (page) => {
    await page.waitForSelector('.ab-card[data-card="metro"]');
    assert.equal(await page.locator('select[name=system] option').count(), 8);
    await page.selectOption('select[name=system]', 'NTMC');
    await page.fill('input[name=station]', '鶯歌車站');
    await page.fill('input[name=to]', '台北車站');
    await page.click('form .btn');
    await page.waitForSelector('.ab-card[data-card="metro-route"]');
    const text = await page.textContent('.ab-card[data-card="metro-route"]');
    assert.match(text, /鶯歌車站 → 台北車站 怎麼坐/);
    assert.match(text, /三鶯線[\s\S]*在 頂埔 轉乘（換系統）[\s\S]*板南線/);
    await shot(page, 'phone-metro-route');
    // 清掉要去哪一站：回到這一站的下一班
    await page.fill('input[name=to]', '');
    await page.click('form .btn');
    await page.waitForSelector('.ab-card[data-card="metro"]');
  });
});

// 公車會動（Austin）：兩次更新之間照到站時間往站牌開；重新整理資料時不往回跳（不減少動態時）
test('公車街景：公車往站牌開、不往回跳', async () => {
  await withPage(DEVICES.phone, '#/bus/Taipei/307?stop=%E6%95%A6%E5%8C%96%E5%B8%82%E5%A0%B4&dir=0', async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await page.waitForSelector('#scene .ab-scene-bus');
    const x = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#scene .ab-scene-bus')).transform).m41);
    const cls = await page.getAttribute('#scene .ab-scene-bus', 'class');
    if (/moving/.test(cls)) {
      await page.waitForTimeout(1500);
      const a = await x();
      await page.waitForTimeout(2500);
      const b = await x();
      assert.ok(b > a, `往站牌開（${a} → ${b}）`);
      // 資料更新（站數沒變）：從剛剛開到的地方繼續
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('abang:alight-watch')));
      await page.waitForTimeout(300);
      assert.ok(await x() >= b - 1, '不往回跳');
    } else { // 示範資料剛好到站（停著）或還很遠（停在畫面左邊、不動）
      const label = await page.textContent('#scene .ab-scene-label.bus');
      assert.ok(/at-stop/.test(cls) || /還有 ([3-9]|\d\d) 站/.test(label), `${cls}｜${label}`);
    }
  });
});

// 首頁格子點進去（Austin：每個項目點進去都要有美美的動畫與圖示）：頁首有同色立體圖示、一句說明、資料來源；圖示從格子飛進來
test('首頁格子：點進去有頁首（圖示、說明、資料來源、各自的動作）', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const want = { '#/s/weather': ['ph-weather', '要不要帶傘、穿多少', '中央氣象署'], '#/s/quake': ['ph-quake', '剛剛是不是地震了', '中央氣象署'], '#/nearby': ['ph-nearby', '身邊有哪些公車站', null], '#/rail/thsr': ['ph-thsr', '下一班高鐵幾點、多少錢', null], '#/s/stock': ['ph-stock', '查個股，看今天收多少', '證交所'] }; // null：精簡頁首（不顯示資料來源）
    for (const [href, [cls, lead, src]] of Object.entries(want)) {
      await page.goto(`${base}/#/`);
      await page.click(`a.tile[href="${href}"]`);
      await page.waitForSelector(`#pagehero .page-hero.${cls}`);
      assert.equal(await page.textContent('#pagehero .ph-lead'), lead);
      if (src) assert.match(await page.textContent('#pagehero .ph-src'), new RegExp(src));
      else assert.equal(await page.locator('#pagehero .page-hero.compact').count(), 1, '內容多的頁面：精簡頁首');
      assert.equal(await page.getAttribute('#pagehero .ph-token', 'aria-hidden'), 'true', '圖示是裝飾');
      await page.waitForTimeout(900); // 彈出來＋開始自己的動作
      assert.ok(await page.evaluate(() => document.getAnimations().some((a) => /^ph-(spin|shake|bob|dash|rise)$/.test(a.animationName) && a.playState === 'running')), `${cls} 的圖示在動`);
      await shot(page, `phone-hero-${cls.slice(3)}`);
    }
    // 天氣：位置寫在頁首資料來源後面（不另起一行）
    await page.goto(`${base}/#/s/weather`);
    await page.waitForSelector('.ab-card[data-card="weather"]');
    await page.waitForFunction(() => /中央氣象署・(目前位置附近|台北車站附近)/.test(document.querySelector('#pagehero .ph-src')?.textContent || ''));
    assert.equal(await page.locator('#where').isHidden(), true);
    // 附近切到 YouBike：頁首跟著換
    await page.goto(`${base}/#/nearby`);
    await page.waitForSelector('#pagehero .ph-nearby');
    await page.click('.seg button[data-t="bike"]');
    await page.waitForSelector('#pagehero .ph-bike');
    // 小動作做 3 次就停；點圖示再做一次
    const iter = await page.evaluate(() => getComputedStyle(document.querySelector('#pagehero .ph-ic')).animationIterationCount);
    assert.equal(iter, '3');
    // 不是格子點進來的頁面（問阿幫、設定）沒有頁首
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('#saved');
    assert.equal(await page.locator('#pagehero .page-hero').count(), 0);
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
    // 最近一輪是英文：外殼也英文（S12g）；整頁 lang 不變（上面還有中文對話），外殼元素標 lang="en"
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant-TW');
    assert.equal(await page.locator('.tabbar [data-shell="tab.home"]').getAttribute('lang'), 'en');
    assert.equal(await page.textContent('#title'), 'Ask Abang');
    assert.deepEqual(await page.locator('.tabbar [data-shell^="tab."]').allTextContents(), ['Home', 'Services', 'Ask Abang', 'Reminders', 'Me']);
    await page.fill('.chat-form input', '去西門町');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    assert.equal(await page.locator('[data-card="trip"]').last().getAttribute('lang'), null, '中文提問回到中文卡片');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant-TW', '中文提問：外殼回中文');
    assert.equal(await page.textContent('#title'), '問阿幫');
    assert.deepEqual(await page.locator('.tabbar [data-shell^="tab."]').allTextContents(), ['首頁', '服務', '問阿幫', '提醒', '我的']);
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

// 公車街景更有變化（2026-11-21，「只有即將進站似乎很少」）：中間小站牌與「還有 N 站」、白天／夜晚、等車的人、
// 到站開門上車、這班開走下一班從左邊進來、未發車畫空的路；同一個 state 沿用同一個街景（不每 20 秒重建）
test('公車街景：遠近、時段、等車的人、開走與沿用', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    const out = await page.evaluate(async () => {
      const { busScene } = await import('/ui/cards/bus-scene.js');
      document.body.innerHTML = '<div id="shots" style="width:374px;padding:8px;background:#fff"></div>';
      const host = document.getElementById('shots');
      const day = Date.parse('2026-11-21T10:00:00+08:00'), night = Date.parse('2026-11-21T21:00:00+08:00');
      const mk = (id, o) => { const el = busScene({ routeName: '307', stopName: '敦化市場', etaText: '5 分', ...o }); el.id = id; host.append(el); return el; };
      const dayFar = mk('day-far', { away: 4, etaSec: 700, etaText: '12 分', time: day });
      const dayNear = mk('day-near', { away: 0, etaSec: 40, etaText: '進站中', time: day });
      const nightFar = mk('night-far', { away: 2, etaSec: 420, etaText: '7 分', time: night });
      const nightNear = mk('night-near', { away: 0, etaSec: 30, etaText: '進站中', time: night, stopName: '市府' });
      const empty = mk('empty', { away: null, etaText: '末班已過', time: night });
      const en = mk('en', { away: 1, etaSec: 150, etaText: '3 min', time: day, lang: 'en', riding: true, stopName: '市府' });
      const marks = (el) => [...el.querySelectorAll('.ab-scene-mark')].map((m) => m.textContent);
      // 同一個 state：第二次回傳同一個元素（不重建）；就在你這站 → 換成下一班：這班開走（減少動態時直接畫最終狀態：沒有開走的車）
      const state = {};
      const a = busScene({ routeName: '307', stopName: '西門', away: 0, etaSec: 30, etaText: '進站中', state, time: day });
      const b = busScene({ routeName: '307', stopName: '西門', away: 3, etaSec: 600, etaText: '10 分', state, time: day });
      return {
        dayFar: { cls: dayFar.className, marks: marks(dayFar), people: dayFar.querySelectorAll('.ab-scene-person').length, passed: dayFar.querySelectorAll('.ab-sign.passed').length },
        dayNear: { open: dayNear.querySelector('.ab-scene-bus').classList.contains('open'), people: dayNear.querySelectorAll('.ab-scene-person').length, halo: dayNear.querySelector('.ab-scene-halo').className, passed: dayNear.querySelectorAll('.ab-sign.passed').length },
        nightFar: { cls: nightFar.className, marks: marks(nightFar), glow: nightFar.querySelectorAll('.ab-scene-lights circle').length },
        nightNear: { label: nightNear.getAttribute('aria-label') },
        empty: { bus: empty.querySelectorAll('.ab-scene-bus').length, note: empty.querySelector('.ab-scene-empty')?.textContent, label: empty.getAttribute('aria-label'), people: empty.querySelectorAll('.ab-scene-person').length },
        en: { marks: marks(en), you: en.querySelector('.ab-scene-you')?.textContent, label: en.getAttribute('aria-label') },
        reuse: a === b, buses: b.querySelectorAll('.ab-scene-bus').length, leaving: b.querySelectorAll('.ab-scene-bus.leaving').length, peopleAfter: b.querySelectorAll('.ab-scene-person').length,
        traffic: document.querySelectorAll('#shots .ab-scene-rider, #shots .ab-scene-taxi').length,
      };
    });
    assert.match(out.dayFar.cls, /\bday\b/);
    assert.deepEqual(out.dayFar.marks, ['還有 1 站', '還有 2 站'], '還很遠：中間兩個小站牌都標');
    assert.ok(out.dayFar.people >= 1 && out.dayFar.people <= 3, '有人在等車');
    assert.equal(out.dayFar.passed, 0);
    assert.equal(out.dayNear.open, true, '到站開門');
    assert.equal(out.dayNear.people, 0, '減少動態：直接畫上車後（沒有人在等）');
    assert.match(out.dayNear.halo, /\bon\b/, '你這站的站牌亮起來');
    assert.equal(out.dayNear.passed, 2, '中間的站都開過了');
    assert.match(out.nightFar.cls, /\bnight\b/);
    assert.deepEqual(out.nightFar.marks, ['還有 1 站', '還有 2 站']);
    assert.ok(out.nightFar.glow >= 2, '夜晚路燈亮');
    assert.match(out.nightNear.label, /307・就在你這站・進站中；你在「市府」等車/);
    assert.equal(out.empty.bus, 0);
    assert.equal(out.empty.note, '目前路上沒有這班車');
    assert.match(out.empty.label, /307・末班已過；你在「敦化市場」等車；目前路上沒有這班車/);
    assert.ok(out.empty.people >= 1);
    assert.deepEqual(out.en.marks, ['1 stop']);
    assert.equal(out.en.you, 'You', '坐車中：車上標你');
    assert.match(out.en.label, /^307 · 1 stop away · 3 min\. You're on the bus, getting off at 市府$/);
    assert.equal(out.reuse, true, '同一個 state 沿用同一個街景');
    assert.equal(out.buses, 1);
    assert.equal(out.leaving, 0, '減少動態：不畫開走的過程');
    assert.ok(out.peopleAfter >= 1, '這班開走：換一批人等下一班');
    assert.equal(out.traffic, 0, '減少動態：不畫經過的車');
    for (const id of ['day-far', 'day-near', 'night-far', 'night-near', 'empty', 'en']) await page.locator(`#${id}`).screenshot({ path: new URL(`bus-scene-${id}.png`, SHOTS).pathname });
  });
});

test('公車街景：這班開走往右開出畫面、下一班從左邊進來、等車的人上車（不減少動態）', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const out = await page.evaluate(async () => {
      const { busScene } = await import('/ui/cards/bus-scene.js');
      document.body.innerHTML = '';
      const state = {};
      const day = Date.parse('2026-11-21T10:00:00+08:00');
      const el = busScene({ routeName: '307', stopName: '西門', away: 0, etaSec: 30, etaText: '進站中', state, time: day });
      document.body.append(el);
      const waiting = el.querySelectorAll('.ab-scene-person').length;
      const traffic = el.querySelectorAll('.ab-scene-rider, .ab-scene-taxi').length;
      const parkedCls = el.querySelector('.ab-scene-bus').className;
      await new Promise((r) => setTimeout(r, 300));
      const boarding = el.querySelectorAll('.ab-scene-person.boarding').length;
      busScene({ routeName: '307', stopName: '西門', away: 3, etaSec: 600, etaText: '10 分', state, time: day });
      const leaving = el.querySelector('.ab-scene-bus.leaving');
      const x = (b) => new DOMMatrix(getComputedStyle(b).transform).m41;
      const x0 = x(leaving);
      await new Promise((r) => setTimeout(r, 900));
      const x1 = x(leaving);
      await new Promise((r) => setTimeout(r, 2000));
      const after = { leaving: el.querySelectorAll('.ab-scene-bus.leaving').length, buses: el.querySelectorAll('.ab-scene-bus').length, people: el.querySelectorAll('.ab-scene-person').length, newX: x(el.querySelector('.ab-scene-bus')) };
      return { waiting, traffic, boarding, parkedCls, x0, x1, ...after };
    });
    assert.ok(/at-stop/.test(out.parkedCls) && !/moving/.test(out.parkedCls), `開進來停在站牌：不算開車中（${out.parkedCls}）`);
    assert.ok(out.waiting >= 1, '有人在等');
    assert.equal(out.traffic, 2, '偶爾經過的機車與計程車');
    assert.equal(out.boarding, out.waiting, '公車到站：等車的人上車');
    assert.ok(out.x1 > out.x0, `這班往右開走（${out.x0} → ${out.x1}）`);
    assert.equal(out.leaving, 0, '開出畫面後拿掉');
    assert.equal(out.buses, 1, '下一班');
    assert.ok(out.newX < 0, `下一班停在左邊（${out.newX}）`);
    assert.ok(out.people >= 1, '換一批人等下一班');
  });
});

// 公車頁夜晚（台灣時間 21 點）：街景換夜晚、文字標籤不變
test('公車頁街景：夜晚', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(new Date('2026-11-21T21:00:00+08:00'));
    await page.goto(`${base}/#/bus/Taipei/307?stop=%E6%95%A6%E5%8C%96%E5%B8%82%E5%A0%B4&dir=0`);
    await page.waitForSelector('#scene .ab-scene3d.night');
    assert.equal(await page.locator('#scene .ab-scene-label.stop').textContent(), '敦化市場');
    await page.locator('#scene .ab-scene3d').screenshot({ path: new URL('bus-scene-page-night.png', SHOTS).pathname });
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

// 設定與隱私（M11-04、E8）：「我的」進入、權限狀態、網頁版裝置端 AI 開關停用、隱私權政策頁、清除本機資料要確認
test('設定與隱私：我的進入、狀態、隱私權政策', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.click('.tabbar [data-tab="me"]');
    await page.click('#main a[href="#/settings"] >> nth=0');
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

// 首頁與導覽重新設計（2026-11-21，阿幫為中心）：服務總覽、提醒頁取消、我的、舊網址仍可用、「現在」摘要降級
test('服務：四組總覽（含附近、公車）、點了進服務頁、子頁有返回且分頁列標在服務', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.click('.tabbar [data-tab="services"]');
    await page.waitForSelector('.svc-list .svc');
    assert.equal(await page.textContent('#title'), '服務');
    assert.equal(await page.getAttribute('.tabbar [data-tab="services"]', 'aria-current'), 'page');
    assert.deepEqual(await page.locator('#main section h2').allTextContents(), ['防詐', '交通', '生活', '消費與政府']);
    assert.match(await page.textContent('.svc[href="#/nearby"]'), /附近.*身邊有哪些公車站/);
    assert.match(await page.textContent('.svc[href="#/agent/antifraud"]'), /貼上來/);
    assert.equal(await page.locator('.svc').count(), 15);
    await shot(page, 'phone-services');
    await page.click('.svc[href="#/bus"]');
    await page.waitForSelector('#pagehero .ph-bus');
    assert.equal(await page.locator('#back').isVisible(), true, '公車搜尋不再是分頁：有返回');
    assert.equal(await page.getAttribute('.tabbar [data-tab="services"]', 'aria-current'), 'true');
  });
});

test('提醒：列出進行中的出門與到站提醒、分頁列數字、逐一取消、沒有時教怎麼設', async () => {
  const at = Date.now() + 45 * 60_000;
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('.tabbar');
    await page.evaluate((t) => { localStorage.setItem('abang.reminders', JSON.stringify([{ id: 'rtest', at: t, text: '該出門了：搭捷運去台北101', nid: 2001 }])); window.dispatchEvent(new CustomEvent('abang:reminders')); }, at);
    await page.waitForSelector('.tabbar .tab-badge:not([hidden])');
    assert.equal(await page.textContent('.tabbar .tab-badge'), '1');
    assert.equal(await page.textContent('.tabbar .tab-badge-sr'), '，1 個進行中');
    // 首頁「現在」的提醒那格是最近的一個
    await page.waitForFunction(() => /出門提醒/.test(document.querySelector('#now [data-now="reminder"]')?.textContent || ''));
    await page.click('.tabbar [data-tab="reminders"]');
    await page.waitForSelector('.rem-row');
    assert.equal(await page.getAttribute('.tabbar [data-tab="reminders"]', 'aria-current'), 'page');
    assert.match(await page.textContent('.rem-row[data-kind="leave"]'), /出門提醒.*搭捷運去台北101/);
    // 到站提醒（公車頁設的）也列在這裡
    const stop = await page.evaluate(async () => {
      const call = (a) => fetch('/api/v1/tools/bus_route_eta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }).then((x) => x.json());
      const s = (await call({ city: 'Taipei', routeName: '307' })).data.directions[0].stops[6].stopName;
      const { createWebHost } = await import('/ui/cards/host-web.js');
      await createWebHost().watchArrival({ city: 'Taipei', routeName: '307', stop: s, direction: 0, minutes: 3 });
      return s;
    });
    const arrival = page.locator('.rem-row[data-kind="arrival"]');
    if (await arrival.count()) { // 示範資料剛好已經在提醒範圍內時提醒會直接結束
      assert.match(await arrival.textContent(), new RegExp(`307 到站提醒.*${stop.replace(/[()]/g, '.')}`));
      assert.match(await arrival.locator('a.rem-open').getAttribute('href'), /^#\/bus\/Taipei\/307\?stop=.+&dir=0$/);
      await shot(page, 'phone-reminders');
      await arrival.getByRole('button', { name: '取消 307 的到站提醒' }).click();
      await page.waitForSelector('.rem-row[data-kind="arrival"]', { state: 'detached' });
    } else await shot(page, 'phone-reminders');
    await page.getByRole('button', { name: /^取消 \d{2}:\d{2} 的出門提醒$/ }).click();
    await page.waitForSelector('.rem-empty');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'rem-h', '取消後焦點回到標題');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('abang.reminders') || '[]').length), 0);
    assert.equal(await page.locator('.tabbar .tab-badge').isHidden(), true);
    assert.match(await page.textContent('.rem-how'), /到站前 3 分提醒我[\s\S]*選下車站[\s\S]*提醒我出門/);
    // 設定頁不再有出門提醒清單：連到提醒分頁
    await page.goto(`${base}/#/settings`);
    await page.waitForSelector('#reminders-card a[href="#/reminders"]');
  });
});

test('我的：收藏、常用地點、發票、提醒、手機上的 AI（網頁版照實說）、設定與關於；首頁 AI 那條點進阿幫的腦袋', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForFunction(() => document.querySelector('#ai-line')?.dataset.tone !== 'wait');
    await page.click('#ai-line');
    await page.waitForSelector('.ai-hero #ai-chip:not([hidden])');
    assert.match(page.url(), /#\/ai$/);
    assert.equal(await page.getAttribute('.tabbar [data-tab="me"]', 'aria-current'), 'true', '阿幫的腦袋屬於「我的」');
    assert.equal(await page.locator('#back').isVisible(), true, '有返回鈕');
    await page.goto(`${base}/#/me?sec=ai`);
    await page.waitForSelector('.me-ai a[href="#/ai"]');
    assert.match(page.url(), /#\/me\?sec=ai$/);
    assert.equal(await page.getAttribute('.tabbar [data-tab="me"]', 'aria-current'), 'page');
    await page.waitForFunction(() => document.querySelector('#me-ai-label')?.textContent !== '檢查中…');
    assert.match(await page.textContent('.me-ai'), /網頁版[\s\S]*伺服器判斷[\s\S]*Apple Intelligence[\s\S]*Gemini Nano/);
    for (const href of ['#/favs', '#/settings', '#/s/invoice', '#/reminders', '#/privacy']) assert.ok(await page.locator(`#main a[href="${href}"]`).count() >= 1, href);
    assert.match(await page.textContent('.me-about'), /165 全民防騙網/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'phone-me');
    await page.click('#main a[href="#/favs"]');
    await page.waitForSelector('#main .empty');
    assert.equal(await page.locator('#back').isVisible(), true);
    assert.equal(await page.getAttribute('.tabbar [data-tab="me"]', 'aria-current'), 'true');
  });
});

test('舊網址都還能用（#/nearby、#/bus、#/favs、#/settings、#/privacy、#/s/weather、#/rail/thsr）', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    const want = { '#/nearby': '#pagehero .ph-nearby', '#/bus': '#pagehero .ph-bus', '#/favs': '#main .empty', '#/settings': '#saved', '#/privacy': '.privacy h2', '#/s/weather': '.ab-card[data-card="weather"]', '#/rail/thsr': '#pagehero .ph-thsr' };
    for (const [h, sel] of Object.entries(want)) {
      await page.goto(`${base}/${h}`);
      await page.waitForSelector(sel);
      assert.equal(await page.locator('.tabbar [aria-current]').count(), 1, h);
    }
  });
});

test('首頁「現在」降級：沒給定位用台北車站附近、查不到只留提醒、離線說離線（都不擋畫面）', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('#now[aria-busy="false"] [data-now="weather"]');
    assert.match(await page.textContent('#now [data-now="weather"]'), /台北車站附近/, '沒給過權限不跳權限框');
  }, { geo: false });
  await withPage({ ...DEVICES.phone, serviceWorkers: 'block' }, '#/', async (page) => {
    await page.route(/\/api\/v1\/tools\/(weather_now|aqi_nearby)$/, (r) => r.abort());
    await page.reload();
    await page.waitForSelector('#now[aria-busy="false"]');
    assert.deepEqual(await page.locator('#now .now-item').evaluateAll((els) => els.map((e) => e.dataset.now)), ['reminder']);
    assert.ok(await page.locator('.grid .tile').count() > 10, '格子照常');
  }, { ignore: /Failed to load resource/ });
  const ctx = await newCtx({ ...DEVICES.phone, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    await page.goto(`${base}/#/services`);
    await page.waitForSelector('.svc');
    await ctx.setOffline(true);
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForSelector('#now [data-now="offline"]');
    assert.match(await page.textContent('#now'), /離線中[\s\S]*沒有提醒/);
  } finally {
    await ctx.close();
  }
});

test('桌面：分頁列跟內容一樣寬', async () => {
  await withPage(DEVICES.desktop, '#/', async (page) => {
    await page.waitForSelector('#now[aria-busy="false"]');
    const nav = await page.locator('.tabbar nav').boundingBox();
    assert.ok(nav.width <= 560, `分頁列寬 ${nav.width}`);
  });
});

test('到站提醒每 20 秒的事件不重畫：提醒頁與首頁「現在」的焦點不會掉；回首頁不閃骨架', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('#now[aria-busy="false"] [data-now="weather"]');
    await page.evaluate(async () => {
      const call = (a) => fetch('/api/v1/tools/bus_route_eta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }).then((x) => x.json());
      const s = (await call({ city: 'Taipei', routeName: '307' })).data.directions[0].stops[6].stopName;
      const { createWebHost } = await import('/ui/cards/host-web.js');
      await createWebHost().watchArrival({ city: 'Taipei', routeName: '307', stop: s, direction: 0, minutes: 3 });
      localStorage.setItem('abang.reminders', JSON.stringify([{ id: 'rk', at: Date.now() + 3600e3, text: '該出門了：x', nid: 2002 }]));
      window.dispatchEvent(new CustomEvent('abang:reminders'));
    });
    await page.focus('#now [data-now="weather"]');
    const fire = () => page.evaluate(() => { for (const t of ['abang:arrival-watch', 'abang:alight-watch', 'abang:reminders']) window.dispatchEvent(new CustomEvent(t)); });
    await page.evaluate(() => { window.__el = document.activeElement; });
    await fire();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.activeElement === window.__el && window.__el.isConnected), true, '首頁焦點還在同一個元素');
    // 回首頁：上次的結果還有效，直接畫（不先閃骨架）
    await page.click('.tabbar [data-tab="reminders"]');
    await page.waitForSelector('.rem-row');
    await page.locator('.rem-row button').first().focus();
    await page.evaluate(() => { window.__el = document.activeElement; });
    await fire();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.activeElement === window.__el && window.__el.isConnected), true, '提醒頁焦點還在取消鈕上');
    await page.click('.tabbar [data-tab="home"]');
    await page.waitForSelector('#now');
    assert.equal(await page.locator('#now .skel').count(), 0, '不閃骨架');
    assert.equal(await page.getAttribute('#now', 'aria-busy'), 'false');
    await page.evaluate(async () => { const { createWebHost } = await import('/ui/cards/host-web.js'); createWebHost().unwatchArrival(); });
  });
});

test('鍵盤開著時阿幫說話：改用提示，中央鍵仍亮未讀點', async () => {
  await withPage(DEVICES.phone, '#/s/weather', async (page) => {
    await page.waitForSelector('#abang-fab');
    await page.evaluate(() => { document.documentElement.classList.add('kb-open'); window.dispatchEvent(new CustomEvent('abang:arrival', { detail: { text: '307 快到了' } })); });
    await page.waitForSelector('[role="status"]:has-text("307 快到了")');
    assert.equal(await page.locator('#abang-bubble').isHidden(), true);
    await page.evaluate(() => document.documentElement.classList.remove('kb-open'));
    assert.match(await page.getAttribute('#abang-fab', 'class'), /unread/);
    assert.equal(await page.getAttribute('#abang-fab', 'aria-label'), '問阿幫（阿幫有話跟你說）');
  });
});

// 阿幫的腦袋（#/ai，ADR-0014）：網頁版沒有手機上的模型——照實說判斷在伺服器做，頁面仍完整（伺服器的判斷層、資料怎麼走）；試判斷第 1 段改用伺服器的規則
for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：阿幫的腦袋（網頁版）核心不點亮、說明判斷在伺服器做`, async () => {
    await withPage(device, '#/ai', async (page) => {
      await page.waitForSelector('.ai-hero[data-core="off"] #ai-chip:not([hidden])');
      assert.equal(await page.textContent('#title'), '阿幫的腦袋');
      assert.equal(await page.textContent('#ai-engine'), '判斷在伺服器做');
      assert.match(await page.textContent('#ai-chip'), /網頁版沒有/);
      assert.match(await page.textContent('#ai-live'), /核心沒有點亮/);
      assert.equal(await page.getAttribute('#ai-stage', 'aria-hidden'), 'true');
      assert.deepEqual(await page.locator('.ai-v[data-v="intent"], .ai-v[data-v="states"]').allTextContents(), ['由伺服器判斷', '由伺服器判斷']);
      assert.equal(await page.locator('#ai-form').count(), 1, '網頁版也能試判斷（第 1 段改用伺服器的規則）');
      assert.match(await page.textContent('.ai-net'), /第 1 段：這裡沒有手機上的 AI，改用伺服器的判斷/);
      assert.equal(await page.locator('#ai-model .ai-dl > div').count(), 1, '模型資訊只有「狀態」一列（不編造）');
      assert.doesNotMatch(await page.textContent('#ai-model .ai-dl'), /Gemini Nano|Apple Intelligence|token|毫秒/);
      await page.waitForFunction(() => /示範模式/.test(document.querySelector('#ai-answer')?.textContent || '')); // /api/v1/status 的 agent
      assert.equal(await page.locator('.ai-members li').count(), 4);
      assert.match(await page.locator('.ai-members li').nth(0).textContent(), /現在：沒有/);
      assert.match(await page.locator('.ai-members li').nth(1).textContent(), /這台伺服器：沒有/, 'E2E 的伺服器 JUDGE=off：照實顯示');
      assert.match(await page.locator('.ai-flow li').nth(1).textContent(), /伺服器.*這一步在伺服器做/);
      assert.equal(await page.locator('.ai-flow li.core').count(), 0);
      assert.equal(await page.locator('#ai-edge').count(), 0, '網頁版沒有開關');
      await shot(page, dname === 'phone' ? 'phone-ai-web' : 'desktop-ai');
    });
  });
}

// 阿幫的腦袋「行動」（2026-11-28，產品負責人：大腦示意圖加入 take action）：試判斷第 5 段列出可以幫你做的事與確認方式；主視覺「行動」節點點亮；網頁版沒有 Siri 那一句
test('阿幫的腦袋：試判斷「我快遲到了，怎麼去台北101」→ 第 5 段行動（導航按一下、行事曆與分享由系統畫面確認）、行動節點點亮', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('#ai-form');
    await page.locator('.ai-ex .chip').first().click();
    const act = page.locator('#ai-trial [data-sec="act"]');
    await act.waitFor({ timeout: 20000 });
    assert.equal(await act.locator('li[data-act="nav"][data-confirm="tap"]').count(), 1);
    assert.equal(await act.locator('li[data-act="calendar"][data-confirm="system"]').count(), 1);
    assert.match(await act.locator('li[data-act="calendar"]').textContent(), /加到行事曆系統畫面確認/);
    assert.match(await act.textContent(), /試判斷只列出來，不會真的去做/);
    assert.equal(await act.locator('.ai-siri').count(), 0, '網頁版不顯示 Siri');
    assert.match(await page.textContent('.ai-v[data-v="act"]'), /^\d+ 件・\d+ 件要你確認$/);
    assert.ok(await page.evaluate(() => document.querySelector('.ai-hero').classList.contains('act-on')));
    assert.match(await page.getAttribute('#ai-stage', 'data-act'), /準備了 \d+ 件事/);
    assert.match(await page.locator('.ai-flow li').last().textContent(), /你按了才做/);
    await act.scrollIntoViewIfNeeded();
    await act.screenshot({ path: new URL('phone-ai-act.png', SHOTS).pathname });
    await page.locator('.ai-hero').screenshot({ path: new URL('phone-ai-act-hero.png', SHOTS).pathname });
  });
});

// 阿幫的腦袋：App 裡（假的 Capacitor 外掛：Gemini Nano 可用）列出系統回報的模型資訊；「試試看」只呼叫手機上的外掛、沒有網路請求，結果用核心動畫與同一句文字呈現
test('阿幫的腦袋：手機上的模型資訊、現場試試看、開關、英文、設定頁入口', async () => {
  const init = () => {
    const calls = (window.__aiCalls = []);
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
      nativePromise: (plugin, method, args) => {
        if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
        calls.push({ method, text: args?.text });
        if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok', featureStatus: 'available', modelName: 'nano-e2e', tokenLimit: 4096, osVersion: '16', device: 'Google Pixel E2E' });
        if (method === 'judge') return Promise.resolve({ engine: 'gemini-nano', ms: 412, result: '{"intent":"trip","states":["rush"]}' });
        return Promise.resolve({});
      },
    };
  };
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('.ai-hero[data-core="on"] #ai-chip.on');
    assert.equal(await page.textContent('#ai-engine'), 'Gemini Nano');
    assert.equal(await page.textContent('#ai-chip'), '可以使用');
    assert.match(await page.textContent('#ai-live'), /核心待機中/);
    const model = await page.textContent('#ai-model .ai-dl');
    for (const w of ['Gemini Nano', 'AICore', '這支手機（Google Pixel E2E）', '可以使用', 'nano-e2e', '4,096 個 token', 'Android 16', '0 次']) assert.ok(model.includes(w), w);
    assert.doesNotMatch(model, /AICore 版本|支援語言|上次判斷/, '外掛沒回的欄位不顯示');
    assert.match(await page.locator('.ai-members li').first().textContent(), /現在：開著.*Gemini Nano 先判斷/);
    assert.match(await page.locator('.ai-flow li.core').textContent(), /手機.*Gemini Nano 在手機上判斷/);
    await shot(page, 'phone-ai');

    // 試判斷：點測試句 → 手機上判斷 → 點亮（第 1 段沒有網路）；第 2～4 段才送伺服器，而且只送這一句
    const sent = [];
    page.on('request', (r) => { if (r.method() !== 'GET' || r.url().includes('/api/')) sent.push({ url: r.url(), body: r.postData() }); });
    await page.locator('.ai-ex .chip').first().click();
    await page.waitForSelector('.ai-hero[data-stage="done"]');
    assert.equal(await page.textContent('#ai-live'), '聽懂了：意圖是「行程規劃」；狀態是「趕時間」。花了 412 毫秒，沒有離開手機。');
    assert.deepEqual(await page.locator('.ai-v[data-v="intent"], .ai-v[data-v="states"]').allTextContents(), ['行程規劃', '趕時間']);
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.match(await page.textContent('.ai-sec[data-sec="judge"] .ai-meta'), /手機・Gemini Nano.*412 毫秒.*沒用網路/);
    const agentSent = sent.filter((x) => x.url.endsWith('/api/v1/agent'));
    assert.ok(agentSent.length >= 1 && sent.every((x) => /\/api\/v1\/(agent|suggest\/check)$/.test(x.url)), JSON.stringify(sent.map((x) => x.url)));
    for (const x of agentSent) {
      const b = JSON.parse(x.body);
      assert.deepEqual(b.messages, [{ role: 'user', content: '我快遲到了，怎麼去台北101' }]);
      assert.ok(!('savedPlaces' in b) && !('userState' in b), '不送常用地點與習慣');
      assert.ok(!b.clientToolResults || JSON.stringify(b.clientToolResults).includes('lat'), '跟問阿幫一樣：伺服器請定位時由手機給（2026-11-22）');
    }
    const judged = (await page.evaluate(() => window.__aiCalls)).filter((c) => c.method === 'judge');
    assert.deepEqual(judged, [{ method: 'judge', text: '我快遲到了，怎麼去台北101' }]);
    const after = await page.textContent('#ai-model .ai-dl');
    assert.ok(after.includes('412 毫秒') && after.includes('1 次（只記在這支手機）'), after);
    assert.deepEqual(await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('abang.edgeStats')); return [o.n, o.ms]; }), [1, 412]);
    assert.match(await page.textContent('.ai-net'), /第 1 段在手機上判斷，不用網路/);
    await shot(page, 'phone-ai-judged');
    // 自己打一句也行（Enter 送出）
    await page.fill('#ai-input', '307 到哪了');
    await page.press('#ai-input', 'Enter');
    await page.waitForFunction(() => /2 次/.test(document.querySelector('#ai-model .ai-dl').textContent));
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });

    // 開關（跟設定頁同一個）：關掉 → 核心不點亮、不給試、說明改由伺服器；再打開恢復
    await page.click('#ai-edge');
    await page.waitForSelector('.ai-hero[data-core="off"]');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.edgeAI')), 'off');
    assert.equal(await page.textContent('#ai-engine'), 'Gemini Nano（已關閉）');
    assert.match(await page.textContent('.ai-net'), /改用伺服器的判斷/, '關掉後試判斷第 1 段改用伺服器');
    assert.match(await page.locator('.ai-flow li').nth(1).textContent(), /這一步在伺服器做/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ai-edge', '焦點留在開關上');
    await page.click('#ai-edge');
    await page.waitForSelector('.ai-hero[data-core="on"]');
    await page.waitForSelector('#ai-form');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.edgeAI')), null);

    // 英文（lang=en）：固定文字換英文，模型名稱照原文
    await page.goto(`${base}/#/ai?lang=en`);
    await page.waitForSelector('.ai-page[lang="en"] .ai-hero[data-core="on"] #ai-chip.on');
    assert.equal(await page.textContent('#title'), "Abang's brain");
    assert.equal(await page.textContent('.ai-eyebrow'), 'On-device AI');
    assert.equal(await page.textContent('#ai-chip'), 'Ready');
    await page.locator('.ai-ex .chip').first().click();
    await page.waitForSelector('.ai-hero[data-stage="done"]');
    assert.equal(await page.textContent('#ai-live'), 'Got it: intent is "Trip planning"; situation is "In a hurry". Took 412 ms, never left the phone.');
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    // 英文頁：阿幫自己寫的字都是英文（站名、地名是資料，照中文原名）
    const fixed = await page.evaluate(() => { const c = document.querySelector('.ai-page').cloneNode(true); c.querySelectorAll('.ai-slots span, .ai-say, .ai-tools span, .ai-raw, .ai-suggest span, .ai-best').forEach((n) => n.remove()); return c.textContent; });
    assert.doesNotMatch(fixed, /[一-鿿]/, '英文頁沒有中文');
    assert.deepEqual(await page.locator('.ai-sec h3').allTextContents(), ['Intent and situation', 'Enough to go on?', 'Expected answer', 'What Abang would ask next', 'What A-Bang can do for you']);

    // 入口：設定頁的裝置端 AI 區塊
    await page.goto(`${base}/#/settings`);
    await page.click('.settings a[href="#/ai"]');
    await page.waitForSelector('.ai-hero');
    assert.equal(await page.textContent('#title'), '阿幫的腦袋');
  }, { init, ignore: /not in test/ });
});

// 「阿幫在想」（agent/thinking.js）：送出到第一段回答之間，用同一顆核心的小版本表示在想，跟著真實事件換字；記下出現過的字與核心的動畫
const THINK_RECORDER = `window.__think = { texts: [], anims: [], playing: [] };
new MutationObserver(() => {
  const r = window.__think;
  const t = document.querySelector('.think-core');
  if (t) {
    const s = t.querySelector('.tc-text').textContent;
    if (r.texts[r.texts.length - 1] !== s) r.texts.push(s);
    const c = t.querySelector('.tc-core');
    if (c) r.anims.push(getComputedStyle(c).animationName);
  }
  const h = document.querySelector('.ai-hero');
  if (h) { const on = h.classList.contains('playing'); const L = r.playing; if (!L.length || L[L.length - 1].on !== on) L.push({ on, t: performance.now() }); }
}).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });`;
const FAKE_EDGE = (judgeMs) => `window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok' });
    if (method === 'judge') return new Promise((res) => setTimeout(() => res({ engine: 'gemini-nano', ms: ${judgeMs}, result: '{"intent":"trip","states":["rush"]}' }), ${judgeMs}));
    return Promise.resolve({});
  },
};`;

test('問阿幫：送出後「阿幫在想」核心在動、出現過「正在查」，第一段回答來了就收起', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '從西門町到台北101怎麼去');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.think-core'));
    const r = await page.evaluate(() => window.__think);
    assert.ok(r.texts.some((x) => x.startsWith('阿幫在想…')), r.texts.join(' | '));
    assert.ok(r.texts.some((x) => /伺服器判斷中/.test(x)), '網頁版：沒有手機上的 AI，改由伺服器判斷');
    assert.ok(r.texts.some((x) => /正在查：/.test(x)), r.texts.join(' | '));
    assert.ok(r.anims.includes('tc-beat'), `核心在脈動：${[...new Set(r.anims)]}`);
    assert.equal(await page.locator('.think-core').count(), 0);
    assert.equal(await page.locator('.device-line').count(), 0, '沒有手機判斷：回答上方不多說');
  }, { init: THINK_RECORDER, motion: true });
});

test('問阿幫：手機上聽懂了（真實的裝置判斷）亮出小標、回答上方說明；截圖思考中', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    let release;
    const hold = new Promise((r) => { release = r; });
    await page.route('**/api/v1/agent', async (route) => { if (route.request().method() === 'POST') await hold; await route.fallback(); }); // 測試才擋住伺服器回應，好截到思考中
    await page.fill('.chat-form input', '我快遲到了，怎麼去台北車站');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => /手機上聽懂了：行程規劃・趕時間/.test(document.querySelector('.think-core')?.textContent || ''));
    assert.match(await page.locator('.think-core [role=status]').textContent(), /手機上聽懂了：行程規劃・趕時間/);
    assert.equal(await page.locator('.think-core .tc-core').evaluate((n) => getComputedStyle(n).animationName), 'tc-beat');
    await page.locator('.think-core').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-agent-thinking.png', SHOTS).pathname });
    release();
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(await page.locator('.think-core').count(), 0);
    assert.equal(await page.textContent('.device-line'), '阿幫先在手機上用 Gemini Nano 聽懂你要做什麼。');
    const order = await page.evaluate(() => { const l = document.querySelector('.device-line'); return l.nextElementSibling?.classList.contains('final'); });
    assert.ok(order, '說明在回答正上方');
  }, { init: THINK_RECORDER + FAKE_EDGE(300), motion: true, ignore: /not in test/ });
});

test('問阿幫：reduced motion 時「阿幫在想」是靜態文字', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '從西門町到台北101怎麼去');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const r = await page.evaluate(() => window.__think);
    assert.ok(r.texts.some((x) => x.startsWith('阿幫在想…')));
    assert.ok(r.anims.length && r.anims.every((a) => a === 'none'), `不動：${[...new Set(r.anims)]}`);
    assert.equal(await page.locator('.think-core').count(), 0);
  }, { init: THINK_RECORDER });
});

test('阿幫的腦袋：試試看的動畫至少播 1.2 秒（Gemini Nano 0.1 秒就判斷完，結果文字立刻寫出）', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('.ai-hero[data-core="on"]');
    await page.waitForSelector('#ai-form');
    await page.locator('.ai-ex .chip').first().click();
    await page.waitForFunction(() => /聽懂了/.test(document.querySelector('#ai-live').textContent));
    const early = await page.evaluate(() => document.querySelector('.ai-hero').classList.contains('playing'));
    assert.ok(early, '結果文字已經寫出，動畫還在播');
    await page.waitForFunction(() => { const L = window.__think.playing; return L.length >= 2 && !L[L.length - 1].on; }, null, { timeout: 5000 });
    const L = await page.evaluate(() => window.__think.playing);
    const on = L.find((x) => x.on), off = L.findLast((x) => !x.on);
    assert.ok(off.t - on.t >= 1150, `播了 ${Math.round(off.t - on.t)} ms`);
    assert.equal(await page.getAttribute('.ai-hero', 'data-stage'), 'done');
    assert.deepEqual(await page.locator('.ai-v[data-v="intent"], .ai-v[data-v="states"]').allTextContents(), ['行程規劃', '趕時間']);
  }, { init: THINK_RECORDER + FAKE_EDGE(100), motion: true, ignore: /not in test/ });
});

test('中央鍵拉出的底部對話面板：「阿幫在想」一樣會出現、會動、回答來了就收起', async () => {
  await withPage(DEVICES.phone, '#/s/weather', async (page) => {
    await page.waitForSelector('#abang-fab');
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .chat-form input');
    await page.fill('#abang-sheet .chat-form input', '從西門町到台北101怎麼去');
    await page.press('#abang-sheet .chat-form input', 'Enter');
    await page.waitForSelector('#abang-sheet .bubble.final', { timeout: 20000 });
    const r = await page.evaluate(() => window.__think);
    assert.ok(r.texts.some((x) => /^阿幫在想…/.test(x)) && r.texts.some((x) => /正在查：/.test(x)), r.texts.join(' | '));
    assert.ok(r.anims.includes('tc-beat'));
    assert.equal(await page.locator('#abang-sheet .think-core').count(), 0);
  }, { init: THINK_RECORDER, motion: true });
});

// ───── 回答也在手機上寫（ADR-0017）：假的 AbangEdgeAI（status 可用且支援 write、judge、write 依情境回改寫文字）─────
// write：ok＝照草稿改寫（數字不動）；bad＝把第一個數字改掉（護欄要擋）；slow＝4 秒才回（超過 2.5 秒用程式版）
const FAKE_EDGE_WRITE = (kind) => `window.__writes = [];
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method, args) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok', write: true });
    if (method === 'judge') return Promise.resolve({ engine: 'gemini-nano', ms: 120, result: '{"intent":"trip","states":[]}' });
    if (method === 'write') {
      window.__writes.push(args);
      const d = args.draft;
      const text = ${JSON.stringify(kind)} === 'bad' ? d.replace(/\\d+/, (n) => String(Number(n) + 7)) : '報你知，' + d.replace(/^選/, '建議坐');
      return new Promise((res) => setTimeout(() => res({ engine: 'gemini-nano', ms: 420, text }), ${kind === 'slow' ? 4000 : 400}));
    }
    return Promise.resolve({});
  },
};`;
const agentBodies = (page) => {
  const bodies = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/agent')) bodies.push(r.postDataJSON()); });
  return bodies;
};

test('回答在手機上寫：思考動畫出現「在手機上寫回答」→ 顯示改寫後的文字與「手機上的 Gemini Nano 聽懂你的問題，也寫了這次的回答」；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = agentBodies(page);
    await page.fill('.chat-form input', '從西門町去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.deepEqual(bodies[0].clientCaps, { edgeWrite: true, engine: 'gemini-nano' });
    const r = await page.evaluate(() => window.__think);
    assert.ok(r.texts.some((x) => /在手機上寫回答/.test(x)), r.texts.join(' | '));
    const w = await page.evaluate(() => window.__writes);
    assert.equal(w.length, 1);
    assert.match(w[0].draft, /^選「/);
    const say = await page.textContent('.bubble.final .say');
    assert.match(say, /^報你知，建議坐「/);
    assert.equal(say, `報你知，${w[0].draft.replace(/^選/, '建議坐')}`);
    assert.equal(await page.textContent('.device-line'), '手機上的 Gemini Nano 聽懂你的問題，也寫了這次的回答。', '判斷與寫回答合成一行');
    assert.equal(await page.getAttribute('.turn', 'data-writer'), 'edge');
    assert.match(await page.textContent('.agent-mode'), /回答在手機上寫/);
    await page.locator('.bubble.final').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-edge-write.png', SHOTS).pathname });
    // 接著問：送伺服器的前文是程式版總結（規則路徑讀得懂「剛剛那班」），畫面上是改寫
    await page.fill('.chat-form input', '剛剛那班還要等多久');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    const prior = bodies.at(-1).messages.find((m) => m.role === 'assistant');
    assert.equal(prior.content, w[0].draft);
    // 阿幫的腦袋：「寫回答」那一格記下今天寫了 2 次、通過 2／2
    await page.goto(`${base}/#/ai`);
    await page.waitForFunction(() => /今天在手機上寫了幾次/.test(document.querySelector('#ai-write')?.textContent || ''));
    const card = await page.textContent('#ai-write');
    assert.match(card, /Gemini Nano/);
    assert.match(card, /[12] 次（只記在這支手機）/); // 第二題的程式版太長時不改寫（不算）
    assert.match(card, /([12])／\1 次（100%）/);
  }, { init: THINK_RECORDER + FAKE_EDGE_WRITE('ok'), motion: true, ignore: /not in test/ });
});

test('回答在手機上寫：數字被改 → 顯示程式版並標示；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '從西門町去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const w = await page.evaluate(() => window.__writes);
    assert.equal(await page.textContent('.bubble.final .say'), w[0].draft, '用程式版總結');
    assert.equal(await page.textContent('.device-line'), '手機上的 Gemini Nano 聽懂你的問題；回答用阿幫的固定說法（沒通過檢查）。');
    assert.equal(await page.getAttribute('.turn', 'data-writer'), 'program');
    assert.match(await page.textContent('.agent-mode'), /^這次的回答用阿幫的固定說法/, '頁底照實說：沒用上手機寫的');
    await page.locator('.bubble.final').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-edge-write-fallback.png', SHOTS).pathname });
  }, { init: FAKE_EDGE_WRITE('bad'), ignore: /not in test/ });
});

test('回答在手機上寫：逾時 → 程式版；網頁版不帶 clientCaps、行為不變', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '從西門町去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const w = await page.evaluate(() => window.__writes);
    assert.equal(await page.textContent('.bubble.final .say'), w[0].draft);
    assert.equal(await page.textContent('.device-line'), '手機上的 Gemini Nano 聽懂你的問題；回答用阿幫的固定說法（逾時）。');
  }, { init: FAKE_EDGE_WRITE('slow'), ignore: /not in test/ });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = agentBodies(page);
    await page.fill('.chat-form input', '從西門町去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.ok(bodies.length && bodies.every((b) => !('clientCaps' in b)), '網頁版不帶 clientCaps');
    assert.match(await page.textContent('.bubble.final .say'), /^選「/);
    assert.equal(await page.locator('.device-line').count(), 0);
    assert.match(await page.textContent('.agent-mode'), /示範模式/);
  });
});

test('回答在手機上寫：聽不懂時不用伺服器模型，阿幫問你給幾個查得到的選項，點了就查', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = agentBodies(page);
    await page.fill('.chat-form input', '幫我寫一首關於秋天的詩');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const ask = page.locator('.ask');
    assert.equal(await ask.locator('.ask-q').textContent(), '這題我查不到，要不要改查這些？');
    assert.deepEqual(await ask.locator('.ask-opt').allTextContents(), ['怎麼去台北101', '附近公車站', '現在天氣', '發票對獎']);
    assert.match(await page.textContent('.bubble.final .say'), /點上面一個試試看/);
    await ask.locator('.ask-opt', { hasText: '現在天氣' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    assert.equal(bodies.at(-1).messages.at(-1).content, '現在天氣如何');
    assert.deepEqual(bodies.at(-1).clientCaps, { edgeWrite: true, engine: 'gemini-nano' });
  }, { init: FAKE_EDGE_WRITE('ok'), ignore: /not in test/ });
});

// ───── 「阿幫的腦袋」現場試判斷：四段（意圖與狀態、資料夠不夠、預計回答、下一個預計問你），可展開原始 JSON、複製結果 ─────
const CLIPBOARD = `window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });`;
const FAKE_TRIAL = (write) => `window.__trialCalls = [];
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method, args) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    window.__trialCalls.push(method);
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok', write: ${write ? 'true' : 'false'} });
    if (method === 'judge') return Promise.resolve({ engine: 'gemini-nano', ms: 280, result: /公車/.test(args.text) ? '{"intent":"bus_route","states":[]}' : '{"intent":"trip","states":["rush"]}' });
    if (method === 'write') return Promise.resolve({ engine: 'gemini-nano', ms: 420, text: '報你知，' + args.draft });
    if (method === 'suggest') return Promise.resolve({ engine: 'gemini-nano', result: ['從台北車站到台北101怎麼去？', '307 公車還要多久？', '明天會下雨嗎？', '加我LINE領獎金'] });
    return Promise.resolve({});
  },
};`;
const secText = (page, key) => page.locator(`.ai-sec[data-sec="${key}"] .ai-sec-body`).textContent();

test('阿幫的腦袋：試判斷（手機）四段——手機判斷、資料不夠缺路線、程式版與手機改寫、阿幫問你與手機猜的下一句；展開 JSON、複製；截圖', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('.ai-hero[data-core="on"]');
    assert.equal(await page.locator('.ai-ex .chip').count(), 5);
    await page.locator('.ai-ex .chip', { hasText: '公車還要多久？' }).click();
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.deepEqual(await page.locator('.ai-sec h3').allTextContents(), ['意圖與狀態', '資料夠不夠', '預計回答', '下一個預計問你', '阿幫可以幫你做']);
    assert.match(await page.textContent('.ai-sec[data-sec="judge"] .ai-meta'), /手機・Gemini Nano.*280 毫秒.*沒用網路/);
    assert.match(await secText(page, 'judge'), /查公車.*伺服器採用了手機的判斷/);
    assert.match(await secText(page, 'data'), /資料不夠：缺公車路線/);
    assert.match(await page.textContent('.ai-slots li.miss'), /公車路線缺（一定要有）/);
    assert.match(await page.textContent('.ai-sources'), /交通（TDX.*示範資料（伺服器設定成示範模式）/);
    assert.equal(await page.isDisabled('#ai-copy'), false, '這一輪好了才能複製');
    // 缺路線：阿幫問「哪一路公車？」（不查資料、不交給手機改寫），也就不再標「沒有針對缺的欄位問」
    assert.equal(await page.textContent('.ai-ask-q'), '哪一路公車？');
    assert.match(await page.textContent('.ai-ask-opts'), /看附近有哪些公車/);
    assert.equal(await page.locator('.ai-gap').count(), 0);
    assert.match(await secText(page, 'answer'), /沒有查資料.*固定回答.*你要查哪一路公車/);
    const sug = page.locator('.ai-suggest li');
    assert.equal(await sug.count(), 3);
    assert.deepEqual(await sug.evaluateAll((ls) => ls.map((l) => l.dataset.src)), ['edge', 'edge', 'edge'], '手機猜、伺服器驗證過');
    assert.doesNotMatch(await page.textContent('.ai-suggest'), /LINE/, '誘導內容擋掉');
    const calls = await page.evaluate(() => window.__trialCalls);
    assert.ok(['judge', 'suggest'].every((m) => calls.includes(m)) && !calls.includes('write'), `缺路線：伺服器直接給固定的一句，不交給手機改寫（${calls.join()}）`);
    // 原始 JSON：展開看得到（textContent），每段都有
    assert.equal(await page.locator('.ai-raw').count(), 5); // 第 5 段：阿幫可以幫你做
    await page.locator('.ai-sec[data-sec="data"] .ai-raw summary').click();
    const raw = JSON.parse(await page.locator('.ai-sec[data-sec="data"] .ai-raw pre').textContent());
    assert.deepEqual(raw.missing, ['route']);
    await shot(page, 'phone-ai-trial'); // 複製之前截（不要截到提示泡泡）
    await page.click('#ai-copy');
    await page.waitForFunction(() => window.__copied);
    const copied = JSON.parse(await page.evaluate(() => window.__copied));
    assert.equal(copied.q, '公車還要多久？');
    assert.deepEqual(Object.keys(copied.sections), ['judge', 'data', 'answer', 'next', 'act']);
    // 行程：資料夠、用手機的定位（跟問阿幫一樣，2026-11-22）、程式計分的建議
    await page.fill('#ai-input', '我快遲到了，怎麼去台北101');
    await page.click('#ai-go');
    await page.waitForFunction(() => /資料夠/.test(document.querySelector('.ai-verdict')?.textContent || ''), null, { timeout: 20000 });
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.match(await page.textContent('.ai-locnote'), /用了手機的定位/);
    assert.match(await secText(page, 'answer'), /程式計分的建議/);
    assert.match(await secText(page, 'answer'), /程式版.*手機改寫（Gemini Nano）報你知，.*通過護欄/);
    assert.ok((await page.evaluate(() => window.__trialCalls)).includes('write'));
    await shot(page, 'phone-ai-trial-trip');
    // 規則聽不懂、手機判斷是行程：資料來源標「如果聽懂了會查」，並照實標出沒有針對缺的目的地問
    await page.fill('#ai-input', '帶我去那邊');
    await page.click('#ai-go');
    await page.waitForFunction(() => document.querySelector('.ai-sec[data-sec="next"]') && !document.querySelector('#ai-go').disabled, null, { timeout: 20000 });
    assert.equal(await page.textContent('.ai-sec[data-sec="data"] h4'), '如果聽懂了會查的資料', '規則聽不懂：不說「會查」');
  }, { init: CLIPBOARD + FAKE_TRIAL(true), ignore: /not in test/ });
});

test('阿幫的腦袋：試判斷（網頁版）第 1 段標「伺服器・規則」並說原因；防詐、英文測試句；不能寫回答時說明', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('#ai-form');
    await page.locator('.ai-ex .chip', { hasText: '公車還要多久？' }).click();
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.match(await page.textContent('.ai-sec[data-sec="judge"] .ai-meta'), /伺服器・規則.*用到網路/);
    assert.match(await secText(page, 'judge'), /網頁版沒有手機上的 AI，改用伺服器的判斷/);
    assert.match(await secText(page, 'data'), /資料不夠：缺公車路線/);
    assert.equal(await page.textContent('.ai-ask-q'), '哪一路公車？', '資料不夠：阿幫問缺的那一項');
    assert.match(await secText(page, 'answer'), /網頁版不在手機上寫回答/);
    assert.match(await page.textContent('.ai-sec[data-sec="next"] .ai-foot'), /來源：規則/);
    await page.locator('.ai-sec[data-sec="next"] .ai-raw summary').click();
    assert.match(await page.locator('.ai-sec[data-sec="next"] .ai-raw pre').textContent(), /"about": "slot:route"/);
    await shot(page, 'phone-ai-trial-web');
    await page.locator('.ai-ex .chip', { hasText: '這是詐騙嗎' }).click();
    await page.waitForFunction(() => /固定的說明/.test(document.querySelector('.ai-verdict')?.textContent || ''), null, { timeout: 20000 });
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.match(await secText(page, 'answer'), /防詐/);
    await page.locator('.ai-ex .chip', { hasText: 'How do I get to Taipei 101?' }).click();
    await page.waitForFunction(() => /Taipei 101/.test(document.querySelector('.ai-sec[data-sec="answer"] .ai-say')?.textContent || ''), null, { timeout: 20000 });
    assert.match(await page.textContent('.ai-sec[data-sec="answer"] .ai-say'), /Taipei 101/);
  }, { init: CLIPBOARD });
  // 手機上的 AI 能判斷、不能寫：第 3 段說明會顯示程式版
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('.ai-hero[data-core="on"]');
    await page.locator('.ai-ex .chip', { hasText: '明天會下雨嗎' }).click();
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.match(await secText(page, 'answer'), /這支手機不能在手機上寫回答/);
    assert.equal(await page.evaluate(() => window.__trialCalls.includes('write')), false);
  }, { init: CLIPBOARD + FAKE_TRIAL(false), ignore: /not in test/ });
});

// ───── 缺必要欄位就問（「該問就問、不要自己猜」，ADR-0016）：哪一路公車、要去哪裡、從哪裡出發 ─────
test('問阿幫：缺路線問「哪一路公車？」，打 307 接回查到站；只說起點問要去哪裡（常用地點有設定才給）；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = agentBodies(page);
    await page.fill('.chat-form input', '公車還要多久？');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.ask[data-about="slot:route"]', { timeout: 20000 });
    assert.equal(await page.textContent('.ask .ask-q'), '哪一路公車？');
    assert.deepEqual(await page.locator('.ask .ask-opt').allTextContents(), ['看附近有哪些公車']);
    assert.match(await page.textContent('.ask .ask-why'), /例如 307/);
    await page.locator('.ask').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-ask-route.png', SHOTS).pathname });
    await page.fill('.chat-form input', '307');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    assert.deepEqual(bodies.at(-1).pendingAsk && { slot: bodies.at(-1).pendingAsk.slot }, { slot: 'route' }, '打的不是按鈕：帶 pendingAsk 給伺服器');
    await page.waitForFunction(() => /307/.test(document.querySelector('.turn:last-of-type')?.textContent || document.body.textContent));
    // 只說起點：問要去哪裡；沒設定常用地點 → 不給「回家」「去公司」
    await page.fill('.chat-form input', '從台北車站出發');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.ask[data-about="slot:to"]', { timeout: 20000 });
    assert.equal(await page.locator('.ask[data-about="slot:to"] .ask-q').textContent(), '要去哪裡？');
    assert.equal(await page.locator('.ask[data-about="slot:to"] .ask-opt', { hasText: '回家' }).count(), 0, '沒設定家：不顯示');
    await page.fill('.chat-form input', '台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 4, null, { timeout: 20000 });
    assert.equal(bodies.at(-1).pendingAsk.slot, 'to');
    assert.equal(bodies.at(-1).pendingAsk.from, '臺北車站');
    assert.ok(await page.locator('.dg, .decision, [class*="decision"]').count() > 0 || /台北101|臺北101/.test(await page.textContent('.bubble.final:last-of-type')), '接回去：從臺北車站算到台北101');
  });
});

test('問阿幫：沒定位、目的地就是預設起點 → 問「你從哪裡出發？」，不算臺北車站到臺北車站；回西門町接回去；英文缺路線', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = agentBodies(page);
    await page.fill('.chat-form input', '我快遲到了，怎麼去台北車站');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.ask[data-about="slot:from"]', { timeout: 20000 });
    assert.equal(await page.locator('.ask[data-about="slot:from"] .ask-q').textContent(), '你從哪裡出發？');
    assert.deepEqual(await page.locator('.ask[data-about="slot:from"] .ask-opt').allTextContents(), ['用我的位置'], '沒設定常用地點：只有用我的位置');
    assert.doesNotMatch(await page.textContent('.bubble.final'), /臺北車站.*到.*臺北車站|步行.*1 分/);
    await page.locator('.ask').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-ask-origin.png', SHOTS).pathname });
    await page.fill('.chat-form input', '西門町');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length >= 2, null, { timeout: 20000 });
    assert.deepEqual(bodies.at(-1).pendingAsk && [bodies.at(-1).pendingAsk.slot, bodies.at(-1).pendingAsk.to], ['from', '臺北車站'], '打的地名帶 pendingAsk（伺服器接成「從西門町到臺北車站怎麼去？」）');
    assert.match(await page.locator('.bubble.final').last().textContent(), /選「/, '接回去：算出走法');
    await page.fill('.chat-form input', 'How long until the bus comes?');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.ask[data-about="slot:route"]', { timeout: 20000 });
    assert.equal(await page.locator('.ask[data-about="slot:route"] .ask-q').textContent(), 'Which bus route?');
  }, { geo: false });
  // 有設定常用地點：「從家出發」出現
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '怎麼去台北車站');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.ask[data-about="slot:from"]', { timeout: 20000 });
    assert.deepEqual(await page.locator('.ask[data-about="slot:from"] .ask-opt').allTextContents(), ['用我的位置', '從家出發']);
  }, { geo: false, init: () => { try { localStorage.setItem('abang.places', JSON.stringify({ 家: { name: '板橋', lat: 25.014, lon: 121.4637 } })); } catch { /* 無痕 */ } } });
});

// ───── 阿幫會看（M14-02，ADR-0015）：假的 AbangVision 外掛（不開相機，依序回傳讀到的字或條碼）─────
// 一般 Android 手機的樣子：讀字 ML Kit 中文、條碼 ML Kit、Gemini Nano 看圖還沒試過；語音（AbangVoice）可用，所以輸入列有相機＋麥克風；AbangSystem 只記錄被呼叫
function fakeVision(readings) {
  const queue = [...readings];
  const calls = (window.__vision = []);
  const listeners = [];
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    isPluginAvailable: (n) => n === 'AbangVision' || n === 'AbangSystem' || n === 'AbangVoice',
    addListener: (plugin, ev, fn) => { if (plugin === 'AbangVision' && ev === 'stage') listeners.push(fn); return { remove() {} }; },
    nativePromise: (plugin, method, opts) => {
      if (plugin === 'AbangSystem') { calls.push(`${plugin}.${method}`); return Promise.resolve(); }
      if (plugin === 'AbangVoice') return method === 'available' ? Promise.resolve({ engine: 'android-ondevice', lang: opts?.lang, permission: 'prompt', osVersion: '16', available: true, onDevice: true }) : Promise.resolve({});
      if (plugin !== 'AbangVision') return Promise.reject(new Error('not in test'));
      if (method === 'available') return Promise.resolve({ platform: 'android', camera: true, photos: true, cameraPermission: 'prompt', text: { available: true, engine: 'mlkit-text-chinese' }, barcode: { available: true, engine: 'mlkit-barcode' }, describe: { engine: 'gemini-nano', state: 'untested' } });
      if (method !== 'capture') return Promise.resolve({});
      calls.push({ source: opts.source, want: opts.want });
      const next = queue.shift() || { reject: 'cancelled' };
      return new Promise((res, rej) => setTimeout(() => {
        if (next.reject) { rej(Object.assign(new Error(next.reject), { code: next.reject })); return; }
        listeners.forEach((f) => f({ stage: 'reading' })); // 相機關了、開始讀
        setTimeout(() => res(next.result), next.delay || 0);
      }, 50));
    },
  };
}
const VISION_SMS = '【中華郵政】您的包裹地址不完整，暫停配送。請於24小時內點擊 https://tw388.xyz/p 補運費25元，逾期退回。客服 0912-345-678';
const smsReading = (delay = 0) => ({ delay, result: { engine: 'mlkit', ms: 380, text: { full: VISION_SMS, lines: VISION_SMS.split('。').map((t) => ({ text: t, box: { x: 0.05, y: 0.3, w: 0.9, h: 0.03 } })) }, barcodes: [] } });

test('阿幫會看：防詐頁拍可疑訊息 → 看的動畫 → 阿幫看到了、可遮號碼 → 確認後檢查 → 高風險；送出的只有文字', async () => {
  await withPage(DEVICES.phone, '#/agent/antifraud', async (page) => {
    const bodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent/antifraud') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
    const cam = page.locator('.chat-form .chat-cam');
    await cam.waitFor({ state: 'visible' });
    assert.equal(await cam.getAttribute('aria-label'), '拍可疑訊息或選截圖');
    const box = await cam.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, '相機鍵至少 44px');
    await cam.click();
    await page.waitForSelector('.vision-dialog[open]');
    assert.equal(await page.textContent('#vs-title'), '拍可疑訊息');
    assert.deepEqual(await page.locator('.vs-choice').allTextContents(), ['拍可疑訊息', '選截圖']);
    assert.match(await page.textContent('.vs-lock'), /不上傳、不保存/);
    await page.click('.vs-choice[data-source="photos"]');
    // 看的時候：核心脈動、掃描線在動（讀屏念「阿幫在看…」）
    await page.waitForSelector('.vs-look[data-stage="look"]');
    assert.equal(await page.locator('.vs-look .vs-core').evaluate((n) => getComputedStyle(n).animationName), 'vs-beat');
    assert.equal(await page.locator('.vs-look .vs-scan').evaluate((n) => getComputedStyle(n).animationName), 'vs-scan');
    await page.waitForFunction(() => /阿幫在看/.test(document.querySelector('.vision-dialog .vs-live[role=status]')?.textContent || '')); // 常駐的播報區（審查：帶內容插入的不一定會念）
    await page.locator('.vision-dialog').screenshot({ path: new URL('phone-vision-looking.png', SHOTS).pathname });
    await page.waitForSelector('.vision-dialog textarea');
    assert.equal(bodies.length, 0, '還沒確認：什麼都沒送');
    await page.waitForFunction(() => /^阿幫看到了：/.test(document.querySelector('.vision-dialog .vs-live')?.textContent || ''));
    assert.match(await page.textContent('.vision-dialog .vs-live'), /像手機的號碼/, '個資提醒也念');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'vs-title', '手機：焦點在視窗標題（不掉到 body、不自動跳鍵盤）');
    assert.match(await page.inputValue('.vision-dialog textarea'), /tw388\.xyz/);
    assert.match(await page.textContent('.vs-warn'), /手機/);
    await page.click('.vs-mask');
    assert.doesNotMatch(await page.inputValue('.vision-dialog textarea'), /0912-345-678/);
    await shot(page, 'phone-vision-scam-saw');
    await page.click('.vs-go');
    assert.equal(await page.locator('.vision-dialog').count(), 0, '確認後關閉並移除');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(await page.locator('.results [data-card="scam-risk"] .ab-risk.high').count(), 1);
    assert.match(bodies[0].messages.at(-1).content, /tw388\.xyz/);
    assert.doesNotMatch(JSON.stringify(bodies[0]), /0912-345-678|image|base64/, '遮過的號碼、照片都沒有送出');
    assert.deepEqual(await page.evaluate(() => window.__vision), [{ source: 'photos', want: ['text'] }]);
    await shot(page, 'phone-vision-scam');
  }, { init: fakeVision, initArg: [smsReading(900)], motion: true, ignore: /not in test/ });
});

test('阿幫會看：輸入列相機＋麥克風 375px 不擠；生活頁讀到簡訊先問「要幫你檢查嗎」，答應才轉到防詐頁檢查（文字不放網址）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const posts = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/agent') && r.method() === 'POST') posts.push(r.url()); });
    // 輸入列：相機（左）、輸入框、麥克風（語音 M14-01）、送出；375px 寬不溢出
    await page.locator('.chat-form .chat-mic').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 375, height: 812 });
    const row = await page.evaluate(() => {
      const f = document.querySelector('.chat-form');
      const r = (s) => f.querySelector(s).getBoundingClientRect();
      const order = [...f.children].filter((e) => !e.hidden).map((e) => e.className.split(' ').find((c) => c.startsWith('chat-')));
      return { order, formRight: f.getBoundingClientRect().right, sendRight: r('.chat-send').right, input: r('.chat-input').width, scroll: document.documentElement.scrollWidth, vw: innerWidth, cam: r('.chat-cam').width, mic: r('.chat-mic').width };
    });
    assert.deepEqual(row.order, ['chat-cam', 'chat-input', 'chat-mic', 'chat-send'], '相機（左）、輸入框、麥克風、送出');
    assert.ok(row.sendRight <= row.formRight + 0.5 && row.scroll <= row.vw, `375px 不溢出：${JSON.stringify(row)}`);
    assert.ok(row.input >= 120 && row.cam >= 44 && row.mic >= 44, `輸入框還夠寬、兩個鍵 44px：${JSON.stringify(row)}`);
    await page.click('.chat-form .chat-cam');
    assert.deepEqual(await page.locator('.vs-choice').allTextContents(), ['拍照', '選截圖或照片']);
    await page.click('.vs-choice[data-source="camera"]');
    await page.waitForSelector('.vs-ask');
    assert.equal(await page.textContent('.vs-ask'), '這看起來像一則訊息。要幫你檢查這則訊息是不是詐騙嗎？');
    await shot(page, 'phone-vision-scam-ask');
    assert.equal(posts.length, 0);
    await page.click('.vs-go');
    await page.waitForFunction(() => location.hash === '#/agent/antifraud');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(await page.locator('.results [data-card="scam-risk"]').count(), 1);
    assert.doesNotMatch(await page.evaluate(() => location.href), /tw388|%E5%8C%85/);
    const w = await page.evaluate(() => window.__vision[0]);
    assert.deepEqual(w, { source: 'camera', want: ['text', 'barcode', 'describe'] }, 'Gemini Nano 看圖還沒試過：請外掛試一次');
  }, { init: fakeVision, initArg: [smsReading()], ignore: /not in test/ });
});

test('阿幫會看：拍站牌 → 阿幫看到了站名與路線 → 組好的問題可改 → 送出查到那一站', async () => {
  const r = await fetch(`${base}/api/v1/tools/bus_route_eta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: 'Taipei', routeName: '307' }) }).then((x) => x.json());
  const stop = r.data.directions[0].stops[4].stopName;
  const lines = [['307', 0.05, 0.07], [stop, 0.15, 0.13], ['307 262', 0.5, 0.05], ['往 板橋', 0.6, 0.04], ['申訴專線 1999', 0.9, 0.02]].map(([text, y, h]) => ({ text, box: { x: 0.1, y, w: 0.5, h } }));
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-cam');
    await page.click('.vs-choice[data-source="camera"]');
    await page.waitForSelector('.vision-dialog .vs-q');
    const facts = await page.locator('.vs-facts li').allTextContents();
    assert.deepEqual(facts, [`站名「${stop}」`, '公車 307、262', '往 板橋']);
    assert.equal(await page.inputValue('.vs-q'), `307 公車到「${stop}」還要多久？`);
    assert.deepEqual(await page.locator('.vs-alt .chip').allTextContents(), [`262 公車到「${stop}」還要多久？`]);
    await shot(page, 'phone-vision-stop');
    await page.click('.vs-go');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(await page.locator('.msg.user').last().textContent(), `307 公車到「${stop}」還要多久？`);
    assert.equal(await page.locator('.results [data-card="bus-route"]').count(), 1);
    assert.ok((await page.locator('.bubble.tool .say').allTextContents()).some((x) => x.includes(`「${stop}」`)), '盯拍到的那一站');
  }, { init: fakeVision, initArg: [{ result: { engine: 'mlkit', text: { lines }, barcodes: [] } }], ignore: /not in test/ });
});

test('阿幫會看：拍發票 → 存進我的發票並馬上對獎；發票頁改用原生相機；底部對話也有相機鍵', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-cam');
    await page.click('.vs-choice[data-source="camera"]');
    await page.waitForSelector('.vs-facts');
    assert.deepEqual(await page.locator('.vs-facts li').allTextContents(), ['發票 AB-54348835', '消費 2026-08-03']);
    assert.equal(await page.evaluate(() => localStorage.getItem('invoices')), null, '確認前不存');
    await page.click('.vs-go');
    await page.waitForSelector('.vs-result.won');
    assert.match(await page.textContent('.vs-result'), /中獎了！頭獎/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('invoices')).map((x) => [x.number, x.date, x.status])), [['54348835', '2026-08-03', 'won']]);
    await shot(page, 'phone-vision-invoice');
    await page.click('.vision-dialog a[href="#/s/invoice"]');
    await page.waitForSelector('#inv-list .inv-st.won');
    // 發票頁（M11-03）：App 裡用原生相機拍或選照片；拍到右邊明細 QR 提示拍左邊
    assert.equal(await page.textContent('#inv-scan'), '拍發票 QR code');
    assert.equal(await page.textContent('#inv-pick'), '選發票照片');
    await page.click('#inv-scan');
    await page.waitForSelector('.vision-dialog .vs-msg');
    assert.match(await page.textContent('.vision-dialog .vs-msg'), /右邊的明細 QR code/);
    await page.waitForFunction(() => /右邊的明細/.test(document.querySelector('.vision-dialog .vs-live')?.textContent || ''));
    await page.click('.vision-dialog .btn.quiet >> text=關閉');
    await page.click('#inv-pick');
    await page.waitForSelector('.vs-facts');
    await page.click('.vs-go');
    await page.waitForFunction(() => /11\/25 開獎/.test(document.querySelector('.vs-result')?.textContent || ''));
    await page.click('.vision-dialog .btn.primary >> text=關閉');
    await page.waitForFunction(() => document.querySelectorAll('#inv-list [data-id]').length === 2);
    assert.deepEqual(await page.evaluate(() => window.__vision.map((x) => x.source)), ['camera', 'camera', 'photos']);
    // 底部對話面板（同一段對話）也有相機鍵
    await page.click('#abang-fab');
    await page.locator('#abang-sheet .chat-cam').waitFor({ state: 'visible' });
  }, { init: fakeVision, initArg: [{ result: { engine: 'mlkit', text: { lines: [] }, barcodes: [{ format: 'qr_code', raw: LEFT_QR }] } }, { result: { engine: 'mlkit', text: { lines: [] }, barcodes: [{ format: 'qr_code', raw: '**咖啡:1:65' }] } }, { result: { engine: 'mlkit', text: { full: '電子發票證明聯\n115年09-10月\nCD-11112222\n2026-10-01 12:00:00' }, barcodes: [] } }], ignore: /not in test/ });
});

test('阿幫會看：相機權限被拒說原因、一鍵到設定；取消回到選單；reduced motion 時看的畫面是靜態', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-cam');
    await page.click('.vs-choice[data-source="camera"]');
    await page.waitForSelector('.vs-err');
    assert.equal(await page.textContent('.vs-err'), '沒有相機權限。到手機設定允許「相機」後再試，或改用「選截圖」。');
    await page.click('.vision-dialog >> text=到設定開啟');
    await page.waitForFunction(() => window.__vision.includes('AbangSystem.openSettings'));
    await page.click('.vision-dialog >> text=再試一次');
    await page.click('.vs-choice[data-source="photos"]'); // 使用者取消選擇器：回到選單
    await page.waitForSelector('.vs-choice');
    await page.click('.vs-choice[data-source="photos"]');
    await page.waitForSelector('.vs-look[data-stage="look"]');
    assert.equal(await page.locator('.vs-look .vs-core').evaluate((n) => getComputedStyle(n).animationName), 'none', 'reduced motion：不動');
    assert.equal(await page.locator('.vs-look .vs-scan').evaluate((n) => getComputedStyle(n).animationName), 'none');
    await page.waitForSelector('.vision-dialog textarea');
  }, { init: fakeVision, initArg: [{ reject: 'denied' }, { reject: 'cancelled' }, smsReading(800)], ignore: /not in test/ });
});

test('阿幫會看（網頁版降級）：沒有本機讀字不顯示相機鍵（只有 BarcodeDetector 也不給，發票頁用自己的掃描）；瀏覽器能讀字時在本機讀；設定可關；阿幫的腦袋照實說', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.chat-cam').isHidden(), true, '沒有任何本機辨識：不給相機鍵');
    await page.goto(`${base}/#/ai`);
    await page.waitForFunction(() => /不支援/.test(document.querySelector('#ai-vision-body')?.textContent || ''));
    assert.match(await page.textContent('#ai-vision-body'), /請用手機 App/);
  }, { init: () => { window.BarcodeDetector = undefined; window.TextDetector = undefined; } });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.chat-cam').isHidden(), true, '只有 BarcodeDetector：問阿幫不給相機鍵（拍簡訊會讀不到字）');
    await page.goto(`${base}/#/agent/antifraud`);
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.chat-cam').isHidden(), true, '防詐要讀字：網頁版沒有讀字就不給');
    await page.goto(`${base}/#/s/invoice`);
    await page.waitForSelector('#inv-scan');
    assert.equal(await page.textContent('#inv-scan'), '掃發票 QR code', '發票頁維持網頁的連續掃描');
  }, { init: () => { window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } async detect() { return []; } }; window.TextDetector = undefined; } });
  // 瀏覽器有 TextDetector：在本機讀字（選檔），照片不送伺服器
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const uploads = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /image|base64/.test(r.postData() || '')) uploads.push(r.url()); });
    await page.click('.chat-form .chat-cam');
    await page.waitForSelector('.vs-choice');
    assert.equal(await page.locator('.vs-web').count(), 0, '能讀字：不需要說明');
    const chooser = page.waitForEvent('filechooser');
    await page.click('.vs-choice[data-source="photos"]');
    const fc = await chooser;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIklEQVR4AdyKMQ0AAAyDyPx73lYBrYAmcMEAm9Tw3dMxHAAAAP//n8zf4QAAAAZJREFUAwCzCQgJB3GDOQAAAABJRU5ErkJggg==', 'base64');
    await fc.setFiles({ name: 'sms.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('.vs-ask');
    assert.match(await page.inputValue('.vision-dialog textarea'), /tw388\.xyz/);
    assert.deepEqual(uploads, [], '照片沒有送出');
  }, { init: () => { window.TextDetector = class { async detect() { return [{ rawValue: '請於24小時內點擊 https://tw388.xyz/p 補運費', boundingBox: { x: 0, y: 0, width: 1, height: 1 } }]; } }; window.BarcodeDetector = undefined; } });
  // App：設定頁關掉「讓阿幫看照片」→ 相機鍵不見；阿幫的腦袋列出外掛回報的引擎
  await withPage(DEVICES.phone, '#/settings', async (page) => {
    await page.waitForFunction(() => /ML Kit 文字辨識/.test(document.querySelector('#vision-status')?.textContent || ''));
    await page.click('#vision');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.vision')), 'off');
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.chat-cam').isHidden(), true);
    await page.goto(`${base}/#/ai`);
    await page.waitForFunction(() => /ML Kit 文字辨識（中文模型/.test(document.querySelector('#ai-vision-body')?.textContent || ''));
    const t = await page.textContent('#ai-vision-body');
    assert.match(t, /ML Kit 條碼掃描/);
    assert.match(t, /Gemini Nano：系統沒有提供查詢/);
    assert.match(t, /關著/);
    await page.locator('#ai-vision').screenshot({ path: new URL('phone-ai-vision.png', SHOTS).pathname });
  }, { init: fakeVision, initArg: [], ignore: /not in test/ });
});

// 語音問阿幫（M14-01，voice.js、agent/voice-ui.js）：假的原生外掛 AbangVoice 送出 level、partial、final 事件。
// mode：auto＝像 Android 一樣自己收尾（0.7 秒送 final）；manual＝要等「說完了」、停頓 1.5 秒或放開中央鍵（stop）才送 final。deny：權限被拒。
// reason：這支手機不能在手機上辨識（os、ios-no-ondevice…）；pack：語言包還沒裝（download 後 progress 30、70、done，之後就能用）；platform：android／ios
const FAKE_VOICE = (o = {}) => `(() => {
  const o = ${JSON.stringify(o)};
  const L = {};
  const V = (window.__voice = { calls: [], timers: [], starts: [] });
  const emit = (ev, d) => (L[ev] || []).slice().forEach((cb) => cb(d));
  const later = (ms, f) => V.timers.push(setTimeout(f, ms));
  const text = o.text || '從西門町到台北101怎麼去';
  const engine = o.platform === 'ios' ? 'ios-speech' : 'android-ondevice';
  let packReady = !o.pack;
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => o.platform || 'android',
    isPluginAvailable: (n) => n === 'AbangVoice' || n === 'AbangSystem',
    addListener: (plugin, ev, cb) => { if (plugin === 'AbangVoice') (L[ev] ||= []).push(cb); return { remove() { L[ev] = (L[ev] || []).filter((x) => x !== cb); } }; },
    nativePromise: (plugin, method, args) => {
      if (plugin === 'AbangSystem') { V.calls.push('AbangSystem.' + method); return Promise.resolve({}); }
      if (plugin !== 'AbangVoice') return Promise.reject(new Error('not in test'));
      V.calls.push(method + (args && args.lang ? ':' + args.lang : ''));
      const base = { engine, lang: args && args.lang, permission: o.deny ? 'denied' : 'prompt', osVersion: '16' };
      if (method === 'available') return Promise.resolve(o.reason ? { ...base, available: false, onDevice: false, reason: o.reason } : !packReady ? { ...base, available: false, onDevice: false, reason: V.downloading ? 'downloading' : 'language-download' } : { ...base, available: true, onDevice: true });
      if (method === 'download') {
        V.downloading = true;
        later(300, () => emit('download', { status: 'progress', percent: 30 }));
        later(900, () => emit('download', { status: 'progress', percent: 70 }));
        later(o.packMs || 2500, () => { packReady = true; V.downloading = false; emit('download', { status: 'done' }); });
        return Promise.resolve({ progress: true });
      }
      if (method === 'openSettings') return Promise.resolve({});
      if (method === 'start') {
        V.starts.push(args);
        if (o.startDelay && !V.asked) { V.asked = true; return new Promise((res) => setTimeout(res, o.startDelay)).then(() => window.Capacitor.nativePromise(plugin, method, args)); } // 第一次：權限框
        if (o.deny) return Promise.reject(Object.assign(new Error('麥克風權限沒有打開'), { code: 'permission' }));
        later(150, () => emit('level', { level: 0.9 }));
        later(250, () => emit('partial', { text: '從西門町' }));
        later(400, () => emit('partial', { text: '從西門町到台北101' }));
        later(500, () => emit('level', { level: 0.6 }));
        if (o.mode === 'auto') later(700, () => emit('final', { text, onDevice: true }));
        return Promise.resolve({ onDevice: true, engine, lang: args.lang });
      }
      if (method === 'stop') { later(80, () => emit('final', { text, onDevice: true })); return Promise.resolve({}); }
      if (method === 'cancel') { V.timers.forEach(clearTimeout); V.timers = []; return Promise.resolve({}); }
      return Promise.resolve({});
    },
  };
})();`;
const VOICE_IGNORE = /not in test/;

test('語音問阿幫（App）：麥克風鍵 → 在聽（核心跟著音量）與即時文字 → 自動送出 → 接上阿幫在想；截圖送出後', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    let release;
    const hold = new Promise((r) => { release = r; });
    await page.route('**/api/v1/agent', async (route) => { if (route.request().method() === 'POST') await hold; await route.fallback(); }); // 擋住伺服器回應，截到送出後的思考中
    const mic = page.locator('.chat-form .chat-mic');
    await mic.waitFor({ state: 'visible' });
    assert.equal(await mic.getAttribute('aria-label'), '用說的問阿幫');
    const box = await mic.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `觸控目標 ${box.width}×${box.height}`);
    await mic.click();
    await page.waitForSelector('.voice-panel[data-phase="listening"]');
    assert.equal(await page.textContent('.voice-panel .vc-title'), '在聽…');
    assert.equal(await page.textContent('.voice-panel .vc-where'), '在手機上轉成文字，語音不離開手機');
    assert.equal(await mic.getAttribute('aria-pressed'), 'true');
    assert.equal(await mic.getAttribute('aria-label'), '說完了，送出');
    await page.waitForFunction(() => /從西門町/.test(document.querySelector('.voice-panel .vc-heard')?.textContent || ''));
    assert.notEqual(await page.locator('.voice-panel .vc-core').evaluate((n) => getComputedStyle(n).transform), 'none', '核心跟著音量放大');
    assert.equal(await page.locator('.voice-panel .vc-orbit').evaluate((n) => getComputedStyle(n).animationName), 'tc-spin');
    assert.match(await page.textContent('.chat-dock [role=status]'), /開始聽了/);
    // 自己收尾（final）→ 自動送出 → 阿幫在想
    await page.waitForSelector('.msg.user.spoken');
    assert.equal(await page.textContent('.msg.user.spoken'), '從西門町到台北101怎麼去');
    assert.ok(await page.locator('.voice-panel').isHidden());
    await page.waitForSelector('.think-core');
    assert.equal(await mic.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await page.evaluate(() => window.__voice.calls.filter((c) => c.startsWith('start'))), ['start:zh-TW']);
    await page.locator('.think-core').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-voice-sent.png', SHOTS).pathname });
    release();
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    assert.equal(await page.locator('.think-core').count(), 0);
  }, { init: FAKE_VOICE({ mode: 'auto' }), motion: true, ignore: VOICE_IGNORE });
});

test('語音問阿幫：長按中央鍵拉出對話、在聽，放開就送出（短按照舊）；截圖在聽', async () => {
  await withPage(DEVICES.phone, '#/s/weather', async (page) => {
    const fab = page.locator('#abang-fab');
    await fab.waitFor();
    await page.waitForTimeout(200); // 外掛回報能用（voiceSupport）
    const b = await fab.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForSelector('#abang-sheet[open] .voice-panel[data-phase="listening"]');
    await page.waitForFunction(() => /台北101/.test(document.querySelector('#abang-sheet .vc-heard')?.textContent || ''));
    assert.equal(await page.textContent('#abang-sheet .vc-hint'), '放開就送出');
    assert.equal(await page.locator('#abang-sheet .vc-done').count(), 0, '長按時放開就是說完了，不另外給按鈕');
    assert.ok(await fab.evaluate((n) => n.classList.contains('listening')));
    assert.equal(await page.evaluate(() => window.__voice.starts[0].hold), true, '原生端也知道是長按（不因停頓收尾）');
    await page.waitForTimeout(1700); // 長按時不因停頓結束
    assert.equal(await page.getAttribute('#abang-sheet .voice-panel', 'data-phase'), 'listening');
    await page.screenshot({ path: new URL('phone-voice-listening.png', SHOTS).pathname });
    await page.mouse.up();
    await page.waitForSelector('#abang-sheet .msg.user.spoken');
    assert.equal(await page.textContent('#abang-sheet .msg.user.spoken'), '從西門町到台北101怎麼去');
    assert.ok(await page.evaluate(() => document.getElementById('abang-sheet').open), '放開不會收起對話');
    assert.ok(!(await fab.evaluate((n) => n.classList.contains('listening'))));
    await page.waitForSelector('#abang-sheet .bubble.final', { timeout: 20000 });
    // 短按照舊：收起後再點一下中央鍵＝拉出對話（不開始聽）
    await page.click('#abang-sheet .sheet-close');
    await page.waitForFunction(() => !document.getElementById('abang-sheet').open);
    const starts = await page.evaluate(() => window.__voice.calls.filter((c) => c.startsWith('start')).length);
    await fab.click();
    await page.waitForSelector('#abang-sheet[open]');
    assert.ok(await page.locator('#abang-sheet .voice-panel').isHidden());
    assert.equal(await page.evaluate(() => window.__voice.calls.filter((c) => c.startsWith('start')).length), starts);
  }, { init: FAKE_VOICE({ mode: 'manual' }), motion: true, ignore: VOICE_IGNORE });
});

test('語音問阿幫：停頓 1.5 秒自動結束送出；英文那一輪用英文辨識；取消不送出', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const mic = page.locator('.chat-form .chat-mic');
    await mic.waitFor({ state: 'visible' });
    await mic.click();
    await page.waitForFunction(() => /台北101/.test(document.querySelector('.vc-heard')?.textContent || ''));
    await page.waitForSelector('.msg.user.spoken', { timeout: 5000 }); // 沒按「說完了」：停頓 1.5 秒自己送出
    assert.ok((await page.evaluate(() => window.__voice.calls)).includes('stop'));
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    // 英文提問之後：用英文辨識、面板英文
    await page.fill('.chat-form input', 'How do I get to Taipei 101 from Ximending');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    await mic.click();
    await page.waitForSelector('.voice-panel[data-phase="listening"]');
    assert.equal(await page.textContent('.vc-title'), 'Listening…');
    assert.equal(await mic.getAttribute('aria-label'), 'Done, send it');
    assert.ok((await page.evaluate(() => window.__voice.calls)).includes('start:en-US'));
    // 取消：不送出、讀屏說取消了、焦點回到麥克風
    await page.click('.voice-panel .vc-cancel');
    assert.ok(await page.locator('.voice-panel').isHidden());
    assert.ok((await page.evaluate(() => window.__voice.calls)).includes('cancel'));
    await page.waitForFunction(() => /Cancelled/.test(document.querySelector('.chat-dock [role=status]').textContent));
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('.msg.user.spoken').count(), 1, '取消的那次沒有送出');
    assert.ok(await mic.evaluate((n) => n === document.activeElement));
  }, { init: FAKE_VOICE({ mode: 'manual' }), ignore: VOICE_IGNORE });
});

test('語音問阿幫：麥克風權限被拒 → 說明＋到設定開啟；reduced motion 時在聽是靜態的', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-mic');
    await page.waitForSelector('.voice-panel[data-phase="error"]');
    assert.match(await page.textContent('.voice-panel .vc-title'), /麥克風權限沒有打開/);
    await page.waitForFunction(() => /麥克風權限沒有打開/.test(document.querySelector('.chat-dock [role=status]').textContent));
    await page.click('.voice-panel button:has-text("到設定開啟")');
    await page.waitForFunction(() => window.__voice.calls.includes('AbangSystem.openSettings'));
    await page.click('.voice-panel button:has-text("知道了")');
    assert.ok(await page.locator('.voice-panel').isHidden());
    assert.equal(await page.locator('.msg.user').count(), 0);
  }, { init: FAKE_VOICE({ deny: true }), ignore: VOICE_IGNORE });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-mic');
    await page.waitForFunction(() => /台北101/.test(document.querySelector('.vc-heard')?.textContent || ''));
    assert.equal(await page.textContent('.voice-panel .vc-title'), '在聽…');
    assert.equal(await page.locator('.voice-panel .vc-core').evaluate((n) => getComputedStyle(n).transform), 'none', '不跟著音量動');
    assert.equal(await page.locator('.voice-panel .vc-orbit').evaluate((n) => getComputedStyle(n).animationName), 'none');
    assert.equal(await page.locator('.voice-panel').evaluate((n) => getComputedStyle(n).animationName), 'none');
    assert.equal(await page.textContent('.voice-panel .vc-where'), '在手機上轉成文字，語音不離開手機');
    await page.click('.voice-panel .vc-done');
    await page.waitForSelector('.msg.user.spoken');
  }, { init: FAKE_VOICE({ mode: 'manual' }), ignore: VOICE_IGNORE });
});

test('語音問阿幫（網頁版）：瀏覽器不能在本機辨識就沒有麥克風；能在本機辨識才有（processLocally）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.ok(await page.locator('.chat-form .chat-mic').isHidden());
    await page.goto(`${base}/#/ai`);
    await page.waitForFunction(() => /網頁版只有在瀏覽器/.test(document.querySelector('#ai-ear')?.textContent || ''));
    await page.goto(`${base}/#/settings`);
    await page.waitForFunction(() => /不能在本機辨識/.test(document.querySelector('#voice-status')?.textContent || ''));
    assert.ok(await page.locator('#voice').isHidden(), '不能用：不顯示開關');
  });
  const fakeSR = () => {
    Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: [{ brand: 'Google Chrome', version: '156' }] }) }); // 只在 Google Chrome 問（無頭 Chromium 呼叫 available() 會當掉）
    window.SpeechRecognition = class {
      static async available(o) { window.__srOpts = o; return 'available'; }
      constructor() { this.processLocally = false; }
      start() {
        window.__srStarted = { lang: this.lang, local: this.processLocally };
        setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: '明天會下雨嗎' }], { isFinal: false })] }), 100);
        setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: '明天會下雨嗎' }], { isFinal: true })] }); this.onend?.(); }, 300);
      }
      stop() {}
      abort() {}
    };
  };
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.click('.chat-form .chat-mic');
    await page.waitForSelector('.msg.user.spoken');
    assert.equal(await page.textContent('.msg.user.spoken'), '明天會下雨嗎');
    assert.deepEqual(await page.evaluate(() => [window.__srOpts, window.__srStarted]), [{ langs: ['zh-TW'], processLocally: true }, { lang: 'zh-TW', local: true }]);
  }, { init: fakeSR });
});

test('語音問阿幫：阿幫的腦袋顯示「聽」（系統回報的引擎、在手機上）；設定關掉就沒有麥克風', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForFunction(() => /Android 手機上的語音辨識/.test(document.querySelector('#ai-ear')?.textContent || ''));
    const t = await page.textContent('#ai-ear');
    assert.match(t, /手機上辨識可用（語音不離開手機）/);
    assert.match(t, /中文/);
    assert.match(t, /還沒問過/);
    await page.goto(`${base}/#/settings`);
    await page.waitForFunction(() => /在手機上轉成文字/.test(document.querySelector('#voice-status')?.textContent || ''));
    assert.equal(await page.textContent('#mic'), '還沒問過');
    await page.click('#voice');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.voice')), 'off');
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('.chat-form input');
    await page.waitForTimeout(300);
    assert.ok(await page.locator('.chat-form .chat-mic').isHidden());
  }, { init: FAKE_VOICE({ mode: 'manual' }), ignore: VOICE_IGNORE });
});

test('語音問阿幫：手機不支援在手機上辨識 → 麥克風反白（仍可點）、點了說原因、不開始聽；iPhone 說怎麼開聽寫；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const mic = page.locator('.chat-form .chat-mic');
    await mic.waitFor({ state: 'visible' });
    assert.equal(await mic.getAttribute('aria-disabled'), 'true');
    assert.match(await mic.getAttribute('aria-label'), /這支手機不能用/);
    assert.ok(await mic.evaluate((n) => n.classList.contains('unavailable') && !n.disabled), '反白但仍可點');
    await mic.click({ force: true }); // aria-disabled：Playwright 當成停用，但使用者與讀屏仍可按
    await page.waitForSelector('.voice-panel[data-phase="why"]');
    assert.equal(await page.textContent('.voice-panel .vc-title'), '這支手機現在不能用說的問阿幫');
    assert.match(await page.textContent('.voice-panel .vc-heard'), /需要 Android 12 以上/);
    assert.match(await page.textContent('.voice-panel .vc-where'), /不錄音、不上傳/);
    await page.waitForFunction(() => /需要 Android 12 以上/.test(document.querySelector('.chat-dock [role=status]').textContent));
    assert.ok(!(await page.evaluate(() => window.__voice.calls)).some((c) => c.startsWith('start')), '不開始聽');
    await page.locator('.voice-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-voice-unsupported.png', SHOTS).pathname });
    await page.click('.voice-panel button:has-text("知道了")');
    assert.ok(await page.locator('.voice-panel').isHidden());
    // 長按中央鍵也不會聽（只有能用時才是捷徑）
    await page.goto(`${base}/#/ai`);
    await page.waitForFunction(() => /不支援：/.test(document.querySelector('#ai-ear')?.textContent || ''));
    assert.match(await page.textContent('#ai-ear'), /麥克風會反白/);
  }, { init: FAKE_VOICE({ reason: 'os' }), ignore: VOICE_IGNORE });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.locator('.chat-form .chat-mic').waitFor({ state: 'visible' });
    await page.click('.chat-form .chat-mic', { force: true });
    await page.waitForSelector('.voice-panel[data-phase="why"]');
    assert.match(await page.textContent('.voice-panel .vc-heard'), /設定 → 一般 → 鍵盤.*啟用聽寫.*中文（台灣）/);
    assert.equal(await page.locator('.voice-panel button:has-text("到手機設定下載")').count(), 0, 'iPhone 開不到聽寫設定：只說路徑');
  }, { init: FAKE_VOICE({ reason: 'ios-no-ondevice', platform: 'ios' }), ignore: VOICE_IGNORE });
});

test('語音問阿幫：語言包還沒裝 → 第一次按麥克風就下載（準備中、進度）→ 好了就能說', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const mic = page.locator('.chat-form .chat-mic');
    await mic.waitFor({ state: 'visible' });
    assert.equal(await mic.getAttribute('aria-disabled'), null);
    assert.match(await mic.getAttribute('aria-label'), /第一次要先下載中文語音包/);
    await mic.click();
    await page.waitForSelector('.voice-panel[data-phase="download"]');
    assert.match(await page.textContent('.voice-panel .vc-title'), /正在下載中文語音包/);
    assert.equal(await mic.getAttribute('aria-disabled'), 'true');
    assert.match(await mic.getAttribute('aria-label'), /準備中/);
    await page.waitForFunction(() => /70%/.test(document.querySelector('.voice-panel .vc-title').textContent));
    await mic.click({ force: true }); // 下載中再按：不開始聽
    assert.ok(!(await page.evaluate(() => window.__voice.calls)).some((c) => c.startsWith('start')));
    await page.waitForFunction(() => /語音包好了/.test(document.querySelector('.voice-panel .vc-title').textContent), null, { timeout: 8000 });
    assert.equal(await mic.getAttribute('aria-disabled'), null);
    assert.ok((await page.evaluate(() => window.__voice.calls)).includes('download:zh-TW'));
    await page.click('.voice-panel .vc-go');
    await page.waitForSelector('.voice-panel[data-phase="listening"]');
    await page.waitForSelector('.msg.user.spoken', { timeout: 5000 });
  }, { init: FAKE_VOICE({ pack: true, mode: 'auto' }), ignore: VOICE_IGNORE });
});

test('語音問阿幫：第一次按麥克風跳權限框（App 暫時看不見）不會被取消，允許後就開始聽', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const mic = page.locator('.chat-form .chat-mic');
    await mic.waitFor({ state: 'visible' });
    await mic.click();
    await page.waitForSelector('.voice-panel[data-phase="starting"]');
    // Android 的權限框讓 Activity onPause：WebView 送 visibilitychange hidden，按「允許」後回來
    await page.evaluate(() => {
      let vis = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => { vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }, 300);
    });
    await page.waitForSelector('.voice-panel[data-phase="listening"]', { timeout: 5000 });
    assert.ok(!(await page.evaluate(() => window.__voice.calls)).includes('cancel'), '權限框不算離開');
    await page.waitForSelector('.msg.user.spoken', { timeout: 5000 });
  }, { init: FAKE_VOICE({ mode: 'auto', startDelay: 800 }), ignore: VOICE_IGNORE });
});

// ───── 動態「下一句」建議（UX.md §3.2、AGENT.md §5.5） ─────
/** 假的裝置端 AI：suggest 依情境回句子（查完行程後回 5 句：1 句查不到、1 句跟畫面重複）；記下呼叫與收到的情境 */
const FAKE_SUGGEST = `window.__sug = { calls: [], contexts: [] };
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method, args) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    window.__sug.calls.push(method);
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok' });
    if (method === 'judge') return Promise.resolve({ engine: 'gemini-nano', ms: 40, result: '{"intent":"trip","states":[]}' });
    if (method === 'suggest') {
      window.__sug.contexts.push(args.context);
      const after = /剛剛問：/.test(args.context);
      const list = after ? ['捷運現在多久一班？', '台北101附近有藥局嗎？', '從台北101到西門町怎麼去？', '從西門町到台北101怎麼去？', '晚上回程怎麼走？'] : ['明天會下雨嗎？', '附近 YouBike 還有車嗎？', '高鐵台北到台中下一班幾點？', '幫我訂餐廳'];
      return new Promise((res) => setTimeout(() => res({ engine: 'gemini-nano', ms: 300, result: list.map((x, i) => (i + 1) + '. ' + x).join('\\n') }), 300));
    }
    return Promise.resolve({});
  },
};`;

test('動態建議（網頁版）：依情境用規則；查完行程後 chips 與提示都換了；點 chip 直接送出', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.suggest .chip[data-src]');
    const first = await page.locator('.suggest .chip[data-src]').allTextContents();
    const ph0 = await page.getAttribute('.chat-input', 'placeholder');
    assert.match(ph0, /^例如：/);
    assert.equal(await page.getAttribute('.suggest:not(.page-ask)', 'role'), 'group');
    assert.ok(first.length >= 3, first.join('|'));
    let checks = 0;
    page.on('request', (r) => { if (r.url().includes('/api/v1/suggest/check')) checks++; });
    await page.fill('.chat-input', '從西門町到台北101怎麼去');
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    await page.waitForSelector('.suggest.next .next-title');
    const after = await page.locator('.suggest .chip[data-src]').allTextContents();
    assert.notDeepEqual(after, first, `${after} vs ${first}`);
    assert.ok(after.some((x) => /回程|YouBike|公車還要多久|捷運/.test(x)), after.join('|'));
    const ph1 = await page.getAttribute('.chat-input', 'placeholder');
    assert.notEqual(ph1, ph0, 'placeholder 跟著換');
    assert.equal(checks, 0, '網頁版只用規則，不驗證也不呼叫模型');
    await page.locator('.suggest .chip.next-ask').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    assert.equal(await page.locator('.msg.user').count(), 2, '點了直接送出');
    assert.equal(await page.locator('.turn').nth(1).locator('.msg.error').count(), 0);
  });
});

test('動態建議（App）：手機上的 AI 回 5 句 → 只出現 3 句且都查得到（丟掉查不到的、跟畫面重複的）；只送句子去驗證；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const checkBodies = [];
    page.on('request', (r) => { if (r.url().includes('/api/v1/suggest/check')) checkBodies.push(JSON.parse(r.postData())); });
    await page.waitForSelector('.suggest .chip[data-src="edge"]');
    assert.ok(!(await page.locator('.suggest .chip').allTextContents()).includes('幫我訂餐廳'), '首次：查不到的不顯示');
    await page.fill('.chat-input', '從西門町到台北101怎麼去');
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.suggest.next .chip[data-src="edge"]')].some((b) => b.textContent === '從台北101到西門町怎麼去？'), null, { timeout: 8000 });
    const edge = await page.locator('.suggest .chip[data-src="edge"]').allTextContents();
    assert.equal(edge.length, 3, edge.join('|'));
    assert.ok(!edge.includes('晚上回程怎麼走？'), '查不到的丟掉');
    assert.ok(!edge.includes('從西門町到台北101怎麼去？'), '跟畫面上的行程重複的丟掉');
    for (const q of edge) { // 每一句都是阿幫查得到的
      const r = await page.request.post(`${base}/api/v1/suggest/check`, { data: { asks: [q] } });
      assert.equal((await r.json()).data[0].ok, true, q);
    }
    assert.equal(await page.getAttribute('.chat-input', 'placeholder'), `例如：${edge[0]}`, 'placeholder 是最可能的那一句');
    // 隱私：驗證只送句子；情境（含剛剛的問題與結果）只給手機上的模型
    assert.ok(checkBodies.length >= 1 && checkBodies.every((b) => Object.keys(b).join() === 'asks'), JSON.stringify(checkBodies));
    const ctxs = await page.evaluate(() => window.__sug.contexts);
    assert.ok(ctxs.some((c) => /剛剛問：從西門町到台北101怎麼去/.test(c)), ctxs.join('\n---\n'));
    assert.ok(ctxs.every((c) => !/\d{2,3}\.\d{3,}/.test(c)), '情境沒有座標');
    await page.locator('.suggest:not(.page-ask)').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-suggest-after-trip.png', SHOTS).pathname });
    await page.locator('.suggest .chip[data-src="edge"]', { hasText: '台北101附近有藥局嗎？' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    assert.match(await page.locator('.msg.user').nth(1).textContent(), /台北101附近有藥局嗎/);
  }, { init: FAKE_SUGGEST, ignore: /not in test/ });
});

test('動態建議：設定關掉「用手機上的 AI 猜」就不呼叫 suggest，改用規則', async () => {
  await withPage(DEVICES.phone, '#/settings', async (page) => {
    await page.waitForSelector('#edge-suggest');
    assert.equal(await page.isChecked('#edge-suggest'), true, '預設開');
    await page.locator('#suggest-row').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.edgeSuggest')), 'off');
    await page.goto(`${base}/#/agent`);
    await page.waitForSelector('.suggest .chip[data-src]');
    await page.waitForTimeout(400);
    assert.ok(!(await page.evaluate(() => window.__sug.calls)).includes('suggest'));
    assert.equal(await page.locator('.suggest .chip[data-src="edge"]').count(), 0);
  }, { init: FAKE_SUGGEST, ignore: /not in test/ });
});

test('動態建議：中央鍵從公車頁拉出對話 → 下車前提醒我排第一、附近還有哪些公車；截圖', async () => {
  await withPage(DEVICES.phone, `#/bus/Taipei/307?stop=${encodeURIComponent('民權二段')}&dir=0`, async (page) => {
    await page.waitForSelector('.bus-focus');
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .suggest .chip[data-src]');
    const labels = await page.locator('#abang-sheet .suggest:not(.page-ask) .chip').allTextContents();
    assert.equal(labels[0], '下車前提醒我', `公車頁：提醒類動作排第一 ${labels.join('|')}`);
    assert.ok(labels.includes('附近還有哪些公車？'), labels.join('|'));
    assert.match(await page.locator('#abang-sheet .page-ask').textContent(), /307/, '這一頁的問題仍在上面那排');
    await page.screenshot({ path: new URL('phone-suggest-bus-page.png', SHOTS).pathname });
    await page.locator('#abang-sheet .suggest .chip', { hasText: '下車前提醒我' }).click();
    await page.waitForFunction(() => /alight=1/.test(location.hash));
  });
});

test('首頁範例問題依時段變（早上通勤 vs 深夜），四個領域都有；截圖', async () => {
  const texts = {};
  for (const [name, iso] of [['morning', '2026-11-18T07:40:00+08:00'], ['night', '2026-11-18T23:30:00+08:00']]) {
    const ctx = await newCtx({ ...DEVICES.phone, reducedMotion: 'reduce' });
    try {
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(iso));
      await page.goto(`${base}/#/`);
      await page.waitForSelector('.hero-ask .chip');
      texts[name] = await page.locator('.hero-ask .chip').allTextContents();
      assert.equal(texts[name].length, 4);
      assert.equal(await page.getAttribute('.hero-ask .chip:has-text("詐騙")', 'href'), '#/agent/antifraud');
      await page.locator('.hero').screenshot({ path: new URL(name === 'morning' ? 'phone-home-dynamic.png' : 'phone-home-dynamic-night.png', SHOTS).pathname });
    } finally {
      await ctx.close();
    }
  }
  assert.notDeepEqual(texts.morning, texts.night);
  assert.ok(texts.night.includes('捷運幾點收班？'), texts.night.join('|'));
});

/** 假的 Android 外掛：原生端一條執行緒排隊（suggest 佔 4 秒，cancelSuggest 才讓出來）；judge 排在佇列後面 */
const FAKE_SERIAL = `window.__q = { calls: [] };
let busy = Promise.resolve(), stop = null;
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    window.__q.calls.push(method);
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok' });
    if (method === 'cancelSuggest') { const had = !!stop; stop?.(); stop = null; return Promise.resolve({ cancelled: had }); }
    if (method === 'suggest') {
      const run = new Promise((res, rej) => { const t = setTimeout(() => { stop = null; res({ engine: 'gemini-nano', result: '明天會下雨嗎？' }); }, 4000); stop = () => { clearTimeout(t); rej(new Error('cancelled')); }; });
      busy = run.catch(() => {});
      return run;
    }
    if (method === 'judge') return busy.then(() => ({ engine: 'gemini-nano', ms: 40, result: '{"intent":"trip","states":[]}' }));
    return Promise.resolve({});
  },
};`;

test('動態建議：建議產生中送出問題 → 先取消手機上的 suggest，judge 不排在後面（deviceJudge 有帶到）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/v1/agent') && r.method() === 'POST') bodies.push(JSON.parse(r.postData())); });
    await page.waitForFunction(() => window.__q.calls.includes('suggest'));
    await page.fill('.chat-input', '從西門町到台北101怎麼去');
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const calls = await page.evaluate(() => window.__q.calls);
    assert.ok(calls.indexOf('cancelSuggest') > -1 && calls.indexOf('cancelSuggest') < calls.indexOf('judge'), calls.join(','));
    assert.deepEqual(bodies[0].deviceJudge, { intent: 'trip', states: [], engine: 'gemini-nano' }, 'judge 沒有因為排在 suggest 後面而逾時');
    assert.equal(await page.locator('.msg.error').count(), 0);
  }, { init: FAKE_SERIAL, ignore: /not in test/ });
});

// 長對話（UX.md §4.17，2026-11-21 PM）：舊的輪收成一行、換話題分隔線、「這次問過」目錄、回到最新、提醒頁回到當時的對話、底部對話面板一樣收合
test('長對話：連問 5 題只有最新一輪展開、換話題分段、目錄、回到最新、提醒頁看當時的對話、底部面板', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const qs = ['從西門町到台北101怎麼去', '307 到哪了？', '現在天氣如何', '附近空氣品質', '這期發票號碼是多少？'];
    for (const [i, q] of qs.entries()) {
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
      // 送出後自動捲到最新一輪（reduced motion：直接跳、不平滑）
      await page.waitForFunction((n) => { const r = document.querySelector(`.round[data-round="${n}"]`).getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2; }, i + 1, { timeout: 3000 });
    }
    await page.waitForFunction(() => document.querySelectorAll('.round.folded').length === 4);
    const rounds = page.locator('.chat .round');
    assert.equal(await rounds.count(), 5);
    assert.equal(await rounds.nth(4).evaluate((r) => r.classList.contains('folded')), false, '最新一輪完整展開');
    assert.equal(await rounds.nth(4).locator('.round-sum').isVisible(), false, '最新一輪沒有摘要列');
    assert.ok(await rounds.nth(4).locator('[data-card="invoice"]').isVisible());
    // 舊的每一輪是一行摘要按鈕（讀屏：第 N 輪：…，已收起）；決策圖、卡片收起，只留「決定：…」小標
    const first = rounds.nth(0).locator('.round-sum');
    assert.match(await first.getAttribute('aria-label'), /^第 1 輪：西門町到台北101，.+ \d+ 分，已收起$/);
    assert.equal(await first.getAttribute('aria-expanded'), 'false');
    assert.match(await first.locator('.rs-tag').textContent(), /^決定：/);
    assert.equal(await rounds.nth(0).locator('.decision').isVisible(), false, '收起的輪不顯示決策圖');
    assert.match(await rounds.nth(1).locator('.round-sum').textContent(), /^307：/);
    assert.match(await rounds.nth(2).locator('.round-sum').textContent(), /^天氣：.+°C/);
    assert.match(await rounds.nth(3).locator('.round-sum').textContent(), /^空品：.+AQI \d+/);
    assert.ok((await first.boundingBox()).height >= 44, '摘要按鈕夠大');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'phone-chat-collapsed');
    // 換話題：行程 → 公車（交通同一類，不分）→ 天氣 → 空品（天氣同一類，不分）→ 發票
    const seps = page.locator('.chat .topic-sep[role=separator]');
    assert.equal(await seps.count(), 2, await page.locator('.chat .topic-sep + .round').evaluateAll((rs) => rs.map((r) => r.dataset.round + r.textContent.slice(0, 30)).join(' / ')));
    assert.equal(await page.locator('.chat .topic-sep + .round').evaluateAll((rs) => rs.map((r) => r.dataset.round).join()), '3,5', '分段在天氣、發票前面');
    assert.match(await seps.first().textContent(), /^新的話題・\d{2}:\d{2}$/);
    assert.match(await seps.first().getAttribute('aria-label'), /^新的話題，\d{2}:\d{2}$/);
    await seps.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-chat-topic.png', SHOTS).pathname }); // 畫面內（不是整頁）：看得到分隔線與前後的摘要
    // 點摘要展開、再點收起（鍵盤也可以）；展開時決策圖照舊
    await first.click();
    assert.equal(await first.getAttribute('aria-expanded'), 'true');
    assert.match(await first.getAttribute('aria-label'), /已展開$/);
    assert.ok(await rounds.nth(0).locator('.decision .dg-svg').isVisible(), '展開時決策圖照舊');
    await first.focus();
    await page.keyboard.press('Enter');
    assert.equal(await first.getAttribute('aria-expanded'), 'false', '鍵盤 Enter 收起');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('round-sum')), true, '焦點留在摘要按鈕');
    // 「這次問過」目錄（超過 3 輪；nav 有名稱）：點了捲到那一輪並展開，焦點在那一輪的摘要
    const nav = page.getByRole('navigation', { name: '這次問過' });
    assert.ok(await nav.isVisible());
    assert.deepEqual(await nav.locator('.ci-item').allTextContents(), ['台北101', '307', '天氣', '空品', '發票']);
    await page.evaluate(() => window.scrollTo(0, 0));
    const toLatest = page.getByRole('button', { name: '回到最新的對話' });
    await toLatest.waitFor();
    await page.screenshot({ path: new URL('phone-chat-index.png', SHOTS).pathname }); // 畫面內：頂端目錄＋右下「回到最新」
    await nav.locator('.ci-item', { hasText: '307' }).click();
    const bus = rounds.nth(1);
    assert.equal(await bus.locator('.round-sum').getAttribute('aria-expanded'), 'true');
    assert.ok(await bus.locator('[data-card="bus-route"]').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.round')?.dataset.round), '2', '焦點在那一輪');
    assert.ok(await bus.evaluate((r) => { const t = r.getBoundingClientRect().top; return t >= 0 && t < innerHeight / 2; }), '捲到那一輪');
    // 在那一輪設到站提醒 → 提醒頁那一筆「看當時的對話」→ 回到問阿幫、那一輪展開
    await bus.locator('[data-card="bus-route"] .ab-btn', { hasText: '到站前 3 分提醒我' }).click();
    await bus.locator('.round-sum').click();
    assert.equal(await bus.evaluate((r) => r.classList.contains('folded')), true);
    await page.goto(`${base}/#/reminders`);
    const link = page.locator('.rem-row[data-kind="arrival"] .rem-chat');
    assert.equal(await link.textContent(), '看當時的對話 ›');
    assert.equal(await link.getAttribute('href'), '#/agent?turn=2');
    await link.click();
    await page.waitForFunction(() => document.querySelector('.round[data-round="2"]') && !document.querySelector('.round[data-round="2"]').classList.contains('folded'));
    await page.waitForFunction(() => document.activeElement?.closest('.round')?.dataset.round === '2');
    assert.match(page.url(), /#\/agent$/, '網址換回 #/agent（重新整理不會再跳）');
    // 回到最新：按了捲到最新一輪
    await page.evaluate(() => window.scrollTo(0, 0));
    await toLatest.waitFor();
    await toLatest.click();
    await page.waitForFunction(() => document.querySelector('.to-latest').hidden);
    // 底部對話面板（其他頁打開）：同一段對話一樣收合；目錄只在整頁
    await page.goto(`${base}/#/`);
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .round');
    assert.ok(await page.locator('#abang-sheet .round.folded').count() >= 3, '面板裡舊的輪也收成一行');
    assert.equal(await page.locator('#abang-sheet .round').last().evaluate((r) => r.classList.contains('folded')), false);
    assert.equal(await page.locator('#abang-sheet .chat-index').isVisible(), false, '面板空間小：不顯示目錄');
    // 新的一輪在面板裡問：前一輪收起
    await page.fill('#abang-sheet .chat-form input', '台積電股價');
    await page.press('#abang-sheet .chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#abang-sheet .bubble.final').length === 6, null, { timeout: 20000 });
    assert.equal(await page.locator('#abang-sheet .round').nth(4).evaluate((r) => r.classList.contains('folded')), true);
    assert.match(await page.locator('#abang-sheet .round').nth(4).locator('.round-sum').textContent(), /^發票：/);
  });
});

test('長對話：動畫開著時前一輪平順收起（不留中間狀態）、收起的決策圖停止光點', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    for (const [i, q] of ['從西門町到台北101怎麼去', '307 到哪了？'].entries()) {
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.bubble.final').length === n, i + 1, { timeout: 20000 });
      if (!i) await page.waitForFunction(() => document.querySelector('.decision .dg-edge.win.flow'), null, { timeout: 8000 });
    }
    await page.waitForFunction(() => document.querySelector('.round').classList.contains('folded') && !document.querySelector('.round.folding'));
    assert.equal(await page.locator('.round').first().evaluate((r) => r.style.overflow), '', '動畫結束後不留 overflow');
    assert.equal(await page.locator('.round.folded .dg-flow-dot').count(), 0, '收起的決策圖沒有光點在跑');
    await page.locator('.round-sum').first().click();
    await page.waitForFunction(() => !document.querySelector('.round').classList.contains('folded'));
    await page.waitForFunction(() => document.querySelector('.round .dg-edge.win.flow'));
  }, { motion: true });
});

// 判斷看得到（2026-11-21 PM 回饋「會看天氣空品，但都只顯示詢問定位」）：行程比較用到的天氣、空品、路況逐項說明＋影響；
// 決策圖資料欄每個來源一個節點（值、影響、查不到）；只剩一種方式時說原因並給換條件的建議
/** 模擬模型模式：拿掉示範模式另外查的天氣、空品、路況（模型模式只呼叫行程比較），討論串只能靠 data_note 說明 */
const ONLY_PLAN_TRIP = async (route) => {
  if (route.request().method() !== 'POST') return route.fallback();
  const res = await route.fetch();
  const drop = new Set();
  const lines = (await res.text()).split('\n').filter((l) => {
    if (!l.trim()) return false;
    const e = JSON.parse(l);
    if (e.type === 'agent_note' && /@天氣 @空品 @路況/.test(e.text)) return false;
    if (e.type === 'tool_start' && ['weather_now', 'aqi_nearby', 'traffic_status'].includes(e.name)) { drop.add(e.id); return false; }
    return !(e.type === 'tool_result' && drop.has(e.id));
  });
  return route.fulfill({ response: res, body: `${lines.join('\n')}\n` });
};

test('問阿幫：判斷看得到——討論串逐項說天氣、空品、路況的影響；決策圖資料欄有節點', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.route('**/api/v1/agent', ONLY_PLAN_TRIP);
    await page.fill('.chat-form input', '去台北 101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    const notes = page.locator('.thread .bubble.data-note');
    assert.equal(await notes.count(), 3, '天氣、空品、路況各一行');
    for (const [role, re] of [['天氣', /°C，3 小時降雨 \d+%/], ['空品', /測站 AQI \d+/]]) {
      const b = page.locator(`.thread .bubble.data-note[data-role="${role}"]`);
      assert.equal(await b.count(), 1, `@${role} 一行`);
      assert.match(await b.locator('.say').textContent(), re);
      assert.match(await b.locator('.impact').textContent(), /→\S+/, `@${role} 有影響說明`);
      assert.match(await b.locator('.src').textContent(), /示範資料/);
    }
    // 資料排在行程結論前面
    const order = await page.evaluate(() => [...document.querySelectorAll('.thread .bubble.tool')].map((b) => b.dataset.role));
    assert.ok(order.indexOf('天氣') < order.indexOf('行程') && order.indexOf('路況') < order.indexOf('行程'), order.join(','));
    // 決策圖資料欄：每個來源一個節點，帶值與影響
    const dg = page.locator('.decision');
    await dg.locator('.dg-svg').waitFor();
    for (const role of ['天氣', '空品', '路況']) assert.equal(await dg.locator(`.dg-src[data-role="${role}"]`).count(), 1, `資料欄有 ${role}`);
    assert.match(await dg.locator('.dg-src[data-role="空品"] .dg-val').textContent(), /AQI \d+/);
    assert.equal(await dg.locator('.dg-src[data-role="天氣"] .dg-eff').textContent(), '不影響');
    assert.ok(await dg.locator('.dg-src.quiet').count() >= 1, '不影響的來源淡色');
    await page.locator('.thread-sum').first().click();
    await page.locator('.thread.open').waitFor();
    await page.locator('.thread .bubble.agent', { hasText: '@地點' }).evaluate((n) => n.scrollIntoView({ block: 'start' })); // 從找地點到天氣、空品、路況、行程結論
    await page.screenshot({ path: new URL('phone-reasoning-thread.png', SHOTS).pathname });
    await page.setViewportSize({ width: 390, height: 1800 }); // 決策圖整張（不被固定在底部的輸入列蓋住）
    await dg.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await dg.screenshot({ path: new URL('phone-reasoning-graph.png', SHOTS).pathname });
  });
});

test('問阿幫：天氣小幫手比行程晚回報時，data_note 也不重複（tool_start 就記下角色）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.route('**/api/v1/agent', async (route) => { // 模擬平行查詢：weather_now 的結果晚於 plan_trip 的 data_note 才到
      if (route.request().method() !== 'POST') return route.fallback();
      const res = await route.fetch();
      const lines = (await res.text()).split('\n').filter((l) => l.trim());
      const ev = lines.map((l) => JSON.parse(l));
      const wid = ev.find((e) => e.type === 'tool_start' && e.name === 'weather_now')?.id;
      const wi = ev.findIndex((e) => e.type === 'tool_result' && e.id === wid);
      if (wi < 0) return route.fulfill({ response: res, body: `${lines.join('\n')}\n` });
      const [late] = lines.splice(wi, 1);
      const last = lines.map((l) => JSON.parse(l)).findLastIndex((e) => e.type === 'data_note');
      lines.splice(last + 1, 0, late);
      return route.fulfill({ response: res, body: `${lines.join('\n')}\n` });
    });
    await page.fill('.chat-form input', '去台北 101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    assert.equal(await page.locator('.thread .bubble.tool[data-role="天氣"]').count(), 1, '天氣只講一次');
    assert.equal(await page.locator('.thread .bubble.data-note').count(), 0, '示範模式三個角色都另外查過');
    assert.match(await page.locator('.thread .bubble.tool[data-role="天氣"] .say').textContent(), /°C/);
  });
});

test('問阿幫：在示範範圍外、深夜只剩叫車——說明原因、空品查不到照實說、給換條件的建議', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-form input', '晚上 11 點半去台北101');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    const dg = page.locator('.decision');
    await dg.locator('.dg-svg').waitFor();
    assert.equal(await dg.locator('.dg-opt:not(.excluded)').count(), 1, '只有叫車（沒列入的方式另外畫成灰色）');
    assert.match(await dg.locator('.dg-single').textContent(), /^只找到叫車一種方式：距離 \d+(\.\d)? 公里，走路、YouBike、公車都太遠.*示範資料/);
    assert.ok(await dg.locator('.dg-src').count() >= 3, '資料欄不是空的');
    assert.match(await page.locator('.bubble.final .say').textContent(), /只找到叫車一種方式/);
    const chips = page.locator('.suggest .chip.next-ask');
    assert.match((await chips.allTextContents()).join('|'), /改從台北車站出發比較看看/);
    await page.locator('.bubble.final').scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-reasoning-far.png', SHOTS).pathname });
    // 點建議＝送出那一句，從台北車站就比得到好幾種方式
    await chips.filter({ hasText: '改從台北車站出發比較看看' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    assert.match(await page.locator('.msg.user').last().textContent(), /從台北車站到台北101怎麼去/);
    assert.ok(await page.locator('.decision').last().locator('.dg-opt').count() >= 3);
  }, { geo: { latitude: 24.99, longitude: 121.31 } }); // 桃園（26 公里外）
});

// ───── 健康與運動（ADR-0018）：天氣好又動得少時建議去走走；健康資料只在手機上 ─────
const HEALTH_TIME = new Date('2026-11-22T15:00:00+08:00'); // 白天：示範天氣 25°C、降雨 10%、AQI 58
const HEALTH_ON = () => { try { localStorage.setItem('abang.health', 'on'); } catch { /* 無痕 */ } };
/** 假外掛 AbangHealth（手機 App）：o.status、o.request 是外掛回報；o.steps 今天的步數 */
const FAKE_HEALTH = (o = {}) => `(() => {
  const o = ${JSON.stringify(o)};
  const H = (window.__health = { calls: [] });
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => o.platform || 'android',
    isPluginAvailable: (n) => n === 'AbangHealth' || n === 'AbangSystem',
    addListener: () => ({ remove() {} }),
    nativePromise: (plugin, method, args) => {
      if (plugin !== 'AbangHealth') return Promise.reject(new Error('not in test'));
      H.calls.push(method + (args && args.target ? ':' + args.target : ''));
      if (method === 'status') return Promise.resolve(o.status || { available: true, permission: 'prompt', source: 'health-connect' });
      if (method === 'requestPermission') return Promise.resolve(o.request || { available: true, permission: 'granted', source: 'health-connect' });
      if (method === 'summary') return Promise.resolve({ source: 'health-connect', days: [{ date: '2026-11-22', steps: o.steps ?? 1500, exerciseMin: 0, dataOrigin: 'com.example.fit' }] });
      return Promise.resolve({});
    },
  };
})();`;
/** 送到伺服器的請求內容（檢查健康資料沒有送出） */
const postBodies = (page) => {
  const bodies = [];
  page.on('request', (r) => { if (r.url().includes('/api/') && r.method() === 'POST') bodies.push(r.postData() || ''); });
  return bodies;
};
const dropToasts = (page) => page.evaluate(() => document.querySelectorAll('body > div[role="status"]').forEach((n) => n.remove())); // 截圖前拿掉提示
const noHealthIn = (bodies) => { for (const b of bodies) assert.ok(!/health|steps|exerciseMin|步數|1,?600|動得少|二二八/i.test(b), `請求裡沒有健康資料：${b.slice(0, 200)}`); };

test('健康與運動：首頁「現在」散步小卡（地點＋時間）、今天不用就收起到明天；示範資料標示範；截圖', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    const bodies = postBodies(page);
    await page.reload();
    const card = page.locator('#move .move-card');
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getAttribute('data-kind'), 'go');
    assert.equal(await card.locator('b').first().textContent(), '去走走吧');
    assert.match(await card.locator('p').textContent(), /^天氣好、AQI \d+，今天才走 1,600 步，這 7 天運動 70 分鐘；走到二二八和平紀念公園約 1\d 分。$/);
    assert.match(await card.locator('.mv-note').textContent(), /示範資料，不是你的步數・步數只在手機上看，不上傳/);
    assert.equal(await card.locator('.tag.demo').count(), 1);
    assert.equal(await card.locator('button[data-act="nav"]').textContent(), '走到二二八和平紀念公園');
    await page.locator('.now').evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: new URL('phone-health-home.png', SHOTS).pathname });
    noHealthIn(bodies);
    // 今天不用：收起，重新整理也不出現（只記日期與旗標，不記步數）
    await card.locator('button[data-act="off"]').click();
    assert.ok(await page.locator('#move').isHidden());
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('abang.healthDay'))), { d: '2026-11-22', off: true });
    await page.reload();
    await page.waitForSelector('.now-item[data-now="weather"]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#move .move-card').count(), 0);
    // 隔天：又出現
    await page.clock.setFixedTime(new Date('2026-11-23T15:00:00+08:00'));
    await page.reload();
    await page.locator('#move .move-card').waitFor({ timeout: 15000 });
  }, { init: HEALTH_ON });
});

test('健康與運動：問「我要不要去運動」→ 回答下面在手機上補一句（不進對話紀錄、請求沒有健康資料）；建議過就不再主動提；問天氣用首頁查過的空品補；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    const bodies = postBodies(page);
    await page.reload();
    await page.fill('.chat-form input', '我要不要去運動');
    await page.press('.chat-form input', 'Enter');
    const say = page.locator('.bubble.health-say');
    await say.waitFor({ timeout: 20000 });
    assert.equal(await say.getAttribute('data-kind'), 'go');
    assert.match(await say.locator('.say').textContent(), /^天氣好、AQI \d+，今天才走 1,600 步，這 7 天運動 70 分鐘；走到二二八和平紀念公園約 1\d 分。$/);
    assert.match(await say.locator('.hs-note').textContent(), /步數只在手機上看，不上傳，也沒有跟問題一起送出/);
    assert.equal(await say.locator('.hs-acts button').count(), 2);
    await page.waitForTimeout(400);
    await say.evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: new URL('phone-health-agent.png', SHOTS).pathname });
    assert.ok(!/1,600|二二八/.test(await page.evaluate(() => localStorage.getItem('abang.chat') || '')), '補的那一句不存進對話');
    // 接著問出門：今天已經建議過，不再主動提；下一個請求也沒有那一句
    await page.fill('.chat-form input', '出門要注意什麼？');
    await page.press('.chat-form input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.bubble.health-say').count(), 1, '一天主動提一次');
    assert.ok(bodies.length >= 2);
    noHealthIn(bodies);
  }, { init: HEALTH_ON });
  // 只問天氣（沒有空品）：用首頁「現在」查過的空品補，主動提一次
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    await page.reload();
    await page.locator('#move .move-card').waitFor({ timeout: 15000 });
    await page.click('#abang-fab');
    const sheet = page.locator('#abang-sheet[open]');
    await sheet.locator('.chat-form input').fill('會下雨嗎？');
    await sheet.locator('.chat-form input').press('Enter');
    await sheet.locator('.bubble.health-say').waitFor({ timeout: 20000 });
    assert.match(await sheet.locator('.bubble.health-say .say').textContent(), /^天氣好、AQI \d+，今天才走/);
  }, { init: HEALTH_ON });
});

test('健康與運動：預設關閉——首頁沒有小卡、問阿幫不提；設定頁打開（網頁版示範）→ 出現；「我的」關掉 → 不出現；截圖設定', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    await page.reload();
    await page.waitForSelector('.now-item[data-now="weather"]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#move .move-card').count(), 0, '預設關閉');
    await page.goto(`${base}/#/agent?q=${encodeURIComponent('我要不要去運動')}`);
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.bubble.health-say').count(), 0, '關著不提');
    // 設定頁：開關預設關、說明寫清楚；打開（網頁版不跳權限、用示範資料）
    await page.goto(`${base}/#/settings`);
    const sw = page.locator('#health');
    await sw.waitFor();
    assert.equal(await sw.isChecked(), false);
    await page.waitForFunction(() => /網頁版打開會用示範資料/.test(document.querySelector('#health-status')?.textContent || ''));
    assert.match(await page.textContent('#health-note'), /不上傳、不存起來、不會跟問題一起送出/);
    await sw.click();
    await page.waitForFunction(() => localStorage.getItem('abang.health') === 'on');
    assert.match(await page.textContent('#health-status'), /網頁版：用示範資料/);
    await dropToasts(page);
    await page.locator('#health-card').scrollIntoViewIfNeeded();
    await page.locator('#health-card').screenshot({ path: new URL('phone-health-settings.png', SHOTS).pathname });
    assert.match(await page.textContent('.local'), /天氣好又動得少時建議去走走/);
    await page.goto(`${base}/#/`);
    await page.locator('#move .move-card').waitFor({ timeout: 15000 });
    // 「我的」頁也有同一個開關：關掉 → 首頁不出現
    await page.goto(`${base}/#/me`);
    const meSw = page.locator('#me-health-sw');
    await meSw.waitFor();
    await page.waitForFunction(() => /網頁版：用示範資料/.test(document.querySelector('#me-health-sw-status')?.textContent || ''));
    assert.equal(await meSw.isChecked(), true);
    await meSw.click();
    await page.waitForFunction(() => localStorage.getItem('abang.health') === null);
    await page.goto(`${base}/#/`);
    await page.waitForSelector('.now-item[data-now="weather"]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#move .move-card').count(), 0);
  });
});

test('健康與運動（App）：第一次打開才跳權限；被拒 → 開關關著、說原因、到 Health Connect 允許；沒有 Health Connect → 反白、到 Play 商店；達標只給一句鼓勵', async () => {
  await withPage(DEVICES.phone, '#/settings', async (page) => {
    const sw = page.locator('#health');
    await sw.waitFor();
    await page.waitForFunction(() => /打開時才會請你允許/.test(document.querySelector('#health-status')?.textContent || ''));
    assert.ok(!(await page.evaluate(() => window.__health.calls)).includes('requestPermission'), '還沒打開不問權限');
    await sw.click();
    await page.waitForSelector('#health-why:not([hidden])');
    assert.equal(await sw.isChecked(), false, '被拒：開關關著');
    assert.match(await page.textContent('#health-why'), /你沒有允許阿幫讀取步數和運動時間/);
    assert.ok((await page.evaluate(() => window.__health.calls)).includes('requestPermission'));
    await page.click('button:has-text("到 Health Connect 允許")');
    assert.ok((await page.evaluate(() => window.__health.calls)).includes('openSettings:manage'), '只開畫面，允許由使用者自己按');
    assert.equal(await page.evaluate(() => localStorage.getItem('abang.health')), null);
    await dropToasts(page);
    await page.locator('#health-card').scrollIntoViewIfNeeded();
    await page.locator('#health-card').screenshot({ path: new URL('phone-health-denied.png', SHOTS).pathname });
  }, { init: FAKE_HEALTH({ request: { available: true, permission: 'denied', source: 'health-connect' } }), ignore: /not in test/ });
  await withPage(DEVICES.phone, '#/settings', async (page) => {
    const sw = page.locator('#health');
    await page.waitForFunction(() => /不能使用：/.test(document.querySelector('#health-status')?.textContent || ''));
    assert.equal(await sw.getAttribute('aria-disabled'), 'true');
    assert.ok(await sw.evaluate((n) => n.classList.contains('unavailable') && !n.disabled), '反白但仍可按');
    assert.match(await page.textContent('#health-why'), /還沒有 Health Connect/);
    await sw.click({ force: true });
    assert.equal(await sw.isChecked(), false, '按了也不打開，只說原因');
    assert.ok(!(await page.evaluate(() => window.__health.calls)).includes('requestPermission'));
    await page.click('button:has-text("到 Play 商店安裝 Health Connect")');
    assert.ok((await page.evaluate(() => window.__health.calls)).includes('openSettings:install'));
  }, { init: FAKE_HEALTH({ status: { available: false, reason: 'not-installed' } }), ignore: /not in test/ });
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    await page.reload();
    const card = page.locator('#move .move-card');
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getAttribute('data-kind'), 'cheer');
    assert.equal(await card.locator('p').textContent(), '今天走了 8,200 步，達標了，很棒！');
    assert.equal(await card.locator('button[data-act="nav"]').count(), 0, '達標不推');
    assert.equal(await card.locator('.tag.demo').count(), 0, '手機上的真資料不標示範');
  }, { init: `${FAKE_HEALTH({ status: { available: true, permission: 'granted', source: 'health-connect' }, steps: 8200 })};localStorage.setItem('abang.health','on');`, ignore: /not in test/ });
});

// ── 短劇（MyDrama，ADR-0019）──
/** 示範到站時間隨時間變：先找一個「現在還要等 8～14 分」的公車站，問阿幫時才一定會推短劇 */
async function waitingStop() {
  const call = (a) => fetch(`${base}/api/v1/tools/bus_route_eta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ city: 'Taipei', ...a }) }).then((x) => x.json());
  for (const routeName of ['307', '299', '601', '262', '235', '651', '藍5', '紅30']) {
    const r = await call({ routeName });
    for (const s of r.data.directions.flatMap((d) => d.stops)) {
      if (s.status !== 0 || !(s.etaSec >= 480 && s.etaSec <= 840)) continue;
      const f = (await call({ routeName, stop: s.stopName })).data.focus; // 同名站兩個方向都有時，以盯站的結果為準
      if (f?.status === 0 && f.etaSec >= 480) return { routeName, stop: s.stopName };
    }
  }
  throw new Error('示範資料找不到要等 8 分以上的公車站');
}

test('等車推短劇：公車還要等 8 分以上 → 到站卡片下方一行短劇提示（看這集、不用了）；設定關掉就不出現', async () => {
  const { routeName, stop } = await waitingStop();
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-input', `${routeName} 公車到「${stop}」還要多久`);
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    const hint = page.locator('.drama-hint');
    await hint.waitFor();
    assert.equal(await hint.count(), 1, '一輪最多一次');
    // 接在公車卡片正下方；回答文字還是講公車（交通資訊是主角）
    assert.equal(await page.evaluate(() => document.querySelector('.drama-hint').previousElementSibling?.querySelector('[data-card]')?.dataset.card), 'bus-route');
    assert.match(await hint.locator('.dh-say').textContent(), /^等車還要 \d+ 分，剛好夠看一集短劇：《.+》第 1 集/);
    assert.doesNotMatch(await page.locator('.bubble.final .say').textContent(), /短劇/);
    assert.deepEqual(await hint.locator('button').allTextContents(), ['看這集', '不用了']);
    assert.match(await hint.locator('.dh-note').textContent(), /設定裡可以關掉/);
    await hint.scrollIntoViewIfNeeded();
    await page.screenshot({ path: new URL('phone-drama-wait.png', SHOTS).pathname });
    await hint.getByRole('button', { name: '不用了' }).click();
    await hint.waitFor({ state: 'detached' });
  });
  // 設定關掉：同一句不再推（伺服器也收到 dramaHint: false）
  await withPage(DEVICES.phone, '#/settings', async (page) => {
    const sw = page.locator('#drama-hint');
    assert.equal(await sw.isChecked(), true, '預設開');
    await page.locator('#drama-card').scrollIntoViewIfNeeded();
    await page.locator('#drama-card').screenshot({ path: new URL('phone-drama-setting.png', SHOTS).pathname });
    await sw.uncheck();
    await page.goto(`${base}/#/agent`);
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/v1/agent') && r.method() === 'POST');
    await page.fill('.chat-input', `${routeName} 公車到「${stop}」還要多久`);
    await page.press('.chat-input', 'Enter');
    const body = JSON.parse((await sent).postData());
    assert.equal(body.userState?.dramaHint, false);
    assert.ok(Number.isInteger(body.turn) && body.turn >= 1, '送這段對話第幾輪（輪替用）');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    await page.locator('.results [data-card="bus-route"]').waitFor();
    assert.equal(await page.locator('.drama-hint').count(), 0);
  });
});

for (const [dname, device] of Object.entries(DEVICES)) {
  test(`${dname}：問「推薦一部短劇」→ 短劇卡片（排行、集數、免費集數、在 MyDrama 看、看簡介、熱搜）`, async () => {
    await withPage(device, '#/agent', async (page) => {
      await page.fill('.chat-input', '推薦一部短劇');
      await page.press('.chat-input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      const card = page.locator('.results [data-card="drama"]');
      await card.waitFor();
      assert.match(await card.locator('.ab-title').textContent(), /短劇・熱門排行/);
      assert.equal(await card.locator('.ab-drama').count(), 5);
      assert.match(await card.locator('.ab-drama').first().textContent(), /《夜班公車的約定》.*共 60 集・前 10 集免費・已完結/);
      assert.equal(await card.locator('.ab-drama-watch').first().textContent(), '在 MyDrama 看');
      assert.match(await page.locator('.bubble.final .say').textContent(), /熱門排行前 3 名/);
      assert.equal(await card.locator('.ab-badge.ab-demo').count(), 1, '示範資料有標示');
      // 在 MyDrama 看：開 App 連結（攔下導頁）＋沒離開畫面就開商店頁
      await page.evaluate(() => {
        window.__opened = [];
        window.open = (u) => { window.__opened.push(u); return {}; }; // 回傳視窗＝沒被擋
      });
      await card.locator('.ab-drama-watch').first().click();
      await page.waitForFunction(() => window.__opened.length === 1, null, { timeout: 5000 });
      assert.match((await page.evaluate(() => window.__opened))[0], /^https:\/\/example\.com\/drama-(ios|android)$/);
      // 看簡介：展開完整簡介（drama_series）
      const first = card.locator('.ab-drama').first();
      await first.getByRole('button', { name: '看簡介' }).click();
      await first.locator('.ab-drama-syn.open').waitFor();
      await card.scrollIntoViewIfNeeded();
      await shot(page, `${dname}-drama-card`);
      // 熱搜：點「懸疑」→ 卡片換成搜尋結果
      await card.locator('.ab-drama-kw .ab-tab', { hasText: '懸疑' }).click();
      await page.waitForFunction(() => /找「懸疑」的短劇/.test(document.querySelector('.results [data-card="drama"] .ab-title')?.textContent || ''));
      assert.ok(await card.locator('.ab-drama').count() >= 2);
    }, { ignore: /example-drama|ERR_UNKNOWN_URL_SCHEME|Failed to launch/ });
  });
}

test('問「有沒有甜寵劇」→ 搜尋卡片；問劇名劇情 → 簡介卡片', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.fill('.chat-input', '有沒有甜寵劇');
    await page.press('.chat-input', 'Enter');
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    const card = page.locator('.results [data-card="drama"]').last();
    assert.match(await card.locator('.ab-title').textContent(), /找「甜寵」的短劇/);
    assert.ok((await card.locator('.ab-chip').allTextContents()).includes('甜寵'));
    await page.fill('.chat-input', '《捷運末班車》在演什麼');
    await page.press('.chat-input', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    const syn = page.locator('.results [data-card="drama"]').last();
    await syn.waitFor();
    assert.match(await syn.locator('.ab-title').textContent(), /短劇簡介/);
    assert.match(await page.locator('.bubble.final .say').last().textContent(), /簡介：每晚末班車開走後/);
  });
});

test('問阿幫：深夜 00:10 去台北101——第一句說公車和捷運收班、卡片與決策圖列出沒列入的原因（中、英）', async () => {
  const night = await startServer({ DEMO_CLOCK: '00:10' }); // 示範時鐘：現在固定為今天 00:10
  try {
    await withPage(DEVICES.phone, '#/agent', async (page) => {
      await page.fill('.chat-form input', '去台北101');
      await page.press('.chat-form input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(await page.locator('.bubble.final .say').textContent(), /^現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車。/, '回答第一句就說');
      const says = await page.locator('.thread .bubble.tool .say').allTextContents();
      assert.ok(says.some((x) => /^現在 00:10，公車和捷運都收班了.*；建議/.test(x)), `行程小幫手第一句：${says.join('|')}`);
      // 卡片：第一行深夜說明、沒列入清單（公車、捷運各一行原因）
      const card = page.locator('.results [data-card="trip"]').first();
      assert.match(await card.locator('.ab-night').textContent(), /^現在 00:10，公車和捷運都收班了/);
      const notIn = await card.locator('.ab-skipped li').allTextContents();
      assert.ok(notIn.some((x) => /^公車沒列入：深夜多數公車已收班/.test(x)), notIn.join('|'));
      assert.ok(notIn.some((x) => x === '捷運沒列入：捷運已收班（約 06:00 首班）'), notIn.join('|'));
      // 決策圖：公車、捷運畫成灰色節點、標「收班」，圖下寫原因
      const dg = page.locator('.decision');
      await dg.locator('.dg-svg').waitFor();
      for (const id of ['skip-bus', 'skip-metro']) assert.equal(await dg.locator(`.dg-opt.excluded[data-id="${id}"] .dg-score`).textContent(), '收班', id);
      assert.match(await dg.locator('.dg-opt[data-id="skip-metro"]').getAttribute('aria-label'), /^捷運，沒列入：捷運已收班（約 06:00 首班）$/);
      assert.ok((await dg.locator('.dg-missing li').allTextContents()).includes('捷運沒列入：捷運已收班（約 06:00 首班）'));
      await page.locator('.bubble.final').scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL('phone-trip-night.png', SHOTS).pathname });
      await page.setViewportSize({ width: 390, height: 1800 }); // 決策圖整張
      await dg.evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await dg.screenshot({ path: new URL('phone-trip-night-graph.png', SHOTS).pathname });
      await card.screenshot({ path: new URL('phone-trip-night-card.png', SHOTS).pathname });
    }, { origin: night.base });
    // 英文提問：第一句、卡片、決策圖都是英文原因
    await withPage(DEVICES.phone, '#/agent', async (page) => {
      await page.fill('.chat-form input', 'How do I get to Taipei 101?');
      await page.press('.chat-form input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(await page.locator('.bubble.final .say').textContent(), /^It's 00:10 now: buses and the MRT have stopped for the night \(MRT starts around 06:00\)/);
      const card = page.locator('[data-card="trip"]').first();
      assert.match(await card.locator('.ab-night').textContent(), /^It's 00:10 now/);
      assert.ok((await card.locator('.ab-skipped li').allTextContents()).includes('MRT not included: The MRT has stopped for the night (first train around 06:00)'));
      await page.waitForSelector('.decision .dg-missing');
      assert.doesNotMatch(await page.locator('.decision .dg-missing').textContent(), /[一-鿿]/, '決策圖原因是英文');
      assert.equal(await page.locator('.decision .dg-opt[data-id="skip-metro"]').getAttribute('aria-label'), 'MRT, excluded: The MRT has stopped for the night (first train around 06:00)', '英文讀屏：英文名稱與原因（審查 8）');
      await page.locator('.bubble.final').scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL('phone-trip-night-en.png', SHOTS).pathname });
    }, { origin: night.base });
  } finally {
    night.proc.kill();
  }
});

test('問阿幫：推薦的公車今天沒有營運（盯到站才發現）——排除它重排、卡片與決策圖寫出哪一條、為什麼（中、英）', async () => {
  const srv = await startServer({ DEMO_BUS: 'offLive' }); // 示範：比較快的那條直達公車上車站今日未營運（規劃時看起來正常）
  try {
    await withPage(DEVICES.phone, '#/agent', async (page) => {
      await page.fill('.chat-form input', '我想省錢，從西門町到台北101怎麼去？');
      await page.press('.chat-form input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      const say = await page.locator('.bubble.final .say').textContent();
      assert.match(say, /^公車 601 今天沒有營運（站牌即時資訊），這次不推。選「公車 212」/, say);
      assert.doesNotMatch(say, /選「公車 601」/);
      const says = await page.locator('.thread .bubble.tool .say').allTextContents();
      assert.ok(says.some((x) => x === '601 在「民生捷運站(1號出口)」：今日未營運。'), `盯到的證據在討論串：${says.join('|')}`);
      const card = page.locator('.results [data-card="trip"]').first();
      assert.ok((await card.locator('.ab-skipped li').allTextContents()).includes('公車 601沒列入：今天沒有營運（站牌即時資訊）'));
      const dg = page.locator('.decision');
      await dg.locator('.dg-svg').waitFor();
      assert.equal(await dg.locator('.dg-opt.excluded[data-id="skip-bus-601"]').count(), 1, '決策圖畫出那一條（灰色）');
      assert.ok((await dg.locator('.dg-missing li').allTextContents()).includes('公車 601沒列入：今天沒有營運（站牌即時資訊）'));
      await card.screenshot({ path: new URL('phone-trip-bus-off-card.png', SHOTS).pathname });
    }, { origin: srv.base });
    await withPage(DEVICES.phone, '#/agent', async (page) => {
      await page.fill('.chat-form input', 'I want to save money. How do I get from Ximending to Taipei 101?');
      await page.press('.chat-form input', 'Enter');
      await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
      assert.match(await page.locator('.bubble.final .say').textContent(), /^Bus 601: not running today \(live stop info\), so I left it out\./);
      const card = page.locator('[data-card="trip"]').first();
      assert.ok((await card.locator('.ab-skipped li').allTextContents()).includes('Bus 601 not included: not running today (live stop info)'));
      await page.waitForSelector('.decision .dg-missing');
      assert.ok((await page.locator('.decision .dg-missing li').allTextContents()).includes('Bus 601 not included: not running today (live stop info)'));
    }, { origin: srv.base });
  } finally {
    srv.proc.kill();
  }
});

// PR #109 審查修正（長對話）
const askChat = async (page, q, n) => {
  await page.fill('.chat-form input', q);
  await page.press('.chat-form input', 'Enter');
  await page.waitForFunction((k) => document.querySelectorAll('.bubble.final').length === k, n, { timeout: 20000 });
};
/** 模擬判斷層有開：status 事件帶 intent（E2E 關掉判斷層，這裡依提問補上，重現「status 先到、沿用那句後到」） */
const WITH_INTENT = (map) => async (route) => {
  if (route.request().method() !== 'POST') return route.fallback();
  const body = JSON.parse(route.request().postData() || '{}');
  const last = body.messages?.at(-1)?.content || '';
  const intent = Object.entries(map).find(([k]) => last.includes(k))?.[1];
  const res = await route.fetch();
  const text = (await res.text()).split('\n').map((l) => {
    if (!l.trim() || !intent) return l;
    const e = JSON.parse(l);
    return e.type === 'status' ? JSON.stringify({ ...e, judge: { intent, source: 'rules' } }) : l;
  }).join('\n');
  return route.fulfill({ response: res, body: text });
};

test('長對話審查：接著改（沿用那句在 status 之後才到）不分段；換話題比最近有話題的輪', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.route('**/api/v1/agent', WITH_INTENT({ 西門町: 'trip', 下雨: 'weather', 改搭公車: 'trip', 謝謝: 'unknown', 空氣: 'aqi' }));
    await askChat(page, '從西門町到台北101怎麼去', 1);
    await askChat(page, '那邊會下雨嗎', 2);
    await askChat(page, '改搭公車呢', 3);
    assert.match(await page.locator('.round[data-round="3"] .turn').textContent(), /沿用：/, '第三輪是接著改');
    assert.equal(await page.locator('.round[data-round="3"]').evaluate((r) => r.previousElementSibling?.classList.contains('topic-sep')), false, '接著改：不插分隔線');
    assert.equal(await page.locator('.chat .topic-sep').count(), 1, '只有行程 → 天氣那一條');
    // 行程 → 謝謝 → 空品：謝謝沒有話題，空品跟前面的行程比 → 分段
    await askChat(page, '謝謝', 4);
    await askChat(page, '附近空氣品質', 5);
    assert.equal(await page.locator('.round[data-round="5"]').evaluate((r) => r.previousElementSibling?.classList.contains('topic-sep')), true);
  });
});

test('長對話審查：自動收起時焦點在那一輪裡 → 移到它的摘要按鈕；讀屏先不念剛出現的摘要', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await askChat(page, '現在天氣如何', 1); // 沒有「阿幫問你」的一題（有問題開著時上一輪會先留著）
    await page.locator('.round[data-round="1"] .thread-sum').focus();
    await page.waitForTimeout(5200); // 超過「正在操作」的 5 秒
    const r = await page.evaluate(() => {
      const input = document.querySelector('.chat-form input');
      input.value = '這期發票號碼是多少？';
      document.querySelector('.chat-form').requestSubmit(); // 送出不移動焦點（例如提醒泡泡代問）
      const a = document.activeElement;
      return { folded: document.querySelector('.round[data-round="1"]').classList.contains('folded'), sum: a?.classList.contains('round-sum'), round: a?.closest('.round')?.dataset.round, hidden: a?.getAttribute('aria-hidden') };
    });
    assert.deepEqual(r, { folded: true, sum: true, round: '1', hidden: null }, '焦點移到摘要按鈕，不掉到 body；要放焦點的不藏');
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 2, null, { timeout: 20000 });
    // 沒有焦點的那一輪：摘要剛出現時 aria-hidden，0.8 秒後放出來
    const hidden = await page.evaluate(() => {
      document.querySelector('.chat-form input').value = '台積電股價';
      document.querySelector('.chat-form').requestSubmit();
      return document.querySelector('.round[data-round="2"] .round-sum').getAttribute('aria-hidden');
    });
    assert.equal(hidden, 'true');
    await page.waitForFunction(() => !document.querySelector('.round[data-round="2"] .round-sum').hasAttribute('aria-hidden'));
  });
});

test('長對話審查：收起的輪卡片停止刷新、展開恢復；「接下來可以」設提醒的確認句在那一輪裡；?turn 只收數字、不換掉防詐頁', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await askChat(page, '307 到哪了？我在臺北車站', 1);
    const slot = page.locator('.round[data-round="1"] [data-card="bus-route"]').locator('xpath=ancestor::*[@data-live][1]');
    assert.equal(await slot.getAttribute('data-live'), '1');
    await page.locator('.suggest .chip', { hasText: '到站前 3 分提醒我' }).click();
    await page.waitForSelector('.round[data-round="1"] .agent-sys');
    assert.equal(await page.locator('.chat > .agent-sys').count(), 0, '確認句不在對話最外層');
    await page.waitForTimeout(5200); // 剛按過（正在操作 5 秒）不收
    await askChat(page, '現在天氣如何', 2);
    await page.waitForFunction(() => document.querySelector('.round[data-round="1"]').classList.contains('folded'));
    assert.equal(await slot.getAttribute('data-live'), '0', '收起：停止刷新');
    await page.locator('.round[data-round="1"] .round-sum').click();
    assert.equal(await slot.getAttribute('data-live'), '1', '展開（還在最近兩輪）：恢復刷新');
    // ?turn 不是數字：不動、網址換回來
    await page.goto(`${base}/#/agent?turn=abc`);
    await page.waitForFunction(() => location.hash === '#/agent');
    await page.goto(`${base}/#/agent/antifraud?turn=2`);
    await page.waitForSelector('.chat-form');
    await page.waitForFunction(() => location.hash === '#/agent/antifraud');
    assert.match(await page.textContent('.topbar h1'), /防詐/, '還在防詐頁');
  });
});

test('長對話審查：排隊中的「接下來可以」也算接著問（不分段）', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await askChat(page, '這期發票號碼是多少？', 1);
    // 第二題（天氣）回答慢一點：回答中點上一輪「接下來可以」的「上一期中獎號碼」（排隊）
    await page.route('**/api/v1/agent', async (route) => {
      const last = JSON.parse(route.request().postData() || '{}').messages?.at(-1)?.content || '';
      if (last.includes('天氣')) await new Promise((r) => setTimeout(r, 1500));
      return route.fallback();
    });
    await page.fill('.chat-form input', '現在天氣如何');
    await page.press('.chat-form input', 'Enter');
    await page.locator('.suggest .chip', { hasText: '上一期中獎號碼' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 3, null, { timeout: 20000 });
    assert.match(await page.locator('.round[data-round="3"] .msg.user').textContent(), /上一期/);
    assert.equal(await page.locator('.round[data-round="2"]').evaluate((r) => r.previousElementSibling?.classList.contains('topic-sep')), true, '發票 → 天氣：分段');
    assert.equal(await page.locator('.round[data-round="3"]').evaluate((r) => r.previousElementSibling?.classList.contains('topic-sep')), false, '排隊的「接下來可以」是接著問：不分段');
  });
});

test('長對話審查：動畫開著但低階裝置（lite-motion）收合不播動畫；桌面目錄與對話同寬置中', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await askChat(page, '從西門町到台北101怎麼去', 1);
    await askChat(page, '現在天氣如何', 2);
    await page.waitForFunction(() => document.querySelector('.round').classList.contains('folded') && !document.querySelector('.round.folding'));
    const anims = await page.evaluate(() => {
      document.documentElement.classList.add('lite-motion');
      document.querySelector('.round-sum').click();
      return document.querySelector('.round').getAnimations({ subtree: false }).length;
    });
    assert.equal(anims, 0);
  }, { motion: true });
  await withPage(DEVICES.desktop, '#/agent', async (page) => {
    await page.waitForSelector('.chat-form');
    const [nav, chat] = await page.evaluate(() => [getComputedStyle(document.querySelector('.chat-index')).maxWidth, getComputedStyle(document.querySelector('.chat')).maxWidth]);
    assert.equal(nav, '640px');
    assert.equal(chat, '640px');
  });
});

test('健康與運動：沒有定位——首頁不拿台北車站備用天氣推散步；自己問也不說「天氣好」、不給公園', async () => {
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    await page.reload();
    await page.waitForSelector('.now-item[data-now="weather"]');
    assert.match(await page.textContent('.now-item[data-now="weather"]'), /台北車站附近/);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#move .move-card').count(), 0, '沒有定位不出現');
    await page.goto(`${base}/#/agent?q=${encodeURIComponent('我要不要去運動')}`);
    const say = page.locator('.bubble.health-say');
    await say.waitFor({ timeout: 20000 });
    const t = await say.locator('.say').textContent();
    assert.match(t, /^今天才走 1,600 步/);
    assert.doesNotMatch(t, /天氣好|走到/, `不拿別處的天氣：${t}`);
    assert.equal(await say.locator('button:has-text("走到")').count(), 0);
  }, { geo: false, init: HEALTH_ON });
});

/** 首頁＋問一次「我要不要去運動」：送到伺服器的請求（方法、路徑、參數、內容） */
async function healthFlowRequests(on) {
  const reqs = [];
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) reqs.push({ line: `${r.method()} ${u.pathname}${u.search}`, body: r.postData() || '' }); });
    await page.reload();
    await page.waitForSelector('.now-item[data-now="weather"]');
    if (on) await page.locator('#move .move-card').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.goto(`${base}/#/agent?q=${encodeURIComponent('我要不要去運動')}`);
    await page.waitForSelector('.bubble.final .say', { timeout: 20000 });
    if (on) await page.locator('.bubble.health-say').waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
  }, on ? { init: HEALTH_ON } : {});
  return reqs;
}

test('健康與運動：隱私——打開與關掉時送到伺服器的請求（數量、順序、網址參數）一樣，內容沒有健康資料', async () => {
  const on = await healthFlowRequests(true);
  const off = await healthFlowRequests(false);
  for (const r of on) assert.ok(!/health|steps|exerciseMin|步數|1,?600|動得少|二二八|walk/i.test(`${r.line} ${r.body}`), `請求沒有健康資料：${r.line} ${r.body.slice(0, 120)}`);
  assert.deepEqual(on.map((r) => r.line), off.map((r) => r.line), '打開健康與運動不多送、不少送，網址與參數一樣');
  const strip = (b) => b.replace(/"(?:id|ts|at|requestId)":"?[\w.:-]+"?/g, '');
  assert.deepEqual(on.map((r) => strip(r.body)), off.map((r) => strip(r.body)), '內容也一樣');
});

test('健康與運動＋MyDrama：設定了運動活動頁連結時，散步小卡與問阿幫補句多一個淡色「看 MyDrama 活動頁」；沒設定不顯示；請求沒有健康資料', async () => {
  const s = await startServer({ MYDRAMA_LINK_EXERCISE: 'example-drama://unlock' });
  try {
    await withPage(DEVICES.phone, '#/', async (page) => {
      await page.clock.setFixedTime(HEALTH_TIME);
      const bodies = postBodies(page);
      await page.reload();
      const card = page.locator('#move .move-card');
      await card.waitFor({ timeout: 15000 });
      const link = card.locator('button[data-act="drama"]');
      await link.waitFor();
      assert.equal(await link.textContent(), '看 MyDrama 活動頁');
      assert.ok(await link.evaluate((n) => n.classList.contains('linkish')), '淡色次要連結');
      await page.locator('.now').evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: new URL('phone-health-drama.png', SHOTS).pathname });
      await page.goto(`${s.base}/#/agent?q=${encodeURIComponent('我要不要去運動')}`);
      const say = page.locator('.bubble.health-say');
      await say.waitFor({ timeout: 20000 });
      assert.equal(await say.locator('.hs-partner').textContent(), '看 MyDrama 活動頁');
      noHealthIn(bodies);
    }, { origin: s.base, init: HEALTH_ON });
  } finally {
    s.proc.kill();
  }
  // 沒設定（預設伺服器）：不顯示
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.clock.setFixedTime(HEALTH_TIME);
    await page.reload();
    await page.locator('#move .move-card').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('#move button[data-act="drama"]').count(), 0);
  }, { init: HEALTH_ON });
});

// ───── PR #112 獨立審查 ─────
test('動態建議：網址帶問題進來（?q=）先不請手機猜，judge 先跑', async () => {
  await withPage(DEVICES.phone, `#/agent?q=${encodeURIComponent('明天會下雨嗎')}`, async (page) => {
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    const calls = await page.evaluate(() => window.__sug.calls);
    assert.ok(calls.includes('judge'), calls.join(','));
    const firstSuggest = calls.indexOf('suggest');
    assert.ok(firstSuggest === -1 || firstSuggest > calls.indexOf('judge'), `進頁就要送出：不先猜 ${calls.join(',')}`);
  }, { init: FAKE_SUGGEST, ignore: /not in test/ });
});

test('動態建議：送出中到站提醒變了不換建議；先拿掉跟送出那句相同的建議', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    await page.waitForSelector('.suggest .chip[data-src]');
    const first = page.locator('.suggest .chip.next-ask').first();
    const q = await first.getAttribute('data-q');
    let release;
    const hold = new Promise((r) => { release = r; });
    await page.route('**/api/v1/agent', async (route) => { if (route.request().method() === 'POST') await hold; await route.fallback(); });
    await first.click();
    await page.waitForFunction(() => document.querySelector('.chat-send').disabled);
    assert.equal(await page.locator(`.suggest .chip[data-q="${q}"]`).count(), 0, '剛送出的那句先拿掉');
    const sig = await page.getAttribute('.suggest:not(.page-ask)', 'data-sig');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('abang:arrival-watch')));
    await page.waitForTimeout(100);
    assert.equal(await page.getAttribute('.suggest:not(.page-ask)', 'data-sig'), sig, '送出中不換');
    release();
    await page.waitForSelector('.bubble.final', { timeout: 20000 });
    await page.waitForSelector('.suggest.next .next-title');
  });
});

test('動態建議：手機猜太久（接近 1.5 秒）就不驗證、用規則；總等待不超過 1.5 秒', async () => {
  const slow = FAKE_SUGGEST.replace('setTimeout(() => res({', 'setTimeout(() => res({').replace('}), 300));', '}), 1470));');
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    let checks = 0;
    page.on('request', (r) => { if (r.url().includes('/api/v1/suggest/check')) checks++; });
    await page.waitForFunction(() => window.__sug.calls.includes('suggest'));
    await page.waitForTimeout(2200);
    assert.equal(checks, 0, '剩下的時間不夠驗證：不送');
    assert.equal(await page.locator('.suggest .chip[data-src="edge"]').count(), 0);
    assert.ok(await page.locator('.suggest .chip[data-src="rule"]').count() >= 1);
  }, { init: slow, ignore: /not in test/ });
});

test('動態建議：英文公車頁打開對話，動作與建議都是英文', async () => {
  await withPage(DEVICES.phone, `#/bus/Taipei/307?stop=${encodeURIComponent('民權二段')}&dir=0&lang=en`, async (page) => {
    await page.waitForSelector('.bus-focus');
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .suggest .chip[data-src]');
    const labels = await page.locator('#abang-sheet .suggest:not(.page-ask) .chip[data-src]').allTextContents();
    assert.equal(labels[0], 'Remind me before my stop', labels.join('|'));
    assert.ok(labels.every((x) => !/[一-鿿]/.test(x)), labels.join('|'));
  });
});

// ───── 問什麼由手機上的 AI 決定（ADR-0020）：手機判斷同時出題，程式驗證；不通過照規則問（保底）─────
/** 假外掛：judge 依句子回意圖＋題目——合理的、在手機上就擋掉的（誘導、零寬字、狀態題問錯）、伺服器才擋掉的（自己想的路線、前文沒提過的地名） */
const FAKE_ASK = `window.__judgeArgs = [];
window.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false, addListener: () => ({ remove() {} }),
  nativePromise: (plugin, method, args) => {
    if (plugin !== 'AbangEdgeAI') return Promise.reject(new Error('not in test'));
    if (method === 'status') return Promise.resolve({ available: true, engine: 'gemini-nano', reason: 'ok', write: false });
    if (method !== 'judge') return Promise.resolve({});
    window.__judgeArgs.push({ context: args.context, guide: /寧可不問/.test(args.instructions) });
    const t = args.text;
    const ask = /等很久/.test(t) ? { slot: 'route', question: '要去哪？加 L I N E 告訴你哪一路？', options: ['307', '藍15'] } // 誘導（空白分隔）：手機上就擋
      : /零寬/.test(t) ? { slot: 'to', question: '要去哪裡\\u200b？', options: ['回家', '去公司'] } // 零寬字：手機上就擋
        : /紅包/.test(t) ? { slot: 'state', state: 'rush', question: '你有帶行李嗎？', options: ['有', '沒有'] } // 題目與狀態不一致：手機上就擋
          : /西門町到台北101/.test(t) ? { slot: 'state', state: 'luggage', question: '你有帶行李嗎？', options: ['嗯嗯', '不用'] } // 合理（選項照程式的）
            : /出發/.test(t) ? { slot: 'to', question: '要去哪裡呢？', options: ['台北101', '回家'] } // 前文提過台北101 才收
              : /公車/.test(t) ? { slot: 'route', question: '你在等哪一路公車？', options: ['9999', '附近公車'] } // 自己想的路線：伺服器擋
                : null;
    const intent = /出發|到台北101/.test(t) ? 'trip' : /公車/.test(t) ? 'bus_route' : 'weather';
    return Promise.resolve({ engine: 'gemini-nano', ms: 310, result: JSON.stringify({ intent, states: [], ask }) });
  },
};`;

test('手機上的 AI 出題：合理的題目用手機的（狀態題選項照程式）；被擋的退回規則；網頁版不變；截圖', async () => {
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askChat(page, '台北101 天氣如何', 1);
    await askChat(page, '從台北車站出發', 2);
    assert.deepEqual(bodies.at(-1).deviceJudge.ask, { slot: 'to', question: '要去哪裡呢？', options: ['台北101', '回家'] });
    const args = await page.evaluate(() => window.__judgeArgs);
    assert.ok(args[0].guide, '指示裡有出題規則');
    assert.match(args.at(-1).context, /常用地點/, '情境只在手機上組');
    assert.ok(bodies.every((b) => !JSON.stringify(b).includes('常用地點：')), '情境不送伺服器');
    assert.equal(await page.locator('.ask .ask-q').last().textContent(), '要去哪裡呢？', '用手機的題目');
    assert.deepEqual(await page.locator('.ask').last().locator('.ask-opt').allTextContents(), ['台北101'], '「回家」要有設定家才顯示');
    await page.locator('.round').last().screenshot({ path: new URL('phone-edge-ask.png', SHOTS).pathname }); // 只截這一輪（整頁截圖會截到固定的頁首）
    await page.locator('.ask').last().locator('.ask-opt', { hasText: '台北101' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.bubble.final').length === 3, null, { timeout: 20000 });
    assert.equal(bodies.at(-1).messages.at(-1).content, '從臺北車站到台北101怎麼去？', '點選項：送出程式接回的完整一句');
  }, { init: FAKE_ASK, ignore: /not in test/ });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askChat(page, '從西門町到台北101怎麼去', 1);
    await page.waitForSelector('.ask .ask-q');
    assert.equal(await page.textContent('.ask .ask-q'), '你有帶行李嗎？');
    assert.deepEqual(await page.locator('.ask .ask-opt').allTextContents(), ['有', '沒有'], '狀態題的選項照程式（手機給的「嗯嗯／不用」不用）');
    assert.match(await page.textContent('.ask .ask-why'), /叫車.*多 \d+ 元/, '數字由程式算');
    assert.equal(bodies[0].deviceJudge.ask.state, 'luggage');
    await shotAsk(page, page.locator('.ask'), 'phone-edge-ask-state.png');
  }, { init: FAKE_ASK, ignore: /not in test/ });
  // 被擋的：手機上就擋（誘導、零寬字、問錯狀態）不送 ask；伺服器才擋（自己想的路線、前文沒提過的地名）照規則問
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askChat(page, '公車還要多久？', 1);
    assert.deepEqual(bodies[0].deviceJudge.ask.options, ['9999', '附近公車']);
    assert.equal(await page.textContent('.ask .ask-q'), '哪一路公車？', '伺服器擋：自己想的路線，規則保底');
    await askChat(page, '從台北車站出發', 2);
    assert.equal(await page.locator('.ask .ask-q').last().textContent(), '要去哪裡？', '伺服器擋：前文沒提過台北101');
    await askChat(page, '公車等很久，還要多久？', 3);
    assert.equal(bodies.at(-1).deviceJudge.intent, 'bus_route');
    assert.equal(bodies.at(-1).deviceJudge.ask, undefined, '誘導：手機上就擋掉，不送');
    await askChat(page, '測試零寬', 4);
    assert.equal(bodies.at(-1).deviceJudge.ask, undefined, '零寬字：手機上就擋');
    await askChat(page, '從西門町到台北101領紅包怎麼去', 5);
    assert.equal(bodies.at(-1).deviceJudge.ask, undefined, '狀態題問錯狀態：手機上就擋');
    assert.doesNotMatch(await page.textContent('body'), /9999|LINE/, '被擋的題目與選項不出現');
    await shot(page, 'phone-edge-ask-fallback');
  }, { init: FAKE_ASK, ignore: /not in test/ });
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    const bodies = recordBodies(page);
    await askChat(page, '公車還要多久？', 1);
    assert.equal(bodies[0].deviceJudge, undefined);
    assert.equal(await page.textContent('.ask .ask-q'), '哪一路公車？');
  });
});

test('阿幫的腦袋：試判斷第 4 段標出題目是手機上的 AI 決定還是規則保底，被擋的手機題目照列原因；截圖', async () => {
  await withPage(DEVICES.phone, '#/ai', async (page) => {
    await page.waitForSelector('.ai-hero[data-core="on"]');
    await page.fill('#ai-input', '從西門町到台北101怎麼去');
    await page.click('#ai-go');
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.equal(await page.textContent('.ai-ask-q'), '你有帶行李嗎？');
    assert.match(await page.textContent('.ai-asker'), /手機上的 Gemini Nano 決定，程式驗證通過/);
    assert.equal(await page.getAttribute('.ai-asker', 'data-by'), 'device');
    await page.locator('.ai-sec[data-sec="next"]').screenshot({ path: new URL('phone-edge-ask-trial.png', SHOTS).pathname });
    // 伺服器擋下（前文沒提過的地名）：規則保底，手機的題目照列與原因
    await page.fill('#ai-input', '從台北車站出發');
    await page.click('#ai-go');
    await page.waitForFunction(() => document.querySelector('.ai-ask-blocked'), null, { timeout: 20000 });
    await page.waitForSelector('#ai-trial-foot:not([hidden])', { timeout: 20000 });
    assert.equal(await page.textContent('.ai-ask-q'), '要去哪裡？');
    assert.match(await page.textContent('.ai-asker'), /規則問（保底）/);
    assert.equal(await page.getAttribute('.ai-ask-blocked', 'data-where'), 'server');
    assert.match(await page.textContent('.ai-ask-blocked'), /要去哪裡呢？.*台北101.*伺服器沒採用：選項接不回來/);
    await page.locator('.ai-sec[data-sec="next"]').screenshot({ path: new URL('phone-edge-ask-trial-blocked.png', SHOTS).pathname }); // 只截第 4 段（整頁太長）
    // 手機上就擋掉（誘導內容）
    await page.fill('#ai-input', '公車等很久，還要多久？');
    await page.click('#ai-go');
    await page.waitForFunction(() => document.querySelector('.ai-ask-blocked')?.dataset.where === 'phone', null, { timeout: 20000 });
    assert.match(await page.textContent('.ai-ask-blocked'), /在手機上就被擋下：夾帶網址、帳號、電話或匯款等字/);
    // 手機上就擋掉（狀態題問錯狀態）
    await page.fill('#ai-input', '從西門町到台北101領紅包怎麼去');
    await page.click('#ai-go');
    await page.waitForFunction(() => /問錯狀況/.test(document.querySelector('.ai-ask-blocked')?.textContent || ''), null, { timeout: 20000 });
  }, { init: FAKE_ASK, ignore: /not in test/ });
});

// 只問你一題、沒查資料的那一輪（規則或手機出題都一樣）：沒有 discussion_end，「小幫手討論中 •••」不能一直留著
test('只問一題的那一輪：討論串正確結束（不留「小幫手討論中」）——問阿幫頁與底部面板、中英文', async () => {
  const idle = (root) => document.querySelector(root).querySelectorAll('.turn .thread.live, .turn .thread-head').length;
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    for (const [i, q, head] of [[1, '公車還要多久？', '小幫手討論中'], [2, 'How long until the bus comes?', 'Checking live data']]) {
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((k) => document.querySelectorAll('.bubble.final').length === k, i, { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('.chat-send')?.disabled);
      assert.ok(await page.locator('.turn').last().locator('.ask .ask-q').count() || await page.locator('.ask .ask-q').count(), `${q}：有問你一題`);
      assert.equal(await page.evaluate(idle, 'body'), 0, `${q}：討論串結束`);
      assert.doesNotMatch(await page.locator('.turn').last().textContent(), new RegExp(head), q);
    }
    assert.equal(await page.locator('.turn').last().locator('.thread').count(), 0, '沒有小幫手發言：整個不顯示');
    await page.locator('.round').last().screenshot({ path: new URL('phone-ask-only-turn.png', SHOTS).pathname });
    // 查了工具的一輪照舊收合成摘要
    await page.fill('.chat-form input', '從西門町到台北101怎麼去');
    await page.press('.chat-form input', 'Enter');
    await page.waitForSelector('.turn .thread-sum', { timeout: 20000 });
  });
  await withPage(DEVICES.phone, '#/services', async (page) => {
    await page.click('#abang-fab');
    await page.waitForSelector('#abang-sheet[open] .chat-form input');
    for (const [i, q] of [[1, '從台北車站出發'], [2, "I'm leaving from Taipei Main Station"]]) {
      await page.fill('#abang-sheet .chat-form input', q);
      await page.press('#abang-sheet .chat-form input', 'Enter');
      await page.waitForFunction((k) => document.querySelectorAll('#abang-sheet .bubble.final').length === k, i, { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('#abang-sheet .chat-send')?.disabled);
      assert.ok(await page.locator('#abang-sheet .ask .ask-q').count(), `底部面板「${q}」：有問你一題`);
      assert.equal(await page.evaluate(idle, '#abang-sheet'), 0, `底部面板「${q}」：討論串結束`);
      assert.doesNotMatch(await page.locator('#abang-sheet .turn').last().textContent(), /小幫手討論中|Checking live data/);
    }
  });
});

test('預設大眾運輸（ADR-0010 2026-11-22）：叫車不划算時決策圖有「不划算」列、③ 最後一步「划不划算」、中英文理由照實', async () => {
  // 示範資料臺北車站→國父紀念館：叫車 22 分 230 元、公車藍15 31 分 15 元 → 推公車，叫車排第二（西門町→101 示範資料公車本來就贏，沒有扣分）
  const STEPS = () => { window.__dgSteps = []; new MutationObserver(() => { const t = [...document.querySelectorAll('.decision .dg-step')].at(-1)?.textContent; if (t && window.__dgSteps.at(-1) !== t) window.__dgSteps.push(t); }).observe(document, { subtree: true, childList: true, characterData: true }); };
  await withPage(DEVICES.phone, '#/agent', async (page) => {
    for (const [i, q, why, step, row] of [
      [1, '從台北車站去國父紀念館', /^選「公車 藍15」：省 215 元、只慢 9 分。$/, '③ 比較：划不划算', /^不划算−\d+\.\d$/],
      [2, 'How do I get from Taipei Main Station to Sun Yat-sen Memorial Hall?', /^Bus wins: NT\$215 cheaper, only 9 min slower\.$/, '③ Comparing: Worth the fare?', /^Not worth the fare−\d+\.\d$/],
    ]) {
      await page.evaluate(() => { window.__dgSteps = []; });
      await page.fill('.chat-form input', q);
      await page.press('.chat-form input', 'Enter');
      await page.waitForFunction((k) => document.querySelectorAll('.decision .dg-svg').length === k, i, { timeout: 20000 });
      const dg = page.locator('.decision').last();
      await page.waitForFunction((k) => document.querySelectorAll('.decision')[k - 1]?.querySelector('.dg-edge.win.flow'), i, { timeout: 8000 });
      assert.match(await dg.locator('.dg-why').textContent(), why, q);
      assert.ok((await page.evaluate(() => window.__dgSteps)).includes(step), `${q}：③ 比較最後一步`);
      await dg.locator('.dg-details').evaluate((d) => { d.open = true; }); // 光點持續流動，summary 不算 stable，直接打開
      const pen = dg.locator('.dg-crit.penalty.premium');
      assert.equal(await pen.count(), 1, '只有叫車有扣分列');
      assert.match((await pen.textContent()).trim(), row);
    }
  }, { init: STEPS, motion: true });
});

test('手機橫放：撐滿整個螢幕；首頁、服務兩欄且第一列對齊；天氣置中單欄；問阿幫維持閱讀寬度；直放不變（2026-11-24）', async () => {
  const LAND = { viewport: { width: 874, height: 402 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  await withPage(LAND, '#/', async (page) => {
    await page.waitForSelector('#main > section.group');
    const home = await page.evaluate(() => {
      const m = document.querySelector('#main');
      const tops = [...m.querySelectorAll(':scope > section.group')].map((s) => { const r = (s.querySelector('h2,h3') || s).getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; });
      return { cols: getComputedStyle(m).columnCount, appW: Math.round(document.querySelector('.app').getBoundingClientRect().width), tops };
    });
    assert.equal(home.cols, '2', '首頁兩欄');
    assert.ok(home.appW >= 860, `撐滿：${home.appW}`);
    const xs = [...new Set(home.tops.map(([x]) => x))];
    assert.equal(xs.length, 2, `區塊分在兩欄：${JSON.stringify(home.tops)}`);
    const firstY = xs.map((x) => Math.min(...home.tops.filter(([tx]) => tx === x).map(([, y]) => y)));
    assert.ok(Math.abs(firstY[0] - firstY[1]) <= 2, `兩欄第一個標題對齊：${firstY}`);
    await page.evaluate(() => { location.hash = '#/services'; });
    await page.waitForSelector('#main > .svc-group');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#main')).columnCount), '2', '服務兩欄');
    await page.evaluate(() => { location.hash = '#/s/weather'; });
    await page.waitForSelector('#main #res');
    const w = await page.evaluate(() => { const m = document.querySelector('#main').getBoundingClientRect(); return { cols: getComputedStyle(document.querySelector('#main')).columnCount, w: Math.round(m.width), left: Math.round(m.left) }; });
    assert.equal(w.cols, 'auto', '天氣單欄');
    assert.ok(w.w <= 760 && w.left > 40, `天氣置中單欄：${JSON.stringify(w)}`);
    await page.evaluate(() => { location.hash = '#/agent'; });
    await page.waitForSelector('.chat-form');
    assert.ok(await page.evaluate(() => document.querySelector('#main').getBoundingClientRect().width) <= 720, '問阿幫維持閱讀寬度');
  });
  await withPage(DEVICES.phone, '#/', async (page) => {
    await page.waitForSelector('#main > section.group');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#main')).columnCount), 'auto', '直放單欄不變');
  });
});
