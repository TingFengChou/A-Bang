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
  // reason：本身就是叫車的理由（產品負責人：趕時間、帶行李、行動不便、下雨…）；有這種狀態時不做「花錢換時間要划算」的檢查（VALUE_OF_TIME），照權重
  rush: { label: '趕時間', say: '你趕時間', boost: { minutes: 2, waitMin: 1.5, delayRisk: 2 }, reason: true },
  traffic: { label: '塞車中', say: '路上正在塞車', boost: { delayRisk: 6, minutes: 1.2 } },
  rain: { label: '下雨', say: '正在下雨', boost: { exposure: 13, walkMin: 1.5 }, reason: true },
  luggage: { label: '帶行李', say: '你帶著行李', boost: { effort: 8 }, reason: true },
  budget: { label: '想省錢', say: '你想省錢', boost: { cost: 3 } }, // ×5 時「想省錢」會推走路 100 分鐘（2026-11-21 權重調整）
  lessWalk: { label: '少走路', say: '你想少走路、輕鬆一點', boost: { walkMin: 1.5, effort: 6 }, reason: true },
  // 空品不佳（AQI > 100，對敏感族群不健康以上）：少待戶外、少做費力的騎車與長距離步行（M10）
  badAir: { label: '空品不佳', say: '空氣品質不佳', boost: { exposure: 10, effort: 4 }, reason: true },
  // 同行者與行動能力（A1，2026-11-21）：exclude＝不適合的方式直接排除（原因寫明）
  elder: { label: '帶長輩', say: '你帶著長輩', boost: { walkMin: 2, effort: 6, waitMin: 1.3 }, exclude: ['bike'], reason: true },
  kids: { label: '帶小孩', say: '你帶著小孩', boost: { walkMin: 1.5, effort: 6 }, exclude: ['bike'], reason: true },
  mobility: { label: '行動不便', say: '你行動不便', boost: { walkMin: 3, effort: 8 }, exclude: ['bike', 'walk'], reason: true },
  // 第二批（A1b，2026-11-21）：都由程式自動判斷（plan_trip 依 prefs.party、天氣預報），不靠模型
  group: { label: '多人同行', say: '你們好幾個人一起', boost: { effort: 2.6 } }, // 叫車車資已換成每人分攤（trip.js），這裡只略看重好不好帶隊
  rainSoon: { label: '可能下雨', say: '等一下可能下雨', boost: { exposure: 7 } }, // 現在沒下、3 小時降雨機率 ≥ 60%
};

/** 花錢換時間要划算（2026-11-22，ADR-0010）：叫車比大眾運輸最好的方案貴，多付的錢要換到等值的時間才可以排在它前面。
 *  上面的比例計分會把價差壓扁（285 元對 25 元只差十幾分，走路 0 對 6 分卻差很多），沒有任何狀況時常推「多付 260 元只快 5 分」的叫車。
 *  perMin：每分鐘的時間價值（新台幣）。5 元＝每小時 300 元，約是台灣受僱員工的平均時薪（月薪約 4.6 萬 ÷ 約 165 工時，主計總處），常數、可調。
 *  walk／wait：走路、等車的體感倍數（交通規劃常用約 2 倍，例：英國 WebTAG）；transferMin：每轉乘一次多算 5 分的負擔。
 *  狀態：趕時間、帶行李、長輩、小孩、行動不便、少走路、下雨、空品不佳本身就是叫車的理由（STATES.*.reason），有這些狀態時不做這個檢查、照權重（行為與 2026-11-21 相同）；
 *  塞車中、想省錢、可能下雨、多人同行（叫車已是每人分攤）不是理由，照樣檢查。 */
export const VALUE_OF_TIME = { perMin: 5, walk: 2, wait: 2, transferMin: 5 };
/** 要檢查划不划算的方式（門到門、貴很多的那種）；拿來比的大眾運輸（沒有大眾運輸時——深夜收班、附近沒有站——不檢查，照權重） */
const PREMIUM_ROLES = new Set(['ridehail']);
const TRANSIT_ROLES = new Set(['bus', 'metro', 'tra', 'thsr', 'intercity']);
/** 走太久、騎太久（分）：沒有理由狀態、有大眾運輸時，超過的步行、YouBike 不排在最好的大眾運輸前面（產品負責人授權，2026-11-22 PR #119 審查） */
export const LONG_MIN = { walk: 25, bike: 30 };

/** 估算值保守看（ADR-0010 2026-11-22，真實健檢：估算的客運票價 50 元〔實際約 140〕、估算的機場捷運 58 分〔實際約 40〕主導了排名）：
 *  方案的 est.minutes／est.cost＝時間／票價有估的部分（不是班表、即時資料或公告）：true＝整個值、數字＝估的那幾分／幾元；
 *  計分時把估的部分多算這個比例（只扣自己，不改別人的分數），扣的分記在 breakdown.uncertain（負數，決策圖「估算」）。
 *  叫車不標（時間與車資本來就是估算，已有車資範圍與「花錢換時間要划算」的檢查）；到站時間不明的公車另由 etaUnknown 處理，不重複扣。 */
export const UNCERTAIN = { minutes: 0.15, cost: 0.3 };

/** 同分時：因「不划算」被壓下來的叫車排在讓位的公車後面（時間不明的公車讓位後跟叫車同分時，公車在前，理由句說「公車到站時間不明」而不是跟叫車比價；PR #124 審查） */
const notWorthLast = (a, b) => (a.notWorth && b.unsure ? 1 : b.notWorth && a.unsure ? -1 : 0); // 只處理這一種同分（其他同分照時間短的在前，理由句不變）

/** 等很久才有班次（trip.js longWait：深夜等首班，2026-11-23 交通健檢）：方案的 minutes、waitMin 是「晚點出門、等車只算 10 分」算的，
 *  現在就要走時不準——01:00 台北→新竹推了 06:41 才到的台鐵，叫車 02:38 就到。決策改用真正要等的時間（＝從現在到抵達），
 *  longWait.extra＝多等的分鐘（真正的等車 − waitMin）。沒有 longWait 的方案不變。 */
export const effMinutes = (o) => Number(o?.minutes ?? 0) + Number(o?.longWait?.extra ?? 0);
const effWait = (o) => Number(o?.waitMin ?? 0) + Number(o?.longWait?.extra ?? 0);

/** 轉乘次數：有 transfers 就用；否則看分段（走路以外的段數 − 1）＋捷運本身的轉乘 */
function transfersOf(o) {
  if (Number.isFinite(o.transfers)) return o.transfers;
  const rides = (o.legs || []).filter((l) => l.mode !== 'walk').length;
  return Math.max(0, rides - 1) + (o.metro?.transfer ? 1 : 0);
}
/** 體感時間（分）：總時間＋走路、等車多算的部分＋轉乘負擔 */
export function feltMinutes(o) {
  const n = (k) => Number(o[k] ?? 0);
  return effMinutes(o) + (VALUE_OF_TIME.walk - 1) * n('walkMin') + (VALUE_OF_TIME.wait - 1) * effWait(o) + VALUE_OF_TIME.transferMin * transfersOf(o);
}

/** 習慣（個人化，2026-11-21）：手機記的「常選的交通方式」比例（public/js/habits.js），只小幅加分、不改權重。
 *  max：最多加幾分（滿分 1＝100 分）；full：常選比例到這裡就加滿（60% 捷運＋40% 公車 → 捷運 +8、公車 +5.3，混著選的人差距自然變小）
 *  只有「沒指定方式、使用者沒說狀況」才看習慣；比最快的方案慢太多（超過 2 倍且多 20 分以上）的不加分（走路 100 分鐘不會因為習慣勝出） */
export const HABIT = { max: 0.08, full: 0.6 };
const HABIT_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '搭捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車', drive: '開車' };

/** 習慣只在使用者確認後才送來（public/js/habits.js 先問「以後要我優先推捷運嗎？」）：未確認的推測不加分（2026-11-21 互動確認） */
/** 每個方案的習慣加分（0～HABIT.max）；不適用時回 0 */
export function habitBonus(o, habit, fastest) {
  const share = Number(habit?.[o.role]);
  if (!(share > 0) || !Number.isFinite(share)) return 0;
  if (effMinutes(o) > Math.max(fastest * 2, fastest + 20)) return 0;
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
  // 總時間、等車用真正要等的（effMinutes：深夜等首班的方案照抵達時間比）
  const val = (o, k) => (k === 'minutes' ? effMinutes(o) : k === 'waitMin' ? effWait(o) : Number(o[k] ?? 0));
  const habitOn = !!ctx.habit && !ctx.mode && !ctx.said;
  const fastest = Math.min(...pool.map((p) => val(p, 'minutes')));
  const scored = pool.map((o) => {
    const breakdown = {};
    for (const c of CRITERIA) {
      let norm;
      if (c.scale === 'abs') norm = 1 - Math.min(1, Math.max(0, val(o, c.key)));
      else { const lo = Math.min(...pool.map((p) => val(p, c.key))); norm = (lo + c.k) / (val(o, c.key) + c.k); }
      breakdown[c.key] = norm * weights[c.key];
      // 估算值保守看（UNCERTAIN）：同一個最低值，但自己的值放大後再算一次，差額記在 uncertain
      const e = o.est?.[c.key];
      const own = Number(o[c.key] ?? 0); // 估的只有方案自己的值（不含 longWait 多等的時間：那是班表算的）
      const part = e === true ? own : Number(e) > 0 ? Math.min(Number(e), own) : 0; // 估的那一部分
      if (c.scale === 'ratio' && UNCERTAIN[c.key] && part > 0) {
        const lo = Math.min(...pool.map((q) => val(q, c.key)));
        const less = ((lo + c.k) / (val(o, c.key) + part * UNCERTAIN[c.key] + c.k)) * weights[c.key] - breakdown[c.key];
        if (less < 0) breakdown.uncertain = (breakdown.uncertain ?? 0) + less;
      }
    }
    return { o, breakdown, base: Object.values(breakdown).reduce((a, b) => a + b, 0) };
  });
  const pt = (x) => Math.round(x.base * 100);
  const top = (list) => list.reduce((a, x) => (!a || x.base > a.base ? x : a), null);
  /** 把 x 排到 ref 後面 1 分（顯示的分數剛好少 1 分），扣的分記在 breakdown[key]（負數，決策圖畫得出來） */
  const lower = (x, ref, key) => {
    const t = (pt(ref) - 1) / 100;
    if (t >= x.base) return;
    x.breakdown[key] = (x.breakdown[key] ?? 0) + t - x.base;
    x.base = t;
  };
  // 到站時間不明的公車（ADR-0010 2026-11-22：站牌沒有任何預估或尚未發車，etaUnknown）：不知道車會不會來，
  // 不排在時間確定的大眾運輸前面（breakdown.unsure、unsure.vs），理由句「公車 939 到站時間不明」；沒有別的大眾運輸時照分數（仍列入）。不看狀態：這是資料可不可靠，不是偏好
  const known = scored.filter((x) => TRANSIT_ROLES.has(x.o.role) && !x.o.etaUnknown);
  for (const x of scored) {
    if (!x.o.etaUnknown || !known.length) continue;
    const ref = top(known);
    if (pt(x) < pt(ref)) continue;
    lower(x, ref, 'unsure');
    x.unsure = { vs: ref.o.id };
  }
  // 預設大眾運輸（ADR-0010 2026-11-22）：沒有理由狀態（STATES.*.reason）、而且有大眾運輸方案時才做
  if (!states.some((k) => STATES[k].reason)) {
    const transit = scored.filter((x) => TRANSIT_ROLES.has(x.o.role));
    if (transit.length) {
      const cost = (x) => val(x.o, 'cost');
      /** 從 a 換成 b 省下的體感時間值多少錢（VALUE_OF_TIME） */
      const worth = (a, b) => (feltMinutes(a.o) - feltMinutes(b.o)) * VALUE_OF_TIME.perMin;
      // 1. 花錢換時間要划算：叫車比便宜的大眾運輸多付的錢要 ≤ 省下的體感時間 × 時間價值；
      //    不划算就排到「不划算的那些大眾運輸」裡分數最高的後面 1 分（breakdown.premium），理由句「省 X 元、只慢 Y 分」
      for (const s of scored) {
        if (!PREMIUM_ROLES.has(s.o.role)) continue;
        const ref = top(transit.filter((x) => cost(x) < cost(s) && cost(s) - cost(x) > worth(x, s)));
        if (!ref || pt(s) < pt(ref)) continue; // 同分時叫車會以時間短排前面，也要檢查
        lower(s, ref, 'premium');
        s.notWorth = { vs: ref.o.id, extra: cost(s) - cost(ref), worth: Math.max(0, Math.round(worth(ref, s))) };
        // 叫車讓位後不能變成推更貴的方案（叫車 300 元讓位、高鐵 400 元上來）：比叫車貴、對 ref 也不划算的，一樣排到叫車後面
        for (const x of scored) {
          if (x === s || PREMIUM_ROLES.has(x.o.role) || cost(x) <= cost(s) || pt(x) < pt(s) || cost(x) - cost(ref) <= worth(ref, x)) continue;
          lower(x, s, 'premium');
          x.notWorth = { vs: ref.o.id, extra: cost(x) - cost(ref), worth: Math.max(0, Math.round(worth(ref, x))) };
        }
      }
      // 2. 走太久、騎太久（LONG_MIN：步行 25 分、YouBike 30 分）不排在最好的大眾運輸前面（breakdown.tooLong），理由句「YouBike 要 43 分（超過 30 分）」
      for (const x of scored) {
        const cap = LONG_MIN[x.o.role];
        if (!cap || val(x.o, 'minutes') <= cap) continue;
        const best = top(transit);
        if (pt(x) < pt(best)) continue;
        lower(x, best, 'tooLong');
        x.tooLong = { vs: best.o.id, cap };
      }
    }
  }
  const ranked = scored.map(({ o, breakdown, notWorth, tooLong, unsure }) => {
    const bonus = habitOn ? habitBonus(o, ctx.habit, fastest) : 0;
    if (bonus > 0) breakdown.habit = bonus;
    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { ...o, score: Math.round(score * 100), breakdown, ...(notWorth && { notWorth }), ...(tooLong && { tooLong }), ...(unsure && { unsure }) };
  }).sort((a, b) => b.score - a.score || notWorthLast(a, b) || effMinutes(a) - effMinutes(b));

  // 4. 使用者指定交通方式（「改坐公車」）：分數與排名照算，建議改成該方式裡分數最高的（沒有這種方式就照分數）
  const picked = ctx.mode ? ranked.find((o) => o.role === ctx.mode) : null;
  if (picked) {
    const top = ranked[0];
    const note = picked === top ? '' : `（分數 ${picked.score}；分數最高的是${top.name} ${top.score}）`;
    const careful = states.find((k) => STATES[k].exclude?.includes(ctx.mode));
    return { weights, ranked, excluded, best: picked, mode: ctx.mode, reason: `照你說的選「${picked.name}」${note}。${careful ? `${STATES[careful].label}要多注意安全。` : ''}` };
  }
  const best = ranked[0] || null;
  const reason = explain(best, ranked[1], states, excluded, ranked);
  if (habitOn) return { weights, ranked, excluded, best, reason, habitOn };
  // 指定的交通方式沒有可行方案：照分數建議，但要明說（使用者才不會以為已經改成功）
  if (ctx.mode) return { weights, ranked, excluded, best, modeUnavailable: ctx.mode, reason: `${MODE_NAME[ctx.mode] || '你指定的方式'}這次沒有可行的方案；${reason}` };
  return { weights, ranked, excluded, best, reason };
}

const MODE_NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' };
const MODE_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '坐捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車', drive: '開車' };

/** 產生一句理由：最佳方案贏在哪裡（取貢獻差最大的項目）＋生效的狀態 */
function explain(best, second, states, excluded, ranked = []) {
  if (!best) {
    const said = excluded.some((e) => !e.why.includes('超過')), late = excluded.some((e) => e.why.includes('超過'));
    // 行動不便時沒有可行方案（短程只有步行、YouBike，或叫車被說不要）：主動建議叫車／無障礙計程車
    const help = excluded.some((e) => e.why.startsWith('行動不便')) ? '可以叫車，或預約各縣市的無障礙計程車（復康巴士）。' : '';
    return (said && late ? '排除不適合或你說不要的方式後，其他方案都會遲到。' : late ? '所有方案都趕不上指定時間。' : said ? '排除不適合或你說不要的方式後，沒有其他可行的方案。' : '沒有可比較的方案。') + help;
  }
  const why = [];
  if (states.length) why.push(`因為${states.map((s) => STATES[s].say).join('、')}`);
  const often = habitFlipped(best, ranked) ? [`你想優先${HABIT_DO[best.role] || `選${best.name}`}`] : []; // 只有拿掉偏好加分會換第一名時才說（否則不是因為偏好）
  if (second?.notWorth?.vs === best.id) {
    // 叫車多付的錢換不到夠多的時間（VALUE_OF_TIME）：照實說省多少錢、慢多少（或沒比較慢）
    const slower = effMinutes(best) - effMinutes(second);
    why.push([...often, `省 ${second.notWorth.extra} 元`, slower > 0 ? `只慢 ${slower} 分` : '也不會比較慢'].join('、'));
  } else if (second?.unsure?.vs === best.id) {
    // 到站時間不明的公車讓位（unsure）：照實說
    why.push([...often, `${second.name} 到站時間不明`].join('、'));
  } else if (second?.tooLong?.vs === best.id) {
    // 走太久、騎太久（LONG_MIN）：照實說要多久、上限多少
    why.push([...often, `${second.name}要 ${second.minutes} 分（超過 ${second.tooLong.cap} 分）`].join('、'));
  } else if (second) {
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

/** 拿掉偏好加分後第一名會不會換（決策圖英文理由也用這個） */
export function habitFlipped(best, ranked = []) {
  if (!(best?.breakdown?.habit > 0)) return false;
  const base = (o) => Object.entries(o.breakdown || {}).reduce((a, [k, v]) => a + (k === 'habit' ? 0 : v), 0);
  return ranked.some((o) => o.id !== best.id && base(o) > base(best));
}

const PHRASE = {
  minutes: (b, s) => `比${/快$/.test(s.name) ? `「${s.name}」` : s.name}快 ${Math.max(1, effMinutes(s) - effMinutes(b))} 分`, // 車種「區間快」：加引號，不寫成「區間快快」（健檢 x03）
  waitMin: (b) => (b.waitMin ? `只要等 ${b.waitMin} 分` : '不用等車'),
  walkMin: (b) => (b.walkMin ? `只走 ${b.walkMin} 分` : '不用走路'),
  cost: (b, s) => (b.cost < s.cost ? `省 ${s.cost - b.cost} 元` : '費用較低'),
  exposure: (_b, _s, states = []) => (states.includes('badAir') && !states.includes('rain') ? '少待在戶外' : '比較不會淋雨'),
  effort: () => '比較輕鬆',
  delayRisk: () => '不受塞車影響',
};

/** 關鍵問題會試的狀態（使用者自己最清楚、程式猜不到的） */
export const ASK_STATES = ['rush', 'budget', 'luggage', 'lessWalk'];
/** 值得問的差別：時間差 ≥ 5 分或費用差 ≥ 50 元 */
export const ASK_MIN = { minutes: 5, cost: 50 };
/** 建議走路、而且走路這麼近（分鐘）就不問關鍵因子 */
export const ASK_WALK_MAX = 15;
/** 帶行李、少走路的問題：每少走 1 分鐘，最多值得多花多少元 */
export const ASK_COMFORT_NT = 50;
const MODE_EN = { walk: 'Walking', bike: 'YouBike', bus: 'The bus', metro: 'The MRT', thsr: 'High speed rail', tra: 'The train', intercity: 'The coach', ridehail: 'A taxi', drive: 'Driving' };

/**
 * 關鍵問題（2026-11-21 互動確認，ADR-0010）：答案取決於使用者時，直接問一句，不默默推測。
 * 對這次的方案，試著各加上一個狀態（趕時間、想省錢、帶行李、少走路）重算：建議會換、而且差別值得問（時間差 ≥ 5 分或費用差 ≥ 50 元），
 * 就產生一個問題；一次最多一個（挑影響最大的）。使用者已經說了（或點了、說過）狀況、指定了方式，或怎麼加都不會換時不問。
 * 純函式：伺服器（plan_trip 輸出 ask）與決策圖（按了以後即時重算）共用。
 * @param {Array<object>} options 同 decide()
 * @param {object} [ctx] 同 decide()（含 said、mode、habit）
 * @param {string[]} [only] 只試這幾個狀態（手機上的 AI 提議問某個狀態時，程式驗證它值不值得問，ADR-0020）
 * @returns {{ state: string, from: string, to: string, dMin: number, dCost: number, text: string, textEn: string } | null}
 */
export function keyQuestion(options, ctx = {}, only = ASK_STATES) {
  if (ctx.mode || ctx.said) return null;
  const states = (ctx.states || []).filter((k) => STATES[k]);
  const base = decide(options, ctx).best;
  if (!base) return null;
  if (base.role === 'walk' && Number(base.minutes) <= ASK_WALK_MAX) return null; // 走路 15 分鐘內（約 1 公里）就到：不問趕不趕、帶不帶行李（差別小，問了只是打擾；PM Q-5）
  const fastest = Math.min(...options.map(effMinutes));
  let pick = null;
  for (const k of ASK_STATES) {
    if (states.includes(k) || !only.includes(k)) continue;
    const alt = decide(options, { ...ctx, states: [...states, k], said: true }).best;
    if (!alt || alt.id === base.id) continue;
    const dMin = effMinutes(base) - effMinutes(alt); // 正＝換過去比較快
    const dCost = Number(alt.cost ?? 0) - Number(base.cost ?? 0); // 正＝換過去比較貴
    const dWalk = Number(base.walkMin ?? 0) - Number(alt.walkMin ?? 0);
    if (Math.abs(dMin) < ASK_MIN.minutes && Math.abs(dCost) < ASK_MIN.cost) continue; // 差不多：不值得打擾
    if ((k === 'rush' && dMin <= 0) || (k === 'budget' && dCost >= 0) || (k === 'lessWalk' && dWalk <= 0)) continue; // 問句要說得通
    if ((k === 'rush' && dMin < ASK_MIN.minutes) || (k === 'budget' && -dCost < ASK_MIN.cost)) continue;
    if ((k === 'luggage' || k === 'lessWalk') && (dWalk < ASK_MIN.minutes || dCost > dWalk * ASK_COMFORT_NT)) continue; // 帶行李、少走路：要真的少走 5 分以上，而且多花的錢跟少走的路相稱（每少走 1 分最多多 50 元；「去羅東夜市」不問帶行李，審查 #121） // 趕時間要真的快 5 分以上、想省錢要真的省 50 元以上才問（「快 4 分但多 100 元，你趕時間嗎？」不值得打擾，PM Q-5）
    if (effMinutes(alt) > Math.max(fastest * 2, fastest + 20)) continue; // 不推明顯不合理的（想省錢就走 70 分鐘）
    const impact = Math.abs(dMin) + Math.abs(dCost) / 20;
    if (!pick || impact > pick.impact) pick = { k, base, alt, dMin, dCost, dWalk, impact };
  }
  if (!pick) return null;
  const { k, alt, dMin, dCost, dWalk } = pick;
  const more = dCost > 0 ? `多 ${dCost} 元` : '', moreEn = dCost > 0 ? `NT$${dCost} more` : '';
  const en = MODE_EN[alt.role] || alt.name;
  const text = {
    rush: `${alt.name}快 ${dMin} 分${more ? `但${more}` : ''}，你趕時間嗎？`,
    budget: `${alt.name}省 ${-dCost} 元${dMin < 0 ? `但慢 ${-dMin} 分` : ''}，想省錢嗎？`,
    luggage: `有帶行李或大包小包嗎？有的話${alt.name}比較輕鬆${more ? `（${more}）` : ''}。`,
    lessWalk: `想少走路嗎？${alt.name}少走 ${dWalk} 分${more ? `（${more}）` : ''}。`,
  }[k];
  const textEn = {
    rush: `${en} is ${dMin} min faster${moreEn ? ` but costs ${moreEn}` : ''}. In a hurry?`,
    budget: `${en} saves NT$${-dCost}${dMin < 0 ? ` but takes ${-dMin} min longer` : ''}. Want to save money?`,
    luggage: `Carrying luggage or bags? If so, ${en} is easier${moreEn ? ` (${moreEn})` : ''}.`,
    lessWalk: `Prefer less walking? ${en} walks ${dWalk} min less${moreEn ? ` (${moreEn})` : ''}.`,
  }[k];
  return { state: k, from: pick.base.id, to: alt.id, dMin, dCost, text, textEn };
}
