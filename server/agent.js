// POST /api/v1/agent（M5-06，AGENT.md §3、§6）：NDJSON 事件串流；限流與計量以「agent id ＋ IP」為單位（ADR-0007 🧩）。
// 模式（ADR-0012）：pickProvider 依環境變數選 Claude／地端模型／示範；全站每日模型呼叫超過 AGENT_DAILY_BUDGET 時降級示範模式。
// 只給本站網頁使用：不加 CORS（避免其他網站耗用模型預算）。
import { createRateLimiter } from './rate-limit.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
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

export function createAgentHandler({ svc, env = process.env, log = () => {}, provider = pickProvider(env, { defaultModel: getProfile('life').model }), judge = null }) {
  const perMin = createRateLimiter({ limit: Number(env.AGENT_RPM) || 10 });
  const perDay = createRateLimiter({ limit: Number(env.AGENT_RPD) || 100, windowMs: 86_400_000 });
  const budget = Number(env.AGENT_DAILY_BUDGET) || 5000;
  const meter = new Map(); // `${date}|${agentId}` → { requests, toolCalls, modelCalls }

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
    usage: (agentId = 'life') => ({ ...usageOf(agentId), budget }),

    /** 目前的模式（claude／local／demo）與模型名稱 */
    mode: provider ? { mode: provider.mode, model: provider.model } : { mode: 'demo' },

    /**
     * 處理一個請求：先驗證（錯誤丟 UserError，由呼叫端回 400），再以 NDJSON 串流事件。
     * @param {import('node:http').ServerResponse} res
     */
    async handle(res, body, { agentId = 'life' } = {}) {
      validateRequest(body);
      const profile = getProfile(agentId);
      const u = usageOf(profile.id);
      u.requests++;
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const t0 = Date.now();
      let mode = 'demo';
      let tokens = null;
      let failed = null;
      let judgeSrc = null;
      const emit = (e) => {
        if (e.type === 'status' && e.judge) judgeSrc = e.judge.source; // 快速版的來源（完整版有伺服器模型時可能改由模型定案）
        if (e.type === 'tool_start') u.toolCalls++;
        if (e.type === 'done' && e.usage) tokens = { in: e.usage.inputTokens, out: e.usage.outputTokens };
        if (!res.writableEnded) res.write(toNdjson(e));
      };
      try {
        if (provider && u.modelCalls < budget) {
          mode = provider.mode;
          await runModel(svc, body, emit, { provider, profileId: profile.id, judge, now: clock(), onModelCall: () => { u.modelCalls++; } });
        } else {
          await runDemo(svc, body, emit, { profileId: profile.id, judge, now: clock(), ...(provider && { notice: '今天的 AI 額度用完了，先用示範模式回答' }) });
        }
      } catch (e) {
        failed = e?.status ? `${e.name}:${e.status}` : (e?.name || 'Error'); // 只記錯誤類型，不記訊息（可能含上游細節）
        emit(ev.error({ message: publicMessage(e), retryable: !(e?.name === 'UserError') }));
        emit(ev.done());
      } finally {
        res.end();
        // 隱私（AGENT.md §7）：只記模式、事件數量、耗時、token 與判斷來源（embed／llm／device:apple…），不記對話內容與座標；device＝有收到手機判斷（引擎名）
        log({ agent: profile.id, mode, ms: Date.now() - t0, toolCalls: u.toolCalls, modelCalls: u.modelCalls, ...(tokens && { tokens }), ...(judgeSrc && { judge: judgeSrc }), ...(body?.deviceJudge && { device: body.deviceJudge.engine }), ...(failed && { error: failed }) });
      }
    },
  };
}
