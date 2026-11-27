// 找最近的戶政事務所、今天是不是上班日（M16-04b）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffices, parseTels, parseCalendar, calendarUrl, workdayOf, taipeiDay, createGovOfficeServices, createLiveGovOfficeFetchers, OFFICE_URLS, OFFICE_TTL_SEC, CALENDAR_TTL_SEC } from '../core/services/govoffice.js';
import { createMockGovOfficeServices } from '../core/services/govoffice-mock.js';
import { todaySay } from '../core/tools/gov.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { parseIntent, needsLocation } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';

const CSV = '\uFEFF序號,名稱,地址,座標經度,座標緯度\n1,基隆市政府,基隆市中正路236號,121.759176,25.140941\n2,臺北市中正區戶政事務所,臺北市中正區,121.5194,25.0322\n3,臺北市信義區戶政事務所,臺北市信義區,121.5667,25.0330\n4,壞座標戶政事務所,哪裡,0,0\n';
const TPE = Date.UTC(2026, 10, 27, 2); // 2026-11-27（五）10:00 台灣時間

test('解析：只留戶政事務所、台灣範圍的座標；電話；日曆；當年日曆網址（不要 Google 版）', () => {
  const o = parseOffices(CSV);
  assert.deepEqual(o.map((x) => x.name), ['臺北市中正區戶政事務所', '臺北市信義區戶政事務所']);
  assert.equal(parseOffices('序號,名稱,地址,座標經度,座標緯度\n1,臺北市大安區戶政事務所,"臺北市大安區新生南路2段86號,2樓",121.53,25.02\n')[0]?.address, '臺北市大安區新生南路2段86號,2樓', '地址有逗號（雙引號）也留著');
  assert.equal(parseTels({ responseData: [{ orgName: '臺北市中正區戶政事務所', tel: '02-23948838' }, { orgName: 'x' }] }).get('臺北市中正區戶政事務所'), '02-23948838');
  const cal = parseCalendar('\uFEFF西元日期,星期,是否放假,備註\n20261010,六,2,國慶日\n20261012,一,0,\n');
  assert.deepEqual(cal.get('20261010'), { off: true, note: '國慶日' });
  assert.deepEqual(cal.get('20261012'), { off: false, note: null });
  const meta = { result: { distribution: [
    { resourceDescription: '115年中華民國政府行政機關辦公日曆表_Google行事曆專用', resourceDownloadUrl: 'https://x/google.csv' },
    { resourceDescription: '115年中華民國政府行政機關辦公日曆表', resourceDownloadUrl: 'https://x/115.csv' },
    { resourceDescription: '116年中華民國政府行政機關辦公日曆表', resourceDownloadUrl: 'http://x/116.csv' },
  ] } };
  assert.equal(calendarUrl(meta, 115), 'https://x/115.csv');
  assert.equal(calendarUrl(meta, 116), null, '只收 https');
  assert.equal(calendarUrl(meta, 117), null);
});

test('今天上不上班：照日曆（放假附原因）；日曆沒有就照週末推並標示', () => {
  const cal = parseCalendar('西元日期,星期,是否放假,備註\n20261127,五,0,\n20261010,六,2,國慶日\n');
  assert.deepEqual(workdayOf(cal, TPE), { date: '11/27（五）', workday: true, note: null, known: true });
  assert.deepEqual(workdayOf(cal, Date.UTC(2026, 9, 10, 2)), { date: '10/10（六）', workday: false, note: '國慶日', known: true });
  assert.deepEqual(workdayOf(null, Date.UTC(2027, 0, 9, 2)), { date: '1/9（六）', workday: false, note: null, known: false });
  assert.equal(taipeiDay(Date.UTC(2026, 10, 26, 17)).ymd, '20261127', '台灣時間過了午夜就是隔天');
  assert.equal(todaySay({ date: '10/10（六）', workday: false, note: '國慶日', known: true }), '今天 10/10（六）放假（國慶日）');
  assert.match(todaySay({ date: '1/4（一）', workday: true, note: null, known: false }), /照週末推的/);
});

test('最近的戶政事務所：依距離排序、步行時間、電話、導航；電話與日曆拿不到不影響', async () => {
  const g = createGovOfficeServices({ offices: async () => parseOffices(CSV), tels: async () => { throw new Error('x'); }, calendar: async () => { throw new Error('x'); } });
  const r = await g.nearbyOffices({ lat: 25.0330, lon: 121.5650, now: TPE, limit: 2 });
  assert.deepEqual(r.offices.map((o) => o.name), ['臺北市信義區戶政事務所', '臺北市中正區戶政事務所']);
  assert.ok(r.offices[0].distanceM < 300 && r.offices[0].walkMin >= 1);
  assert.equal(r.offices[0].tel, null);
  assert.match(r.offices[0].nav.google, /^https:\/\/www\.google\.com\/maps\/dir\//);
  assert.equal(r.today.known, false);
});

test('真實下載：據點與電話 7 天、日曆 30 天；先從資料集資訊找當年的日曆', async () => {
  const calls = [];
  const od = { get: async (url, o) => {
    calls.push([url, o.ttlSec]);
    if (url === OFFICE_URLS.points) return o.parse(CSV);
    if (url === OFFICE_URLS.ris) return o.parse({ responseData: [] });
    if (url === OFFICE_URLS.calendarMeta) return { result: { distribution: [{ resourceDescription: '115年中華民國政府行政機關辦公日曆表', resourceDownloadUrl: 'https://x/115.csv' }] } };
    return o.parse('西元日期,星期,是否放假,備註\n20261127,五,0,\n');
  } };
  const r = await createGovOfficeServices(createLiveGovOfficeFetchers({ od })).nearbyOffices({ lat: 25.03, lon: 121.52, now: TPE });
  assert.equal(r.today.known, true);
  assert.deepEqual(Object.fromEntries(calls), { [OFFICE_URLS.points]: OFFICE_TTL_SEC, [OFFICE_URLS.ris]: OFFICE_TTL_SEC, [OFFICE_URLS.calendarMeta]: OFFICE_TTL_SEC, 'https://x/115.csv': CALENDAR_TTL_SEC });
});

test('示範資料（真實片段）＋工具：說法、卡片、示範標註', async () => {
  const r = await createMockGovOfficeServices().nearbyOffices({ lat: 25.0478, lon: 121.517, now: TPE });
  assert.equal(r.offices[0].name, '臺北市中正區戶政事務所');
  assert.ok(r.offices[0].tel);
  const t = await callTool(createServices({ forceMock: true }), 'gov_office_nearby', { lat: 25.0478, lon: 121.517 });
  assert.equal(t.card, 'gov-office');
  assert.equal(t.mode, 'demo');
  assert.match(t.speak, /^最近的是臺北市中正區戶政事務所，約 [\d.]+ (?:公里|公尺)（走路約 \d+ 分）。今天 .+/);
  assert.match(t.text, /建議先打電話/);
});

test('規則：找戶政、問戶政有沒有上班（「上班」不是去公司）；問怎麼去不是；需要位置', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['最近的戶政事務所在哪', '附近的戶政', '戶政今天有上班嗎', '戶政事務所有開嗎']) { assert.equal(p(q).intent, 'gov', q); assert.equal(p(q).govOffice, true, q); assert.equal(needsLocation(p(q)), true, q); }
  assert.notEqual(p('去戶政事務所怎麼走').govOffice, true);
  assert.equal(p('換身分證要帶什麼').govOffice, undefined);
  assert.equal(p('找戶政事務所換身分證要帶什麼').govOffice, undefined, '問要帶什麼是辦事須知');
  assert.equal(p('找戶政事務所換身分證要帶什麼').intent, 'gov');
  assert.equal(parseIntent('附近的戶政在哪', { history: [], intent: 'gov' }).govOffice, true, '判斷層說是辦事');
});

test('示範模式：有位置就用位置找，回答附今天是不是上班日與電話', async () => {
  const out = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '最近的戶政事務所在哪' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0339, lon: 121.5645 } }] }, (e) => out.push(e));
  const call = out.find((e) => e.type === 'tool_result' && e.tool === 'gov_office_nearby');
  assert.ok(call?.ok);
  const text = out.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  assert.match(text, /^最近的是臺北市信義區戶政事務所/);
  assert.match(text, /是上班日|放假/);
  assert.match(text, /先打電話/);
});

test('架構審查 #5（2026-11-28）：共用 CSV 解析——欄位改名丟錯、日曆空的丟錯（不快取空表）、引號裡的換行', () => {
  assert.throws(() => parseOffices('序號,機關名稱,地址,緯度,經度\n1,臺北市大安區戶政事務所,x,25,121\n'), /缺少欄位：名稱、座標緯度、座標經度/);
  assert.throws(() => parseCalendar('日期,星期,放假\n20261010,六,2\n'), /缺少欄位：西元日期、是否放假/);
  assert.throws(() => parseCalendar('西元日期,星期,是否放假,備註\n'), /辦公日曆沒有任何日期/);
  const o = parseOffices('序號,名稱,地址,座標經度,座標緯度\n1,臺北市大安區戶政事務所,"臺北市大安區\n新生南路2段86號",121.53,25.02\n2,臺北市中正區戶政事務所,臺北市中正區,121.51,25.03\n');
  assert.deepEqual(o.map((x) => x.name), ['臺北市大安區戶政事務所', '臺北市中正區戶政事務所'], '地址裡有換行也不會讓下一列錯位');
});
