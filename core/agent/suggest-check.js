// 動態「下一句」建議的驗證（POST /api/v1/suggest/check）：手機上的 AI 猜的句子，阿幫查不查得到。
// 只收候選句子（不收情境、不收座標），用與示範模式相同的規則 parseIntent 解析；不呼叫任何模型、不查資料。
import { parseIntent } from './demo-intent.js';
import { answerable, slimAsk } from '../suggest.js';
import { UserError } from '../util.js';

export const CHECK_MAX = 8;
export const CHECK_LEN = 60;

/**
 * @param {unknown} asks 候選句子（最多 8 句，每句最多 60 字）
 * @returns {Array<{ q: string, ok: boolean, needSaved?: string, ask?: object }>} ok：查得到；needSaved：要用到這個常用地點（手機有設定才算查得到）
 */
export function checkAsks(asks) {
  if (!Array.isArray(asks) || !asks.length || asks.length > CHECK_MAX) throw new UserError(`asks 要是 1～${CHECK_MAX} 句的陣列`);
  return asks.map((raw) => {
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (!q || q.length > CHECK_LEN) return { q: q.slice(0, CHECK_LEN), ok: false };
    let it;
    try { it = parseIntent(q, {}); } catch { return { q, ok: false }; }
    if (it?.intent === 'savedMissing' && it.missing) return { q, ok: false, needSaved: it.missing, ask: { intent: 'trip', to: it.missing, ...(/從/.test(q) && it.places?.[0] && { from: it.places[0] }), states: it.states || [] } };
    return answerable(it) ? { q, ok: true, ask: slimAsk(it) } : { q, ok: false };
  });
}
