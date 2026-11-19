// 工具包：finance（股市收盤行情）— 風險分級 L1，只報開放資料數字，不做買賣建議（PACK_GUARDRAILS.finance）。
import { z } from 'zod';
import { defineTool } from './define.js';

const PACK = 'finance';
/** 漲跌寫成文字（「漲 5（0.23%）」「跌 54（9.93%）」）：地端小模型看「+5」「-54」容易說反 */
const move = (n, p, unit = '') => (n == null ? '漲跌 —' : n === 0 ? '平盤' : `${n > 0 ? '漲' : '跌'} ${Math.abs(n)}${unit}${p == null ? '' : `（${Math.abs(p).toFixed(2)}%）`}`);
const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : '');
export const STOCK_DISCLAIMER = '收盤資料，非即時報價；僅供參考，不構成投資建議。';

export const stockQuote = defineTool({
  name: 'stock_quote',
  title: '股市行情',
  description: '查台股上市、上櫃個股與 ETF 最近一個交易日的收盤行情（收盤價、漲跌、漲跌幅、開高低、成交量），並附加權指數與櫃買指數。query 用代號或名稱，多檔用「、」分隔（最多 5 檔）；不給 query 只回大盤指數。資料每個交易日收盤後更新，不是即時報價；只報數字，不提供買賣建議或漲跌預測。',
  pack: PACK, tier: 'L1', card: 'stock', source: '臺灣證券交易所、證券櫃檯買賣中心（OpenAPI）',
  demoNote: '【示範資料：開放資料的部分片段（2026-11-19 下載），非最新行情】', modeOf: (svc) => svc.openDataMode,
  input: {
    query: z.string().trim().max(60).optional().describe('股票代號或名稱，例如「2330」「台積電、0050」；只查大盤時不要給'),
  },
  speak: (d) => {
    const q = d.quotes.map((x) => (x.close == null ? `${x.name}今天沒有成交` : `${x.name} ${md(x.date)} 收 ${x.close}，${x.change > 0 ? '漲' : x.change < 0 ? '跌' : '平盤'}${x.change ? ` ${Math.abs(x.change)}` : ''}${x.changePct ? `（${Math.abs(x.changePct).toFixed(2)}%）` : ''}`));
    const idx = d.indices[0];
    const head = q.length ? q.join('；') : idx ? `${idx.name} ${md(idx.date)} 收 ${idx.close}，${move(idx.change, null, ' 點')}` : '';
    const miss = d.notFound.length ? `找不到「${d.notFound.join('、')}」。` : '';
    return `${head ? `${head}。` : ''}${miss}` || '目前沒有行情資料。';
  },
  async run(svc, a) {
    const data = await svc.stock.quote(a);
    const lines = [
      ...data.indices.map((i) => `${i.name}（${i.date} 收盤）：${i.close}，${move(i.change, i.changePct, ' 點')}`),
      ...data.quotes.map((x) => `- ${x.code} ${x.name}（${x.market}，${x.date}）：${x.close == null ? '當日無成交' : `收盤 ${x.close}，${move(x.change, x.changePct)}；開 ${x.open ?? '—'}、高 ${x.high ?? '—'}、低 ${x.low ?? '—'}；成交 ${x.volumeLots?.toLocaleString('zh-TW') ?? '—'} 張`}${x.similar ? `（也有：${x.similar.map((s) => `${s.code} ${s.name}`).join('、')}）` : ''}`),
      ...(data.notFound.length ? [`找不到：${data.notFound.join('、')}（請用代號或完整名稱；目前只有上市、上櫃股票與 ETF）`] : []),
      STOCK_DISCLAIMER,
    ];
    return { data, text: lines.join('\n') };
  },
});

export default [stockQuote];
