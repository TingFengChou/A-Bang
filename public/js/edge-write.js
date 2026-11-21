// 回答也在手機上寫（ADR-0017）：手機 App 的系統模型（Gemini Nano／Apple Intelligence）可用、開關開著時，
// 請求帶 clientCaps.edgeWrite，伺服器不呼叫任何 AI 模型，只查資料、用程式排序，最後送 answer_draft（程式版總結＋事實清單）；
// 這裡請外掛 AbangEdgeAI.write 改寫成自然的一兩句，再用 core/edge-write.js 的程式護欄檢查（數字、時間、ADR-0011…），
// 不過、逾時（2.5 秒）、外掛失敗 → 用程式版總結。網頁版、不支援的手機、開關關掉 → 不帶 clientCaps，行為與原本相同。
import { checkRewrite, worthRewriting, writePrompt, WRITE_INSTRUCTIONS, WRITE_TARGET_CHARS } from '../../core/edge-write.js';
import { edgeEnabled, edgeStatus, EDGE_ENGINES, EDGE_ENGINE_NAME } from './edge-judge.js';

const PLUGIN = 'AbangEdgeAI';
/** 等手機寫最多這麼久（原生端 2.3 秒取消）；超過就用程式版 */
export const WRITE_TIMEOUT_MS = 2500;
const OFF_KEY = 'abang.edgeWrite';
export const WRITE_STATS_KEY = 'abang.edgeWriteStats';
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};

/** 「回答也在手機上寫」開關（預設開；讀不到就當開著） */
export function edgeWriteEnabled() {
  try { return globalThis.localStorage?.getItem(OFF_KEY) !== 'off'; } catch { return true; }
}
export function setEdgeWriteEnabled(on) {
  try { if (on) globalThis.localStorage.removeItem(OFF_KEY); else globalThis.localStorage.setItem(OFF_KEY, 'off'); return true; } catch { return false; }
}

// 外掛狀態只問一次（60 秒內沿用）：每次送出都問會多一次原生往返
let caps = null;
/** 測試用 */
export const _resetEdgeWrite = () => { caps = null; inflight = false; };

/**
 * 這一輪能不能交給手機寫：App 裡、裝置端 AI 與「回答也在手機上寫」都開著、外掛說可用且支援 write。
 * @returns {Promise<{ edgeWrite: true, engine: string } | null>} 請求的 clientCaps
 */
export async function edgeWriteCaps() {
  if (!cap() || !edgeEnabled() || !edgeWriteEnabled()) return null;
  if (!caps || Date.now() - caps.at > 60_000) caps = { at: Date.now(), p: edgeStatus().catch(() => null) };
  const s = await caps.p;
  return s?.available === true && s.write === true && EDGE_ENGINES.includes(s.engine) ? { edgeWrite: true, engine: s.engine } : null;
}

// 本機統計（#/ai「寫回答」那一格）：今天寫了幾次、上次花多久、改寫通過檢查的比例；只有數字、只存在這支手機
const dayKey = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const validMs = (v) => (Number.isFinite(v) && v >= 0 && v <= 60_000 ? Math.round(v) : null);
/** @returns {{ today: number, lastMs: number|null, tried: number, passed: number }} tried／passed：手機有交回改寫的次數、其中通過檢查的次數 */
export function edgeWriteStats(now = Date.now()) {
  let o;
  try { o = JSON.parse(globalThis.localStorage?.getItem(WRITE_STATS_KEY) || 'null') || {}; } catch { o = {}; }
  if (typeof o !== 'object') o = {};
  const tried = int(o.t), passed = Math.min(int(o.p), tried);
  return { today: o.d === dayKey(now) ? int(o.n) : 0, lastMs: validMs(o.ms), tried, passed };
}
/** 記一次手機寫的回答（ok：通過檢查；ms：花多久） */
export function noteEdgeWrite(ok, ms, now = Date.now()) {
  const s = edgeWriteStats(now);
  try { globalThis.localStorage?.setItem(WRITE_STATS_KEY, JSON.stringify({ d: dayKey(now), n: s.today + 1, ms: validMs(ms) ?? s.lastMs, t: s.tried + 1, p: s.passed + (ok ? 1 : 0) })); } catch { /* 無痕模式：不記 */ }
}

let inflight = false;
/**
 * 請手機改寫 answer_draft。
 * @param {{ text: string, facts?: object, lang?: 'zh'|'en' }} draft answer_draft 事件
 * @param {{ engine?: string, agent?: string, timeout?: number }} [o]
 * @returns {Promise<{ text: string, by: 'edge'|'program', reason?: 'skip'|'timeout'|'failed'|'check', engine?: string, ms?: number, detail?: string }>}
 */
export async function edgeWrite(draft, { engine, agent = 'life', timeout = WRITE_TIMEOUT_MS } = {}) {
  const text = String(draft?.text ?? '');
  const facts = draft?.facts && typeof draft.facts === 'object' ? draft.facts : {};
  const lang = draft?.lang === 'en' ? 'en' : 'zh';
  const c = cap();
  const program = (reason, extra = {}) => ({ text, by: 'program', reason, ...(engine && { engine }), ...extra });
  if (!c || agent !== 'life') return program('failed');
  if (!worthRewriting(text)) return program('skip');
  if (inflight) return program('timeout'); // 上一題還沒寫完（不排隊）
  inflight = true;
  const t0 = Date.now();
  let timer;
  try {
    const call = c.nativePromise(PLUGIN, 'write', { draft: text, prompt: writePrompt(text, facts, lang), lang, instructions: WRITE_INSTRUCTIONS[lang], maxChars: WRITE_TARGET_CHARS });
    const done = call.finally(() => { inflight = false; });
    const r = await Promise.race([done.catch(() => 'failed'), new Promise((res) => { timer = setTimeout(() => res('timeout'), timeout); })]);
    if (r === 'timeout' || r === 'failed') return program(r);
    const eng = EDGE_ENGINES.includes(r?.engine) ? r.engine : engine;
    const ms = validMs(r?.ms) ?? Date.now() - t0;
    const chk = checkRewrite(r?.text, { draft: text, facts, lang, agent });
    noteEdgeWrite(chk.ok, ms);
    return chk.ok ? { text: chk.text, by: 'edge', engine: eng, ms } : program('check', { engine: eng, ms, detail: chk.reason });
  } catch {
    inflight = false;
    return program('failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 回答上方那一行：照實說這次的回答是誰寫的。
 * @param {{ by: string, reason?: string, engine?: string }} r edgeWrite 的結果
 * @param {'en'|null} lang
 */
export function writeLine(r, lang = null) {
  const en = lang === 'en';
  const name = EDGE_ENGINE_NAME[r?.engine] || (en ? 'the on-phone AI' : '手機上的 AI');
  if (r?.by === 'edge') return en ? `This answer was written on your phone by ${name}.` : `這次的回答由手機上的 ${name} 寫。`;
  const why = {
    check: en ? "the phone's version didn't pass Abang's checks" : '手機寫的沒通過檢查',
    timeout: en ? 'the phone took too long' : '手機寫太久',
    skip: en ? 'lots of numbers, so straight from the data' : '這題數字多，直接照資料說',
    failed: en ? "the phone couldn't write it" : '手機這次沒寫出來',
  }[r?.reason] || (en ? "the phone couldn't write it" : '手機這次沒寫出來');
  return en ? `Abang's standard wording (${why}).` : `用阿幫的固定說法（${why}）。`;
}
