// 決策圖（M5-09，UX.md §5、ADR-0010）：資料（工具）→ 你的狀態 → 方案 → 建議。
// 數字全部來自 decision 事件（plan_trip 的真實資料與 decide.js 計分）；切換狀態 chip 時用同一份 decide.js 在瀏覽器重算，不呼叫伺服器。
// 不用 innerHTML（資料來自上游）；動畫只用 CSS，prefers-reduced-motion 時直接顯示最終狀態。

import { svgIcon, modeOf, MODE_COLOR } from '../cards/mode-icons.js';
import { motion } from '../cards/motion.js';
import { habitWhy, USUAL_LABEL } from '../../js/habits.js';

/** 被排除方案的標籤：遲到（超過抵達時間）、不要（使用者說不要這種方式）、其他排除 */
const exLabel = (why = '') => (why.includes('超過') ? '遲到' : why.startsWith('你說不要') ? '不要' : why.includes('不建議') ? '不適合' : /收班|末班已過/.test(why) ? '收班' : /沒車|沒有車|空位/.test(why) ? '沒列入' : '排除');
const ROLE_NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' };

const SVG = 'http://www.w3.org/2000/svg';
const STATE_LABEL = { rush: '趕時間', traffic: '塞車中', rain: '下雨', luggage: '帶行李', budget: '想省錢', lessWalk: '少走路', badAir: '空品不佳', elder: '帶長輩', kids: '帶小孩', mobility: '行動不便', group: '多人同行', rainSoon: '可能下雨' };
const SOURCE_LABEL = { auto: '自動', user: '你說的', picked: '你選的', usual: '你說過' };
/** 自動狀態連回產生它的工具（UX.md §5 CRIT_SRC） */
const STATE_SOURCE = { rain: '天氣', rainSoon: '天氣', traffic: '路況', badAir: '空品' };
const ADDABLE = ['rush', 'budget', 'lessWalk', 'luggage'];
/** 英文那一輪（S12c）的固定文字；方案名稱、理由句等資料維持原文 */
const EN = {
  state: { rush: 'In a hurry', traffic: 'Heavy traffic', rain: 'Raining', luggage: 'With luggage', budget: 'On a budget', lessWalk: 'Less walking', badAir: 'Poor air quality', elder: 'With seniors', kids: 'With kids', mobility: 'Limited mobility', group: 'Group travel', rainSoon: 'Rain likely' }, // 與 en.js trip.stateKey 相同
  source: { auto: 'Auto-detected', user: 'You said', picked: 'You chose', usual: 'You told me' },
  usual: { rush: 'Often in a hurry', luggage: 'Often carrying things', lessWalk: 'Prefer less walking' },
  mode: { walk: 'Walk', bike: 'YouBike', bus: 'Bus', metro: 'MRT', thsr: 'High Speed Rail', tra: 'Train', intercity: 'Intercity bus', ridehail: 'Taxi' },
  role: { 地點: 'Places', 定位: 'Location', 天氣: 'Weather', 空品: 'Air', 路況: 'Traffic', 票價: 'Fares', 行程: 'Trip', 公車: 'Bus', 捷運: 'MRT', YouBike: 'YouBike', 高鐵: 'THSR', 台鐵: 'Train', 叫車: 'Taxi', 客運: 'Coach', 訂票: 'Booking', 車站: 'Stations', 地震: 'Quakes', 藥局: 'Pharmacy', 垃圾車: 'Garbage', 油價: 'Fuel', 發票: 'Invoices', 股市: 'Stocks', 阿幫: 'Abang', 防詐: 'Anti-fraud', 網址: 'Links', 闢謠: 'Fact check', 號碼: 'Numbers' },
  crit: { minutes: 'Time', waitMin: 'Wait', walkMin: 'Walking', cost: 'Cost', exposure: 'Outdoors', effort: 'Effort', delayRisk: 'Delays' },
  tag: { 遲到: 'Late', 不要: 'Skip', 不適合: 'Unfit', 收班: 'No service', 沒列入: 'N/A', 排除: 'Out' },
  cols: ['Data', 'Abang', 'Options'],
  step1: '① Gathering data', step2: '② Your situation', step3: (c) => `③ Comparing: ${c}`, step4: (n) => `④ Decision: ${n}`, decide: '④ Decision',
  hint: 'Want another way? Tap an option and Abang recalculates', chips: 'Your situation (tap to toggle, recalculates right away)',
  habit: (m) => `You agreed: prefer ${m}`, habitWhy: 'Why?', habitPaused: 'You told Abang your situation, so this preference is not counted this time', habitNote: 'You said yes to preferring it. When you don\'t mention your situation it gets a small bonus (up to 8 pts). Stored only on this phone; undo it in Settings.', often: 'you prefer it', habitCrit: 'Preference',
  notIn: (n, w) => `${n} not included: ${w}`,
  details: 'Comparison details', effNone: 'No effect', effNA: 'Not used', effScore: 'Delay risk', pts: (n, s) => `${n}: ${s} pts`, title: 'How Abang decided', pick: (n) => `Switch to ${n}`, ex: (n, w) => `${n}, excluded: ${w}`,
};
/** 拿掉偏好加分後第一名會不會換（同 core/decide.js habitFlipped；這個檔不 import /core，打包單檔示範版才不會斷） */
const habitFlipped = (best, all = []) => {
  if (!(best?.breakdown?.habit > 0)) return false;
  const base = (o) => Object.entries(o.breakdown || {}).reduce((a, [k, v]) => a + (k === 'habit' ? 0 : v), 0);
  return all.some((o) => o.id !== best.id && base(o) > base(best));
};
/** 方案名稱縮短，分數一定看得到（「叫車（Uber）」→「叫車」） */
const short = (n) => { const x = String(n).replace(/（.*?）|\(.*?\)/g, ''); return x.length > 6 ? `${x.slice(0, 5)}…` : x; };
/** 精簡模式：低階裝置或 reduced motion（UX.md §9）——只淡入、不做翻轉與 3D */
export const lite = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
const W = 440, OPT_X = 300, OPT_W = 128, SRC_X = 38;

/**
 * 「資料」欄的節點（UX.md §5）：plan_trip 判斷用到的來源（decision.considered：天氣、空品、路況）在前，其他本輪回報的小幫手在後。
 * 每個節點帶值與影響：effect none＝不影響（淡色）、狀態 key＝連到那個狀態、查不到照實寫。
 * @returns {Array<{ role: string, value?: string, effect?: string, available?: boolean, text?: string, say?: string }>}
 */
export function dataNodes(decision, sources = [], en = false) {
  const con = (decision.considered || []).map((c) => ({ role: c.role, value: en ? c.valueEn : c.value, effect: c.effect, available: c.available, text: c.text, say: c.say }));
  return [...con, ...sources.filter((r) => r !== '行程' && !con.some((c) => c.role === r)).map((role) => ({ role }))];
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} root
 * @param {object} decision decision 事件
 * @param {{ sources: string[], decide: Function, CRITERIA: Array<{ key: string, label: string }>, onPick?: (o: object) => void }} opts sources＝本輪回報的小幫手角色；onPick：點沒被選的方案＝改選它
 */
export function renderDecision(root, decision, { sources, decide, CRITERIA, onPick, lang = null }) {
  const en = lang === 'en';
  const SL = en ? EN.state : STATE_LABEL; // 狀態名稱
  const SRC = en ? EN.source : SOURCE_LABEL;
  const exText = (why, tag) => (en ? EN.tag[tag || exLabel(why)] || 'Out' : tag || exLabel(why));
  const tagOf = (o) => o.tag || exLabel(o.why); // 沒列入的方式帶自己的標籤（收班／沒列入）
  const notIn = decision.missing || decision.skipped || []; // 沒列入的方式（missing 已含 skipped；舊事件只有 skipped）
  /** 英文：方案用交通方式稱呼（「捷運 淡水信義線」→ MRT）、來源與比較項目也是英文 */
  const nameOf = (o) => (en ? EN.mode[o.role] || o.name : o.name);
  const critOf = (c) => (en ? EN.crit[c.key] || c.label : c.label);
  const roleOf = (r) => (en ? EN.role[r] || r : r);
  /** 英文的一句理由（對照 decide.js explain：贏在差最多的兩項） */
  const enReason = (best, second, all = []) => {
    if (!best) return null;
    if (!second) return `${nameOf(best)} is the only option.`;
    const say = { minutes: () => `${Math.max(1, second.minutes - best.minutes)} min faster than ${nameOf(second)}`, waitMin: () => (best.waitMin ? 'shorter wait' : 'no waiting'), walkMin: () => (best.walkMin ? 'less walking' : 'no walking'), cost: () => (best.cost < second.cost ? `NT$${second.cost - best.cost} cheaper` : 'lower cost'), exposure: () => 'less time outdoors', effort: () => 'easier', delayRisk: () => 'avoids traffic delays' };
    const top = [...(habitFlipped(best, all) ? [EN.often] : []), ...CRITERIA.map((c) => ({ k: c.key, d: (best.breakdown?.[c.key] ?? 0) - (second.breakdown?.[c.key] ?? 0) })).sort((a, b) => b.d - a.d).filter((x) => x.d > 0.01).slice(0, 2).map((x) => say[x.k]?.())];
    return `${nameOf(best)} wins${top.length ? `: ${top.join(', ')}` : ''}.`;
  };
  const initial = decision.states.map((s) => ({ ...s, on: true }));
  const data = dataNodes(decision, sources, en); // 資料欄（每個來源一個節點）
  const dataRoles = data.map((d) => d.role);
  /** 節點第二行：影響 */
  const effOf = (d) => (d.available === false ? (en ? EN.effNA : '不列入') : d.effect === 'none' ? (en ? EN.effNone : '不影響') : d.effect === 'score' ? (en ? EN.effScore : '延誤風險') : d.effect ? `→ ${SL[d.effect] || d.effect}` : null);
  let states = initial;
  let run = 0;
  // 習慣（「你常選：捷運」）：手機記的常選比例；可以點掉（即時重算），旁邊「為什麼」看次數；第一次出現時說明一次
  // 習慣（「你同意：優先推捷運」）：只有使用者在「阿幫問你」說過「好」的才會送來（ADR-0016）；可以點掉（即時重算），旁邊「為什麼」看次數
  let habit = decision.habit || null;
  const topOf = (h) => (h ? Object.entries(h).sort((a, b) => b[1] - a[1])[0]?.[0] : null);
  let habitTop = topOf(habit);
  let habitOn = !!habitTop, habitApplied = !!decision.habitOn, whyOpen = false;

  const draw = () => {
    run++;
    const active = states.filter((s) => s.on).map((s) => s.key);
    // 與伺服器相同的引擎與輸入；初次（狀態未變）直接用伺服器結果，避免任何差異
    const changed = states.some((s) => !s.on) || states.length !== initial.length || (habitTop && !habitOn) || habit !== (decision.habit || null);
    // 習慣：與伺服器同一條規則——使用者說了（或點了）狀況就以狀況為準（said）
    const said = states.some((s) => s.on && s.source !== 'auto');
    const r = changed
      ? decide(decision.options, { states: active, arriveBy: decision.arriveBy ?? undefined, arriveByMin: decision.arriveByMin, mode: decision.mode, avoid: decision.avoid, ...(habitOn && habit && { habit, said }) })
      : { ranked: decision.ranked, excluded: decision.excluded, reason: decision.reason, best: { id: decision.best }, habitOn: decision.habitOn };
    habitApplied = !!r.habitOn;
    const byId = new Map(decision.options.map((o) => [o.id, o]));
    const ranked = r.ranked.map((x) => ({ ...byId.get(x.id), score: x.score, breakdown: x.breakdown }));
    // 沒列入比較的方式（深夜公車、捷運收班、YouBike 沒車位、附近沒有捷運站…）：也畫出來，灰色、標籤寫「收班」或「沒列入」，原因寫在圖下（設計審查）
    const skipped = notIn.map((x) => ({ id: `skip-${x.role}`, role: x.role, name: ROLE_NAME[x.role] || x.role, why: (en && x.whyEn) || x.why, tag: x.closed || /收班|末班已過/.test(x.why) ? '收班' : '沒列入', skipped: true }));
    const excluded = [...r.excluded.map((x) => ({ ...byId.get(x.id), why: x.why })), ...skipped];
    const off = states.filter((s) => !s.on && s.source === 'auto').map((s) => SL[s.key]);
    const reason = (off.length ? `不考慮「${off.join('、')}」的話，` : '') + (habitTop && !habitOn ? '不看你的偏好的話，' : '') + r.reason;

    // FLIP（M5-11）：記下重算前各方案節點的位置，重畫後從舊位置滑到新位置（重算才做；精簡模式不做）
    const before = new Map([...root.querySelectorAll('.dg-opt[data-id]')].map((g) => [g.dataset.id, g.getBoundingClientRect().top]));
    stopLoops();
    const bestOpt = ranked.find((o) => o.id === r.best?.id);
    last = { ranked, excluded, bestName: bestOpt && nameOf(bestOpt) };
    root.replaceChildren(...[
      chipsBar(),
      ...habitNotes(),
      el('p', 'dg-step', bestOpt ? (en ? EN.step4(nameOf(bestOpt)) : `④ 決定：${bestOpt.name}`) : (en ? EN.decide : '④ 決定')),
      graph(ranked, excluded, active, r.best?.id),
      el('p', 'dg-why', en ? enReason(bestOpt, ranked.find((o) => o.id !== bestOpt?.id), ranked) : reason), // 英文：程式依分數組一句英文理由
      decision.single && el('p', 'dg-single', en ? decision.single.textEn : decision.single.text), // 只有一種方式：其他方式為什麼不在
      !decision.single && notIn.length > 0 && el('ul', 'dg-missing', notIn.map((x) => el('li', null, en ? EN.notIn(EN.mode[x.role] || x.role, x.whyEn || x.why) : `${ROLE_NAME[x.role] || x.role}沒列入：${x.why}`))), // 手機沒有 hover：原因寫出來
      onPick && ranked.length > 1 && el('p', 'dg-hint', en ? EN.hint : '想換方式？點其他方案，阿幫會用它重算'), // 審查：手機沒有 hover，要寫出來
      details(ranked),
    ].filter(Boolean));
    root.dataset.run = String(run);
    root.dataset.best = r.best?.id ?? '';
    if (before.size && !lite()) flip(before);
    if (run > 1) settle();
  };

  let last = null;
  let loops = [];
  const stopLoops = () => { loops.forEach((t) => t.kill?.()); loops = []; };

  /** 決定後的狀態：吉祥物換開心、勝出路徑虛線流動＋光點持續沿勝出連線流向方案 */
  function settle() {
    root.querySelector('.dg-mascot')?.setAttribute('href', '/brand/abang-happy.svg');
    root.querySelectorAll('.dg-edge.win').forEach((e) => e.classList.add('flow'));
    const g = motion();
    const winEdge = root.querySelector('.dg-out-edge.win');
    const svgEl = root.querySelector('.dg-svg');
    if (!g || !globalThis.MotionPathPlugin || !winEdge || !svgEl) return;
    for (let i = 0; i < 3; i++) {
      const dot = svg('circle', { r: 3, class: 'dg-flow-dot' });
      svgEl.append(dot);
      loops.push(g.to(dot, { duration: 1.6, delay: i * 0.53, repeat: -1, ease: 'none', motionPath: { path: winEdge, align: winEdge, alignOrigin: [0.5, 0.5] } }));
    }
  }

  /**
   * 「阿幫在想」的編排（原型 transit-discussion.html 的會議感，GSAP 時間軸約 4 秒）：
   * ① 收集資料：來源依序亮起，帶著真實重點的資料膠囊（decision.signals）沿線飛進阿幫，阿幫每收到一個就彈一下
   * ② 看你的狀況：狀態膠囊彈出，自動狀態以點線連回來源
   * ③ 比較：逐項（總時間、等車、走路…）累加真實分數，方案連線依累計分數變粗、分數跟著更新
   * ④ 決定：落選變淡、勝出彈一下、阿幫換開心、光點沿勝出路徑持續流動
   * 資料已經都在畫面上（行程卡、回答不等動畫）；沒有 GSAP、reduced motion 或低階裝置時直接顯示最終狀態。
   */
  function intro() {
    const g = motion();
    const stepEl = root.querySelector('.dg-step');
    if (!g || !last) { if (!root.classList.contains('static')) settle(); else root.querySelector('.dg-mascot')?.setAttribute('href', '/brand/abang-happy.svg'); return Promise.resolve(); }
    root.classList.add('gsap');
    const q = (sel) => [...root.querySelectorAll(sel)];
    const svgEl = root.querySelector('.dg-svg');
    const hub = root.querySelector('.dg-hub');
    const step = (t) => () => { if (stepEl) stepEl.textContent = t; };
    const drawable = q('.dg-in-edge, .dg-link');
    for (const e of drawable) { e.setAttribute('pathLength', '1'); e.style.strokeDasharray = '1'; e.style.strokeDashoffset = '1'; }
    const outEdges = q('.dg-out-edge');
    const scoreOf = new Map(q('.dg-opt').map((n) => [n.dataset.id, n.querySelector('.dg-score')]));
    g.set(q('.dg-src, .dg-state, .dg-opt'), { opacity: 0 });
    g.set(outEdges, { strokeWidth: 0 });
    for (const t of scoreOf.values()) t.textContent = '';
    const tl = g.timeline({ defaults: { ease: 'power2.out' } });
    // ① 收集資料
    tl.call(step(en ? EN.step1 : '① 收集資料'));
    dataRoles.forEach((role, i) => {
      const node = root.querySelector(`.dg-src[data-role="${role}"]`), edge = root.querySelector(`.dg-in-edge[data-role="${role}"]`);
      if (!node || !edge) return;
      const at = 0.1 + i * 0.42;
      tl.to(node, { opacity: 1, duration: 0.2 }, at)
        .fromTo(node, { scale: 1 }, { scale: 1.25, yoyo: true, repeat: 1, duration: 0.14, transformOrigin: '50% 50%' }, at)
        .to(edge, { strokeDashoffset: 0, duration: 0.35 }, at);
      const label = data[i]?.value || (en && decision.signalsEn?.[role]) || decision.signals?.[role]; // 資料欄的值；英文那一輪用英文膠囊（S12f）
      if (label && globalThis.MotionPathPlugin) {
        const col = MODE_COLOR[modeOf(role)] || '#0f766e';
        const w = Math.max(30, [...label].length * 10 + 14);
        const p = svg('g', { class: 'dg-pkt', opacity: 0 });
        p.append(svg('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 10, style: `fill:${col}` }), svg('text', { y: 4, 'text-anchor': 'middle' }, label));
        svgEl.append(p);
        tl.set(p, { opacity: 1 }, at + 0.12)
          .to(p, { duration: 0.6, ease: 'power2.inOut', motionPath: { path: edge, align: edge, alignOrigin: [0.5, 0.5] } }, at + 0.12)
          .to(p, { opacity: 0, scale: 0.5, transformOrigin: '50% 50%', duration: 0.12, onComplete: () => p.remove() }, at + 0.72)
          .fromTo(hub, { scale: 1 }, { scale: 1.12, yoyo: true, repeat: 1, duration: 0.12, transformOrigin: '50% 50%' }, at + 0.7);
      }
    });
    // ② 看你的狀況
    tl.call(step(en ? EN.step2 : '② 看你的狀況'))
      .fromTo(q('.dg-state'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, transformOrigin: '50% 50%', ease: 'back.out(2)', duration: 0.3, stagger: 0.08 })
      .to(q('.dg-link'), { strokeDashoffset: 0, duration: 0.3 }, '<');
    // ③ 比較：方案出現，逐項累加真實分數（breakdown），連線依累計分數變粗
    const { ranked, excluded } = last;
    const max = Math.max(...ranked.map((o) => o.score), 1);
    tl.to(q('.dg-opt'), { opacity: 1, duration: 0.25, stagger: 0.05 })
      .from(q('.dg-opt'), { x: '+=14', duration: 0.25, stagger: 0.05 }, '<');
    let acc = new Map(ranked.map((o) => [o.id, 0]));
    for (const c of CRITERIA) {
      tl.call(step(en ? EN.step3(critOf(c)) : `③ 比較：${c.label}`));
      const next = new Map(ranked.map((o) => [o.id, acc.get(o.id) + (o.breakdown?.[c.key] ?? 0)]));
      for (const o of ranked) {
        const e = root.querySelector(`.dg-out-edge[data-id="${o.id}"]`);
        const pts = Math.round(next.get(o.id) * 100);
        if (e) tl.to(e, { strokeWidth: (1 + 7 * (pts / max)).toFixed(1), duration: 0.18 }, '<');
        tl.call(() => { const t = scoreOf.get(o.id); if (t) t.textContent = String(pts); }, null, '<');
      }
      acc = next;
      tl.to({}, { duration: 0.12 });
    }
    // ④ 決定
    tl.call(step(en ? EN.step4(last.bestName || '') : `④ 決定：${last.bestName || ''}`))
      .call(() => { for (const o of ranked) { const t = scoreOf.get(o.id); if (t) t.textContent = String(o.score); } for (const o of excluded) { const t = scoreOf.get(o.id); if (t) t.textContent = exText(o.why, o.tag); } })
      .to(root.querySelectorAll('.dg-out-edge.step4'), { strokeWidth: 1, duration: 0.2 })
      .to(q('.dg-opt:not(.win):not(.avoided), .dg-out-edge:not(.win):not(.avoided-edge)'), { opacity: 0.45, duration: 0.3 }, '<')
      .fromTo(q('.dg-opt.win'), { scale: 1 }, { scale: 1.08, yoyo: true, repeat: 1, duration: 0.2, transformOrigin: '50% 50%', ease: 'power1.inOut' }, '<')
      .fromTo(hub, { scale: 1 }, { scale: 1.15, yoyo: true, repeat: 1, duration: 0.18, transformOrigin: '50% 50%' }, '<')
      .from(q('.dg-why'), { opacity: 0, y: 6, duration: 0.3 }, '<')
      .add(() => {
        for (const e of drawable) { e.style.strokeDasharray = ''; e.style.strokeDashoffset = ''; e.removeAttribute('pathLength'); }
        q('.dg-opt:not(.win), .dg-out-edge:not(.win)').forEach((n) => { n.style.opacity = ''; });
        root.querySelectorAll('.dg-pkt').forEach((p) => p.remove());
        settle();
      });
    // 保險：畫面在背景（requestAnimationFrame 暫停）或裝置太慢時，7 秒後直接跳到最終狀態
    const guard = setTimeout(() => tl.progress(1), 7000);
    return tl.then(() => clearTimeout(guard));
  }

  /** 排名翻轉：位置改變的方案從舊位置滑入並輕微翻轉（最多 3 個同時，UX.md §9） */
  function flip(before) {
    root.classList.add('reranked');
    let n = 0;
    for (const g of root.querySelectorAll('.dg-opt[data-id]')) {
      const old = before.get(g.dataset.id);
      if (old == null) continue;
      const dy = old - g.getBoundingClientRect().top;
      if (Math.abs(dy) < 1 || n >= 3 || typeof g.animate !== 'function') continue;
      n++;
      g.animate([{ transform: `translateY(${dy}px)`, opacity: 0.6 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' });
    }
  }

  function chipsBar() {
    const bar = el('div', 'dg-chips');
    bar.setAttribute('aria-label', en ? EN.chips : '你的狀態（點一下切換，立即重算）');
    for (const s of states) {
      const label = s.source === 'usual' ? (en ? EN.usual[s.key] : USUAL_LABEL[s.key]) || SL[s.key] : SL[s.key]; // 你說過：常帶東西
      const b = el('button', `dg-chip ${s.on ? 'on' : 'off'} src-${s.source}`, `${SRC[s.source]}：${label}`, s.on ? ' ✕' : '');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(s.on));
      if (s.detail) b.title = s.detail;
      if (s.key === 'group') { // 叫車已換成每人分攤，關掉也還原不了：固定顯示，要改人數就跟阿幫說
        b.disabled = true;
        b.title = `${s.detail || ''}（要改人數，跟阿幫說「我們 N 個人」）`;
        b.textContent = `${SRC[s.source]}：${SL[s.key]}${s.detail ? `・${s.detail}` : ''}`;
      } else b.onclick = () => { states = states.map((x) => (x.key === s.key ? { ...x, on: !x.on } : x)); draw(); };
      bar.append(b);
    }
    if (habitTop) { // 你同意（source habit）：跟狀態 chip 同一套樣式，顏色不同；點掉＝不看偏好重算
      const name = en ? EN.mode[habitTop] : ROLE_NAME[habitTop];
      const b = el('button', `dg-chip ${habitOn ? 'on' : 'off'} src-habit${habitOn && !habitApplied ? ' paused' : ''}`, en ? EN.habit(name) : `你同意：優先推${name}`, habitOn ? ' ✕' : '');
      b.type = 'button';
      b.dataset.habit = habitTop;
      b.setAttribute('aria-pressed', String(habitOn));
      if (habitOn && !habitApplied) b.title = en ? EN.habitPaused : '你說了狀況（或指定了方式），這次以你說的為準，習慣不加分';
      b.onclick = () => { habitOn = !habitOn; draw(); };
      const why = el('button', 'dg-chip dg-why-btn', en ? EN.habitWhy : '為什麼');
      why.type = 'button';
      why.setAttribute('aria-expanded', String(whyOpen));
      why.onclick = () => { whyOpen = !whyOpen; draw(); };
      bar.append(b, why);
    }
    for (const k of ADDABLE.filter((k) => !states.some((s) => s.key === k))) {
      const b = el('button', 'dg-chip add', `＋${SL[k]}`);
      b.dataset.state = k; // 「接下來可以」用狀態鍵找這顆（不看文字）
      b.type = 'button';
      b.onclick = () => { states = [...states, { key: k, source: 'picked', on: true }]; draw(); };
      bar.append(b);
    }
    return bar;
  }

  /** 偏好的「為什麼」（只用手機上的次數，habits.js） */
  function habitNotes() {
    if (!habitTop) return [];
    const out = [];
    if (whyOpen) out.push(el('p', 'dg-habit-note', en ? EN.habitNote : `${habitWhy(habitTop)}，你說過「好」。沒說狀況時小幅加分（最多 8 分）；只存在這支手機，可以在「設定」撤銷。`));
    return out;
  }

  // 版面（原型 transit-discussion.html 的會議感）：左＝資料來源圓點、中＝阿幫（吉祥物）、右＝方案；狀態膠囊在阿幫上方
  function graph(ranked, excluded, active, bestId) {
    const opts = [...ranked, ...excluded];
    const H = Math.max(240, opts.length * 50 + 56, data.length * 66 + 56); // 資料節點多兩行字（值、影響），間距大一點
    const C = { x: 196, y: H / 2 + 10 };
    const ys = (n, i) => (n <= 1 ? C.y : 40 + (i * (H - 90)) / (n - 1)); // 底下留給來源名稱
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dg-svg', role: 'img', 'aria-labelledby': 'dg-title dg-desc' });
    s.append(svg('title', { id: 'dg-title' }, en ? EN.title : '決策圖'),
      svg('desc', { id: 'dg-desc' }, en ? `Data: ${data.map((d) => `${roleOf(d.role)}${d.value ? ` ${d.value}` : ''}`).join(', ')}. Situation: ${active.map((k) => SL[k]).join(', ') || 'none'}. Options by score: ${ranked.map((o) => `${nameOf(o)} ${o.score}`).join(', ')}.` : `資料：${data.map((d) => `${d.role}${d.value ? ` ${d.value}（${effOf(d)}）` : ''}`).join('、')}；狀態：${active.map((k) => SL[k]).join('、') || '無'}；方案依分數：${ranked.map((o) => `${o.name} ${o.score}`).join('、')}${excluded.length ? `；排除：${excluded.map((o) => `${o.name}（${tagOf(o) === '不要' ? '你說不要' : tagOf(o) === '遲到' ? '會遲到' : o.skipped ? `${tagOf(o)}：${o.why}` : '排除'}）`).join('、')}` : ''}`));
    (en ? EN.cols : ['資料', '阿幫', '方案']).forEach((t, i) => s.append(svg('text', { x: [SRC_X, C.x, OPT_X + 4][i], y: 16, class: 'dg-col', 'text-anchor': i === 2 ? 'start' : 'middle' }, t)));
    const edges = svg('g', { class: 'dg-edges' }), nodes = svg('g', { class: 'dg-nodes' });
    s.append(edges, nodes);
    const best = ranked.find((o) => o.id === bestId);
    const winRoles = new Set(best ? keyRoles(best, ranked[1], active) : []);
    // 1 資料來源 → 阿幫
    const srcY = new Map();
    data.forEach((d, i) => {
      const { role } = d;
      const y = ys(data.length, i), x = SRC_X;
      srcY.set(role, y);
      const quiet = d.available === false || d.effect === 'none'; // 不影響、查不到：淡色
      const lit = winRoles.has(role) && !quiet; // 說「不影響」的來源不標成勝出關鍵
      edges.append(svg('path', { d: `M${x + 16},${y} C${x + 70},${y} ${C.x - 80},${C.y} ${C.x - 30},${C.y}`, class: `dg-edge dg-in-edge step1${lit ? ' win' : ''}${quiet ? ' quiet' : ''}`, 'data-role': role }));
      const g = svg('g', { class: `dg-node dg-src step1${lit ? ' win' : ''}${quiet ? ' quiet' : ''}${d.available === false ? ' na' : ''}${d.effect && !quiet ? ' affects' : ''}`, 'data-role': role, ...(d.effect && { 'data-effect': d.available === false ? 'na' : d.effect }), transform: `translate(${x},${y})` });
      if (d.text) g.append(svg('title', {}, `${d.text}：${d.say}`)); // 完整的資料與影響（滑過或讀屏）
      const col = MODE_COLOR[modeOf(role)] || '#0f766e';
      g.append(svg('circle', { r: 16, class: 'dg-src-c', style: `stroke:${col}` }));
      const ic = svgIcon(role, -9, -9, 18);
      if (ic) { ic.style.color = col; g.append(ic); }
      const lbl = svg('text', { y: 29, 'text-anchor': 'middle', class: 'dg-lbl' }, roleOf(role));
      if (d.value) lbl.append(svg('tspan', { dx: 3, class: 'dg-val' }, d.value));
      g.append(lbl);
      const eff = effOf(d);
      if (eff) g.append(svg('text', { y: 41, 'text-anchor': 'middle', class: 'dg-eff' }, eff));
      nodes.append(g);
    });
    // 2 阿幫（中心）：吉祥物；狀態膠囊疊在上方，自動狀態以點線連回來源
    const hub = svg('g', { class: 'dg-node dg-hub step2', transform: `translate(${C.x},${C.y})` });
    hub.append(svg('circle', { r: 30, class: 'dg-hub-c' }));
    const img = svg('image', { href: '/brand/abang-think.svg', x: -27, y: -29, width: 54, height: 54, class: 'dg-mascot' });
    hub.append(img);
    nodes.append(hub);
    active.forEach((k, i) => {
      const st = states.find((x) => x.key === k);
      const label = SL[k], tag = SRC[st?.source] || '';
      const y = C.y - 52 - i * 24, w = label.length * 12 + tag.length * 10 + 24;
      const from = srcY.get(STATE_SOURCE[k]);
      if (st?.source === 'auto' && from != null) edges.append(svg('path', { d: `M${SRC_X + 16},${from} Q${C.x - 70},${y} ${C.x - w / 2},${y}`, class: 'dg-edge dashed dg-link step2' }));
      const g = svg('g', { class: `dg-node dg-state step2 src-${st?.source}`, transform: `translate(${C.x},${y})` });
      g.append(svg('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 10 }));
      const t = svg('text', { y: 4, 'text-anchor': 'middle' }, label);
      t.append(svg('tspan', { dx: 4, class: 'dg-tag' }, tag));
      g.append(t);
      nodes.append(g);
    });
    // 3 方案：連線粗細＝分數；排除的灰階刪除線
    const max = Math.max(...ranked.map((o) => o.score), 1);
    opts.forEach((o, i) => {
      const y = ys(opts.length, i);
      const isEx = i >= ranked.length;
      const win = o.id === bestId;
      edges.append(svg('path', { d: `M${C.x + 30},${C.y} C${C.x + 62},${C.y} ${OPT_X - 40},${y} ${OPT_X},${y}`,
        class: `dg-edge dg-out-edge ${isEx ? 'step4 excluded' : 'step3'}${isEx && ['不要', '收班', '沒列入'].includes(tagOf(o)) ? ' avoided-edge' : ''}${win ? ' win' : ''}`, 'data-id': o.id, style: `stroke-width:${isEx ? 1 : (1 + 7 * (o.score / max)).toFixed(1)}px` })); // 連線粗細＝分數（inline，CSS 的 stroke-width 才蓋不掉）
      const avoided = isEx && ['不要', '收班', '沒列入'].includes(tagOf(o)), unfit = isEx && tagOf(o) === '不適合';
      const n = node(OPT_X, y, short(nameOf(o)), `dg-opt ${isEx ? 'step4 excluded' : 'step3'}${avoided ? ' avoided' : ''}${unfit ? ' unfit' : ''}${win ? ' win dg-best' : ''}`, o.role, win, isEx ? exText(o.why, o.tag) : String(o.score));
      n.style.setProperty('--i', String(i));
      n.dataset.id = o.id;
      if (isEx) n.setAttribute('aria-label', en ? EN.ex(o.name, exText(o.why, o.tag)) : `${o.name}，${o.skipped ? '沒列入' : '已排除'}：${o.why}`); // 讀屏念原因（「你說不要叫車」「…會遲到」）
      if (onPick && !isEx && !win) { // 點方案＝「改成這個」（沿用起訖點重算；公車會自動盯到站）
        n.classList.add('pickable');
        n.setAttribute('role', 'button');
        n.setAttribute('tabindex', '0');
        n.setAttribute('aria-label', en ? EN.pick(o.name) : `改成${o.name}`);
        n.addEventListener('click', () => onPick(o));
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(o); } });
      }
      nodes.append(n);
    });
    return s;
  }

  /** 方案節點：左邊圖示（勝出白色、其他代表色）、名稱、右邊分數 */
  function node(x, y, label, cls, icon, onBrand = false, score = '') {
    const g = svg('g', { class: `dg-node ${cls}`, transform: `translate(${x},${y - 15})` });
    const ic = icon && svgIcon(icon, 8, 7, 16);
    if (ic) ic.style.color = onBrand ? '#fff' : (MODE_COLOR[modeOf(icon)] || 'currentColor');
    g.append(svg('rect', { width: OPT_W, height: 30, rx: 15 }), ...(ic ? [ic] : []),
      ...(cls.includes('step3') ? [svg('rect', { class: 'dg-hit', x: -6, y: -8, width: OPT_W + 12, height: 46, fill: 'transparent' })] : []), // 點擊範圍 ≥ 44px
      svg('text', { x: ic ? 30 : 12, y: 19, class: 'dg-name' }, label.length > 7 ? `${label.slice(0, 6)}…` : label),
      svg('text', { x: OPT_W - 12, y: 19, 'text-anchor': 'end', class: 'dg-score' }, score));
    return g;
  }

  /** 讓勝出方案贏的關鍵項目 → 對應的資料來源（戶外←天氣或空品、塞車風險←路況、費用←票價／行程） */
  function keyRoles(best, second, active = []) {
    if (!second) return ['行程'];
    const outdoor = active.includes('badAir') && !active.includes('rain') ? '空品' : '天氣';
    const crit = { exposure: outdoor, delayRisk: '路況', cost: '票價', minutes: '行程', waitMin: '行程', walkMin: '地點', effort: '行程' };
    return CRITERIA.map((c) => ({ k: c.key, d: (best.breakdown?.[c.key] ?? 0) - (second.breakdown?.[c.key] ?? 0) }))
      .sort((a, b) => b.d - a.d).slice(0, 2).filter((x) => x.d > 0.01).map((x) => crit[x.k]);
  }

  /** 明細：每個方案各比較項目得分（× 權重）長條，標示最影響結果的兩項 */
  function details(ranked) {
    const d = el('details', 'dg-details');
    d.append(el('summary', null, en ? EN.details : '看比較細節'));
    for (const o of ranked) {
      const top = new Set(Object.entries(o.breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k));
      d.append(el('div', 'dg-row', el('b', null, en ? EN.pts(nameOf(o), o.score) : `${o.name}：${o.score} 分`),
        ...CRITERIA.map((c) => {
          const v = (o.breakdown?.[c.key] ?? 0) * 100;
          const bar = el('span', `dg-bar${top.has(c.key) ? ' top' : ''}`);
          bar.style.width = `${Math.max(2, v * 2)}%`;
          return el('div', 'dg-crit', el('span', 'dg-crit-name', critOf(c)), bar, el('span', 'dg-crit-v', v.toFixed(1)));
        }),
        o.breakdown?.habit > 0 && el('div', 'dg-crit habit', el('span', 'dg-crit-name', en ? EN.habitCrit : '偏好'), Object.assign(el('span', 'dg-bar'), { style: `width:${Math.max(2, o.breakdown.habit * 200)}%` }), el('span', 'dg-crit-v', `+${(o.breakdown.habit * 100).toFixed(1)}`))));
    }
    return d;
  }

  draw();
  const played = intro();
  return {
    states: () => states, redraw: draw, played,
    /** 阿幫問你（ADR-0016）的答案套到這一輪：加一個狀態（kind state＝你選的；說過的預設狀況＝你說過）後即時重算 */
    addState(key, source = 'picked') {
      states = states.some((s) => s.key === key) ? states.map((s) => (s.key === key ? { ...s, on: true } : s)) : [...states, { key, source, on: true }];
      draw();
    },
    /** 使用者剛同意優先推的方式（{ metro: 0.8 }）：加上「你同意」chip 後重算 */
    setHabit(h) { if (!h) return; habit = h; habitTop = topOf(h); habitOn = true; draw(); },
  };
}

/** 小幫手角色的英文（討論串 @點名、頭像讀屏、決策圖共用；沒有就照原文） */
export const roleEn = (r) => EN.role[r] || r;
