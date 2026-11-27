// 現在有看診的診所的示範資料：健保署診所資料的真實片段（core/data/demo/clinics.csv，2026-11-27 下載：
// 臺北市中正區、大安區的西醫、牙醫、中醫，與基隆市中正區幾家）；介面與 clinic.js 相同。
import { readFile } from 'node:fs/promises';
import { createClinicServices, parseClinics } from './clinic.js';

let rows = null;
export function createMockClinicServices() {
  return createClinicServices({ clinics: async () => (rows ||= parseClinics(await readFile(new URL('../data/demo/clinics.csv', import.meta.url), 'utf8'))) });
}
