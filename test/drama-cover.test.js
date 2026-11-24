// 短劇封面（伺服器代抓，ADR-0019 2026-11-23）：網址驗證、看檔頭、只抓允許的主機、快取、示範海報、往上不帶上游網址
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverSrc, sniffImage, createCoverFetcher, createDramaServices, COVER_MAX_BYTES } from '../core/services/drama.js';
import { createMockDramaServices, demoPoster, demoDramaFetchers } from '../core/services/drama-mock.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const GIF = Buffer.from('GIF89a....');
const res = (body, { status = 200, headers = {} } = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: [body] });

test('coverSrc：只收 https、沒有帳密、500 字以內', () => {
  assert.equal(coverSrc('https://img.example.com/a.jpg'), 'https://img.example.com/a.jpg');
  for (const bad of ['http://img.example.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,xx', 'https://u:p@img.example.com/a.jpg', `https://img.example.com/${'a'.repeat(500)}`, '', null, 3, {}]) assert.equal(coverSrc(bad), null, String(bad));
});

test('sniffImage：看檔頭，只認 JPEG／PNG／WebP／GIF（不收 SVG、HTML）', () => {
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(WEBP), 'image/webp');
  assert.equal(sniffImage(GIF), 'image/gif');
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), Buffer.from('<html>'), Buffer.alloc(0), null]) assert.equal(sniffImage(bad), null);
});

test('createCoverFetcher：只抓允許的主機、https、預設埠；不跟轉址；檔頭不是圖、太大都不要', async () => {
  const calls = [];
  const fetchImpl = async (url, o) => { calls.push([url, o.redirect]); return res(JPEG, { headers: { 'content-type': 'image/jpeg' } }); };
  const get = createCoverFetcher({ hosts: ['img.example.com'], fetchImpl });
  const ok = await get({ _cover: 'https://img.example.com/a.jpg' });
  assert.equal(ok.type, 'image/jpeg');
  assert.deepEqual(calls[0], ['https://img.example.com/a.jpg', 'error']);
  for (const bad of ['https://evil.example.com/a.jpg', 'http://img.example.com/a.jpg', 'https://img.example.com:8443/a.jpg', 'https://img.example.com.evil.tw/a.jpg']) await assert.rejects(get({ _cover: bad }), /允許清單/, bad);
  const html = createCoverFetcher({ hosts: ['img.example.com'], fetchImpl: async () => res(Buffer.from('<html>'), { headers: { 'content-type': 'image/jpeg' } }) });
  await assert.rejects(html({ _cover: 'https://img.example.com/a.jpg' }), /不是圖片/);
  const big = createCoverFetcher({ hosts: ['img.example.com'], fetchImpl: async () => res(Buffer.concat([JPEG, Buffer.alloc(COVER_MAX_BYTES)])) });
  await assert.rejects(big({ _cover: 'https://img.example.com/a.jpg' }), /太大/);
  const declared = createCoverFetcher({ hosts: ['img.example.com'], fetchImpl: async () => res(JPEG, { headers: { 'content-length': String(COVER_MAX_BYTES + 1) } }) });
  await assert.rejects(declared({ _cover: 'https://img.example.com/a.jpg' }), /太大/);
  const notFound = createCoverFetcher({ hosts: ['img.example.com'], fetchImpl: async () => res(JPEG, { status: 404 }) });
  await assert.rejects(notFound({ _cover: 'https://img.example.com/a.jpg' }), /404/);
});

test('服務：排行只說「有封面」，不帶上游網址；cover(id) 代抓並快取；抓不到 10 分內不再試', async () => {
  let n = 0, fail = false, t = 0;
  const fx = { ...demoDramaFetchers, cover: async () => { n++; if (fail) throw new Error('x'); return { body: JPEG, type: 'image/jpeg' }; } };
  const svc = createDramaServices(fx, { now: () => t });
  const r = await svc.drama.picks({ list: 'hot', limit: 3 });
  assert.ok(r.items.every((s) => s.cover === true && !('_cover' in s)));
  assert.ok(!JSON.stringify(r).includes('demo.invalid'), '上游封面網址不往上傳');
  const id = r.items[0].id;
  assert.equal((await svc.drama.cover({ id })).type, 'image/jpeg');
  await svc.drama.cover({ id });
  assert.equal(n, 1, '快取');
  t += 25 * 3600e3; // 一天後重抓
  await svc.drama.cover({ id });
  assert.equal(n, 2);
  // 沒在排行看過的劇：查單劇拿封面網址
  fail = true;
  const other = (await demoDramaFetchers.ranking('hot')).at(-1).id;
  assert.equal(await svc.drama.cover({ id: other }), null);
  assert.equal(await svc.drama.cover({ id: other }), null);
  assert.equal(n, 3, '抓不到的 10 分內不再試');
  for (const bad of ['../x', '', 'a'.repeat(65), null]) assert.equal(await svc.drama.cover({ id: bad }), null);
  assert.equal(await svc.drama.cover({ id: 'no-such-drama' }), null);
  // 沒有 cover 抓取器（舊介面）：一律沒有封面
  const noFx = createDramaServices({ ...demoDramaFetchers, cover: undefined });
  assert.equal(await noFx.drama.cover({ id }), null);
});

test('示範：自己畫海報（SVG，標示範）；劇名跳脫；等車推劇也帶 cover', async () => {
  const svc = createMockDramaServices();
  const { items } = await svc.drama.picks({});
  const img = await svc.drama.cover({ id: items[0].id });
  assert.equal(img.type, 'image/svg+xml');
  assert.match(img.body.toString(), /示範/);
  const evil = demoPoster({ id: 'x', title: '<script>&"' });
  assert.ok(!/<scr|<\/scr/.test(evil) && evil.includes('&lt;scr') && evil.includes('&amp;&quot;'));
  assert.equal((await svc.drama.waitPick({})).cover, true);
});
