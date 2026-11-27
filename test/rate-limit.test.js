// 限流（架構第二輪 #5）：IPv6 以 /64 當同一個人；key 有上限；清理間隔最多 60 秒
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, ipKey, clientIp } from '../server/rate-limit.js';

test('ipKey：IPv4 照原樣、IPv4-mapped 轉回 IPv4、IPv6 取 /64、壞的照原樣', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64');
  assert.equal(ipKey('2001:db8:abcd:12::9'), '2001:db8:abcd:12::/64', '同一個 /64、換位址還是同一個 key');
  assert.equal(ipKey('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8:0:0::/64');
  assert.equal(ipKey('fe80::1%en0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey(''), 'unknown');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '2001:db8:1:2:aaaa::1' } }), '2001:db8:1:2::/64');
});

test('同一個 /64 換位址也算同一個人', () => {
  const check = createRateLimiter({ limit: 2 });
  assert.equal(check(ipKey('2001:db8:1:2::1')).ok, true);
  assert.equal(check(ipKey('2001:db8:1:2::2')).ok, true);
  assert.equal(check(ipKey('2001:db8:1:2::3')).ok, false);
});

test('key 有上限：滿了淘汰最舊的；每日限流 60 秒內就會清過期的', () => {
  let t = 0;
  const check = createRateLimiter({ limit: 1, maxKeys: 3, now: () => t });
  for (const k of ['a', 'b', 'c', 'd']) check(k);
  assert.equal(check('a').ok, true, 'a 被淘汰了：重新算');
  const day = createRateLimiter({ limit: 1, windowMs: 86_400_000, now: () => t });
  day('x'); assert.equal(day('x').ok, false);
  t = 86_400_001; assert.equal(day('x').ok, true, '視窗過了重新算');
});
