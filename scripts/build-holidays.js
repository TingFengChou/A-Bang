// 國定假日清單（開發時用，不在執行時期下載）：讀行政院人事行政總處的「政府行政機關辦公日曆表」CSV
// （data.gov.tw 資料集 14718；每年一個檔，例 115.csv、116.csv；欄位：西元日期、星期、是否放假〔2＝放假〕、備註），
// 取「放假而且有備註」的日子（節日、紀念日、補假；一般週末沒有備註）寫成 core/data/tw-holidays.json。
// 用法：node scripts/build-holidays.js scripts/data/dgpa-calendar/115.csv scripts/data/dgpa-calendar/116.csv
// （官方 CSV 存在 scripts/data/dgpa-calendar/，test/holidays.test.js 會比對產生的結果與 core/data/tw-holidays.json 一致）
// 每年官方公告新年度的日曆後跑一次；test/holidays.test.js 會在今年或明年不在清單時失敗提醒。
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../core/data/tw-holidays.json', import.meta.url);
const SOURCE = '行政院人事行政總處公告之政府行政機關辦公日曆表（data.gov.tw 資料集 14718）；已與 115、116 年辦公日曆表核對（scripts/build-holidays.js 由官方 CSV 產生）。以官方公告為準。';
const NOTE = '台灣國定假日（含補假）：捷運站別時刻表在這些日子改用 ServiceDay.NationalHolidays 的假日班表（core/holidays.js）。只列官方日曆「放假而且有備註」的日子（節日、紀念日、補假）；一般週末不列。';

/**
 * 一份官方 CSV → [{ date: 'YYYY-MM-DD', name }]（只取放假而且有備註的日子）
 * @param {string} text CSV 內容（可能有 BOM）
 */
export function parseCalendarCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.shift()?.split(',') || [];
  const col = (name) => head.findIndex((h) => h.trim() === name);
  const [iDate, iOff, iNote] = [col('西元日期'), col('是否放假'), col('備註')];
  if (iDate < 0 || iOff < 0 || iNote < 0) throw new Error(`CSV 欄位不對（要有 西元日期、是否放假、備註）：${head.join(',')}`);
  const out = [];
  for (const l of lines) {
    const c = l.split(',');
    const d = (c[iDate] || '').trim();
    const note = (c[iNote] || '').trim();
    if (!/^\d{8}$/.test(d)) throw new Error(`日期格式不對：${l}`);
    if ((c[iOff] || '').trim() === '2' && note) out.push({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: note });
  }
  return out;
}

/** 寫檔格式：一天一行（好讀、好比對） */
export function formatHolidays(data) {
  const years = Object.entries(data.years).map(([y, l]) => `    ${JSON.stringify(y)}: [\n${l.map((x) => `      { "date": ${JSON.stringify(x.date)}, "name": ${JSON.stringify(x.name)} }`).join(',\n')}\n    ]`);
  return `{\n  "note": ${JSON.stringify(data.note)},\n  "source": ${JSON.stringify(data.source)},\n  "years": {\n${years.join(',\n')}\n  }\n}\n`;
}

/** 多份 CSV → tw-holidays.json 的內容（依年份分組、日期排序） */
export function buildHolidays(texts) {
  const years = {};
  for (const x of texts.flatMap(parseCalendarCsv)) (years[x.date.slice(0, 4)] ||= []).push(x);
  for (const y of Object.keys(years)) years[y].sort((a, b) => a.date.localeCompare(b.date));
  return { note: NOTE, source: SOURCE, years: Object.fromEntries(Object.keys(years).sort().map((y) => [y, years[y]])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('用法：node scripts/build-holidays.js path/115.csv path/116.csv（data.gov.tw 資料集 14718 下載）'); process.exit(1); }
  const data = buildHolidays(await Promise.all(files.map((f) => readFile(f, 'utf8'))));
  await writeFile(OUT, formatHolidays(data));
  console.log(`寫入 core/data/tw-holidays.json：${Object.entries(data.years).map(([y, l]) => `${y} 年 ${l.length} 天`).join('、')}`);
}
