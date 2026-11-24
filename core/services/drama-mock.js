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

// 示範封面（2026-11-23）：虛構的劇沒有真的海報，由這裡畫一張 SVG（漸層＋劇名，標「示範」）；
// 上游網址用永遠連不到的 .invalid 網域，只是讓正規化後有「有封面」，實際的圖由 demoPoster 產生、不連網。
const withCover = (s) => ({ ...s, cover: `https://demo.invalid/cover/${encodeURIComponent(s.id)}.jpg` });
const TONES = [['#0f766e', '#5eead4'], ['#be185d', '#f9a8d4'], ['#7c3aed', '#c4b5fd'], ['#b45309', '#fcd34d'], ['#1d4ed8', '#93c5fd'], ['#15803d', '#86efac']];
const tone = (id) => TONES[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length]; // 與卡片的字＋漸層同一套顏色
const xml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** 示範海報（SVG，3:4）：劇名每行 4 字、最多 3 行，左下角標「示範」 */
export function demoPoster({ id, title }) {
  const [a, b] = tone(id);
  const chars = [...String(title || '')].slice(0, 12);
  const lines = [];
  for (let i = 0; i < chars.length; i += 4) lines.push(chars.slice(i, i + 4).join(''));
  const y0 = 200 - (lines.length - 1) * 30;
  const text = lines.map((l, i) => `<text x="150" y="${y0 + i * 60}" text-anchor="middle" font-size="52" font-weight="800" fill="#fff" font-family="'PingFang TC','Noto Sans TC',sans-serif">${xml(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="250" cy="70" r="90" fill="#fff" opacity=".12"/><circle cx="40" cy="360" r="120" fill="#000" opacity=".08"/>${text}<rect x="16" y="356" width="64" height="28" rx="8" fill="#fff" opacity=".9"/><text x="48" y="376" text-anchor="middle" font-size="16" font-weight="700" fill="${a}" font-family="'PingFang TC','Noto Sans TC',sans-serif">示範</text></svg>`;
}

// 取原始資料後走跟真實版一樣的正規化（parseList…），只快取正規化後的欄位
export const demoDramaFetchers = {
  ranking: async (type) => parseList((await load()).series.filter(LIST[type] || LIST.hot).sort(byHeat).map(withCover)),
  // 示範用的簡單比對：劇名先，再來類型標籤，最後簡介（台／臺視為相同）
  search: async (q) => {
    const n = normName(q);
    const words = n.split(/\s+/).filter(Boolean);
    const score = (s) => (words.every((w) => normName(s.title).includes(w)) ? 3 : words.every((w) => [...s.tags, s.category].some((t) => normName(t).includes(w))) ? 2 : words.every((w) => normName(s.synopsis).includes(w)) ? 1 : 0);
    return parseList((await load()).series.map((s) => [s, score(s)]).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1] || byHeat(a[0], b[0])).map(([s]) => withCover(s)));
  },
  series: async (id) => { const s = (await load()).series.find((x) => x.id === id); if (!s) throw notFound(); return parseSeries(withCover(s)); },
  synopsis: async (id) => { const s = (await load()).series.find((x) => x.id === id); if (!s) throw notFound(); return parseSynopsis({ seriesId: id, synopsis: s.synopsis }); },
  keywords: async () => parseKeywords((await load()).keywords),
  cover: async (s) => ({ body: Buffer.from(demoPoster(s)), type: 'image/svg+xml' }), // 自己畫的，不連網
};

/** @param {{ links?: object }} [opts] 連結設定與真實版相同（環境變數） */
export const createMockDramaServices = (opts) => createDramaServices(demoDramaFetchers, opts);
