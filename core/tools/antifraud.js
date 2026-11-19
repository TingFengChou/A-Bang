// 工具包：antifraud（防詐，M7）— 風險分級 L2（給判斷建議，不得保證安全；PLATFORM.md）
import { z } from 'zod';
import { defineTool } from './define.js';
import { checkMessage, checkSender, CALL_165, NOT_SAFE_NOTE } from '../scam-check.js';

const PACK = 'antifraud';
const SOURCE = '內政部警政署 165 反詐騙諮詢專線（政府開放資料）、阿幫詐騙特徵規則庫';
const DEMO = '【示範資料：165 開放資料的部分內容，非完整清單】';
const LEVEL = { high: '高風險', medium: '有疑點', low: '未發現已知特徵' };
const modeOf = (svc) => svc.antifraudMode;

export const scamCheckMessage = defineTool({
  name: 'scam_check_message',
  title: '可疑訊息檢查',
  description: '檢查使用者貼上的簡訊、LINE 訊息、Email 或來電內容：比對 165 常見詐騙手法規則，並把裡面的網址拿去查 165 停止解析涉詐網站清單（只比對網域、不開啟）。回傳 level（high／medium／low）、可疑字句、網址比對、下一步建議與相關闢謠。low 只代表沒有發現已知特徵，不能說安全。',
  pack: PACK, tier: 'L2', card: 'scam-risk', source: SOURCE, demoNote: DEMO, modeOf,
  input: { text: z.string().trim().min(2).max(2000).describe('使用者收到的可疑內容（原文）') },
  speak: (d) => {
    const n = d.findings.length;
    const bad = d.urls.filter((u) => u.listed).length;
    if (d.level === 'high') return `${LEVEL.high}：${bad ? `有 ${bad} 個網址在 165 涉詐清單上` : `符合 ${n} 個詐騙特徵`}，先不要照做。`;
    if (d.level === 'medium') return `有疑點：符合 ${n} 個常見詐騙特徵，建議先查證。`;
    return '沒有發現已知的詐騙特徵，但不代表一定安全。';
  },
  async run(svc, a) {
    const data = await checkMessage(svc, a.text);
    const lines = [
      `風險：${LEVEL[data.level]}（規則分數 ${data.score}；規則庫 ${data.rulesVersion}${data.reviewed ? '' : '，尚未經專家審核'}）`,
      ...data.findings.map((f) => `- ${f.category}：${f.label}（「${f.excerpt}」）`),
      ...data.urls.map((u) => `- 網址 ${u.domain || u.input}：${u.listed ? `已被 165 停止解析（${u.category}，${u.month}）` : '不在 165 停止解析清單（不代表安全）'}`),
      '建議：', ...data.advice.map((x) => `- ${x}`),
      ...(data.myths.length ? ['相關闢謠：', ...data.myths.map((m) => `- ${m.title}（${m.date}）`)] : []),
    ];
    return { data, text: lines.join('\n') };
  },
});

export const scamLookupUrl = defineTool({
  name: 'scam_lookup_url',
  title: '涉詐網址查詢',
  description: '查網址或網域是否在 165「遭停止解析涉詐網站」清單（含上層網域）。只比對網域、不開啟網址。不在清單上不代表安全。',
  pack: PACK, tier: 'L2', source: SOURCE, demoNote: DEMO, modeOf,
  input: { url: z.string().trim().min(3).max(500).describe('網址或網域，例如 https://example.com/login') },
  speak: (d) => (!d.domain ? '這看起來不是網址。' : d.listed ? `${d.domain} 已被 165 列為涉詐網站，不要開啟。` : `${d.domain} 不在 165 涉詐清單上，但不代表安全。`),
  async run(svc, a) {
    const data = await svc.antifraud.lookupUrl(a.url);
    const text = !data.domain
      ? `「${a.url}」看起來不是網址或網域。`
      : data.listed
        ? [`${data.domain}：已被 165 停止解析（涉詐網站）。不要開啟、不要輸入任何資料。`, ...data.matches.map((m) => `- ${m.domain}｜${m.category}｜${m.month}｜${m.basis}`), CALL_165].join('\n')
        : `${data.domain}：不在 165 停止解析清單上。${NOT_SAFE_NOTE}${CALL_165}`;
    return { data, text };
  },
});

export const scamMythSearch = defineTool({
  name: 'scam_myth_search',
  title: '詐騙闢謠查詢',
  description: '搜尋 165 詐騙闢謠專區的文章（例如「解除分期付款」「假冒台電」「LINE 投資群組」），回傳標題、日期與摘要。',
  pack: PACK, tier: 'L1', source: SOURCE, demoNote: DEMO, modeOf,
  input: { query: z.string().trim().min(2).max(100).describe('關鍵字') },
  speak: (d) => (d.results.length ? `165 有 ${d.results.length} 篇相關闢謠，最相關：「${d.results[0].title}」。` : '165 闢謠專區沒有找到相關文章。'),
  async run(svc, a) {
    const results = await svc.antifraud.searchMyths(a.query, 5);
    const data = { query: a.query, results };
    const text = results.length ? results.map((r) => `- ${r.title}（${r.date}）：${r.summary}`).join('\n') : `165 闢謠專區沒有找到「${a.query}」相關文章。`;
    return { data, text };
  },
});

export const smsSenderCheck = defineTool({
  name: 'sms_sender_check',
  title: '簡訊寄件號碼判斷',
  description: '依簡訊顯示的寄件號碼或名稱判斷類型（111 政府短碼、企業短碼、個人手機、國際號碼…）與風險。只看號碼格式，內容要另外用 scam_check_message 檢查。',
  pack: PACK, tier: 'L2', source: '阿幫詐騙特徵規則庫', static: true,
  input: { sender: z.string().trim().min(1).max(40).describe('簡訊顯示的寄件號碼或名稱') },
  speak: (d) => `${d.sender}：${d.kind}。${d.note}`,
  async run(_svc, a) {
    const data = checkSender(a.sender);
    return { data, text: `${data.sender}：${data.kind}（風險：${LEVEL[data.risk]}）。${data.note}${CALL_165}` };
  },
});

export default [scamCheckMessage, scamLookupUrl, scamMythSearch, smsSenderCheck];
