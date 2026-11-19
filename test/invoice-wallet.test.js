// 我的發票（本機）：新增驗證、去重、要對獎的判斷、對獎結果寫回與「新中獎」只通知一次（以假 localStorage，不需瀏覽器）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { wallet, needsCheck, checkWallet, autoCheckOnOpen, todayTW } = await import('../public/js/invoice-wallet.js');
const { callTool } = await import('../core/tools/index.js');
const { createServices } = await import('../core/index.js');
const svc = createServices({ forceMock: true });
const call = (name, args) => callTool(svc, name, args);

beforeEach(() => store.clear());

test('新增：8 碼、日期不能是未來、同號碼同日期不重複', () => {
  wallet.add({ number: 'AB-54348835', date: '2026-08-03' });
  assert.equal(wallet.list()[0].number, '54348835');
  assert.throws(() => wallet.add({ number: '54348835', date: '2026-08-03' }), /存過了/);
  assert.throws(() => wallet.add({ number: '123', date: '2026-08-03' }), /8 位數字/);
  assert.throws(() => wallet.add({ number: '12345678', date: '2999-01-01' }), /還沒到/);
  assert.throws(() => wallet.add({ number: '12345678' }), /消費日期/);
  wallet.remove(wallet.list()[0].id);
  assert.equal(wallet.list().length, 0);
});

test('needsCheck：沒對過要對；待開獎到開獎日才對；已有結果不再對', () => {
  assert.ok(needsCheck({}, '2026-11-19'));
  assert.ok(!needsCheck({ status: 'pending', drawDate: '2026-11-25' }, '2026-11-19'));
  assert.ok(needsCheck({ status: 'pending', drawDate: '2026-11-25' }, '2026-11-25'));
  for (const status of ['won', 'lost', 'unavailable']) assert.ok(!needsCheck({ status }, '2026-11-19'));
});

test('checkWallet：結果寫回本機；中獎只在第一次回報；沒有要對的回 null', async () => {
  wallet.add({ number: '54348835', date: '2026-08-03' });
  wallet.add({ number: '00000001', date: '2026-07-10' });
  wallet.add({ number: '11111111', period: '11509' });
  const r = await checkWallet(call, { all: true });
  assert.deepEqual(r.won.map((w) => [w.number, w.prize]), [['54348835', '頭獎']]);
  assert.equal(r.decided, 2);
  const by = Object.fromEntries(wallet.list().map((x) => [x.number, x]));
  assert.equal(by['54348835'].status, 'won');
  assert.equal(by['00000001'].status, 'lost');
  assert.equal(by['11111111'].status, 'pending');
  assert.equal(by['11111111'].drawDate, '2026-11-25');
  // 再對一次：只剩待開獎的；開獎日還沒到就不送（測試在開獎日之後執行時略過這項）
  if (todayTW() < '2026-11-25') assert.equal(await checkWallet(call), null);
});

test('autoCheckOnOpen：開獎日已到的待開獎發票自動對獎，中獎主動通知', async () => {
  const toasts = [];
  assert.equal(await autoCheckOnOpen(call, { toast: (m) => toasts.push(m) }), null, '沒有發票時不呼叫');
  // 模擬：上次存的時候還沒開獎（pending，開獎日已過），現在示範資料已有 11507 期
  store.set('invoices', JSON.stringify([{ id: 'a', number: '54348835', period: '11507', status: 'pending', drawDate: '2026-09-25' }]));
  const r = await autoCheckOnOpen(call, { toast: (m) => toasts.push(m) });
  assert.equal(r.won.length, 1);
  assert.match(toasts.at(-1), /中獎了.+54348835 頭獎/);
  assert.equal(await autoCheckOnOpen(call, { toast: (m) => toasts.push(m) }), null, '對過就不再通知');
});
