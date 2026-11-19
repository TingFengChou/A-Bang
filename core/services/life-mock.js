// 生活服務示範資料（M10）：core/data/demo/ 的真實資料片段（2026-11-19 下載），介面與真實版相同。
import { readFile } from 'node:fs/promises';
import { csvObjects } from '../csv.js';
import { createLifeServices } from './life.js';

const D = new URL('../data/demo/', import.meta.url);
const text = (f) => readFile(new URL(f, D), 'utf8');
const json = async (f) => JSON.parse(await text(f));

/** 示範 fetchers（也給真實版在沒有金鑰時借用：空品、地震） */
export const demoLifeFetchers = {
  aqi: () => json('aqi.json'),
  quakes: async () => { const q = await json('quakes.json'); return [['significant', q.significant], ['local', q.local]]; },
  pharmacies: async () => csvObjects(await text('pharmacies.csv')),
  garbage: async () => ({ taipei: csvObjects(await text('garbage-taipei.csv')), ntpc: csvObjects(await text('garbage-ntpc.csv')), gps: csvObjects(await text('garbage-ntpc-gps.csv')) }),
  fuel: () => json('fuel.json'),
  invoice: () => text('invoice.xml'),
};

export const createMockLifeServices = () => createLifeServices(demoLifeFetchers);
