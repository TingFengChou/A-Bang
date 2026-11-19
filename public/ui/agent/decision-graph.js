// 決策圖（M5-09，UX.md §5、ADR-0010）：資料（工具）→ 你的狀態 → 方案 → 建議。
// 數字全部來自 decision 事件（plan_trip 的真實資料與 decide.js 計分）；切換狀態 chip 時用同一份 decide.js 在瀏覽器重算，不呼叫伺服器。
// 不用 innerHTML（資料來自上游）；動畫只用 CSS，prefers-reduced-motion 時直接顯示最終狀態。

const SVG = 'http://www.w3.org/2000/svg';
const STATE_LABEL = { rush: '趕時間', traffic: '塞車中', rain: '下雨', luggage: '帶行李', budget: '想省錢', lessWalk: '少走路', badAir: '空品不佳' };
const SOURCE_LABEL = { auto: '自動', user: '你說的', picked: '你選的' };
/** 自動狀態連回產生它的工具（UX.md §5 CRIT_SRC） */
const STATE_SOURCE = { rain: '天氣', traffic: '路況', badAir: '空品' };
const ROLE_CLASS = { 地點: 'place', 天氣: 'place', 公車: 'bus', YouBike: 'bike', 高鐵: 'rail', 台鐵: 'tra', 捷運: 'brand', 路況: 'car', 客運: 'car', 票價: 'fare', 叫車: 'car', 行程: 'brand' };
const ADDABLE = ['rush', 'budget', 'lessWalk', 'luggage'];
/** 方案名稱縮短，分數一定看得到（「叫車（Uber）」→「叫車」） */
const short = (n) => { const x = String(n).replace(/（.*?）|\(.*?\)/g, ''); return x.length > 6 ? `${x.slice(0, 5)}…` : x; };
/** 精簡模式：低階裝置或 reduced motion（UX.md §9）——只淡入、不做翻轉與 3D */
export const lite = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4);
const ROW = 44, COL = [8, 128, 248, 368], W = 480, NODE_W = 104;

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
 * @param {{ sources: string[], decide: Function, CRITERIA: Array<{ key: string, label: string }> }} opts sources＝本輪回報的小幫手角色
 */
export function renderDecision(root, decision, { sources, decide, CRITERIA }) {
  const initial = decision.states.map((s) => ({ ...s, on: true }));
  let states = initial;
  let run = 0;

  const draw = () => {
    run++;
    const active = states.filter((s) => s.on).map((s) => s.key);
    // 與伺服器相同的引擎與輸入；初次（狀態未變）直接用伺服器結果，避免任何差異
    const changed = states.some((s) => !s.on) || states.length !== initial.length;
    const r = changed
      ? decide(decision.options, { states: active, arriveBy: decision.arriveBy ?? undefined, arriveByMin: decision.arriveByMin })
      : { ranked: decision.ranked, excluded: decision.excluded, reason: decision.reason, best: { id: decision.best } };
    const byId = new Map(decision.options.map((o) => [o.id, o]));
    const ranked = r.ranked.map((x) => ({ ...byId.get(x.id), score: x.score, breakdown: x.breakdown }));
    const excluded = r.excluded.map((x) => ({ ...byId.get(x.id), why: x.why }));
    const off = states.filter((s) => !s.on && s.source === 'auto').map((s) => STATE_LABEL[s.key]);
    const reason = (off.length ? `不考慮「${off.join('、')}」的話，` : '') + r.reason;

    // FLIP（M5-11）：記下重算前各方案節點的位置，重畫後從舊位置滑到新位置（重算才做；精簡模式不做）
    const before = new Map([...root.querySelectorAll('.dg-opt[data-id]')].map((g) => [g.dataset.id, g.getBoundingClientRect().top]));
    root.replaceChildren(
      chipsBar(),
      graph(ranked, excluded, active, r.best?.id),
      el('p', 'dg-why', reason),
      details(ranked),
    );
    root.dataset.run = String(run);
    root.dataset.best = r.best?.id ?? '';
    if (before.size && !lite()) flip(before);
  };

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

  function graph(ranked, excluded, active, bestId) {
    const opts = [...ranked, ...excluded];
    const rows = Math.max(sources.length, active.length, opts.length, 1);
    const H = rows * ROW + 28;
    const y = (i, n) => 28 + (i + 0.5) * ((H - 28) / Math.max(n, 1));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'dg-svg', role: 'img', 'aria-labelledby': 'dg-title dg-desc' });
    s.append(svg('title', { id: 'dg-title' }, '決策圖'),
      svg('desc', { id: 'dg-desc' }, `資料：${sources.join('、')}；狀態：${active.map((k) => STATE_LABEL[k]).join('、') || '無'}；方案依分數：${ranked.map((o) => `${o.name} ${o.score}`).join('、')}${excluded.length ? `；排除：${excluded.map((o) => o.name).join('、')}` : ''}`));
    ['資料', '你的狀態', '方案', '建議'].forEach((t, i) => s.append(svg('text', { x: COL[i], y: 16, class: 'dg-col' }, t)));
    const srcY = new Map(sources.map((r, i) => [r, y(i, sources.length)]));
    const hub = { x: COL[1] + NODE_W / 2, y: (H + 28) / 2 };
    const best = ranked.find((o) => o.id === bestId);
    const winRoles = new Set(best ? keyRoles(best, ranked[1], active) : []);
    // 1 資料 → 阿幫（中間），資料膠囊沿線流動
    for (const [role, yy] of srcY) {
      const lit = winRoles.has(role);
      s.append(svg('path', { d: `M${COL[0] + NODE_W},${yy} C${COL[1] - 10},${yy} ${COL[1] - 10},${hub.y} ${hub.x - 30},${hub.y}`, class: `dg-edge step1${lit ? ' win' : ''}` }));
      s.append(node(COL[0], yy, role, `dg-src r-${ROLE_CLASS[role] || 'brand'} step1${lit ? ' win' : ''}`));
    }
    // 2 狀態：標籤；自動狀態以虛線連回來源工具
    active.forEach((k, i) => {
      const yy = y(i, active.length);
      const from = srcY.get(STATE_SOURCE[k]);
      const st = states.find((x) => x.key === k);
      if (st?.source === 'auto' && from != null) s.append(svg('path', { d: `M${COL[0] + NODE_W},${from} L${COL[1]},${yy}`, class: 'dg-edge dashed step2' }));
      s.append(node(COL[1], yy, STATE_LABEL[k], `dg-state step2 src-${st?.source}`));
    });
    if (!active.length) s.append(node(COL[1], hub.y, '阿幫', 'dg-hub step2'));
    // 3 方案：連線粗細＝分數；4 排除：灰階刪除線
    const max = Math.max(...ranked.map((o) => o.score), 1);
    opts.forEach((o, i) => {
      const yy = y(i, opts.length);
      const isEx = i >= ranked.length;
      const win = o.id === bestId;
      s.append(svg('path', { d: `M${COL[1] + NODE_W},${hub.y} C${COL[2] - 20},${hub.y} ${COL[2] - 20},${yy} ${COL[2]},${yy}`,
        class: `dg-edge ${isEx ? 'step4 excluded' : 'step3'}${win ? ' win' : ''}`, 'stroke-width': isEx ? 1 : (1 + 7 * (o.score / max)).toFixed(1) }));
      const n = node(COL[2], yy, isEx ? `${short(o.name)}（${o.why.includes('超過') ? '會遲到' : '排除'}）` : `${short(o.name)} ${o.score}`, `dg-opt ${isEx ? 'step4 excluded' : 'step3'}${win ? ' win' : ''}`);
      n.style.setProperty('--i', String(i));
      n.dataset.id = o.id;
      s.append(n);
    });
    // 5 勝出路徑 → 建議
    if (best) {
      const yy = y(0, opts.length);
      s.append(svg('path', { d: `M${COL[2] + NODE_W},${yy} L${COL[3]},${hub.y}`, class: 'dg-edge win step5' }));
      s.append(node(COL[3], hub.y, best.name, 'dg-best win step5'));
    }
    return s;
  }

  function node(x, y, label, cls) {
    const g = svg('g', { class: `dg-node ${cls}`, transform: `translate(${x},${y - 14})` });
    g.append(svg('rect', { width: NODE_W, height: 28, rx: 8 }), svg('text', { x: NODE_W / 2, y: 18, 'text-anchor': 'middle' }, label.length > 9 ? `${label.slice(0, 8)}…` : label));
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
  return { states: () => states, redraw: draw };
}
