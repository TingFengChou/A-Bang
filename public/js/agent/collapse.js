// 長對話（UX.md §4.17，2026-11-21 PM：「跟 Abang 談話很久後，整個會變很長」）：只改呈現，不動對話內容與送伺服器的上下文。
// 1. 只有最新一輪完整展開；更早的每一輪收成一行摘要（turn-summary.js，程式產生）；點了展開、再點收起。
//    正在回答的那一輪、你正在操作的那一輪（焦點在裡面、剛點過）、阿幫反問你還沒回答的那一輪不收。
// 2. 收起的輪：決策圖停止動畫（decision-graph pause）、卡片照舊（超過 2 輪的已停止刷新）；只留「決定：捷運」小標。
// 3. 換話題（類別不同）或距上一輪超過 30 分鐘：插分隔線「新的話題・22:40」。
// 4. 超過 3 輪：對話上方「今天問過」小目錄（只在整頁顯示）；捲到上面時輸入列右上方出現「回到最新」。
// 收合、展開時保持你正在看的位置（找畫面上第一個不變的元素當錨點，補回捲動距離）；reduced motion 時不動畫。
import { turnSummary, topicOf, topicBreak, topicText, roundLabel, askedBack } from './turn-summary.js';

const TOUCH_MS = 5000; // 剛點過（5 秒內）＝正在操作
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const isRoot = (sc) => sc === document.scrollingElement || sc === document.documentElement;
const scrollerOf = (el) => el.closest('.sheet-body') || document.scrollingElement || document.documentElement;
/** 可視範圍（整頁扣掉頂端列） */
function viewBox(sc) {
  if (isRoot(sc)) return { top: document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0, bottom: innerHeight };
  const r = sc.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}
const inView = (el, sc) => { const r = el.getBoundingClientRect(), v = viewBox(sc); return r.bottom > v.top && r.top < v.bottom; };

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false && k !== '') e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

/**
 * @param {{ log: HTMLElement }} o log：對話（role=log）；每一輪是 log 底下的 .round（使用者泡泡＋.turn）
 */
export function createRounds({ log }) {
  /** @type {Array<{ n: number, round: HTMLElement, q: string, at: number, view: any, follow: boolean, topic: string|null, checked: boolean, broke: boolean, folded: boolean, sum: HTMLButtonElement|null, summary: any, touchedAt: number, keep: boolean, retry: boolean, gen: number, anims: Animation[], done: boolean }>} */
  const rounds = [];
  const byEl = new WeakMap();
  const latest = () => rounds.at(-1) || null;
  const langNow = () => latest()?.view?.lang || null;

  // 「今天問過」小目錄（log 外面：不在 aria-live 區域裡，目錄更新不會被念）
  const nav = el('nav', 'chat-index');
  nav.hidden = true;
  const navTitle = el('span', 'ci-title');
  navTitle.setAttribute('aria-hidden', 'true');
  const list = el('ol', 'ci-list');
  nav.append(navTitle, list);
  // 「回到最新」（放在輸入列上方右邊，不擋中央鍵與輸入框）
  const toLatest = el('button', 'to-latest');
  toLatest.type = 'button';
  toLatest.hidden = true;
  toLatest.append(el('span', 'tl-arrow', '↓'), el('span', 'tl-text'));
  toLatest.querySelector('.tl-arrow').setAttribute('aria-hidden', 'true');
  toLatest.addEventListener('click', () => {
    const m = latest();
    if (!m) return;
    const sc = scrollerOf(log);
    sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
    focusRound(m, false);
  });
  const paintLang = () => {
    const en = langNow() === 'en';
    nav.setAttribute('aria-label', en ? 'Asked today' : '今天問過');
    navTitle.textContent = en ? 'Asked today' : '今天問過';
    toLatest.querySelector('.tl-text').textContent = en ? 'Latest' : '回到最新';
    toLatest.setAttribute('aria-label', en ? 'Back to the latest answer' : '回到最新的對話');
  };
  paintLang();

  // 最新一輪看不到（捲到上面）時顯示「回到最新」
  let io = null;
  const watchLatest = () => {
    if (typeof IntersectionObserver !== 'function') return;
    io?.disconnect();
    const m = latest();
    if (!m || rounds.length < 2) { toLatest.hidden = true; return; }
    io = new IntersectionObserver(([e]) => {
      if (!log.isConnected || log.closest('.sheet-body')) { toLatest.hidden = true; return; }
      toLatest.hidden = e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.top ?? 0);
    }, { rootMargin: '0px 0px -180px 0px' });
    io.observe(m.round);
  };

  // 正在操作：點過、按過鍵、焦點進去
  const touch = (e) => { const m = byEl.get(e.target.closest?.('.round')); if (m) m.touchedAt = Date.now(); };
  for (const t of ['pointerdown', 'keydown', 'focusin']) log.addEventListener(t, touch, true);

  // 只看最近有沒有碰（焦點進去也算碰）：不看 activeElement 本身（手機 Safari 點按鈕不移焦點，舊的焦點會一直留在某一輪）
  const busyWith = (m) => Date.now() - m.touchedAt < TOUCH_MS;

  /** 畫面上第一個不會變的元素（收合、插分隔線時保持它的位置）；changing：這次會變的輪 */
  function anchorFor(changing) {
    const sc = scrollerOf(log);
    const v = viewBox(sc);
    for (const c of log.children) {
      if (changing.has(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.height && r.bottom > v.top) return { sc, a: c, y: r.top };
    }
    return { sc, a: null, y: 0 };
  }
  const fixer = ({ sc, a, y }) => () => {
    if (!a?.isConnected) return;
    const d = a.getBoundingClientRect().top - y;
    if (Math.abs(d) > 0.5) sc.scrollTop += d;
  };
  /** 暫停瀏覽器自己的捲動錨定（我們自己補，避免補兩次） */
  function noAnchor(sc) {
    const els = isRoot(sc) ? [document.documentElement, document.body] : [sc];
    for (const e of els) e.style.overflowAnchor = 'none';
    return () => { for (const e of els) e.style.overflowAnchor = ''; };
  }

  function paintSum(m) {
    if (!m.sum || !m.summary) return;
    const s = m.summary;
    const open = !m.folded;
    m.sum.setAttribute('aria-expanded', String(open));
    m.sum.setAttribute('aria-label', roundLabel(m.n, s, open, m.view?.lang));
  }
  function buildSum(m) {
    const s = m.summary;
    const b = m.sum || el('button', 'round-sum');
    b.type = 'button';
    const en = m.view?.lang === 'en';
    if (en) b.setAttribute('lang', 'en'); else b.removeAttribute('lang');
    b.replaceChildren(...(s.decided
      ? [el('span', 'rs-line', s.title), el('span', 'rs-tag', s.decided), el('span', 'rs-rest', s.rest)]
      : [el('span', 'rs-line', s.line)]), el('span', 'rs-chev'));
    if (!m.sum) {
      b.addEventListener('click', () => (m.folded ? unfold(m, { animate: true }) : fold(m, { animate: true, anchorSelf: true })));
      m.round.prepend(b);
      m.sum = b;
    }
    paintSum(m);
  }

  /** 收起（同步改狀態；看得到時再補動畫）。anchorSelf：使用者自己按收起＝保持摘要按鈕的位置 */
  function fold(m, { animate = false, anchorSelf = false, anchor = null } = {}) {
    if (m.folded || !m.done) return;
    summarize(m); // 每次收起重算：決策圖上加了狀態重算過，摘要跟著圖上現在選的
    buildSum(m);
    const sc = scrollerOf(log);
    const anc = anchor || (anchorSelf ? { sc, a: m.sum, y: m.sum.getBoundingClientRect().top } : anchorFor(new Set([m.round])));
    const restore = noAnchor(sc);
    const motion = animate && !reduced() && typeof m.round.animate === 'function' && inView(m.round, sc);
    stopAnims(m);
    const h0 = m.round.offsetHeight;
    m.folded = true;
    m.round.classList.add('folded');
    m.round.classList.remove('opened');
    m.view?.graph?.pause?.(); // 決策圖：停掉光點與流動
    paintSum(m);
    const fix = fixer(anc);
    if (!motion) { fix(); restore(); return; }
    // 動畫：內容還看得到、慢慢變淡，整輪的高度縮到一行（同時補捲動，錨點不動）
    const h1 = m.round.offsetHeight;
    m.round.classList.add('folding');
    play(m, h0, h1, fix, restore, () => m.round.classList.remove('folding'), [...m.round.children].filter((c) => c !== m.sum), [1, 0]);
  }

  /** 展開（使用者點摘要、目錄、提醒頁連結） */
  function unfold(m, { animate = false } = {}) {
    if (!m.folded) return;
    const sc = scrollerOf(log);
    const anc = { sc, a: m.sum, y: m.sum?.getBoundingClientRect().top ?? 0 }; // 摘要按鈕不動，內容往下展開
    const restore = noAnchor(sc);
    const motion = animate && !reduced() && typeof m.round.animate === 'function' && inView(m.round, sc);
    stopAnims(m);
    const h0 = m.round.offsetHeight;
    m.folded = false;
    m.round.classList.remove('folded', 'folding');
    m.round.classList.add('opened');
    m.view?.graph?.resume?.();
    paintSum(m);
    const fix = fixer(anc);
    if (!motion) { fix(); restore(); return; }
    play(m, h0, m.round.offsetHeight, fix, restore, null, [...m.round.children].filter((c) => c !== m.sum), [0, 1]);
  }

  function stopAnims(m) { m.gen++; for (const a of m.anims) a.cancel(); m.anims = []; m.round.classList.remove('folding'); m.round.style.overflow = ''; }
  function play(m, h0, h1, fix, restore, after, kids, [o0, o1]) {
    const gen = m.gen;
    const opt = { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' };
    m.round.style.overflow = 'hidden';
    const a = m.round.animate([{ height: `${h0}px` }, { height: `${h1}px` }], opt);
    m.anims = [a, ...kids.map((k) => k.animate([{ opacity: o0 }, { opacity: o1 }], { ...opt, duration: 200 }))];
    let raf = 0;
    const loop = () => { fix(); raf = requestAnimationFrame(loop); };
    loop();
    const end = () => {
      cancelAnimationFrame(raf);
      if (gen !== m.gen) { restore(); return; } // 中途又按了：新的那次接手
      m.round.style.overflow = '';
      m.anims = [];
      after?.();
      fix();
      restore();
    };
    a.finished.then(end, end);
  }

  function summarize(m) {
    const v = m.view || {};
    m.summary = turnSummary({ q: m.q, results: v.results, decision: v.decision, best: v.box?.dataset.best || null, text: v.text, lang: v.lang });
  }

  function focusRound(m, preferSum = true) {
    const target = preferSum && m.sum && getComputedStyle(m.sum).display !== 'none' ? m.sum : m.round;
    if (target === m.round) m.round.tabIndex = -1;
    const was = m.touchedAt;
    target.focus({ preventScroll: true });
    m.touchedAt = was; // 程式移過去的焦點不算「正在操作」（下一輪照常收起）
  }

  // ───── 目錄 ─────
  function paintIndex() {
    paintLang();
    nav.hidden = rounds.length <= 3;
    list.replaceChildren(...rounds.map((m) => {
      const s = m.summary;
      const b = el('button', 'ci-item', s?.short || m.q.slice(0, 6));
      b.type = 'button';
      if (m.view?.lang === 'en') b.setAttribute('lang', 'en');
      b.setAttribute('aria-label', s ? roundLabel(m.n, s, null, m.view?.lang) : m.q);
      if (m === latest()) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => api.reveal(m.n));
      const li = el('li', m.broke ? 'ci-break' : '', b);
      return li;
    }));
  }

  // ───── 分隔線 ─────
  function separate(m) {
    if (m.broke) return;
    m.broke = true;
    const line = el('div', 'thread-reset topic-sep', el('span', '', topicText(m.at, m.view?.lang)));
    line.setAttribute('role', 'separator');
    line.setAttribute('aria-label', topicText(m.at, m.view?.lang).replace('・', '，'));
    const anc = anchorFor(new Set([m.round]));
    const restore = noAnchor(anc.sc);
    m.round.before(line);
    // 錨點在新的這一輪上面（看舊的時）不動；錨點就是這一輪時保持它的位置
    fixer(anc)();
    restore();
  }

  /** 換話題：前面還展開的（不在操作中）全部收起 */
  function foldOlder(except, { animate }) {
    const targets = rounds.filter((r) => r !== except && !r.folded && r.done && !busyWith(r) && !(r.keep && r === rounds.at(-2)));
    if (!targets.length) return;
    const anchor = anchorFor(new Set(targets.map((r) => r.round)));
    for (const r of targets) fold(r, { animate: animate && r === rounds.at(-2), anchor });
  }

  const api = {
    nav,
    toLatest,
    /**
     * 新的一輪開始（已經接到 log 底下）。
     * @param {HTMLElement} round
     * @param {{ q: string, view: any, follow?: boolean, at?: number }} o follow：從「接下來可以」點的（接著上一輪，不算換話題）
     */
    start(round, { q, view, follow = false, at = Date.now() }) {
      const prev = latest();
      const m = { n: rounds.length + 1, round, q, at, view, follow, topic: null, checked: false, broke: false, folded: false, sum: null, summary: null, touchedAt: 0, keep: false, retry: false, gen: 0, anims: [], done: false };
      rounds.push(m);
      byEl.set(round, m);
      round.dataset.round = String(m.n);
      if (prev) {
        prev.keep = askedBack(prev.view || {}); // 阿幫反問你：這一輪是回答，前一輪留著
        if (topicBreak({ ...prev, at: prev.endAt || prev.at }, { topic: null, at }) === 'time') separate(m);
        const targets = rounds.filter((r) => r !== m && !r.folded && r.done);
        const busy = targets.filter((r) => busyWith(r) || (r === prev && prev.keep));
        for (const r of busy) r.retry = !(r === prev && prev.keep);
        const go = targets.filter((r) => !busy.includes(r));
        if (go.length) {
          const anchor = anchorFor(new Set(go.map((r) => r.round)));
          for (const r of go) fold(r, { animate: r === prev, anchor });
        }
      }
      paintIndex();
      watchLatest();
    },
    /** 這一輪有新資料（status、工具結果）：知道話題就判斷要不要分段 */
    progress(round) {
      const m = byEl.get(round);
      if (!m || m.checked || m.broke) return;
      const v = m.view || {};
      const topic = topicOf({ results: v.results, intent: v.judge?.intent, profile: v.profile });
      if (!topic) return;
      m.checked = true;
      m.topic = topic;
      const prev = rounds[m.n - 2];
      const follow = m.follow || !!v.judge?.followUp || m.round.querySelector('.turn')?.dataset.follow === '1' || !!m.round.querySelector('.turn')?.dataset.reset;
      if (prev && topicBreak({ ...prev, at: m.at }, { topic, at: m.at, follow }) === 'topic') {
        separate(m);
        foldOlder(m, { animate: true });
        paintIndex();
      }
    },
    /** 這一輪答完（含中斷）：算摘要、更新目錄；剛剛因為在操作而沒收的，現在收 */
    end(round) {
      const m = byEl.get(round);
      if (!m) return;
      m.done = true;
      m.endAt = Date.now();
      const v = m.view || {};
      if (!m.topic) m.topic = topicOf({ results: v.results, intent: v.judge?.intent, profile: v.profile });
      if (!m.checked) api.progress(round);
      summarize(m);
      buildSum(m);
      for (const r of rounds) if (r.retry && r !== m && !r.folded && !busyWith(r)) { r.retry = false; fold(r, { animate: true }); }
      paintIndex();
    },
    /** 第 n 輪：展開、捲到那裡、焦點放在摘要（目錄、提醒頁「看當時的對話」） */
    reveal(n) {
      const m = rounds[n - 1];
      if (!m) return false;
      if (m.folded) unfold(m);
      m.round.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      focusRound(m);
      paintIndex();
      return true;
    },
    has: (n) => !!rounds[n - 1] && log.contains(rounds[n - 1].round), // 換頁時整段對話收起來（不在畫面上），還在對話裡就算
    /** 最近碰過（點、焦點）的那一輪；沒有就是最新一輪 */
    recent(ms) {
      const t = rounds.filter((r) => Date.now() - r.touchedAt < ms).sort((a, b) => b.touchedAt - a.touchedAt)[0];
      return t || latest();
    },
    /** 標記這一輪剛被操作（「接下來可以」的按鈕在 log 外面） */
    touch(round) { const m = byEl.get(round); if (m) m.touchedAt = Date.now(); },
    clear() { io?.disconnect(); rounds.length = 0; list.replaceChildren(); nav.hidden = true; toLatest.hidden = true; },
  };
  return api;
}
