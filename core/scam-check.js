// 可疑訊息分析（M7-03，AGENT_ANTIFRAUD.md §3–§4）：規則庫比對＋網址查 165 停止解析清單 → 風險等級與下一步。
// 純比對、不開啟連結、不保存內容。風險低時只說「沒有發現已知的詐騙特徵」，不說安全（L2 護欄）。
import RULES from './data/scam-rules.json' with { type: 'json' };

export const RULES_VERSION = RULES.version;
export const RULES_REVIEWED = RULES.reviewedBy !== '待審核';
import { CALL_165 } from './output-guards.js'; // 固定句只定義一次（輸出護欄也用）
export { CALL_165 };
export const NOT_SAFE_NOTE = '沒有發現已知的詐騙特徵，但不代表一定安全。';

const COMPILED = RULES.rules.map((r) => ({ ...r, re: r.patterns.map((p) => new RegExp(p, 'i')), exceptRe: (r.except || []).map((p) => new RegExp(p, 'i')) }));
/** 同一條規則命中多個不重疊的特徵時，最多再加幾次 stack 權重（AGENT_ANTIFRAUD.md §4） */
export const MAX_STACK = 2;
/** 宣導、新聞語境不疊加（「新聞：檢察官起訴涉嫌洗錢」不是對你說的話術） */
const STACK_OFF = new RegExp(RULES.stackOff || '(?!)');
/** except 只排除短的、沒有其他請求的正常通知（「驗證碼是 123456，請勿告訴任何人，你告訴我一下」不排除） */
const EXCEPT_OFF = new RegExp(RULES.exceptOff || '(?!)');
const EXCEPT_MAX = RULES.exceptMaxLength || 80;

/** 不重疊的命中片段數（「穩賺」「穩賺不賠」同一處只算一次） */
function distinctHits(spans) {
  let n = 0;
  let end = -1;
  for (const sp of [...spans].sort((a, b) => a.i - b.i || b.len - a.len)) {
    if (sp.i < end) continue;
    n++;
    end = sp.i + sp.len;
  }
  return n;
}

/** 從文字找出網址與網域（含沒有 http 的 xxx.com/abc）；最多 10 個 */
export function extractUrls(text) {
  const s = String(text ?? '');
  const re = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?::\d+)?(?:\/[^\s，。！？、「」（）<>"']*)?/gi;
  const out = [];
  for (const m of s.matchAll(re)) {
    const u = m[0].replace(/[.,;:!?)]+$/, '');
    if (/^\d+(\.\d+)+$/.test(u)) continue; // 純數字（金額、版本）
    if (!/[a-z]/i.test(u.split('/')[0].replace(/^https?:\/\//i, '').split('.').pop())) continue;
    if (!out.includes(u)) out.push(u);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * 規則比對：每條規則一筆結果，附上第一個命中的原文片段（前後各 8 字）。
 * 規則有 stack 時，另外命中的不重疊特徵每個再加 stack 權重（最多 MAX_STACK 個；例：假檢警同時說「涉嫌洗錢」「轉接檢察官」）；宣導、新聞語境（stackOff）不疊加。
 * 規則有 except 且符合時整條不算（例：「驗證碼是 123456，請勿告訴任何人」是正常的驗證碼通知）；內容太長或另有請求（exceptOff）時不排除。
 */
export function matchRules(text) {
  const s = String(text ?? '');
  const findings = [];
  const canExcept = s.length <= EXCEPT_MAX && !EXCEPT_OFF.test(s);
  const canStack = !STACK_OFF.test(s);
  for (const r of COMPILED) {
    if (canExcept && r.exceptRe.some((re) => re.test(s))) continue;
    const spans = [];
    for (const re of r.re) {
      const m = s.match(re);
      if (m) spans.push({ i: m.index ?? 0, len: m[0].length, m: m[0] });
    }
    if (!spans.length) continue;
    const { i, m } = spans[0];
    const excerpt = `${i > 8 ? '…' : ''}${s.slice(Math.max(0, i - 8), i + m.length + 8).replace(/\s+/g, ' ')}${i + m.length + 8 < s.length ? '…' : ''}`;
    const extra = r.stack && canStack ? Math.min(distinctHits(spans) - 1, MAX_STACK) * r.stack : 0;
    findings.push({ id: r.id, category: r.category, label: r.label, weight: r.weight + extra, match: m, excerpt, advice: r.advice });
  }
  return findings.sort((a, b) => b.weight - a.weight);
}

/** 風險等級：網址在停止解析清單 → high；否則權重加總 ≥ 6 → high、≥ 3 → medium */
export function riskLevel(score, listed) {
  if (listed || score >= 6) return 'high';
  return score >= 3 ? 'medium' : 'low';
}

/**
 * @param {{ antifraud: object }} svc
 * @param {string} text 使用者貼上的內容（不保存）
 */
export async function checkMessage(svc, text) {
  const findings = matchRules(text);
  const urls = await Promise.all(extractUrls(text).map(async (u) => {
    const r = await svc.antifraud.lookupUrl(u);
    const hit = r.matches[0];
    return { input: u, domain: r.domain, listed: r.listed, ...(hit && { category: hit.category, month: hit.month }) };
  }));
  const listed = urls.some((u) => u.listed);
  const score = findings.reduce((n, f) => n + f.weight, 0);
  const level = riskLevel(score, listed);
  const advice = [
    ...(listed ? ['這個網址已被 165 列為涉詐網站並停止解析，不要開啟，也不要輸入任何資料。'] : []),
    ...[...new Set(findings.map((f) => f.advice))].slice(0, 3),
    ...(level === 'low' ? [NOT_SAFE_NOTE] : []),
    CALL_165,
  ];
  const topic = findings.slice(0, 2).map((f) => f.category).join(' ');
  const myths = topic ? (await svc.antifraud.searchMyths(topic, 2)).map(({ id, title, date }) => ({ id, title, date })) : [];
  return {
    level, score,
    findings: findings.map(({ id, category, label, excerpt }) => ({ id, category, label, excerpt })),
    urls, advice, myths, rulesVersion: RULES_VERSION, reviewed: RULES_REVIEWED,
  };
}

/**
 * 簡訊寄件者（AGENT_ANTIFRAUD.md §3）：只看號碼格式，內容仍要另外判斷。
 * @returns {{ sender: string, kind: string, risk: 'high'|'medium'|'low', note: string }}
 */
export function checkSender(sender) {
  const raw = String(sender ?? '').trim();
  const s = raw.replace(/[\s()-]/g, '');
  const r = (kind, risk, note) => ({ sender: raw, kind, risk, note });
  if (s === '111') return r('政府機關簡訊短碼', 'low', '111 是政府機關專用的簡訊短碼；但仍不要在簡訊連結裡輸入密碼或驗證碼。');
  if (/^\+/.test(s) && !/^\+886/.test(s)) return r('國際號碼', 'high', '國際號碼冒充台灣機關、銀行或物流的簡訊，多半是詐騙。');
  if (/^(\+886|0)9\d{8}$/.test(s)) return r('個人手機號碼', 'medium', '機關、銀行、物流通常不會用個人手機號碼發通知；有連結或要你付款就要提高警覺。');
  if (/^\d{3,6}$/.test(s)) return r('企業簡訊短碼', 'low', '短碼多為企業簡訊，但詐騙也可能偽裝；不要點陌生連結，有疑問打官方客服或 165。');
  if (/^(\+886|0)80[09]\d{6}$/.test(s)) return r('免付費電話', 'medium', '0800／0809 開頭是免付費電話，企業客服常用，但號碼可以偽造；請用官方網站公布的電話回撥查證。');
  if (/^(\+886|0)[2-8]\d{7,8}$/.test(s)) return r('市話號碼', 'medium', '用市話號碼發簡訊並不常見；請用官方公布的電話回撥查證。');
  if (/[a-z一-鿿]/i.test(s)) return r('文字名稱', 'medium', '顯示名稱可以被偽造，不能用來判斷真假；請看內容並向官方查證。');
  return r('無法判斷', 'medium', '看不出號碼類型；請不要點連結，向官方或 165 查證。');
}
