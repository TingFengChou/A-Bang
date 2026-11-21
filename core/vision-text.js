// 阿幫會看（M14-02，ADR-0015）：手機上讀出來的字（OCR）→ 是哪一種（可疑訊息、站牌路牌、發票）＋組成要問的問題。
// 純函式、不連網、不依賴 Node：伺服器以 /core/vision-text.js 提供給前端（public/js/vision.js），App 打包時一起複製。
// 照片不上傳：前端只把這裡組出來的「文字」交給既有流程，而且使用者確認後才送。
// 規則寧可保守：認不出來就回 'text'（讓使用者自己決定要不要問），不猜站名或路線。

/** 全形數字、英文、標點換成半形；多個空白縮成一個 */
export function normText(s) {
  return String(s ?? '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':').replace(/[－—–]/g, '-').replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ').trim();
}

// ───── 可疑訊息（簡訊、LINE、Email 截圖）─────
/** [代號, 規則, 分數]：驗證碼、轉帳是強訊號（單獨就算）；網址只有 1 分（外送、物流的正常通知也有短網址），要配點擊、急迫等其他訊號才算 */
const MESSAGE_SIGNALS = [
  ['url', /https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|tw|cc|xyz|top|info|me|io|co|ly|vip|shop|site|online|app|link|click)\b/i, 1],
  ['otp', /驗證碼|認證碼|OTP|動態密碼|簡訊碼/i, 2],
  ['transfer', /轉帳|匯款|匯入|ATM|解除分期|監管帳戶|提款卡|帳戶.{0,4}(?:凍結|異常|鎖定)/i, 2],
  ['phone', /(?<![\d-])(?:09\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}|\+\s?886)(?![\d-])/, 1],
  ['line', /\bLINE\b|加.{0,3}好友|LINE\s*ID|\bID\s*:/i, 1],
  ['urgent', /立即|立刻|盡快|逾期|停用|凍結|限時|最後通知|今日內|\d+\s*小時內/, 1],
  ['click', /點擊|點選|點此|連結|登入|網址|請至|下載/, 1],
  ['lure', /中獎|包裹|退稅|退款|罰單|欠費|繳費|補繳|獲利|投資|保證|穩賺|飆股|老師|貸款|兼職|日領/, 1],
];
/** 一定要兩個以上分數才算訊息（只有一支電話的站牌、只有「繳費」的收據不算） */
export const MESSAGE_MIN = 2;

/**
 * 這段文字裡像詐騙訊息的訊號
 * @returns {{ score: number, signals: string[], strong: boolean }}
 */
export function messageSignals(text) {
  const s = normText(text);
  const hit = MESSAGE_SIGNALS.filter(([, re]) => re.test(s));
  return { score: hit.reduce((n, [, , w]) => n + w, 0), signals: hit.map(([k]) => k), strong: hit.some(([, , w]) => w >= 2) };
}
export const looksLikeMessage = (text) => messageSignals(text).score >= MESSAGE_MIN;

// ───── 發票（沒有讀到 QR code 時，從字找字軌號碼）─────
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * 電子發票證明聯上的字：字軌號碼（AB-12345678）、期別（115年09-10月）、開立日期（2026-09-15）。
 * @returns {{ track: string, number: string, date?: string, period?: string, proof: boolean } | null} proof：有「電子發票證明聯」字樣
 */
export function invoiceFromText(text) {
  const s = normText(text).toUpperCase();
  const m = /(?<![A-Z])([A-Z]{2})\s?-?\s?(\d{8})(?!\d)/.exec(s);
  if (!m) return null;
  const out = { track: m[1], number: m[2], proof: /電子發票證明聯|統一發票|發票證明/.test(s) };
  const p = /(\d{3})\s*年\s*(\d{1,2})\s*[-~～至]\s*(\d{1,2})\s*月/.exec(s);
  if (p) {
    const a = Number(p[2]), b = Number(p[3]);
    if (a % 2 === 1 && b === a + 1 && b <= 12) out.period = `${p[1]}${pad2(a)}`; // 期別以單數起始月表示（與 invoice-qr.js 相同）
  }
  const d = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (d) {
    const mm = Number(d[2]), dd = Number(d[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.date = `${d[1]}-${pad2(mm)}-${pad2(dd)}`;
  }
  return out;
}

// ───── 站牌、路牌 ─────
/** 公車路線號碼（台北的紅藍綠棕橘小幹、區間、副線；新北 F 開頭等英文字母先不收，免得把型號當路線） */
const ROUTE_TOKEN = /^([紅藍綠棕橘小幹]?[1-9]\d{0,3}(?:[區副])?)(?:路|號|線)?$/;
/** 這一行有這些就不是路線號碼（電話、時間、門牌、距離、價錢、年份） */
/** 路線列上除了號碼還可能有的字（其他中文字＝價目、門牌之類，不收） */
const ROUTE_WORD = /^(?:公車|路線|公車路線|幹線|快速公車|直達車|區間車|夜間公車|市民小巴|接駁車)$/;
const NOT_ROUTE_LINE = /專線|電話|客服|申訴|\d{1,2}:\d{2}|[段號巷弄樓]|\d\s*(?:m|km|公尺|公里|元|分鐘|%)|\d{3}\s*年|\b(?:19|20)\d{2}\b/i;
/** 不會是站名的字（站牌上的固定字、機關名稱） */
const NOT_STOP = /公車|站牌|去程|返程|首班|末班|班距|尖峰|離峰|營運|時間|客運|交通局|運輸處|專線|客服|停靠|本站|上車|下車|路線|博愛|請勿|請排隊|候車|乘車|悠遊卡|一卡通|電子票證|票價|收費|往$|^往|方向|資訊|動態|即時|系統|^站$|^公車站$|下一站|台北市|臺北市|新北市|^[A-Za-z]/;
const ROAD = /([一-龥]{1,6}?(?:[東西南北]?路|街|大道)(?:[一二三四五六七八九十]段)?)(?!口|線|總局)/;
const CJK = /[一-龥]/g;

/** 一行的字＋位置；沒有位置時 box 為 null */
function asLines(input) {
  const arr = Array.isArray(input) ? input : String(input ?? '').split(/\n+/);
  return arr.map((l) => (typeof l === 'string' ? { text: normText(l), box: null } : { text: normText(l?.text), box: l?.box && Number.isFinite(l.box.h) ? l.box : null }))
    .filter((l) => l.text);
}

/**
 * 站牌、路牌讀出來的行 → 路線、站名、路名、方向。
 * @param {Array<string | { text: string, box?: { x: number, y: number, w: number, h: number } }> | string} input 行（box 為 0～1 的相對位置，字越大 h 越大）
 * @returns {{ routes: string[], stop: string|null, stopSure: boolean, roads: string[], toward: string|null }} stopSure：有「站名」「…站」字樣或字特別大
 */
export function signInfo(input) {
  const lines = asLines(input);
  const routes = [];
  const roads = [];
  let toward = null;
  const cands = [];
  for (const l of lines) {
    const t = l.text;
    // 方向：「往 板橋」「往市府」
    const w = /(?:^|\s)往\s*([一-龥]{2,8})/.exec(t);
    if (w && !toward) toward = w[1];
    // 路線號碼：只在這一行像路線列表時收（每個字串都是號碼或「往…」）
    // （英文翻譯行「Zhongxiao E. Rd. Sec. 4」、混了其他字的行不收）
    if (!NOT_ROUTE_LINE.test(t) && !/[A-Za-z]{2,}/.test(t)) {
      const toks = t.split(/[\s、，,｜|/／・]+/).filter(Boolean);
      const hits = toks.map((tok) => ROUTE_TOKEN.exec(tok)?.[1]).filter(Boolean);
      const rest = toks.filter((tok) => !ROUTE_TOKEN.test(tok) && !/^往/.test(tok) && tok !== toward);
      if (hits.length && rest.every((tok) => ROUTE_WORD.test(tok))) for (const h of hits) if (!routes.includes(h)) routes.push(h);
    }
    // 路名（「忠孝東路四段」「Zhongxiao E. Rd.」不算，只收中文）
    const r = ROAD.exec(t);
    if (r && !/路口$/.test(t) && !roads.includes(r[1])) roads.push(r[1]);
    // 站名候選：2～12 個中文字、沒有數字，去掉「站名：」「（…）」與結尾的「站」
    const name = t.replace(/^站名\s*:?\s*/, '').replace(/[（(][^）)]*[）)]/g, '').replace(/[\s←→↑↓⇐⇒<>•·]+/g, '');
    const cjk = (name.match(CJK) || []).length;
    if (cjk >= 2 && cjk <= 12 && cjk >= name.length - 1 && !/\d/.test(name) && !NOT_STOP.test(name) && !(r && !/路口$/.test(name) && name.replace(r[1], '').length <= 1)) {
      let score = 1;
      if (/^站名/.test(t) || (/站$/.test(name) && name.length >= 3)) score += 3;
      if (/路口$/.test(name)) score += 1;
      if (l.box) score += Math.min(3, l.box.h * 20); // 字越大越像站名（站牌上站名最大）
      cands.push({ name: name.replace(/(?<!車|捷運.{0,6})站$/, ''), score, marked: score >= 4, h: l.box?.h || 0 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  // 有把握：有「站名」「…站」字樣，或是整張圖裡字最大的那一行（站牌上站名最大）
  const maxH = Math.max(0, ...lines.map((l) => l.box?.h || 0));
  if (cands[0]) cands[0].sure = cands[0].marked || (cands[0].h > 0 && cands[0].h >= maxH && lines.filter((l) => (l.box?.h || 0) >= maxH * 0.8).length === 1);
  const stop = cands[0]?.name && cands[0].name.length >= 2 ? cands[0].name : null;
  return { routes: routes.slice(0, 8), stop, stopSure: Boolean(stop && cands[0].sure), roads: roads.slice(0, 3), toward };
}

/**
 * 組要問阿幫的問題（給使用者確認或修改後才送出）。
 * @param {ReturnType<typeof signInfo>} info
 * @param {'en'|null} [lang]
 * @returns {{ question: string, alternatives: string[], kind: 'route-stop'|'route'|'stop'|'road', needsMore: boolean } | null}
 *   needsMore：問題還沒說完（只看到路名：要使用者補目的地）
 */
export function signQuestion(info, lang = null) {
  const en = lang === 'en';
  const { routes = [], stop = null, roads = [] } = info || {};
  const ask = (r) => (stop
    ? (en ? `How long until bus ${r} reaches ${stop}?` : `${r} 公車到「${stop}」還要多久？`)
    : (en ? `How long until bus ${r} comes?` : `${r} 公車還要多久？`));
  if (routes.length) return { question: ask(routes[0]), alternatives: routes.slice(1, 4).map(ask), kind: stop ? 'route-stop' : 'route', needsMore: false };
  if (stop) return { question: en ? `I'm at the ${stop} bus stop. When are the buses nearby coming?` : `我在「${stop}」站，附近的公車多久來？`, alternatives: [], kind: 'stop', needsMore: false };
  if (roads.length) return { question: en ? `I'm on ${roads[0]}. How do I get to ` : `我在${roads[0]}，怎麼去`, alternatives: [], kind: 'road', needsMore: true };
  return null;
}

/**
 * 讀出來的字是哪一種。條碼（發票 QR）由前端先用 parseInvoiceCode 判斷，這裡只看文字。
 * 順序：發票（有證明聯字樣或字軌號碼＋日期）→ 強烈的詐騙訊號（驗證碼、轉帳）→ 站牌路牌（讀到路線時，網址之類的弱訊號不蓋過站牌）→ 其他詐騙訊號（兩個以上）→ 只有字。
 * @param {{ text?: string, lines?: Array<string | { text: string, box?: object }> }} reading
 * @param {{ profile?: string, hint?: string|null }} [opt] profile：antifraud 時一律當可疑訊息；hint：裝置模型的分類（sms／sign／invoice），只在認不出來時參考
 * @returns {{ kind: 'scam'|'sign'|'invoice'|'text'|'empty', text: string, invoice?: object, sign?: object, signals?: string[] }}
 */
export function classifyText(reading, { profile = 'life', hint = null } = {}) {
  const lines = asLines(reading?.lines?.length ? reading.lines : reading?.text || '');
  const text = (reading?.text ? normText(reading.text.replace(/\n+/g, '\n')) : lines.map((l) => l.text).join('\n')).trim();
  if (!text) return { kind: 'empty', text: '' };
  const sig = messageSignals(text);
  if (profile === 'antifraud') return { kind: 'scam', text, signals: sig.signals };
  const inv = invoiceFromText(text);
  if (inv && (inv.proof || inv.date || inv.period)) return { kind: 'invoice', text, invoice: inv };
  if (sig.strong && sig.score >= MESSAGE_MIN) return { kind: 'scam', text, signals: sig.signals };
  const sign = signInfo(lines);
  if (sign.routes.length || sign.stop || sign.roads.length) {
    const q = signQuestion(sign);
    // 只有一個「站名候選」又沒有路線、路名：太弱（任何兩個字的中文都可能），要有站名字樣、字特別大，或裝置模型也說是站牌
    if (sign.routes.length || sign.roads.length || sign.stopSure || hint === 'sign') return { kind: 'sign', text, sign: { ...sign, ...q } };
  }
  if (sig.score >= MESSAGE_MIN || hint === 'sms') return { kind: 'scam', text, signals: sig.signals };
  if (inv) return { kind: 'invoice', text, invoice: inv };
  return { kind: 'text', text };
}
