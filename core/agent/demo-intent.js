// 示範模式意圖解析（M5-03，AGENT.md §5）：沒有 API Key 時，以規則判斷意圖、地點與使用者狀態，
// 產生「分段的工具呼叫計畫」；由 run.js 執行並發出與 Claude 模式相同的事件流。不加人工延遲。
import { ROUTE_NO, SAID_BUS_ROUTE } from './patterns.js';
import { findGovLinks } from '../services/govlinks.js';
import { deptOf } from '../services/clinic.js';
import { whenOf } from '../when.js';
import { LANDMARKS, normPlace } from '../services/places.js';
import { nowTW, distanceM } from '../util.js';
import { destToken, lookupToken, isAirportName, railStationAnswer } from './clarify.js';

/** 問會不會下雨（不是正在下雨；判斷層的下雨狀態也要拿掉，P2-4） */
export const RAIN_ASK = /會不會下(?:大)?雨|會下(?:大)?雨[嗎吧]?|下(?:大)?雨[嗎沒]|下不下雨|有沒有(?:在)?下(?:大)?雨/g;
export const rainAsked = (s) => new RegExp(RAIN_ASK.source).test(String(s || ''));
// ── 使用者狀態關鍵字（AGENT.md §5） ──
const STATE_WORDS = [
  ['rush', /趕|來不及|快一點|最快|比較快|快點到|越快越好|遲到/], // 「我快遲到了」最常見（腦袋審查 #6）
  ['luggage', /行李|大包小包/],
  ['budget', /省錢|便宜|最省/],
  ['lessWalk', /不想走|少走|不用走|不要走太多|走不動|腳痛|輕鬆/],
  ['elder', /長輩|老人家|阿公|阿嬤|爺爺|奶奶|外公|外婆|年紀大/],
  ['kids', /小孩|小朋友|帶(?:著)?孩子|嬰兒|寶寶|娃娃車/],
  ['mobility', /輪椅|行動不便|行動不方便|腳不方便|腳不好|拐杖|身障|腳受傷|骨折/],
  ['rain', /下雨|雨天|雨很大|下大雨|雨好大|雨超大|雨下(?:得)?很大/], // 「外面下大雨」（腦袋審查 #6）；問句（「會不會下大雨」）在 RAIN_ASK 先拿掉
  ['badAir', /空氣(很|好|有點|太)?(差|髒|不好)/],
];
/** 同行人數（A1b／S6）：「我們 4 個人」「三個人」「一家五口」；1 人或沒說回 null */
/** 人數的數字：阿拉伯數字或中文（含「十二」「二十」） */
const PN = '(\\d{1,2}|[一二兩三四五六七八九]?十[一二三四五六七八九]?|[兩二三四五六七八九])';
/** N 人（「2人座」「三人份」「第3個人」「10人以上」不算） */
const PARTY_N = new RegExp(`(?<![第前後])${PN}\\s*(?:(?:個|位)?\\s*人(?![行民潮員工家生座份房組以內左])|位(?![置子於數]))`);
/** 「4位大人2位小孩」「2大1小」「兩大兩小」：大人＋小孩 */
const PARTY_AK = new RegExp(`${PN}\\s*(?:個|位)?\\s*大(?:人)?\\s*${PN}\\s*(?:個|位)?\\s*小(?:孩|朋友)?`);
/** 「我們兩個」「我跟我媽兩個」：後面接動作或句尾 */
const PARTY_US = new RegExp(`(?:我們|[跟和][^\\s，,。]{1,3})\\s*${PN}\\s*個(?=\\s*(?:$|[，,。!！?？]|去|要|一起|到|坐|搭|出發))`);
/** 自己一個人（清掉前面說的人數） */
const PARTY_ONE = /只有我(?:一個)?|就我一個|我自己一個|(?<![第前後\d])一個人(?![份座])|\bjust me\b|\balone\b|\bby myself\b/i;
/** 說人數的字（整句只有地名＋人數也算要去那裡） */
const PARTY_WORDS = new RegExp(`(?:我們|一共|總共)?(?:${PARTY_AK.source}|${PARTY_N.source}|${PARTY_US.source})|一家\\s*(?:\\d|[二三四五六七八])\\s*口|一起|${PARTY_ONE.source}`, 'g');
const EN_PARTY = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/**
 * 同行人數（A1b／S6）：「我們 4 個人」「十二個人」「一家五口」「2大1小」「我們兩個」、英文；「只有我一個人」→ 1（清掉前面說的人數）。
 * @returns {number|null} 1～20；沒說回 null
 */
export function partyOf(s) {
  const num = (t) => (/^\d+$/.test(t) ? Number(t) : zhNum(t.replace(/^一十/, '十')));
  let n = null;
  const ak = PARTY_AK.exec(s);
  if (ak) n = num(ak[1]) + num(ak[2]);
  else {
    const m = PARTY_N.exec(s) || PARTY_US.exec(s) || /一家\s*(\d|[二三四五六七八])\s*口/.exec(s);
    if (m) n = num(m[1]);
    else {
      const e = /\b(\d{1,2}|two|three|four|five|six|seven|eight)\s+(?:of us|people|persons|adults)\b/i.exec(s) || /\bparty of\s+(\d{1,2}|two|three|four|five|six)\b/i.exec(s);
      if (e) n = Number(e[1]) || EN_PARTY[e[1].toLowerCase()];
      else if (PARTY_ONE.test(s)) n = 1;
    }
  }
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}
/** 公車路線後面的說法（BUS_ROUTE 與數字地名共用：「101 多久」是公車不是台北101） */
const BUS_ASK = '公車|到哪|來了|還要|什麼時候|幾分|怎麼還沒|還沒來|多久|要等|來了沒|快到了沒|在哪|幾點(?:會)?來|末班|最後一班|收班'; // 「307 幾點來」（P5-4）；「307 末班車幾點」（真實資料健檢 2026-11-22）
const BUS_ROUTE = new RegExp(`(?:^|[^\\d])(${ROUTE_NO})(?:\\s*(?:號|路)?\\s*(?:公車)?\\s*還?\\s*(?:${BUS_ASK}))`); // 口語：「307 怎麼還沒來」「307 多久」（P2-1）；「307還多久」（PM 第三輪 #5）
/** 在等某一路公車（「我在等939」「等 939 公車」）：沒有問法也是查那一路（真實資料健檢 S8）；「等 20 分鐘」「等 3 個人」不算 */
const BUS_WAIT = /(?:^|(?<=[我在正還就站牌邊]))等\s*(?:公車\s*)?([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?!\d)(?!\s*(?:分|秒|小時|鐘|個|人|天|年|點|樓|元|塊|%|％))(?!\s*號(?!\s*(?:公車|的車|[，,。.!！?？～~]|$)))\s*(?:號|路)?\s*(?:公車|的車)?/; // 「我在台北車站等307」算；「我等3號發薪」「等 5 號再說」「等2號窗口」不算（PR #127 審查）
/** 問末班車（「末班車幾點」「最後一班公車幾點」「捷運末班車幾點」）；高鐵台鐵由 RAIL_ASK 處理 */
const LAST_ASK = /末班|最後一班|收班|幾點收|(?:捷運|公車|\d{1,4}).{0,3}(?:開)?到幾點|還有(?:沒有)?車|還有(?:公車|捷運)嗎/; // 「307還有車嗎」「捷運到幾點」「捷運幾點收」（PM 第二輪審查）
const RAIL_WORD = /高鐵|台鐵|臺鐵|火車|自強|區間|莒光|普悠瑪|太魯閣號/;
/** 車種與鐵路名稱（含「號」「車」：「自強號台北到花蓮」整個拿掉，不會留下「號台北」；PM 第三輪 #1） */
const RAIL_TYPE = /高鐵|台鐵|臺鐵|火車|新自強(?:號)?|自強(?:號|3000)?|區間快?車?|莒光(?:號)?|普悠瑪(?:號)?|太魯閣號|復興號/g;
/** 地名裡的「火車站／高鐵站／台鐵站」不是交通方式偏好（「從桃園火車站去台北101」；真實資料健檢 S10）：判斷交通方式、是不是查高鐵台鐵前先拿掉 */
const RAIL_IN_NAME = /火車站|火車頭|(?<=[一-龥]{2})(?:高鐵|台鐵|臺鐵)站|(?:高鐵|台鐵|臺鐵)(?=[一-龥]{2}站)/g;
export const withoutRailNames = (s) => String(s || '').replace(RAIL_IN_NAME, (m) => (/^火車/.test(m) ? '車站' : /站$/.test(m) ? '站' : ''));
/** 地名裡的捷運、公車（「西門捷運站」「捷運內湖站」「台北車站公車站」）：是起訖點，不是指定坐捷運或公車（腦袋審查 #1：「從西門捷運站到台北101」原本被當成要坐捷運，回答變成「照你說的選捷運（分數比公車低）」）
 *  前面接動詞或「到、去」的不算地名（「坐捷運到板橋站」「搭公車去市政府站」） */
const STOP_IN_NAME = /(?<=[一-龥]{2})捷運站|捷運(?=(?:(?![到去往從坐搭在要轉換])[一-龥]){2,8}站)|(?<=[一-龥]{2})公車(?:總)?站/g;
const withoutStopNames = (s) => String(s || '').replace(STOP_IN_NAME, (m) => (/站$/.test(m) ? '站' : ''));
/** 問班次的說法（沒說起站時才用最近車站） */
const RAIL_ASK = /下一班|幾點|班次|時刻|末班|首班|還有車|有車嗎|幾班/;
/** 不是站名的「起站」（「下一班高鐵到台中」「我要坐高鐵去左營」） */
const NOT_STATION = /[我要坐搭想你在]|下一班|一班|最近|現在|明天|今天|後天|早上|晚上|下午|票價|價|來得及|趕得上|來不及/;
/** 不是車站的目的地（「火車回家幾點」） */
const NOT_DEST = /^(?:家|公司|學校|宿舍|老家)|幾|點/;
/** 問票價（交給 rail_fare，不是時刻表） */
const RAIL_FARE = /票價|多少錢|車資|幾塊|要多少/;
/**
 * 高鐵／台鐵的起訖站：「台北到台中」→ { from, to }；只有「到／去／回 X」→ { from: null, to }；都沒有回 null。
 * 先去掉「從」「搭／坐」「車站」等字（「從板橋到台中的高鐵」「台北車站到…」）。
 */
function railOD(s) {
  const t = s.replace(RAIL_TYPE, ' ').replace(/\d{1,2}\s*(?:[:：]\s*\d{2}|點(?:半|\d{1,2}分?)?|時)/g, ' ').replace(RAIL_FARE, ' ').replace(/從|搭|坐|乘/g, ' ').replace(/(?<=[一-龥]{2})車?站/g, ' ')
    .replace(/(?:明天|今天|後天|明早|今晚)|(?:早上|晚上|下午|中午|上午|傍晚|凌晨)/g, ' '); // 時間詞先拿掉（「明天早上台北到台中」不會變成「上台北」，P2-10）
  const STOP = '(?=下一班|首班|末班|幾點|的|班|車|站|要|有|還|[\\s？?。，,！!]|$)';
  const ok = (x) => x && !NOT_DEST.test(x);
  const m = new RegExp(`([一-龥]{2,3}?)\\s*(?:到|→|去|往|回)\\s*([一-龥]{2,3}?)${STOP}`).exec(t);
  if (m && !NOT_STATION.test(m[1]) && ok(m[2])) return { from: m[1], to: m[2] };
  const only = new RegExp(`(?:到|→|去|往|回)\\s*([一-龥]{2,3}?)${STOP}`).exec(t);
  return only && ok(only[1]) ? { from: null, to: only[1] } : null;
}
/** 找藥局的說法（單一字表：生活意圖與「找診所」的排除共用，架構審查 2026-11-28） */
const PHARMACY_WORD = /藥局|藥房|領藥|拿藥|慢箋|慢性處方|處方箋|領處方/;
// 生活服務（M10）：依序比對，先比的優先（「發票」先於其他）。天氣在行程之後才比（「下雨了，從 A 到 B」是行程）
const LIFE_WORDS = [
  ['invoice', /發票|對獎|中獎號碼|中獎了?(?:嗎|沒)|有沒有中獎|有中獎嗎|(?:^|\D)\d{8}(?!\d)\s*(?:這張)?\s*(?:有中|有沒有中|中了|中獎)/], // 「12345678 有中嗎」（PR #127 審查） // 「我中獎了嗎」（PM Q-21）
  ['fuel', /油價|汽油|柴油|(?:92|95|98)\s*無鉛|加油.{0,6}(?:多少|價|錢)|(?<!\d)(?:92|95|98)\s*(?:一公升|每公升)/],
  ['stock', /股價|股票|股市|[台臺]股|大盤|加權指數|櫃買|收盤|(?<!垃圾車?|回收|資源回收)(?:今天|昨天|今日)收(?:多少|在多少|幾塊|了多少)|漲停|跌停|\bETF\b|\d{4}\s*(?:漲|跌)/i],
  ['quake', /地震|震度|震央/],
  ['pharmacy', PHARMACY_WORD], // 「領慢箋」是長輩最常找藥局的原因（P2-8）
  ['garbage', /垃圾車|倒垃圾|收垃圾/],
  ['aqi', /空氣品質|空品|空氣(?:好|差|不好|怎樣|如何)|AQI|PM\s*2\.?5|空汙|空污|霧霾|要不要戴口罩/i],
];
/** 找有看診的診所（與藥局同一個意圖、clinic 旗標）：要有診所、看醫生、看病或科別；問怎麼去某家醫院或診所是行程 */
const CLINIC_WORD = /診所|看醫生|看病|看診|門診|小兒科|兒科|耳鼻喉|牙醫|看牙|中醫|皮膚科|眼科|婦產科|家醫科|骨科|復健科|身心科/;
const CLINIC_TRIP = /怎麼(?:去|走|到|坐|搭|過去)|(?:去|到|往)(?!附近|看|找)[^，。？?！!\s]{1,10}(?:醫院|診所|看病|看醫生|看診|回診)|要搭|幾號公車|中醫大|醫院(?!.{0,4}(?:有開|看診))/;
/** 「附近有醫院嗎」「最近的醫院在哪」：沒說哪一家，查附近有看診的（健保資料含醫院；PM 第三輪 #5） */
const HOSPITAL_NEAR = /(?:附近|最近|旁邊|這邊|這附近)(?:的|有)?(?:什麼|哪些|哪家)?醫院|^醫院在哪/;
const clinicOf = (s) => ((CLINIC_WORD.test(s) && !CLINIC_TRIP.test(s)) || HOSPITAL_NEAR.test(s) ? { clinic: true, ...(!CLINIC_WORD.test(s) && HOSPITAL_NEAR.test(s) && { hospital: true }), ...(deptOf(s) && { dept: deptOf(s) }), ...(whenOf(s) && { when: whenOf(s) }) } : null); // when：「明天早上」「禮拜天」「夜間」（PM 審查 2026-11-28）
/** 應備證件一條 → 唸得出來的短名稱（去編號、取到第一個標點；太長的條文不唸） */
export const docShort = (x) => { const v = String(x || '').replace(/^\s*(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[)）]|\d+[.、．])\s*/, '').split(/[，。；：:（(]/)[0].trim(); return v.length >= 2 && v.length <= 14 && /[證書照表片簿卡章元費印]|影本|正本|文件|資料/.test(v) && !/者$|未滿|初領|補領|換領|親自|委託/.test(v) ? v : null; }; // 只唸文件、費用（「初領或補領」「未滿14歲」是分類標題）
/** 時間詞後面接去、到、往（「明天去台北101」「等一下去」「禮拜六早上九點去動物園」） */
const TIME_GO = /(?:明天|今天|後天|今晚|明早|明晚|等一下|等等|待會兒?|晚點|早上|上午|中午|下午|晚上|傍晚|(?:禮拜|星期|週)[一二三四五六日天])(?:要|會)?\s*(?:去|到|往)\s*\S/;
/** 出門建議的問法 */
const OUTING = /(?:適合|可以|能|要不要).{0,4}(?:慢跑|跑步|運動|騎車兜風|散步)|(?:慢跑|跑步|運動|散步).{0,4}(?:好嗎|可以嗎|適合嗎|嗎)|出門.{0,10}(?:注意|要帶|帶什麼|穿什麼|怎麼穿|帶傘|適合)|適合出門|(?:可以|能|適合|要不要)\s*(?:帶.{0,4})?(?:去|出去)\s*(?:公園|郊外|河濱|戶外|玩|散步|運動|爬山|踏青|野餐)|適合(?:出去|戶外)|(?:今天|等一下|待會).{0,6}(?:注意什麼|要帶什麼|穿什麼)|要穿什麼|穿什麼出門/;
const WEATHER_WORD = /天氣|氣溫|溫度|幾度|下雨|下大雨|大雨|帶傘|雨傘|會冷|會熱|會很[冷熱]|[冷熱]不[冷熱]|很[冷熱][嗎嘛]|颱風|出太陽|外套|穿(?:多少|幾件|什麼|厚一點|多一點)/; // 「今天會很熱嗎」（P5-4）
// 使用者指定交通方式（「坐公車去」「改叫車」）：plan_trip prefs.mode；「不要叫車」的叫車不算
const MODE_WORDS = [['bus', /公車|巴士/], ['metro', /捷運|MRT/i], ['bike', /youbike|ubike|單車|腳踏車/i], ['walk', /走路|步行|走過去/], ['drive', /自己開車|自行開車|開我的車|自駕|開車(?:去|過去|出門|到)?/], ['ridehail', /叫車|叫(?:一|1)?(?:台|輛)車|計程車|小黃|uber/i],
  ['thsr', /高鐵/], ['tra', /台鐵|臺鐵|火車|自強號?|區間車|莒光號?|普悠瑪|太魯閣號/], ['intercity', /客運/]];
/** 有人要你加 LINE、加好友、進投資群組（詐騙話術；「LINE 怎麼用」這類不算） */
const LINE_SCAM = /(?:加|加入|加我|加他|加她|加對方)\s*(?:的)?\s*(?:line|賴|LINE)|(?:line|賴)\s*(?:帳號|好友|ID)|投資群組|飆股群|穩賺不賠|保證獲利/i;
/** 要設提醒、通知、到站叫我、取消提醒 */
const REMIND_ASK = /提醒我|通知我|到站叫我|叫我下車|(?:設|設定|新增|取消|關掉)(?:一個|一下)?(?:出門|下車|到站)?提醒|下車提醒/;
/** 要改設定：設定／改常用地點（家、公司、學校）、我有車、語言、通知、手機上的 AI */
const SETTINGS_ASK = /(?:設定|設成|設為|改成|新增|修改|更改|改一下)(?:我)?(?:的)?(?:家|公司|學校|常用地點|語言|通知)|常用地點(?:怎麼|要怎麼|在哪)?(?:設|改|新增)|^我(?:有|沒有)車了?[。！!]?$|(?:關掉|關閉|打開|開啟)(?:通知|手機上的\s*AI)|(?:語言|介面)(?:改|換)成/;
/** 去政府辦事要帶什麼、怎麼辦（M16-04a）：辦的事（身分證、謄本、護照…）＋問要帶什麼／怎麼辦／要多久；或「結婚登記」「遷戶口」這種本身就是辦事的詞 */
const GOV_THING = '(?:身分證|身份證|戶籍謄本|戶口謄本|謄本|戶口名簿|護照|駕照|行照|印鑑證明|印鑑|印章|自然人憑證|勞保|國民年金|老人年金|老年年金|育嬰(?:留職停薪)?津貼|生育給付|房屋稅|牌照稅|報稅|綜所稅|所得稅|健保卡|敬老(?:愛心)?卡|愛心卡|(?:中)?低收入(?:戶)?|老人(?:生活)?津貼|身心障礙證明|身障(?:手冊|證明)|殘障手冊|(?:重陽|敬老)禮金)'; // 長輩常辦的（PM 審查 2026-11-28）
export const GOV_ASK = new RegExp(`${GOV_THING}.{0,10}(?:要帶|帶什麼|準備什麼|要準備|需要什麼|怎麼辦|怎麼申請|如何申請|如何辦|怎麼弄|去哪辦|在哪辦|哪裡辦|要多久|幾天|手續|流程|不見了?|掉了|遺失|紮|啥物|啥咪|怎麼領|如何領|去哪領|哪裡領|要去哪裡領)|(?:換|補|辦|申請|請領|申辦)(?:新的?|一張)?${GOV_THING}|(?:結婚|出生|死亡|離婚|遷入|遷出)登記|遷戶口|報戶口`);
/** 找戶政事務所、問戶政今天有沒有上班（M16-04b）：「最近的戶政事務所在哪」「戶政今天有上班嗎」；問怎麼去是行程 */
/** 護照現場人多不多（M16-04c）：「現在去辦護照人多嗎」「領務局要排多久」；問要帶什麼仍是辦事須知 */
export const PASSPORT_WAIT = /(?:護照|領務局|領事事務局|外交部.{0,4}辦事處).{0,10}(?:人多|人很多|多少人|幾個人|排隊|排多久|等多久|要等|等待人數|現場|叫到幾號|號碼)|(?:領務局|領事事務局).{0,6}(?:現在|今天)/;
/** 要去官方網站查、繳、報、預約（罰單、報稅、勞保年資…，M16-04d）：有對得到的官方入口，句子又在問查／繳／去哪個網站 */
const GOV_LINK_VERB = /查|繳|報稅|報|申請|預約|登入|網站|網址|怎麼用|線上|有沒有|下載|註冊/;
/** 問要帶什麼、怎麼辦（有這些就是問辦事須知，不是找據點） */
const GOV_DOCS_Q = /要帶|帶什麼|準備什麼|要準備|怎麼申請|如何申請|怎麼辦|手續/;
export const GOV_OFFICE = /(?:最近|附近|離我最近|哪裡有|哪邊有|找)(?:的)?.{0,3}戶政(?:事務所)?|戶政(?:事務所)?.{0,4}(?:在哪|在哪裡|有開|開門|有上班|上班嗎|上班日|今天有沒有上班|今天有開|放假|幾點(?:開|關|上班|下班)|營業時間|上班時間|服務時間|(?:禮拜|星期|週)[六日天](?:有開|有上班))/;
/** 把行程加到行事曆、日曆（ADR-0021；系統的新增行程畫面確認） */
export const CALENDAR_ASK = /(?:加|放|存|寫|排|記|建)(?:一下)?(?:進|到|入|在)?(?:我的)?(?:手機)?(?:的)?(?:行事曆|日曆|行程表|google\s*(?:日曆|calendar))|(?:add|put|save)\b.{0,20}\b(?:to|in|into)\s+(?:my\s+)?calendar/i;
/** 把行程分享、傳給別人（ADR-0021；系統分享面板）。「有人傳給我一個網址」不算（傳給「我」之後要接家人朋友） */
export const SHARE_ASK = /^(?:幫我|請|可以|能不能|麻煩|那)?\s*(?:把)?(?:這個|這條|剛剛的|這趟)?(?:路線|行程|走法)?\s*分享(?:一下)?(?:給.{1,8}?|到.{1,8}?|出去)?(?:這個|這條|剛剛的|這趟)?(?:路線|行程|走法)?(?:嗎|好嗎|吧)?[。！!？?～~\s]*$|(?:轉傳|傳|寄|發|貼)(?:給|到)(?:我(?:的)?)?(?:媽媽?|爸爸?|老公|老婆|家人|朋友|同事|哥哥?|姐姐?|姊姊?|弟弟?|妹妹?|男友|女友|另一半|群組|LINE|line|他|她|女兒|兒子|孫子|孫女|阿公|阿嬤|阿媽|爺爺|奶奶|外公|外婆|先生|太太|媳婦|女婿|老師|鄰居|同學|主管|老闆)/;
/** 英文：「share this」「share the route with my mom」（「share price」不算） */
export const SHARE_ASK_EN = /^(?:please\s+|can you\s+|could you\s+)?share\s+(?:this|it|the\s+(?:trip|route|plan))\b(?:\s+with\b[^?]*)?[.!?\s]*$/i;
/** 搭客運的字眼（判斷層說 intercity 時，句子有這些才限定只查客運） */
const INTERCITY_WORD = /客運|巴士|統聯|國光|和欣|葛瑪蘭|豪泰|長途/;
/** 使用者說不要的交通方式（「不要叫車」「不想坐公車」「別走路」）→ ['ridehail', …] */
const NOT_MODE = /(不要|不想|別|不用|不坐|不搭)\s*(坐|搭|改|騎|叫|等)?\s*$/;
export function avoidOf(s0) {
  const s = withoutStopNames(withoutRailNames(s0));
  const out = [];
  for (const [mode, re] of MODE_WORDS) {
    const g = new RegExp(re.source, `${re.flags}g`);
    for (let m = g.exec(s); m; m = g.exec(s)) if (NOT_MODE.test(s.slice(Math.max(0, m.index - 5), m.index)) && !out.includes(mode)) out.push(mode);
  }
  return out;
}

export function modeOf(s0) {
  const s = withoutStopNames(withoutRailNames(s0)); // 「桃園火車站」「西門捷運站」是地名，不是要坐火車、捷運（S10、腦袋審查 #1）
  let best = null;
  for (const [mode, re] of MODE_WORDS) {
    const g = new RegExp(re.source, `${re.flags}g`);
    for (let m = g.exec(s); m; m = g.exec(s)) {
      if (NOT_MODE.test(s.slice(Math.max(0, m.index - 5), m.index))) continue; // 「不想騎單車」「不要叫車」不是要
      if (!best || m.index > best.i) best = { mode, i: m.index };
    }
  }
  return best?.mode ?? null;
}
/** 前面最近一次的行程（起訖點、狀態），給「改坐公車」這種接著改的句子沿用 */
/** 當下才成立的狀態（趕時間、正在下雨、空氣很差）：改了出發時間或日期就不沿用，除非這句又說了（腦袋審查 #8：「改成明天早上8點出發」不該還帶著剛剛的趕時間、下雨） */
const MOMENT_STATES = new Set(['rush', 'rain', 'badAir']);
const carryStates = (prevStates, states, retimed) => [...new Set([...(prevStates || []).filter((k) => !retimed || !MOMENT_STATES.has(k)), ...states])];
function lastTrip(history, saved) {
  // 逐輪往後疊：第 1 輪行程、第 2 輪「改坐公車」、第 3 輪「我趕時間」→ 起訖點、交通方式、狀態都沿用（PR #30 審查）
  // 單趟累積：每一則把目前累積的行程（prev）交給 parseIntent，不再遞迴重算前文（PR #35 審查：原本是指數成長）
  let cur = null;
  history.forEach((m, i) => {
    if (m.role !== 'user') return;
    const it = parseIntent(String(m.content), { history: history.slice(0, i), prev: cur, saved });
    if (it.reset) cur = null; // 「重來」：之前的行程不再沿用
    else if (it.intent === 'trip' && !HERE_SAID.test(String(history[i + 1]?.content || ''))) cur = it; // 「你就在台北車站附近」：那一句沒排行程，之後的「捷運下一班」不是改行程（審查 #121）
  });
  return cur;
}
/** 阿幫回「你就在那裡、要查什麼？」（clarify.js hereAsk）：那一輪沒有排行程 */
const HERE_SAID = /^你就在.{1,20}附近，不用排路線|^You're already at /;
// 改交通方式要有明確的改換字眼（「坐」「搭」「騎」單獨出現不算：「搭 307 到哪了」是查公車）
const CHANGE_WORD = /改|換|那.*呢|的話(?:呢|咧)?|還是|不要|不坐|不搭|^那(?:麼)?\s*(?:坐|搭|騎|叫|走路)/; // 「那坐公車要多久」（行程後）＝改坐公車
/** 排好行程後問時間、票價、幾點出門（只有這句、沒有地名） */
const FOLLOW_ASK = /^(?:那|請問)?\s*(?:總共|大概|大約)?\s*(?:要多久|要花多久|多久會到|花多久|要多少時間|幾分鐘|票價(?:多少)?|多少錢|要多少錢|車資(?:多少)?|費用|多貴|幾塊|幾點出門(?:比較好)?|幾點出發(?:比較好)?|什麼時候出門(?:比較好)?)\s*(?:啊|呢|咧|嗎)?\s*[?？]?$/;
/** 排好行程後只換日子（「明天呢」「那明天早上呢」「禮拜六咧」） */
const FOLLOW_DAY = /^(?:那|那麼)?\s*(?:明天|後天|(?:禮拜|星期|週)[一二三四五六日天])(?:早上|上午|中午|下午|晚上)?\s*(?:呢|咧|勒|的話呢|出發呢)\s*[?？]?$/;
/** 「重來」：清掉前面的行程（之後只說目的地就從現在位置算） */
const RESET = /^(?:重來|重新開始|從頭開始|從頭來|從頭|清除|清掉|算了)(?:吧|啦)?[。！!.]?$/;
/** 接著改目的地（「改去松山機場」「那去松山機場呢」「換到西門町」） */
const CHANGE_TO = /(?:改|換|那|還是)\s*(?:成)?\s*(?:去|到|往)|(?:不是|不對|我是說|我是要|我是想|我說的是|應該是|是要)\s*(?:要|想)?\s*(?:去|到|往)/; // 「欸不是啦，我是要去松山機場」也是改目的地（P5-1）
/** 只說起點（「我其實從板橋出發」「改從板橋」）：地標庫沒有也採用 */
const FROM_START = /(?:^|[其改])?(從)\s*([^\s，,。、到去往]{2,12}?)\s*(出發|過去)?\s*[。！!]?$/;
/** 不是地名的「從…」（從明天、從頭、從來、從現在、從這裡） */
const NOT_PLACE = /^(?:明天|今天|昨天|頭|來|現在|這裡|這邊|那裡|剛剛|以前|小)|開始|不坐|不搭|算/;
/** 地標庫沒有的起點：句尾有「出發」或「改從／其實從」才採用 */
function fromStartOf(s) {
  const m = FROM_START.exec(s);
  if (!m || NOT_PLACE.test(m[2])) return null;
  return m[3] || /(?:改|其實|我是|是)從/.test(s) ? m[2] : null;
}
/** 阿幫上一輪在問起點（「你從哪裡出發？」）→ 使用者只回地名＝起點 */
const ASKED_ORIGIN = /從哪(裡|兒)?出發|你(現在)?在哪|起點是|^Where are you starting from\?|type where you are/i;
/** 阿幫上一輪在問目的地（「要去哪裡？」）→ 使用者只回地名＝目的地，起點沿用 */
const ASKED_DEST = /要去哪裡？|^Where are you going\?/; // 英文那一輪問、使用者回中文地名也接得上
const ASKED_DEST_EN = /^Where are you going\?/;
const ASKED_ORIGIN_EN = /^Where are you starting from\?|type where you are/i;
/** 上一輪阿幫選了（或在盯）哪一班公車（回答裡的「公車 棕9」）；沒有回 null */
function chosenBus(history) {
  const said = history.filter((x) => x.role === 'assistant').at(-1)?.content || '';
  return SAID_BUS_ROUTE.exec(said)?.[1] || null;
}
/** 句中明講的起點（「從桃園高鐵站到台北101」）：地標庫沒有也要用它，不能被手機定位蓋掉 */
const FROM_TEXT = /從\s*([^\s，,。、到去往]{2,12}?)\s*(?:要|該)?\s*(?:怎麼|怎樣)?\s*(?:到|去|往)/; // 「從板橋怎麼去」的起點是板橋（不是「板橋怎麼」）

// ───── 缺必要欄位（「該問就問、不要自己猜」，ADR-0016）：it.needs＝要問的欄位，runDemo／模型模式在查資料前問一句 ─────
/** 問公車但沒說哪一路（「公車還要多久？」「等公車等好久」）：只在句子主要是問「某班公車多久到、到哪了」、沒有別的意圖時才算（寧可不問）。
 *  parseIntentRaw 最後才看（其他意圖、一句問好幾件事、剛剛那班都先處理）；票價、怎麼坐、帶什麼、天氣、收班、班距都不算 */
const BUS_WORD = /公車|巴士/;
const BUS_WHEN = /多久(?!一班)|到哪(?!裡?(?:坐|搭|上車|等))|幾分(?:鐘)?(?:到|來|會到|會來)|來了沒|什麼時候(?:會)?來|幾點(?:會)?來|怎麼還沒來|還沒來|一直不來|快到了沒|到了沒|等(?:好|很|超|有夠)久/;
const BUS_OTHER = /附近|站牌|哪些公車|哪幾路|有什麼公車|搭什麼|坐什麼|怎麼去|怎麼走|怎麼坐|怎麼搭|哪裡(?:坐|搭|上車|等)|從.+到|[去往]|到\s*[^\s哪了？?嗎沒站]|錢|票|付|卡|帶|冷|熱|雨|天氣|空氣|油價|發票|股|收班|末班|首班|一班|班距|夜間|半夜|深夜|老人|敬老|愛心|博愛|可以|能不能|會不會|要不要/;
export const busNoRoute = (s) => BUS_WORD.test(s) && BUS_WHEN.test(s) && !BUS_OTHER.test(s) && !/[紅藍綠棕橘小幹]?\d{1,4}[區副]?/.test(s);
/** 只說起點、要出發了（「從台北車站出發」「我在板橋，要出發了」）：句子裡沒有要去哪裡 */
const ORIGIN_ONLY = /(?:^|[，,\s])(?:我)?(?:現在)?(?:人)?(?:在|從)\s*\S{2,12}?\s*(?:出發|[，,]?\s*(?:要|準備|快)?(?:出發|出門|走)了?)\s*(?:了|囉|啦)?[。！!～~]?$/;
export function originOnly(s, places) {
  if (places.length !== 1 || !ORIGIN_ONLY.test(s)) return null;
  if (/(?:去|到|往|回)\s*\S/.test(s.replace(/(?:出發|出門)/g, ''))) return null; // 「從板橋出發去 101」有目的地
  return places[0];
}
/** 想去某處但沒說哪裡（「我要去」「怎麼去？」「帶我去」） */
const NO_DEST = /^(?:我|阿幫)?(?:要|想)?(?:出發|去)(?:了|啦|囉)?[。！!～~]?$|^(?:我)?(?:要|想|得)?(?:去|到)醫院(?:看病|看醫生)?(?:了|啦|囉)?[。！!～~]?$|^(?:要|該)?怎麼(?:去|走)[？?。]?$|^(?:帶我|載我)去[？?。]?$/;
export const noDestination = (s, places) => !places.length && NO_DEST.test(s.trim());
/** 預設起點（沒定位時）跟目的地很近（< 300 公尺）：從臺北車站算到臺北車站沒有意義，要問起點 */
export const NEAR_DEFAULT_M = 300;
const landmarkOf = (name) => { const n = normPlace(name); return n ? LANDMARKS.items.find((x) => [x.name, ...x.aliases].some((k) => normPlace(k) === n)) || null : null; };
export function nearDefaultFrom(to) {
  const a = landmarkOf(DEFAULT_FROM), b = to && (Number.isFinite(to.lat) ? to : landmarkOf(to)); // 地名或有座標的地點（常用地點）
  if (!a || !b) return false;
  return distanceM(a.lat, a.lon, b.lat, b.lon) < NEAR_DEFAULT_M;
}

/** 「去機場」「到機場怎麼走」「機場」：沒說哪個機場（機場捷運、機場線、機場巴士不算；說了「桃園機場」「第二航廈」就是那個） */
const AIRPORT_GO = /(?:去|到|往|趕)\s*(?:飛)?機場(?!捷運|線|快線|巴士|大巴|客運|接駁|站)|^(?:飛)?機場\s*(?:怎麼(?:去|走|坐|搭))?\s*[？?。！!]?$/;
const AIRPORT_EN = /\b(?:to|for)\s+(?:the\s+)?airport\b(?!\s+(?:mrt|metro|line|express|bus|shuttle))|^(?:the\s+)?airport[?.!]?$/i;
/**
 * 句子提到機場但不是要排去機場的行程（審查 #122）：問天氣、空品、路況，說不去了、別人去、先去別的地方、設提醒、問要帶什麼——
 * 交回原本的流程（天氣、空品、路況照常回答；其他不排行程、不問機場）
 */
const AIRPORT_NOT_TRIP = /天氣|氣溫|溫度|幾度|下雨|會不會雨|帶傘|雨傘|颱風|空氣|空品|pm\s*2\.?5|aqi|塞車|塞不塞|路況|車多|交通(?:狀況|順)|不用去|不去|不要去|別去|沒有要去|不必去|取消|已經去|剛去|再去|前先|之前|然後|順便|提醒|鬧鐘|通知|要帶|帶什麼|帶.{0,6}嗎|護照|簽證|安檢|托運|登機|報到|check\s*-?in/i;
const AIRPORT_NOT_TRIP_EN = /weather|\brain|umbrella|forecast|temperature|air quality|\baqi\b|pm ?2\.?5|traffic|\bjam|congest|remind|alarm|passport|visa|\bbring|\bpack|security|check[- ]?in|\bnot going\b|don'?t (?:need|have) to go|no need to go|cancel|before (?:going|heading|I go)|\bthen\b|\bfirst\b|\bmy (?:wife|husband|friend|mom|mother|dad|father|son|daughter|boss)\b|\b(?:he|she|they)(?:'s| is| are)?\b/i;
/** 別人去機場（「我老公去機場了」「他剛到機場」）：不是要排自己的行程 */
const AIRPORT_OTHER = /(?:老公|老婆|先生|太太|爸爸?|媽媽?|朋友|同學|同事|兒子|女兒|小孩|別人|(?<![其吉])[他她])們?(?:已經|剛剛?|正在|在)?(?:去|到)機場(?!怎|要怎|要多久|的路)/;
const AIRPORT_MRT = /機場捷運|機捷/;
/**
 * 沒說哪個機場的行程：{ from, fromSaved?, to: null, airport: true }；句子裡另有一個地名當起點（「我在板橋，要去機場」）、
 * 「從家／公司去機場」用常用地點的座標；說了搭機場捷運就是桃園機場（不問）。不是行程的句子回 null。
 */
function airportTrip(s, places, { en = false, saved = null } = {}) {
  const t = s.trim();
  if (!(en ? AIRPORT_EN : AIRPORT_GO).test(t) || places.some(isAirportName)) return null;
  if ((en ? AIRPORT_NOT_TRIP_EN : AIRPORT_NOT_TRIP).test(t) || (!en && AIRPORT_OTHER.test(t))) return null;
  if (places.length > 1) return null;
  const savedKey = !en && /從/.test(t) ? Object.keys(SAVED_FROM).find((k) => SAVED_FROM[k].test(t)) : null; // 「從家去機場」「從我家到機場」「從公司去機場」
  if (savedKey && !saved?.[savedKey]) return { intent: 'savedMissing', missing: savedKey }; // 手機沒設定：照實說（不猜）
  const fromSaved = savedKey ? { lat: saved[savedKey].lat, lon: saved[savedKey].lon, name: savedKey } : null;
  const from = savedKey || (en ? (places[0] && /\bfrom\b|\bI'?m (?:at|in)\b/i.test(t) ? places[0] : null) : places[0] || FROM_TEXT.exec(t)?.[1] || null);
  if (en ? /\bairport (?:mrt|metro)\b/i.test(t) : AIRPORT_MRT.test(t)) return { intent: 'trip', from, ...(fromSaved && { fromSaved }), to: '臺灣桃園國際機場', mode: 'metro' }; // 搭機場捷運去機場：桃園機場
  return { intent: 'trip', from, ...(fromSaved && { fromSaved }), to: null, airport: true };
}
/** 沒說哪一站的「火車站／高鐵站」（前面是去、到、往） */
const NEAR_RAIL = /(?:去|到|往)\s*(?:最近的?|附近的?)?\s*(?:火車站|[台臺]鐵站|高鐵站)|^(?:我要|我想)?\s*(?:最近的?|附近的?)?\s*(?:火車站|[台臺]鐵站|高鐵站)\s*(?:要)?(?:怎麼(?:去|走|到|坐|搭)|在哪)/; // 「高鐵站怎麼去」（PM 第三輪 #5）
const STATION_NAMES = new Set(LANDMARKS.items.filter((x) => x.kind === 'station').map((x) => x.name));
/** 離某點最近的台鐵站（TRA）或高鐵站（THSR）地標 */
export function nearestRail(p, system = 'TRA') {
  const ok = (x) => x.kind === 'station' && (system === 'THSR' ? [x.name, ...x.aliases].some((k) => /^高鐵/.test(k)) : /車站$/.test(x.name) && !/^(?:高鐵|捷運)/.test(x.name));
  const d = (x) => (x.lat - p.lat) ** 2 + ((x.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
  return LANDMARKS.items.filter(ok).sort((a, b) => d(a) - d(b))[0] || null;
}

/** 短名同時是高鐵站與火車站（「桃園」「新竹」）時，使用者人在那座城市（離某一站 10 公里內）就用離他近的那一站 */
const LOCAL_STATION_M = 10_000;
/**
 * 行程的起訖點是短名對到的車站（「桃園到台北101」的「桃園」→ 高鐵桃園站）：有定位、人就在那座城市時改用離他近的那一站
 * （在桃園市區 → 桃園車站；真實資料健檢 z11）。說了全名（「高鐵桃園站」「桃園火車站」）不改。會直接改 it。
 * @param {object} it parseIntent 的結果 @param {string} text 這一句 @param {{ lat: number, lon: number }} pt 使用者位置
 */
export function localStations(it, text, pt) {
  if (it?.intent !== 'trip' || !Number.isFinite(pt?.lat)) return it;
  const near = (x) => distanceM(pt.lat, pt.lon, x.lat, x.lon);
  for (const k of ['from', 'to']) {
    const cands = shortStationCands(it[k], text);
    const best = cands && [...cands].sort((a, b) => near(a) - near(b))[0];
    if (best && best.name !== it[k] && near(best) <= LOCAL_STATION_M && best.name !== it[k === 'from' ? 'to' : 'from']) it[k] = best.name;
  }
  return it;
}
/** 行程的起訖有沒有短名對到的車站（要定位才知道是哪一站）：runDemo 據此先請手機定位 */
export const hasShortStation = (it, text) => it?.intent === 'trip' && ['from', 'to'].some((k) => shortStationCands(it[k], text));
/** 地名是短名（句子裡沒有全名）對到、而且同一個短名有兩個以上的台鐵／高鐵站：回那些站；否則 null */
function shortStationCands(name, text) {
  const item = typeof name === 'string' && landmarkOf(name);
  if (!item || item.kind !== 'station' || /^捷運/.test(item.name)) return null;
  const t = normPlace(text);
  const keys = [item.name, ...item.aliases].filter((a) => !ASCII.test(a));
  if (keys.some((a) => t.includes(normPlace(a)))) return null; // 說了全名
  const tok = keys.map(short).filter((x) => x.length >= 2 && t.includes(x)).sort((a, b) => b.length - a.length)[0];
  if (!tok) return null;
  const cands = LANDMARKS.items.filter((x) => x.kind === 'station' && !/^捷運/.test(x.name) && [x.name, ...x.aliases].some((a) => !ASCII.test(a) && short(a) === tok));
  return cands.length >= 2 ? cands : null;
}

/** 「去中山」這種短名：地標庫包含這個名字的地點（2～4 個）＋規則原本對到的那個（def） */
function ambigOf(s, def) {
  const d = destToken(s);
  const lk = d && lookupToken(d.token);
  if (!lk?.cands) return null;
  return { token: d.token, core: lk.core, names: lk.cands.includes(def) ? lk.cands : [def, ...lk.cands].slice(0, 4), def };
}
/** 整句只有地名（加上語氣詞、狀態詞）：當成「要去那裡」 */
function onlyPlace(s, places) {
  let rest = normPlace(s); // 地名可能是別名（「松山機場」→ 臺北松山機場）：用比對時的字去掉
  for (const { key, name } of PLACE_KEYS) if (places.includes(name)) rest = rest.split(key).join('');
  for (const [, re] of STATE_WORDS) rest = rest.replace(new RegExp(re.source, 'g'), '');
  rest = rest.replace(PARTY_WORDS, ''); // 「三個人去西門町」「一家五口」
  return !rest.replace(/[我要想去到往帶很有點一下吧嗎呢啦了的，,。.!！?？\s]/g, '');
}
/** 「臺北市大安區」「大安區」→ 藥局搜尋的地區 */
const AREA = /((?:[一-龥]{2}[市縣])?(?<![的近個])(?!的|社|園|校|風)[一-龥]{1,2}[區鄉鎮])/; // 「附近的社區藥局」「園區」不是行政區
// 22 縣市（可省略「市／縣」：「花蓮地震」；比對時臺／台視為相同）
const COUNTY = /((?:臺|台)北|新北|桃園|(?:臺|台)中|(?:臺|台)南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|(?:臺|台)東|澎湖|金門|連江)[市縣]?/;
export const countyOf = (s) => COUNTY.exec(s)?.[0];
const INVOICE_NO = /(?:^|\D)(\d{8}|\d{3})(?!\d)/;
// 股市：去掉口語與行情字眼，剩下的就是股票名稱或代號（「台積電和 0050 今天收盤多少」→「台積電、0050」）
const STOCK_FILLER = /^(?:所以|那麼|那(?!斯達克))|收(?:多少|在多少|幾塊|了多少)|今天|昨天|今日|現在|目前|最新|最近|股價|股票|股市|[台臺]股|大盤|加權指數|櫃買指數|指數|收盤價?|行情|報價|價格|走勢|表現|漲停|跌停|漲|跌|多少錢?|一股|每股|一張|幾塊|幾元|怎麼樣|如何|查詢|查一下|查|幫我|請問|看一下|看看|看|一下|要不要|該不該|可不可以|可以|能不能|值得|推薦|建議|會不會|明牌|進場|出場|買點|賣點|買|賣|有沒有|還|該|會|嗎|呢|吧|啊|了|的|我|\bETF\b/gi;
export const stockQueryOf = (s) => String(s).replace(STOCK_FILLER, '、').split(/[、,，;；\s？?。！!和跟與及]+/).filter((w) => (/^\d/.test(w) ? /^\d{4}/.test(w) : w.length >= 2)).slice(0, 5).join('、');
const STOCK_ADVICE = /該不該|要不要買|可以買|能買|值得買|該買|該賣|推薦|明牌|會漲|會跌|進場|出場|買點|賣點/;
export const NO_ADVICE = '阿幫不提供投資建議，只能報開放資料的收盤數字：';

// 地標名稱與別名，長的優先（「台北車站」先於「台北」）
// 車站另加去掉「高鐵／捷運」與「車站／站」的短名（「左營」→ 高鐵左營站）；同長度時完整名稱優先
const short = (k) => normPlace(k).replace(/^(高鐵|捷運)/, '').replace(/(車站|站)$/, '');
const ASCII = /^[\x20-\x7e]+$/;
const PLACE_KEYS = LANDMARKS.items
  .flatMap((x) => [x.name, ...x.aliases].filter((k) => !ASCII.test(k)).flatMap((k) => [
    { key: normPlace(k), name: x.name, full: true },
    ...(x.kind === 'station' ? [{ key: short(k), name: x.name, full: false }] : []),
  ]))
  .filter((k) => k.key.length >= 2)
  .sort((a, b) => b.key.length - a.key.length || b.full - a.full);

/** 文字中出現的地標（依出現順序、不重疊、同一地標只算一次） */
/** 英文別名：比對整個字（字的邊界、空白可有可無），長的優先（「Taipei 101」先於「Taipei」） */
const EN_KEYS = LANDMARKS.items
  .flatMap((x) => x.aliases.filter((k) => ASCII.test(k) && /[A-Za-z]/.test(k)).map((k) => ({ re: new RegExp(`(?<![a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}(?![a-z0-9])`), len: k.length, name: x.name })))
  .sort((a, b) => b.len - a.len);
/** 純數字的地名別名（「101」＝台北101）：前後不是數字、後面不是公車說法（「101 到哪了」可能是公車）時才算（P2-3、P2-6） */
const NUM_PLACES = LANDMARKS.items.flatMap((x) => x.aliases.filter((k) => /^\d{3,}$/.test(k)).map((k) => ({ re: new RegExp(`(?<!\\d)${k}(?!\\d)(?!\\s*(?:號|路|${BUS_ASK}|bus|is\\s+coming))`, 'i'), name: x.name })));
function englishPlaces(text) {
  let t = String(text).toLowerCase();
  const hits = [];
  for (const { re, name } of EN_KEYS) {
    const m = re.exec(t);
    if (!m || hits.some((h) => h.name === name)) continue;
    hits.push({ name, index: m.index });
    t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length); // 用過的字遮掉（「Taipei 101」不會再對到「Taipei」）
  }
  // 數字別名最後比（「Taipei 101」已整個用掉，不會拆成 Taipei＋101）
  for (const { re, name } of NUM_PLACES) { const m = re.exec(t); if (m && !hits.some((h) => h.name === name) && !/bus\s*$/i.test(t.slice(0, m.index))) hits.push({ name, index: m.index }); }
  return hits;
}

export function placesInText(text) {
  return placeHits(text).map((h) => h.name);
}

/**
 * 句子裡的地點與位置（位置與長度以 normPlace(text) 為準；英文沒有長度）。
 * @returns {Array<{ name: string, index: number, len?: number }>}
 */
function placeHits(text) {
  if (isEnglish(String(text))) return englishPlaces(text).sort((a, b) => a.index - b.index);
  // 「三十分鐘內」的「十分」不是十分老街：時間說法先遮掉（長度不變）
  const s = normPlace(text).replace(/[0-9一二兩三四五六七八九十半]+\s*分鐘?|太魯閣號|普悠瑪號?/g, (x) => ' '.repeat(x.length)); // 車名「太魯閣號」不是太魯閣（PM 第三輪 #1）
  const taken = new Array(s.length).fill(false);
  const hits = [];
  for (const { key, name, full } of PLACE_KEYS) {
    let i = s.indexOf(key);
    while (i >= 0) {
      const road = !full && /[路街巷]/.test(s[i + key.length] || ''); // 「中山路」不是捷運中山站（車站的短名後面接路、街）
      if (!road && !taken.slice(i, i + key.length).some(Boolean) && !hits.some((h) => h.name === name)) {
        for (let j = i; j < i + key.length; j++) taken[j] = true;
        hits.push({ name, index: i, len: key.length });
      }
      i = s.indexOf(key, i + 1);
    }
  }
  for (const { re, name } of NUM_PLACES) { // 「到101」「101怎麼去」：沒被別的地名用掉的數字別名
    const m = re.exec(s);
    if (m && !taken[m.index] && !hits.some((h) => h.name === name)) hits.push({ name, index: m.index, len: m[0].length });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** 兩個地點的起訖：「從 X」「X 出發」是起點，「去／到／往 Y」是終點；看不出來照出現順序（「X 到 Y」） */
function orderFromTo(s0, places) {
  // 位置用使用者說的字（「從台中」裡找不到正式名稱「臺中車站」：原本會照出現順序，把「我要去板橋 從台中」排反，PM 第三輪 #2）
  const s = normPlace(s0);
  const hits = isEnglish(String(s0)) ? [] : placeHits(s0);
  const hit = (p) => hits.find((h) => h.name === p);
  const at = (p) => hit(p)?.index ?? s.indexOf(normPlace(p));
  const len = (p) => hit(p)?.len ?? normPlace(p).length;
  const from = places.find((p) => at(p) >= 0 && (/從\s*$/.test(s.slice(0, at(p))) || /^\s*出發/.test(s.slice(at(p) + len(p)))));
  const to = places.find((p) => p !== from && at(p) >= 0 && /(?:去|到|往|抵達)\s*$/.test(s.slice(0, at(p))));
  if (from && to) return [from, to];
  if (from) return [from, places.find((p) => p !== from)];
  if (to && !/^(?:到|去|往)/.test(s.trim())) return [places.find((p) => p !== to), to];
  return places.slice(0, 2);
}

/** 中文數字（一～五十九、兩）→ 數字；阿拉伯數字照轉；看不懂回 NaN */
export function zhNum(t) {
  if (/^\d+$/.test(t)) return Number(t);
  const D = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = /^([一二三四五六七八九]?)(十?)([一二兩三四五六七八九]?)$/.exec(t);
  if (!m || !t) return NaN;
  if (!m[2]) return m[1] && m[3] ? NaN : D[m[1] || m[3]] ?? NaN; // 「三」「九」
  return (m[1] ? D[m[1]] : 1) * 10 + (m[3] ? D[m[3]] : 0); // 「十」「十二」「二十五」
}

/**
 * 抵達時間 → 'HH:mm'：「8 點前」「8:30 前」「早上 8 點半前」「九點半前」「下午兩點前到」「早上10點到」「10點要到」。
 * 只認「前」或「到／抵達」（「10點出發」是出發時間，不算）。下午、晚上、傍晚的 1～11 點加 12。
 */
/** 解析時的現在時間（parseIntent 的 ctx.now；「20 分鐘後」「in 30 minutes」換成幾點） */
let parseNow = null;
/** 相對時間（分鐘）：「20 分鐘後／內」「半小時內」「一小時後」「in 30 minutes」「within 15 min」；沒有回 null */
export function relMinutes(text) {
  const s = String(text || '');
  const zh = /(\d{1,3}|[一二兩三四五六七八九十]{1,3})\s*分(?:鐘)?\s*(?:後|以?內)/.exec(s);
  if (zh) { const n = zhNum(zh[1]); return Number.isFinite(n) && n > 0 && n <= 180 ? n : null; }
  if (/半\s*(?:個)?\s*(?:小時|鐘頭)\s*(?:後|以?內)/.test(s)) return 30;
  const zhH = /(\d|[一兩二三])\s*(?:個)?\s*(?:小時|鐘頭)\s*(?:後|以?內)/.exec(s);
  if (zhH) { const n = zhNum(zhH[1]) * 60; return n > 0 && n <= 180 ? n : null; }
  const en = /\b(?:in|within)\s+(\d{1,3})\s*(?:min|mins|minutes)\b/i.exec(s);
  if (en) return Number(en[1]) > 0 && Number(en[1]) <= 180 ? Number(en[1]) : null;
  if (/\b(?:in|within)\s+half\s+an\s+hour\b/i.test(s)) return 30;
  if (/\b(?:in|within)\s+an\s+hour\b/i.test(s)) return 60;
  return null;
}
/** 相對時間 → 幾點（台灣時間）；parseIntent 沒給現在時間就用現在 */
/** 相對時間是不是「要到（或車要開）」：「20 分鐘後開」「半小時內要到」「be there in 30 minutes」算；「半小時後出發」「十分鐘內走得到」不算 */
const REL_ARRIVE_ZH = /(?:分(?:鐘)?|小時|鐘頭)\s*(?:後|以?內)\s*(?:就|要|得|才|會|必須)?\s*(?:到|抵達|開|發車)/;
const REL_ARRIVE_EN = /\b(?:be there|get there|arrive|be at|reach|make it)\b[^.?!]*\b(?:in|within)\s|\b(?:leaves?|departs?)\s+(?:in|within)\s/i;
const relArrive = (text) => { const s = String(text || ''); const m = relMinutes(s); return m && (REL_ARRIVE_ZH.test(s) || REL_ARRIVE_EN.test(s)) ? nowTW((parseNow ?? Date.now()) + m * 60e3).hhmm : null; };

export function arriveByOf(text, now = Date.now()) {
  const N = '\\d{1,2}|[一二兩三四五六七八九十]{1,3}';
  const m = new RegExp(`(${N})\\s*(?:[點:：時])\\s*(半|${N})?\\s*分?\\s*(?:以前|之前|前|(?:要|會|得)?(?:到|抵達))`).exec(text);
  if (!m) return relArrive(text); // 「20 分鐘後開，來得及嗎」「半小時內要到」
  let h = zhNum(m[1]);
  const min = m[2] === '半' ? 30 : m[2] ? zhNum(m[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (/下午|晚上|傍晚/.test(text) && h < 12) h += 12;
  // 沒說早晚、今天這個時間已經過了、加 12 小時還沒到 → 下午／晚上（PM 第二輪：15:00 說「六點要到」被當成 06:00；與出發時間同一套）
  else if (h >= 1 && h < 12 && !/早上|上午|凌晨|清晨|明天|明早|後天/.test(text)) {
    const tw = new Date(now + 8 * 3600e3), cur = tw.getUTCHours() * 60 + tw.getUTCMinutes();
    if (h * 60 + min < cur && (h + 12) * 60 + min > cur) h += 12; // 剛好是現在（10:00 說「10點前到」）照說的
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 出發時間的說法：時間後面接出發、從、去、坐…（「明天早上8點出發」「晚上8點從西門町去101」「08:30 出門」）；接「前／到」的是抵達時間（arriveByOf） */
const DEP_N = '\\d{1,2}|[一二兩三四五六七八九十]{1,3}';
const DEPART = new RegExp(`(今天|今晚|明天|明早|明晚|明日)?\\s*(早上|上午|中午|下午|晚上|傍晚|凌晨|午夜|半夜|深夜)?\\s*(${DEP_N})\\s*[點:：時]\\s*(半|${DEP_N})?\\s*分?\\s*(?:左右)?\\s*(?:就|再|要|會|準備)?\\s*(?=出發|出門|離開|動身|從|去(?!程)|坐|搭|騎|走(?!路)|叫車)`);
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/**
 * 出發時間（P5-2）：{ hhmm, tomorrow, days }；days＝幾天後（0 今天、1 明天、2 後天：「明天晚上12點」＝後天 00:00）。
 * 晚上／午夜／半夜 12 點＝隔天 00:00。沒說哪一天時依現在推：沒說早晚、這個時間已過而加 12 小時還沒到 → 下午／晚上
 * （10:00 說「8點出發」＝20:00）；還是過了 → 明天。同一句有抵達時間（arriveBy）時，出發要在抵達之前
 * （「8點前要到，7點出發」＝07:00）；推不出合理的出發時間就不採用。沒有回 null。
 * @param {string} text
 * @param {string|null} [arriveBy] 'HH:mm'
 * @returns {{ hhmm: string, tomorrow: boolean, days: number }|null}
 */
export function departTimeOf(text, arriveBy = null, nowMs = parseNow) { // nowMs：現在時間（測試或示範時鐘指定；預設這一輪的 parseNow）
  const s = String(text || '');
  const m = DEPART.exec(s);
  if (!m) return null;
  let h = zhNum(m[3]);
  const min = m[4] === '半' ? 30 : m[4] ? zhNum(m[4]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59 || h > 24) return null;
  const day = m[1] || (/明天|明早|明晚|明日/.test(s) ? '明天' : /今天|今晚/.test(s) ? '今天' : '');
  const period = m[2] || (/今晚|明晚/.test(m[1] || '') ? '晚上' : '');
  let days = /明/.test(day) ? 1 : 0;
  if ((/晚上|午夜|半夜|深夜/.test(period) && h === 12) || h === 24) { h = 0; days += 1; } // 晚上 12 點＝隔天 00:00
  else if (/下午|晚上|傍晚/.test(period) && h < 12) h += 12;
  else if (period === '中午' && h < 6) h += 12;
  else if (/凌晨|午夜|半夜/.test(period) && h === 12) h = 0;
  if (h > 23) return null;
  const twelve = !period && h < 12 && !/[:：]/.test(m[0]) && !/^0/.test(m[3]); // 沒說早晚、不是 24 小時制寫法：可能是下午、晚上
  if (arriveBy) { // 有抵達時間：出發選在抵達之前（同一天），選不到就不採用
    const arr = Number(arriveBy.slice(0, 2)) * 60 + Number(arriveBy.slice(3, 5));
    const t = [...(twelve ? [h + 12] : []), h].map((x) => x * 60 + min).find((x) => x < arr && x >= arr - 6 * 60);
    return t == null || days !== (/明/.test(day) ? 1 : 0) ? null : { hhmm: hm(t), tomorrow: days >= 1, days };
  }
  if (!day && days === 0) { // 沒說哪一天：已經過了的時間往後推
    const now = nowTW(nowMs ?? Date.now()).hhmm;
    const cur = Number(now.slice(0, 2)) * 60 + Number(now.slice(3, 5));
    const at = (x) => x * 60 + min;
    if (at(h) < cur - 30) {
      if (twelve && at(h + 12) >= cur - 30) h += 12; // 「08:30」是 24 小時制，不加 12
      else days = 1;
    }
  }
  return { hhmm: hm(h * 60 + min), tomorrow: days >= 1, days };
}

/** 一句問好幾件事：用標點或「還有、順便、然後、再看、先查」分段（P5-8）；「跟、和」不切（「台積電和 0050」），改在同一段裡找多個意圖 */
const MULTI_SPLIT = /[、，,；;。？?！!～~]|還有|順便|然後|另外|再幫我|(?:先|再)(?:查|看)(?:一下)?/;
/** 可以一起查的意圖（不用再問地點以外的參數）；主要意圖的優先序：行程、公車、天氣、空品，其餘照說的順序 */
const MULTI_OK = ['bus_route', 'weather', 'aqi', 'fuel', 'quake', 'invoice', 'stock'];
export const ALSO_TOOL = { bus_route: () => 'bus_route_eta', weather: (x) => (x.tomorrow ? 'weather_tomorrow' : 'weather_now'), aqi: () => 'aqi_nearby', fuel: () => 'fuel_price', quake: () => 'earthquake_recent', invoice: () => 'invoice_lottery', stock: () => 'stock_quote' };
/** 分段後只剩路線號碼（「先查307，再看油價」的「307」） */
const BARE_ROUTE = new RegExp(`^(?:也|順便)?\\s*(${ROUTE_NO})\\s*(?:號|路)?\\s*(?:公車)?\\s*(?:呢|咧)?$`);
/** 「307 跟 299 還要多久」：連在一起的幾條路線 */
const ROUTE_LIST = new RegExp(`(${ROUTE_NO})\\s*(?:號|路)?\\s*(?:跟|和|與|、|及)\\s*(?=${ROUTE_NO})`, 'g');
/** 一段話裡的意圖：規則判斷的那個，加上同一段裡其他可以一起查的（「油價跟天氣」「油價和發票」「307 跟 299」） */
function clauseIntents(p) {
  const it = parseIntentRaw(p, { history: [], noMulti: true });
  const out = it.intent !== 'unknown' ? [it] : [];
  if (!out.length) { const r = BARE_ROUTE.exec(p)?.[1]; if (r) out.push({ intent: 'bus_route', route: r }); }
  if (it.intent === 'trip') return out; // 行程那段不再拆（「去加油站」「下雨了，去…」）
  if (it.intent === 'bus_route') { // 照說的順序：「307 跟 299」主要是 307
    const listed = [...p.matchAll(ROUTE_LIST)].map((m) => m[1]).filter((r) => r !== it.route);
    out.unshift(...listed.map((route) => ({ intent: 'bus_route', route })));
  }
  const more = [];
  for (const [k, re] of LIFE_WORDS) if (MULTI_OK.includes(k) && re.test(p) && !out.some((x) => x.intent === k)) more.push({ at: re.exec(p).index, it: lifeIntent(p, k) });
  if (WEATHER_WORD.test(p) && !out.some((x) => x.intent === 'weather')) more.push({ at: WEATHER_WORD.exec(p).index, it: { intent: 'weather', tomorrow: /明天|明早|明晚|明日/.test(p) } });
  // 同一段的意圖照說的順序（「油價和發票」先油價）
  const pos = (x) => { const re = x.intent === 'weather' ? WEATHER_WORD : LIFE_WORDS.find(([k]) => k === x.intent)?.[1]; const i = x.route ? p.indexOf(x.route) : re ? (re.exec(p)?.index ?? -1) : -1; return i < 0 ? 0 : i; };
  return [...out.map((x) => ({ at: pos(x), it: x })), ...more].sort((a, b) => a.at - b.at).map((x) => x.it);
}
/**
 * 一句問好幾件事：每一段各自解析；有兩種以上可以一起查的意圖時，回主要意圖＋ also（其他要一起查的）。
 * 有行程時行程優先（用整句解析，條件不漏），其他生活資料放 also（天氣、空品行程本來就會看，不重複）。
 * 公車＋天氣沿用 alsoWeather（P2-2）。有出門建議、藥局、高鐵等要另外追問的，或沒有多件事，回 null。
 */
function multiOf(s, base, ctx) {
  const parts = s.split(MULTI_SPLIT).map((x) => x?.trim()).filter((x) => x && x.length >= 2);
  const segs = (parts.length ? parts : [s]).map((p) => ({ p, its: clauseIntents(p) }));
  const its = segs.flatMap((x) => x.its);
  if (its.some((x) => x.intent !== 'trip' && !MULTI_OK.includes(x.intent))) return null;
  const key = (x) => `${x.intent}|${x.route || ''}|${x.query || ''}|${x.number || ''}`;
  const uniq = its.filter((x, i) => its.findIndex((y) => key(y) === key(x)) === i);
  if (uniq.length < 2) return null;
  const strip = ({ places: _p, states: _s, arriveBy: _a, departTime: _d, departDays: _dd, party: _pa, later: _l, ...x }) => x;
  if (uniq.some((x) => x.intent === 'trip')) { // 行程優先：整句當行程，其他放 also
    // 行程用整句裡跟行程有關的那幾段解析（生活資料那段不混進來，否則「油價」會先被判成油價）；狀態、人數看整句
    const tripText = segs.filter((x) => !x.its.length || x.its.some((y) => y.intent === 'trip')).map((x) => x.p).join('，');
    const full = parseIntentRaw(tripText, { ...ctx, noMulti: true });
    const also = uniq.filter((x) => x.intent !== 'trip' && x.intent !== 'weather' && x.intent !== 'aqi').map(strip);
    return full.intent === 'trip' && also.length ? { ...full, states: [...new Set([...(full.states || []), ...base.states])], ...(base.party && { party: base.party }), also } : null;
  }
  const main = ['bus_route', 'weather', 'aqi'].map((k) => uniq.find((x) => x.intent === k)).find(Boolean) || uniq[0];
  const rest = uniq.filter((x) => x !== main);
  const alsoWeather = main.intent === 'bus_route' && rest.some((x) => x.intent === 'weather' && !x.tomorrow);
  const also = rest.filter((x) => !(alsoWeather && x.intent === 'weather')).map(strip);
  const { tomorrow: _t, ...slots } = strip(main);
  return { ...base, ...slots, ...(main.intent === 'weather' && { tomorrow: main.tomorrow }), ...(alsoWeather && { alsoWeather: true }), ...(also.length && { also }) };
}

/** 生活服務意圖與參數（沒有符合回 null） */
function lifeIntent(s, only = null) {
  const cl = (!only || only === 'pharmacy') && !PHARMACY_WORD.test(s) && clinicOf(s); // 「附近有開的小兒科」：找診所（藥局照舊）
  if (cl && !LIFE_WORDS.some(([k, re]) => k !== 'pharmacy' && re.test(s))) return { intent: 'pharmacy', ...cl, area: AREA.exec(s)?.[1] || countyOf(s) };
  const hit = LIFE_WORDS.find(([k, re]) => (!only || k === only) && re.test(s));
  if (!hit) return null;
  const intent = hit[0];
  if (intent === 'invoice') { const number = INVOICE_NO.exec(s)?.[1]; return { intent, number, ...(!number && WIN_ASK.test(s) && { wantCheck: true }) }; } // 問有沒有中獎但沒給號碼：報這期號碼，順便問號碼
  if (intent === 'quake') return { intent, county: countyOf(s) };
  if (intent === 'pharmacy') return { intent, area: AREA.exec(s)?.[1] || countyOf(s), ...(/晚上|夜間|開到幾點|開到晚|晚一點|下班後/.test(s) && { evening: true }) }; // 「有沒有開到晚上」：回答說晚上有開的（P3-4）
  if (intent === 'stock') return { intent, query: stockQueryOf(s) || undefined, advice: STOCK_ADVICE.test(s) };
  return { intent };
}

// 找短劇（MyDrama，ADR-0019）：「最近有什麼好看的短劇」「有沒有甜寵劇」「推薦一部短劇」「《夜班公車的約定》在演什麼」
export const DRAMA_GENRES = ['甜寵', '霸總', '懸疑', '重生', '逆襲', '復仇', '穿越', '古裝', '喜劇', '奇幻', '愛情', '家庭', '都市', '萌寶', '戰神', '職場', '校園', '青春', '宮鬥', '虐戀', '搞笑'];
const DRAMA_WORD = new RegExp(`短劇|微短劇|追劇|MyDrama|(?:${DRAMA_GENRES.join('|')})(?:的)?(?:短劇|劇)(?![院場團本])|(?:推薦|好看|熱門|最近|最新|新上架|完結|有什麼|有沒有|找|看)[^，,。？?！!]{0,6}(?:劇|連續劇)(?![院場團本烈情痛增])`, 'i');
const DRAMA_DETAIL = /演什麼|在講什麼|講什麼|簡介|劇情|好看嗎|在演/;
/** 找短劇的參數：《劇名》→ 搜尋（問劇情再看簡介）；類型 → 搜尋；新劇／完結／台灣自製 → 排行；其他 → 熱門排行 */
function dramaSlots(s) {
  const title = /《([^》]{1,30})》/.exec(s)?.[1]?.trim();
  if (title) return { dramaQuery: title, ...(DRAMA_DETAIL.test(s) && { dramaDetail: true }) };
  const genre = DRAMA_GENRES.find((g) => s.includes(g));
  if (genre) return { dramaQuery: genre === '搞笑' ? '喜劇' : genre };
  const list = /新劇|最新|新上架|剛上架|新出的|新的/.test(s) ? 'new' : /完結|一次看完|追完|一口氣/.test(s) ? 'completed' : /台灣|臺灣|國產|本土|自製/.test(s) ? 'taiwan' : null;
  if (list) return { dramaList: list };
  // 其他想找的題材（「有沒有殭屍的短劇」）：去掉找劇的套話，剩下 2～8 個字就拿去搜尋
  const rest = s.replace(DRAMA_FILLER, '').trim();
  return /^[一-龥A-Za-z]{2,8}$/.test(rest) ? { dramaQuery: rest } : { dramaList: 'hot' };
}
const DRAMA_FILLER = /MyDrama|阿幫|等公車|等捷運|等車|無聊|通勤|打發時間|殺時間|路上|的時候|時候|適合|請問|請|幫我|給我|我想要|我想|想要|想|可以|有沒有|有什麼|什麼|最近|推薦|介紹|一部|幾部|一齣|好看|熱門|很紅|紅的|追劇|微短劇|短劇|連續劇|劇|找|看看|看|一下|類型|題材|那種|的|嗎|呢|吧|啊|啦|喔|哦|耶|[\s？?！!，,。～~]/gi;
/** 是不是在找短劇（問路線的「怎麼去」不算） */
// 不是找短劇：表演藝術（去看歌劇、京劇、舞台劇…）、場館
const NOT_DRAMA = /歌劇|京劇|舞台劇|兒童劇|音樂劇|話劇|布袋戲|歌仔戲|偶戲|戲曲|劇院|劇場|劇團|藝文中心|演藝廳|音樂廳/;
// 句子在問交通或天氣（搭、坐、捷運、怎麼去、會下雨…），或要去某個地方：交給行程、天氣，不判找劇
const TRAVEL_OR_WEATHER = /搭|坐(?!著)|捷運|公車|客運|火車|高鐵|台鐵|臺鐵|計程車|叫車|YouBike|怎麼去|怎麼走|怎麼到|怎麼坐|要多久|多遠|下雨|天氣|氣溫|帶傘|幾點到|出發|(?:^|[，,。\s]|我|要|想|明天|今天|晚上|等一下)(?:去|到)(?![看追找])\S/i;
/**
 * 是不是在找短劇（「《劇名》在演什麼」也算）。表演藝術、場館、交通與天氣的問題、說了要去的地名（沒有《劇名》）都不算。
 * @param {string} s
 * @param {string[]} [places] 句子裡認得的地名
 */
export function isDramaAsk(s, places = []) {
  const t = String(s || '');
  const titled = /《[^》]{1,30}》/.test(t);
  if (!(DRAMA_WORD.test(t) || (titled && DRAMA_DETAIL.test(t)))) return false;
  const bare = t.replace(/《[^》]*》/g, '《》'); // 劇名裡的字（《捷運末班車》）不算交通
  if (NOT_DRAMA.test(bare) || TRAVEL_OR_WEATHER.test(bare.replace(/^等(?:公|捷運)?車/, ''))) return false; // 「等車無聊，推薦短劇」的等車不是問交通
  return titled || !places.length;
}
/** 英文：「Any good short dramas?」；去劇院、問路、天氣、交通不算 */
const EN_DRAMA = /\b(?:short[- ]?)?dramas?\b|\bmydrama\b|something to watch/i;
const EN_NOT_DRAMA = /\b(?:theat(?:er|re)s?|opera|musicals?|concert|plays?|get to|go to|going to|how (?:do|can|should) i|directions?|take me|weather|rain|umbrella|bus|mrt|metro|subway|train|taxi|uber|walk|bike)\b/i;
export const isEnDramaAsk = (s) => EN_DRAMA.test(String(s || '')) && !EN_NOT_DRAMA.test(String(s || ''));

// 追問（「那聯發科呢？」「0056 呢」）：短句、沒有其他意圖時，沿用前面的股市提問
const FOLLOW_UP = /^(?:那|那麼|還有|再查|再看|換|也查)?\s*([^\s？?，,。！!]{2,12}?)\s*(?:呢|勒|咧|的呢|也查)?\s*[？?]?$/;
// 要有追問的語氣（「那…」「…呢」）或本身是代號，「謝謝」「好」不算
const FOLLOW_MARK = /^(?:那|那麼|還有|再查|再看|換|也查)|(?:呢|勒|咧)\s*[？?]?$|^\d{4,6}[A-Za-z]?\s*[？?]?$/;
const isFollowUp = (s) => FOLLOW_UP.test(s) && FOLLOW_MARK.test(s);
/** 往回找使用者上一個「不是追問」的提問；是股市就回 true */
/** 前一句在問公車：「那 299 咧」「換 紅30 呢」接著查那一路（P2-1） */
const BUS_FOLLOW = /^(?:那|那麼|換|還有|再看)?\s*([紅藍綠棕橘小幹]?\d{1,4}[區副]?)\s*(?:號|路)?\s*(?:呢|咧|勒|的呢)?\s*[？?]?$/;
function followsBus(history = []) {
  const i = history.findLastIndex((x) => x.role === 'user');
  return i >= 0 && parseIntent(history[i].content, { history: history.slice(0, i) }).intent === 'bus_route'; // 帶前文：連續追問也認得
}
/** 要阿幫代替按、付、訂（只給官方連結，ADR-0011） */
const ACT_FOR_ME = /(?:直接|幫我|替我|你來|你去)\s*(?:按(?!照|時|順序|電梯|讚|鈕|最|一下讚)|叫好|下單|付(?:款|錢)|刷卡|訂(?:好|票)|買票)|代(?:付|訂|叫)|錢.{0,4}幫我付|幫我付.{0,6}錢|(?:錢|車資).{0,6}(?:轉給|付給)|刷卡買/;
const LIFE_LABEL = { pharmacy: '藥局', weather: '天氣', aqi: '空氣品質', garbage: '垃圾車', youbike: 'YouBike', nearby_bus: '公車站' };
/** 前一句問的生活服務（換地點接著問用） */
function followsLife(history = []) {
  const i = history.findLastIndex((x) => x.role === 'user');
  const k = i >= 0 && parseIntent(history[i].content, { history: history.slice(0, i) }).intent;
  return LIFE_LABEL[k] ? k : null;
}
/** 上一句使用者問的意圖（追問用） */
function lastUserIntent(history = []) {
  const i = history.findLastIndex((x) => x.role === 'user');
  return i >= 0 ? parseIntent(String(history[i].content), { history: history.slice(0, i) }) : null;
}
/** 最近一次查的股票（「那該不該買」沿用） */
function lastStockQuery(history = []) {
  const users = history.filter((x) => x.role === 'user');
  for (let i = users.length - 1; i >= 0; i--) {
    const it = parseIntent(String(users[i].content), { history: history.slice(0, history.indexOf(users[i])) });
    if (it.intent === 'stock' && it.query) return it.query;
    if (it.intent !== 'stock') return undefined;
  }
  return undefined;
}
function followsStock(history = []) {
  for (const m of history.filter((x) => x.role === 'user').reverse()) {
    const it = parseIntent(m.content);
    if (it.intent === 'stock') return true;
    if (it.intent !== 'unknown' || !isFollowUp(String(m.content).trim())) return false;
  }
  return false;
}

/**
 * 解析一句話；ctx.history（之前的訊息）用來接追問。
 * @returns {{ intent: 'trip'|'bus_route'|'youbike'|'nearby_bus'|'metro'|'rail'|'weather'|'aqi'|'quake'|'pharmacy'|'garbage'|'fuel'|'invoice'|'stock'|'unknown',
 *            places: string[], states: string[], arriveBy: string|null, tomorrow: boolean, route?: string, system?: 'THSR'|'TRA', from?: string, to?: string,
 *            station?: string, number?: string, county?: string, area?: string, query?: string, advice?: boolean }}
 */
export function parseIntent(text, ctx) {
  const outer = parseNow;
  if (ctx?.now != null) parseNow = ctx.now; // 「20 分鐘後」換成幾點用這一輪的現在時間（示範時鐘、測試可指定）
  let it;
  try { it = parseIntentRaw(text, ctx); } finally { parseNow = outer; }
  // 前面說過的「人」的狀況（腳不方便、帶長輩、帶小孩、帶行李）是同一個人、同一趟：新的行程也算進去（P3-3；「重來」之後不算）
  // 只看最近兩句；這一句是幫別人問（朋友、他、不帶…）或說要重來就不帶
  if (it?.intent === 'trip' && ctx?.history?.length && !OTHER_PERSON.test(String(text)) && !/^(?:重來|重新開始|從頭)/.test(String(text).trim())) {
    const users = ctx.history.filter((m) => m.role === 'user').map((m) => String(m.content));
    const r = users.findLastIndex((t) => RESET.test(t.trim()));
    const said = users.slice(Math.max(r + 1, users.length - 2)).join('\n');
    const keep = STATE_WORDS.filter(([k, re]) => LASTING_STATES.has(k) && re.test(said)).map(([k]) => k);
    if (keep.length) it.states = [...new Set([...(it.states || []), ...keep])];
  }
  // 附近查詢說了「我家／公司／學校這邊」：用常用地點的座標，不用現在位置（P3-2「今天垃圾車幾點會到我家這邊」）
  if (it && ctx?.saved && SAVED_NEARBY.has(it.intent) && !it.places?.length) {
    const k = Object.keys(SAVED_WORDS).find((x) => ctx.saved[x] && new RegExp(`(?:^|[^\u4e00-\u9fa5]|我|回)${x}(?:這邊|那邊|附近|旁邊|周邊|這裡|那裡)`).test(String(text)));
    if (k) { it.fromPoint = { lat: ctx.saved[k].lat, lon: ctx.saved[k].lon, name: k }; it.savedAt = k; }
  }
  if (it?.intent === 'fuel') { // 只問一種油（「92 一公升多少」）、問漲跌（「這禮拜油價漲還跌」）
    const g = !it.grade && (/柴油/.test(String(text)) ? '柴油' : String(text).match(/(?<!\d)(?:92|95|98)(?!\d)/)?.[0]);
    if (g) it.grade = g;
    if (/漲|跌|調/.test(String(text))) it.trend = true;
  }
  if (it?.intent === 'bus_route' && !it.stop) { const st = busStopOf(text); if (st) it.stop = st; }
  if (it?.intent === 'trip' && it.followUp && !it.to && !it.nearRail && !it.airport && !it.toSaved && !it.needs) it.needs = 'to'; // 接著改條件但目的地還沒說（只說過起點）：再問一次要去哪 // 「307 公車到「敦化市場」還要多久」（阿幫會看：拍站牌組出來的問題，M14-02）
  if (it && !isEnglish(String(text || ''))) delete it.lang;
  if (it?.intent === 'trip' && !ctx?.intent && TRAFFIC.test(String(text)) && TRAFFIC_Q.test(String(text))) it.roadAsk = true; // 「從板橋去台北車站坐公車會不會塞車」：排行程，總結說市區路況查不到
  if (it?.intent === 'trip' && ['tra', 'thsr'].includes(it.mode)) modeStations(it, String(text)); // 「坐火車去桃園」：桃園車站（不是高鐵桃園站）
  return it;
}
/** 指定坐台鐵／高鐵、起訖是短名車站（「坐火車去桃園」）：用那個系統的站 */
function modeStations(it, text) {
  const thsr = it.mode === 'thsr';
  for (const k of ['from', 'to']) {
    const c = shortStationCands(it[k], text);
    const hit = c?.find((x) => [x.name, ...x.aliases].some((a) => /^高鐵/.test(a)) === thsr);
    if (hit) it[k] = hit.name;
  }
}
/** 問公車時說了哪一站：「307 公車到「敦化市場」還要多久」「307 公車在市政府站還要多久」（只收有引號或「…站」的，不猜） */
const STOP_QUOTED = /「([^」\s]{2,20})」/;
const STOP_SAID = /(?<!我)(?:到|在)\s*([一-龥]{2,12}站)(?=\s*(?:還|多久|要|幾分))/; // 「我在臺北車站」是使用者在哪，不是要盯的站
export function busStopOf(text) {
  const s = String(text || '');
  const m = STOP_QUOTED.exec(s)?.[1] || STOP_SAID.exec(s)?.[1];
  return m && !/^(?:公車|車)?站$/.test(m) ? m : null;
}
/**
 * 台語口語與常見錯字先換成華語（P5-3、P5-5）：在找地名、判斷是不是行程之前做，所以「台北車戰到西門町」也是行程、
 * 「松山機常」不會被當成松山車站。只換有明確上下文的字（「足球」「欲望」不動）。
 */
const NORMALIZE = [
  // 台語（P5-3）
  [/今仔日|今仔/g, '今天'], [/明仔早/g, '明天早上'], [/明仔(?:載|再)?/g, '明天'], [/下晡/g, '下午'], [/暗時|暗頭仔/g, '晚上'],
  [/敢會/g, '會不會'], [/敢有/g, '有沒有'], [/敢是/g, '是不是'],
  [/足(?=[熱冷寒好歹遠近濟少多慢緊久貴俗媠])/g, '很'], [/落雨/g, '下雨'],
  [/啥(?:物|麼|乜)?時陣/g, '什麼時候'], [/啥物|啥乜/g, '什麼'], [/猶未|閣未/g, '還沒'],
  [/欲(?=去|坐|搭|轉|到|來|揣|買|看|問|回|知)/g, '要'], [/揣(?!測|摩|度|想)/g, '找'], [/[按安]怎(?:樣)?/g, '怎麼'],
  [/佇佗位|佇佗/g, '在哪裡'], [/佗位/g, '哪裡'], [/火車頭/g, '火車站'], [/袂赴/g, '來不及'],
  // 台語（PM 第三輪 #5：長輩常這樣問，原本全部回萬用說明）
  [/欲[擱閣]/g, '還要'], [/[擱閣](?=偌|愛|有|會|要|幾|等)/g, '還'], [/偌久|偌濟時間/g, '多久'], [/偌濟/g, '多少'], [/愛(?=去|等|坐|搭|到|轉|買|看)/g, '要'],
  [/最尾(?:一)?班|尾(?:一)?班/g, '末班'], [/猶有/g, '還有'], [/(有[^，,。？?！!\s]{1,4})無(?=[？?。！!～~]?$)/g, '$1嗎'], [/(會[^，,。？?！!\s]{1,4})袂(?=[？?。！!～~]?$)/g, '$1嗎'],
  [/^阮兜|阮兜/g, '我家'], [/^阮(?=欲|要|想|去|佇|在|厝)/g, '我'], [/(?:轉去|轉來|回)(?:阮)?厝/g, '回家'], [/阮厝|我厝/g, '我家'], [/轉去(?=[一-龥])/g, '回'],
  [/病院/g, '醫院'], [/公車頭/g, '公車站'],
  // 常見錯字（P5-5）
  [/車戰|車佔|車棧/g, '車站'], [/機常|機廠|機昌|機腸/g, '機場'], [/捷運戰/g, '捷運站'], [/下一般(?=[車？?。，,！!\s]|$)/g, '下一班'],
];
export const normalizeAsk = (t) => NORMALIZE.reduce((s, [re, to]) => s.replace(re, to), String(t || ''));
/** 道謝、道歉、按讚（「謝謝阿幫」「歹勢」「👍」「🙏」）：回禮貌話，不列功能清單（P5-8） */
const THANKS = /^(?:(?:好|好啦|好的|好喔|嗯|ok|okay)[，,\s]*)?(?:謝謝|謝啦|謝了|感謝|多謝|感恩|3q|讚|好棒|太好了|👍|🙏|❤️|♥️|😊|🙂|🥰)+(?:你|妳|阿幫|喔|哦|啦|囉|唷|～|~|!|！|。|\s)*$/i;
/** 句首的禮貌詞（後面還有其他話時去掉） */
const COURTESY_HEAD = /^(?:謝謝|謝啦|謝了|感謝|多謝|感恩|歹勢|拍謝|不好意思|抱歉)(?:你|妳|阿幫|啦|喔|哦)*[，,。!！~～\s]+(?=\S)/;
const SORRY = /^(?:歹勢|拍謝|不好意思|抱歉|對不起)+(?:啦|喔|哦|囉|阿幫|～|~|!|！|。|\s)*$/i;
/** 只回「好」「嗯」「不用」（沒有在等的問題，或客戶端沒對上按鈕）：回一句短的，不列功能清單（PM Q-25） */
/** 問阿幫能做什麼、是誰、怎麼用（「你會做什麼？」「阿幫可以幫我什麼」「What can you do?」）：整句只問這個才算；回答列出能查的東西，不沿用前文的意圖與狀態 */
export const HELP_ASK = /^(?:(?:阿幫|abang)[\s，,]*)?(?:(?:你|妳)\s*)?(?:(?:會|能|可以)(?:幹嘛|幹麻|(?:做|幫(?:我|忙)?(?:做|查)?|查)(?:些)?(?:什麼|甚麼|啥|哪些)(?:事|事情|東西|功能)?)|有(?:什麼|甚麼|哪些)功能|是誰|是什麼|(?:要)?怎麼用)(?:啊|呀|呢|嗎|啦|喔|哦)?[\s？?。！!～~]*$|^(?:what can you do|what do you do|who are you|how do i use (?:you|this|abang)|help)[\s?.!]*$/i;
/** 只是打招呼（「早安」「你好」「嗨」）：跟問能做什麼一樣回答，先回一句招呼（腦袋審查：手機看了前文會判成行程） */
const GREET = /^(早安|午安|晚安|你好|妳好|您好|嗨|哈囉|哈嘍|hi|hello|hey|good (?:morning|afternoon|evening))(?:阿幫|abang|啊|呀|喔|哦|～|~|!|！|。|,|，|\s)*$/i;
const ACK = /^(?:好|好啊|好的|好喔|好哦|嗯|嗯嗯|ok|okay|了解|知道了|收到|沒問題|不用|不用了|不要|沒有|不必)(?:啦|喔|哦|囉|唷|～|~|!|！|。|\s)*$/i;
/** 只說交通類別（「高鐵」「公車」「叫車」）：沒有前一趟行程時問要查什麼、要去哪（PM Q-11、Q-24）；有前一趟＝改成這種方式（Q-12） */
const BARE_MODE = /^(?:我要|我想|幫我|那|改|改成|換)?\s*(叫車|叫計程車|計程車|小黃|uber|高鐵|台鐵|臺鐵|火車|公車|捷運|走路|步行|走過去|騎車|騎\s*youbike|騎\s*ubike|youbike|ubike)\s*(?:吧|啦|好了|就好|呢)?\s*[。！!？?]?$/i;
const BARE_TOPIC = { 高鐵: 'thsr', 台鐵: 'tra', 臺鐵: 'tra', 火車: 'tra', 公車: 'bus', 捷運: 'metro' };
/** 要出門了（沒說去哪）：先給出門建議，順便問要去哪（PM Q-13） */
const GOING_OUT = /^(?:我)?(?:現在)?(?:要|準備|快|正要|等一下要|等等要)?出門(?:了|囉|啦)?[。！!～~]?$/;
/** 公車往某方向（「307 往板橋的還要多久」）：是公車方向，不是行程（PM Q-18） */
const BUS_TOWARD = new RegExp(`(?:^|[^\\d])(${ROUTE_NO})\\s*(?:號|路)?\\s*(?:公車)?\\s*往\\s*([一-龥]{2,8}?)\\s*(?:方向)?\\s*(?:的|那班|那台)?\\s*(?:公車|車)?\\s*(?:${BUS_ASK})`);
/** 問有沒有中獎（沒給號碼時順便問號碼，PM Q-21） */
const WIN_ASK = /中獎了?(?:嗎|沒)|有沒有中獎|有中獎嗎|對獎/;

function parseIntentRaw(text, ctx) {
  const s = normalizeAsk(String(text || '').trim().replace(/ㄇ(?=[\s？?。！!～~]*$)/, '嗎').replace(/ㄋ(?=[\s？?。！!～~]*$)/, '呢')) // 注音文句尾（「還有車ㄇ」）
    .replace(COURTESY_HEAD, ''); // 「謝謝，那307呢」：禮貌詞後面還有話，去掉禮貌詞照常解析
  const history = (ctx && typeof ctx === 'object' && ctx.history) || [];
  if (THANKS.test(s)) return { places: [], states: [], arriveBy: null, tomorrow: false, intent: 'unknown', thanks: true };
  if (SORRY.test(s)) return { places: [], states: [], arriveBy: null, tomorrow: false, intent: 'unknown', sorry: true };
  const greet = GREET.exec(s)?.[1];
  if (greet) return { places: [], states: [], arriveBy: null, tomorrow: false, intent: 'unknown', help: true, greet, ...(isEnglish(s) && { lang: 'en' }) };
  if (HELP_ASK.test(s)) return { places: [], states: [], arriveBy: null, tomorrow: false, intent: 'unknown', help: true, ...(isEnglish(s) && { lang: 'en' }) };
  if (ACK.test(s)) return { places: [], states: [], arriveBy: null, tomorrow: false, intent: 'unknown', ack: true, ...(isEnglish(s) && { lang: 'en' }) };
  const places = placesInText(s.replace(METRO_LINE_ALL, (m) => ' '.repeat(m.length)).replace(METRO_SYS_ALL, (m) => ' '.repeat(m.length))); // 捷運路線名不是地名（「淡水線下一班」不是淡水老街，PM Q-20）；系統名也不是（「高雄捷運」不是高雄車站，S5）
  // 「會下雨嗎」是在問、不是正在下雨（P2-4）：問句不算下雨狀態
  const states = STATE_WORDS.filter(([k, re]) => re.test(k === 'rain' ? s.replace(RAIN_ASK, '') : s)).map(([k]) => k);
  const arriveBy = arriveByOf(s, parseNow ?? Date.now()); // 這一輪的時間（示範時鐘、測試指定）；原本用真實時鐘，早上 8 點後「8點前到」的測試會變 20:00
  const depart = departTimeOf(s, arriveBy); // 出發時間（P5-2）：「明天早上8點出發」「晚上8點從西門町去101」
  const tomorrow = /明天|明早|明晚|明日/.test(s) || !!depart?.tomorrow;
  const later = !tomorrow && /後天|週末|周末|禮拜[一二三四五六日天]|星期[一二三四五六日天]|下週|下禮拜|下星期/.test(s); // 天氣只查得到今天、明天
  const party = partyOf(s);
  const base = { places, states, arriveBy, tomorrow, ...(depart && { departTime: depart.hhmm, departDays: depart.days }), ...(later && { later: true }), ...(party && { party }) };
  // 常用地點（S1）：「回家」「去公司」「從公司回家」——座標存在手機、只有提到時才送來
  // 戶政今天有上班嗎（M16-04b）：「上班」不是去公司，先於常用地點判斷
  if (GOV_OFFICE.test(s) && !/怎麼去|怎麼走/.test(s) && !GOV_DOCS_Q.test(s)) return { ...base, places: [], intent: 'gov', govOffice: true, ...(whenOf(s)?.dayOffset && { when: whenOf(s) }) };
  const saved = savedTrip(s, places, ctx?.saved);
  if (saved) return { ...base, ...saved };
  // 英文（觀光客，S12）：只有英文字母沒有中文時用英文規則，回答也用英文（it.lang = 'en'）
  if (isEnglish(s) && /\b(?:scam|fraud|phishing)\b/i.test(s)) return { ...base, intent: 'scamAsk', lang: 'en' }; // 「Is this a scam?」：請他到防詐檢查（PM 盤點 Q-23）
  // 英文的「go home / go to the office」：常用地點（同中文的回家、去公司）
  if (isEnglish(s) && /\b(?:go(?:ing)?|head(?:ing)?|get(?:ting)?|back) (?:back )?home\b|\bto (?:the )?office\b|\bto work\b/i.test(s)) {
    const key = /home/i.test(s) ? '回家' : '去公司';
    const st = savedTrip(places[0] ? `從${places[0]}${key}` : key, places, ctx?.saved);
    if (st) return { ...base, ...st, lang: 'en' };
  }
  if (isEnglish(s) && !places.length && CALENDAR_ASK.test(s)) return { ...base, intent: 'calendar', lang: 'en' }; // 「Add this to my calendar」（ADR-0021）
  if (isEnglish(s) && !places.length && SHARE_ASK_EN.test(s)) return { ...base, intent: 'share', lang: 'en' };
  if (isEnglish(s)) return { ...englishIntent(s, places, history), lang: 'en' };
  // 判斷層（judge.js）已決定意圖：照那個意圖抽參數；抽不出必要參數時回 null，呼叫端改用規則自己的判斷
  if (ctx?.intent) return slotsFor(ctx.intent, s, base);

  // 接著上一輪（先於其他判斷：「改騎 YouBike」「改坐高鐵」也是改行程）改條件（「改坐公車」「那叫車呢」「我趕時間」）：沿用上一輪的起訖點與狀態重算
  let mode = modeOf(s);
  const sPos = s.replace(/(?:不要|不想|別|不用|不坐|不搭)\s*(?:坐|搭|騎|叫)?\s*(?:高鐵|台鐵|臺鐵|火車|客運)/g, ''); // 「不要坐高鐵」是改行程（排除），不是查高鐵
  const otherQuery = RAIL_WORD.test(withoutRailNames(sPos)) || BUS_ROUTE.test(s) || WEATHER_WORD.test(s) || lifeIntent(s) || isTrafficAsk(s) // 查高鐵、公車路線、天氣等不是改行程（地名裡的「火車站」不算，S10）
    || (/捷運|MRT/i.test(s) && /下一班|班距|幾點收|收班|還有車|到站/.test(s)) || (/附近/.test(s) && /公車站|站牌|youbike|ubike/i.test(s)); // 「台北車站捷運下一班」「附近的公車站」是查那裡，不是改坐捷運（審查 #121）
  if (RESET.test(s)) return { ...base, intent: 'unknown', reset: true };
  // 要阿幫直接動手（「你直接幫我按叫車啦」「幫我付錢」）：說明只給官方連結（ADR-0011；P2-10）
  // 問電梯、無障礙設施（「捷運哪一站有電梯」「台北車站有電梯嗎」）：沒有這份資料，照實說（P4 探查）
  if (/電梯|無障礙(?:設施|廁所|出口)?|斜坡|坡道/.test(s) && /嗎|哪|有沒有|在哪|方便|\?|？/.test(s) && !/從.+(?:到|去)|怎麼去|怎麼走/.test(s)) return { ...base, intent: 'access' };
  // 在生活阿幫問「這是詐騙嗎」（有沒有附內容都一樣）：不列功能清單，請他到防詐檢查（PM 盤點 Q-23）
  if (/詐騙嗎|是不是詐騙|是詐騙|是騙人的嗎/.test(s) && !places.length) return { ...base, intent: 'scamAsk' };
  // 有人要你加 LINE、進投資群組（2026-11-25 Gemini Nano 實測：「加line帳號」有時判成閒聊）：常見詐騙話術，請到防詐檢查
  if (LINE_SCAM.test(s) && !places.length) return { ...base, intent: 'scamAsk' };
  // 官方入口（M16-04d）：罰單、報稅、地方稅、健保、勞保、謄本…只給官方網址；問要帶什麼仍是辦事須知
  if (!GOV_DOCS_Q.test(s) && GOV_LINK_VERB.test(s) && findGovLinks(s).length && !PASSPORT_WAIT.test(s)) return { ...base, places: [], intent: 'gov', govLink: true, govQuery: s.slice(0, 40) };
  // 護照現場人多不多（M16-04c）：領務局與各辦事處的即時等待人數
  if (PASSPORT_WAIT.test(s) && !GOV_DOCS_Q.test(s) && !/怎麼去|怎麼走/.test(s)) return { ...base, places: [], intent: 'gov', govPassport: true, passportOffice: /台中|臺中|中部/.test(s) ? '中部' : /高雄|南部/.test(s) ? '南部' : /嘉義|雲嘉南|台南|臺南/.test(s) ? '雲嘉南' : null };
  // 最近的戶政事務所、今天有沒有上班（M16-04b）：用現在位置找；說了怎麼去才是行程
  if (GOV_OFFICE.test(s) && !/怎麼去|怎麼走/.test(s) && !GOV_DOCS_Q.test(s)) return { ...base, places: [], intent: 'gov', govOffice: true, ...(whenOf(s)?.dayOffset && { when: whenOf(s) }) };
  // 去政府辦事要帶什麼（M16-04a）：說了地點也是在問辦事（「去板橋戶政換身分證要帶什麼」）；問路（怎麼去、怎麼走）才是行程
  if (GOV_ASK.test(s) && !/怎麼去|怎麼走|多遠|幾分鐘到/.test(s)) return { ...base, places: [], intent: 'gov', govQuery: s.slice(0, 40) };
  // 把剛剛的行程加到行事曆、分享給家人（ADR-0021）：手機的系統畫面做最後確認；說了地點是先排行程（runDemo 查完再問要不要加）
  if (CALENDAR_ASK.test(s) && !places.length) return { ...base, intent: 'calendar' };
  if (SHARE_ASK.test(s) && !places.length && !/https?:|www\./i.test(s)) return { ...base, intent: 'share' };
  // 要設提醒、到站叫我，沒說哪一路公車、也沒說地點（Gemini Nano 實測把「公車快到時提醒我」判成查公車）：說明提醒在哪裡設
  if (REMIND_ASK.test(s) && !places.length && !/\d/.test(s)) return { ...base, intent: 'reminder' };
  // 要改設定（常用地點、我有車、語言、通知；Apple Intelligence 實測把「設定我家在板橋」判成找地點）：說明在哪裡設。問怎麼去不算
  if (SETTINGS_ASK.test(s) && !/怎麼去|怎麼走|多久|到哪|幾點/.test(s)) return { ...base, intent: 'settings' };
  if (looksScamPaste(s, places)) return { ...base, places: [], intent: 'scamAsk', pasted: true }; // 貼上的詐騙樣式簡訊（網址＋催促＋要你點或付）：不拿裡面的數字查公車，請他帶到防詐（f01）
  if (ACT_FOR_ME.test(s) && !places.length && (!RAIL_WORD.test(s) || /刷卡|付款|付錢|代付/.test(s))) return { ...base, intent: 'limits' };
  if (isDramaAsk(s, places)) return { ...base, intent: 'drama', ...dramaSlots(s) }; // 找短劇（ADR-0019）：在行程、生活服務之前（「推薦一部短劇」不是地名）
  let tripMemo;
  const noNeeds = (t) => { if (!t?.needs) return t; const { needs: _n, ...r } = t; return r; }; // 上一輪在問的欄位：這一輪說了就不再問（「那去台北101呢」）
  const tripBefore = () => (tripMemo !== undefined ? tripMemo : (tripMemo = noNeeds(ctx && 'prev' in ctx ? ctx.prev : lastTrip(history, ctx?.saved))));
  const air = airportTrip(s, places, { saved: ctx?.saved }); // 「去機場」沒說哪個：程式猜最近的並問（core/agent/clarify-plan.js）
  if (air?.intent === 'savedMissing') return { ...base, ...air };
  if (air) {
    const b = !air.from && CHANGE_TO.test(s) && history.length ? tripBefore() : null; // 「那去機場呢」：起點與條件沿用上一趟（同「那去松山機場呢」）
    if (b?.from || b?.fromSaved) {
      const { to: _t, toSaved: _ts, needs: _n, ambig: _a, followUp: _f, changed: _c, nearRail: _r, airport: _ap, savedTrip: _st, ...rest } = b;
      return { ...rest, states: [...new Set([...(b.states || []), ...states])], ...air, from: b.from, ...(b.fromSaved && { fromSaved: b.fromSaved }), ...((mode || b.mode) && { mode: mode || b.mode }) };
    }
    return { ...base, ...air, ...(mode && !air.mode && { mode }) };
  }
  const bareMode = BARE_MODE.exec(s.replace(/\s+/g, ' ').trim());
  const before = history.length && (!otherQuery || bareMode) ? tripBefore() : null; // 結構化上下文（A3）：前面累積的行程條件；只說「高鐵」＝改坐高鐵
  if (isTrafficAsk(s)) return trafficOf(s, places, base, history.length ? tripBefore : () => null); // 國道路況（S7）
  // 剛查完高鐵／台鐵（票價或班次），接著說「那台鐵呢」：同一段起訖換另一種（審查 #121）
  const railSwitch = /^(?:那|改|換|那麼)?\s*(?:坐|搭)?\s*(高鐵|台鐵|臺鐵|火車)\s*(?:呢|咧|勒|的呢|呢？)?\s*[？?]?$/.exec(s);
  const prevRail = railSwitch && lastUserIntent(history);
  if (prevRail?.intent === 'rail' && prevRail.to) return { ...prevRail, states: base.states, system: /高鐵/.test(railSwitch[1]) ? 'THSR' : 'TRA', followUp: true };
  if (bareMode && !before) { // 只說類別、沒有前一趟行程：叫車問要去哪（帶著叫車），其他問要查什麼；只說「走路」照原本流程
    const topic = BARE_TOPIC[bareMode[1]];
    if (topic) return { ...base, intent: 'unknown', category: topic };
    if (modeOf(bareMode[1]) === 'ridehail') return { ...base, intent: 'trip', from: null, to: null, mode: 'ridehail', needs: 'to' };
  }
  // 「那回程呢」「回來怎麼坐」：上一趟起訖對調（上一趟從現在位置出發的，回程目的地也是那裡；P3-8）
  // 上一趟從現在位置出發（沒有起點）：回程到你現在的位置（toHere，run.js 有定位就換成座標；沒有就跟去程一樣用示範起點；PM 第三輪 #3）
  if (before?.to && !places.length && /回程|回來(?:的時候|怎麼|要怎|呢)|怎麼回去|回頭怎麼|反方向|反過來/.test(s) && /怎麼|如何|呢|嗎|幾點|要多久|[?？]/.test(s)) {
    const { fromPoint: _p, fromSaved: _f, toSaved: _t, toHere: _h, ...prev } = before; // 起訖的座標跟著對調，不留去程的
    const back = before.from ? { to: before.from, ...(before.fromSaved && { toSaved: before.fromSaved }) } : before.fromSaved ? { to: before.fromSaved.name, toSaved: before.fromSaved } : { to: DEFAULT_FROM, toHere: true };
    return { ...prev, from: before.to, ...(before.toSaved && { fromSaved: before.toSaved }), ...back, states: [...new Set([...before.states.filter((k) => k !== 'rush'), ...states])], intent: 'trip', followUp: true, changed: ['from', 'to'] }; // 回程是之後的事：去程的趕時間不沿用（下雨、帶行李、長輩照舊）
  }
  // 接著改起點或目的地（只有一個地名＋提示詞；起點可以是地標庫沒有的地名，例「板橋」）：其他條件沿用
  if (before) {
    const keep = { ...before, states: carryStates(before.states, states, !!depart), ...(arriveBy && { arriveBy }), ...(party && { party }), ...(depart && { departTime: depart.hhmm, departDays: depart.days, tomorrow }), intent: 'trip', followUp: true };
    // 排好行程後的追問（PM 第二輪 #3）：要多久、票價、幾點出門 → 同一趟再排一次，總結先回答問的；明天呢 → 改成明天；我在X → 改起點
    if (!places.length && FOLLOW_ASK.test(s)) return { ...keep, followUp: true, askWhat: /票價|多少錢|要錢|車資|費用|多貴|幾塊/.test(s) ? 'cost' : /幾點出門|幾點出發|什麼時候出門|何時出發|幾點走/.test(s) ? 'when' : 'time' };
    if (!places.length && FOLLOW_DAY.test(s)) { const w = whenOf(s); return { ...keep, tomorrow: w.dayOffset >= 1, ...(w.dayOffset > 1 && { departDays: w.dayOffset }), followUp: true, changed: ['depart'] }; }
    if (places.length === 1 && /^(?:我|我們)?(?:現在|人)?(?:在|到了)\s*\S/.test(s) && places[0] !== before.to && !CHANGE_TO.test(s)) return { ...keep, from: places[0], followUp: true, changed: ['from'] };
    // 「從這裡出發」「從我現在的位置」→ 起點改回現在位置
    if (/從\s*(?:這裡|這邊|我這|我現在|現在的?位置)/.test(s) && !CHANGE_TO.test(s) && before.from) return { ...keep, from: null, changed: ['from'] };
    const fromText = fromStartOf(s);
    if (!CHANGE_TO.test(s) && (fromText || (places.length === 1 && /從\s*\S|出發/.test(s) && !NOT_PLACE.test(s.replace(/^.*?從\s*/, ''))))) {
      const p = places.length === 1 ? places[0] : fromText;
      if (p && p !== before.to) return { ...keep, from: p, changed: ['from', ...(arriveBy ? ['arriveBy'] : [])] };
    }
    if (places.length === 1 && CHANGE_TO.test(s) && places[0] !== before.from) return { ...keep, to: places[0], changed: ['to', ...(arriveBy ? ['arriveBy'] : [])] };
  }
  // 只說了跟上一輪一樣的目的地（「坐捷運去101就好」）＝接著改：起點與條件沿用（P2-3）
  const sameTo = !!(before && places.length === 1 && places[0] === before.to && !/從/.test(s) && !fromStartOf(s));
  const prev = !places.length || sameTo ? before : null;
  const avoid = avoidOf(s);
  if (mode && avoid.includes(mode)) mode = null; // 「公車一直沒來，不要坐公車了」：同一種方式又提到又說不要＝不要
  if (prev && ((mode && (CHANGE_WORD.test(s) || sameTo || bareMode)) || (states.length && s.length <= 12) || avoid.length || arriveBy || party || depart)) {
    // 說不要的方式累積（「不要叫車」後「也不要走路」）；改成某方式時從不要的清單拿掉
    const avoidAll = [...new Set([...(prev.avoid || []), ...avoid])].filter((m) => m !== mode); // 這句明講要坐的不算不要
    const useMode = mode || (avoidAll.includes(prev.mode) ? null : prev.mode); // 上一輪指定的方式被說不要了 → 取消指定
    const { mode: _m, avoid: _a, ...rest } = prev;
    return {
      ...rest, states: carryStates(prev.states, states, !!depart), intent: 'trip',
      ...(useMode && { mode: useMode }),
      ...(avoidAll.length && { avoid: avoidAll }), ...((arriveBy || prev.arriveBy) && { arriveBy: arriveBy || prev.arriveBy }), ...(party && { party }), followUp: true,
      ...(depart && { departTime: depart.hhmm, departDays: depart.days, tomorrow }), // 「改成明天早上8點出發」：起訖、方式沿用，只改出發時間（P5-2）
      changed: [...(mode ? ['mode'] : []), ...(avoid.length ? ['avoid'] : []), ...(arriveBy ? ['arriveBy'] : []), ...(depart ? ['departAt'] : []), ...(states.length ? ['states'] : []), ...(party ? ['party'] : [])],
    };
  }
  // 阿幫剛問「你從哪裡出發？」，使用者只回地名 → 那是起點，目的地沿用上一輪
  const lastBot = [...history].reverse().find((m) => m.role === 'assistant');
  if (places.length === 1 && lastBot && ASKED_ORIGIN.test(String(lastBot.content)) && onlyPlace(s, places)) {
    const asked = tripBefore();
    if (asked?.to && asked.to !== places[0]) return { ...asked, from: places[0], intent: 'trip', followUp: true, changed: ['from'] };
  }

  // 阿幫剛問「要去哪裡？」，使用者只回地名 → 那是目的地，起點沿用（打字回答已由 pendingAsk 改寫；這裡讓之後的「那叫車呢」也接得上）
  if (places.length === 1 && lastBot && ASKED_DEST.test(String(lastBot.content)) && onlyPlace(s, places)) {
    const asked = tripBefore();
    if (asked && !asked.to && !asked.nearRail && asked.from !== places[0]) return { ...asked, to: places[0], intent: 'trip', followUp: true, changed: ['to'] };
  }
  // 趕車（「我的高鐵 20 分鐘後開，現在在西門町，來得及去台北車站嗎」）：是去車站的行程（有時限），不是查高鐵班次（P2-5）
  if (/來得及|來不來得及|趕得上|趕不趕得上/.test(s) && places.length && /(?:去|到)\s*\S/.test(s) && !/末班|首班/.test(s) && !/(?:坐|搭|趕)[^，,。]{0,6}(?:高鐵|台鐵|臺鐵|火車)/.test(s)) {
    const [from, to] = places.length >= 2 ? orderFromTo(s, places) : [null, places[0]];
    return { ...base, intent: 'trip', from, to, states: [...new Set([...base.states, 'rush'])] };
  }
  // 公車往某方向（「307 往板橋的還要多久」）：查那個方向，不是去板橋的行程（PM Q-18）
  const toward = BUS_TOWARD.exec(s);
  if (toward && !/從.+到/.test(s)) return { ...base, places: [], intent: 'bus_route', route: toward[1], toward: toward[2] };
  // 捷運往某方向（「往南港的板南線」「板南線往南港下一班」，PM 第二輪）：附近的站、只看往那個方向的車；問怎麼去的是行程
  const mt = (METRO_LINE.test(s) || /捷運|MRT/i.test(s)) && !/從.+(?:到|去)|怎麼(?:去|走|坐|搭)|要多久到/.test(s) && /往\s*([一-龥]{2,5}?)(?=的|方向|那邊|下一班|的車|車|捷運|線|$|[?？呢嗎]|[板淡松新中文環萬機紅藍綠橘棕黃])/.exec(s.replace(METRO_LINE_ALL, (m) => `${m} `));
  if (mt && !NOT_METRO_STATION.test(mt[1])) return { ...base, places: [], intent: 'metro', station: null, line: METRO_LINE.exec(s)?.[0] || null, toward: mt[1], ...(metroSystemOf(s) && { system: metroSystemOf(s) }) };
  // 只說站名的捷運（「中山站下一班」「高雄捷運美麗島下一班」）：地標庫的捷運站＋下一班類問法（PM Q-20、S5）
  const metroFirst = places.length === 1 && /^捷運/.test(places[0]) ? metroOf(s, places, base) : null;
  if (metroFirst?.station) return metroFirst;
  // 只說「火車站」「高鐵站」沒說哪一站（「去火車站怎麼坐」「欲去火車頭按怎坐」）：去最近的台鐵／高鐵站（P5-3、P5-4）
  const nr = NEAR_RAIL.exec(s);
  if (nr && !places.some((p) => STATION_NAMES.has(p)) && !RAIL_ASK.test(s)) {
    const from = places[0] && /從/.test(s) ? places[0] : FROM_TEXT.exec(s)?.[1] ?? null;
    return { ...base, intent: 'trip', from, to: null, nearRail: /高鐵/.test(nr[0]) ? 'THSR' : 'TRA', ...(mode && !['tra', 'thsr'].includes(mode) && { mode }) };
  }
  if (RAIL_WORD.test(withoutRailNames(s))) { // 「從桃園火車站到台北101」的火車站是地名，不是查台鐵（S10）
    const r = railOD(s);
    const system = /高鐵/.test(s) ? 'THSR' : 'TRA';
    // 票價（「高鐵票價台北到左營」）：rail_fare，要有起訖站
    if (r?.to && RAIL_FARE.test(s)) {
      // 沒說起站：句中有別的地名用那裡，否則先從台北算（總結會說）；要去的就是台北時不猜，問起站
      const near = !r.from && places.find((p) => !normPlace(p).includes(normPlace(r.to)) && !normPlace(r.to).includes(normPlace(p).replace(/^高鐵|站$/g, '')));
      const said = near && near.replace(/^高鐵/, '').replace(/(?:火車站|車站|站)$/, ''); // 「我在台中，高鐵到左營票價」：起站是使用者說的，不是猜的（GPS 不能蓋掉，審查 #121）
      const guess = r.from || said || (/^[臺台]北/.test(r.to) ? null : '臺北');
      return { ...base, intent: 'rail', fare: true, system, from: guess, to: r.to, ...(!r.from && !said && guess && { fromGuess: true }) };
    }
    // 有起站，或問班次（下一班、幾點、末班…）但沒說起站 → 句中有別的地名（「我在板橋，高鐵到台中幾點」）找那裡最近的站，否則用現在位置（「坐火車去花蓮」沒問班次是行程）
    if (r && (r.from || RAIL_ASK.test(s))) {
      const near = !r.from && places.find((p) => !normPlace(p).includes(normPlace(r.to)) && !normPlace(r.to).includes(normPlace(p).replace(/^高鐵|站$/g, '')));
      return { ...base, intent: 'rail', system, from: r.from, to: r.to, ...(near && { near }), ...(/訂|買票|購票/.test(s) && { book: true }) };
    }
    // 沒說去哪（「高鐵下一班」「台鐵票價」）：問要去哪一站；高鐵下一班先查最近站兩個方向（PM Q-19、Q-24）
    if (!r && !places.length && (RAIL_FARE.test(s) || RAIL_ASK.test(s)) && !/末班|首班/.test(s)) return { ...base, intent: 'rail', system, from: null, to: null, ...(RAIL_FARE.test(s) ? { fare: true } : { anyTo: true }) };
  }
  // 捷運站名（「捷運西門站下一班」「高雄捷運美麗島站下一班」，系統照句子說的）；問捷運下一班但沒說站（「板南線下一班幾分」「捷運末班車幾點」）
  // → 現在位置最近的站；句子裡有地標（「台北車站捷運下一班」）→ 那裡最近的站。有起訖的（「從板橋坐捷運到台北車站」）是行程（S6）
  if (/捷運|MRT/i.test(s) || METRO_LINE.test(s) || metroSystemOf(s)) {
    const m = metroOf(s, places, base);
    if (m) return m;
  }
  // 末班車（不是高鐵台鐵、捷運）：說了路線查那一路（到站資料的末班狀態），沒說問哪一路（真實資料健檢）
  if (LAST_ASK.test(s) && !RAIL_WORD.test(withoutRailNames(s)) && !lifeIntent(s) && !/youbike|ubike|單車|腳踏車/i.test(s)) { // 「YouBike 最後一班」不是公車末班
    const r = BUS_ROUTE.exec(s)?.[1] || BUS_WAIT.exec(s)?.[1] || new RegExp(`(?:^|[^\\d])(${ROUTE_NO})(?!\\d)`).exec(s)?.[1];
    if (r) return { ...base, intent: 'bus_route', route: r, last: true };
    const prev = lastUserIntent(history);
    if (prev?.intent === 'bus_route' && prev.route) return { ...base, intent: 'bus_route', route: prev.route, last: true, followUp: true }; // 「307 到哪了」→「末班車幾點」
    if (prev?.intent === 'metro') return { ...base, ...prev, states: base.states, last: true, followUp: true };
    if (!places.length) return { ...base, intent: 'bus_route', route: null, needs: 'route', last: true };
  }
  // 出門建議（S13）：天氣＋空品一起看（「今天出門要注意什麼」「出門要帶傘嗎」「要穿什麼」）
  // 問明天的是天氣預報（現在的天氣答不了），交給天氣意圖
  // 一句問好幾件事（「307還要多久、會不會下雨、油價多少」）：每一段各自判斷，全部都查（P5-8）
  // 找診所、戶政接著問別的日子或時段（「那明天呢」「明天早上呢」「禮拜天咧」，PM 審查 2026-11-28）：同一件事、換時間
  if (s.length <= 14 && /呢|咧|勒|有開嗎|有嗎|^那/.test(s) && whenOf(s) && !places.length && !lifeIntent(s) && !WEATHER_WORD.test(s)) {
    const prev = lastUserIntent(history);
    if (prev?.intent === 'pharmacy' && prev.clinic) return { ...prev, states: base.states, when: whenOf(s), followUp: true };
    if (prev?.intent === 'gov' && prev.govOffice && whenOf(s).dayOffset) return { ...prev, states: base.states, when: whenOf(s), followUp: true };
  }
  const multi = !ctx?.noMulti && multiOf(s, base, ctx);
  if (multi) return multi;
  if (GOING_OUT.test(s)) return { ...base, intent: 'outing', askTo: true }; // 要出門了：出門建議＋問要去哪
  if (OUTING.test(s) && !tomorrow && !(places.length && (/怎麼|從/.test(s) || (/到|往|去/.test(s) && !/注意|帶|穿|適合/.test(s))))) return { ...base, intent: 'outing' };
  const life = lifeIntent(s);
  if (life) return { ...base, ...life };
  // 「剛剛那班還要等多久」：那班＝上一輪選的公車（阿幫回答裡的「公車 棕9」；P2-7）
  if (/剛剛那班|剛才那班|那班(?:公車|車)?|那台公車/.test(s) && !BUS_ROUTE.test(s)) {
    const said = history.filter((x) => x.role === 'assistant').at(-1)?.content || '';
    const r = SAID_BUS_ROUTE.exec(said)?.[1];
    if (r) return { ...base, intent: 'bus_route', route: r, followUp: true };
  }
  const route = BUS_ROUTE.exec(s)?.[1] || BUS_WAIT.exec(s)?.[1] || BUS_ROUTE_TRAFFIC.exec(s)?.[1]; // 「我在等939」（S8）；「307 路況」是查 307
  // 一句兩件事（「等等會不會下雨？順便看 307 還要多久」）：查公車也看天氣（P2-2）
  if (route && !/從.+到/.test(s)) return { ...base, intent: 'bus_route', route, ...(WEATHER_WORD.test(s) && { alsoWeather: true }) };
  // 生活服務接著問另一個地方（「附近哪裡可以領慢箋」→「那板橋車站那邊呢」）：同一個服務、換地點（P2-8）
  //（「那去板橋怎麼走」是行程、「板橋那邊有 YouBike 嗎」是 YouBike：有行程字、交通方式、別的服務就不算）
  if (places.length === 1 && /那|呢|咧|勒/.test(s) && s.length <= 16 && !/去|到|往|回|怎麼|怎樣/.test(s) && !modeOf(s) && !lifeIntent(s) && !/youbike|ubike|單車|公車|站牌/i.test(s)) {
    const prevLife = followsLife(history);
    if (prevLife) {
      const r = parseIntentRaw(`${places[0]}附近的${LIFE_LABEL[prevLife]}`, { history: [] });
      return { ...r, ...(tomorrow && { tomorrow }), states: [...new Set([...(r.states || []), ...states])] }; // 「那台中明天呢」：明天、狀態帶過去
    }
  }
  const busNext = BUS_FOLLOW.exec(s)?.[1];
  if (busNext && followsBus(history)) return { ...base, intent: 'bus_route', route: busNext, followUp: true };
  if (/youbike|ubike|微笑單車|單車|腳踏車/i.test(s) && !(places.length && /去|到|往/.test(s))) { // 「那邊有 YouBike 嗎」：那邊＝上一趟的目的地（P4-6）
    const there = !places.length && THERE.test(s) && tripBefore()?.to;
    return { ...base, intent: 'youbike', ...(there && { places: [there] }) };
  } // 「騎 YouBike 去 X」是行程
  if (/附近/.test(s) && /公車|站牌/.test(s)) return { ...base, intent: 'nearby_bus' };
  if (/迷路|找不到路|不知道(?:我)?(?:人)?在哪(?:裡)?|這是哪裡/.test(s) && !places.length) return { ...base, intent: 'nearby_bus', lost: true }; // 「我迷路了」：用手機的位置找最近的站牌（PM 第三輪 #5）
  // 行程：只說目的地（「去台北101」「想省錢，去松山機場」，甚至只打地名）→ 起點用現在位置（needsLocation）
  const timeGo = TIME_GO.test(s) && !WEATHER_WORD.test(s) && !OUTING.test(s); // 「明天去台北101」：時間詞後面接去（PM 第二輪）；「明天去台北101會下雨嗎」仍是問天氣
  const tripSaid = places.length && (timeGo || (places.length >= 2 && /[一-龥A-Za-z0-9]\s*(?:到|→|至)\s*[一-龥A-Za-z0-9]/.test(s)) || /從.+(到|去)|出發\s*(?:去|到|往)|怎麼去|怎麼走|怎麼坐|怎麼搭|(?:坐|搭)什麼|要到|前到|想去|要去|帶我去|(?:改|換)(?:成)?(?:去|到)|去.+怎麼|(?:^|[，,、\s])(?:去|到|往)\s*\S|(?:末班|最後一班)車?\s*(?:回|去|到|往)\s*\S|(?:[點半]|\d分)\s*(?:到|去)\s*[^\s，,。了]|(?:坐|搭|騎|用|開車|走路|推|帶|叫).{0,8}(?:去|到|往)|(?:公車|捷運|火車|客運)\s*(?:回|去)(?!到|覆|頭)|(?:高鐵|台鐵|臺鐵|火車|客運|自強號?|區間車|莒光號?|普悠瑪號?|太魯閣號)\s*(?:到|去|往)\s*\S|(?:^|[，,、\s]|要|想|早上|晚上|下午|現在|下班|放學|等等|明天)回(?!到|覆|頭|饋|去|來|應)\s*\S/.test(s));
  if (places.length && (tripSaid || onlyPlace(s, places))) {
    const [from, to] = places.length >= 2 ? orderFromTo(s, places) : [FROM_TEXT.exec(s)?.[1] ?? null, places[0]]; // 明講的起點優先
    const amb = places.length === 1 && !from ? ambigOf(s, to) : null; // 「去中山」：同名的地點不只一個（PM Q-4～Q-6）
    return { ...base, intent: 'trip', from, to, ...(mode && { mode }), ...(avoid.length && { avoid }), ...(!tripSaid && { bare: true }), ...(amb && { ambig: amb }) };
  }
  if (WEATHER_WORD.test(s)) {
    // 「那裡現在會下雨嗎」：那裡＝上一輪行程的目的地（P2-7）
    if (!places.length && THERE.test(s)) { const to = tripBefore()?.to; if (to) return { ...base, places: [to], intent: 'weather' }; }
    return { ...base, intent: 'weather' };
  }
  // 前一句問的生活資料，接著追問（P4）：「那95呢」「12345678 有中嗎」「那明天呢」
  const prevIt = lastUserIntent(history);
  if (!prevIt && /^(?:那|那麼)?\s*(?:92|95|98)\s*(?:無鉛)?\s*(?:呢|咧|勒)\s*[？?]?$/.test(s)) return { ...base, intent: 'fuel', grade: s.match(/92|95|98/)[0] }; // 沒有前文的「那95呢」：油價（有前文照上一句）
  if (prevIt?.intent === 'fuel' && /^(?:那|那麼)?\s*(?:92|95|98|柴油|超級柴油)/.test(s)) return { ...base, intent: 'fuel', grade: /柴油/.test(s) ? '柴油' : s.match(/92|95|98/)[0], followUp: true };
  if (prevIt?.intent === 'invoice' && /(?:^|\D)\d{8}(?!\d)/.test(s) && s.length <= 24) return { ...base, intent: 'invoice', number: s.match(/(?:^|\D)(\d{8})(?!\d)/)[1], followUp: true };
  if (tomorrow && /^(?:那|那麼)?\s*明天(?:呢|咧|勒|的呢|會怎樣|怎麼樣)?\s*[？?]?$/.test(s) && ['weather', 'aqi', 'outing'].includes(prevIt?.intent)) return { ...base, intent: 'weather', places: prevIt.places || [], ...(prevIt.fromPoint && { fromPoint: prevIt.fromPoint }), followUp: true };
  // 前面在聊股市時，「我該買台積電嗎？」沒有股市字眼也接著查（並說明不提供投資建議）；「那該不該買」沿用上一句的股票
  if (STOCK_ADVICE.test(s) && followsStock(history)) return { ...base, intent: 'stock', query: stockQueryOf(s) || lastStockQuery(history), advice: true, followUp: true };
  const follow = isFollowUp(s) && FOLLOW_UP.exec(s);
  if (follow && followsStock(history)) return { ...base, intent: 'stock', query: stockQueryOf(follow[1]) || follow[1], advice: false, followUp: true };
  // 缺必要欄位（ADR-0016「該問就問」）：其他判斷都對不上才看（寧可不問）。一句問好幾件事的分段（noMulti）不在這裡問
  if (!ctx?.noMulti) {
    const origin = originOnly(s, places); // 只說起點：那是起點，問要去哪
    if (origin) return { ...base, intent: 'trip', from: origin, to: null, needs: 'to' };
    if (noDestination(s, places)) return { ...base, intent: 'trip', from: null, to: null, needs: 'to' };
    if (!places.length && busNoRoute(s)) { // 問公車沒說哪一路：剛剛選了公車就查那一班，否則問
      const chosen = chosenBus(history);
      return chosen ? { ...base, intent: 'bus_route', route: chosen, followUp: true } : { ...base, intent: 'bus_route', route: null, needs: 'route' };
    }
    // 地標庫沒有這個名字、但有幾個地方包含它（「去信義」「去長庚醫院」「中正」），或是路名（「去中山路」）：問是哪裡（PM Q-7～Q-10）
    const d = !places.length && destToken(s);
    const lk = d && lookupToken(d.token);
    if (lk?.road) return { ...base, intent: 'unknown', road: lk.road };
    if (lk?.exact && !d.bare) return { ...base, intent: 'trip', from: null, to: lk.exact, ...(mode && { mode }) };
    if (lk?.station) return { ...base, intent: 'trip', from: null, to: `捷運${lk.station}站`, metroTo: lk.station, ...(mode && { mode }) }; // 「去大安站」「去士林捷運站」：地標庫沒有，runDemo 用捷運站資料找座標（審查 #121）
    if (lk?.cands) {
      const amb = { token: d.token, core: lk.core, names: lk.cands, def: null };
      return d.bare ? { ...base, intent: 'unknown', ambig: amb, bare: true } : { ...base, intent: 'trip', from: null, to: lk.cands[0], ambig: amb, ...(mode && { mode }) }; // 說了「去」：先用最可能的那個算，同時問
    }
  }
  return { ...base, intent: 'unknown' };
}

/**
 * 指定意圖下抽參數（給判斷層用）：例如判斷層說是公車，就找路線號碼；找不到必要參數回 null。
 * @returns {ReturnType<typeof parseIntent>|null}
 */
function slotsFor(intent, s, base) {
  switch (intent) {
    case 'rail': {
      // 沒有高鐵台鐵字眼、也沒問班次（「從板橋到台北車站」「高雄車站到駁二」）、迄站不是車站：交回規則（S3）
      if (!RAIL_WORD.test(withoutRailNames(s)) && !RAIL_ASK.test(s)) return null;
      const r = railOD(s);
      const system = /高鐵/.test(withoutRailNames(s)) ? 'THSR' : 'TRA';
      if (r?.to && !railStationAnswer(r.to, system)) return null;
      return r ? { ...base, intent, system, from: r.from, to: r.to } : null; // 沒說起站：from null（用最近的車站）
    }
    case 'metro': return metroOf(s, base.places, base, { loose: true }); // 有起訖的是行程（S6）：回 null 交回規則
    case 'traffic': return trafficLike(s) ? trafficOf(s, base.places, base, () => null) : null; // 判斷層說路況、句子提到國道（「國道有車禍嗎」）：問起訖
    case 'bus_route': {
      if (looksScamPaste(s)) return null; // 簡訊裡的「24小時內」不是公車 24（f01）
      const route = BUS_ROUTE.exec(s)?.[1] || BUS_WAIT.exec(s)?.[1] || /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?!\d)/.exec(s)?.[1];
      if (!route && !base.places.length && busNoRoute(s)) return { ...base, intent, route: null, needs: 'route' }; // 判斷層說查公車、句子只在問公車多久到但沒路線：問哪一路（「搭公車到西門町」是行程，交回規則）
      return route ? { ...base, intent, route } : null;
    }
    case 'trip': {
      if (!base.places.length) return noDestination(s, base.places) ? { ...base, intent, from: null, to: null, needs: 'to' } : null;
      const origin = originOnly(s, base.places); // 「從台北車站出發」：那是起點，不是目的地
      if (origin) return { ...base, intent, from: origin, to: null, needs: 'to' };
      const [from, to] = base.places.length >= 2 ? orderFromTo(s, base.places) : [FROM_TEXT.exec(s)?.[1] ?? null, base.places[0]];
      const mode = modeOf(s);
      return { ...base, intent, from, to, ...(mode && { mode }) };
    }
    // 2026-11-23 判斷層的新意圖（阿幫會的每一件事都有意圖）：交給既有的處理（行程、高鐵台鐵、出門建議、防詐說明）或固定回覆
    case 'intercity': case 'ridehail': case 'place': { // 指定搭客運、叫車、問某地在哪：都是「去那裡」的行程（行程卡片有導航、叫車、客運）
      // 客運要句子真的提到客運、巴士才限定（「去陽明山有公車嗎」判成客運時照一般行程比較，不只查客運）；叫車是判斷層明確說的
      const mode = modeOf(s) || (intent === 'intercity' && INTERCITY_WORD.test(s) ? 'intercity' : intent === 'ridehail' ? 'ridehail' : null);
      if (!base.places.length) return { ...base, intent: 'trip', from: null, to: null, needs: 'to', ...(mode && { mode }) };
      const origin = originOnly(s, base.places);
      if (origin) return { ...base, intent: 'trip', from: origin, to: null, needs: 'to', ...(mode && { mode }) };
      const [from, to] = base.places.length >= 2 ? orderFromTo(s, base.places) : [FROM_TEXT.exec(s)?.[1] ?? null, base.places[0]];
      return { ...base, intent: 'trip', from, to, ...(mode && { mode }), ...(intent === 'place' && { placeAsk: true }) };
    }
    case 'booking': { // 訂票：說得出起訖就查班次（卡片有官方訂票連結）；說不出來就說明只給官方連結（ADR-0011）
      const r = railOD(s);
      const system = /高鐵/.test(withoutRailNames(s)) ? 'THSR' : /台鐵|臺鐵|火車|自強|區間|莒光/.test(s) ? 'TRA' : 'THSR';
      return r?.to && railStationAnswer(r.to, system) ? { ...base, intent: 'rail', system, from: r.from, to: r.to, book: true } : { ...base, intent: 'limits', book: true };
    }
    case 'outing': return { ...base, intent: 'outing' };
    case 'exercise': return { ...base, intent: 'outing', walk: true }; // 散步運動：看天氣與空品適不適合出門走走（判斷只看這句話，不用步數等手機上的資料，ADR-0018）
    case 'scam': return { ...base, places: [], intent: 'scamAsk', ...(looksScamPaste(s) && { pasted: true }) };
    case 'gov': return !GOV_DOCS_Q.test(s) && GOV_LINK_VERB.test(s) && findGovLinks(s).length && !PASSPORT_WAIT.test(s) ? { ...base, places: [], intent: 'gov', govLink: true, govQuery: s.slice(0, 40) } : PASSPORT_WAIT.test(s) && !GOV_DOCS_Q.test(s) ? { ...base, places: [], intent: 'gov', govPassport: true } : GOV_OFFICE.test(s) && !GOV_DOCS_Q.test(s) ? { ...base, places: [], intent: 'gov', govOffice: true } : { ...base, places: [], intent: 'gov', govQuery: s.slice(0, 40) };
    case 'calendar': case 'share': return base.places.length ? slotsFor('trip', s, base) : { ...base, intent }; // 說了地點＝先排行程（runDemo 排好後再問要不要加行事曆／分享）
    case 'reminder': case 'settings': case 'emergency': return { ...base, intent };
    case 'help': return { ...base, intent: 'unknown', help: true };
    case 'chat': return { ...base, intent: 'unknown', chat: true };
    case 'invoice': return { ...base, intent, number: INVOICE_NO.exec(s)?.[1] };
    case 'quake': return { ...base, intent, county: countyOf(s) };
    case 'pharmacy': return { ...base, intent, area: AREA.exec(s)?.[1] || countyOf(s), ...(!PHARMACY_WORD.test(s) && clinicOf(s)) };
    case 'stock': return { ...base, intent, query: stockQueryOf(s) || undefined, advice: STOCK_ADVICE.test(s) || undefined };
    case 'drama': return { ...base, intent, ...dramaSlots(s) };
    case 'youbike': case 'nearby_bus': case 'weather': case 'aqi': case 'garbage': case 'fuel': case 'unknown':
      return { ...base, intent };
    default: return null;
  }
}

export const DEFAULT_FROM = '臺北車站'; // 示範：沒說起點也拿不到裝置定位時，先從這裡算
export const DEFAULT_AREA = '臺北市中正區';
export const INVOICE_WALLET_HINT = '要不要把發票存到「我的發票」？可以直接掃發票左邊的 QR code，號碼只存在你的手機，開獎後打開阿幫就自動幫你對獎（首頁 → 發票對獎）。'; // 示範：查藥局沒說地區時（臺北車站所在的區）

/** 捷運路線名（台北、桃園、台中、高雄）與「下一班」類問法 */
const METRO_LINE = /(?:板南|淡水信義|淡水|信義|松山新店|松山|新店|中和新蘆|新蘆|文湖|環狀|萬大|機場|綠|紅|橘|藍|棕|黃)線/;
const METRO_LINE_ALL = new RegExp(METRO_LINE.source, 'g');
const METRO_ASK = /下一班|幾分|多久|還要等|到站|來了沒|什麼時候來|幾點收|收班|還有車|還有沒有車|還在跑|營運到|誤點|延誤|正常(?:嗎|營運)|有沒有停/; // 「文湖線現在有沒有誤點」（PR #127 審查） // 「捷運幾點收」「還有車嗎」（P4-8）
/** 捷運系統名（真實資料健檢 S5）：說了哪個系統就查那個系統；沒說時站名交給工具在各系統找（不預設台北） */
const METRO_SYS_WORDS = [['KRTC', /高雄捷運|高捷|高雄\s*MRT/i], ['TYMC', /桃園(?:機場)?捷運|機場捷運|機捷|桃捷/], ['TMRT', /[台臺]中捷運|中捷/], ['TRTC', /[台臺]北捷運|北捷/]];
const METRO_SYS_ALL = new RegExp(METRO_SYS_WORDS.map(([, re]) => re.source).join('|'), 'gi');
/** 句子裡說的捷運系統（TRTC／TYMC／TMRT／KRTC）；沒說回 null */
export const metroSystemOf = (s) => METRO_SYS_WORDS.find(([, re]) => re.test(String(s || '')))?.[0] || null;
/** 有起訖的句子（「從板橋坐捷運到台北車站」）：是行程，不是查某一站的捷運看板（S6） */
const OD_SAID = /從.+(?:到|去|往)|[一-龥A-Za-z0-9]\s*(?:到|→|至)\s*[一-龥A-Za-z0-9]/;
/** 不是站名的字頭（「捷運到台北車站」「捷運哪個站比較近」） */
const NOT_METRO_STATION = /^(?:哪|什麼|那|這|最近|附近|到|去|往|從|坐|搭)/;
/**
 * 捷運看板的參數（parseIntentRaw 與判斷層指定 metro 時共用）：站名、系統、路線、末班；有起訖的句子是行程，回 null。
 * @param {string} s 正規化後的句子
 * @param {string[]} places 句子裡的地名（已遮掉捷運系統名與路線名）
 * @param {object} base 共通欄位
 * @param {{ loose?: boolean }} [o] loose：判斷層說是捷運時，「X站」前面沒有「捷運」也收
 */
function metroOf(s, places, base, { loose = false } = {}) {
  const system = metroSystemOf(s);
  const t = s.replace(METRO_SYS_ALL, '捷運'); // 「高雄捷運美麗島下一班」→「捷運美麗島下一班」
  const ask = METRO_ASK.test(t), last = LAST_ASK.test(t);
  if (places.length >= 2 && OD_SAID.test(t) && !ask && !last) return null; // S6：從 A 坐捷運到 B
  const more = { ...(system && { system }), ...(last && { last: true }) };
  const metroWord = /捷運|MRT/i.test(t);
  // 地標庫的捷運站（「中山站下一班」「高雄捷運美麗島下一班」）
  if (places.length === 1 && /^捷運/.test(places[0]) && (/站/.test(t) || metroWord) && (ask || last) && !RAIL_WORD.test(withoutRailNames(t)) && !/公車|巴士/.test(t) && !BUS_ROUTE.test(t)) return { ...base, intent: 'metro', station: places[0].replace(/^捷運/, '').replace(/站$/, ''), ...more };
  const said = (metroWord || loose) && new RegExp(`${loose ? '(?:捷運|MRT)?' : '(?:捷運|MRT)'}\\s*([一-龥]{2,6}?)站`, 'i').exec(t.replace(/(?:[一-龥]{2})?(?:火)?車站/g, (x) => (/^捷運/.test(x) ? x : ' '.repeat(x.length))))?.[1];
  // 說了捷運站、又說要去別的地方、沒問下一班（「從捷運內湖站到台北車站」「我在捷運西門站，要去台北101」）：是排行程，捷運站是起點（腦袋審查 #4）
  const goesOn = !ask && !last && /(?:去|到|往|前往)(?![了站嗎底達])\s*[一-龥A-Za-z0-9]{2,}/.test(t.slice((t.indexOf(said || '\u0000') + 1) || 0));
  if (said && !NOT_METRO_STATION.test(said) && !goesOn) return { ...base, intent: 'metro', station: said, ...more };
  // 說了系統、站名沒加「站」（「高雄捷運巨蛋下一班」）：系統名後面到問法前面的字就是站名
  const bare = system && new RegExp(`捷運\\s*([一-龥]{2,6}?)\\s*(?:的)?\\s*(?=${METRO_ASK.source}|末班|最後一班|首班)`).exec(t)?.[1];
  if (bare && !NOT_METRO_STATION.test(bare) && !METRO_LINE.test(`${bare}線`) && !/^(?:現在|今天|今晚|明天|還|再)/.test(bare)) return { ...base, intent: 'metro', station: bare, ...more };
  // 沒說站（「板南線下一班幾分」「捷運末班車幾點」）：句子裡的地標或現在位置最近的站
  if ((metroWord || METRO_LINE.test(t) || loose) && (ask || last || loose) && !/站/.test(t.replace(/車站|(?:最近|附近|哪一?個?)的?站/g, ''))) return { ...base, intent: 'metro', station: null, line: METRO_LINE.exec(t)?.[0] || null, ...(places[0] && { near: places[0] }), ...more };
  return loose ? { ...base, intent: 'metro', station: null, line: METRO_LINE.exec(t)?.[0] || null, ...(places[0] && { near: places[0] }), ...more } : null;
}

// ───── 國道路況（真實資料健檢 S7）：有起訖查 traffic_status；只說國道幾號沒有起訖時問「從哪到哪？」 ─────
const TRAFFIC = /塞車|塞不塞|會不會塞|會塞|很塞|在塞|車多不多|車流量?|路況|(?:國道|高速公路|國[一三五]|中山高|北二高|五楊|雪隧).{0,8}(?:順不順|好不好走|狀況|車多)/;
/** 問句（「怕塞車，從西門町去101」是排行程，不是問路況） */
const TRAFFIC_Q = /嗎|[?？]|塞不塞|會不會|多不多|如何|怎樣|怎麼樣|狀況|路況|順不順|好不好走/;
/** 不是問國道路況：國道客運、問怎麼去；說了坐公車、捷運、火車（「從板橋去台北車站坐公車會不會塞車」是排行程，PR #127 審查） */
const TRAFFIC_NOT = /客運|怎麼去|怎麼走|怎麼坐|怎麼搭|(?:坐|搭)什麼|帶我去|要去哪|規劃|公車|巴士|捷運|MRT|(?:坐|搭)(?!計程|小黃|uber)/i;
/** 公車路線的路況（「307 公車路況」「307 路況」）：是查那一路公車，不是國道（國道3號、國3 不算） */
const BUS_ROUTE_TRAFFIC = /(?:^|[^\d國道])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)\s*(?:號|路)?\s*(?:公車)?\s*(?:的)?\s*(?:路況|塞)/;
/** 是不是在問國道路況（不是公車、不是指定大眾運輸的行程） */
export const isTrafficAsk = (s) => TRAFFIC.test(s) && TRAFFIC_Q.test(s) && !TRAFFIC_NOT.test(s) && !BUS_ROUTE_TRAFFIC.test(s);
/** 國道（「國道一號」「國一」「中山高」）：只說國道沒有起訖時，問題裡帶上 */
const FREEWAY = /國道\s*(?:[一二三四五六七八十]|\d{1,2})\s*號?|國[一三五](?![中小])|中山高|北二高|五楊(?:高架)?|雪隧|國道(?!客運)|高速公路/;
/** 市區道路（「信義區車多不多」「台北市區路況」）：路況資料只有國道，照實說（不問國道起訖，PR #127 審查） */
const CITY_ROAD = /市區|市內|市中心|[一-龥](?:區|路|街|大道)(?:的|車|路況|塞|現在)/;
/**
 * 國道路況的起訖：兩個地名照「從／到」排；一個地名＋「去／到」＝從現在位置去那裡；
 * 沒有地名時接著上一趟行程（「那會塞車嗎」）；只說市區（一個地方、沒說國道）＝照實說只有國道資料（cityOnly）；
 * 都沒有＝缺起訖（needs: 'od'），問「從哪到哪？」，不拿同一個點亂查。
 */
function trafficOf(s, places, base, prevTrip) {
  const m = FREEWAY.exec(s)?.[0]?.replace(/\s+/g, '');
  const freeway = m && !/^(?:國道|高速公路)$/.test(m) ? m : null;
  const fw = freeway ? { freeway } : {};
  if (places.length >= 2) { const [from, to] = orderFromTo(s, places); return { ...base, intent: 'traffic', from, to, ...fw }; }
  if (places.length === 1 && /(?:去|到|往|回)\s*\S/.test(s)) return { ...base, intent: 'traffic', from: FROM_TEXT.exec(s)?.[1] ?? null, to: places[0], ...fw };
  if (!m && (places.length === 1 || CITY_ROAD.test(s))) return { ...base, intent: 'traffic', from: null, to: null, cityOnly: true, ...(places[0] && { area: places[0] }) };
  const prev = !places.length ? prevTrip() : null;
  if (prev?.to || prev?.toSaved) return { ...base, intent: 'traffic', from: prev.from || null, to: prev.to, ...(prev.fromSaved && { fromSaved: prev.fromSaved }), ...(prev.toSaved && { toSaved: prev.toSaved }), followUp: true, ...fw };
  return { ...base, places: [], intent: 'traffic', from: null, to: null, needs: 'od', ...fw };
}
/** 判斷層有把握說是路況、句子提到國道（「國道有車禍嗎」「國道一號」）：也當路況（問起訖） */
const trafficLike = (s) => isTrafficAsk(s) || (FREEWAY.test(s) && !/客運/.test(s) && !BUS_ROUTE_TRAFFIC.test(s));

// ───── 貼上的詐騙樣式簡訊：生活阿幫不亂查，請他帶到防詐（真實資料健檢 f01） ─────
//   要同時有：網址、催促、要你點連結或輸入資料，再加上金錢或冒名的機關／物流特徵；有起訖、問怎麼去、提到地名、官方網域的一般問題不算（PR #127 審查）
const SCAM_LINK = /https?:\/\/[^\s，,。]+|www\.[^\s，,。]+|\b[a-z0-9-]{2,}(?:\.[a-z0-9-]+)*\.(?:cc|com|net|org|tw|top|xyz|info|vip|shop|link|me|io|co|app|site|online|club|icu|live|gle)\b[^\s，,。]*/gi;
const SCAM_URGE = /\d+\s*(?:小時|分鐘|天)內|立即|立刻|盡快|儘速|即日|今日內|今天內|逾期|限期|否則|最後通知|將(?:被)?(?:停用|凍結|註銷|退回|銷毀|取消|罰|停電|停水)/;
const SCAM_DO = /點擊|點選|點此|點連結|登入|更新(?:資料|資訊)|驗證|填寫|輸入|回覆/;
const SCAM_BAIT = /匯款|轉帳|付款|繳費|繳納|補繳|罰款|退款|退費|中獎|領取|獎金|帳戶|帳號|信用卡|點數|驗證碼|密碼|欠費|通行費|運費|關稅|包裹|地址不全|無法投遞|停用|凍結|停電|停水|^【[^】]{2,10}】/;
/** 官方網域（政府、高鐵、台鐵、郵局、學校）：連結是這些的不當詐騙樣式 */
const OFFICIAL_HOST = /(?:^|\.)(?:gov\.tw|edu\.tw|thsrc\.com\.tw|railway\.gov\.tw|post\.gov\.tw|ipost\.post\.gov\.tw)$/i;
const hostOf = (u) => { const m = /^(?:https?:\/\/)?([^/\s?#:]+)/i.exec(u); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; };
/** 看起來是貼上來的詐騙樣式訊息（places：句子裡認得的地名，沒給就自己找） */
export function looksScamPaste(s0, places = null) {
  const s = String(s0 || '');
  const links = s.match(SCAM_LINK) || [];
  if (!links.length || links.every((u) => OFFICIAL_HOST.test(hostOf(u)))) return false;
  if (!(SCAM_URGE.test(s) && SCAM_DO.test(s) && SCAM_BAIT.test(s))) return false;
  const bare = s.replace(SCAM_LINK, ' ');
  if (OD_SAID.test(bare) || /怎麼(?:去|走|坐|搭)|要去|想去|帶我去/.test(bare)) return false; // 一般的交通問題順手貼了連結
  if ((places ?? placesInText(bare)).length) return false; // 提到地名：是在問那裡（詐騙簡訊通常不帶地標）
  return true;
}

/** 以座標查「附近」的意圖：工具與點名 */
export const NEARBY = {
  youbike: ['youbike_nearby', '@YouBike 附近還有車嗎'],
  nearby_bus: ['bus_nearby_stations', '@公車 附近有哪些站牌'],
  weather: ['weather_now', '@天氣 看一下現在的天氣'],
  weatherTomorrow: ['weather_tomorrow', '@天氣 看一下明天的預報'],
  aqi: ['aqi_nearby', '@空品 附近測站的空氣品質'],
  garbage: ['garbage_truck_nearby', '@垃圾車 附近的清運點和時間'],
};
export const isNearby = (it) => Object.hasOwn(NEARBY, it.intent);

/** 需要使用者所在位置嗎（行程沒起點；附近類查詢沒地點） */
export const needsLocation = (it) => !it.savedAt && ((it.intent === 'gov' && it.govOffice) || (it.intent === 'traffic' && !it.needs && !it.cityOnly && !it.from && !it.fromSaved) || (it.intent === 'pharmacy' && !it.area && !it.places?.[0]) || (it.intent === 'trip' && ((!it.from && !it.fromSaved) || (it.toHere && !it.toSaved))) || ((isNearby(it) || it.intent === 'bus_route') && !it.places[0]) || (it.intent === 'metro' && !it.station && !it.near) || (it.intent === 'outing' && !it.places[0]) || (it.intent === 'rail' && (it.fare ? !!it.to && (!it.from || it.fromGuess) : !it.from && !it.near && (!!it.to || (it.anyTo && it.system === 'THSR')))));

/** 出發是哪一天（總結、聽懂了什麼用） */
export const dayWord = (it) => ['今天', '明天', '後天'][it.departDays ?? (it.tomorrow ? 1 : 0)] || '今天';
const MODE_SAY = { walk: '走路', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' };
const MODE_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '坐捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車', drive: '開車' };
const STATE_SAY = { rush: '趕時間', luggage: '帶行李', budget: '想省錢', lessWalk: '少走路', rain: '下雨', badAir: '空氣差', traffic: '塞車', elder: '帶長輩', kids: '帶小孩', mobility: '行動不便' };
/**
 * 接著改的那一輪，討論串第一句說清楚沿用什麼、改了什麼（PR #35 設計審查）：「沿用：西門町 → 台北101｜改：不要叫車」
 * @returns {string|null}
 */
export function contextNote(it) {
  if (!it?.followUp || it.intent !== 'trip' || !it.to || !it.changed?.length) return null;
  const say = { from: `起點${it.from || '你的位置'}`, to: `目的地${it.to}`, arriveBy: `${it.arriveBy} 前到`, mode: MODE_DO[it.mode] || '換方式', avoid: `不要${(it.avoid || []).map((m) => MODE_SAY[m]).join('、')}`, party: it.party > 1 ? `${it.party} 人` : '自己一個人', departAt: `${dayWord(it)} ${it.departTime} 出發`, states: (it.states || []).map((k) => STATE_SAY[k]).filter(Boolean).join('、') };
  const changed = it.changed.map((k) => say[k]).filter(Boolean).join('、');
  return `沿用：${it.from || '你的位置'} → ${it.to}｜改：${changed}`.slice(0, 60);
}

/**
 * 行程的出發時間（示範與模型模式共用）：明天 → 抵達前 4 小時（不早於捷運首班 06:00；抵達時間在 07:00 前才更早，至少早 1 小時）或 06:00；今天 → 現在（測試可指定 now；深夜判斷末班車）
 * 合成的出發時間不是使用者說的：不能讓 plan_trip 以為凌晨 05:00 出發而把捷運當成收班（PR #110 審查）
 * @returns {string} 'YYYY-MM-DDTHH:mm'（台灣時間）
 */
export function tripDepartAt(it, now = Date.now()) {
  if (it.departTime) return `${nowTW(now + (it.departDays ?? (it.tomorrow ? 1 : 0)) * 864e5).date}T${it.departTime}`; // 說了幾點出發（P5-2；晚上 12 點＝隔天）
  if (it.tomorrow) {
    const date = nowTW(now + 864e5).date;
    const h = it.arriveBy ? Number(it.arriveBy.slice(0, 2)) : null;
    return `${date}T${h != null ? `${String(Math.max(0, Math.min(6, h - 1), h - 4)).padStart(2, '0')}:00` : '06:00'}`;
  }
  const t = nowTW(now);
  return `${t.date}T${t.hhmm}`;
}

/** 常用地點有被提到（手機端 public/js/saved-places.js WORDS 相同：提到才送座標；test/saved-places.test.js 比對） */
/** 會延續到下一趟的狀況（跟「人」有關，不是一時的：趕時間、想省錢不延續） */
const THERE = /那裡|那邊|那兒|那附近|目的地/;
const LASTING_STATES = new Set(['mobility', 'elder', 'kids', 'luggage']);
const OTHER_PERSON = /朋友|同學|同事|(?<![其吉])[他她]|別人|自己一個人|一個人去|不帶|幫.{0,3}(?:家人|爸|媽)/;
/** 可以用常用地點當位置的附近查詢 */
const SAVED_NEARBY = new Set(['garbage', 'pharmacy', 'weather', 'aqi', 'youbike', 'nearby_bus', 'outing']);
export const SAVED_WORDS = { 家: /回家|到家|去家|家裡|我家|回去家|從家|家出發/, 公司: /公司|上班|下班/, 學校: /學校|上學|上課|放學/ };
/** 地點後面接這些＝說的是別的地方（「從我家巷口」「回家的路」「公司樓下」） */
const NB = '(?!巷|口|附近|旁|對面|樓|門口|那|這|前面|後面|隔壁|的|鄉|族|具|人)';
const SAVED_TO = {
  家: new RegExp(`(?:回|到|去)(?:我)?家(?:裡)?${NB}|回去家`),
  公司: new RegExp(`(?:去|到|回)(?:我的?)?公司${NB}|上班`),
  學校: new RegExp(`(?:去|到|回)(?:我的?)?學校${NB}|上學|去上課`),
};
/** 從那裡出發（起點） */
const SAVED_FROM = {
  家: new RegExp(`從\\s*(?:我)?家(?:裡)?${NB}|(?:我)?家(?:裡)?\\s*出發`),
  公司: new RegExp(`從\\s*(?:我的?)?公司${NB}|公司\\s*出發|下班`),
  學校: new RegExp(`從\\s*(?:我的?)?學校${NB}|學校\\s*出發|放學`),
};
/** 提到常用地點但不是要規劃去那裡：附近查詢、天氣、路上、正在那裡、已經到了、多站行程（「回家前先去全聯」交給一般規則） */
const SAVED_NOT_TRIP = /附近|周邊|周圍|旁邊|路上|下雨|帶傘|天氣|氣溫|溫度|空品|空氣|藥局|垃圾車|youbike|ubike|地震|油價|發票|股|電話|地址|前先|之前|順便|我在(?:家|公司|學校|上班|上課)|在家|到家了|了[。!！~～]?$/i;
/**
 * 常用地點的行程（S1）：句子要「去／回／從」常用地點才算（「我家附近的藥局」「明天上班會下雨嗎」不算）。
 * 目的地＝SAVED_TO 的那個，起點＝SAVED_FROM 的那個；另一端可以是地標或現在位置。要用的地點手機上沒設定 → savedMissing（不猜）。
 * @returns {object|null} { intent: 'trip', from, to, fromSaved?, toSaved?, savedTrip: true } 或 { intent: 'savedMissing', missing }
 */
export function savedTrip(s, places, saved = {}) {
  if (SAVED_NOT_TRIP.test(s)) return null;
  const keys = Object.keys(SAVED_TO);
  const fromKey = keys.find((k) => SAVED_FROM[k].test(s)) || null;
  const toKey = keys.find((k) => k !== fromKey && SAVED_TO[k].test(s)) || null;
  if (!fromKey && !toKey) return null;
  const fromPlace = !fromKey && /從/.test(s) ? places[0] : null; // 「從台北101回家」
  const toPlace = !toKey ? places.find((p) => p !== fromPlace) : null; // 「從公司去台北101」
  if (!toKey && !toPlace) return null; // 「從家出發」沒說去哪：交給一般規則
  const missing = [toKey, fromKey].find((k) => k && !saved?.[k]);
  if (missing) return { intent: 'savedMissing', missing };
  const pt = (k) => ({ lat: saved[k].lat, lon: saved[k].lon, name: k });
  return {
    intent: 'trip', savedTrip: true,
    from: fromKey || fromPlace || null, to: toKey || toPlace,
    ...(fromKey && { fromSaved: pt(fromKey) }), ...(toKey && { toSaved: pt(toKey) }),
  };
}

/** 只有英文（沒有中文字）＝英文提問 */
export const isEnglish = (s) => /[A-Za-z]{2,}/.test(s) && !/[一-鿿]/.test(s) && !BRAND_ONLY.test(String(s).trim()); // 只打「youbike」「ubike」是品牌名，不是用英文問（PM 第二輪）
const BRAND_ONLY = /^(?:you\s*bike|u\s*bike|uber|line)[\s?？!！.。]*$/i;
const EN_STATES = [['rush', /hurry|late|asap|quick(?:ly)?|fastest/i], ['luggage', /luggage|suitcase|\bbags?\b/i], ['budget', /cheap|budget|save money/i],
  ['lessWalk', /walk less|don'?t want to walk|tired/i], ['elder', /grand(?:ma|pa|mother|father|parents?)|elderly/i], ['kids', /\bkids?\b|child(?:ren)?|stroller|baby/i], ['mobility', /wheelchair|disabled|crutch/i]];
const EN_MODES = [['intercity', /intercity|long[- ]distance bus|\bcoach\b/i], ['bus', /\bbus\b/i], ['metro', /\b(?:mrt|metro|subway)\b/i], ['drive', /\b(?:drive|driving|my (?:own )?car)\b/i], ['ridehail', /\b(?:taxi|uber|cab)\b/i], ['walk', /\bwalk(?:ing)?\b/i], ['bike', /(?:\b(?:you)?bike\b|\bride\s+(?:one|a bike)\b)/i], ['thsr', /high[- ]speed rail|\bhsr\b/i], ['tra', /\btrain\b|railway/i]];
/** 英文城市名 → 台鐵／高鐵站名（「next train to Taichung」） */
const EN_RAIL = { taipei: '臺北', banqiao: '板橋', taoyuan: '桃園', hsinchu: '新竹', miaoli: '苗栗', taichung: '臺中', changhua: '彰化', chiayi: '嘉義', tainan: '臺南', kaohsiung: '高雄', zuoying: '左營', yilan: '宜蘭', hualien: '花蓮', taitung: '臺東', keelung: '基隆', nangang: '南港' };
const RAIN = /\brain(?:ing|y|s)?\b|umbrella|weather|temperature|\bhot\b(?!\s*springs?)|\bcold\b|\bwarm\b|\bwear\b|jacket|\bcoat\b|sweater/i;
/** 英文提問 → 意圖與參數（地名已由 placesInText 依英文別名找出）；接著上一輪改條件（I'm with my grandma、by bus instead） */
function englishIntent(s, places, history = []) {
  const states = EN_STATES.filter(([, re]) => re.test(s)).map(([k]) => k);
  const tomorrow = /tomorrow/i.test(s);
  const party = partyOf(s);
  const base = { places, states, arriveBy: enArriveBy(s), tomorrow, ...(party && { party }) };
  const mode = EN_MODES.find(([, re]) => re.test(s) && !new RegExp(`(?:no|not|don'?t (?:want to )?(?:take|use)?)\\s*(?:the|a|by)?\\s*${re.source}`, 'i').test(s))?.[0];
  const avoid = EN_MODES.filter(([, re]) => new RegExp(`(?:\\bno\\b|\\bnot\\b|don'?t (?:want to )?(?:take|use)?)\\s*(?:the|a|by)?\\s*(?:${re.source})`, 'i').test(s)).map(([k]) => k);
  const toWord = places.length > 0 && /\bto\b/i.test(s);
  if (/^(?:ok|okay|sure|got it|alright|all right|no thanks|nope|no need)[.!]*$/i.test(s.trim())) return { ...base, intent: 'unknown', ack: true };
  // 只說要叫車（「Call a taxi」）：有前一趟就改叫車，沒有就問要去哪（PM Q-26）
  if (!places.length && /^(?:please\s+)?(?:(?:call|get|book|order|find)\s+(?:me\s+)?(?:a\s+)?(?:taxi|cab|uber)|i\s+(?:need|want)\s+a\s+(?:taxi|cab|uber)|(?:a\s+)?(?:taxi|cab|uber))(?:\s+please)?[.!?]?$/i.test(s.trim())) {
    const prev = history.length ? lastTrip(history) : null;
    if (prev?.to || prev?.nearRail) { const { mode: _m, ...rest } = prev; return { ...rest, intent: 'trip', mode: 'ridehail', followUp: true }; }
    return { ...base, intent: 'trip', from: null, to: null, mode: 'ridehail', needs: 'to' };
  }
  // 要出門了（「I want to go out」）：出門建議＋問要去哪
  if (/^(?:i\s+(?:want|need|have|am going|'m going|am about|'m about)\s+to\s+go\s+out|i'?m\s+(?:heading|going)\s+out(?:\s+now)?|(?:heading|going)\s+out(?:\s+now)?)[.!]?$/i.test(s.trim())) return { ...base, intent: 'outing', askTo: true };
  // 國道路況（「Is the freeway jammed from Taipei to Hsinchu?」）：同中文的 traffic；沒有起訖問從哪到哪
  if (/\b(?:traffic|jam(?:med|s)?|congest\w*)\b/i.test(s) && !/\b(?:bus|mrt|metro|subway|train|hsr)\b|traffic light/i.test(s)) {
    const fromWord = /\bfrom\s+(.+?)(?:\s+to\b|[?.!,]|$)/i.exec(s)?.[1];
    const fromPlace = fromWord ? placesInText(fromWord)[0] || null : null;
    if (places.length >= 2) { const from = fromPlace || places[0]; return { ...base, intent: 'traffic', from, to: places.find((p) => p !== from) }; }
    if (places.length === 1 && /\bto\b/i.test(s)) return { ...base, intent: 'traffic', from: null, to: places[0] };
    return { ...base, intent: 'traffic', from: null, to: null, needs: 'od' };
  }
  const airEn = airportTrip(s, places, { en: true }); // 「How do I get to the airport?」沒說哪個機場：同中文「去機場」
  if (airEn) return { ...base, ...airEn, ...(mode && !airEn.mode && { mode }) };
  // 沒說哪一站的「train station」「HSR station」：去最近的台鐵／高鐵站（同中文「去火車站」，PM Q-26）
  const nearRailEn = !places.length && /\b(train|railway|hsr|high[- ]speed rail)\s+station\b/i.exec(s);
  if (nearRailEn && /\b(?:get|go|take me|how|way|directions?)\b/i.test(s)) return { ...base, intent: 'trip', from: null, to: null, nearRail: /hsr|high/i.test(nearRailEn[1]) ? 'THSR' : 'TRA' };
  // 火車在天氣之前（「train」裡有「rain」）
  const rail = /\btrains?\b|high[- ]speed rail|\bhsr\b/i.test(s) && /(?:\bto|for)\s+([a-z]+)/i.exec(s);
  if (rail && EN_RAIL[rail[1].toLowerCase()]) {
    const from = /\bfrom\s+([a-z]+)/i.exec(s)?.[1]?.toLowerCase();
    const system = /high[- ]speed|\bhsr\b/i.test(s) ? 'THSR' : 'TRA';
    // 票價（「How much is the HSR ticket to Kaohsiung?」）：沒說起站先從台北算（總結會說，P3-7）
    if (/how much|\bfares?\b|\bprice\b|\bcost\b|ticket price/i.test(s)) return { ...base, intent: 'rail', fare: true, system, from: EN_RAIL[from] || (EN_RAIL[rail[1].toLowerCase()] === '臺北' ? null : '臺北'), to: EN_RAIL[rail[1].toLowerCase()], ...(!EN_RAIL[from] && EN_RAIL[rail[1].toLowerCase()] !== '臺北' && { fromGuess: true }) };
    return { ...base, intent: 'rail', system, from: EN_RAIL[from] || null, to: EN_RAIL[rail[1].toLowerCase()] };
  }
  if (/air quality|\baqi\b|pm ?2\.?5|smog/i.test(s)) return { ...base, intent: 'aqi' };
  // 出門建議（S12e）：「What should I bring/wear?」「Do I need an umbrella?」「Is it OK to go out?」（問明天的交給天氣預報）
  if (!tomorrow && !toWord && /what (?:should|do) i (?:bring|wear)|umbrella|jacket|(?:good|ok|okay) (?:time )?to go out/i.test(s)) return { ...base, intent: 'outing' };
  // 去政府辦事（PM 審查 #6，2026-11-28）：戶政事務所、護照現場等待人數；觀光客掉了護照（先報警、找自己國家的駐台機構，不是台灣人的護照遺失申報）
  if (/\b(?:lost|lose|missing|stolen)\b.{0,20}\bpassport\b|\bpassport\b.{0,20}\b(?:lost|missing|stolen)\b/i.test(s)) return { ...base, places: [], intent: 'gov', lostPassportEn: true };
  if (/\bpassport (?:office|bureau)|\bBOCA\b/i.test(s) || (/\bpassport\b/i.test(s) && /\b(?:wait|waiting|queue|line|busy|crowded|how many people)\b/i.test(s))) return { ...base, places: [], intent: 'gov', govPassport: true };
  if (/household registration|registration office|\bhukou\b/i.test(s)) return { ...base, places: [], intent: 'gov', govOffice: true };
  if (/\b(?:clinics?|doctors?|dentists?|pediatricians?|see a doctor)\b/i.test(s) && !/pharmac|drug ?store|how (?:do|can|should) i get|\bto (?:the )?[a-z ]*hospital\b/i.test(s)) { // 「Is there a clinic open near me?」：找診所（依位置推估行政區）
    const dept = /dentist|dental/i.test(s) ? 'dental' : /pediatric|children'?s doctor/i.test(s) ? 'peds' : /\bENT\b|ear,? nose/i.test(s) ? 'ent' : null;
    return { ...base, intent: 'pharmacy', clinic: true, area: null, ...(dept && { dept }) };
  }
  if (/pharmac|drug ?store|chemist|buy medicine|get medicine/i.test(s)) return { ...base, intent: 'pharmacy', area: null }; // 「pharmacy near me」：依位置推估行政區
  if (RAIN.test(s) && !toWord) {
    // 「Is it raining there?」：there＝上一趟的目的地（中文「那裡」同 P2-7；P5-6）
    const there = !places.length && /\bthere\b/i.test(s) && history.length && lastTrip(history)?.to;
    return { ...base, intent: 'weather', ...(there && { places: [there] }) };
  }
  // 「Any YouBike near Tamsui Fisherman's Wharf?」「YouBike near Taipei 101」：那裡附近的 YouBike，不是行程（P5-7）
  if (/youbike|ubike|\bbikes?\b/i.test(s) && places.length && /\b(?:near|around|close to|next to|by|at)\b/i.test(s) && !/\bto\b(?!\s+(?:rent|borrow))/i.test(s.replace(/\b(?:close|next) to\b/gi, ''))) return { ...base, intent: 'youbike' };
  const route = /\bbus\s*(?:no\.?\s*)?([0-9]{1,4}[A-Za-z]?)\b/i.exec(s)?.[1];
  if (route && !toWord) return { ...base, intent: 'bus_route', route };
  // 阿幫剛問「Where are you going? / Where are you starting from?」，只回地名：接回上一輪（起點或目的地沿用）
  const lastBotEn = String(history.filter((m) => m.role === 'assistant').at(-1)?.content || '');
  if (places.length === 1 && s.trim().split(/\s+/).length <= 4 && (ASKED_DEST_EN.test(lastBotEn) || ASKED_ORIGIN_EN.test(lastBotEn))) {
    const asked = lastTrip(history);
    if (asked && ASKED_DEST_EN.test(lastBotEn) && !asked.to && asked.from !== places[0]) { const { needs: _n, ...a } = asked; return { ...a, to: places[0], intent: 'trip', followUp: true, lang: 'en' }; }
    if (asked?.to && ASKED_ORIGIN_EN.test(lastBotEn) && asked.to !== places[0]) { const { needs: _n, ...a } = asked; return { ...a, from: places[0], intent: 'trip', followUp: true, lang: 'en' }; }
  }
  // 缺必要欄位（ADR-0016）：問公車多久到但沒說哪一路（「How long until the bus comes?」；車站在哪、在等車、有沒有夜車都不問）；只說從哪裡出發
  if (/\bbus\b/i.test(s) && !/\d/.test(s) && /how long|when (?:is|will|does) (?:the|my) bus (?:come|arrive|get)|where is (?:the|my) bus\b(?!\s+(?:stop|station|terminal))|bus (?:is )?(?:so )?late|bus (?:still )?(?:not|hasn'?t) (?:come|arrived)/i.test(s) && !places.length && !/\bnear(?:by)?\b|\bstops?\b|\bstation\b|night|\bfare|ticket|card|\bpay\b/i.test(s)) return { ...base, intent: 'bus_route', route: null, needs: 'route' };
  if (places.length === 1 && /\b(?:leaving|starting|departing|setting off|heading out)\s+from\b|\bI'?m (?:at|in)\b.*\b(?:leaving|heading out|about to (?:go|leave)|setting off)\b/i.test(s) && !/\bto\b(?!\s+(?:go|leave))|\bhome\b|\boffice\b|\bwork\b|\bschool\b/i.test(s.replace(/\babout to\b/gi, ''))) return { ...base, intent: 'trip', from: places[0], to: null, needs: 'to' };
  if ((places.length && (toWord || /directions|how (?:do|can) i get|take me|how far/i.test(s))) || (places.length === 1 && s.trim().split(/\s+/).length <= 4)) {
    const fromWord = /\bfrom\s+(.+?)(?:\s+to\b|[?.!,]|$)/i.exec(s)?.[1]; // 「from A to B」與「to B from A」
    const fromPlace = fromWord ? placesInText(fromWord)[0] : null;
    const to = places.find((p) => p !== fromPlace) || places[0];
    return { ...base, intent: 'trip', from: fromPlace || null, to, ...(mode && { mode }), ...(avoid.length && { avoid }) };
  }
  // 接著上一輪（I'm with my grandma、by bus instead、What about by MRT?、no taxi）
  const prev = !places.length && history.length ? lastTrip(history) : null;
  if (prev && ((mode && /instead|what about|how about|\bby\b|rather|switch|change/i.test(s)) || avoid.length || states.length || base.arriveBy || base.party)) {
    const { mode: _m, avoid: _a, ...rest } = prev;
    const avoidAll = [...new Set([...(prev.avoid || []), ...avoid])].filter((m) => m !== mode);
    const useMode = mode || (avoidAll.includes(prev.mode) ? null : prev.mode);
    return { ...rest, intent: 'trip', states: [...new Set([...prev.states, ...states])], ...(useMode && { mode: useMode }), ...(avoidAll.length && { avoid: avoidAll }), ...((base.arriveBy || prev.arriveBy) && { arriveBy: base.arriveBy || prev.arriveBy }), ...(base.party && { party: base.party }), followUp: true };
  }
  if (/youbike|ubike|\bbikes?\b/i.test(s) && !places.length) return { ...base, intent: 'youbike' };
  if (/\b(?:mrt|metro|subway)\b/i.test(s) && (/next|when|how long|last train/i.test(s) || /^\s*(?:is\s+)?(?:the\s+)?(?:taipei\s+)?(?:mrt|metro|subway)\s+(?:still\s+)?(?:running|open|operating)|\b(?:is|are)\s+(?:the\s+)?(?:mrt|metro|subway)(?:\s+trains?)?\s+(?:still\s+)?(?:running|open|operating)/i.test(s))) return { ...base, intent: 'metro', station: null, line: null }; // 「Is the MRT still running now?」（P3-6）
  // 找短劇（ADR-0019）：「Any good short dramas?」「Recommend a romance drama」（片庫是中文，回答會說明）
  if (isEnDramaAsk(s) && !toWord) {
    const g = [['甜寵', /\bromance|romantic|sweet\b/i], ['懸疑', /mystery|thriller|suspense/i], ['喜劇', /comedy|funny/i], ['復仇', /revenge/i], ['古裝', /costume|historical|period/i]].find(([, re]) => re.test(s))?.[0];
    return { ...base, intent: 'drama', ...(g ? { dramaQuery: g } : { dramaList: /\bnew\b|latest/i.test(s) ? 'new' : /complete|finished|binge/i.test(s) ? 'completed' : 'hot' }) };
  }
  if (/thank/i.test(s)) return { ...base, intent: 'unknown', thanks: true };
  return { ...base, intent: 'unknown' };
}
/** 「before 9am」「by 10:30 pm」→ 'HH:mm' */
function enArriveBy(s) {
  const m = /\b(?:before|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(s);
  if (!m) return relArrive(s); // 「I need to be there in 30 minutes」
  let h = Number(m[1]);
  if (/pm/i.test(m[3] || '') && h < 12) h += 12;
  if (/am/i.test(m[3] || '') && h === 12) h = 0;
  return h <= 23 ? `${String(h).padStart(2, '0')}:${m[2] || '00'}` : null;
}
