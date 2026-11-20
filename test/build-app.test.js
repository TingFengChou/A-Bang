// 手機 App 打包（ADR-0013）：API 位址驗證與注入
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, injectConfig } from '../scripts/build-app.js';

test('apiBase：只收 http(s) 網域、去掉結尾斜線；正式版只收 https', () => {
  assert.equal(apiBase('https://abang.example.tw/'), 'https://abang.example.tw');
  assert.equal(apiBase('http://10.0.2.2:8787'), 'http://10.0.2.2:8787');
  assert.throws(() => apiBase('http://10.0.2.2:8787', { release: true }), /必須是 https/);
  assert.throws(() => apiBase('javascript:alert(1)'), /http 或 https/);
  assert.throws(() => apiBase('https://a.tw/api'), /只填網域/);
  assert.throws(() => apiBase(''), /ABANG_API_BASE/);
});

test('injectConfig：在 </head> 前注入 API 位址與 App 旗標，網址字元不會結束 script', () => {
  const out = injectConfig('<html><head><title>x</title></head><body></body></html>', 'https://a.tw');
  assert.match(out, /<script>window\.__ABANG_API_BASE__="https:\/\/a\.tw";window\.__ABANG_APP__=true;<\/script>\n<\/head>/);
  assert.ok(!injectConfig('<head></head>', 'https://a.tw/</script>').includes('</script>/'));
  assert.throws(() => injectConfig('<html></html>', 'https://a.tw'), /<\/head>/);
});
