// 去政府辦事的官方入口（M16-04d）：只收政府網域的 https、關鍵字對應、L2、規則、示範回答
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGovUrl, govLinks, findGovLinks } from '../core/services/govlinks.js';
import { callTool, listTools } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';

test('網址：只收政府網域的 https（子網域可以），其他一律不收', () => {
  for (const u of ['https://www.mvdis.gov.tw/x', 'https://net.tax.nat.gov.tw/', 'https://id.taipei.gov.taipei/']) assert.equal(isGovUrl(u), true, u);
  for (const u of ['http://www.mvdis.gov.tw/', 'https://mvdis.gov.tw.evil.com/', 'https://gov.tw.example.com', 'javascript:alert(1)', 'https://example.com/?u=gov.tw']) assert.equal(isGovUrl(u), false, u);
  assert.ok(govLinks().length >= 10);
  assert.ok(govLinks().every((l) => isGovUrl(l.url) && l.title && l.site && l.how && l.keys.length));
});

test('對應：長的關鍵字先算、最多 3 個、台／臺都可以、對不到回空', () => {
  assert.equal(findGovLinks('我想查有沒有罰單')[0].id, 'ticket');
  assert.equal(findGovLinks('怎麼報稅')[0].id, 'etax');
  assert.equal(findGovLinks('牌照稅怎麼繳')[0].id, 'localtax');
  assert.equal(findGovLinks('查勞保年資')[0].id, 'bli');
  assert.equal(findGovLinks('行動自然人憑證')[0].id, 'fido');
  assert.ok(findGovLinks('監理 駕照 驗車 考照 戶政 報稅').length <= 3);
  assert.deepEqual(findGovLinks('量子電腦'), []);
});

test('工具：L2、卡片、說法（只給網址、看不到結果）、不要身分證號', async () => {
  const t = listTools().find((x) => x.name === 'gov_official_link');
  assert.equal(t.tier, 'L2');
  const r = await callTool(createServices({ forceMock: true }), 'gov_official_link', { topic: '我想查有沒有罰單' });
  assert.equal(r.card, 'gov-links');
  assert.match(r.speak, /^「交通罰單查詢與繳納」在監理服務網：.+。阿幫只給官方網址，登入、查詢、付款都在官網完成。$/);
  assert.match(r.text, /不要點簡訊或訊息裡的連結/);
  assert.match(t.description, /不要索取身分證號/);
  const none = await callTool(createServices({ forceMock: true }), 'gov_official_link', { topic: '量子電腦' });
  assert.equal(none.data.links.length, 0);
});

test('規則：查／繳／報／預約＋對得到的入口＝官方入口；問要帶什麼、護照等待人數、找戶政仍照原本', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['我想查有沒有罰單', '怎麼報稅', '查勞保年資', '牌照稅怎麼繳', '預約護照']) assert.equal(p(q).govLink, true, q);
  assert.equal(p('報稅要帶什麼').govLink, undefined);
  assert.equal(p('報稅要帶什麼').intent, 'gov');
  assert.equal(p('現在去辦護照人多嗎').govPassport, true);
  assert.equal(p('最近的戶政事務所在哪').govOffice, true);
  assert.equal(p('罰單').govLink, undefined, '只說名詞沒說要做什麼');
});

test('示範模式：給官方入口並提醒不要點簡訊連結', async () => {
  const out = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '我想查有沒有罰單' }] }, (e) => out.push(e));
  assert.ok(out.some((e) => e.type === 'tool_result' && e.tool === 'gov_official_link' && e.ok));
  assert.match(out.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /不要點簡訊/);
});
