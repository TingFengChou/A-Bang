// 「阿幫的腦袋」（#/ai）現場試判斷：按一次看四段（2026-11-22，產品負責人：「除了意圖狀態外，可以多是否有足夠資料，
// 最後預計回答的內容，還有下一個預計詢問使用者的內容，讓我之後可以判斷是否夠聰明」）。
//   1 意圖與狀態：手機上的 AI（edgeJudge，不經網路）；不能用就照伺服器判斷層（規則／分類器）的結果，標來源
//   2 資料夠不夠：/api/v1/agent 在 clientCaps.trial 時送的 trial 事件（core/agent/trial.js，程式算）
//   3 預計回答：真的跑一次 agent 的 edge 模式（伺服器只跑規則、不呼叫任何伺服器模型）拿 answer_draft（程式版），
//     手機能寫就在手機上改寫（edgeWrite，程式護欄 checkRewrite），兩版都列
//   4 下一個預計問你：這一輪的「阿幫問你」（ask 事件）＋動態建議（手機猜＋伺服器驗證；不能用就規則），前 3 句。
//     題目是手機上的 AI 決定的還是規則保底（askSource）；手機提議但被程式擋下的題目也照列（手機上的形狀檢查、伺服器的 askCheck，含原因，ADR-0020）
// 隱私：試判斷不送定位（伺服器請定位時照實記下「會先問你在哪」，回答用不給定位時的預設起點）、不送常用地點與習慣、不送健康資料；
// 送伺服器的只有問題句子（與手機判斷的意圖、狀態列舉值，跟問阿幫一樣）。這裡的函式不碰畫面（ai.js 畫），依賴由參數帶入，方便測試。
import { suggestContext, contextText, ruleAsks, pickSuggestions, validateAsks } from './agent/suggest.js';
import { nextSteps } from './agent/next-steps.js';
import { actionsOf } from './ai-actions.js';

export const TRIAL_SECTIONS = ['judge', 'data', 'answer', 'next', 'act']; // act：阿幫可以幫你做（2026-11-28，ai-actions.js）
/** 試判斷的預設測試句（含一題資料不夠、一題英文、一題防詐）：字典 key */
export const TRIAL_PRESETS = ['trial.p1', 'trial.p2', 'trial.p3', 'trial.p4', 'trial.p5'];
/** 下一句建議最多列幾句 */
export const NEXT_MAX = 3;

const ms = (t0, now) => Math.max(0, Math.round(now() - t0));
const pickTool = (e) => ({ id: e.id, name: e.name, title: e.title, role: e.role });

/**
 * agent 事件 → 這一輪的摘要（給第 3、4 段）。純函式。
 * @param {object[]} events runAgent 收到的事件（含 client_tool_call）
 */
export function summarizeRun(events = []) {
  const out = { mode: null, lang: 'zh', judge: null, trial: null, tools: [], results: [], decision: null, ask: null, askCheck: null, draft: null, text: '', askedLocation: false, located: false, notes: [], safety: null, error: null };
  const started = new Map();
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    switch (e.type) {
      case 'status': out.mode = e.mode; out.lang = e.lang === 'en' ? 'en' : 'zh'; if (e.judge) out.judge = e.judge; break;
      case 'trial': if (!out.trial) out.trial = e; break;
      case 'agent_note': out.notes.push(String(e.text || '')); break;
      case 'tool_start': started.set(e.id, pickTool(e)); break;
      case 'tool_result': {
        const s = started.get(e.id) || { id: e.id, name: e.tool };
        out.tools.push({ ...s, ok: e.ok !== false, ...(e.ok === false ? { error: e.error } : { speak: e.speak || '', mode: e.mode || null }) });
        if (e.ok !== false) out.results.push({ tool: e.tool, data: e.data, args: e.args, card: e.card });
        break;
      }
      case 'decision': out.decision = e; break;
      case 'ask': if (!out.ask) out.ask = { id: e.id, question: e.question, options: (e.options || []).map((o) => ({ label: o.label, kind: o.kind, ...(o.guess && { guess: true }), ...(o.kind === 'action' && o.action?.name && { action: o.action.name }) })), ...(e.about && { about: e.about }), ...(e.why && { why: e.why }), ...(e.pending && { pending: e.pending }), askSource: e.askSource === 'device' ? 'device' : 'rule' }; break;
      case 'done': if (e.askCheck) out.askCheck = e.askCheck; break; // 手機提議的題目用了沒（只在最後的 done；請定位那一次沒有）
      case 'answer_draft': out.draft = { text: e.text, facts: e.facts, lang: e.lang }; break;
      case 'text': out.text += String(e.delta || ''); break;
      case 'client_tool_call': if (e.name === 'device_location') out.askedLocation = true; break;
      case 'client_tool_result': if (e.name === 'device_location' && e.ok) out.located = true; break; // 手機給了定位（座標不在事件裡）
      case 'guardrail': if (/^safety:/.test(e.rule || '')) out.safety = String(e.rule).slice(7); break;
      case 'error': out.error = String(e.message || ''); break;
      default:
    }
  }
  return out;
}

/** 第 1 段（手機判斷不能用時）：照伺服器判斷層的結果 */
export const serverJudge = (trial) => (trial?.judge ? { intent: trial.judge.intent, states: trial.judge.states || [], source: trial.judge.source || 'rules', ...(trial.judge.engine && { engine: trial.judge.engine }) } : null);

/**
 * 下一句建議（同問阿幫頁的動態建議：手機猜＋伺服器驗證；不能用就規則），只取問句前 NEXT_MAX 句並標來源。
 * @param {{ q: string, run: ReturnType<typeof summarizeRun>, now?: number, canEdge: () => boolean, edgeSuggest: Function, check: Function, wait?: number }} o
 * @returns {Promise<{ source: 'edge'|'rules', asks: Array<{ q: string, src: string }>, guessed: string[], checked: boolean }>} guessed：手機猜的原句（驗證前）
 */
export async function trialSuggest({ q, run, now = Date.now(), canEdge, edgeSuggest, check, wait = 1500, clock = () => Date.now() }) {
  const lang = run.lang === 'en' ? 'en' : null;
  const ctx = suggestContext({ turns: [{ q, results: run.results, decision: run.decision, lang }], now, saved: [] }); // 試判斷不用常用地點
  const steps = nextSteps(run.results, run.decision, { lang }).filter((x) => x.kind === 'ask');
  const rules = [...steps.map((x) => ({ label: x.label, q: x.payload, ask: x.ask, src: 'next', rel: 2, ...(x.pin && { pin: true }) })), ...ruleAsks(ctx)];
  let edge = null, guessed = [], checked = false;
  if (canEdge()) {
    const t0 = clock();
    const r = await edgeSuggest(contextText(ctx), { lang, timeout: wait });
    guessed = r?.asks || [];
    const left = wait - (clock() - t0);
    checked = !!(r && left > 50);
    const ok = checked ? await validateAsks(r.asks, { check: (a) => check(a, left), saved: [] }) : [];
    if (ok.length) edge = ok;
  }
  const { asks } = pickSuggestions({ edge, rules, ctx, max: NEXT_MAX });
  const list = asks.slice(0, NEXT_MAX).map((a) => ({ q: a.q || a.label, src: a.src === 'edge' ? 'edge' : 'rule' }));
  return { source: list.some((a) => a.src === 'edge') ? 'edge' : 'rules', asks: list, guessed, checked }; // checked：有把猜的句子送伺服器驗證（只送句子）
}

/**
 * 跑一次試判斷：依序產生四段（每段好了就 onSection(key, section)），回傳整份結果（複製用）。
 * @param {string} q 問題句子
 * @param {{
 *   device: { active: boolean, engine?: string|null, write?: boolean, reason?: string },
 *   judge: (q: string) => Promise<{ intent: string, states: string[], engine: string }|null>,
 *   agent: (body: object, onEvent: (e: object) => void, opts: object) => Promise<void>,
 *   write: (draft: object, o: { engine?: string }) => Promise<object>,
 *   suggest: (o: { q: string, run: object }) => Promise<object>,
 *   judgeMs?: () => number|null, now?: () => number, signal?: AbortSignal,
 * }} deps
 * @param {(key: string, section: object) => void} [onSection]
 * @param {(e: object) => void} [onEvent] 給「阿幫在想」動畫的事件（device、agent 事件、suggest）
 */
/** 試判斷帶的前文：問阿幫最近 6 則（3 問 3 答） */
export const TRIAL_HISTORY = 6;

export async function runTrial(q, deps, onSection = () => {}, onEvent = () => {}) {
  const now = deps.now || (() => performance.now());
  const report = { q, at: new Date().toISOString(), sections: {} };
  const put = (key, s) => { report.sections[key] = s; onSection(key, s); };
  const t0 = now();
  // 1 意圖與狀態：手機上的 AI 先判斷（沒有網路）
  let dev = null;
  if (deps.device.active) {
    dev = await deps.judge(q).catch(() => null);
    const t = ms(t0, now);
    if (dev) put('judge', { by: 'device', engine: dev.engine, intent: dev.intent, states: dev.states, ms: deps.judgeMs?.() ?? t, network: false, ...(dev.ask && { ask: dev.ask }) });
  }
  onEvent({ type: 'device', result: dev });
  // 2、3 真的跑一次 agent（edge 模式、試判斷），跟問阿幫一樣用手機知道的事（2026-11-22 產品負責人「阿幫應該要有手機有的所有資訊，地點、時間不應該要問」）：
  //   前文：問阿幫最近幾句（history）；定位：伺服器請定位時由手機查（locate；沒給就不送）
  const events = [];
  const prior = (deps.history?.() || []).filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string').slice(-TRIAL_HISTORY);
  const t1 = now();
  let tTrial = null;
  const body = { messages: [...prior, { role: 'user', content: q }], clientCaps: { edgeWrite: true, trial: true, ...(deps.device.write && deps.device.engine && { engine: deps.device.engine }) }, ...(dev && { deviceJudge: dev }) };
  try {
    await deps.agent(body, (e) => {
      events.push(e);
      if (e.type === 'trial' && tTrial == null) {
        tTrial = ms(t1, now);
        if (!report.sections.judge) put('judge', { by: 'server', ...serverJudge(e), ms: tTrial, network: true, why: deps.device.active ? deps.judgeIssue?.() || 'failed' : deps.device.reason || 'web' });
        else put('judge', { ...report.sections.judge, server: serverJudge(e) }); // 伺服器怎麼看（有沒有採用手機的判斷）
        put('data', { ...dataSection(e), ms: tTrial, network: true });
      }
      if (e.type !== 'answer_draft' && e.type !== 'text' && e.type !== 'done') onEvent(e);
    }, { locate: deps.locate || (async () => null), signal: deps.signal });
  } catch (err) {
    events.push({ type: 'error', message: String(err?.message || err) });
  }
  if (deps.signal?.aborted) return report; // 離開頁面：不再請手機改寫、猜下一句
  const run = summarizeRun(events);
  if (!report.sections.judge) put('judge', { by: 'server', ...(serverJudge(run.trial) || { intent: run.judge?.intent || 'unknown', states: [], source: run.judge?.source || 'rules' }), ms: ms(t1, now), network: true, why: deps.device.active ? deps.judgeIssue?.() || 'failed' : deps.device.reason || 'web' });
  if (!report.sections.data) put('data', run.trial ? { ...dataSection(run.trial), ms: ms(t1, now), network: true } : { error: run.error || 'no-trial', network: true });
  // 3 預計回答：程式版（伺服器規則）＋手機改寫（可用時）
  const tAnswer = ms(t1, now);
  let rewrite = null;
  if (run.draft && deps.device.write) {
    onEvent({ type: 'answer_draft' });
    const t2 = now();
    const r = await deps.write(run.draft, { engine: deps.device.engine }).catch(() => null);
    rewrite = r ? { by: r.by, ok: r.by === 'edge', ...(r.by === 'edge' ? { text: r.text } : { reason: r.reason, ...(r.detail && { check: r.detail }), ...(r.why && { why: r.why }), ...(r.candidate && { text: r.candidate }) }), ...(r.engine && { engine: r.engine }), ms: r.ms ?? ms(t2, now) } : { by: 'program', ok: false, reason: 'failed', ms: ms(t2, now) };
  }
  put('answer', {
    mode: run.mode, lang: run.lang, server: 'rules',
    draft: run.draft?.text ?? (run.text || null), facts: run.draft?.facts || null,
    ...(run.text && !run.draft && { direct: true }), // 安全情境、還沒設定常用地點：伺服器直接送固定的回答，不交給手機改寫
    rewrite: rewrite || { by: 'none', reason: deps.device.write ? (run.draft ? 'none' : 'direct') : deps.device.active ? 'no-write' : 'web' },
    final: rewrite?.ok ? rewrite.text : (run.draft?.text ?? run.text ?? ''),
    tools: run.tools.filter((x) => x.name !== 'find_place').map((x) => ({ name: x.name, title: x.title, role: x.role, ok: x.ok, ...(x.ok ? { speak: x.speak, mode: x.mode } : { error: x.error }) })),
    ...(run.decision?.best && { best: run.decision.options?.find((o) => o.id === run.decision.best)?.name || null }),
    askedLocation: run.askedLocation, located: run.located, turns: prior.filter((m) => m.role === 'user').length, ...(run.safety && { safety: run.safety }), ...(run.error && { error: run.error }),
    ms: tAnswer + (rewrite?.ms || 0), network: true,
  });
  // 4 下一個預計問你：阿幫問你（這一輪的 ask）＋使用者接下來可能問的（動態建議）
  onEvent({ type: 'suggest' });
  const t3 = now();
  const sug = await deps.suggest({ q, run }).catch(() => ({ source: 'rules', asks: [], guessed: [], checked: false }));
  const data = report.sections.data;
  const nextSec = { ask: run.ask, asker: askerOf(run, dev, deps.askInfo?.() || null), missing: data?.missing || [], location: !run.located && !!(run.askedLocation || data?.location), suggest: sug, ms: ms(t3, now), network: !!sug.checked }; // 問題來自上面那一輪（已經用過網路）；建議只有驗證猜的句子時用網路
  put('next', nextSec);
  // 5 阿幫可以幫你做：從這一輪的事件推出（程式算、不再用網路；試判斷不執行任何行動）
  put('act', { actions: actionsOf(run), ms: 0, network: false });
  return report;
}

/**
 * 第 4 段「這題誰決定的」（ADR-0020）：手機上的 AI 提議了什麼、程式採用了沒（沒採用的原因）、最後是誰問的。純函式。
 * @param {ReturnType<typeof summarizeRun>} run
 * @param {object|null} dev 手機判斷（送伺服器的 deviceJudge，可能帶 ask）
 * @param {{ raw: object|null, reason: string|null }|null} phone 手機上整理模型回傳的結果（edgeJudge onAsk）：reason＝在手機上就被擋下的原因
 * @returns {{ by: 'device'|'rule'|'none', engine?: string, proposed: object|null, blocked: null|{ where: 'phone'|'server', reason: string } }}
 */
export function askerOf(run, dev, phone = null) {
  const proposed = phone?.raw ? { slot: phone.raw.slot, ...(phone.raw.state && { state: phone.raw.state }), question: phone.raw.question, options: [...(phone.raw.options || [])] } : dev?.ask ? { ...dev.ask, options: [...dev.ask.options] } : null;
  const by = run.ask ? (run.ask.askSource === 'device' ? 'device' : 'rule') : 'none';
  const blocked = phone?.reason ? { where: 'phone', reason: phone.reason }
    : run.askCheck?.verdict === 'rejected' ? { where: 'server', reason: run.askCheck.reason || 'not-missing' }
      : proposed && dev?.ask && by !== 'device' && !run.askCheck ? { where: 'server', reason: 'not-missing' } : null; // 安全情境、伺服器出錯：沒有 askCheck 也照實說沒採用
  return { by, ...(dev?.engine && { engine: dev.engine }), proposed, blocked };
}

/** trial 事件 → 第 2 段（去掉事件型別） */
export function dataSection(e) {
  const { type: _t, ...rest } = e || {};
  return rest;
}

/** 複製用：整份結果（JSON；只到剪貼簿，不上傳） */
export const reportJson = (report) => JSON.stringify(report, null, 2);
