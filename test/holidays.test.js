// 國定假日清單（core/data/tw-holidays.json）：由官方辦公日曆 CSV 產生（scripts/build-holidays.js），內容要一致；
// 今年不在清單就失敗；明年 7/1 起才要求（官方通常年中公告）——提醒每年公告新年度日曆後重新產生。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseCalendarCsv, buildHolidays, formatHolidays } from '../scripts/build-holidays.js';
import { HOLIDAY_YEARS, isNationalHoliday, holidayName, twDate } from '../core/holidays.js';

const DIR = new URL('../scripts/data/dgpa-calendar/', import.meta.url);

test('官方 CSV 解析：只取放假而且有備註的日子（週末不列）；BOM、欄位順序都可以', () => {
  const csv = '\uFEFF西元日期,星期,是否放假,備註\r\n20260214,六,2,\r\n20260215,日,2,小年夜\r\n20260220,五,2,補假\r\n20260223,一,0,\r\n';
  assert.deepEqual(parseCalendarCsv(csv), [{ date: '2026-02-15', name: '小年夜' }, { date: '2026-02-20', name: '補假' }]);
  assert.throws(() => parseCalendarCsv('日期,放假\n20260101,2'), /欄位不對/);
});

test('core/data/tw-holidays.json 與官方 CSV（115、116 年）產生的一致', async () => {
  const files = (await readdir(DIR)).filter((f) => /\.csv$/.test(f)).sort();
  assert.ok(files.length >= 2);
  const built = formatHolidays(buildHolidays(await Promise.all(files.map((f) => readFile(new URL(f, DIR), 'utf8')))));
  assert.equal(await readFile(new URL('../core/data/tw-holidays.json', import.meta.url), 'utf8'), built, '請跑 node scripts/build-holidays.js scripts/data/dgpa-calendar/*.csv');
  // 審查 #122 找到的兩天
  assert.ok(isNationalHoliday('2026-02-15'), '小年夜（週日）');
  assert.ok(isNationalHoliday('2027-12-31'), '2028 元旦週六的補假');
  assert.equal(holidayName('2027-12-31'), '補假');
});

test('今年一定在清單裡；明年的日曆通常年中才公告：7/1 起才要求（之前只提醒），CI 不會在 1/1 突然紅燈（架構第二輪審查）', (t) => {
  const today = twDate();
  const y = Number(today.slice(0, 4));
  const hint = (year) => `國定假日清單沒有 ${year} 年：去 data.gov.tw 資料集 14718 下載新年度的辦公日曆，node scripts/build-holidays.js scripts/data/dgpa-calendar/*.csv`;
  assert.ok(HOLIDAY_YEARS.includes(y), hint(y));
  if (today.slice(5) >= '07-01') assert.ok(HOLIDAY_YEARS.includes(y + 1), hint(y + 1));
  else if (!HOLIDAY_YEARS.includes(y + 1)) t.diagnostic(hint(y + 1));
});
