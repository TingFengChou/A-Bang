// 北捷看板狀態代碼（卡片用中英字典，英文卡片不出現中文）＋站別時刻表看國定假日（ServiceDay.NationalHolidays、內建清單、台灣時間）。
// 用 TZ=UTC 跑也要對：日期一律用台灣時間判斷。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { metroStatusCode, metroStatusText, METRO_STATUS, normStationTimetable, upcomingFromTimetable, createMetroServices } from '../core/services/metro.js';
import { createTdxClient } from '../core/tdx-client.js';
import { isNationalHoliday, holidayName, twDate, HOLIDAY_YEARS } from '../core/holidays.js';
import { speakEn } from '../core/tools/speak-en.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { validate } from '../public/ui/cards/schema/validate.js';
import metroCard from '../public/ui/cards/cards/metro.js';
import { tFor } from '../public/ui/cards/i18n/index.js';
import { turnSummary } from '../public/js/agent/turn-summary.js';

const Z = (zh, en) => ({ Zh_tw: zh, ...(en && { En: en }) });
const zh = tFor('zh-TW'), en = tFor('en');
const schema = JSON.parse(await readFile(new URL('../public/ui/cards/schema/metro.v1.json', import.meta.url), 'utf8'));
const CJK = /[一-龥]/;

test('看板分鐘 → 狀態代碼；伺服器的文字中英各一套', () => {
  assert.deepEqual([0, 1, 4, null].map(metroStatusCode), ['arriving', 'approaching', 'minutes', 'unknown']);
  assert.ok(METRO_STATUS.includes('scheduled'));
  assert.equal(metroStatusText({ status: 'arriving', etaMin: 0 }), '進站中');
  assert.equal(metroStatusText({ status: 'arriving', etaMin: 0 }, 'en'), 'Arriving');
  assert.equal(metroStatusText({ status: 'minutes', etaMin: 4 }, 'en'), '4 min');
  assert.equal(metroStatusText({ status: 'scheduled', etaMin: 6 }), '約 6 分');
});

test('卡片：狀態走字典，英文卡片沒有中文狀態；契約只收代碼、不收 TDX 原始欄位', () => {
  const d = { system: 'TRTC', station: '台北車站', stationId: 'BL12', updatedAt: '2026-11-23T10:00:00+08:00', nav: null, trains: [
    { line: '板南線', lineEn: 'Bannan Line', lineId: 'BL', destination: '頂埔', destinationEn: 'Dingpu', etaMin: 0, status: 'arriving' },
    { line: '淡水信義線', lineId: 'R', destination: '淡水', etaMin: 1, status: 'approaching' },
    { line: '板南線', lineId: 'BL', destination: '南港展覽館', etaMin: 5, status: 'scheduled', scheduled: true },
  ] };
  assert.deepEqual(validate(schema, d), []);
  assert.equal(metroCard.announce(d, { t: en }), '板南線 To 頂埔 Arriving；淡水信義線 To 淡水 Approaching');
  assert.equal(metroCard.announce(d, { t: zh }), '板南線 往 頂埔 進站中；淡水信義線 往 淡水 即將進站');
  assert.ok(!CJK.test(metroCard.announce({ ...d, trains: [{ ...d.trains[0], line: 'L', destination: 'D' }] }, { t: en })));
  assert.equal(metroCard.announce({ ...d, trains: [{ line: 'L', destination: 'D', etaMin: 7, status: 'minutes' }] }, { t: en }), 'L To D 7 min');
  // 舊的中文字串、TDX 原始欄位都不收
  assert.ok(validate(schema, { ...d, trains: [{ ...d.trains[0], status: '進站中' }] }).length);
  assert.ok(validate(schema, { ...d, trains: [{ ...d.trains[0], EstimateTime: 0 }] }).some((e) => /契約沒有這個欄位/.test(e)));
  // 一句話摘要與英文播報也看代碼
  assert.equal(turnSummary({ q: 'MRT', results: [{ tool: 'metro_live_board', data: d }] }).line, '台北車站捷運：往頂埔 進站中');
  assert.match(speakEn('metro_live_board', { station: 'Taipei Main Station', trains: [d.trains[0]] }), /arriving now/);
  assert.match(speakEn('metro_live_board', { station: 'Taipei Main Station', trains: [d.trains[1]] }), /within a minute/);
});

test('metro_live_board（示範資料）輸出代碼、符合契約；工具文字是中文易讀字', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_live_board', { system: 'TRTC', station: '台北車站' });
  assert.ok(r.data.trains.length);
  for (const t of r.data.trains) assert.ok(METRO_STATUS.includes(t.status), t.status);
  assert.deepEqual(validate(schema, r.data), []);
  assert.ok(!/arriving|approaching|minutes|scheduled|unknown/.test(r.text), r.text);
});

// ───── 國定假日 ─────
const WEEKDAY = { LineID: 'BL', StationID: 'BL12', Direction: 1, DestinationStationID: 'BL01', DestinationStationName: Z('頂埔', 'Dingpu'), ServiceDay: { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true, Saturday: false, Sunday: false, NationalHolidays: false }, Timetables: [{ DepartureTime: '10:03' }] };
const HOLIDAY = { ...WEEKDAY, ServiceDay: { Monday: false, Tuesday: false, Wednesday: false, Thursday: false, Friday: false, Saturday: true, Sunday: true, NationalHolidays: true }, Timetables: [{ DepartureTime: '10:08' }] };
const at = (iso) => Date.parse(iso);

test('內建國定假日清單：台灣時間判斷（UTC 前一天晚上 = 台灣隔天）', () => {
  assert.deepEqual(HOLIDAY_YEARS, [2026, 2027]);
  assert.ok(isNationalHoliday('2026-10-26'), '光復節補假（週一）');
  assert.equal(holidayName('2026-02-17'), '春節');
  assert.ok(!isNationalHoliday('2026-11-23'));
  assert.ok(!isNationalHoliday('2028-01-03'), '清單外的年份不算');
  assert.equal(twDate(at('2026-10-25T16:30:00Z')), '2026-10-26', 'UTC 10/25 16:30 是台灣 10/26 00:30');
  assert.equal(twDate(at('2026-10-25T16:30:00Z'), -1), '2026-10-25');
});

test('時刻表：國定假日用 NationalHolidays 的班表；平日、資料沒標、清單外照星期幾', () => {
  const table = normStationTimetable([WEEKDAY, HOLIDAY]);
  assert.equal(table[0].holiday, false);
  assert.equal(table[1].holiday, true);
  const eta = (iso, t = table) => upcomingFromTimetable(t, at(iso)).map((x) => x.etaMin);
  assert.deepEqual(eta('2026-10-26T02:00:00Z'), [8], '光復節補假（週一 10:00）：假日班 10:08');
  assert.deepEqual(eta('2026-11-23T02:00:00Z'), [3], '一般週一：平日班 10:03');
  assert.deepEqual(eta('2026-11-22T02:00:00Z'), [8], '週日：假日班');
  // 資料沒有 NationalHolidays：國定假日照星期幾
  const plain = normStationTimetable([{ ...WEEKDAY, ServiceDay: { Monday: true } }]);
  assert.equal(plain[0].holiday, undefined);
  assert.deepEqual(eta('2026-10-26T02:00:00Z', plain), [3]);
});

test('時刻表：凌晨看前一天的營運日，前一天是國定假日就用假日班的末班', () => {
  const lateWeek = { ...WEEKDAY, Timetables: [{ DepartureTime: '00:20' }] };
  const lateHoliday = { ...HOLIDAY, Timetables: [{ DepartureTime: '00:40' }] };
  const table = normStationTimetable([lateWeek, lateHoliday]);
  // 台灣 2026-10-27（週二）00:10：前一天 10/26 是補假 → 用假日班的末班 00:40（平日班 00:20 那班不算）
  const r = upcomingFromTimetable(table, at('2026-10-26T16:10:00Z'));
  assert.deepEqual(r.map((x) => x.etaMin), [30]);
  // 一般週二 00:10：前一天週一平日班 00:20
  assert.deepEqual(upcomingFromTimetable(table, at('2026-11-23T16:10:00Z')).map((x) => x.etaMin), [10]);
});

test('createMetroServices：國定假日的看板補班次用假日班表', async () => {
  const STATIONS = [{ StationID: 'BL12', StationName: Z('台北車站'), StationPosition: { PositionLat: 25.046, PositionLon: 121.517 } }];
  const routes = [[/Metro\/Station\/TRTC/, STATIONS], [/LiveBoard/, []], [/StationTimeTable/, [WEEKDAY, HOLIDAY]]];
  const fetchImpl = async (u) => {
    if (/token/.test(u)) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    const hit = routes.find(([re]) => re.test(u));
    return new Response(JSON.stringify(hit ? hit[1] : []));
  };
  const now = () => at('2026-10-26T02:00:00Z');
  const m = createMetroServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit: { concurrent: 3, gapMs: 0, retryMs: 1, waitMs: 0 }, now }), { now }).metro;
  const b = await m.liveBoard({ system: 'TRTC', station: '台北車站' });
  assert.deepEqual(b.trains.map((t) => [t.destination, t.etaMin, t.status]), [['頂埔', 8, 'scheduled']]);
  assert.deepEqual(validate(schema, { ...b, nav: null }), []);
});
