// 護照現場等待人數（M16-04c）的示範資料：2026-11-27 抓到的真實 RSS（core/data/passport-wait-sample.xml）；介面與 passport.js 相同。
import { readFileSync } from 'node:fs';
import { createPassportServices } from './passport.js';

let xml = null;
export function createMockPassportServices() {
  return createPassportServices({ load: async () => (xml ||= readFileSync(new URL('../data/passport-wait-sample.xml', import.meta.url), 'utf8')) });
}
