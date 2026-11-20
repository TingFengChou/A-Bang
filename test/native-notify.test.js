// 手機 App 本機通知（public/js/native-notify.js）：經 Capacitor 原生橋接呼叫 @capacitor/local-notifications
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasNativeNotify, ensureNotifyPermission, scheduleNotify, cancelNotify } from '../public/js/native-notify.js';

const bridge = (handler) => { const calls = []; globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async (p, m, o) => { calls.push([m, o]); return handler(m, o); } }; return calls; };

test('不在 App 裡（沒有 Capacitor、不是原生、沒有 nativePromise）：全部回 false、不呼叫', async () => {
  delete globalThis.Capacitor;
  assert.equal(hasNativeNotify(), false);
  assert.equal(await ensureNotifyPermission(), false);
  assert.equal(await scheduleNotify(1, new Date(), 't', 'b'), false);
  globalThis.Capacitor = { isNativePlatform: () => false, nativePromise: async () => ({}) };
  assert.equal(hasNativeNotify(), false);
  globalThis.Capacitor = { isNativePlatform: () => true };
  assert.equal(hasNativeNotify(), false, '沒有 nativePromise');
  delete globalThis.Capacitor;
});

test('權限：prompt → 請求 → 允許；拒絕回 false；外掛出錯回 false', async () => {
  let state = 'prompt';
  const calls = bridge((m) => { if (m === 'requestPermissions') state = 'granted'; return { display: state }; });
  assert.equal(await ensureNotifyPermission(), true);
  assert.deepEqual(calls.map(([m]) => m), ['checkPermissions', 'requestPermissions']);
  bridge(() => ({ display: 'denied' }));
  assert.equal(await ensureNotifyPermission(), false);
  bridge(() => { throw new Error('x'); });
  assert.equal(await ensureNotifyPermission(), false);
  delete globalThis.Capacitor;
});

test('排程：時間已過就約 1 秒後送；先取消同 id；外掛出錯回 false；取消吞掉錯誤', async () => {
  const calls = bridge(() => ({}));
  const before = Date.now();
  assert.equal(await scheduleNotify(1001, new Date(0), '阿幫', '內文'), true);
  const s = calls.find(([m]) => m === 'schedule')[1].notifications[0];
  assert.ok(s.schedule.at.getTime() >= before + 1000, '不排過去的時間');
  assert.ok(calls.findIndex(([m]) => m === 'cancel') < calls.findIndex(([m]) => m === 'schedule'), '先取消再排');
  bridge((m) => { if (m === 'schedule') throw new Error('x'); return {}; });
  assert.equal(await scheduleNotify(1001, new Date(), 't', 'b'), false);
  bridge(() => { throw new Error('x'); });
  await cancelNotify(1001); // 不丟錯
  delete globalThis.Capacitor;
});
