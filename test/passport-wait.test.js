// 護照現場等待人數（M16-04c）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePassportWait, twClock, createPassportServices, createLivePassportFetchers, PASSPORT_URL, PASSPORT_TTL_SEC } from '../core/services/passport.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';

const XML = `<?xml version="1.0"?><rss><channel><pubDate>Fri, 27 Nov 2026 03:53:01 GMT</pubDate>
<item><location><![CDATA[外交部領事事務局]]></location><AP_GeneralInProcessNumber>3206</AP_GeneralInProcessNumber><AP_GeneralWaitingPersonCount>78</AP_GeneralWaitingPersonCount><AP_OnlineInProcessNumber>286</AP_OnlineInProcessNumber><AP_OnlineWaitingPersonCount>0</AP_OnlineWaitingPersonCount><RP_InProcessNumber>7357</RP_InProcessNumber><RP_WaitingPersonCount>3</RP_WaitingPersonCount></item>
<item><location><![CDATA[外交部中部辦事處]]></location><AP_GeneralWaitingPersonCount>2</AP_GeneralWaitingPersonCount><AP_OnlineWaitingPersonCount>1</AP_OnlineWaitingPersonCount><RP_AMWaitingPersonCount>4</RP_AMWaitingPersonCount><RP_PMWaitingPersonCount>5</RP_PMWaitingPersonCount></item>
<item><location><![CDATA[壞資料]]></location></item>
</channel></rss>`;

test('解析：一般件、網路預約件、領件（上下午合計）、更新時間；沒有數字的據點不列', () => {
  const d = parsePassportWait(XML);
  assert.equal(d.updatedAt, '2026-11-27T03:53:01.000Z');
  assert.equal(twClock(d.updatedAt), '11:53');
  assert.deepEqual(d.offices.map((o) => o.short), ['領務局（臺北）', '中部辦事處（臺中）']);
  assert.deepEqual(d.offices[0].general, { waiting: 78, now: 3206 });
  assert.equal(d.offices[1].pickup.waiting, 9, '上午 4＋下午 5');
  assert.deepEqual(parsePassportWait('<rss></rss>'), { updatedAt: null, offices: [] });
});

test('服務：選據點（台／臺都可以）、找不到就全部；快取 60 秒；附網路預約連結', async () => {
  const calls = [];
  const svc = createPassportServices(createLivePassportFetchers({ od: { get: async (url, o) => { calls.push([url, o.ttlSec]); return XML; } } }));
  assert.equal((await svc.passportWait({ office: '台中' })).offices[0].short, '中部辦事處（臺中）');
  assert.equal((await svc.passportWait({ office: '花蓮' })).offices.length, 2, '沒有那個據點就列全部');
  const all = await svc.passportWait();
  assert.match(all.booking, /^https:\/\/ppass\.boca\.gov\.tw/);
  assert.deepEqual(calls[0], [PASSPORT_URL, PASSPORT_TTL_SEC]);
  assert.equal(PASSPORT_TTL_SEC, 60);
});

test('工具（示範資料是真實數字）：說法只報人數、不換算時間', async () => {
  const r = await callTool(createServices({ forceMock: true }), 'passport_waiting', {});
  assert.equal(r.card, 'passport-wait');
  assert.equal(r.mode, 'demo');
  assert.match(r.speak, /^領務局（臺北）：申辦一般件 \d+ 人在等、網路預約件 \d+ 人在等、領護照 \d+ 人在等（\d{2}:\d{2} 更新）。$/);
  assert.doesNotMatch(r.speak + r.text, /\d+\s*分鐘/);
  assert.match(r.text, /只有人數、沒有預估時間/);
});

test('規則：護照現場人多不多（含據點）；問要帶什麼仍是辦事須知', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['現在去辦護照人多嗎', '領務局要等多久', '護照現場要排隊嗎']) assert.equal(p(q).govPassport, true, q);
  assert.equal(p('高雄辦護照現場人多不多').passportOffice, '南部');
  assert.equal(p('辦護照要帶什麼').govPassport, undefined);
  assert.equal(p('勞保局辦事處現場人多嗎').govPassport, undefined, '別的辦事處不是護照');
  assert.equal(p('辦護照要帶什麼').intent, 'gov');
});

test('示範模式：查等待人數、提醒網路預約', async () => {
  const out = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '現在去辦護照人多嗎' }] }, (e) => out.push(e));
  assert.ok(out.some((e) => e.type === 'tool_result' && e.tool === 'passport_waiting' && e.ok));
  assert.match(out.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /網路預約/);
});
