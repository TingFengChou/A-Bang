// 結構化 log（M6-02）：一行一個 JSON、Cloud Logging 欄位、tenantId、金鑰遮蔽、路徑不帶 query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact, routeOf } from '../server/log.js';

const env = { TDX_CLIENT_SECRET: 'super-secret-value-123', CWA_API_KEY: 'CWA-ABCDEFGH-1234', ANTHROPIC_API_KEY: 'short' };
const fixed = () => new Date('2026-11-18T01:02:03.000Z');

test('每筆一行 JSON：time、severity、message、tenantId；child 帶 agentId', () => {
  const lines = [];
  const log = createLogger({ write: (l) => lines.push(l), env, now: fixed });
  log.info('request', { method: 'GET', route: '/api/v1/status', status: 200, ms: 3 });
  log.child({ agentId: 'life' }).warn('budget');
  assert.ok(lines.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n')));
  const [a, b] = lines.map((l) => JSON.parse(l));
  assert.deepEqual(a, { time: '2026-11-18T01:02:03.000Z', severity: 'INFO', message: 'request', tenantId: 'first-party', method: 'GET', route: '/api/v1/status', status: 200, ms: 3 });
  assert.equal(b.severity, 'WARNING');
  assert.equal(b.agentId, 'life');
});

test('錯誤：只記類型、狀態碼、遮過金鑰的訊息與前幾行堆疊', () => {
  const lines = [];
  const log = createLogger({ write: (l) => lines.push(l), env, now: fixed });
  const err = Object.assign(new Error('upstream 401 for key=super-secret-value-123'), { name: 'TdxError', status: 401 });
  log.error('request failed', err, { route: '/api/v1/bus/route' });
  const e = JSON.parse(lines[0]);
  assert.equal(e.severity, 'ERROR');
  assert.equal(e.error.name, 'TdxError');
  assert.equal(e.error.status, 401);
  assert.doesNotMatch(lines[0], /super-secret-value-123/);
  assert.match(e.error.message, /\[redacted\]/);
  assert.ok(e.error.stack.split('\n').length <= 6);
});

test('redact 只遮 ≥ 8 字的金鑰值；routeOf 去掉 query（座標）', () => {
  assert.equal(redact('a CWA-ABCDEFGH-1234 b short', env), 'a [redacted] b short');
  assert.equal(routeOf('/api/v1/nearby?lat=25.04&lon=121.51'), '/api/v1/nearby');
  assert.ok(routeOf(`/${'x'.repeat(300)}`).length <= 121);
});
