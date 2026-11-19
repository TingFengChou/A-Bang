// 防詐示範資料（M7-02）：真實 CSV 的小片段（core/data/demo/，容器內也有），介面與真實版相同（架構規則 3）。
import { readFile } from 'node:fs/promises';
import { createAntifraudFromLoader } from './antifraud.js';

const DIR = new URL('../data/demo/', import.meta.url);

export function createMockAntifraudServices() {
  return createAntifraudFromLoader({
    load: async () => ({ sitesCsv: await readFile(new URL('antifraud-sites.csv', DIR), 'utf8'), mythsCsv: await readFile(new URL('antifraud-myths.csv', DIR), 'utf8') }),
  });
}
