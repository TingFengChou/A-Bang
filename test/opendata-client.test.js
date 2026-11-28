// 開放資料 client（架構審查 2026-11-28）：每日大檔過期先給舊的、背景更新；即時資料照舊等下載；沒有舊資料又失敗時冷卻；大小上限
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenDataClient, FAIL_COOLDOWN_MS, MAX_ENTRIES, OpenDataError } from '../core/opendata-client.js';

/** 可以手動放行的上游：每次下載回傳 { n }，n 是第幾次 */
function upstream() {
  const st = { n: 0, fail: false, hold: null };
  const fetchImpl = async () => {
    st.n++;
    if (st.hold) await st.hold;
    if (st.fail) throw new Error('down');
    return new Response(JSON.stringify({ n: st.n }));
  };
  return { st, fetchImpl };
}

test('每日大檔（TTL ≥ 1 小時）：過期但還能沿用 → 立刻給舊的、背景更新；更新好之後拿新的', async () => {
  let t = 0;
  const { st, fetchImpl } = upstream();
  const od = createOpenDataClient({ now: () => t, fetchImpl });
  const o = { ttlSec: 86400, label: '診所', as: 'json' };
  assert.deepEqual(await od.get('u', o), { n: 1 });
  t = 86400e3 + 1;
  let release;
  st.hold = new Promise((r) => { release = r; });
  assert.deepEqual(await od.get('u', o), { n: 1 }, '不用等下載');
  assert.deepEqual(await od.get('u', o), { n: 1 }, '背景更新中也給舊的');
  assert.equal(st.n, 2, '背景只下載一次');
  release(); st.hold = null;
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await od.get('u', o), { n: 2 });
});

test('即時資料（TTL 60 秒）過期：照舊等下載拿新的，不給兩分鐘前的', async () => {
  let t = 0;
  const { fetchImpl } = upstream();
  const od = createOpenDataClient({ now: () => t, fetchImpl });
  const o = { ttlSec: 60, label: '垃圾車', as: 'json' };
  await od.get('u', o);
  t = 61_000;
  assert.deepEqual(await od.get('u', o), { n: 2 });
});

test('背景更新失敗：沿用舊的；舊的超過沿用期限就丟錯', async () => {
  let t = 0;
  const { st, fetchImpl } = upstream();
  const od = createOpenDataClient({ now: () => t, fetchImpl });
  const o = { ttlSec: 3600, label: '藥局', as: 'json' };
  await od.get('u', o);
  t = 3600e3 + 1; st.fail = true;
  assert.deepEqual(await od.get('u', o), { n: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await od.get('u', o), { n: 1 }, '失敗後仍沿用');
  t = 3 * 3600e3;
  await assert.rejects(od.get('u', o), /藥局連線失敗/);
});

test('沒有舊資料又失敗：冷卻期間不重複下載、回同一個錯誤；冷卻過後再試', async () => {
  let t = 0;
  const { st, fetchImpl } = upstream();
  st.fail = true;
  const od = createOpenDataClient({ now: () => t, fetchImpl });
  const o = { ttlSec: 86400, label: '診所', as: 'json' };
  for (let i = 0; i < 5; i++) await assert.rejects(od.get('u', o), /診所連線失敗/);
  assert.equal(st.n, 1, '5 個請求只打上游一次');
  t = FAIL_COOLDOWN_MS + 1; st.fail = false;
  assert.deepEqual(await od.get('u', o), { n: 2 });
});

test('大小上限：宣告或實際超過就不解析', async () => {
  const od = createOpenDataClient({ fetchImpl: async () => new Response('x'.repeat(2000)) });
  await assert.rejects(od.get('big', { ttlSec: 60, label: '大檔', maxBytes: 1000 }), /大檔回應太大/);
});

test('快取筆數有上限：上游斷線時每個不同網址的失敗紀錄也算，最久沒用的先刪（架構第三輪 #3）', async () => {
  let t = 0;
  const { st, fetchImpl } = upstream();
  const od = createOpenDataClient({ fetchImpl, now: () => t });
  const o = { ttlSec: 600, label: '短劇', as: 'json' };
  await od.get('https://x.example/keep', o); // 常用的那一筆
  st.fail = true;
  for (let i = 0; i < MAX_ENTRIES * 2; i++) {
    await assert.rejects(od.get(`https://x.example/q${i}`, o), (e) => e instanceof OpenDataError && !/stack/.test(Object.keys(e).join()));
    if (i % 50 === 0) { t += 1; assert.deepEqual(await od.get('https://x.example/keep', o), { n: 1 }, '常用的沒被擠掉'); }
  }
  assert.ok(od.size() <= MAX_ENTRIES, `筆數 ${od.size()}`);
  assert.deepEqual(await od.get('https://x.example/keep', o), { n: 1 }, '最近用過的還在（沒重新下載）');
});

test('失敗紀錄只留訊息與狀態碼：服務層照舊分辨上游狀態', async () => {
  const od = createOpenDataClient({ fetchImpl: async () => new Response('nope', { status: 404 }), now: () => 0 });
  await assert.rejects(od.get('https://x.example/a', { ttlSec: 60, label: '藥局' }), (e) => e instanceof OpenDataError && e.upstreamStatus === 404 && /藥局回應錯誤（HTTP 404）/.test(e.message));
  await assert.rejects(od.get('https://x.example/a', { ttlSec: 60, label: '藥局' }), (e) => e.upstreamStatus === 404, '冷卻期間同一個錯誤');
});
