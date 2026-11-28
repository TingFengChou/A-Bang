// 工具包：gov（去政府辦事，M16-04a）— 風險分級 L1：只讀我的E政府的公開申辦說明，不登入、不送件、不收個資。
// 申辦要身分驗證的事只給官方網頁連結，由使用者自己開（ADR-0011）。網頁 agent、MCP、REST 都從 registry 取用（ADR-0002）。
import { z } from 'zod';
import { defineTool, clip } from './define.js';
import { twClock } from '../services/passport.js';
import { findGovLinks } from '../services/govlinks.js';

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

const coord = { lat: z.number().min(21).max(27).describe('緯度（使用者的位置）'), lon: z.number().min(118).max(123).describe('經度') };
/** 「今天 11/27（五）是上班日」「今天 10/10（六）放假（國慶日）」；日曆沒有今天時說是照週末推的 */
export function todaySay(t) {
  const day = t.dayOffset === 1 ? '明天 ' : t.dayOffset === 2 ? '後天 ' : t.dayOffset ? '' : '今天 '; // 問別的日子：「11/29（六）放假」
  const base = t.workday ? `${day}${t.date}是上班日` : `${day}${t.date}放假${t.note ? `（${t.note}）` : ''}`;
  if (t.known) return base;
  return t.calendarFailed ? `${base}（辦公日曆這次連不上，照週末推的；補班或連假可能不準，去之前先打電話確認）` : `${base}（今年的辦公日曆還沒有今天的資料，照週末推的）`;
}

export const govOfficeNearby = defineTool({
  name: 'gov_office_nearby',
  title: '最近的戶政事務所',
  description: '找使用者附近的戶政事務所（含辦公室）：名稱、地址、電話、距離與步行時間、導航；並說今天是不是行政機關上班日（人事行政總處辦公日曆）。各所營業時間不同（午休、夜間延時、週六服務），資料沒有時間：只說上班日，不說「現在有開」，建議先打電話。使用者問「最近的戶政事務所在哪」「戶政今天有上班嗎」時用。',
  pack: PACK, tier: 'L1', card: 'gov-office', source: '內政部（自然人憑證申辦點位、戶政機關通訊）、人事行政總處辦公日曆', demoNote: '【示範資料：沒有連網下載，用的是部分真實資料（臺北市附近幾個戶政事務所與 115 年辦公日曆）】', modeOf: (svc) => svc.govMode,
  input: { ...coord, limit: z.number().int().min(1).max(5).default(3).describe('最多幾所（預設 3）'), dayOffset: z.number().int().min(0).max(13).optional().describe('問的是幾天後上不上班（明天 1；「禮拜六有開嗎」依今天算）；沒說就是今天') },
  speak: (d) => {
    const o = d.offices[0];
    if (!o) return `附近找不到戶政事務所。${todaySay(d.today)}。`;
    return `最近的是${o.name}，約 ${o.distanceM >= 1000 ? `${(o.distanceM / 1000).toFixed(1)} 公里` : `${o.distanceM} 公尺`}（走路約 ${o.walkMin} 分）。${todaySay(d.today)}。`;
  },
  async run(svc, a) {
    const data = await svc.govOffice.nearbyOffices(a);
    const text = clip([
      `${todaySay(data.today)}；各所營業時間（午休、夜間延時、週六服務）不同，資料沒有時間，建議先打電話。`,
      ...data.offices.map((o, i) => `${i + 1}. ${o.name}：${o.address}，距離約 ${o.distanceM} 公尺（走路約 ${o.walkMin} 分）${o.tel ? `，電話 ${o.tel}` : ''}`),
    ]);
    return { data, text };
  },
});

/** 「一般件 78 人在等」；沒資料就不說 */
const waitSay = (n, label) => (n == null ? null : `${label} ${n} 人在等`);

export const passportWait = defineTool({
  name: 'passport_waiting',
  title: '護照現場等待人數',
  description: '查外交部領事事務局（臺北）與中部、南部、雲嘉南辦事處現在辦護照、領護照的現場等待人數（每分鐘更新）：一般件、網路預約件、領件。只有人數、沒有預估時間，不要自己換算成分鐘；有網路預約會快很多。使用者問「現在去辦護照人多嗎」「領務局要等多久」時用。office 選填（例：「台中」「高雄」）。',
  pack: PACK, tier: 'L1', card: 'passport-wait', source: '外交部領事事務局（申辦、領取護照現場等待人數即時動態）', demoNote: '【示範資料：沒有連網下載，用的是 2026-11-27 上午的真實數字，不是現在的】', modeOf: (svc) => svc.govMode,
  input: { office: z.string().trim().max(10).optional().describe('只看某個據點，例如「台中」「高雄」「嘉義」；不填看全部') },
  speak: (d) => {
    const o = d.offices[0];
    if (!o) return '現在拿不到護照現場等待人數。';
    const parts = [waitSay(o.general.waiting, '申辦一般件'), waitSay(o.online.waiting, '網路預約件'), waitSay(o.pickup.waiting, '領護照')].filter(Boolean).join('、');
    return `${o.short}：${parts}${d.updatedAt ? `（${twClock(d.updatedAt)} 更新）` : ''}。`;
  },
  async run(svc, a) {
    const data = await svc.passport.passportWait(a);
    const text = clip([
      ...data.offices.map((o) => `${o.short}：${[waitSay(o.general.waiting, '申辦一般件'), waitSay(o.online.waiting, '網路預約件'), waitSay(o.pickup.waiting, '領護照')].filter(Boolean).join('、')}`),
      `${data.updatedAt ? `資料 ${twClock(data.updatedAt)} 更新；` : ''}只有人數、沒有預估時間；先網路預約會快很多（${data.booking}）。`,
    ]);
    return { data, text };
  },
});

export const govOfficialLink = defineTool({
  name: 'gov_official_link',
  title: '政府官方入口',
  description: '給去政府辦事的官方網站入口：交通罰單查詢繳納、監理（駕照行照考照驗車）、戶政線上申辦與電子謄本、護照網路預約、報稅、牌照稅房屋稅地價稅、健保、勞保勞退國民年金查詢、地政電子謄本、MyData、行動自然人憑證。這些都要使用者自己登入或輸入身分資料，阿幫只給官方網址（使用者確認後開），看不到查詢結果、不代替付款，也不要索取身分證號。使用者問「我想查有沒有罰單」「怎麼報稅」「查勞保年資」時用。',
  pack: PACK, tier: 'L2', card: 'gov-links', source: '各機關官方網站（阿幫內建清單）', modeOf: () => 'live',
  input: { topic: z.string().trim().min(2).max(40).describe('要辦的事，例如「罰單」「報稅」「勞保年資」') },
  speak: (d) => {
    const l = d.links[0];
    if (!l) return `沒有找到「${d.topic}」的官方入口。`;
    return `「${l.title}」在${l.site}：${l.how}。阿幫只給官方網址，登入、查詢、付款都在官網完成。`;
  },
  async run(_svc, a) {
    const links = findGovLinks(a.topic).map(({ id, title, site, url, how }) => ({ id, title, site, url, how }));
    const data = { topic: a.topic, links };
    const text = links.length
      ? clip([...links.map((l) => `- ${l.title}（${l.site}）：${l.url}；${l.how}`), '這些要使用者自己登入或輸入身分資料；阿幫只給網址，看不到結果。提醒只從官方網站或 App 進去，不要點簡訊或訊息裡的連結。'])
      : `沒有「${a.topic}」的官方入口；可以換個說法（例如「罰單」「報稅」「勞保」）。`;
    return { data, text };
  },
});

export default [govServiceInfo, govOfficeNearby, passportWait, govOfficialLink];
