// 回答也在手機上寫（ADR-0017）：手機 App 的系統模型（Gemini Nano／Apple Intelligence）可用、開關開著時，
// 請求帶 clientCaps.edgeWrite，伺服器不呼叫任何 AI 模型，只查資料、用程式排序，最後送 answer_draft（程式版總結＋事實清單）；
// 這裡請外掛 AbangEdgeAI.write 改寫成自然的一兩句，再用 core/edge-write.js 的程式護欄檢查（數字、時間、ADR-0011…），
// 不過、逾時（2.5 秒）、外掛失敗 → 用程式版總結。網頁版、不支援的手機、開關關掉 → 不帶 clientCaps，行為與原本相同。
import { checkRewrite, worthRewriting, writePrompt, WRITE_INSTRUCTIONS, WRITE_TARGET_CHARS } from '../../core/edge-write.js';
import { edgeEnabled, edgeStatus, EDGE_ENGINES, EDGE_ENGINE_NAME, EDGE_PLUGIN as PLUGIN, edgeCap as cap, edgeTripped, noteEdgeError, cancelSuggest, edgeTasks, edgeCanRun, edgeSoftReason } from './edge-judge.js';

/** 等手機寫最多這麼久（原生端 2.3 秒取消）；超過就用程式版 */
export const WRITE_TIMEOUT_MS = 2500;
const OFF_KEY = 'abang.edgeWrite';
export const WRITE_STATS_KEY = 'abang.edgeWriteStats';
// 外掛存取與斷路器與 edge-judge.js 共用（judge ＞ write ＞ suggest：寫之前先取消正在猜的下一句，寫的時候不猜）

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
export const _resetEdgeWrite = () => { caps = null; if (inflight) edgeTasks.delete(inflight); inflight = null; };

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
/** 記一次手機寫的回答（ok：通過檢查；ms：花多久）。「今天寫了幾次」只算通過檢查、真的用上的 */
export function noteEdgeWrite(ok, ms, now = Date.now()) {
  const s = edgeWriteStats(now);
  try { globalThis.localStorage?.setItem(WRITE_STATS_KEY, JSON.stringify({ d: dayKey(now), n: s.today + (ok ? 1 : 0), ms: validMs(ms) ?? s.lastMs, t: s.tried + 1, p: s.passed + (ok ? 1 : 0) })); } catch { /* 無痕模式：不記 */ }
}

/** 逾時後原生端可能還在跑：最多再等這麼久就當它結束（避免外掛沒回應時之後每一題都說「還在寫上一題」） */
export const INFLIGHT_RELEASE_MS = 5000;
let inflight = null; // 正在寫的那一次（物件當記號；強制清掉時只清自己那一次）
/**
 * 請手機改寫 answer_draft。
 * @param {{ text: string, facts?: object, lang?: 'zh'|'en' }} draft answer_draft 事件
 * @param {{ engine?: string, agent?: string, timeout?: number, release?: number }} [o]
 * @returns {Promise<{ text: string, by: 'edge'|'program', reason?: 'skip'|'timeout'|'busy'|'failed'|'check'|'hidden'|'background'|'battery-quota', engine?: string, ms?: number, detail?: string, candidate?: string }>}
 *   hidden：App 不在前景，沒有呼叫；background／battery-quota：系統暫時不讓用（不跳斷路器）
 */
export async function edgeWrite(draft, { engine, agent = 'life', timeout = WRITE_TIMEOUT_MS, release = INFLIGHT_RELEASE_MS } = {}) {
  const text = String(draft?.text ?? '');
  const facts = draft?.facts && typeof draft.facts === 'object' ? draft.facts : {};
  const lang = draft?.lang === 'en' ? 'en' : 'zh';
  const c = cap();
  const program = (reason, extra = {}) => ({ text, by: 'program', reason, ...(engine && { engine }), ...extra });
  if (!c || agent !== 'life' || edgeTripped()) return program('failed');
  if (!worthRewriting(text)) return program('skip');
  if (!edgeCanRun()) return program('hidden'); // App 不在前景：系統會拒絕，直接用程式版
  if (inflight) return program('busy'); // 上一題還沒寫完（不排隊）
  const me = {};
  inflight = me;
  edgeTasks.add(me); // 寫的時候不猜下一句
  const free = () => { edgeTasks.delete(me); if (inflight === me) inflight = null; };
  cancelSuggest(); // 正在猜下一句：先取消，模型讓給回答
  const t0 = Date.now();
  let timer;
  try {
    const call = c.nativePromise(PLUGIN, 'write', { draft: text, prompt: writePrompt(text, facts, lang), lang, instructions: WRITE_INSTRUCTIONS[lang], maxChars: WRITE_TARGET_CHARS });
    const done = call.finally(free);
    const r = await Promise.race([done.catch((e) => { noteEdgeError(e?.message); return edgeSoftReason(e?.message) || 'failed'; }), new Promise((res) => { timer = setTimeout(() => res('timeout'), timeout); })]);
    if (r === 'timeout') { setTimeout(free, release); return program('timeout'); }
    if (r === 'failed' || r === 'background' || r === 'battery-quota') return program(r);
    const eng = EDGE_ENGINES.includes(r?.engine) ? r.engine : engine;
    const ms = validMs(r?.ms) ?? Date.now() - t0;
    const chk = checkRewrite(r?.text, { draft: text, facts, lang, agent });
    noteEdgeWrite(chk.ok, ms);
    return chk.ok ? { text: chk.text, by: 'edge', engine: eng, ms } : program('check', { engine: eng, ms, detail: chk.reason, ...(chk.detail && { why: String(chk.detail).slice(0, 60) }), candidate: String(r?.text ?? '').slice(0, 400) }); // candidate：沒通過的改寫（只給「阿幫的腦袋」試判斷看，回答不用它）
  } catch {
    free();
    return program('failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 回答上方那一行（一輪只一行）：照實說手機上的 AI 這一輪做了什麼——聽懂問題（伺服器採用了手機的判斷）、寫了回答，或回答改用固定說法。
 * @param {{ by: string, reason?: string, engine?: string }} r edgeWrite 的結果
 * @param {'en'|null} lang
 * @param {{ judged?: boolean, judgeEngine?: string }} [o] judged：這一輪伺服器採用了手機的判斷（status.judge.source === 'device'）
 */
export function writeLine(r, lang = null, { judged = false, judgeEngine } = {}) {
  const en = lang === 'en';
  const name = EDGE_ENGINE_NAME[r?.engine] || EDGE_ENGINE_NAME[judgeEngine] || (en ? 'the AI' : 'AI');
  if (r?.by === 'edge') {
    if (judged) return en ? `${name} on your phone understood your question and wrote this answer.` : `手機上的 ${name} 聽懂你的問題，也寫了這次的回答。`;
    return en ? `This answer was written on your phone by ${name}.` : `這次的回答由手機上的 ${name} 寫。`;
  }
  const why = {
    check: en ? "didn't pass the checks" : '沒通過檢查',
    timeout: en ? 'timed out' : '逾時',
    busy: en ? 'the phone was still writing the last one' : '手機還在寫上一題',
    skip: en ? 'lots of numbers, straight from the data' : '數字多，直接照資料說',
    failed: en ? "the phone couldn't write it" : '手機沒寫出來',
    hidden: en ? 'the app was in the background' : 'App 不在前景',
    background: en ? 'the system blocks AI while the app is in the background' : 'App 在背景時系統不讓 AI 跑',
    'battery-quota': en ? "the system paused the phone's AI to save battery" : '系統為了省電暫停手機上的 AI',
  }[r?.reason] || (en ? "the phone couldn't write it" : '手機沒寫出來');
  if (judged) return en ? `${name} on your phone understood your question; the answer uses Abang's standard wording (${why}).` : `手機上的 ${name} 聽懂你的問題；回答用阿幫的固定說法（${why}）。`;
  return en ? `This answer uses Abang's standard wording (${why}).` : `這次的回答用阿幫的固定說法（${why}）。`;
}

/** 頁底的模式說明（照實：手機寫的沒用上時不說「回答在手機上寫」） */
export function writeModeText(r) {
  return r?.by === 'edge' ? '回答在手機上寫；伺服器只查資料、用程式排序，不經伺服器的 AI 模型。' : '這次的回答用阿幫的固定說法（程式照資料寫的）；伺服器只查資料、用程式排序，不經伺服器的 AI 模型。';
}
