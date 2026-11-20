// 手機 App 定位（2026-11-21）：有原生定位外掛就用它（iOS 只問 App 權限一次），沒有就用瀏覽器定位
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

afterEach(() => { delete globalThis.Capacitor; });
const grantedFake = (coords, perm = { location: 'granted' }) => {
  const calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: (n) => n === 'Geolocation', nativePromise: async (plugin, method, args) => { calls.push([method, args]); if (method === 'checkPermissions') return perm; if (coords === 'hang') return new Promise(() => {}); return { coords }; } };
  return calls;
};
// 每個測試重新載入模組（client.js 有 2 分鐘定位快取）
const fresh = () => import(`../public/js/agent/client.js?t=${Math.random()}`);

test('原生外掛：getCurrentPosition 的 coords 轉成 { lat, lon }；權限用 checkPermissions', async () => {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true, isPluginAvailable: (n) => n === 'Geolocation',
    nativePromise: async (plugin, method, args) => { calls.push([plugin, method, args]); return method === 'checkPermissions' ? { location: 'granted' } : { coords: { latitude: 25.0478, longitude: 121.517 } }; },
  };
  const { browserLocation, locationGranted } = await fresh();
  assert.deepEqual(await browserLocation(), { lat: 25.0478, lon: 121.517 });
  assert.equal(await locationGranted(), true);
  assert.ok(calls.some((c) => c[1] === 'getCurrentPosition' && c[2].enableHighAccuracy === false), '問阿幫預設不要求精確位置');
});

test('原生外掛拒絕或回傳不完整 → null（阿幫改問從哪出發）', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise: async (p, m) => { if (m === 'checkPermissions') return { location: 'denied' }; throw new Error('Location permission was denied'); } };
  const { browserLocation, locationGranted } = await fresh();
  assert.equal(await browserLocation(), null);
  assert.equal(await locationGranted(), false);
  globalThis.Capacitor.nativePromise = async () => ({ coords: {} });
  assert.equal(await (await fresh()).browserLocation(), null);
});

test('App 沒有定位外掛、也沒有瀏覽器定位時回 null，不丟錯', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => false, nativePromise: async () => { throw new Error('不該呼叫'); } };
  const { browserLocation } = await fresh();
  assert.equal(await browserLocation(), null);
});

test('鍵盤偵測：可見高度 < 75% 且在打字才算打開', async () => {
  const { keyboardOpen } = await import('../public/js/keyboard.js');
  assert.equal(keyboardOpen(400, 844, true), true);
  assert.equal(keyboardOpen(400, 844, false), false, '沒在打字（例：縮放）');
  assert.equal(keyboardOpen(800, 844, true), false, '只有焦點沒有鍵盤（實體鍵盤、桌機）');
  assert.equal(keyboardOpen(400, 0, true), false);
});

test('只給「大概位置」（Android 12+ coarseLocation）也算已允許；isNativePlatform 丟錯當網頁版', async () => {
  grantedFake({ latitude: 25.04, longitude: 121.51 }, { location: 'prompt', coarseLocation: 'granted' });
  assert.equal(await (await fresh()).locationGranted(), true);
  globalThis.Capacitor = { isNativePlatform: () => { throw new Error('boom'); } };
  assert.equal(await (await fresh()).locationGranted(), false);
});

test('快取：2 分鐘內重用；fresh 不用快取且 maximumAge 0；要精確時不用大概的結果；失敗不寫快取', async () => {
  const calls = grantedFake({ latitude: 25.04, longitude: 121.51 });
  const { browserLocation } = await fresh();
  await browserLocation();
  await browserLocation();
  assert.equal(calls.filter((c) => c[0] === 'getCurrentPosition').length, 1, '重用');
  await browserLocation(8000, { highAccuracy: true });
  const hi = calls.filter((c) => c[0] === 'getCurrentPosition');
  assert.equal(hi.length, 2, '要精確：重新定位');
  assert.equal(hi[1][1].enableHighAccuracy, true);
  await browserLocation(8000, { fresh: true });
  assert.equal(calls.filter((c) => c[0] === 'getCurrentPosition').at(-1)[1].maximumAge, 0);

  const c2 = grantedFake({});
  const m2 = await fresh();
  assert.equal(await m2.browserLocation(), null);
  globalThis.Capacitor.nativePromise = async (p, m) => (m === 'checkPermissions' ? { location: 'granted' } : { coords: { latitude: 22.6, longitude: 120.3 } });
  assert.deepEqual(await m2.browserLocation(), { lat: 22.6, lon: 120.3 }, '失敗的那次沒有寫進快取');
  assert.ok(c2.length >= 1);
});

test('同時要位置只發一個原生呼叫；已允許但外掛不回應時 timeout＋3 秒放棄', async () => {
  const calls = grantedFake('hang');
  const { browserLocation } = await fresh();
  const t0 = Date.now();
  const [a, b] = await Promise.all([browserLocation(50), browserLocation(50)]);
  assert.deepEqual([a, b], [null, null]);
  assert.equal(calls.filter((c) => c[0] === 'getCurrentPosition').length, 1, '共用進行中的定位');
  const ms = Date.now() - t0;
  assert.ok(ms >= 3000 && ms < 6000, `約 3 秒放棄（${ms} ms）`);
});

test('台灣範圍：範圍外 client_tool_result 不說「拿到了」', async () => {
  const { inTaiwan } = await fresh();
  assert.equal(inTaiwan({ lat: 25.04, lon: 121.51 }), true);
  assert.equal(inTaiwan({ lat: 35.68, lon: 139.76 }), false);
  assert.equal(inTaiwan(null), false);
  const { locateSay } = await import('../public/js/pages/agent.js');
  assert.equal(locateSay({ ok: true }), '拿到了，用你現在的位置');
  assert.match(locateSay({ ok: false, reason: 'outside' }), /不在台灣.+直接打地點/);
  assert.match(locateSay({ ok: false }), /直接打地點.+設定打開定位/);
});

/** 假的視窗：innerHeight、visualViewport（EventTarget）、document（activeElement、classList） */
function fakeWin(h) {
  const vv = Object.assign(new EventTarget(), { height: h });
  const cls = new Set();
  const doc = Object.assign(new EventTarget(), { activeElement: null, documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) } } });
  const win = Object.assign(new EventTarget(), { innerHeight: h, visualViewport: vv, document: doc });
  const input = { tagName: 'INPUT', type: 'text' };
  return { win, vv, doc, cls, input };
}

test('watchKeyboard：iOS（只有可見高度變矮）、Android（innerHeight 也變矮）、轉向重設、焦點離開晚一點收', async () => {
  const { watchKeyboard } = await import('../public/js/keyboard.js');
  // iOS
  const a = fakeWin(844);
  const stopA = watchKeyboard(a.win);
  a.doc.activeElement = a.input; a.doc.dispatchEvent(new Event('focusin'));
  a.vv.height = 450; a.vv.dispatchEvent(new Event('resize'));
  assert.ok(a.cls.has('kb-open'), 'iOS 鍵盤');
  // Android（adjustResize）
  const b = fakeWin(900);
  const stopB = watchKeyboard(b.win);
  b.doc.activeElement = b.input; b.doc.dispatchEvent(new Event('focusin'));
  b.win.innerHeight = 520; b.vv.height = 520; b.vv.dispatchEvent(new Event('resize'));
  assert.ok(b.cls.has('kb-open'), 'Android 鍵盤');
  // 焦點離開：300 ms 後才收
  b.doc.activeElement = null; b.doc.dispatchEvent(new Event('focusout'));
  assert.ok(b.cls.has('kb-open'), '還沒收（點擊不落空）');
  b.win.innerHeight = 900; b.vv.height = 900;
  await new Promise((r) => setTimeout(r, 320));
  assert.ok(!b.cls.has('kb-open'));
  // 轉橫向（沒在打字）：完整高度重設，接著打字（實體鍵盤、可見高度沒變）不誤判
  b.win.innerHeight = 400; b.vv.height = 400; b.win.dispatchEvent(new Event('resize'));
  b.doc.activeElement = b.input; b.doc.dispatchEvent(new Event('focusin'));
  assert.ok(!b.cls.has('kb-open'), '橫向＋實體鍵盤');
  stopA(); stopB();
  a.vv.height = 300; a.vv.dispatchEvent(new Event('resize'));
});
