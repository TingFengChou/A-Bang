// 快打烊：現場常提早停止掛號、抽號（Claude 與 Antigravity 第十三輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodClosingSoon, officeClosing } from '../core/closing.js';
import { clinicSearch } from '../core/services/clinic.js';
import { clinicSay } from '../core/tools/life.js';
import { todaySay } from '../core/tools/gov.js';
import { SPEAK_EN } from '../core/tools/speak-en.js';

const tw = (h, m = 0) => Date.UTC(2026, 11, 1, h - 8, m); // 2026-12-01（二）台灣時間

test('看診時段的最後 45 分鐘算快到尾聲；時段外、剛開始都不算', () => {
  assert.equal(periodClosingSoon('上午', tw(11, 14)), false);
  assert.equal(periodClosingSoon('上午', tw(11, 15)), true);
  assert.equal(periodClosingSoon('上午', tw(11, 59)), true);
  assert.equal(periodClosingSoon('下午', tw(17, 30)), true);
  assert.equal(periodClosingSoon('下午', tw(14)), false);
  assert.equal(periodClosingSoon('晚上', tw(21, 40)), true);
  assert.equal(periodClosingSoon(null, tw(23)), false);
});

test('戶政：上班日 16:15 起快下班、17:00 起已下班；放假不說', () => {
  assert.equal(officeClosing(true, tw(16, 14)), null);
  assert.equal(officeClosing(true, tw(16, 15)), 'soon');
  assert.equal(officeClosing(true, tw(17)), 'over');
  assert.equal(officeClosing(true, tw(9)), null);
  assert.equal(officeClosing(false, tw(16, 30)), null);
});

const ROW = { code: '1', name: '安心診所', kind: 'western', depts: ['家醫科'], phone: '02-1234', address: '臺北市大安區復興南路一段1號', end: '', slots: Array.from({ length: 7 }, () => [true, true, true]) };

test('診所：這個時段快結束時標出來，一句話改說「先打電話問還收不收」', () => {
  const soon = clinicSearch([ROW], { area: '大安區', now: tw(11, 30) });
  assert.equal(soon.closingSoon, true);
  assert.match(clinicSay(soon), /上午的看診快結束了，診所常在結束前 20～30 分鐘就停止掛號，出發前先打電話問還收不收。$/);
  assert.match(SPEAK_EN.clinic_search(soon), /stop registering 20–30 minutes early/);
  const mid = clinicSearch([ROW], { area: '大安區', now: tw(10) });
  assert.equal(mid.closingSoon, undefined);
  assert.match(clinicSay(mid), /時段是登記的，出門前先打電話確認。$/);
  assert.equal(clinicSearch([ROW], { area: '大安區', now: tw(11, 30), dayOffset: 1, period: '上午' }).closingSoon, undefined, '問明天：不說快結束');
});

test('戶政：快下班、已下班接在「今天是上班日」後面', () => {
  const base = { date: '12/1（二）', workday: true, note: null, known: true };
  assert.equal(todaySay({ ...base, closing: 'soon' }), '今天 12/1（二）是上班日；快下班了：多數戶政下午 5 點下班，現場常提早停止抽號，出發前先打電話確認');
  assert.match(todaySay({ ...base, closing: 'over' }), /多數戶政已經下班（部分有夜間延時）/);
  assert.equal(todaySay(base), '今天 12/1（二）是上班日');
  assert.match(todaySay({ ...base, known: false, closing: 'soon' }), /照週末推的）；快下班了/);
});
