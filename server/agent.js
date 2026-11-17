// POST /api/v1/agent（M5-06，AGENT.md §3、§6）：NDJSON 事件串流；限流與計量以「agent id ＋ IP」為單位（ADR-0007 🧩）。
// 目前一律示範模式（runDemo）；Claude 模式（M5-05）上線後依 ANTHROPIC_API_KEY 與每日預算切換。
// 只給本站網頁使用：不加 CORS（避免其他網站耗用模型預算）。
import { createRateLimiter } from './rate-limit.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { ev, toNdjson } from '../core/agent/events.js';
import { getProfile } from '../core/agents/index.js';
import { nowTW, publicMessage } from '../core/util.js';

/**
 * @param {{ svc: object, env?: Record<string, string|undefined>, log?: (o: object) => void }} opts
 */
export function createAgentHandler({ svc, env = process.env, log = () => {} }) {
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
      const emit = (e) => {
        if (e.type === 'tool_start') u.toolCalls++;
        if (!res.writableEnded) res.write(toNdjson(e));
      };
      try {
        await runDemo(svc, body, emit, { profileId: profile.id });
      } catch (e) {
        emit(ev.error({ message: publicMessage(e), retryable: !(e?.name === 'UserError') }));
        emit(ev.done());
      } finally {
        res.end();
        // 隱私（AGENT.md §7）：只記事件數量與耗時，不記對話內容與座標
        log({ agent: profile.id, ms: Date.now() - t0, toolCalls: u.toolCalls });
      }
    },
  };
}
