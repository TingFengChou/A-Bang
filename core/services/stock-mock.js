// 股市示範資料：core/data/demo/stock-*.json 是 2026-11-19 下載的真實片段（上市 31 檔、上櫃 15 檔、指數），介面與真實版相同。
import { readFile } from 'node:fs/promises';
import { createStockServices, parseTwse, parseTpex } from './stock.js';

const D = new URL('../data/demo/', import.meta.url);
const json = async (f) => JSON.parse(await readFile(new URL(f, D), 'utf8'));

export const demoStockFetchers = {
  twse: async () => parseTwse(await json('stock-twse.json')),
  tpex: async () => parseTpex(await json('stock-tpex.json')),
  twseIndex: async () => (await json('stock-index.json')).twse,
  tpexIndex: async () => (await json('stock-index.json')).tpex,
};

export const createMockStockServices = () => createStockServices(demoStockFetchers);
