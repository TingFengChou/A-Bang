// 導訂票（M3-12 ⛔ 權限前的部分）：參數驗證、示範連結、真實版回「尚未開通」並附官方網站、tool L2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, createBookingServices, OFFICIAL_BOOKING, bookingSummary } from '../core/services/booking.js';
import { createMockBookingServices } from '../core/services/booking-mock.js';
import { callTool, getTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const NOW = Date.parse('2026-11-18T10:00:00+08:00');
const rail = {
  thsrStations: async () => [{ id: '1000', name: '台北' }, { id: '1070', name: '左營' }],
  traStations: async () => [{ id: '1000', name: '臺北' }, { id: '4400', name: '高雄' }],
};
const OK = { system: 'THSR', trainNo: '123', date: '2026-11-20', from: '台北', to: '左營', tickets: 2, carType: 'business' };

test('validateBooking：車次、張數、日期範圍、車廂只限高鐵、車站與起訖相同', async () => {
  const b = await validateBooking(rail, OK, NOW);
  assert.equal(bookingSummary(b), '高鐵 123 次 2026-11-20 台北→左營 2 張（商務車廂）');
  const bad = async (patch, re) => assert.rejects(validateBooking(rail, { ...OK, ...patch }, NOW), re);
  await bad({ trainNo: '12a' }, /車次/);
  await bad({ tickets: 5 }, /張數/);
  await bad({ date: '2026-11-17' }, /乘車日期需在今天（2026-11-18）到 2026-12-16 之間/);
  await bad({ date: '2026-12-17' }, /乘車日期/);
  await bad({ system: 'TRA', from: '臺北', to: '高雄' }, /只有高鐵可以選車廂/);
  await bad({ to: '台北' }, /起訖站不可相同/);
  await bad({ to: '火星' }, /找不到高鐵車站/);
});

test('示範版：官方網站首頁、時效、標示示範', async () => {
  const r = await createMockBookingServices({ rail }).booking.railLink({ ...OK, system: 'TRA', from: '臺北', to: '高雄', carType: undefined }, NOW);
  assert.deepEqual([r.url, r.demo, r.expiresAt], [OFFICIAL_BOOKING.TRA, true, '2026-11-18T02:15:00.000Z']);
  assert.match(r.note, /不會自動帶入車次/);
});

test('真實版（權限前）：回「尚未開通」與官方訂票網站，不呼叫導訂票端點', async () => {
  const { booking } = createBookingServices(null, { rail });
  await assert.rejects(booking.railLink({ ...OK, date: new Date(Date.now() + 8 * 3600e3 + 864e5).toISOString().slice(0, 10) }),
    (e) => e.name === 'UserError' && /尚未開通/.test(e.message) && e.message.includes(OFFICIAL_BOOKING.THSR));
});

test('rail_booking_link tool：L2、確認文字、參數錯誤', async () => {
  assert.equal(getTool('rail_booking_link').tier, 'L2');
  const svc = createServices({ forceMock: true });
  const date = new Date(Date.now() + 8 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const r = await callTool(svc, 'rail_booking_link', { system: 'THSR', trainNo: '123', date, from: '台北', to: '左營' });
  assert.match(r.data.confirmText, /要開啟高鐵官方訂票網站嗎/);
  assert.match(r.speak, /^高鐵 123 次 .+ 台北→左營 1 張的訂票連結準備好了/);
  await assert.rejects(callTool(svc, 'rail_booking_link', { system: 'THSR', trainNo: '123', date, from: '台北', to: '左營', tickets: 9 }), /參數錯誤/);
});
