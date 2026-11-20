// 決策圖（M5-09，UX.md §5、ADR-0010）：資料（工具）→ 你的狀態 → 方案 → 建議。
// 數字全部來自 decision 事件（plan_trip 的真實資料與 decide.js 計分）；切換狀態 chip 時用同一份 decide.js 在瀏覽器重算，不呼叫伺服器。
// 不用 innerHTML（資料來自上游）；動畫只用 CSS，prefers-reduced-motion 時直接顯示最終狀態。

import { svgIcon, modeOf, MODE_COLOR } from '../cards/mode-icons.js';
import { motion } from '../cards/motion.js';

const SVG = 'http://www.w3.org/2000/svg';
const STATE_LABEL = { rush: '趕時間', traffic: '塞車中', rain: '下雨', luggage: '帶行李', budget: '想省錢', lessWalk: '少走路', badAir: '空品不佳' };
const SOURCE_LABEL = { auto: '自動', user: '你說的', picked: '你選的' };
/** 自動狀態連回產生它的工具（UX.md §5 CRIT_SRC） */
const STATE_SOURCE = { rain: '天氣', traffic: '路況', badAir: '空品' };
const ADDABLE = ['rush', 'budget', 'lessWalk', 'luggage'];
/** 方案名稱縮短，分數一定看得到（「叫車（Uber）」→「叫車」） */
const short = (n) => { const x = String(n).replace(/（.*?）|\(.*?\)/g, ''); return x.length > 6 ? `${x.slice(0, 5)}…` : x; };
/** 精簡模式：低階裝置或 reduced motion（UX.md §9）——只淡入、不做翻轉與 3D */
export const lite = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
const W = 440, OPT_X = 300, OPT_W = 128;

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
export function renderDecision(root, decision, { sources, decide, CRITERIA, onPick }) {
  const initial = decision.states.map((s) => ({ ...s, on: true }));
  let states = initial;
  let run = 0;

  const draw = () => {
    run++;
    const active = states.filter((s) => s.on).map((s) => s.key);
    // 與伺服器相同的引擎與輸入；初次（狀態未變）直接用伺服器結果，避免任何差異
    const changed = states.some((s) => !s.on) || states.length !== initial.length;
    const r = changed
      ? decide(decision.options, { states: active, arriveBy: decision.arriveBy ?? undefined, arriveByMin: decision.arriveByMin, mode: decision.mode })
      : { ranked: decision.ranked, excluded: decision.excluded, reason: decision.reason, best: { id: decision.best } };
    const byId = new Map(decision.options.map((o) => [o.id, o]));
    const ranked = r.ranked.map((x) => ({ ...byId.get(x.id), score: x.score, breakdown: x.breakdown }));
    const excluded = r.excluded.map((x) => ({ ...byId.get(x.id), why: x.why }));
    const off = states.filter((s) => !s.on && s.source === 'auto').map((s) => STATE_LABEL[s.key]);
    const reason = (off.length ? `不考慮「${off.join('、')}」的話，` : '') + r.reason;

    // FLIP（M5-11）：記下重算前各方案節點的位置，重畫後從舊位置滑到新位置（重算才做；精簡模式不做）
    const before = new Map([...root.querySelectorAll('.dg-opt[data-id]')].map((g) => [g.dataset.id, g.getBoundingClientRect().top]));
    stopLoops();
    const bestOpt = ranked.find((o) => o.id === r.best?.id);
    last = { ranked, excluded, bestName: bestOpt?.name };
    root.replaceChildren(...[
      chipsBar(),
      el('p', 'dg-step', bestOpt ? `④ 決定：${bestOpt.name}` : '④ 決定'),
      graph(ranked, excluded, active, r.best?.id),
      el('p', 'dg-why', reason),
      onPick && ranked.length > 1 && el('p', 'dg-hint', '想換方式？點其他方案，阿幫會用它重算'), // 審查：手機沒有 hover，要寫出來
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
    tl.call(step('① 收集資料'));
    sources.forEach((role, i) => {
      const node = root.querySelector(`.dg-src[data-role="${role}"]`), edge = root.querySelector(`.dg-in-edge[data-role="${role}"]`);
      if (!node || !edge) return;
      const at = 0.1 + i * 0.42;
      tl.to(node, { opacity: 1, duration: 0.2 }, at)
        .fromTo(node, { scale: 1 }, { scale: 1.25, yoyo: true, repeat: 1, duration: 0.14, transformOrigin: '50% 50%' }, at)
        .to(edge, { strokeDashoffset: 0, duration: 0.35 }, at);
      const label = decision.signals?.[role];
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
    tl.call(step('② 看你的狀況'))
      .fromTo(q('.dg-state'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, transformOrigin: '50% 50%', ease: 'back.out(2)', duration: 0.3, stagger: 0.08 })
      .to(q('.dg-link'), { strokeDashoffset: 0, duration: 0.3 }, '<');
    // ③ 比較：方案出現，逐項累加真實分數（breakdown），連線依累計分數變粗
    const { ranked, excluded } = last;
    const max = Math.max(...ranked.map((o) => o.score), 1);
    tl.to(q('.dg-opt'), { opacity: 1, duration: 0.25, stagger: 0.05 })
      .from(q('.dg-opt'), { x: '+=14', duration: 0.25, stagger: 0.05 }, '<');
    let acc = new Map(ranked.map((o) => [o.id, 0]));
    for (const c of CRITERIA) {
      tl.call(step(`③ 比較：${c.label}`));
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
    tl.call(step(`④ 決定：${last.bestName || ''}`))
      .call(() => { for (const o of ranked) { const t = scoreOf.get(o.id); if (t) t.textContent = String(o.score); } for (const o of excluded) { const t = scoreOf.get(o.id); if (t) t.textContent = o.why.includes('超過') ? '遲到' : '排除'; } })
      .to(root.querySelectorAll('.dg-out-edge.step4'), { strokeWidth: 1, duration: 0.2 })
      .to(q('.dg-opt:not(.win), .dg-out-edge:not(.win)'), { opacity: 0.45, duration: 0.3 }, '<')
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
    bar.setAttribute('aria-label', '你的狀態（點一下切換，立即重算）');
    for (const s of states) {
      const b = el('button', `dg-chip ${s.on ? 'on' : 'off'} src-${s.source}`, `${SOURCE_LABEL[s.source]}：${STATE_LABEL[s.key]}`, s.on ? ' ✕' : '');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(s.on));
      if (s.detail) b.title = s.detail;
      b.onclick = () => { states = states.map((x) => (x.key === s.key ? { ...x, on: !x.on } : x)); draw(); };
      bar.append(b);
    }
    for (const k of ADDABLE.filter((k) => !states.some((s) => s.key === k))) {
      const b = el('button', 'dg-chip add', `＋${STATE_LABEL[k]}`);
      b.type = 'button';
      b.onclick = () => { states = [...states, { key: k, source: 'picked', on: true }]; draw(); };
      bar.append(b);
    }
    return bar;
  }

  // 版面（原型 transit-discussion.html 的會議感）：左＝資料來源圓點、中＝阿幫（吉祥物）、右＝方案；狀態膠囊在阿幫上方
  function graph(ranked, excluded, active, bestId) {
    const opts = [...ranked, ...excluded];
    const H = Math.max(240, Math.max(sources.length, opts.length) * 50 + 56);
    const C = { x: 196, y: H / 2 + 10 };
    const ys = (n, i) => (n <= 1 ? C.y : 40 + (i * (H - 90)) / (n - 1)); // 底下留給來源名稱
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dg-svg', role: 'img', 'aria-labelledby': 'dg-title dg-desc' });
    s.append(svg('title', { id: 'dg-title' }, '決策圖'),
      svg('desc', { id: 'dg-desc' }, `資料：${sources.join('、')}；狀態：${active.map((k) => STATE_LABEL[k]).join('、') || '無'}；方案依分數：${ranked.map((o) => `${o.name} ${o.score}`).join('、')}${excluded.length ? `；排除：${excluded.map((o) => o.name).join('、')}` : ''}`));
    ['資料', '阿幫', '方案'].forEach((t, i) => s.append(svg('text', { x: [34, C.x, OPT_X + 4][i], y: 16, class: 'dg-col', 'text-anchor': i === 2 ? 'start' : 'middle' }, t)));
    const edges = svg('g', { class: 'dg-edges' }), nodes = svg('g', { class: 'dg-nodes' });
    s.append(edges, nodes);
    const best = ranked.find((o) => o.id === bestId);
    const winRoles = new Set(best ? keyRoles(best, ranked[1], active) : []);
    // 1 資料來源 → 阿幫
    const srcY = new Map();
    sources.forEach((role, i) => {
      const y = ys(sources.length, i), x = 34;
      srcY.set(role, y);
      const lit = winRoles.has(role);
      edges.append(svg('path', { d: `M${x + 16},${y} C${x + 70},${y} ${C.x - 80},${C.y} ${C.x - 30},${C.y}`, class: `dg-edge dg-in-edge step1${lit ? ' win' : ''}`, 'data-role': role }));
      const g = svg('g', { class: `dg-node dg-src step1${lit ? ' win' : ''}`, 'data-role': role, transform: `translate(${x},${y})` });
      const col = MODE_COLOR[modeOf(role)] || '#0f766e';
      g.append(svg('circle', { r: 16, class: 'dg-src-c', style: `stroke:${col}` }));
      const ic = svgIcon(role, -9, -9, 18);
      if (ic) { ic.style.color = col; g.append(ic); }
      g.append(svg('text', { y: 30, 'text-anchor': 'middle', class: 'dg-lbl' }, role));
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
      const label = STATE_LABEL[k], tag = SOURCE_LABEL[st?.source] || '';
      const y = C.y - 52 - i * 24, w = label.length * 12 + tag.length * 10 + 24;
      const from = srcY.get(STATE_SOURCE[k]);
      if (st?.source === 'auto' && from != null) edges.append(svg('path', { d: `M50,${from} Q${C.x - 70},${y} ${C.x - w / 2},${y}`, class: 'dg-edge dashed dg-link step2' }));
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
        class: `dg-edge dg-out-edge ${isEx ? 'step4 excluded' : 'step3'}${win ? ' win' : ''}`, 'data-id': o.id, style: `stroke-width:${isEx ? 1 : (1 + 7 * (o.score / max)).toFixed(1)}px` })); // 連線粗細＝分數（inline，CSS 的 stroke-width 才蓋不掉）
      const n = node(OPT_X, y, isEx ? `${short(o.name)}` : short(o.name), `dg-opt ${isEx ? 'step4 excluded' : 'step3'}${win ? ' win dg-best' : ''}`, o.role, win, isEx ? (o.why.includes('超過') ? '遲到' : '排除') : String(o.score));
      n.style.setProperty('--i', String(i));
      n.dataset.id = o.id;
      if (onPick && !isEx && !win) { // 點方案＝「改成這個」（沿用起訖點重算；公車會自動盯到站）
        n.classList.add('pickable');
        n.setAttribute('role', 'button');
        n.setAttribute('tabindex', '0');
        n.setAttribute('aria-label', `改成${o.name}`);
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
    d.append(el('summary', null, '看比較細節'));
    for (const o of ranked) {
      const top = new Set(Object.entries(o.breakdown || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k));
      d.append(el('div', 'dg-row', el('b', null, `${o.name}：${o.score} 分`),
        ...CRITERIA.map((c) => {
          const v = (o.breakdown?.[c.key] ?? 0) * 100;
          const bar = el('span', `dg-bar${top.has(c.key) ? ' top' : ''}`);
          bar.style.width = `${Math.max(2, v * 2)}%`;
          return el('div', 'dg-crit', el('span', 'dg-crit-name', c.label), bar, el('span', 'dg-crit-v', v.toFixed(1)));
        })));
    }
    return d;
  }

  draw();
  const played = intro();
  return { states: () => states, redraw: draw, played };
}
