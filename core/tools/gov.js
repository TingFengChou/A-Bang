// 工具包：gov（去政府辦事，M16-04a）— 風險分級 L1：只讀我的E政府的公開申辦說明，不登入、不送件、不收個資。
// 申辦要身分驗證的事只給官方網頁連結，由使用者自己開（ADR-0011）。網頁 agent、MCP、REST 都從 registry 取用（ADR-0002）。
import { z } from 'zod';
import { defineTool, clip } from './define.js';

const PACK = 'gov';
const SOURCE = '我的E政府入口網－申辦服務資訊（data.gov.tw 146973）';
const DEMO = '【示範資料：沒有連網下載，用的是我的E政府的部分真實資料（常見的十幾項）】';
const CH = { counter: '臨櫃', online: '線上', other: '電郵傳真' };
export const channelSay = (chs) => (chs || []).map((c) => CH[c]).filter(Boolean).join('、');
const NOTE = '以機關公告為準';

export const govServiceInfo = defineTool({
  name: 'gov_service_info',
  title: '辦事要帶什麼',
  description: '查去政府辦事的申辦說明（我的E政府）：要帶什麼證件、誰可以辦、怎麼辦、要幾天、能不能線上辦、官方網頁。使用者問「換身分證要帶什麼」「戶籍謄本怎麼申請」「第一次辦護照要準備什麼」「搬家遷戶口怎麼辦」時用。query 放要辦的事（例：「換身分證」「戶籍謄本」），不要放「要帶什麼」。回答照工具資料轉述，附資料更新日期並提醒以機關公告為準；不代替申辦或送件。',
  pack: PACK, tier: 'L1', card: 'gov-service', source: SOURCE, demoNote: DEMO, modeOf: (svc) => svc.govMode,
  input: {
    query: z.string().trim().min(2).max(40).describe('要辦的事，例如「換身分證」「戶籍謄本」「首次申請護照」'),
    county: z.string().trim().max(10).optional().describe('使用者所在縣市（選填；地方版的說明會排前面），例如「新北市」'),
    limit: z.number().int().min(1).max(5).default(3).describe('最多幾項（預設 3）'),
  },
  speak: (d) => {
    const s = d.items[0];
    if (!s) return `沒有找到「${d.query}」的申辦說明，換個說法試試看。`;
    const how = channelSay(s.channels);
    return `「${s.title}」：${how ? `可以${how}辦` : '看卡片的辦理方式'}${s.days ? `，${s.days}` : ''}${s.docs.length ? '' : '，資料沒有列應備證件'}（${s.updated ? `資料 ${s.updated} 更新，` : ''}${NOTE}）。`;
  },
  async run(svc, a) {
    const data = await svc.gov.serviceInfo(a);
    if (!data.items.length) return { data, text: `我的E政府沒有找到「${data.query}」的申辦說明；可以換個說法（例如「戶籍謄本」「換身分證」）。` };
    const text = clip(data.items.flatMap((s, i) => [
      `${i + 1}. ${s.title}（${channelSay(s.channels) || '辦理方式見網頁'}${s.days ? `，${s.days}` : ''}；資料 ${s.updated || '日期不明'} 更新）`,
      ...(s.docs.length ? ['應備證件：', ...s.docs.map((x) => `- ${x}`)] : ['應備證件：資料沒有列，請看官方網頁或洽辦理機關']),
      ...(s.eligibility ? [`誰可以辦：${s.eligibility}`] : []),
      ...(s.contact ? [`洽詢：${s.contact}`] : []),
      ...(s.url ? [`官方網頁：${s.url}`] : []),
    ]).concat([`以上是我的E政府的公開說明，${NOTE}；阿幫不代替申辦或送件。`]));
    return { data, text };
  },
});

export default [govServiceInfo];
