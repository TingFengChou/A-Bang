// 去政府辦事要帶什麼（M16-04a）：我的E政府申辦服務資料的整理、搜尋、工具、規則、示範回答
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, mergeServices, serviceQuery, searchServices, docsList, toItem, createGovServices, createLiveGovFetchers, GOV_URLS, GOV_TTL_SEC } from '../core/services/govservice.js';
import { createMockGovServices } from '../core/services/govservice-mock.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { parseIntent, demoSummary } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';

const row = (ch, o) => {
  const p = { online: '線上申辦', counter: '臨櫃', other: '電郵傳真' }[ch];
  return { 服務代碼: o.id, 標題: o.title, [`${p}_應備證件`]: o.docs ?? '無資料', [`${p}_作業天數`]: o.days ?? '', [`${p}_聯絡窗口`]: '', 修改日期時間: o.updated || '20250101T000000', 單位OID: o.oid || '2.16.886.101.20003.20001', 頁面連結: o.url || 'https://www.gov.tw/x.html', ...(o.link && { [ch === 'online' ? '線上申辦連結' : '臨櫃_表單下載連結']: o.link }) };
};

test('整理文字：HTML、雜訊、無資料', () => {
  assert.equal(cleanText('<p>本人&nbsp;印章</p>'), '本人 印章');
  assert.equal(cleanText('無資料'), '');
  assert.equal(cleanText('301000000A-123$font$'), '301000000A-123');
});

test('合併三個檔：同一個服務代碼算一筆、管道、臨櫃的應備證件優先、連結只收 https、最新的修改日期', () => {
  const s = mergeServices({
    counter: [row('counter', { id: 'A', title: '戶籍謄本核發', docs: '一、身分證。二、印章。', days: '當日', updated: '20240102T000000', link: 'http://x.tw/form' })],
    online: [row('online', { id: 'A', title: '戶籍謄本核發', docs: '自然人憑證', updated: '20250301T000000', link: 'https://ris.gov.tw/online' })],
    other: [],
  });
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].channels, ['counter', 'online']);
  assert.equal(s[0].docs, '一、身分證。二、印章。', '臨櫃的應備證件');
  assert.equal(s[0].formUrl, undefined, 'http 不收');
  assert.equal(s[0].onlineUrl, 'https://ris.gov.tw/online');
  assert.equal(s[0].updated, '2025-03-01');
  assert.equal(s[0].central, true);
});

test('口語 → 公文用字；應備證件分條', () => {
  assert.equal(serviceQuery('換身分證要帶什麼'), '國民身分證換發');
  assert.equal(serviceQuery('我要申請戶籍謄本'), '申請戶籍謄本');
  assert.equal(serviceQuery('第一次辦護照要準備什麼'), '首次申請護照');
  assert.equal(serviceQuery('搬家遷戶口怎麼辦'), '遷入登記');
  assert.equal(serviceQuery('行照不見了'), '行照補發');
  assert.equal(serviceQuery('高雄那瑪夏區戶籍謄本'), '高雄那瑪夏區戶籍謄本', '只拿掉句首的「那」');
  assert.equal(serviceQuery('那結婚登記呢'), '結婚登記');
  assert.deepEqual(docsList('一、初領：1.印章。2.戶口名簿。二、換領：舊身分證'), ['一、初領：1.印章', '2.戶口名簿', '二、換領：舊身分證']);
  assert.equal(docsList('無資料').length, 0);
  assert.ok(docsList('字'.repeat(300))[0].endsWith('…'));
});

test('搜尋：中央機關優先、別的縣市與英文版排後、同名只留一筆、差太多不列', () => {
  const all = mergeServices({ counter: [
    row('counter', { id: '1', title: '結婚登記', docs: '身分證' }),
    row('counter', { id: '2', title: '臺中市結婚登記', oid: '2.16.886.101.90027.20002' }),
    row('counter', { id: '3', title: '結婚登記', oid: '2.16.886.101.90020.1' }),
    row('counter', { id: '4', title: '出生登記', docs: '出生證明' }),
    row('counter', { id: '5', title: '英文戶籍謄本', docs: 'x' }),
    row('counter', { id: '6', title: '戶籍謄本核發', docs: 'x' }),
  ] });
  const r = searchServices(all, '結婚登記要帶什麼');
  assert.equal(r.items[0].id, '1');
  assert.ok(!r.items.some((s) => s.id === '3'), '同名只留中央的');
  assert.ok(!r.items.some((s) => s.id === '4'), '只有「登記」兩字相同的不列');
  assert.equal(searchServices(all, '結婚登記', { county: '臺中市' }).items.some((s) => s.id === '2'), true, '在臺中市：地方版也列');
  assert.equal(searchServices(all, '戶籍謄本').items[0].id, '6', '沒說英文就不是英文版');
  assert.equal(searchServices(all, '量子電腦').items.length, 0);
  assert.equal(searchServices(all, '要帶什麼').items.length, 0, '只有問法、沒有辦的事');
});

test('正規化資料：不漏原始欄位名稱', () => {
  const it = toItem(mergeServices({ counter: [row('counter', { id: 'A', title: '戶口名簿', docs: '印章', days: '當日' })] })[0]);
  assert.deepEqual(Object.keys(it).sort(), ['central', 'channels', 'contact', 'days', 'docs', 'eligibility', 'formUrl', 'id', 'onlineUrl', 'process', 'title', 'updated', 'url']);
  assert.ok(!JSON.stringify(it).includes('臨櫃_'));
});

test('真實下載：三個網址、快取一天、去掉 BOM、電郵傳真檔拿不到不影響、同一份資料只合併一次', async () => {
  const calls = [];
  const od = { get: async (url, o) => { calls.push([url, o.ttlSec]); if (url === GOV_URLS.other) throw new Error('403'); return o.parse(`\uFEFF${JSON.stringify([row(url === GOV_URLS.online ? 'online' : 'counter', { id: 'A', title: '戶籍謄本核發', docs: '印章' })])}`); } };
  const g = createGovServices(createLiveGovFetchers({ od }));
  const r = await g.serviceInfo({ query: '戶籍謄本' });
  assert.equal(r.items[0].title, '戶籍謄本核發');
  assert.deepEqual(calls.map((c) => c[1]), [GOV_TTL_SEC, GOV_TTL_SEC, GOV_TTL_SEC]);
  assert.equal(GOV_TTL_SEC, 86400);
});

test('示範資料（真實片段）＋工具：說法、卡片、示範標註、找不到', async () => {
  const g = createMockGovServices();
  assert.equal((await g.serviceInfo({ query: '換身分證要帶什麼' })).items[0].title, '國民身分證初發、補發、換發');
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'gov_service_info', { query: '換身分證' });
  assert.equal(r.card, 'gov-service');
  assert.equal(r.mode, 'demo');
  assert.match(r.speak, /^「國民身分證初發、補發、換發」：可以臨櫃辦，當日完成（資料 \d{4}-\d{2}-\d{2} 更新，以機關公告為準）。$/);
  assert.match(r.text, /應備證件：\n- /);
  assert.match(r.text, /阿幫不代替申辦或送件/);
  const none = await callTool(svc, 'gov_service_info', { query: '量子電腦補助' });
  assert.equal(none.data.items.length, 0);
  assert.match(none.speak, /沒有找到「量子電腦補助」/);
});

test('規則：辦事須知（說了地點也是）；問路、帶護照去機場、公車不是', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['換身分證要帶什麼', '戶籍謄本怎麼申請', '第一次辦護照要準備什麼', '去板橋戶政換身分證要帶什麼', '護照掉了怎麼辦', '結婚登記', '勞保生育給付怎麼申請', '遷戶口要帶什麼']) assert.equal(p(q).intent, 'gov', q);
  for (const q of ['去戶政事務所怎麼走', '帶護照去機場', '307 到哪了', '今天會下雨嗎']) assert.notEqual(p(q).intent, 'gov', q);
  assert.equal(parseIntent('隨便一句', { history: [], intent: 'gov' }).intent, 'gov', '判斷層說是辦事');
});

test('示範模式：查我的E政府、回答照資料並說不代替申辦', async () => {
  const out = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '換身分證要帶什麼' }] }, (e) => out.push(e));
  assert.ok(out.some((e) => e.type === 'tool_result' && e.tool === 'gov_service_info' && e.ok && e.card === 'gov-service'));
  const text = out.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  assert.match(text, /當日完成/);
  assert.match(text, /阿幫不代替申辦/);
  assert.match(demoSummary({ intent: 'gov' }, {}), /暫時拿不到/);
});

test('長輩常辦的事與台語說法（PM 審查 2026-11-28）：規則聽得懂、口語換成標題用字；戶政幾點開是找戶政', async () => {
  const { serviceQuery } = await import('../core/services/govservice.js');
  const { parseIntent, docShort } = await import('../core/agent/demo-intent.js');
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['健保卡不見了', '老人健保卡遺失補辦', '敬老卡要怎麼辦', '我要去區公所辦低收入戶要準備什麼', '中低收入老人津貼怎麼申請', '身障手冊換證明要帶什麼', '阮孫仔欲報戶口，愛紮啥物', '重陽禮金怎麼領', '印章不見了要怎麼辦']) assert.equal(p(q).intent, 'gov', q);
  for (const q of ['戶政事務所幾點開', '戶政事務所禮拜六有開嗎', '戶政營業時間']) assert.equal(p(q).govOffice, true, q);
  for (const [q, want] of [['健保卡不見了', '換發健保卡'], ['老人健保卡遺失補辦', '換發健保卡'], ['我要去區公所辦低收入戶要準備什麼', '低收入戶申請'], ['中低收入老人津貼怎麼申請', '中低收入老人生活津貼'], ['身障手冊換證明要帶什麼', '身心障礙證明換發'], ['阮孫仔欲報戶口，愛紮啥物', '出生登記'], ['重陽禮金怎麼領', '敬老禮金'], ['印章不見了要怎麼辦', '印鑑登記'], ['換身分證要帶什麼', '國民身分證換發']]) assert.equal(serviceQuery(q), want, q);
  assert.equal(serviceQuery('低收入戶房屋稅減免'), '低收入戶房屋稅減免', '已經是標題用字的不再換');
  assert.equal(docShort('一、請領健保卡申請表。'), '請領健保卡申請表');
  assert.equal(docShort('新臺幣200元'), '新臺幣200元');
  for (const x of ['初領或補領', '未滿14歲', '委託申請者', '當事人、利害關係人親自申請者：請攜帶國民身分證正本、印章']) assert.equal(docShort(x), null, x);
});
