// 工具包：transit（交通）／導訂票 — 風險分級 L2（ADR-0011：只產生官方連結，產生前需使用者確認；不代付款、不收個資）
import { z } from 'zod';
import { defineTool } from './define.js';
import { MAX_TICKETS, SYSTEM_NAME } from '../services/booking.js';

export const railBookingLink = defineTool({
  name: 'rail_booking_link',
  title: '台鐵／高鐵訂票連結',
  description: '產生台鐵或高鐵官方訂票網站的連結（導訂票），付款與個資在官方網站完成；阿幫不代訂、不付款。'
    + '【L2：呼叫前必須先向使用者確認車次、日期、起訖站與張數】車次可先用 thsr_timetable／tra_timetable 查。'
    + '尚未取得 TDX 導訂票權限時會回錯誤並附官方訂票網站。',
  pack: 'transit', tier: 'L2',
  source: '台鐵／高鐵官方訂票網站（TDX 導訂票）',
  input: {
    system: z.enum(['THSR', 'TRA']).describe('THSR=高鐵, TRA=台鐵'),
    trainNo: z.string().trim().regex(/^\d{1,4}$/, '車次需為 1～4 位數字').describe('車次，例如 123'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD').describe('乘車日期 YYYY-MM-DD（台灣時間）'),
    from: z.string().trim().min(1).max(20).describe('起站，例如 台北'),
    to: z.string().trim().min(1).max(20).describe('訖站，例如 左營'),
    tickets: z.number().int().min(1).max(MAX_TICKETS).optional().describe(`張數 1～${MAX_TICKETS}，預設 1`),
    carType: z.enum(['standard', 'business']).optional().describe('高鐵車廂：standard 標準、business 商務'),
  },
  speak: (d) => `${d.summary}的訂票連結準備好了，開啟後在官方網站付款。`,
  async run(svc, a) {
    const raw = await svc.booking.railLink({ ...a, tickets: a.tickets ?? 1 });
    const data = { ...raw, confirmText: `要開啟${SYSTEM_NAME[raw.system]}官方訂票網站嗎？（${raw.summary}）付款與個資請在官方網站完成。` };
    const text = [`${raw.summary}`, raw.url, `連結有效到 ${raw.expiresAt}`, ...(raw.note ? [raw.note] : []), '開啟前請先向使用者確認；付款在官方網站完成。'].join('\n');
    return { data, text };
  },
});

export default [railBookingLink];
