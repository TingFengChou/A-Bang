// 現在有看診的診所（健保署特約診所，與藥局同一個來源）：時段解析、科別只認明講的、這個時段有登記的排前面、
// 清晨／深夜的說法、規則（去醫院看病是行程、急症先 119）、示範模式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekSlots, periodAt, kindOf, deptOf, parseClinics, clinicSearch, createClinicServices, createLiveClinicFetchers, CLINICS_URL, CLINICS_TTL_SEC } from '../core/services/clinic.js';
import { clinicSay } from '../core/tools/life.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';

const at = (hm) => Date.parse(`2026-11-27T${hm}:00+08:00`); // 星期五
const HOURS = (days) => ['一', '二', '三', '四', '五', '六', '日'].flatMap((w) => ['上午', '下午', '晚上'].map((p) => `星期${w}${p}${days[w]?.includes(p) ? '看診' : '休診'}`)).join('、');
const HEAD = '醫事機構代碼,醫事機構名稱,醫事機構種類,電話,地址,分區業務組,特約類別,服務項目,診療科別,終止合約或歇業日期,固定看診時段,備註,縣市別代碼,合約起日';
const row = (code, name, kind, addr, depts, hours, end = '20301231') => `${code},${name},${kind},(02)23456789,${addr},臺北業務組,4,門診診療,"${depts}",${end},${hours},-,63000,20200101`;
const CSV = [HEAD,
  row('1', '早安診所', '西醫診所', '臺北市大安區復興南路１段１號', '家醫科,內科', HOURS({ 五: ['上午'] })),
  row('2', '午後耳鼻喉科診所', '專科診所', '臺北市大安區信義路４段２號', '耳鼻喉科(耳鼻喉頭頸外科)', HOURS({ 五: ['下午', '晚上'] })),
  row('3', '夜間兒科診所', '專科診所', '臺北市大安區和平東路３號', '兒科', HOURS({ 五: ['晚上'] })),
  row('4', '笑笑牙醫診所', '牙醫一般診所', '臺北市大安區敦化南路４號', '牙科', HOURS({ 五: ['下午'] })),
  row('5', '本草中醫診所', '中醫一般診所', '臺北市大安區忠孝東路５號', '中醫一般科', HOURS({ 五: ['下午'] })),
  row('6', '已歇業診所', '西醫診所', '臺北市大安區仁愛路６號', '家醫科', HOURS({ 五: ['下午'] }), '20250101'),
  row('7', '胃腸內科診所', '專科診所', '臺北市大安區光復南路７號', '胃腸內科', HOURS({ 五: ['下午'] })),
  row('8', '病理中心', '病理中心', '臺北市大安區八德路８號', '病理科', ''),
  row('9', '基隆中正診所', '西醫診所', '基隆市中正區義一路９號', '家醫科', HOURS({ 五: ['下午'] })),
  row('10', '臺北中正診所', '西醫診所', '臺北市中正區重慶南路１０號', '家醫科', HOURS({ 五: ['下午'] })),
].join('\n');
const ROWS = parseClinics(CSV);

test('解析：7×3 時段、西醫／牙醫／中醫、病理中心不列、地址全形數字與「台」統一', () => {
  const s = weekSlots(HOURS({ 五: ['上午', '晚上'] }));
  assert.deepEqual(s[5], [true, false, true], '星期五（index 5）上午、晚上');
  assert.deepEqual(s[0], [false, false, false], '星期日');
  assert.equal(weekSlots(''), null);
  assert.deepEqual(['西醫診所', '專科診所', '一般診所（醫務室）', '牙醫一般診所', '中醫專科診所', '病理中心'].map(kindOf), ['western', 'western', 'western', 'dental', 'tcm', null]);
  assert.equal(ROWS.length, 9);
  assert.equal(ROWS[0].address, '臺北市大安區復興南路1段1號');
});

test('時段：8–12 上午、12–18 下午、18–22 晚上，其他沒有', () => {
  assert.deepEqual(['07:59', '08:00', '12:00', '17:59', '18:00', '21:59', '22:00'].map((t) => periodAt(at(t))), [null, '上午', '下午', '下午', '晚上', '晚上', null]);
});

test('科別：只認明講的科別（不從症狀推）；胃腸內科不是內科', () => {
  assert.equal(deptOf('附近有開的小兒科嗎'), 'peds');
  assert.equal(deptOf('大安區的牙醫'), 'dental');
  assert.equal(deptOf('想看中醫'), 'tcm');
  assert.equal(deptOf('耳鼻喉科'), 'ent');
  assert.equal(deptOf('發燒附近有診所嗎'), null);
  assert.equal(deptOf('胃腸內科'), null);
  assert.equal(deptOf('內科'), 'im');
});

test('查詢（星期五下午 3 點）：這個時段有登記的排前面、稍晚的其次；沒說科別只列西醫；歇業不列', () => {
  const d = clinicSearch(ROWS, { area: '臺北市大安區', now: at('15:00') });
  assert.equal(d.period, '下午');
  assert.equal(d.phase, 'open');
  assert.deepEqual(d.clinics.map((c) => c.name), ['午後耳鼻喉科診所', '胃腸內科診所', '夜間兒科診所', '早安診所']);
  assert.equal(d.openNowCount, 2);
  assert.equal(d.laterCount, 1, '夜間兒科晚上才看');
  assert.deepEqual(d.clinics[2].laterToday, ['晚上']);
  assert.equal(d.clinics[3].openNow, false);
  assert.match(d.clinics[0].nav.google, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.equal(clinicSay(d), '臺北市大安區有 2 家西醫診所登記下午看診，今天稍晚還有 1 家。時段是登記的，出門前先打電話確認。');
});

test('查詢：科別（小兒科、牙科、中醫）、只說區名跨縣市只列第一個、查不到', () => {
  const peds = clinicSearch(ROWS, { area: '大安區', dept: 'peds', now: at('15:00') });
  assert.deepEqual(peds.clinics.map((c) => c.name), ['夜間兒科診所']);
  assert.equal(clinicSay(peds), '大安區的小兒科診所這個時段（下午）沒有登記看診，今天稍晚有 1 家。');
  assert.deepEqual(clinicSearch(ROWS, { area: '大安區', dept: 'dental', now: at('15:00') }).clinics.map((c) => c.name), ['笑笑牙醫診所']);
  assert.deepEqual(clinicSearch(ROWS, { area: '大安區', dept: 'tcm', now: at('15:00') }).clinics.map((c) => c.name), ['本草中醫診所']);
  const zz = clinicSearch(ROWS, { area: '中正區', now: at('15:00') });
  assert.equal(zz.clinics.length, 1);
  assert.equal(zz.otherCities.length, 1);
  assert.notEqual(zz.city, zz.otherCities[0]);
  assert.match(clinicSay(clinicSearch(ROWS, { area: '花蓮縣', now: at('15:00') })), /沒有找到符合的健保特約診所/);
  assert.throws(() => clinicSearch(ROWS, { now: at('15:00') }), /請說哪一區/);
  assert.throws(() => clinicSearch(ROWS, { area: '大安區', dept: 'xx' }), /不認得/);
});

test('清晨還沒開始、晚上 10 點後都看完了：提醒急診與 119', () => {
  const early = clinicSearch(ROWS, { area: '臺北市大安區', now: at('07:00') });
  assert.equal(early.phase, 'early');
  assert.equal(early.openNowCount, 0);
  assert.equal(clinicSay(early), '診所還沒開始看診；臺北市大安區今天有登記看診的西醫診所有 4 家，時段在卡片上。');
  const late = clinicSearch(ROWS, { area: '臺北市大安區', now: at('23:00') });
  assert.equal(late.phase, 'late');
  assert.equal(clinicSay(late), '現在已過診所的看診時間，臺北市大安區的西醫診所今天都看完了；身體很不舒服請到醫院急診，緊急狀況撥 119。');
});

test('服務：下載健保署診所資料、快取 24 小時', async () => {
  const calls = [];
  const svc = createClinicServices(createLiveClinicFetchers({ od: { get: async (url, o) => { calls.push([url, o.ttlSec]); return o.parse(CSV); } } }));
  const d = await svc.clinics.search({ area: '臺北市大安區' }, at('15:00'));
  assert.equal(d.openNowCount, 2);
  assert.deepEqual(calls[0], [CLINICS_URL, CLINICS_TTL_SEC]);
  assert.equal(CLINICS_TTL_SEC, 86400);
});

test('工具（示範資料是真實片段）：位置推估在哪一區、卡片、說明不判斷病情、急症 119', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'clinic_search', { lat: 25.0478, lon: 121.517 });
  assert.equal(r.card, 'clinic');
  assert.equal(r.data.area, '臺北市中正區');
  assert.equal(r.data.areaFrom.by, 'location');
  assert.ok(r.data.total > 10);
  assert.ok(r.data.clinics.every((c) => c.kind === 'western'));
  assert.match(r.text, /不判斷病情、不推薦科別；胸痛、呼吸困難、昏倒等急症請先撥 119/);
  const dental = await callTool(svc, 'clinic_search', { area: '臺北市中正區', dept: 'dental' });
  assert.ok(dental.data.clinics.length && dental.data.clinics.every((c) => c.kind === 'dental'));
});

test('規則：找診所（科別、區）＝藥局意圖的 clinic；去醫院看病是行程；藥局照舊；掛號信不是看病', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['附近有開的診所嗎', '發燒附近有診所嗎', '我要去看醫生，附近哪間診所有開', '現在哪裡可以看病']) {
    const it = p(q);
    assert.equal(it.intent, 'pharmacy', q);
    assert.equal(it.clinic, true, q);
  }
  assert.equal(p('附近有開的小兒科嗎').dept, 'peds');
  const d = p('大安區的牙醫');
  assert.equal(d.dept, 'dental');
  assert.equal(d.area, '大安區');
  for (const q of ['我要去馬偕看醫生', '去台大醫院看病怎麼走', '阿嬤要去榮總看病', '中醫大附醫怎麼去']) assert.notEqual(p(q).clinic, true, q);
  assert.equal(p('附近藥局').clinic, undefined);
  assert.equal(p('附近藥局').intent, 'pharmacy');
  assert.notEqual(p('寄掛號信').intent, 'pharmacy');
  const en = p('Is there a dentist open near me?');
  assert.equal(en.clinic, true);
  assert.equal(en.dept, 'dental');
});

test('示範模式：找診所用 clinic_search；胸痛先叫 119、不查診所', async () => {
  const out = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '附近有開的診所嗎' }] }, (e) => out.push(e));
  assert.ok(out.some((e) => e.type === 'tool_result' && e.tool === 'clinic_search' && e.ok));
  assert.ok(out.some((e) => e.type === 'tool_result' && e.card === 'clinic'));
  const sos = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '胸口很痛喘不過氣，附近有診所嗎' }] }, (e) => sos.push(e));
  assert.ok(!sos.some((e) => e.type === 'tool_result' && e.tool === 'clinic_search'));
  assert.match(sos.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /119/);
});
