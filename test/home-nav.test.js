// 首頁與導覽重新設計（2026-11-21，阿幫為中心）：分頁列（首頁｜服務｜問阿幫｜提醒｜我的）、子頁屬於哪一區、
// 提醒頁清單（到站、下車、出門）、首頁「手機上的 AI」照實說、「現在」摘要的降級（沒定位、離線、查不到）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TABS, activeTab, currentAttr, backTarget } from '../public/js/tabs.js';
import { reminderItems } from '../public/js/reminder-items.js';
import { edgeLine, nowItems, loadNow, peekNow, _resetNow } from '../public/js/home-now.js';
import { miniApps, groups, descOf } from '../public/js/registry.js';

test('分頁列：五格、中央是問阿幫、不再是公車相關的附近／公車／收藏', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['home', 'services', 'ask', 'reminders', 'me']);
  assert.equal(TABS[2].center, true);
  assert.deepEqual(TABS.filter((t) => !t.center).map((t) => t.href), ['#/', '#/services', '#/reminders', '#/me']);
});

test('子頁屬於哪一區：公車、附近、生活服務、防詐 → 服務；收藏、設定、隱私 → 我的；生活問阿幫 → 中央鍵', () => {
  const cases = {
    '/': ['home', true], '': ['home', true], '/services': ['services', true], '/reminders': ['reminders', true], '/me': ['me', true],
    '/nearby': ['services', false], '/bus': ['services', false], '/bus/Taipei/307': ['services', false], '/bus-station/Taipei/x': ['services', false],
    '/rail/thsr': ['services', false], '/s/weather': ['services', false], '/agent/antifraud': ['services', false],
    '/agent': ['ask', true], '/agent/life': ['ask', true],
    '/favs': ['me', false], '/settings': ['me', false], '/privacy': ['me', false], '/ai': ['me', false],
    '/nope': [null, false],
  };
  for (const [p, [tab, exact]] of Object.entries(cases)) assert.deepEqual(activeTab(p), { tab, exact }, p);
  assert.equal(currentAttr('services', '/services'), 'page');
  assert.equal(currentAttr('services', '/bus/Taipei/307'), 'true');
  assert.equal(currentAttr('home', '/bus/Taipei/307'), null);
  assert.equal(currentAttr('ask', '/agent'), 'page');
});

test('服務總覽：四組（防詐單獨一組），每個服務都有一句說明', () => {
  assert.deepEqual(groups.map((g) => g.id), ['transit', 'life', 'gov', 'safe']);
  assert.equal(miniApps.find((a) => a.id === 'antifraud').group, 'safe');
  for (const a of miniApps) { assert.ok(groups.some((g) => g.id === a.group), a.id); assert.ok(descOf(a.id).length >= 4, a.id); }
  assert.ok(miniApps.some((a) => a.route === '#/nearby') && miniApps.some((a) => a.route === '#/bus'), '原本分頁列的附近、公車在服務裡');
});

test('提醒清單：坐車中 → 等車中 → 出門提醒（依時間、過期的不列），每筆有取消的讀屏名稱與回公車頁連結', () => {
  const now = new Date(2026, 10, 21, 8, 0).getTime();
  const items = reminderItems({
    arrival: { city: 'Taipei', routeName: '307', stop: '敦化市場', direction: 0, minutes: 3 },
    alight: { city: 'Taipei', routeName: '601', board: '民生', dest: '市府', direction: 1 },
    leave: [{ id: 'b', at: now + 3 * 3600e3, text: '該出門了：公車' }, { id: 'a', at: now + 1800e3, text: '該出門了：捷運' }, { id: 'old', at: now - 1, text: '過期' }],
    now,
  });
  assert.deepEqual(items.map((x) => x.kind), ['alight', 'arrival', 'leave', 'leave']);
  assert.deepEqual(items.map((x) => x.id), ['alight', 'arrival', 'a', 'b']);
  assert.equal(items[0].title, '601 下車提醒');
  assert.match(items[0].sub, /快到「市府」前約 2 分提醒你・從「民生」上車/);
  assert.equal(items[1].href, `#/bus/Taipei/307?stop=${encodeURIComponent('敦化市場')}&dir=0`);
  assert.equal(items[2].title, '今天 08:30 出門提醒');
  assert.equal(items[2].sub, '捷運', '去掉「該出門了：」');
  assert.equal(items[1].cancelLabel, '取消 307 的到站提醒');
  assert.deepEqual(reminderItems({}), []);
  assert.deepEqual(reminderItems({ arrival: { routeName: '307' } }), [], '缺站名不列');
});

test('手機上的 AI：可用說引擎、判斷留在手機；不可用、網頁版、關掉都照實說由伺服器判斷', () => {
  assert.equal(edgeLine(null).tone, 'wait');
  const on = edgeLine({ available: true, engine: 'gemini-nano' }, true);
  assert.equal(on.tone, 'on');
  assert.match(on.label, /Gemini Nano/);
  assert.match(on.text, /判斷留在手機/);
  assert.match(edgeLine({ available: true, engine: 'apple' }, true).label, /Apple Intelligence/);
  for (const [st, en] of [[{ available: true, engine: 'apple' }, false], [{ available: false, reason: 'web' }, true], [{ available: false, reason: 'unsupported' }, true], [{ available: false, reason: 'downloading' }, true], [{ available: false }, true]]) {
    const l = edgeLine(st, en);
    assert.equal(l.tone, 'off', JSON.stringify(st));
    assert.match(l.text, /伺服器判斷/, JSON.stringify(st));
    assert.doesNotMatch(l.text, /判斷留在手機/);
  }
});

test('現在：天氣、空品、提醒；查不到的那格不出現、提醒一定有；離線說離線', () => {
  const full = nowItems({ weather: { tempC: 22.6, pop3h: 30, raining: false }, aqi: { nearest: { aqi: 58, status: '普通' } }, next: { title: '307 到站提醒', sub: 'x' }, place: '你附近' });
  assert.deepEqual(full.map((x) => x.id), ['weather', 'aqi', 'reminder']);
  assert.equal(full[0].main, '23°C');
  assert.equal(full[0].sub, '降雨 30%・你附近');
  assert.equal(full[1].main, 'AQI 58');
  assert.equal(nowItems({ weather: { tempC: 20, rainMm1h: 2 } })[0].sub, '正在下雨');
  assert.deepEqual(nowItems({}).map((x) => [x.id, x.main]), [['reminder', '沒有提醒']]);
  assert.deepEqual(nowItems({ offline: true }).map((x) => x.id), ['offline', 'reminder']);
  assert.deepEqual(nowItems({ aqi: { nearest: { aqi: null } } }).map((x) => x.id), ['reminder'], 'AQI 沒有值不顯示');
});

test('現在：沒給定位不問權限（用台北車站附近並寫明）；查不到回 null 不丟錯；兩者都查到才快取 10 分鐘', async () => {
  _resetNow();
  const calls = [];
  let located = 0;
  const deps = (ok, fail = null) => ({
    callTool: async (n, a) => { calls.push([n, a]); if (fail === true || fail === n) throw new Error('down'); return { data: n === 'weather_now' ? { tempC: 20 } : { nearest: { aqi: 40, status: '良好' } } }; },
    granted: async () => ok, locate: async () => { located++; return { lat: 22.6, lon: 120.3 }; }, fallback: { lat: 25.0478, lon: 121.517 },
  });
  const failed = await loadNow(deps(false, true), 1000);
  assert.deepEqual(failed, { weather: null, aqi: null, place: '台北車站附近', offline: false });
  assert.equal(located, 0, '沒給過權限：不定位');
  assert.equal(peekNow(1000), null);
  // 只查到天氣：不快取，下次重查（失敗的空品會再試）
  calls.length = 0;
  const half = await loadNow(deps(false, 'aqi_nearby'), 1500);
  assert.ok(half.weather && !half.aqi);
  assert.equal(peekNow(1500), null, '少一個不快取');
  const v = await loadNow(deps(false), 2000);
  assert.equal(v.place, '台北車站附近');
  assert.deepEqual(calls.slice(-2).map((c) => c[1].lat), [25.0478, 25.0478]);
  assert.equal(peekNow(2000), v, '兩者都查到：快取');
  calls.length = 0;
  assert.equal(await loadNow(deps(false), 3000), v, '10 分鐘內、權限沒變：用快取');
  assert.equal(calls.length, 0);
  // 之後允許了定位：用台北車站的快取作廢，改查你附近
  const mine = await loadNow(deps(true), 4000);
  assert.equal(mine.place, '你附近');
  assert.equal(located, 1);
  assert.equal(await loadNow(deps(true), 5000), mine, '用你的位置查的快取：照用');
  assert.equal(peekNow(4000 + 10 * 60_000 + 1), null, '過 10 分鐘失效');
});

test('現在：示範資料的天氣、空品標示範', () => {
  const items = nowItems({ weather: { tempC: 20 }, aqi: { nearest: { aqi: 40, status: '良好' } }, demo: { weather: true, aqi: false } });
  assert.equal(items.find((x) => x.id === 'weather').demo, true);
  assert.equal(items.find((x) => x.id === 'aqi').demo, undefined);
  assert.equal(items.find((x) => x.id === 'reminder').demo, undefined);
});

test('Android 返回鍵：首頁離開 App；分頁本身回首頁（不走分頁歷史）；其他頁回上一頁、沒有上一頁回首頁', () => {
  assert.equal(backTarget('/', true), 'exit');
  assert.equal(backTarget('', false), 'exit');
  for (const p of ['/services', '/reminders', '/me', '/agent']) assert.equal(backTarget(p, true), '#/', p);
  assert.equal(backTarget('/bus/Taipei/307', true), 'back');
  assert.equal(backTarget('/bus/Taipei/307', false), '#/');
  assert.equal(backTarget('/agent/antifraud', true), 'back');
  assert.equal(backTarget('/settings', true), 'back');
  assert.equal(backTarget('/ai', true), 'back', '阿幫的腦袋：回上一頁');
  assert.equal(backTarget('/ai', false), '#/', '深層連結打開：回首頁');
});

test('首頁：範例問題各領域都有（防詐開防詐頁）；不新增伺服器端點（只用現有工具路由）', async () => {
  const src = await readFile(new URL('../public/js/pages/home.js', import.meta.url), 'utf8');
  // 交通、生活、消費依時段與情境動態（agent/suggest.js homeAsks，test/suggest.test.js 測各領域都有）；防詐固定
  assert.match(src, /homeAsks\(ctx\)/);
  assert.ok(src.includes('詐騙'));
  assert.match(src, /href: '#\/agent\/antifraud'/);
  const now = await readFile(new URL('../public/js/home-now.js', import.meta.url), 'utf8');
  assert.doesNotMatch(now, /fetch\(/, '經 host.callTool（/api/v1/tools/:name）');
  assert.match(now, /'weather_now'/);
  assert.match(now, /'aqi_nearby'/);
});
