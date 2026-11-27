// 找最近的戶政事務所（M16-04b）的示範資料：同一份資料的真實片段（core/data/gov-offices-sample.json，2026-11-27 下載：
// 臺北市附近與板橋、苓雅的戶政事務所、對應的電話、115 年辦公日曆）；介面與 govoffice.js 相同。
import { readFileSync } from 'node:fs';
import { createGovOfficeServices, parseOffices, parseTels, parseCalendar } from './govoffice.js';

let sample = null;
const load = () => (sample ||= JSON.parse(readFileSync(new URL('../data/gov-offices-sample.json', import.meta.url), 'utf8')));

export function createMockGovOfficeServices() {
  return createGovOfficeServices({
    offices: async () => parseOffices(load().points),
    tels: async () => parseTels(load().ris),
    calendar: async (year) => (year === 2026 ? parseCalendar(load().calendar115) : null), // 其他年份：照週末推（known: false）
  });
}
