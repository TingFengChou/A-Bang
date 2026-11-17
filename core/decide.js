// 決策引擎：依使用者狀態，替交通方案排序並說明理由（ADR-0010）
// 純函式、規則透明、可測試；不經模型。模型只負責「判斷使用者狀態」與「用口語轉述結果」。
// 前端與 MCP Apps 卡片可以直接用 breakdown 畫出決策過程。

/** 比較項目（都是越小越好）。
 *  ratio：以「最佳值 / 本方案」比例計分（加 k 避免 0），不會被極端值（例如很貴的叫車）壓扁差距
 *  abs：本身是 0–1 的程度值，直接以 1 - 值 計分 */
export const CRITERIA = [
  { key: 'minutes', label: '總時間', base: 0.40, scale: 'ratio', k: 5 },
  { key: 'waitMin', label: '等車', base: 0.10, scale: 'ratio', k: 5 },
  { key: 'walkMin', label: '走路', base: 0.15, scale: 'ratio', k: 5 },
  { key: 'cost', label: '費用', base: 0.15, scale: 'ratio', k: 20 },
  { key: 'exposure', label: '淋雨', base: 0.10, scale: 'abs' }, // 0 = 全程室內／有遮蔽，1 = 全程戶外
  { key: 'effort', label: '體力', base: 0.10, scale: 'abs' }, // 0 = 輕鬆，1 = 費力（騎車、長距離步行）
  { key: 'delayRisk', label: '塞車風險', base: 0.05, scale: 'abs' }, // 0 = 軌道／專用道，1 = 走一般道路且路況差
];

/** 使用者狀態：顯示名稱與對權重的影響（倍數） */
export const STATES = {
  rush: { label: '趕時間', say: '你趕時間', boost: { minutes: 2, waitMin: 1.5, delayRisk: 2 } },
  traffic: { label: '塞車中', say: '路上正在塞車', boost: { delayRisk: 6, minutes: 1.2 } },
  rain: { label: '下雨', say: '正在下雨', boost: { exposure: 4, walkMin: 1.5 } },
  luggage: { label: '帶行李', say: '你帶著行李', boost: { effort: 4 } },
  budget: { label: '想省錢', say: '你想省錢', boost: { cost: 5 } },
  lessWalk: { label: '少走路', say: '你想少走路、輕鬆一點', boost: { walkMin: 1.5, effort: 3 } },
};

/**
 * @param {Array<{ id: string, name: string, minutes: number, waitMin?: number, walkMin?: number, cost?: number,
 *                 exposure?: number, effort?: number, arriveAt?: string }>} options
 * @param {{ states?: string[], arriveBy?: string, arriveByMin?: number }} [ctx]  states 例如 ['rain','luggage']；arriveBy 例如 '08:00'
 *   arriveByMin 與方案的 arriveMin（自出發日 00:00 起算、可超過 24 小時）同時存在時以分鐘比較，跨午夜才不會誤判
 * @returns {{ weights: Record<string, number>, ranked: Array<object>, excluded: Array<object>, best: object|null, reason: string }}
 */
export function decide(options, ctx = {}) {
  const states = (ctx.states || []).filter((s) => STATES[s]);

  // 1. 權重：基本權重 × 狀態倍數，再正規化成總和 1
  const raw = Object.fromEntries(CRITERIA.map((c) => [c.key, c.base]));
  for (const s of states) for (const [k, m] of Object.entries(STATES[s].boost)) raw[k] *= m;
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / sum]));

  // 2. 硬限制：指定抵達時間時，會遲到的方案直接排除
  const excluded = [];
  const pool = options.filter((o) => {
    const late = ctx.arriveByMin != null && o.arriveMin != null ? o.arriveMin > ctx.arriveByMin : ctx.arriveBy && o.arriveAt && o.arriveAt > ctx.arriveBy;
    if (late) {
      excluded.push({ ...o, why: `${o.arriveAt} 才到，超過 ${ctx.arriveBy}` });
      return false;
    }
    return true;
  });

  // 3. 各項正規化（越小越好 → 分數越高），乘上權重
  const val = (o, k) => Number(o[k] ?? 0);
  const ranked = pool.map((o) => {
    const breakdown = {};
    for (const c of CRITERIA) {
      let norm;
      if (c.scale === 'abs') norm = 1 - Math.min(1, Math.max(0, val(o, c.key)));
      else { const lo = Math.min(...pool.map((p) => val(p, c.key))); norm = (lo + c.k) / (val(o, c.key) + c.k); }
      breakdown[c.key] = norm * weights[c.key];
    }
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { ...o, score: Math.round(score * 100), breakdown };
  }).sort((a, b) => b.score - a.score || a.minutes - b.minutes);

  const best = ranked[0] || null;
  return { weights, ranked, excluded, best, reason: explain(best, ranked[1], states, excluded) };
}

/** 產生一句理由：最佳方案贏在哪裡（取貢獻差最大的項目）＋生效的狀態 */
function explain(best, second, states, excluded) {
  if (!best) return excluded.length ? '所有方案都趕不上指定時間。' : '沒有可比較的方案。';
  const why = [];
  if (states.length) why.push(`因為${states.map((s) => STATES[s].say).join('、')}`);
  if (second) {
    const diffs = CRITERIA.map((c) => ({ c, d: best.breakdown[c.key] - second.breakdown[c.key] })).sort((a, b) => b.d - a.d);
    const top = diffs.filter((x) => x.d > 0.01).slice(0, 2).map((x) => PHRASE[x.c.key](best, second));
    if (top.length) why.push(top.join('、'));
  }
  if (excluded.length) why.push(`${excluded.map((e) => e.name).join('、')}會遲到已排除`);
  return `選「${best.name}」${why.length ? '：' + why.join('，') : ''}。`;
}

const PHRASE = {
  minutes: (b, s) => `比${s.name}快 ${Math.max(1, s.minutes - b.minutes)} 分`,
  waitMin: (b) => (b.waitMin ? `只要等 ${b.waitMin} 分` : '不用等車'),
  walkMin: (b) => `只走 ${b.walkMin ?? 0} 分`,
  cost: (b, s) => (b.cost < s.cost ? `省 ${s.cost - b.cost} 元` : '費用較低'),
  exposure: () => '比較不會淋雨',
  effort: () => '比較輕鬆',
  delayRisk: () => '不受塞車影響',
};
