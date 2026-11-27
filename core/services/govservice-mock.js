// 去政府辦事（M16-04a）的示範資料：我的E政府申辦服務資訊的真實片段（core/data/gov-services-sample.json，2026-11-27 下載，常見的十幾項），
// 介面與 govservice.js 相同；沒有連網（DEMO_MODE、測試）時用它。
import { readFileSync } from 'node:fs';
import { createGovServices } from './govservice.js';

let sample = null;
const load = () => (sample ||= JSON.parse(readFileSync(new URL('../data/gov-services-sample.json', import.meta.url), 'utf8')));

export function createMockGovServices() {
  return createGovServices({ load: async () => { const s = load(); return { online: s.online, counter: s.counter, other: s.other }; } });
}
