// 到站提醒＋短劇（2026-11-22 產品負責人「到站提醒的時候出現，代表他想等，但是不要一直盯著看」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remindAside } from '../core/agent/wait-drama.js';
import { waitHint, WAIT_MIN, WAIT_MAX } from '../core/drama-say.js';
import { createServices } from '../core/index.js';
import { restRoutes } from '../server/rest.js';
import { shouldFetch, waitLeft, watchKey } from '../public/js/wait-drama.js';

const NOW = Date.parse('2026-11-22T10:00:00+08:00');

test('remindAside：等 5～40 分推一集，句子說車快到時會提醒；英文、太短、太長都不推', async () => {
  const svc = createServices({ forceMock: true });
  const a = await remindAside(svc, { waitMin: 12, now: NOW });
  assert.equal(a.kind, 'drama');
  assert.match(a.text, /^還要等約 12 分，車快到時阿幫會提醒[你您]，不用一直盯著：先看一集《.+》第 \d+ 集/);
  assert.ok(a.data.title && a.labels.watch && a.labels.dismiss);
  assert.equal(await remindAside(svc, { waitMin: WAIT_MIN - 1 }), null);
  assert.equal(await remindAside(svc, { waitMin: WAIT_MAX }), null);
  assert.equal(await remindAside(svc, { waitMin: 12, lang: 'en' }), null, '片庫是中文：英文不推');
  assert.equal(await remindAside({}, { waitMin: 12 }), null, '沒有短劇服務');
  assert.match(waitHint({ waitMin: 8, pick: { title: 'X', ep: 2 }, lang: 'en', remind: true }).text, /remind you before it comes/);
});

test('REST /api/v1/drama/wait：檢查分鐘數，回 { aside }', async () => {
  const r = restRoutes(createServices({ forceMock: true }))['/api/v1/drama/wait'];
  assert.match((await r.handler({ min: '15' })).aside.text, /15 分/);
  assert.deepEqual(await r.handler({ min: '2' }), { aside: null });
  await assert.rejects(() => r.handler({ min: 'abc' }), /0～180/);
  await assert.rejects(() => r.handler({ min: '999' }), /0～180/);
});

test('shouldFetch：查到過到站時間、等 5～40 分、設定開著、這個提醒還沒推過才拿', () => {
  const w = { city: 'Taipei', routeName: '307', stop: '臺北車站', direction: 0, last: { etaSec: 600, at: NOW } };
  assert.equal(waitLeft(w, NOW + 60_000), 9);
  assert.equal(shouldFetch({ w, on: true, seen: null, now: NOW }), true);
  assert.equal(shouldFetch({ w, on: false, seen: null, now: NOW }), false, '設定關掉');
  assert.equal(shouldFetch({ w, on: true, seen: watchKey(w), now: NOW }), false, '這個提醒推過了');
  assert.equal(shouldFetch({ w, on: true, seen: null, demo: true, now: NOW }), false, '離線示範版沒有伺服器');
  assert.equal(shouldFetch({ w: { ...w, lang: 'en' }, on: true, seen: null, now: NOW }), false);
  assert.equal(shouldFetch({ w: { ...w, last: { etaSec: 180, at: NOW } }, on: true, seen: null, now: NOW }), false, '3 分就到：不推');
  assert.equal(shouldFetch({ w: { ...w, last: null }, on: true, seen: null, now: NOW }), false, '還沒查到到站時間');
  assert.equal(shouldFetch({ w: { ...w, skip: 900 }, on: true, seen: null, now: NOW }), false, '趕不上這班（skip）');
  assert.equal(shouldFetch({ w: null, on: true, seen: null }), false);
});
