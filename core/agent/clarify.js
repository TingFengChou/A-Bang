// 該問就問、不該問就不問（PM 的 Q 情境，2026-11-22；ADR-0016）：句子本身有歧義、缺起站、只說類別時，阿幫問一句。
// 兩種問法：
//   stop＝不先查（查了也是亂算）：只回一句＋問題（例：「高鐵到台北多少錢」沒定位 →「你要從哪一站出發？」）
//   after＝先用最可能的答案查（選項第一個標 guess「猜的」），同時問一題讓使用者更正，按了就送出完整的一句重算
// 全部是通用規則（同名地點跨縣市、連鎖機構、區名、路名、公車方向、只說類別…），不寫死句子；選項都是 reply（完整的一句，
// 規則聽得懂），打字回答由 core/agent/ask.js 的 PENDING_SLOTS 接回。原則同 #115：寧可不問——對不上就照原本流程。
import { LANDMARKS, normPlace } from '../services/places.js';
import { distanceM } from '../util.js';

const ITEMS = LANDMARKS.items;
const CJK = /[一-龥]/;
const tw = (s) => String(s ?? '').replace(/臺/g, '台');
/** 地標的中文名稱與別名（比對用：臺→台、去空白；載入時算好一次） */
const KEYS = new Map(ITEMS.map((x) => [x, [x.name, ...(x.aliases || [])].filter((k) => CJK.test(k)).map(normPlace)]));
const keysOf = (x) => KEYS.get(x) || [];
const byName = (name) => ITEMS.find((x) => x.name === name) || null;
const dist = (a, b) => (a && b ? distanceM(a.lat, a.lon, b.lat, b.lon) : Infinity);

// ───── 地點有歧義：同名跨縣市（中山）、同城多義（松山車站／松山機場）、連鎖（長庚醫院）、區名（信義）、只打名字（中正）、路名（中山路）─────
/** 縣市名本身不問（「去台中」照常去台中車站：城市名的預設很合理） */
const COUNTY_WORD = /^(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|澎湖|金門|連江|馬祖)(?:市|縣)?$/;
/** 名稱後面的通稱（「長庚醫院」→ 長庚；「中山大學」本身是別名，先比對完整名稱） */
const GENERIC_TAIL = /(?:紀念醫院|醫院|大學|火車站|車站|捷運站|機場|商圈|夜市|老街|區|站)$/;
/** 路名（很多城市都有，查不到是哪一條）：「X路／X街／X大道」而且 X 是具體的名稱（2～5 字，不是走路、逛街、馬路、公路、網路、一路、哪一路…；審查 #121） */
const ROAD = /^([一-龥]{2,5}?)(?:[東西南北]?(?:路|街|大道))(?:[一二三四五六七八九十]段)?$/;
const NOT_ROAD_NAME = /[走逛想要哪不嗎呢坐搭去到我你他的了過迷一]|^(?:馬|大馬|小馬|公|高速公|快速公|省|縣|鄉|產業|網|山|小|大|道|鐵|水|陸|海|後|前|老|商店|夜市|步行|行人|自行車|單車)$|公$|高速|快速/;
export const isRoadName = (token) => { const m = ROAD.exec(String(token || '')); return !!m && !NOT_ROAD_NAME.test(m[1]); };
/** 通稱、連鎖、動作（「市場」「博物館」「誠品」「運動」）：不是一個地方的名字，不猜（審查 #121） */
const GENERIC_NAME = /^(?:市場|傳統市場|菜市場|夜市|老街|博物館|美術館|科學館|溫泉|公園|醫院|診所|車站|火車站|捷運站|公車站|機場|大學|學校|國小|國中|高中|圖書館|百貨|百貨公司|商圈|廟|寺|教堂|海邊|海灘|沙灘|山上|動物園|遊樂園|超市|賣場|量販店|便利商店|誠品|全聯|家樂福|好市多|星巴克|麥當勞|宜家|郵局|銀行|藥局|加油站|停車場|運動中心|體育館|球場|電影院|影城|飯店|酒店|民宿|餐廳|咖啡廳|運動|散步|吃飯|上班|上學|上課|逛街|走走|看看|兜風|買東西|看電影|爬山|玩|旅行|出去|外面|那邊|那裡|這裡|附近|市區|郊外)$/;
/** 比對要從詞首對齊（可以先去掉「國立、捷運、臺北、林口…」這類前綴）：「運動」不是捷運「動物園」站 */
const NAME_PREFIX = /^(?:國立|市立|私立|捷運|高鐵|台鐵|台北市立|新北市立|台北|新北|桃園|台中|台南|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|林口|土城|內湖|新店|中和|永和|板橋|東港|新)/;
const aligned = (k, core) => k.startsWith(core) || k.replace(NAME_PREFIX, '').startsWith(core);
/** 同一個區域（猜的那個附近 15 公里內）還有別的同名地點才問；預設的那個在 30 公里內才算「就是它」 */
const AREA_M = 15_000;
const LOCAL_M = 30_000;
/** 只打名字、又就在那裡（300 公尺內）：不排 0 分鐘的行程，問要查什麼 */
export const HERE_M = 300;

/**
 * 句子裡要去的「名字」（「去中山」「到長庚醫院怎麼走」「中正」）：只有中文 2～8 字、句子就只有這件事才算。
 * @returns {{ token: string, bare: boolean } | null} bare＝整句只有名字（沒說去、到）
 */
export function destToken(s) {
  const t = String(s || '').trim();
  const go = /(?:^|[，,\s]|我|要|想|帶我|載我)(?:去|到)\s*([一-龥]{2,8}?)\s*(?:怎麼(?:去|走|坐|搭)|好了|吧|呢|啦)?\s*[？?。！!～~]?$/.exec(t);
  if (go) return { token: go[1], bare: false };
  const only = /^([一-龥]{2,8})\s*[？?。！!～~]?$/.exec(t);
  return only ? { token: only[1], bare: true } : null;
}

/** 說了「站」「捷運站」（「去大安站」「去士林捷運站」「捷運大安站」）：只找車站 */
const STATION_SAID = /(?:捷運站|火車站|車站|站)$|^捷運.+站$/;
/**
 * 名字 → 地標庫的結果：exact（完整名稱或別名，或說了「站」而車站只有一個，不問）｜road（路名）｜station（說了「站」但地標庫沒有：查捷運站）
 * ｜cands（名字從詞首對得上的地標 1～4 個）｜null（認不得、通稱、太多、縣市名）
 */
export function lookupToken(token) {
  const n = normPlace(token);
  if (!n || n.length < 2) return null;
  const exact = ITEMS.find((x) => keysOf(x).includes(n));
  if (exact) return { exact: exact.name };
  if (isRoadName(token) && !/(?:老街|商店街)$/.test(token)) return { road: token }; // 「深坑老街」是地方，不是路名
  if (/[區鄉鎮里]$/.test(token)) return null; // 行政區（「大安區」「中正區」）不是一個地方，不猜（寧可不問）
  const core = n.replace(/^(?:捷運|高鐵)/, '').replace(GENERIC_TAIL, '');
  if (core.length < 2 || COUNTY_WORD.test(core) || GENERIC_NAME.test(core) || GENERIC_NAME.test(n)) return null;
  const station = STATION_SAID.test(n);
  const cands = ITEMS.filter((x) => (!station || x.kind === 'station') && keysOf(x).some((k) => aligned(k, core)));
  if (station) return cands.length === 1 ? { exact: cands[0].name } : cands.length ? { core, cands: cands.map((x) => x.name) } : { station: core }; // 「去南港站」＝南港車站（不問展覽館）
  return cands.length && cands.length <= 4 ? { core, cands: cands.map((x) => x.name) } : null;
}

/** 選項上的名字：正式名稱短（≤ 5 字）而且有這個名字就用它，否則用最短、含這個名字的別名（「林口長庚」「松山機場」「中山公園」） */
export function placeLabel(name, core) {
  const x = byName(name);
  if (!x) return name;
  const has = (k) => normPlace(k).includes(core);
  if (x.name.length <= 5 && has(x.name)) return tw(x.name);
  const alias = (x.aliases || []).filter((k) => CJK.test(k) && has(k) && k.length >= core.length + 1).sort((a, b) => a.length - b.length)[0];
  return tw(alias || x.name);
}

/**
 * 地點有歧義時的決定（runDemo 拿到位置之後）：猜哪一個、要不要問。
 * 預設（地標庫用短名對到的，例「中山」→ 捷運中山站）在 30 公里內就猜它；否則猜離你最近的。
 * 不問：猜的就是預設、而且同一區域（15 公里內）沒有別的同名地點（人在台北說「去中山」）。
 * @param {{ token: string, names: string[], def: string|null }} amb
 * @param {{ lat: number, lon: number }} at 使用者的位置（沒有就用預設起點）
 * @returns {{ guess: string, ask: boolean, order: string[] }}
 */
export function placeGuess(amb, at) {
  const cands = amb.names.map(byName).filter(Boolean).sort((a, b) => dist(at, a) - dist(at, b));
  const def = amb.def ? byName(amb.def) : null;
  const order = (g) => [g.name, ...cands.filter((c) => c.name !== g.name).map((c) => c.name)].slice(0, 4);
  if (def) { // 規則原本就對到一個（車站短名「中山」「左營」「南港」）
    if (dist(at, def) <= LOCAL_M) return { guess: def.name, ask: cands.some((c) => c.name !== def.name && dist(def, c) <= AREA_M), far: false, order: order(def) }; // 就在附近：同一區還有別的同名地點才問（台北「去中山」不問、「去松山」問）
    const alt = cands.find((c) => c.name !== def.name && dist(at, c) <= LOCAL_M);
    return alt ? { guess: alt.name, ask: true, far: false, order: order(alt) } : { guess: def.name, ask: false, far: false, order: order(def) }; // 人在高雄說「去中山」：猜附近的中山大學並問；附近沒有別的（台北說「去左營」）照原本的
  }
  const g = cands[0];
  if (!g) return { guess: null, ask: false, far: false, order: [] };
  const far = dist(at, g) > LOCAL_M; // 猜的地方在 30 公里外：不先查（只問；審查 #121「不要猜遠的」）
  return { guess: g.name, ask: far || cands.length > 1, far, order: order(g) }; // 附近只有一個候選就直接用（「去花博」「去士林」）
}

const KIND_ONE = { hospital: ['間', 'Which hospital'], school: ['間', 'Which school'] };
/**
 * 「你要去哪個『中山』？」：選項第一個是猜的（after 時標 guess），按了送出「怎麼去 X？」（有說起點、指定方式時一起帶上）。
 * @param {{ token: string, core?: string }} amb
 * @param {string[]} order 地標正式名稱，第一個是猜的
 * @param {{ guess?: boolean, from?: string|null, mode?: string|null, lang?: 'en'|null }} [o]
 */
export function placeAsk(amb, order, { guess = false, from = null, mode = null, lang = null } = {}) {
  const en = lang === 'en';
  const core = amb.core || normPlace(amb.token).replace(GENERIC_TAIL, '');
  const items = order.map(byName).filter(Boolean);
  const kinds = new Set(items.map((x) => x.kind));
  const chain = items.length > 1 && kinds.size === 1 && KIND_ONE[items[0].kind];
  const q = en
    ? (items.length === 1 ? `Do you mean ${items[0].en || items[0].name}?` : chain ? `${chain[1]} do you mean?` : `Which “${amb.token}” do you mean?`)
    : (items.length === 1 ? `你說的「${amb.token}」是${placeLabel(items[0].name, core)}嗎？` : chain ? `「${amb.token}」有好幾${chain[0]}，你要去哪一${chain[0]}？` : `你要去哪個「${amb.token}」？`);
  const say = (x) => tripSay(x.name, { from, mode, en: en && x.en ? x.en : null });
  return {
    about: 'slot:place', question: q,
    why: en ? 'Or just type the full place name.' : guess ? `先用「${placeLabel(items[0].name, core)}」算；不是的話按正確的地方，或直接打完整的地名。` : '直接打完整的地名也可以。',
    options: items.map((x, i) => ({ label: en && x.en ? x.en.slice(0, 20) : placeLabel(x.name, core), kind: 'reply', say: say(x), ...(guess && i === 0 && { guess: true }) })),
    pending: { slot: 'place', ...(from && { from: String(from).slice(0, 40) }), ...(mode && MODE_GO[mode] && { mode }), ...(en && { lang: 'en' }) },
  };
}

/** 路名：查不到是哪一條，問城市或附近地標；可以先用地圖 App 找（官方連結，先確認，ADR-0011） */
export function roadAsk(road, lang = null) {
  const en = lang === 'en';
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(road)}`;
  return {
    ask: {
      about: 'slot:place', question: en ? `What's near “${road}”?` : `「${road}」附近有什麼地標或車站？`,
      why: en ? 'Many cities have a road with this name. Type a landmark or station near it.' : '很多城市都有這條路；直接打附近的地標或車站也可以。',
      options: [{ label: en ? 'Find it on the map' : `用地圖找${road}`.slice(0, 20), kind: 'action', action: { name: 'openLink', url, confirm: en ? `Search “${road}” in Google Maps?` : `用 Google 地圖找「${road}」？` } }],
      pending: { slot: 'place', road: true, ...(en && { lang: 'en' }) },
    },
    short: en ? `Many cities have a “${road}”, so I'm not sure which one. Tell me a landmark or station near it and I'll plan the route.`
      : `很多城市都有「${road}」，我不確定是哪一條。告訴我附近的地標或車站，我幫你排路線；也可以先用地圖找。`,
  };
}

/** 選項的句子：「怎麼去 X？」「從 A 到 X 怎麼去？」「叫車去 X」（規則都聽得懂） */
const MODE_GO = { ridehail: '叫車', bus: '坐公車', metro: '坐捷運', bike: '騎 YouBike', walk: '走路', thsr: '坐高鐵', tra: '坐火車', intercity: '坐客運' };
const MODE_GO_EN = { ridehail: 'Take a taxi', bus: 'Take the bus', metro: 'Take the MRT', walk: 'Walk', bike: 'Ride a YouBike', thsr: 'Take the HSR', tra: 'Take the train', intercity: 'Take the intercity bus' };
export function tripSay(to, { from = null, mode = null, en = null } = {}) {
  if (en) return mode && MODE_GO_EN[mode] ? `${MODE_GO_EN[mode]} to ${en}` : `How do I get to ${en}?`;
  if (mode && MODE_GO[mode]) return `${from ? `從${from}` : ''}${MODE_GO[mode]}去${to}`;
  return from ? `從${from}到${to}怎麼去？` : `怎麼去${to}？`;
}

// ───── 去機場（沒說哪個）：有位置先用最近的機場算並問；沒位置只問 ─────
const AIRPORTS = ITEMS.filter((x) => x.kind === 'airport');
/** 主要機場（一定列進候選）；其他小機場在 30 公里內才列（人在花蓮、澎湖、金門） */
const MAJOR_AIRPORTS = new Set(['臺灣桃園國際機場', '臺北松山機場', '臺中國際機場', '高雄國際機場']);
const AIRPORT_LOCAL_M = 30_000;
/** 最近的機場在 80 公里外（例如人在嘉義）：不先查（不猜遠的），只問 */
export const AIRPORT_GUESS_M = 80_000;
/** 沒位置時的選項（國際線旅客最多的三個） */
const AIRPORT_DEFAULT = ['臺灣桃園國際機場', '臺北松山機場', '高雄國際機場'];
/** 選項上的短名（使用者口語的叫法） */
const AIRPORT_LABEL = { 臺灣桃園國際機場: ['桃園機場', 'Taoyuan Airport'], 臺北松山機場: ['松山機場', 'Songshan Airport'], 臺中國際機場: ['台中清泉崗機場', 'Taichung Airport'], 高雄國際機場: ['高雄小港機場', 'Kaohsiung Airport'] };
export const isAirportName = (name) => byName(name)?.kind === 'airport';
/**
 * 去機場沒說哪個：候選（最近的放第一、最多 3 個）與猜哪一個。
 * @param {{ lat: number, lon: number } | null} at 使用者的位置或說了的起點（沒有＝只問）
 * @param {{ en?: boolean }} [o] 英文那一輪只列有英文名稱的機場（句子要規則聽得懂）
 * @returns {{ guess: string|null, order: string[] }}
 */
export function airportGuess(at, { en = false } = {}) {
  const ok = (x) => !en || !!x.en;
  if (!at) return { guess: null, order: AIRPORT_DEFAULT.filter((n) => ok(byName(n))) };
  const list = AIRPORTS.filter((x) => ok(x) && (MAJOR_AIRPORTS.has(x.name) || dist(at, x) <= AIRPORT_LOCAL_M)).sort((a, b) => dist(at, a) - dist(at, b));
  const g = list[0];
  return { guess: g && dist(at, g) <= AIRPORT_GUESS_M ? g.name : null, order: list.slice(0, 3).map((x) => x.name) };
}
/**
 * 「要去哪個機場？」選項最近的放第一（guess 時標「猜的」），按了送出「怎麼去 X？」（有說起點、指定方式時一起帶上）。
 * @param {string[]} order 機場正式名稱
 * @param {{ guess?: boolean, from?: string|null, mode?: string|null, lang?: 'en'|null }} [o]
 * @returns {{ ask: object, short: string, accept: Set<string> }}
 */
export function airportAsk(order, { guess = false, from = null, mode = null, lang = null } = {}) {
  const en = lang === 'en';
  const items = order.map(byName).filter(Boolean);
  const label = (x) => (en ? AIRPORT_LABEL[x.name]?.[1] || String(x.en || x.name).slice(0, 20) : AIRPORT_LABEL[x.name]?.[0] || placeLabel(x.name, '機場'));
  const say = (x) => tripSay(x.name, { from, mode, en: en && x.en ? x.en : null });
  const ask = {
    about: 'slot:place', question: en ? 'Which airport?' : '要去哪個機場？',
    why: en ? (guess ? `I used ${label(items[0])} (the closest) for now. Or just type the airport.` : 'Or just type the airport name.')
      : guess ? `先用離你最近的「${label(items[0])}」算；不是的話按正確的機場，或直接打機場名稱。` : '直接打機場名稱也可以（例如「桃園機場」「第二航廈」）。',
    options: items.map((x, i) => ({ label: label(x), kind: 'reply', say: say(x), ...(guess && i === 0 && { guess: true }) })),
    pending: { slot: 'place', airport: true, ...(from && { from: String(from).slice(0, 40) }), ...(mode && MODE_GO[mode] && { mode }), ...(en && { lang: 'en' }) },
  };
  return {
    ask,
    short: en ? 'Which airport? Tap one above, or type the airport name.' : '要去哪個機場？點上面一個，或直接打機場名稱（例如「桃園機場」）。',
    accept: new Set(AIRPORTS.filter((x) => !en || x.en).map(say)),
  };
}
/** 打字回答的機場短名（「桃園」「小港」「松山的」「台北」「Taoyuan」）→ 機場正式名稱；不是就回 null（交給一般的地名比對） */
const AIRPORT_SHORT = [
  [/^(?:桃園|桃機|第[一二三]航廈|t[123]|taoyuan|tpe)$/i, '臺灣桃園國際機場'], [/^(?:松山|台北|taipei|songshan|tsa)$/i, '臺北松山機場'],
  [/^(?:台中|清泉崗|taichung|rmq)$/i, '臺中國際機場'], [/^(?:高雄|小港|kaohsiung|khh)$/i, '高雄國際機場'], [/^(?:台南|tainan)$/i, '臺南機場'],
  [/^(?:花蓮|hualien)$/i, '花蓮機場'], [/^(?:台東|豐年|taitung)$/i, '臺東機場'], [/^(?:澎湖|馬公|penghu|magong)$/i, '澎湖機場'], [/^(?:金門|尚義|kinmen)$/i, '金門機場'], [/^(?:南竿|馬祖|nangan|matsu)$/i, '馬祖南竿機場'],
];
/** 答案的第一段（「松山，叫車」「桃園 搭機捷」→ 松山、桃園；英文只切逗號：「the Taoyuan one」） */
export function answerHead(text) {
  const t = tw(String(text || '')).trim();
  const head = t.split(/[，,、；;]/)[0].trim();
  return CJK.test(head) ? head.split(/\s+/)[0] : head;
}
export function airportAnswer(text) {
  const c = answerHead(text)
    .replace(/^(?:我)?(?:要|想)?(?:去|到|往|是)\s*|^(?:to|go to|the)\s+/giu, '')
    .replace(/\s+(?:one|please)$/i, '')
    .replace(/\s*(?:的|那個)?\s*(?:國際)?(?:機場|airport)?\s*(?:啦|喔|吧)?[。！!～~.]*$/iu, '').trim();
  return AIRPORT_SHORT.find(([re]) => re.test(c))?.[1] || null;
}

// ───── 你就在那裡、只打地名：問要查什麼 ─────
const METRO_CITY = new Set(['Taipei', 'NewTaipei', 'Taoyuan', 'Taichung', 'Kaohsiung']);
/** 人就在那裡（300 公尺內）又只打地名：不排 0 分鐘的行程，問要查那裡的什麼（下一班、附近公車、YouBike、天氣） */
export function hereAsk(name, lang = null) {
  const x = byName(name);
  const en = lang === 'en';
  const n = tw(name);
  const opts = [
    ...(x && METRO_CITY.has(x.city) ? [[en ? 'Next MRT' : '捷運下一班', en ? `Next MRT train near ${x.en || n}` : `${n}捷運下一班`]] : []),
    [en ? 'Bus stops nearby' : '附近公車站', en ? 'Any bus stops nearby?' : `${n}附近的公車站`],
    ['YouBike', en ? 'Is YouBike available nearby?' : `${n}附近的 YouBike`],
    [en ? 'Weather' : '天氣', en ? "What's the weather now?" : `${n}天氣`],
  ];
  return {
    ask: { about: 'slot:topic', question: en ? `You're right at ${x?.en || n}. What should I check?` : `你就在${n}附近，要查什麼？`, why: en ? 'Or tell me where you want to go.' : '要去別的地方就直接說地名。', options: opts.map(([label, say]) => ({ label, kind: 'reply', say })), pending: { slot: 'topic', topic: 'here', to: n, ...(en && { lang: 'en' }) } },
    short: en ? `You're already at ${x?.en || n}. What do you want to check there? Or tell me where you're going.` : `你就在${n}附近，不用排路線。要查那裡的什麼？或告訴我要去哪裡。`,
  };
}

// ───── 只說類別（「高鐵」「公車」）：問要查什麼 ─────
const TOPICS = {
  thsr: { zh: '高鐵', en: 'the HSR', opts: [['下一班', '高鐵下一班', 'Next train', 'Next HSR train'], ['票價', '高鐵票價', 'Fare', 'HSR fare']] },
  tra: { zh: '台鐵', en: 'trains', opts: [['下一班', '台鐵下一班', 'Next train', 'Next train'], ['票價', '台鐵票價', 'Fare', 'Train fare']] },
  bus: { zh: '公車', en: 'buses', opts: [['附近的公車站', '附近的公車站', 'Bus stops nearby', 'Any bus stops nearby?'], ['某一路多久到', '公車還要多久', 'When is my bus?', 'How long until the bus comes?']] },
  metro: { zh: '捷運', en: 'the MRT', opts: [['下一班', '捷運下一班', 'Next train', 'Next MRT train'], ['幾點收班', '捷運幾點收班', 'Last train', 'Is the MRT still running now?']] },
};
export const TOPIC_KEYS = [...Object.keys(TOPICS), 'here', 'weather', 'aqi', 'outing'];
export function topicAsk(topic, lang = null) {
  const t = TOPICS[topic];
  if (!t) return null;
  const en = lang === 'en';
  return {
    ask: { about: 'slot:topic', question: en ? `What do you want to know about ${t.en}?` : `要查${t.zh}的什麼？`, options: t.opts.map(([zl, zs, el, es]) => ({ label: en ? el : zl, kind: 'reply', say: en ? es : zs })), pending: { slot: 'topic', topic, ...(en && { lang: 'en' }) } },
    short: en ? `What do you want to know about ${t.en}? Tap one above, or ask in a full sentence.` : `要查${t.zh}的什麼？點上面一個，或直接說完整的一句（例如「${t.opts[0][1]}」）。`,
  };
}
/** 打字回答「下一班」「票價」「附近」→ 那個類別的完整一句 */
export function topicSay(topic, text, place = null) {
  const t = TOPICS[topic];
  const c = String(text || '').trim().replace(/[。！!？?～~]+$/u, '');
  if (topic === 'here' && place) {
    if (/^(?:捷運)?下一班$/.test(c)) return `${place}捷運下一班`;
    if (/^(?:附近)?(?:的)?公車(?:站)?$/.test(c)) return `${place}附近的公車站`;
    if (/^(?:youbike|ubike)$/i.test(c)) return `${place}附近的 YouBike`;
    if (/^天氣$/.test(c)) return `${place}天氣`;
    return null;
  }
  if (!t) return null;
  const hit = t.opts.find(([zl]) => zl === c || zl.replace(/的|某一路/g, '') === c.replace(/的/g, ''));
  if (hit) return hit[1];
  if (/^附近$/.test(c) && topic === 'bus') return '附近的公車站';
  return null;
}

// ───── 高鐵／台鐵：缺起站、缺迄站 ─────
export const THSR_STATIONS = ['台北', '台中', '左營', '板橋', '桃園', '新竹', '台南', '南港', '苗栗', '彰化', '雲林', '嘉義'];
const TRA_MAIN = ['台北', '台中', '高雄', '板橋', '桃園', '新竹', '台南', '花蓮', '宜蘭', '嘉義', '彰化', '台東', '基隆', '屏東', '松山', '南港'];
/** 台鐵站名：地標庫的「X車站」＋常見大站 */
const TRA_STATIONS = [...new Set([...TRA_MAIN, ...ITEMS.filter((x) => x.kind === 'station' && /車站$/.test(x.name) && !/^(?:高鐵|捷運)/.test(x.name)).map((x) => tw(x.name.replace(/車站$/, '')))])];
export const RAIL_EN = { 台北: 'Taipei', 板橋: 'Banqiao', 桃園: 'Taoyuan', 新竹: 'Hsinchu', 苗栗: 'Miaoli', 台中: 'Taichung', 彰化: 'Changhua', 嘉義: 'Chiayi', 台南: 'Tainan', 高雄: 'Kaohsiung', 左營: 'Zuoying', 宜蘭: 'Yilan', 花蓮: 'Hualien', 台東: 'Taitung', 基隆: 'Keelung', 南港: 'Nangang' };
const stationsOf = (system) => (system === 'THSR' ? THSR_STATIONS : TRA_STATIONS);
/** 車站名稱 → 站名（「高鐵左營站」「臺北車站」→ 左營、台北） */
export const railName = (s) => tw(String(s || '')).replace(/^高鐵/, '').replace(/(?:火車站|車站|站)$/, '');
/**
 * 打字回答的站名（「台中」「我從左營出發」「左營站」「Zuoying」）→ 站名；不是站名回 null（寧可不收）
 */
export function railStationAnswer(text, system = 'THSR') {
  const t = String(text || '').trim().replace(/[。！!～~.]+$/u, '');
  if (/^[a-z ]+$/i.test(t)) { const hit = Object.entries(RAIL_EN).find(([, e]) => e.toLowerCase() === t.replace(/^(?:from|to)\s+/i, '').trim().toLowerCase()); return hit && stationsOf(system).includes(hit[0]) ? hit[0] : null; }
  const c = railName(t.replace(/^(?:我)?(?:現在)?(?:要|想)?(?:從|在|去|到|往)\s*/, '').replace(/\s*(?:出發|上車|下車)?(?:啦|喔|吧)?$/, '').trim());
  return stationsOf(system).includes(c) ? c : null;
}
const SYS = { THSR: ['高鐵', 'HSR'], TRA: ['台鐵', 'train'] };
const fareSay = (system, from, to, en) => (en ? `How much is the ${SYS[system][1]} ticket from ${RAIL_EN[from] || from} to ${RAIL_EN[to] || to}?` : `${SYS[system][0]}${from}到${to}多少錢`);
const nextSay = (system, from, to, en) => (en ? `Next ${SYS[system][1]} from ${RAIL_EN[from] || from} to ${RAIL_EN[to] || to}` : `${SYS[system][0]}${from ? `${from}到` : '到'}${to}下一班`);
/** 英文那一輪只列有英文名稱的站（句子要規則聽得懂） */
const usable = (list, en) => (en ? list.filter((x) => RAIL_EN[x]) : list);

/**
 * 缺起站（票價）：「你要從哪一站出發？」選項是常見的站（不含迄站）；guess＝先用這一站算了（標「猜的」放第一個）。
 * @param {{ system: 'THSR'|'TRA', to: string, guess?: string|null, lang?: 'en'|null }} o
 */
export function railFromAsk({ system, to, guess = null, lang = null }) {
  const en = lang === 'en';
  const dest = railName(to);
  const list = usable(stationsOf(system).filter((x) => x !== dest && x !== guess), en);
  const order = [...(guess ? [railName(guess)] : []), ...list].slice(0, 4);
  return {
    ask: {
      about: 'slot:railFrom', question: en ? 'Which station are you starting from?' : '你要從哪一站出發？',
      why: en ? (guess ? `I used ${RAIL_EN[guess] || guess} for now. Or just type the station.` : 'Or just type the station.') : guess ? `先用${guess}算；從別站出發就按那一站，或直接打站名。` : '直接打站名也可以。',
      options: order.map((x, i) => ({ label: en ? RAIL_EN[x] || x : x, kind: 'reply', say: fareSay(system, x, dest, en), ...(guess && i === 0 && { guess: true }) })),
      pending: { slot: 'railFrom', system, to: dest, fare: true, ...(en && { lang: 'en' }) },
    },
    short: en ? `Which station are you starting from? Tell me and I'll look up the fare to ${RAIL_EN[dest] || dest}.` : `你要從哪一站出發？告訴我起站，我幫你查到${dest}的票價。`,
    accept: new Set(usable(stationsOf(system), en).filter((x) => x !== dest).map((x) => fareSay(system, x, dest, en))),
  };
}

/**
 * 缺迄站（「高鐵下一班」「高鐵票價」）：「你要去哪一站？」選項是常見的站（不含起站）。
 * @param {{ system: 'THSR'|'TRA', from?: string|null, fare?: boolean, lang?: 'en'|null }} o
 */
export function railToAsk({ system, from = null, fare = false, lang = null }) {
  const en = lang === 'en';
  const start = from ? railName(from) : null;
  const list = usable(stationsOf(system).filter((x) => x !== start), en);
  const say = (x) => (fare ? (start ? fareSay(system, start, x, en) : en ? `How much is the ${SYS[system][1]} ticket to ${RAIL_EN[x] || x}?` : `${SYS[system][0]}到${x}多少錢`) : nextSay(system, start, x, en));
  return {
    ask: {
      about: 'slot:railTo', question: en ? 'Which station are you going to?' : '你要去哪一站？', why: en ? 'Or just type the station.' : '直接打站名也可以。',
      options: list.slice(0, 4).map((x) => ({ label: en ? RAIL_EN[x] || x : x, kind: 'reply', say: say(x) })),
      pending: { slot: 'railTo', system, ...(start && { from: start }), ...(fare && { fare: true }), ...(en && { lang: 'en' }) },
    },
    short: en ? `Which station are you going to? Tell me and I'll look it up.` : `你要去哪一站？告訴我迄站，我幫你查${fare ? '票價' : '班次'}。`,
    accept: new Set(list.map(say)),
  };
}
/** 打字回答 → 完整的一句（railFrom／railTo 的 pending） */
export function railPendingSay(p, text) {
  const st = railStationAnswer(text, p.system);
  if (!st) return null;
  const en = p.lang === 'en';
  if (p.slot === 'railFrom') return p.to && st !== railName(p.to) ? fareSay(p.system, st, railName(p.to), en) : null;
  const from = p.from ? railName(p.from) : null;
  if (from === st) return null;
  return p.fare ? (from ? fareSay(p.system, from, st, en) : en ? `How much is the ${SYS[p.system][1]} ticket to ${RAIL_EN[st] || st}?` : `${SYS[p.system][0]}到${st}多少錢`) : nextSay(p.system, from, st, en);
}
/** 離這一點最近的高鐵／台鐵站（30 公里內）：站名（「左營」「台北」） */
export function nearestStation(pt, system = 'THSR') {
  if (!pt) return null;
  const isRail = (x) => x.kind === 'station' && (system === 'THSR' ? [x.name, ...x.aliases].some((k) => /^高鐵/.test(k)) : /車站$/.test(x.name) && !/^(?:高鐵|捷運)/.test(x.name));
  const best = ITEMS.filter(isRail).map((x) => ({ x, d: dist(pt, x) })).sort((a, b) => a.d - b.d)[0];
  if (!best || best.d > 30_000) return null;
  const name = system === 'THSR' ? [best.x.name, ...best.x.aliases].find((k) => /^高鐵.+站$/.test(k)) : best.x.name;
  return { name: railName(name), distanceM: Math.round(best.d) };
}

// ───── 沒定位、問天氣或空品：先查預設地點，問你在哪 ─────
const CITY_OPTS = ['台北', '台中', '台南', '高雄'];
const WHERE_SAY = {
  weather: (c, x) => (x.tomorrow ? `${c}明天天氣` : `${c}天氣`), aqi: (c) => `${c}空氣品質`, outing: (c) => `${c}出門要注意什麼`,
};
const WHERE_SAY_EN = { weather: (c, x) => (x.tomorrow ? `Weather in ${c} tomorrow` : `What's the weather in ${c}?`), aqi: (c) => `Air quality in ${c}`, outing: (c) => `What should I bring in ${c}?` };
export function whereAsk(topic, { tomorrow = false, guess = '台北', lang = null } = {}) {
  const en = lang === 'en';
  const say = (c) => (en ? WHERE_SAY_EN[topic](RAIL_EN[c] || c, { tomorrow }) : WHERE_SAY[topic](c, { tomorrow }));
  const order = [guess, ...CITY_OPTS.filter((c) => c !== guess)];
  return {
    about: 'slot:where', question: en ? 'Where are you?' : '你在哪裡？',
    why: en ? `I didn't get your location, so I checked ${RAIL_EN[guess] || guess}. Or just type where you are.` : `沒拿到你的位置，先查了${guess}；不對就按你在的城市，或直接打地名。`,
    options: order.map((c, i) => ({ label: en ? RAIL_EN[c] || c : c, kind: 'reply', say: say(c), ...(i === 0 && { guess: true }) })),
    pending: { slot: 'where', topic, ...(tomorrow && { tomorrow: true }), ...(en && { lang: 'en' }) },
  };
}
export const whereSay = (p, place) => (p.lang === 'en' ? null : WHERE_SAY[p.topic]?.(place, p));

// ───── 公車：沒定位又沒說站、只說方向 ─────
const ROUTE_NO = /^[紅藍綠棕橘小幹]?\d{1,4}[區副]?$/;
/** 沒定位、沒說站：問在哪一站等（選項是兩個方向；直接打站名也可以） */
export function busStopAsk(data, lang = null) {
  const en = lang === 'en';
  const r = data?.routeName;
  const dirs = (data?.directions || []).filter((d) => d.label).slice(0, 2);
  if (en || !ROUTE_NO.test(String(r || '')) || !dirs.length) return null; // 打字回答要接回規則聽得懂的句子：路線號碼像「307」「紅30」、中文那一輪
  const dest = (d) => String(d.label).replace(/^往\s*/, '');
  return {
    about: 'slot:busStop', question: en ? `Which stop are you waiting at for bus ${r}?` : `你在哪一站等 ${r}？`,
    why: en ? 'Or pick a direction.' : `直接打站名也可以（例如「${(dirs[0].stops?.[1] || dirs[0].stops?.[0])?.stopName || '市政府'}」）；或先選方向。`,
    options: dirs.map((d) => ({ label: (en ? `To ${dest(d)}` : `往 ${dest(d)}`).slice(0, 20), kind: 'reply', say: en ? `How long until bus ${r} to ${dest(d)}?` : `${r} 往${dest(d)}的還要多久` })),
    pending: { slot: 'busStop', route: r, ...(en && { lang: 'en' }) },
  };
}
/** 打字回答的站名（「市政府」「我在敦化市場」「往板橋」）→「307 公車到「市政府」還要多久」 */
export function busStopSay(p, text) {
  const t = String(text || '').trim().replace(/[。！!～~.]+$/u, '');
  if (!ROUTE_NO.test(String(p.route || ''))) return null;
  const toward = /^往\s*([一-龥]{2,10})(?:方向)?(?:的)?$/.exec(t);
  if (toward) return `${p.route} 往${toward[1]}的還要多久`;
  const c = t.replace(/^(?:我)?(?:現在)?(?:人)?(?:在|從)\s*/, '').replace(/\s*(?:站牌|這站|那站)?\s*(?:等(?:車)?)?$/, '').trim();
  if (!/^[一-龥()（）0-9]{2,16}$/.test(c) || /^(?:不用|不要|沒有|算了|謝謝|好|嗯|對|是|可以|不知道)/.test(c)) return null;
  return `${p.route} 公車到「${c}」還要多久`;
}

// ───── 發票：問號碼；公車到站提醒；防詐請他貼上 ─────
export function invoiceAsk(lang = null) {
  const en = lang === 'en';
  return {
    about: 'slot:invoiceNo', question: en ? 'What is the invoice number?' : '要對哪一張？發票號碼是多少？',
    why: en ? 'Type the 8 digits (or the last 3). Numbers stay on this phone if you save them.' : '打 8 碼（或末 3 碼）就好；存到「我的發票」可以掃 QR code，開獎後自動對獎。',
    options: [{ label: en ? 'Scan invoices' : '掃發票對獎', kind: 'action', action: { name: 'navigate', to: '#/s/invoice' } }],
    pending: { slot: 'invoiceNo', ...(en && { lang: 'en' }) },
  };
}
/**
 * 公車快到站前提醒（選了公車、阿幫在盯上車站）：按了手機設定（watchArrival，沿用卡片的動作）。
 * 直接打「好」：前端對到第一個按鈕就設提醒（兩個選項＋YES 說法，ADR-0016）；伺服器不能代設，所以沒有 pending。
 * @param {{ city: string, routeName: string, stop: string, direction?: number }} f run.js busFollowUp 的 args（盯的那一班）
 */
export function remindAsk(f, followUp, lang = null) {
  const focus = followUp?.data?.focus;
  if (!f?.routeName || !f.stop || !focus || focus.status !== 0 || focus.etaSec == null) return null;
  const en = lang === 'en';
  return {
    about: 'remind:bus', question: en ? `Remind you before bus ${f.routeName} reaches ${f.stop}?` : `要我在 ${f.routeName} 快到「${f.stop}」前提醒你嗎？`,
    options: [
      { label: en ? 'Remind me 3 min before' : '到站前 3 分提醒我', kind: 'action', action: { name: 'watchArrival', city: f.city, routeName: f.routeName, stop: f.stop, ...(f.direction != null && { direction: f.direction }), minutes: 3 } },
      { label: en ? 'No thanks' : '不用', kind: 'dismiss' },
    ],
  };
}
export function scamPasteAsk(profileId = 'life', lang = null, text = '') {
  const en = lang === 'en';
  if (profileId === 'antifraud') return { about: 'scam:paste', question: en ? 'Can you paste the message here?' : '可以把那則訊息貼上來嗎？', why: en ? 'Paste the text, link or phone number; or take a photo with the camera button.' : '簡訊、LINE、網址、來電號碼都可以；也可以按相機拍下來。', options: [{ label: en ? 'Paste it' : '貼上訊息', kind: 'action', action: { name: 'focusInput' } }] };
  const go = String(text || '').trim() ? { name: 'handOff', agent: 'antifraud', text: String(text).trim() } : { name: 'navigate', to: '#/agent/antifraud' }; // 帶著這一句過去（防詐接著請他貼上；手機記憶體，不放網址）
  return { about: 'scam:paste', question: en ? 'Can you paste the message in Anti-fraud?' : '可以把那則訊息貼到「防詐」給我看嗎？', why: en ? 'Anti-fraud checks it against 165 scam patterns.' : '防詐會比對 165 的詐騙手法。', options: [{ label: en ? 'Open Anti-fraud' : '到防詐貼上', kind: 'action', action: go }] };
}

export { byName as landmarkByName };
