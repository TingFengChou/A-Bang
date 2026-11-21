// 短劇示範資料（ADR-0019）：core/data/demo/drama.json 是虛構的劇名與簡介，形狀與公開讀取端點相同，
// 經同一套解析（createDramaServices），介面與真實版相同（Mock 對等）。排行、搜尋在這裡模擬上游的排序與比對。
import { readFile } from 'node:fs/promises';
import { createDramaServices, parseList, parseSeries, parseSynopsis, parseKeywords } from './drama.js';
import { normName } from '../util.js';

const FILE = new URL('../data/demo/drama.json', import.meta.url);
let cache = null;
const load = () => (cache ||= readFile(FILE, 'utf8').then(JSON.parse));
const byHeat = (a, b) => (b.heat ?? 0) - (a.heat ?? 0);
const LIST = { hot: () => true, new: (s) => s.newRelease, completed: (s) => s.completed, taiwan: (s) => s.taiwanOriginal };

/** 找不到時模擬上游 404（服務層會轉成「找不到這部短劇」） */
const notFound = () => Object.assign(new Error('MyDrama 劇集資訊回應錯誤（HTTP 404）'), { name: 'OpenDataError', upstreamStatus: 404 });

// 取原始資料後走跟真實版一樣的正規化（parseList…），只快取正規化後的欄位
export const demoDramaFetchers = {
  ranking: async (type) => parseList((await load()).series.filter(LIST[type] || LIST.hot).sort(byHeat)),
  // 示範用的簡單比對：劇名先，再來類型標籤，最後簡介（台／臺視為相同）
  search: async (q) => {
    const n = normName(q);
    const words = n.split(/\s+/).filter(Boolean);
    const score = (s) => (words.every((w) => normName(s.title).includes(w)) ? 3 : words.every((w) => [...s.tags, s.category].some((t) => normName(t).includes(w))) ? 2 : words.every((w) => normName(s.synopsis).includes(w)) ? 1 : 0);
    return parseList((await load()).series.map((s) => [s, score(s)]).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1] || byHeat(a[0], b[0])).map(([s]) => s));
  },
  series: async (id) => { const s = (await load()).series.find((x) => x.id === id); if (!s) throw notFound(); return parseSeries(s); },
  synopsis: async (id) => { const s = (await load()).series.find((x) => x.id === id); if (!s) throw notFound(); return parseSynopsis({ seriesId: id, synopsis: s.synopsis }); },
  keywords: async () => parseKeywords((await load()).keywords),
};

/** @param {{ links?: object }} [opts] 連結設定與真實版相同（環境變數） */
export const createMockDramaServices = (opts) => createDramaServices(demoDramaFetchers, opts);
