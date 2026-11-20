// 手機 App 定位（2026-11-21）：有原生定位外掛就用它（iOS 只問 App 權限一次），沒有就用瀏覽器定位
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

afterEach(() => { delete globalThis.Capacitor; });
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
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['Geolocation', 'getCurrentPosition'], ['Geolocation', 'checkPermissions']]);
  assert.equal(calls[0][2].enableHighAccuracy, false);
});

test('原生外掛拒絕或回傳不完整 → null（阿幫改問從哪出發）', async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, nativePromise: async (p, m) => { if (m === 'checkPermissions') return { location: 'denied' }; throw new Error('Location permission was denied'); } };
  const { browserLocation, locationGranted } = await fresh();
  assert.equal(await browserLocation(), null);
  assert.equal(await locationGranted(), false);
  globalThis.Capacitor.nativePromise = async () => ({ coords: {} });
  assert.equal(await (await fresh()).browserLocation(), null);
});

test('網頁版（沒有外掛）：沒有 navigator.geolocation 時回 null，不丟錯', async () => {
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
