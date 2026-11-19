// 可疑訊息分析（M7-03，AGENT_ANTIFRAUD.md §3–§4）：規則庫比對＋網址查 165 停止解析清單 → 風險等級與下一步。
// 純比對、不開啟連結、不保存內容。風險低時只說「沒有發現已知的詐騙特徵」，不說安全（L2 護欄）。
import RULES from './data/scam-rules.json' with { type: 'json' };

export const RULES_VERSION = RULES.version;
export const RULES_REVIEWED = RULES.reviewedBy !== '待審核';
export const CALL_165 = '有疑問請撥打 165 反詐騙諮詢專線（免付費）查證。';
export const NOT_SAFE_NOTE = '沒有發現已知的詐騙特徵，但不代表一定安全。';

const COMPILED = RULES.rules.map((r) => ({ ...r, re: r.patterns.map((p) => new RegExp(p, 'i')) }));

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

/** 規則比對：每條規則最多算一次，附上命中的原文片段（前後各 8 字） */
export function matchRules(text) {
  const s = String(text ?? '');
  const findings = [];
  for (const r of COMPILED) {
    for (const re of r.re) {
      const m = s.match(re);
      if (!m) continue;
      const i = m.index ?? 0;
      const excerpt = `${i > 8 ? '…' : ''}${s.slice(Math.max(0, i - 8), i + m[0].length + 8).replace(/\s+/g, ' ')}${i + m[0].length + 8 < s.length ? '…' : ''}`;
      findings.push({ id: r.id, category: r.category, label: r.label, weight: r.weight, match: m[0], excerpt, advice: r.advice });
      break;
    }
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
  if (/^(\+886|0)[2-8]\d{7,8}$/.test(s)) return r('市話號碼', 'medium', '用市話號碼發簡訊並不常見；請用官方公布的電話回撥查證。');
  if (/[a-z一-鿿]/i.test(s)) return r('文字名稱', 'medium', '顯示名稱可以被偽造，不能用來判斷真假；請看內容並向官方查證。');
  return r('無法判斷', 'medium', '看不出號碼類型；請不要點連結，向官方或 165 查證。');
}
