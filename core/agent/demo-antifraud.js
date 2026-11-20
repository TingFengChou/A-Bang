// 防詐示範意圖（M7-05，AGENT_ANTIFRAUD.md §6）：規則式判斷要用哪個工具，事件流與模型模式相同。
import { extractUrls, NOT_SAFE_NOTE } from '../scam-check.js';
import { isEnglish } from './demo-intent.js';

const SENDER = /(\+\d[\d\s-]{0,16}\d|\b0\d[\d-]{7,11}\d\b|\b1\d{2}\b|\b\d{4,6}\b)/;

/** 使用者這句話要查什麼：sender（簡訊號碼）、url（只有網址）、myth（是真的嗎）、message（其他一律當可疑內容檢查） */
export function parseAntifraud(text) {
  const s = String(text ?? '').trim();
  const urls = extractUrls(s);
  // 英文訊息：規則庫只認中文，不能說「沒有發現」給錯誤的安心（網址仍可比對 165 清單）
  if (isEnglish(s.replace(/https?:\/\/\S+/g, '')) && !urls.length) return { intent: 'english', text: s };
  const rest = urls.reduce((t, u) => t.replace(u, ''), s).replace(/這個?|網址|網站|連結|安全嗎|可以[點開]嗎|是真的嗎|[？?。，,:：\s]/g, '');
  if (urls.length && rest.length <= 6) return { intent: 'url', urls: urls.slice(0, 3), text: s };
  const num = s.match(SENDER);
  if (num && /(簡訊|號碼|寄來|傳來|發來|來電|打來)/.test(s) && s.length <= 40) return { intent: 'sender', sender: num[1].trim(), text: s };
  if (!urls.length && /(是真的嗎|真的假的|闢謠|有這回事|聽說)/.test(s) && s.length <= 40) {
    return { intent: 'myth', query: s.replace(/(是真的嗎|真的假的|闢謠|有這回事嗎?|聽說|[？?。，,\s])/g, '') || s, text: s };
  }
  return { intent: 'message', text: s };
}

/** 單段計畫（同一段平行呼叫） */
export function antifraudSteps(it) {
  const step = {
    url: { note: '@網址 我拿網域去比對 165 停止解析的涉詐網站清單', calls: (it.urls || []).map((url) => ({ name: 'scam_lookup_url', args: { url } })) },
    sender: { note: '@號碼 我看看這個寄件號碼是哪一種', calls: [{ name: 'sms_sender_check', args: { sender: it.sender } }] },
    myth: { note: '@闢謠 我去 165 闢謠專區找找看', calls: [{ name: 'scam_myth_search', args: { query: it.query } }] },
    message: { note: '@防詐 我比對 165 常見詐騙手法，也查裡面的網址', calls: [{ name: 'scam_check_message', args: { text: it.text.slice(0, 2000) } }] },
  }[it.intent];
  return step ? [() => step] : [];
}

/** 示範總結：以工具結果為準，不保證安全（輸出護欄會再檢查一次） */
export function antifraudSummary(it, results) {
  if (it.intent === 'english') return "I can only check Chinese messages for now. If you're unsure, don't transfer money or share codes, and call 165 (Taiwan's anti-fraud hotline).";
  const r = (name) => results[name]?.map((x) => x.data) || [];
  if (it.intent === 'message') {
    const d = r('scam_check_message')[0];
    if (!d) return '這次沒查成功，請稍後再試；有疑問請直接撥 165。';
    const top = d.findings.slice(0, 2).map((f) => f.label).join('、');
    if (d.level === 'high') return `先不要照做。${d.urls.some((u) => u.listed) ? '裡面的網址已被 165 列為涉詐網站。' : `這則內容有「${top}」等詐騙常見特徵。`}${d.advice[0]}`;
    if (d.level === 'medium') return `這則內容有疑點（${top}），先向官方或 165 查證再行動。${d.advice[0]}`;
    return NOT_SAFE_NOTE;
  }
  if (it.intent === 'url') {
    const hits = r('scam_lookup_url').filter((d) => d.listed);
    return hits.length ? `先不要開：${hits.map((d) => d.domain).join('、')} 已被 165 列為涉詐網站並停止解析。` : `比對過了，不在 165 停止解析清單上；${NOT_SAFE_NOTE}不要在陌生網站輸入帳號密碼或驗證碼。`;
  }
  if (it.intent === 'sender') {
    const d = r('sms_sender_check')[0];
    return d ? `${d.kind}：${d.note}也可以把簡訊內容貼給我，我幫你看可疑之處。` : '這次沒查成功。';
  }
  const m = r('scam_myth_search')[0];
  return m?.results.length ? `165 有相關闢謠：「${m.results[0].title}」（${m.results[0].date}）。重點：${m.results[0].summary}` : '165 闢謠專區沒有找到相關文章；可以把你收到的內容貼給我，我幫你比對。';
}
