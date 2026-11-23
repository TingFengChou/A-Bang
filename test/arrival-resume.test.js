// 前端審查 #1（2026-11-23）：App 被關掉、「該出門了」通知響過，點通知打開 App 時不要恢復到站提醒（恢復會把這班當「來不及」改等下一班、再提醒一次）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const calls = [];
globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false,
  nativePromise: async (pl, m) => { calls.push(`${pl}.${m}`); return m === 'checkPermissions' ? { display: 'granted' } : {}; } };
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { focus: { status: 0, etaSec: 120, stopName: '西門' } } }) });

test('排好的通知時間已經過了（響過）：不恢復、清掉；還沒響的照常恢復', async () => {
  const now = Date.now();
  localStorage.setItem('abang.arrivalWatch', JSON.stringify({ w: { city: 'Taipei', routeName: '601', stop: '西門', direction: 0, minutes: 3 }, until: now + 3600e3, at: now - 600e3, nativeAt: now - 60e3 }));
  const m = await import('../public/ui/cards/host-web.js');
  m.createWebHost({ base: 'http://x' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(m.currentArrivalWatch(), null, '響過的不恢復');
  assert.equal(localStorage.getItem('abang.arrivalWatch'), null, '存的狀態清掉');
});
