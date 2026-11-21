// 工具包：drama（MyDrama 短劇，ADR-0019）— 風險分級 L1：只讀公開片庫，不登入、不付款、不解鎖。
// 網頁 agent、MCP、REST 都從 registry 取用（ADR-0002）；結論用 drama 卡片呈現，看劇用 MyDrama App 的深層連結。
import { z } from 'zod';
import { defineTool, clip } from './define.js';
import { DRAMA_LISTS } from '../services/drama.js';
import { DRAMA_ID } from '../drama-say.js';

const PACK = 'drama';
const SOURCE = 'MyDrama 短劇（公開片庫）';
const DEMO = '【示範資料：尚未設定 MyDrama 連線，以下劇名與簡介都是虛構的】';
const common = { pack: PACK, tier: 'L1', card: 'drama', source: SOURCE, demoNote: DEMO, modeOf: (svc) => svc.dramaMode };
const limit = z.number().int().min(1).max(10).default(5).describe('最多幾部（預設 5）');

/** 「共 60 集・前 10 集免費・已完結」 */
export function dramaMeta(s) {
  return [s.episodes != null && `共 ${s.episodes} 集`, s.freeEpisodes ? `前 ${s.freeEpisodes} 集免費` : null, s.completed ? '已完結' : '連載中', s.taiwanOriginal && '台灣自製'].filter(Boolean).join('・');
}
const line = (s) => `- 《${s.title}》${s.tags.length ? `［${s.tags.join('、')}］` : ''}${dramaMeta(s)}${s.synopsis ? `：${s.synopsis}` : ''}`;
const titles = (items, n = 3) => items.slice(0, n).map((s) => `《${s.title}》`).join('、');
const LINK_NOTE = '卡片上可以按「在 MyDrama 看」開 App（沒裝會到商店頁）。';

export const dramaPicks = defineTool({
  name: 'drama_picks',
  title: '短劇排行',
  description: `查 MyDrama 短劇的排行：hot 熱門（預設）、new 新上架、completed 已完結（可以一次追完）、taiwan 台灣自製。回傳劇名、類型標籤、集數、免費集數與簡介，並附熱搜關鍵字。使用者說「最近有什麼好看的短劇」「推薦一部短劇」時用；要找某種類型（甜寵、懸疑）或劇名用 drama_search。只推薦、不代替登入或付費。`,
  ...common,
  input: {
    list: z.enum(DRAMA_LISTS).default('hot').describe('排行種類：hot 熱門、new 新上架、completed 已完結、taiwan 台灣自製'),
    limit,
  },
  speak: (d) => (d.items.length ? `${d.listName}前 ${Math.min(3, d.items.length)} 名：${titles(d.items)}。` : `${d.listName}目前沒有可以推薦的劇。`),
  async run(svc, a) {
    const data = await svc.drama.picks(a);
    const text = clip([`MyDrama 短劇・${data.listName}（${data.items.length} 部）`, ...data.items.map(line), ...(data.keywords.length ? [`熱搜：${data.keywords.join('、')}`] : []), LINK_NOTE]);
    return { data, text };
  },
});

export const dramaSearch = defineTool({
  name: 'drama_search',
  title: '找短劇',
  description: '在 MyDrama 片庫找短劇：可以用劇名、類型（甜寵、霸總、懸疑、重生、逆襲、復仇、古裝、喜劇…）、演員或簡介裡的字。回傳符合的劇（熱門優先）與總數。query 只放要找的字，例如「甜寵」，不要放「短劇」「推薦」。',
  ...common,
  input: {
    query: z.string().trim().min(1).max(20).describe('劇名或類型，例如「甜寵」「懸疑」'),
    limit,
  },
  speak: (d) => (d.items.length ? `「${d.query}」找到 ${d.total} 部${d.total > d.items.length ? `，先列 ${d.items.length} 部` : ''}：${titles(d.items)}。` : `沒有找到「${d.query}」的短劇，換個說法或看看熱門排行。`),
  async run(svc, a) {
    const data = await svc.drama.search(a);
    const text = data.items.length
      ? clip([`MyDrama 找「${data.query}」：${data.total} 部${data.total > data.items.length ? `（列前 ${data.items.length} 部）` : ''}`, ...data.items.map(line), LINK_NOTE])
      : `MyDrama 沒有找到「${data.query}」的短劇；可以換個類型或改看熱門排行（drama_picks）。`;
    return { data, text };
  },
});

export const dramaSeries = defineTool({
  name: 'drama_series',
  title: '短劇簡介',
  description: '看 MyDrama 某一部短劇的完整簡介、集數、免費集數、是否完結。id 用 drama_picks 或 drama_search 結果裡的 id。',
  ...common,
  input: {
    id: z.string().trim().regex(DRAMA_ID, 'id 只能有英數、底線、連字號').describe('劇的 id（來自 drama_picks／drama_search）'),
  },
  speak: (d) => { const s = d.items[0]; return `《${s.title}》${dramaMeta(s)}。`; },
  async run(svc, a) {
    const data = await svc.drama.series(a);
    const s = data.items[0];
    return { data, text: [`《${s.title}》${s.tags.length ? `［${s.tags.join('、')}］` : ''}`, dramaMeta(s), s.synopsis ? `簡介：${s.synopsis}` : '（沒有簡介）', LINK_NOTE].join('\n') };
  },
});

export default [dramaPicks, dramaSearch, dramaSeries];
