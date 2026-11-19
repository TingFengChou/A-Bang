// 防詐（M7-02／03，AGENT_ANTIFRAUD.md）：CSV 解析、網域正規化與比對、闢謠搜尋、規則與風險等級、寄件號碼、tools 的 L2 說法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvObjects } from '../core/csv.js';
import { hostOf, buildIndex, createAntifraudFromLoader, createAntifraudServices } from '../core/services/antifraud.js';
import { extractUrls, matchRules, riskLevel, checkSender } from '../core/scam-check.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const svc = createServices({ forceMock: true });

test('CSV：BOM、引號內逗號與換行、"" 跳脫、CRLF；缺欄位丟錯', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,"x, ""y""\nz"\r\n\r\n2,3'), [['a', 'b'], ['1', 'x, "y"\nz'], ['2', '3']]);
  assert.deepEqual(csvObjects('a,b\n1,2', ['a']), [{ a: '1', b: '2' }]);
  assert.throws(() => csvObjects('a,b\n1,2', ['網域']), /缺少欄位：網域/);
});

test('hostOf：去協定、www、路徑、port、帳密；中文網域轉 punycode；不是網址回 null', () => {
  assert.equal(hostOf('HTTPS://www.Example.com:8080/a?b#c'), 'example.com');
  assert.equal(hostOf('user@evil.com/x'), 'evil.com');
  assert.equal(hostOf('台灣.tw'), 'xn--kpry57d.tw');
  assert.equal(hostOf('hello'), null);
  assert.equal(hostOf(''), null);
});

test('網址比對：本身或上層網域在清單上都算；不在清單時 listed=false', async () => {
  const a = await svc.antifraud.lookupUrl('https://abc.tw388.xyz/login');
  assert.equal(a.listed, true);
  assert.equal(a.matches[0].domain, 'tw388.xyz');
  assert.equal(a.matches[0].category, '釣魚網站');
  assert.match(a.matches[0].month, /^\d{4}-\d{2}$/); // 民國年月 → 西元
  assert.equal((await svc.antifraud.lookupUrl('gov.tw')).listed, false);
  assert.equal((await svc.antifraud.lookupUrl('not a url')).domain, null);
});

test('闢謠搜尋：標題命中優先，沒有命中回空陣列', async () => {
  const r = await svc.antifraud.searchMyths('解除分期付款');
  assert.ok(r.length >= 3);
  assert.ok(r.every((x) => /分期/.test(x.title)));
  assert.deepEqual(await svc.antifraud.searchMyths('量子力學'), []);
});

test('載入：24 小時快取；更新失敗時沿用舊索引；第一次就失敗回清楚的錯誤', async () => {
  let t = 0, n = 0, fail = false;
  const csv = { sitesCsv: '民國年月,網域,網站性質\n11412,bad.com,金融保險', mythsCsv: '編號,標題,發佈時間,發佈內容\n1,假投資,2026/01/01 10:00,內容' };
  const s = createAntifraudFromLoader({ now: () => t, load: async () => { n++; if (fail) throw new Error('boom'); return csv; } }).antifraud;
  assert.equal((await s.lookupUrl('bad.com')).listed, true);
  await s.lookupUrl('x.com');
  assert.equal(n, 1);
  t = 25 * 3600e3; fail = true;
  assert.equal((await s.lookupUrl('bad.com')).listed, true); // 沿用舊的
  const broken = createAntifraudFromLoader({ load: async () => { throw new Error('boom'); } }).antifraud;
  await assert.rejects(broken.lookupUrl('a.com'), (e) => e.name === 'OpenDataError' && /165 開放資料/.test(e.message));
  const net = createAntifraudServices({ fetchImpl: async () => { throw new Error('ECONNRESET https://x?key=1'); } }).antifraud;
  await assert.rejects(net.stats(), (e) => e.name === 'OpenDataError' && !/key=/.test(e.message));
  assert.equal(buildIndex(csv).sites.size, 1);
});

test('規則：抽網址（不含金額）、命中片段、權重與等級', () => {
  assert.deepEqual(extractUrls('請到 https://a.bad.com/x?y=1 或 evil.shop/login，金額 1.5 萬'), ['https://a.bad.com/x?y=1', 'evil.shop/login']);
  const f = matchRules('您的包裹地址不完整，請點擊連結補運費，並提供驗證碼');
  assert.deepEqual(f.map((x) => x.id).sort(), ['click-link', 'otp', 'parcel-phish']);
  assert.ok(f.every((x) => x.excerpt.length > 0));
  assert.equal(riskLevel(0, true), 'high');
  assert.equal(riskLevel(6, false), 'high');
  assert.equal(riskLevel(3, false), 'medium');
  assert.equal(riskLevel(2, false), 'low');
});

test('寄件號碼：111、國際、個人手機、短碼、文字名稱', () => {
  assert.equal(checkSender('111').risk, 'low');
  assert.equal(checkSender('+63 912 345 6789').risk, 'high');
  assert.equal(checkSender('+886912345678').kind, '個人手機號碼');
  assert.equal(checkSender('0912-345-678').risk, 'medium');
  assert.equal(checkSender('68000').kind, '企業簡訊短碼');
  assert.equal(checkSender('台電公司').kind, '文字名稱');
});

test('tools：高風險、低風險（L2：不說安全）、網址查詢、闢謠、寄件號碼', async () => {
  const hi = await callTool(svc, 'scam_check_message', { text: '【台電】電費逾期未繳，今日內未處理將停電，請點擊 https://eincioiice-tw-nat-gov.com/pay' });
  assert.equal(hi.card, 'scam-risk');
  assert.equal(hi.data.level, 'high');
  assert.ok(hi.data.urls[0].listed);
  assert.ok(hi.data.advice.some((a) => /165/.test(a)));
  assert.match(hi.speak, /高風險/);
  const lo = await callTool(svc, 'scam_check_message', { text: '明天中午一起吃飯嗎？' });
  assert.equal(lo.data.level, 'low');
  for (const s of [lo.speak, lo.text, ...lo.data.advice]) assert.doesNotMatch(s.replace(/不代表一定安全|不代表安全/g, ''), /安全/);
  const u = await callTool(svc, 'scam_lookup_url', { url: 'gov.tw' });
  assert.match(u.text, /不代表(一定)?安全/);
  const m = await callTool(svc, 'scam_myth_search', { query: '假冒台電' });
  assert.ok(m.data.results.length > 0);
  const s = await callTool(svc, 'sms_sender_check', { sender: '111' });
  assert.match(s.text, /政府機關/);
  await assert.rejects(callTool(svc, 'scam_check_message', { text: 'x'.repeat(2001) }), /參數錯誤/);
});
