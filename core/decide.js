// 決策引擎：依使用者狀態，替交通方案排序並說明理由（ADR-0010）
// 純函式、規則透明、可測試；不經模型。模型只負責「判斷使用者狀態」與「用口語轉述結果」。
// 前端與 MCP Apps 卡片可以直接用 breakdown 畫出決策過程。

/** 比較項目（都是越小越好）。
 *  ratio：以「最佳值 / 本方案」比例計分（加 k 避免 0），不會被極端值（例如很貴的叫車）壓扁差距
 *  abs：本身是 0–1 的程度值，直接以 1 - 值 計分 */
// 2026-11-21 權重調整（產品負責人：「點去 101 幾乎都是叫車」）：叫車在等車、走路、戶外、體力永遠最好，原本這四項佔 45%、費用只佔 15%，
// 沒有任何狀態也幾乎都推叫車。改成費用 20%、戶外 3%、體力 5%、走路 12%：預設推大眾運輸；趕時間、帶行李、下雨、帶長輩、行動不便時才推叫車。
// 戶外與體力的基本權重降了，下雨、空品、行李、少走路等狀態的倍數等比例調高（否則下雨會推騎 YouBike）。
export const CRITERIA = [
  { key: 'minutes', label: '總時間', base: 0.40, scale: 'ratio', k: 5 },
  { key: 'waitMin', label: '等車', base: 0.10, scale: 'ratio', k: 5 },
  { key: 'walkMin', label: '走路', base: 0.12, scale: 'ratio', k: 5 },
  { key: 'cost', label: '費用', base: 0.20, scale: 'ratio', k: 20 },
  { key: 'exposure', label: '戶外', base: 0.03, scale: 'abs' }, // 0 = 全程室內／有遮蔽，1 = 全程戶外（下雨淋雨、空品差吸髒空氣）
  { key: 'effort', label: '體力', base: 0.05, scale: 'abs' }, // 0 = 輕鬆，1 = 費力（騎車、長距離步行）
  { key: 'delayRisk', label: '塞車風險', base: 0.05, scale: 'abs' }, // 0 = 軌道／專用道，1 = 走一般道路且路況差
];

/** 使用者狀態：顯示名稱與對權重的影響（倍數） */
export const STATES = {
  rush: { label: '趕時間', say: '你趕時間', boost: { minutes: 2, waitMin: 1.5, delayRisk: 2 } },
  traffic: { label: '塞車中', say: '路上正在塞車', boost: { delayRisk: 6, minutes: 1.2 } },
  rain: { label: '下雨', say: '正在下雨', boost: { exposure: 13, walkMin: 1.5 } },
  luggage: { label: '帶行李', say: '你帶著行李', boost: { effort: 8 } },
  budget: { label: '想省錢', say: '你想省錢', boost: { cost: 3 } }, // ×5 時「想省錢」會推走路 100 分鐘（2026-11-21 權重調整）
  lessWalk: { label: '少走路', say: '你想少走路、輕鬆一點', boost: { walkMin: 1.5, effort: 6 } },
  // 空品不佳（AQI > 100，對敏感族群不健康以上）：少待戶外、少做費力的騎車與長距離步行（M10）
  badAir: { label: '空品不佳', say: '空氣品質不佳', boost: { exposure: 10, effort: 4 } },
  // 同行者與行動能力（A1，2026-11-21）：exclude＝不適合的方式直接排除（原因寫明）
  elder: { label: '帶長輩', say: '你帶著長輩', boost: { walkMin: 2, effort: 6, waitMin: 1.3 }, exclude: ['bike'] },
  kids: { label: '帶小孩', say: '你帶著小孩', boost: { walkMin: 1.5, effort: 6 }, exclude: ['bike'] },
  mobility: { label: '行動不便', say: '你行動不便', boost: { walkMin: 3, effort: 8 }, exclude: ['bike', 'walk'] },
  // 第二批（A1b，2026-11-21）：都由程式自動判斷（plan_trip 依 prefs.party、天氣預報），不靠模型
  group: { label: '多人同行', say: '你們好幾個人一起', boost: { effort: 2.6 } }, // 叫車車資已換成每人分攤（trip.js），這裡只略看重好不好帶隊
  rainSoon: { label: '可能下雨', say: '等一下可能下雨', boost: { exposure: 7 } }, // 現在沒下、3 小時降雨機率 ≥ 60%
};

/** 習慣（個人化，2026-11-21）：手機記的「常選的交通方式」比例（public/js/habits.js），只小幅加分、不改權重。
 *  max：最多加幾分（滿分 1＝100 分）；full：常選比例到這裡就加滿（60% 捷運＋40% 公車 → 捷運 +8、公車 +5.3，混著選的人差距自然變小）
 *  只有「沒指定方式、使用者沒說狀況」才看習慣；比最快的方案慢太多（超過 2 倍且多 20 分以上）的不加分（走路 100 分鐘不會因為習慣勝出） */
export const HABIT = { max: 0.08, full: 0.6 };
const HABIT_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '搭捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車' };

/** 每個方案的習慣加分（0～HABIT.max）；不適用時回 0 */
export function habitBonus(o, habit, fastest) {
  const share = Number(habit?.[o.role]);
  if (!(share > 0) || !Number.isFinite(share)) return 0;
  if (Number(o.minutes) > Math.max(fastest * 2, fastest + 20)) return 0;
  return HABIT.max * Math.min(1, share / HABIT.full);
}

/**
 * @param {Array<{ id: string, name: string, minutes: number, waitMin?: number, walkMin?: number, cost?: number,
 *                 exposure?: number, effort?: number, arriveAt?: string }>} options
 * @param {{ states?: string[], arriveBy?: string, arriveByMin?: number, habit?: Record<string, number>, said?: boolean }} [ctx]  states 例如 ['rain','luggage']；arriveBy 例如 '08:00'
 *   arriveByMin 與方案的 arriveMin（自出發日 00:00 起算、可超過 24 小時）同時存在時以分鐘比較，跨午夜才不會誤判
 *   habit：常選比例（{ metro: 0.6, bus: 0.3 }）；said：使用者自己說了（或點選了）狀態 → 這次以狀況為準、不看習慣
 * @returns {{ weights: Record<string, number>, ranked: Array<object>, excluded: Array<object>, best: object|null, reason: string }}
 */
export function decide(options, ctx = {}) {
  let states = (ctx.states || []).filter((s) => STATES[s]);
  // 帶長輩、帶小孩、行動不便已包含少走路：不再疊加 lessWalk（權重會重複放大；PR #36 審查）
  if (states.some((k) => STATES[k].exclude)) states = states.filter((k) => k !== 'lessWalk');

  // 1. 權重：基本權重 × 狀態倍數，再正規化成總和 1
  const raw = Object.fromEntries(CRITERIA.map((c) => [c.key, c.base]));
  for (const s of states) for (const [k, m] of Object.entries(STATES[s].boost)) raw[k] *= m;
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / sum]));

  // 2. 硬限制：使用者說不要的方式（「不要叫車」）、指定抵達時間時會遲到的方案，直接排除
  const excluded = [];
  const avoid = new Set(ctx.avoid || []);
  const pool = options.filter((o) => {
    if (avoid.has(o.role)) {
      excluded.push({ ...o, why: `你說不要${MODE_NAME[o.role] || o.name}` });
      return false;
    }
    // 狀態不適合的方式（帶長輩不騎 YouBike…）；使用者明講要這種方式時照他選（理由補一句提醒）
    const unfit = o.role !== ctx.mode && states.find((k) => STATES[k].exclude?.includes(o.role));
    if (unfit) {
      excluded.push({ ...o, why: `${STATES[unfit].label}不建議${MODE_DO[o.role] || o.name}` });
      return false;
    }
    const late = ctx.arriveByMin != null && o.arriveMin != null ? o.arriveMin > ctx.arriveByMin : ctx.arriveBy && o.arriveAt && o.arriveAt > ctx.arriveBy;
    if (late) {
      excluded.push({ ...o, why: `${o.arriveAt} 才到，超過 ${ctx.arriveBy}` });
      return false;
    }
    return true;
  });

  // 3. 各項正規化（越小越好 → 分數越高），乘上權重；習慣另外小幅加分（breakdown.habit）
  const val = (o, k) => Number(o[k] ?? 0);
  const habitOn = !!ctx.habit && !ctx.mode && !ctx.said;
  const fastest = Math.min(...pool.map((p) => val(p, 'minutes')));
  const ranked = pool.map((o) => {
    const breakdown = {};
    for (const c of CRITERIA) {
      let norm;
      if (c.scale === 'abs') norm = 1 - Math.min(1, Math.max(0, val(o, c.key)));
      else { const lo = Math.min(...pool.map((p) => val(p, c.key))); norm = (lo + c.k) / (val(o, c.key) + c.k); }
      breakdown[c.key] = norm * weights[c.key];
    }
    const bonus = habitOn ? habitBonus(o, ctx.habit, fastest) : 0;
    if (bonus > 0) breakdown.habit = bonus;
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { ...o, score: Math.round(score * 100), breakdown };
  }).sort((a, b) => b.score - a.score || a.minutes - b.minutes);

  // 4. 使用者指定交通方式（「改坐公車」）：分數與排名照算，建議改成該方式裡分數最高的（沒有這種方式就照分數）
  const picked = ctx.mode ? ranked.find((o) => o.role === ctx.mode) : null;
  if (picked) {
    const top = ranked[0];
    const note = picked === top ? '' : `（分數 ${picked.score}；分數最高的是${top.name} ${top.score}）`;
    const careful = states.find((k) => STATES[k].exclude?.includes(ctx.mode));
    return { weights, ranked, excluded, best: picked, mode: ctx.mode, reason: `照你說的選「${picked.name}」${note}。${careful ? `${STATES[careful].label}要多注意安全。` : ''}` };
  }
  const best = ranked[0] || null;
  const reason = explain(best, ranked[1], states, excluded);
  if (habitOn) return { weights, ranked, excluded, best, reason, habitOn };
  // 指定的交通方式沒有可行方案：照分數建議，但要明說（使用者才不會以為已經改成功）
  if (ctx.mode) return { weights, ranked, excluded, best, modeUnavailable: ctx.mode, reason: `${MODE_NAME[ctx.mode] || '你指定的方式'}這次沒有可行的方案；${reason}` };
  return { weights, ranked, excluded, best, reason };
}

const MODE_NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' };
const MODE_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '坐捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車' };

/** 產生一句理由：最佳方案贏在哪裡（取貢獻差最大的項目）＋生效的狀態 */
function explain(best, second, states, excluded) {
  if (!best) {
    const said = excluded.some((e) => !e.why.includes('超過')), late = excluded.some((e) => e.why.includes('超過'));
    // 行動不便時沒有可行方案（短程只有步行、YouBike，或叫車被說不要）：主動建議叫車／無障礙計程車
    const help = excluded.some((e) => e.why.startsWith('行動不便')) ? '可以叫車，或預約各縣市的無障礙計程車（復康巴士）。' : '';
    return (said && late ? '排除不適合或你說不要的方式後，其他方案都會遲到。' : late ? '所有方案都趕不上指定時間。' : said ? '排除不適合或你說不要的方式後，沒有其他可行的方案。' : '沒有可比較的方案。') + help;
  }
  const why = [];
  if (states.length) why.push(`因為${states.map((s) => STATES[s].say).join('、')}`);
  const often = best.breakdown?.habit > 0 && (!second || best.breakdown.habit >= (second.breakdown?.habit || 0)) ? [`你常${HABIT_DO[best.role] || `選${best.name}`}`] : []; // 習慣（你常搭捷運）
  if (second) {
    const diffs = CRITERIA.map((c) => ({ c, d: best.breakdown[c.key] - second.breakdown[c.key] })).sort((a, b) => b.d - a.d);
    const top = diffs.filter((x) => x.d > 0.01).slice(0, 2).map((x) => PHRASE[x.c.key](best, second, states));
    if (often.length || top.length) why.push([...often, ...top].join('、'));
  } else if (often.length) why.push(often[0]);
  const said = excluded.filter((e) => e.why.startsWith('你說不要')), unfit = excluded.filter((e) => e.why.includes('不建議')), late = excluded.filter((e) => e.why.includes('超過'));
  if (said.length) why.push(`${said.map((e) => e.name).join('、')}照你說的不列入`);
  if (unfit.length) why.push([...new Set(unfit.map((e) => e.why))].join('、'));
  if (late.length) why.push(`${late.map((e) => e.name).join('、')}會遲到已排除`);
  return `選「${best.name}」${why.length ? '：' + why.join('，') : ''}。`;
}

const PHRASE = {
  minutes: (b, s) => `比${s.name}快 ${Math.max(1, s.minutes - b.minutes)} 分`,
  waitMin: (b) => (b.waitMin ? `只要等 ${b.waitMin} 分` : '不用等車'),
  walkMin: (b) => (b.walkMin ? `只走 ${b.walkMin} 分` : '不用走路'),
  cost: (b, s) => (b.cost < s.cost ? `省 ${s.cost - b.cost} 元` : '費用較低'),
  exposure: (_b, _s, states = []) => (states.includes('badAir') && !states.includes('rain') ? '少待在戶外' : '比較不會淋雨'),
  effort: () => '比較輕鬆',
  delayRisk: () => '不受塞車影響',
};
