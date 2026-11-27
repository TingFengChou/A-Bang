// 阿幫動手做（ADR-0021）：加到行事曆、分享——內容由程式產生，最後一步由系統畫面確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarFromTrip, shareFromTrip, cleanCalendarEvent, cleanShare, toIcs, tripTimes, taipeiMs, DEVICE_ACTIONS } from '../core/device-actions.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { deviceActionReply, deviceActionAsk, thenAction } from '../core/agent/device-turn.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { ev } from '../core/agent/events.js';
import { ASK_ACTIONS } from '../core/agent/ask.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { addCalendar, share, resultText } from '../public/js/device-actions.js';

const svc = createServices({ forceMock: true });
const trip = async (args) => (await callTool(svc, 'plan_trip', args)).data;
const run = async (body) => { const out = []; await runDemo(svc, body, (e) => out.push(e)); return out; };
const CAN = { can: ['addCalendar', 'share'], trip: true };

test('行事曆事件：台灣時間、建議方案、出發地名稱、不寫「你的位置」', async () => {
  const d = await trip({ from: '台北車站', to: '高雄車站', departAt: '09:00' });
  const e = calendarFromTrip(d);
  const best = d.options.find((o) => o.id === d.best);
  assert.match(e.title, /^去高雄車站（.+）$/);
  assert.equal(e.title, `去高雄車站（${best.name}）`);
  assert.equal(e.start, taipeiMs(d.date, 9 * 60), '09:00 出發＝台灣時間');
  assert.equal(new Date(e.start).toISOString().slice(11, 16), '01:00');
  assert.ok(e.end > e.start && e.end - e.start <= 24 * 3600e3);
  assert.equal(e.location, '臺北車站');
  assert.match(e.notes, /出發前再看一次即時資料/);
  const here = calendarFromTrip({ ...d, from: { name: '你的位置', lat: 25.04, lon: 121.5 } });
  assert.equal(here.location, undefined, '從你的位置出發：不寫地點');
  const alt = d.options.find((o) => o.id !== d.best);
  assert.match(calendarFromTrip(d, { optId: alt.id }).title, new RegExp(alt.name));
  assert.match(calendarFromTrip(d, { lang: 'en' }).title, /^高雄車站 \(/);
});

test('時間：跨午夜、沒有 leaveAt 用 departAt、資料不夠回 null', () => {
  const data = { date: '2026-11-27', departAt: '23:40', to: { name: '板橋' }, from: { name: '台北車站' }, best: 'a', options: [{ id: 'a', name: '公車', leaveAt: '23:50', arriveMin: 24 * 60 + 20, minutes: 30, legs: [] }] };
  const t = tripTimes(data, data.options[0]);
  assert.equal(t.end - t.start, 30 * 60e3);
  const noLeave = { ...data, departAt: '09:55', options: [{ id: 'a', name: '捷運', arriveMin: 618, minutes: 23, legs: [] }] };
  assert.equal((tripTimes(noLeave, noLeave.options[0]).end - tripTimes(noLeave, noLeave.options[0]).start) / 60e3, 23);
  const nextDay = { ...data, departAt: '23:50', options: [{ id: 'a', name: '公車', leaveAt: '00:10', arriveAt: '00:40', legs: [] }] };
  const n = tripTimes(nextDay, nextDay.options[0]);
  assert.equal(n.start, taipeiMs('2026-11-28', 10), '隔天 00:10 出發');
  assert.equal(calendarFromTrip({ ...data, date: 'x' }), null);
  assert.equal(calendarFromTrip(null), null);
  assert.equal(calendarFromTrip({ ...data, best: 'zz' }), null);
});

test('分享：不帶出發地座標、目的地附 https 地圖連結、文字有時間與票價', async () => {
  const d = await trip({ from: '台北車站', to: '台北101' });
  const p = shareFromTrip(d);
  assert.match(p.text, /^從臺北車站到台北101：坐.+，\d{2}:\d{2} 出發、\d{2}:\d{2} 到/);
  assert.match(p.text, /（阿幫）$/);
  assert.match(p.url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=25\.03400%2C121\.56450/);
  const here = shareFromTrip({ ...d, from: { name: '你的位置', lat: 25.0412345, lon: 121.5432109 } });
  assert.match(here.text, /^從我這裡到台北101/);
  assert.ok(!/25\.04123|121\.54321/.test(JSON.stringify(here)), '不帶使用者座標');
  assert.match(shareFromTrip(d, { lang: 'en' }).text, /\(via A-Bang\)$/);
  // 多人叫車：寫每人分攤（與卡片相同）
  const group = { date: '2026-11-27', departAt: '10:00', from: { name: '西門町' }, to: { name: '台北101' }, best: 'r', options: [{ id: 'r', name: '叫車（Uber）', leaveAt: '10:00', arriveMin: 630, minutes: 30, costRange: [70, 90], share: { cars: 2 }, legs: [] }] };
  assert.match(shareFromTrip(group).text, /每人 70–90 元（2 輛車）/);
  assert.match(calendarFromTrip(group).notes, /每人 70–90 元/);
});

test('檢查：長度、時間範圍、只收 https、去掉控制字元', () => {
  assert.equal(cleanCalendarEvent({ title: '', start: 1, end: 2 }), null);
  assert.equal(cleanCalendarEvent({ title: 'a', start: 2, end: 1 }), null);
  assert.equal(cleanCalendarEvent({ title: 'a', start: 0, end: 25 * 3600e3 }), null, '超過 24 小時');
  const e = cleanCalendarEvent({ title: `去‮板橋\n站${'長'.repeat(100)}`, start: 0, end: 60e3, location: '台北​車站', notes: 'x' });
  assert.ok(!/[\u202e\u200b\n]/.test(e.title + e.location));
  assert.ok([...e.title].length <= 80);
  assert.equal(cleanShare({ text: 'hi', url: 'javascript:alert(1)' }).url, undefined);
  assert.equal(cleanShare({ text: 'hi', url: 'http://a.com' }).url, undefined);
  assert.equal(cleanShare({ text: '' }), null);
  assert.equal(cleanShare({ text: 'hi', url: 'https://a.com/x' }).url, 'https://a.com/x');
});

test('.ics：UTC 時間、跳脫、每行不超過 75 位元組', () => {
  const ics = toIcs({ title: '去高雄, 坐高鐵; 好', start: Date.UTC(2026, 10, 27, 1, 0), end: Date.UTC(2026, 10, 27, 3, 0), location: '臺北車站', notes: '步行\n'.repeat(40) }, { uid: 'a b', now: 0 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261127T010000Z\r\n/);
  assert.match(ics, /SUMMARY:去高雄\\, 坐高鐵\\; 好\r\n/);
  assert.match(ics, /UID:ab@abang/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(toIcs({ title: '', start: 0, end: 1 }), null);
});

test('規則：加到行事曆、分享（「有人傳給我網址」「朋友分享的投資群組」不算）', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const q of ['加到行事曆', '幫我把這個加到我的日曆', '存到行事曆', '排進我的日曆']) assert.equal(p(q).intent, 'calendar', q);
  for (const q of ['傳給我媽', '分享這個路線', '分享給我老公', '這個分享一下', '轉傳給家人']) assert.equal(p(q).intent, 'share', q);
  assert.deepEqual([p('add this to my calendar').intent, p('add this to my calendar').lang], ['calendar', 'en']);
  assert.equal(p('share this').intent, 'share');
  assert.notEqual(p('有人傳給我一個網址').intent, 'share');
  assert.equal(p('朋友分享的投資群組').intent, 'scamAsk');
  assert.equal(p('提醒我出門').intent, 'reminder');
  // 程式審查 2026-11-27：問句不是要分享；英文 share price 是股價
  assert.notEqual(p('分享一下你會做什麼').intent, 'share');
  assert.notEqual(p('What is the share price of TSMC?').intent, 'share');
  assert.equal(p('share the route with my mom').intent, 'share');
  assert.equal(p('可以分享給同事嗎').intent, 'share');
  // 判斷層說加行事曆、但句子有地點：先排行程
  assert.equal(parseIntent('從台北車站去台北101，加到行事曆', { history: [], intent: 'calendar' }).intent, 'trip');
  assert.equal(parseIntent('加到行事曆', { history: [], intent: 'calendar' }).intent, 'calendar');
  assert.equal(thenAction('從台北車站去台北101，幫我加到行事曆'), 'calendar');
  assert.equal(thenAction('從台北車站去台北101'), null);
});

test('伺服器回覆：做不到照實說、沒有行程請先排、有行程給動作按鈕（不帶內容）', () => {
  assert.match(deviceActionReply('calendar', {}).text, /這裡沒辦法直接加到行事曆/);
  assert.equal(deviceActionReply('calendar', {}).ask, undefined);
  assert.match(deviceActionReply('share', { deviceActions: { can: ['share'], trip: false } }).text, /先告訴我要去哪裡/);
  const r = deviceActionReply('calendar', { deviceActions: CAN });
  assert.deepEqual(r.ask.options.map((o) => o.action?.name || o.kind), ['addCalendar', 'dismiss']);
  assert.match(r.text, /你確認後才加入/);
  assert.match(deviceActionAsk('share', 'en').question, /Share this trip/);
  assert.deepEqual(DEVICE_ACTIONS.filter((a) => ASK_ACTIONS.includes(a)), DEVICE_ACTIONS);
  // 事件驗證：動作不帶內容（就算帶了也拿掉）
  const e = ev.ask({ id: 'a', question: 'q', options: [{ label: '加到行事曆', kind: 'action', action: { name: 'addCalendar', title: '偷塞', url: 'https://x' } }] });
  assert.deepEqual(e.options[0].action, { name: 'addCalendar' });
});

test('請求：deviceActions 只收列舉的動作與 trip 布林值', () => {
  const m = [{ role: 'user', content: '加到行事曆' }];
  assert.ok(validateRequest({ messages: m, deviceActions: CAN }));
  assert.throws(() => validateRequest({ messages: m, deviceActions: { can: ['call'], trip: true } }));
  assert.throws(() => validateRequest({ messages: m, deviceActions: { can: ['share'], trip: true, data: {} } }));
});

test('示範模式：說「加到行事曆」不查資料；一句排行程又要分享，排好後問', async () => {
  const a = await run({ messages: [{ role: 'user', content: '加到行事曆' }], deviceActions: CAN });
  assert.equal(a.filter((e) => e.type === 'tool_start').length, 0);
  assert.deepEqual(a.find((e) => e.type === 'ask').options[0].action, { name: 'addCalendar' });
  const b = await run({ messages: [{ role: 'user', content: '從台北車站去台北101，傳給我媽' }], deviceActions: { can: ['addCalendar', 'share'], trip: false } });
  assert.ok(b.some((e) => e.type === 'tool_result' && e.tool === 'plan_trip' && e.ok));
  const asks = b.filter((e) => e.type === 'ask');
  assert.equal(asks.length, 1, '一輪最多一個問題');
  assert.deepEqual(asks[0].options[0].action, { name: 'share' });
  const c = await run({ messages: [{ role: 'user', content: '從台北車站去台北101，傳給我媽' }] });
  assert.ok(!c.some((e) => e.type === 'ask' && e.options.some((o) => o.action?.name === 'share')), '客戶端做不到就不問');
});

test('模型模式：同一套回答，不呼叫模型', async () => {
  const provider = new Proxy({ mode: 'claude', model: 'stub' }, { get: (o, k) => (k in o ? o[k] : () => { throw new Error(`不該呼叫模型：${String(k)}`); }) });
  const out = [];
  await runModel(svc, { messages: [{ role: 'user', content: '傳給我媽' }], deviceActions: CAN }, (e) => out.push(e), { provider });
  assert.deepEqual(out.find((e) => e.type === 'ask').options[0].action, { name: 'share' });
  assert.match(out.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /分享選單/);
  assert.ok(out.at(-1).type === 'done');
});

test('前端：網頁加行事曆下載 .ics、分享不支援就複製、結果文字', async () => {
  const clicks = [];
  const doc = { body: { append: () => {} }, createElement: () => ({ click() { clicks.push(this.download); }, remove() {} }) };
  globalThis.URL.createObjectURL ??= () => 'blob:x';
  const ev1 = { title: '去高雄', start: Date.UTC(2026, 10, 27, 1), end: Date.UTC(2026, 10, 27, 3) };
  assert.equal(await addCalendar(ev1, { doc }), 'downloaded');
  assert.deepEqual(clicks, ['abang-trip.ics']);
  assert.equal(await addCalendar({ title: '' }, { doc }), 'failed');
  let copied = '';
  assert.equal(await share({ text: 'hi', url: 'https://a.com/' }, { nav: { clipboard: { writeText: async (t) => { copied = t; } } } }), 'copied');
  assert.equal(copied, 'hi\nhttps://a.com/');
  assert.equal(await share({ text: 'hi' }, { nav: { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } } }), 'cancelled');
  assert.match(resultText('addCalendar', 'saved'), /已加到行事曆/);
  assert.match(resultText('share', 'outdated'), /請更新阿幫 App/);
  assert.equal(resultText('addCalendar', 'nope'), '沒有成功，請再試一次。', '沒有的結果：說沒成功');
  assert.equal(resultText('share', 'copied', 'en'), 'Copied; paste it wherever you like.', '用卡片字典');
});

test('原生外掛與文件：iOS／Android 有方法、iOS 有行事曆說明、前端共用檔都有列', async () => {
  const swift = await readFile(new URL('../ios/App/App/AbangSystemPlugin.swift', import.meta.url), 'utf8');
  for (const m of ['addCalendarEvent', 'share']) assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${m}"`));
  assert.match(swift, /EKEventEditViewController/);
  const java = await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangSystemPlugin.java', import.meta.url), 'utf8');
  assert.match(java, /public void addCalendarEvent/);
  assert.match(java, /CalendarContract\.Events\.CONTENT_URI/);
  assert.match(java, /Intent\.createChooser/);
  const plist = await readFile(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /NSCalendarsUsageDescription/);
});
