// POST /api/v1/agent（M5-06，AGENT.md §3、§6）：NDJSON 事件串流；限流與計量以「agent id ＋ IP」為單位（ADR-0007 🧩）。
// 模式（ADR-0012）：pickProvider 依環境變數選 Claude／地端模型／示範；全站每日模型呼叫超過 AGENT_DAILY_BUDGET 時降級示範模式。
// 只給本站網頁使用：不加 CORS（避免其他網站耗用模型預算）。
import { createRateLimiter } from './rate-limit.js';
import { runDemo, validateRequest, wantsEdgeWrite } from '../core/agent/run.js';
import { runModel, isModelError } from '../core/agent/model-loop.js';
import { pickProvider } from '../core/agent/provider.js';
import { ev, toNdjson } from '../core/agent/events.js';
import { getProfile } from '../core/agents/index.js';
import { nowTW, publicMessage } from '../core/util.js';

/**
 * @param {{ svc: object, env?: Record<string, string|undefined>, log?: (o: object) => void,
 *   provider?: import('../core/agent/model-loop.js').Provider|null, judge?: Function|null }} opts provider：測試注入；未給時依 env 決定；judge：判斷層（core/agent/judge.js judgeFromEnv）
 */
/**
 * 示範時鐘（只在示範模式有效）：DEMO_CLOCK=HH:mm 把「現在」固定在今天這個台灣時間（E2E 與展示用，例：23:30 看末班車提醒）。
 * 有真實資料時一律用真的時間。
 */
export function demoClock(env = process.env) {
  const m = env.DEMO_MODE === '1' && /^([01]\d|2[0-3]):[0-5]\d$/.exec(env.DEMO_CLOCK || '');
  if (!m) return () => Date.now();
  return () => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T${env.DEMO_CLOCK}:00+08:00`);
}

/** 這一輪被中止（使用者斷線、或超過整輪上限）：不是錯誤，不再送事件 */
export class TurnAborted extends Error { constructor(why) { super(why); this.name = 'TurnAborted'; } }
/** 整輪超過上限時給使用者看的話 */
export const TURN_TIMEOUT_MSG = '這一題查太久了，先停下來；可以換個說法，或把問題拆小一點再問（例如先問怎麼去、再問天氣）。';

/** 模型出錯時給使用者看的話（不怪資料來源；細節只在伺服器 log 記錯誤類型） */
export const MODEL_ERROR_MSG = '阿幫這次沒想出來（AI 模型沒有回應）；可以再問一次，或換個說法。';
/** 防詐改用規則回答時，討論串先說明 */
export const MODEL_DOWN_NOTE = 'AI 模型暫時無法使用，這次先用規則比對 165 資料回答';

export function createAgentHandler({ svc, env = process.env, log = () => {}, provider = pickProvider(env, { defaultModel: getProfile('life').model }), judge = null }) {
  const perMin = createRateLimiter({ limit: Number(env.AGENT_RPM) || 10 });
  const perDay = createRateLimiter({ limit: Number(env.AGENT_RPD) || 100, windowMs: 86_400_000 });
  const budget = Number(env.AGENT_DAILY_BUDGET) || 5000;
  const turnMs = Number(env.AGENT_TURN_MS) || 60_000; // 一輪最多跑多久（架構第二輪 #1）
  const meter = new Map(); // `${date}|${agentId}` → { requests, toolCalls, modelCalls }；`${date}|*` 是全站（每日模型額度看全站，架構第三輪 #2）

  const usageOf = (agentId, date = nowTW().date) => {
    const k = `${date}|${agentId}`;
    if (!meter.has(k)) {
      for (const key of meter.keys()) if (!key.startsWith(`${date}|`)) meter.delete(key); // 只留今天
      meter.set(k, { requests: 0, toolCalls: 0, modelCalls: 0 });
    }
    return meter.get(k);
  };

  const clock = demoClock(env);
  if (env.DEMO_CLOCK) log({ message: env.DEMO_MODE === '1' ? `示範時鐘：現在固定為今天 ${env.DEMO_CLOCK}` : 'DEMO_CLOCK 只在 DEMO_MODE=1 有效，已忽略', level: 'warn' }); // 避免公開站誤留設定
  return {
    /** 限流：每分鐘、每日（agent id ＋ IP）。回傳 { ok, retryAfterSec } */
    limit(agentId, ip) {
      for (const [lim, scope] of [[perMin, 'm'], [perDay, 'd']]) {
        const r = lim(`agent:${agentId}:${scope}:${ip}`);
        if (!r.ok) return { ok: false, retryAfterSec: r.retryAfterSec, limit: r.limit };
      }
      return { ok: true };
    },

    /** 今天的計量（測試與 /api/v1/status 用） */
    usage: (agentId = 'life') => ({ ...usageOf(agentId), budget, siteModelCalls: usageOf('*').modelCalls }),

    /** 目前的模式（claude／local／demo）與模型名稱 */
    mode: provider ? { mode: provider.mode, model: provider.model } : { mode: 'demo' },

    /**
     * 處理一個請求：先驗證（錯誤丟 UserError，由呼叫端回 400），再以 NDJSON 串流事件。
     * @param {import('node:http').ServerResponse} res
     */
    async handle(res, body, { agentId = 'life' } = {}) {
      const req = validateRequest(body);
      const profile = getProfile(agentId);
      const edgeWrite = wantsEdgeWrite(req, profile.id); // 手機自己寫回答（ADR-0017）：伺服器不呼叫模型
      const u = usageOf(profile.id);
      const site = usageOf('*'); // 全站：生活、防詐共用同一份每日模型額度（AGENT.md「全站每日」）
      u.requests++;
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const t0 = Date.now();
      let mode = 'demo';
      let tokens = null;
      let failed = null;
      let judgeSrc = null;
      let askSrc = null, askChk = null; // 這一輪的題目由誰出（device／rule）、手機提議的題目用了沒（ADR-0020；只記種類與原因代碼，不記題目文字）
      const sent = { tools: 0, text: false, done: false }; // 模型出錯時判斷能不能改用規則重答（還沒查資料、還沒回答）
      // 架構第二輪 #1：使用者斷線或整輪超過 TURN_MS 就中止——之後送任何事件都丟 TurnAborted，下一個工具、下一次模型呼叫就不會開始
      const ac = new AbortController();
      const onClose = () => { if (!res.writableEnded) ac.abort(new TurnAborted('client closed')); };
      res.on?.('close', onClose);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (!res.writableEnded) { res.write(toNdjson(ev.error({ message: TURN_TIMEOUT_MSG, retryable: true }))); res.write(toNdjson(ev.done())); }
        ac.abort(new TurnAborted('timeout'));
      }, turnMs);
      timer.unref?.();
      const emit = (e) => {
        if (ac.signal.aborted) throw ac.signal.reason;
        if (e.type === 'tool_start') sent.tools++;
        if (e.type === 'text') sent.text = true;
        if (e.type === 'done') sent.done = true;
        if (e.type === 'ask') askSrc = e.askSource;
        if (e.type === 'done' && e.askCheck) askChk = e.askCheck.verdict === 'used' ? 'used' : `rejected:${e.askCheck.reason}`;
        if (e.type === 'status' && e.judge) judgeSrc = e.judge.source; // 快速版的來源（完整版有伺服器模型時可能改由模型定案）
        if (e.type === 'tool_start') u.toolCalls++;
        if (e.type === 'done' && e.usage) tokens = { in: e.usage.inputTokens, out: e.usage.outputTokens };
        if (!res.writableEnded) res.write(toNdjson(e));
      };
      try {
        if (edgeWrite) {
          mode = 'edge';
          await runDemo(svc, body, emit, { profileId: profile.id, judge, now: clock(), mode: 'edge' });
        } else if (provider && site.modelCalls < budget) {
          mode = provider.mode;
          await runModel(svc, body, emit, { provider, profileId: profile.id, judge, now: clock(), onModelCall: () => { u.modelCalls++; site.modelCalls++; } });
        } else {
          await runDemo(svc, body, emit, { profileId: profile.id, judge, now: clock(), ...(provider && { notice: '今天的 AI 額度用完了，先用示範模式回答' }) });
        }
      } catch (e) {
        if (e instanceof TurnAborted) { failed = timedOut ? 'TurnTimeout' : 'ClientClosed'; return; } // 已經送過結束（逾時）或沒人收了（斷線）
        failed = e?.status ? `${e.name}:${e.status}` : (e?.name || 'Error'); // 只記錯誤類型，不記訊息（可能含上游細節）
        // 防詐：模型暫時不能用（逾時、過載、連不上）時，這一輪改用規則比對回答（與示範模式同一套規則，資料照常是真的）；
        // 已經查過資料或回答了就不重來（避免卡片出現兩次），照實說模型暫時無法回應
        const rescue = isModelError(e) && profile.id === 'antifraud' && !sent.tools && !sent.text && !sent.done;
        if (rescue) {
          try {
            mode = 'rules-fallback';
            const noStatus = (x) => { if (x.type !== 'status') emit(x); }; // 這一輪已經送過 status
            await runDemo(svc, body, noStatus, { profileId: profile.id, judge, now: clock(), mode: 'rules', notice: MODEL_DOWN_NOTE, noticeEn: 'The AI model is unavailable right now; checking with rules instead' });
            return;
          } catch (e2) {
            failed = `${failed}+${e2?.name || 'Error'}`;
            if (sent.done) return;
          }
        }
        const msg = isModelError(e) ? (profile.id === 'antifraud' ? `${MODEL_ERROR_MSG}有疑問請直接撥 165 反詐騙諮詢專線。` : MODEL_ERROR_MSG) : publicMessage(e);
        emit(ev.error({ message: msg, retryable: !(e?.name === 'UserError') }));
        emit(ev.done());
      } finally {
        clearTimeout(timer);
        res.off?.('close', onClose);
        res.end();
        // 隱私（AGENT.md §7）：只記模式、事件數量、耗時、token 與判斷來源（embed／llm／device:apple…），不記對話內容與座標；device＝有收到手機判斷（引擎名）
        log({ agent: profile.id, mode, ms: Date.now() - t0, toolCalls: u.toolCalls, modelCalls: u.modelCalls, ...(tokens && { tokens }), ...(judgeSrc && { judge: judgeSrc }), ...(body?.deviceJudge && { device: body.deviceJudge.engine }), ...(askSrc && { ask: askSrc }), ...(askChk && { deviceAsk: askChk }), ...(edgeWrite && req.clientCaps?.trial && { trial: true }), ...(failed && { error: failed }) }); // trial：#/ai 的試判斷（只記有這件事，不記句子）
      }
    },
  };
}
