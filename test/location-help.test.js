// 定位失敗原因與「到設定開啟」（S1c）
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

afterEach(() => { delete globalThis.Capacitor; });
const rnd = () => Math.random();
const load = async () => {
  const t = rnd();
  const client = await import(`../public/js/agent/client.js?t=${t}`);
  return client;
};

test('locationReason：原生錯誤碼（iOS／Android 相同）與網頁錯誤碼', async () => {
  const { locationReason } = await load();
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0003' }), 'denied');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0008' }), 'denied', 'iOS 受限（家長控制）');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0007' }), 'off');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0009' }), 'off', 'Android 拒絕開啟定位');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0017' }), 'off');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0010' }), 'timeout');
  assert.equal(locationReason({ code: 'OS-PLUG-GLOC-0002' }), 'unavailable');
  assert.equal(locationReason({ code: 1 }), 'denied');
  assert.equal(locationReason({ code: 2 }), 'unavailable');
  assert.equal(locationReason({ code: 3 }), 'timeout');
  // 沒有錯誤碼時看訊息
  assert.equal(locationReason(new Error('Location permission was denied')), 'denied');
  assert.equal(locationReason(new Error('Location services are not enabled.')), 'off');
  assert.equal(locationReason(new Error('Request to enable location was denied.')), 'off');
  assert.equal(locationReason(null), 'unavailable');
});

test('原生定位失敗記下原因；成功後清掉；問阿幫的 client_tool_result 帶 reason', async () => {
  let fail = { code: 'OS-PLUG-GLOC-0007', message: 'Location services are not enabled.' };
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise: async (p, m) => { if (m === 'checkPermissions') return { location: 'granted' }; if (fail) throw fail; return { coords: { latitude: 25.04, longitude: 121.51 } }; } };
  const { browserLocation, lastLocationError } = await load();
  assert.equal(await browserLocation(1000, { fresh: true }), null);
  assert.equal(lastLocationError(), 'off');
  fail = null;
  assert.ok(await browserLocation(1000, { fresh: true }));
  assert.equal(lastLocationError(), null, '成功後清掉');
});

test('被逾時放棄的舊呼叫晚到，不蓋掉原因；共用進行中的定位不算新的一次', async () => {
  let rejectLate;
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise: async (p, m) => (m === 'checkPermissions' ? { location: 'granted' } : new Promise((res, rej) => { rejectLate = rej; })) };
  const { browserLocation, lastLocationError } = await load();
  const a = browserLocation(10);
  const b = browserLocation(10); // 共用 a
  assert.equal(a, b);
  assert.equal(await a, null);
  assert.equal(lastLocationError(), 'timeout');
  rejectLate({ code: 'OS-PLUG-GLOC-0003' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lastLocationError(), 'timeout', '晚到的拒絕不改原因');
});

test('外掛不回應到逾時 → timeout', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise: async (p, m) => (m === 'checkPermissions' ? { location: 'granted' } : new Promise(() => {})) };
  const { browserLocation, lastLocationError } = await load();
  const t0 = Date.now();
  // 已允許：timeout＋3 秒；這裡用 10 毫秒讓測試快一點
  assert.equal(await browserLocation(10, { fresh: true }), null);
  assert.ok(Date.now() - t0 < 4000);
  assert.equal(lastLocationError(), 'timeout');
});

test('locationHelp：說明依原因；App 有 AbangSystem 外掛時權限或定位服務才給「到設定開啟」', async () => {
  const { locationHelp } = await import(`../public/js/location-help.js?t=${rnd()}`);
  // 網頁版：沒有按鈕，說瀏覽器怎麼開
  assert.equal(locationHelp('denied').canOpen, false);
  assert.match(locationHelp('denied').text, /瀏覽器的網站設定.+位置.+允許/);
  assert.match(locationHelp('timeout').text, /窗邊|稍後/);
  assert.equal(locationHelp(null).reason, 'unavailable');
  const calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (n) => n === 'AbangSystem', nativePromise: async (p, m, a) => { calls.push([p, m, a]); } };
  assert.equal(locationHelp('denied').canOpen, true);
  assert.match(locationHelp('denied').text, /按「到設定開啟」，在「權限 → 位置資訊」選允許/);
  assert.equal(locationHelp('off').canOpen, true);
  assert.match(locationHelp('off').text, /使用位置資訊/);
  assert.doesNotMatch(locationHelp('denied').why + locationHelp('denied').fix, /再試一次/, 'why＋fix 不含再試一次（引導用）');
  assert.equal(locationHelp('timeout').canOpen, false, '逾時開設定也沒用');
  const { openLocationSettings } = await import(`../public/js/location-help.js?t=${rnd()}`);
  assert.equal(await openLocationSettings('off'), true);
  assert.equal(await openLocationSettings('denied'), true);
  assert.deepEqual(calls.map((c) => c[2].target), ['location', 'app'], 'Android：定位服務關閉開定位設定，權限開 App 設定');
  globalThis.Capacitor.getPlatform = () => 'ios';
  calls.length = 0;
  await openLocationSettings('off');
  assert.equal(calls[0][2].target, 'app', 'iOS 只能開 App 設定');
  assert.match(locationHelp('off').text, /隱私權與安全性 → 定位服務/);
  assert.equal(locationHelp('off').canOpen, false, 'iOS 定位服務總開關不在 App 設定頁：不給按鈕');
  assert.match(locationHelp('denied').text, /「位置」選「使用 App 期間」/);
  globalThis.Capacitor.isPluginAvailable = () => false; // 舊版 App 沒有 AbangSystem：說完整路徑
  assert.match(locationHelp('denied').text, /設定 → App → Abang → 位置/);
  globalThis.Capacitor.getPlatform = () => 'android';
  assert.match(locationHelp('denied').text, /設定 → 應用程式 → Abang → 權限 → 位置資訊/);
  globalThis.Capacitor.isPluginAvailable = (n) => n === 'AbangSystem';
  globalThis.Capacitor.nativePromise = async () => { throw new Error('x'); };
  assert.equal(await openLocationSettings('denied'), false);
});

test('locateSay：權限、定位服務、逾時各說各的下一步（中英文）', async () => {
  const { locateSay } = await import('../public/js/pages/agent.js');
  assert.match(locateSay({ ok: false, reason: 'denied' }), /權限沒有打開.+直接打地點/);
  assert.match(locateSay({ ok: false, reason: 'off' }), /定位服務是關的/);
  assert.match(locateSay({ ok: false, reason: 'timeout' }), /太久沒有回應/);
  assert.match(locateSay({ ok: false, reason: 'denied' }, 'en'), /permission is off/);
});
