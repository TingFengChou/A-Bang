// 防詐示範意圖（M7-05，AGENT_ANTIFRAUD.md §6）：規則式判斷要用哪個工具，事件流與模型模式相同。
import { extractUrls, NOT_SAFE_NOTE } from '../scam-check.js';
import { isEnglish } from './demo-intent.js';

const SENDER = /(\+\d[\d\s-]{0,16}\d|\b0\d[\d-]{7,11}\d\b|\b1\d{2}\b|\b\d{4,6}\b)/;

// 事後求助（P5-10）：已經匯款、給了驗證碼或說自己被騙 → 先給止損步驟，不是「沒有發現詐騙特徵」。
// 寧可窄：擔心（怕、差點、會不會）、否定（沒有給）、一般付款（轉帳給朋友、付款買東西、地址給物流）都不算，照常比對訊息。
const SCAMMED = /我.{0,4}(被騙|被詐騙|遭詐騙|遭到詐騙|上當|中計)/;
const WORRY = /(怕|害怕|差點|險些|會不會|擔心|是不是|以免|避免|不想|防止|小心).{0,4}(被騙|被詐騙|遭詐騙|上當|中計)/;
const THIRD = /(朋友|家人|爸|媽|阿嬤|阿公|爺爺|奶奶|外婆|外公|同事|鄰居|老公|老婆|先生|太太|兒子|女兒|長輩|親戚)(好像|可能|已經|剛剛)?(被騙|被詐騙|遭詐騙|遭到詐騙|上當)/;
const NEG = /(沒有|沒|未|不曾|並未|還沒|從沒)(有)?.{0,4}(給|匯|轉|付|提供|告訴|輸入|交|被騙|上當)/;
/** 詐騙語境：句中提到騙、詐、假客服、對方或陌生人要我做… */
const SCAM_CTX = /騙|詐|假(?!日|期|設|如)|對方要我|客服要我|陌生|投資群組|檢察官|監管帳戶|解除分期|網友|老師要我|他要我|叫我(匯|轉|操作|買點數)/;
const PAID = /(已經|已|剛剛|剛才|剛|不小心|昨天|今天).{0,8}(匯|轉帳|轉了|轉過去|付了|付款|給了|交給|交出|提供|輸入)/;
/** 「我已經把錢匯過去了怎麼辦」：沒有前文也當事後求助（把錢匯出去後問怎麼辦）；轉給朋友、房東這類一般對象不算 */
const SENT_MONEY = /把錢.{0,4}(匯|轉)(過去|出去)了/;
const BENIGN_PARTY = /(給|跟)(朋友|房東|家人|爸|媽|同事|店家|老闆|賣家|房仲|物流)|(朋友|房東|家人|同事|店家|老闆|賣家)說?(沒|還沒)收到/;
const ASK_HELP = /怎麼辦|該怎麼|要怎麼|怎麼處理|怎麼做|救我|追回|拿回|要回來|來得及/;
const GAVE_CODE = /(給了?|告訴了?|傳給了?|交給了?|唸給|報給).{0,4}(對方|詐騙|騙子|陌生人|假客服|那個人).{0,8}(驗證碼|認證碼|OTP|簡訊碼|密碼|提款卡|存摺)|(驗證碼|認證碼|OTP|簡訊碼|密碼|提款卡|存摺).{0,6}(給了|告訴了?|傳給了?|交給了?|唸給|報給)(對方|詐騙|騙子|陌生人|假客服|那個人)/;
/** 對方在跟你要錢（貼上的冒充親友訊息「我被騙了，可以先匯我 5 萬嗎」），不是本人事後求助 */
const ASKS_ME = /借我|匯(給)?我|轉(給)?我|給我.{0,4}(錢|萬|千)/;
/** 上一輪剛判過有詐騙特徵（「先不要照做」「有疑點」）：接著說「我已經付了怎麼辦」就是事後求助 */
const PRIOR_SCAM = /先不要照做|有疑點|詐騙常見特徵/;

/**
 * 使用者說自己已經被騙、已匯款或給了驗證碼 → 'paid'（錢出去了）、'code'（只給了驗證碼或密碼）、'friend'（家人朋友被騙）；否則 null
 * @param {string} text
 * @param {{ history?: Array<{ role: string, content: string }> }} [opt] 前文（上一輪剛判過詐騙時，一般的「已經付了怎麼辦」也算）
 */
export function aftermath(text, { history = [] } = {}) {
  const s = String(text ?? '');
  if (ASKS_ME.test(s) || NEG.test(s)) return null;
  if (THIRD.test(s) && !WORRY.test(s)) return 'friend';
  const prior = history.filter((m) => m.role === 'assistant').at(-1);
  const ctx = SCAM_CTX.test(s) || PRIOR_SCAM.test(prior?.content || '');
  const scammed = SCAMMED.test(s) && !WORRY.test(s);
  const code = GAVE_CODE.test(s);
  const paid = ASK_HELP.test(s) && ((SENT_MONEY.test(s) && !BENIGN_PARTY.test(s)) || (PAID.test(s) && ctx && !BENIGN_PARTY.test(s)));
  if (!scammed && !code && !paid) return null;
  return code && !/匯|轉帳|轉了|付了|付款|錢/.test(s) ? 'code' : 'paid';
}

/** 事後求助的固定步驟（不經工具；模型模式的規則在 antifraud.json） */
const AFTERMATH = {
  paid: '先別慌，越快處理越有機會把錢攔下來：\n① 馬上撥 165 反詐騙專線或 110 報案。\n② 打給您的銀行或發卡行客服，說明被詐騙，要求止付、凍結轉出的款項或卡片。\n③ 保留對話、簡訊、通話與轉帳紀錄和對方帳號，先不要刪除。\n④ 如果也給了驗證碼或密碼，立刻改密碼、登出其他裝置，並通知該服務（例如 LINE、網銀）。\n之後若有人說能幫您追回錢、要您先付費，也是詐騙。',
  friend: '幫家人或朋友處理，越快越有機會把錢攔下來：\n① 請他馬上撥 165 反詐騙專線或 110 報案（您可以陪他一起打）。\n② 請他打給自己的銀行或發卡行客服，說明被詐騙，要求止付、凍結轉出的款項或卡片。\n③ 保留對話、簡訊、通話與轉帳紀錄和對方帳號，先不要刪除。\n④ 如果他給了驗證碼或密碼，幫他改密碼、登出其他裝置，並通知該服務（例如 LINE、網銀）。\n之後若有人說能幫忙追回錢、要先付費，也是詐騙。',
  code: '先別慌，馬上做這幾件事：\n① 立刻到該服務（例如 LINE、網銀、購物網站）改密碼、登出其他裝置，並通知該服務的官方客服。\n② 撥 165 反詐騙專線或 110 報案。\n③ 如果這個帳號綁了銀行帳戶或信用卡，打給銀行或發卡行客服，要求止付或凍結。\n④ 保留對話與簡訊紀錄，先不要刪除；提醒親友，對方可能冒用您的帳號借錢。',
};

/** 使用者這句話要查什麼：aftermath（已被騙、已匯款或給了驗證碼：先給止損步驟）、sender（簡訊號碼）、url（只有網址）、myth（是真的嗎）、message（其他一律當可疑內容檢查） */
/** 只有「是不是詐騙」的問法、沒有可以比對的內容（沒有網址、號碼、實際訊息文字） */
export const SCAM_ASK = /詐騙嗎|是不是詐騙|是詐騙|是騙人的嗎|可疑嗎|幫我看(?:看|一下)?|幫我檢查|這(?:是|個)?(?:安全|真的)嗎/;
export function isEmptyAsk(text) {
  const s = String(text ?? '');
  if (!SCAM_ASK.test(s) || /\d{4,}|https?:|www\.|\.(?:com|tw|net|cc|xyz)\b/i.test(s)) return false;
  const rest = s.replace(/這(?:是|個|封|則|通)?|那(?:個|封|則)?|是不是|是|詐騙|騙人的?|嗎|幫我|看(?:看|一下)?|檢查|我|剛剛|剛才|今天|收到|接到|一(?:封|則|個|通)|簡訊|訊息|LINE|line|電話|來電|信件?|email|e-mail|可疑|安全|真的|的|了|呢|啊|[？?。，,!！:：\s]/g, '');
  return rest.length <= 2;
}

/** 問號碼時常見的字（去掉後剩下的才是對方說了什麼） */
const SENDER_FILLER = /這(?:個|支|通|封|則)?|號碼|電話|手機|簡訊|訊息|寄來|傳來|發來|來電|打來|打給我|收到|接到|一(?:封|則|通|個)|的|是不是|是|詐騙|騙人|嗎|呢|了|我|剛剛|剛才|今天|昨天|請問|可疑|安全|[？?。，,!！:：\s]/g;
const RISK = { low: 0, medium: 1, high: 2 };

export function parseAntifraud(text, { history = [] } = {}) {
  const s = String(text ?? '').trim();
  const urls = extractUrls(s);
  // 英文訊息：規則庫只認中文，不能說「沒有發現」給錯誤的安心（網址仍可比對 165 清單）
  if (isEnglish(s.replace(/https?:\/\/\S+/g, '')) && !urls.length) return { intent: /^\s*(?:is (?:this|it) (?:a )?(?:scam|fraud|real|legit|safe)|can you check (?:this|it)|check this)\W*$/i.test(s) ? 'emptyEn' : 'english', text: s };
  const after = aftermath(s, { history });
  if (after) return { intent: 'aftermath', kind: after, text: s }; // 先給止損步驟（不查工具）
  // 只問「這是詐騙嗎」「我收到一封簡訊，是詐騙嗎？」卻沒附內容：不比對（比對空字串會說「沒有發現詐騙特徵」，是錯誤的安心），請他貼上（PM 盤點 Q-22）
  if (!urls.length && isEmptyAsk(s)) return { intent: 'empty', text: s };
  const rest = urls.reduce((t, u) => t.replace(u, ''), s).replace(/這個?|網址|網站|連結|安全嗎|可以[點開]嗎|是真的嗎|[？?。，,:：\s]/g, '');
  if (urls.length && rest.length <= 6) return { intent: 'url', urls: urls.slice(0, 3), text: s };
  const num = s.match(SENDER);
  if (num && /(簡訊|號碼|寄來|傳來|發來|來電|打來)/.test(s) && s.length <= 40) {
    // 號碼後面還有一段話（「0912345678 打來說是檢察官要我監管帳戶」）：內容也要比對，只看號碼會低估風險
    const said = s.replace(num[1], '').replace(SENDER_FILLER, '');
    return { intent: 'sender', sender: num[1].trim(), text: s, ...(said.length >= 3 && { withText: true }) };
  }
  if (!urls.length && /(是真的嗎|真的假的|闢謠|有這回事|聽說)/.test(s) && s.length <= 40) {
    return { intent: 'myth', query: s.replace(/(是真的嗎|真的假的|闢謠|有這回事嗎?|聽說|[？?。，,\s])/g, '') || s, text: s };
  }
  return { intent: 'message', text: s };
}

/** 單段計畫（同一段平行呼叫） */
export function antifraudSteps(it) {
  const step = {
    url: { note: '@網址 我拿網域去比對 165 停止解析的涉詐網站清單', calls: (it.urls || []).map((url) => ({ name: 'scam_lookup_url', args: { url } })) },
    sender: it.withText
      ? { note: '@號碼 我看看這個號碼是哪一種，@防詐 也比對他說的話', calls: [{ name: 'sms_sender_check', args: { sender: it.sender } }, { name: 'scam_check_message', args: { text: it.text.slice(0, 2000) } }] }
      : { note: '@號碼 我看看這個寄件號碼是哪一種', calls: [{ name: 'sms_sender_check', args: { sender: it.sender } }] },
    myth: { note: '@闢謠 我去 165 闢謠專區找找看', calls: [{ name: 'scam_myth_search', args: { query: it.query } }] },
    message: { note: '@防詐 我比對 165 常見詐騙手法，也查裡面的網址', calls: [{ name: 'scam_check_message', args: { text: it.text.slice(0, 2000) } }] },
  }[it.intent];
  return step ? [() => step] : [];
}

/** 訊息比對結果的一句話（high／medium）；低風險回 null */
function messageSay(d) {
  const top = d.findings.slice(0, 2).map((f) => f.label).join('、');
  if (d.level === 'high') return `先不要照做。${d.urls.some((u) => u.listed) ? '裡面的網址已被 165 列為涉詐網站。' : `這則內容有「${top}」等詐騙常見特徵。`}${d.advice[0]}`;
  if (d.level === 'medium') return `這則內容有疑點（${top}），先向官方或 165 查證再行動。${d.advice[0]}`;
  return null;
}

/** 示範總結：以工具結果為準，不保證安全（輸出護欄會再檢查一次） */
export function antifraudSummary(it, results) {
  if (it.intent === 'empty') return '請把收到的簡訊、LINE 訊息、網址或來電號碼貼給我（可以直接複製貼上，也可以按輸入框左邊的相機拍下來或選截圖），我幫您比對 165 的詐騙手法。確認之前，先不要點連結、不要匯款、不要給驗證碼。';
  if (it.intent === 'emptyEn') return "Paste the message, link, or phone number here and I'll check it. Until then, don't click links, transfer money, or share verification codes. You can also call 165, Taiwan's anti-fraud hotline.";
  if (it.intent === 'english') return "I can only check Chinese messages for now. If you're unsure, don't transfer money or share codes, and call 165 (Taiwan's anti-fraud hotline).";
  if (it.intent === 'aftermath') return AFTERMATH[it.kind] || AFTERMATH.paid;
  const r = (name) => results[name]?.map((x) => x.data) || [];
  if (it.intent === 'message') {
    const d = r('scam_check_message')[0];
    if (!d) return '這次沒查成功，請稍後再試；有疑問請直接撥 165。';
    return messageSay(d) || (d.findings.length ? `有一兩個可疑的地方（${d.findings.slice(0, 2).map((f) => f.label).join('、')}），特徵不多，但不代表安全；不確定就不要點連結、不要給資料，可以打 165 問。` : NOT_SAFE_NOTE);
  }
  if (it.intent === 'url') {
    const hits = r('scam_lookup_url').filter((d) => d.listed);
    return hits.length ? `先不要開：${hits.map((d) => d.domain).join('、')} 已被 165 列為涉詐網站並停止解析。` : `比對過了，不在 165 停止解析清單上；${NOT_SAFE_NOTE}不要在陌生網站輸入帳號密碼或驗證碼。`;
  }
  if (it.intent === 'sender') {
    const d = r('sms_sender_check')[0];
    const m = it.withText ? r('scam_check_message')[0] : null;
    // 號碼和內容都查了：以風險較高的為主（內容比對到冒充檢警是高風險，個人手機號碼只是中風險）
    if (m && m.level !== 'low' && RISK[m.level] >= RISK[d?.risk ?? 'low']) return `${messageSay(m)}${d ? `另外，這是${d.kind}：${d.note}` : ''}`;
    if (!d) return '這次沒查成功。';
    return `${d.kind}：${d.note}${m ? `內容比對${NOT_SAFE_NOTE}` : '也可以把簡訊內容貼給我，我幫您看可疑之處。'}`;
  }
  const m = r('scam_myth_search')[0];
  return m?.results.length ? `165 有相關闢謠：「${m.results[0].title}」（${m.results[0].date}）。重點：${m.results[0].summary}` : '165 闢謠專區沒有找到相關文章；可以把您收到的內容貼給我，我幫您比對。';
}
