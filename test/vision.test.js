// 阿幫會看（M14-02，ADR-0015）：讀出來的字怎麼分類（可疑訊息、站牌路牌、發票）、組問題、發票 QR 存進我的發票並對獎、個資遮罩。
// core/vision-text.js（規則，正反例）＋ public/js/vision.js（外掛回傳整理、分類、遮罩、轉到防詐頁）＋ demo-intent 認得組出來的問題。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { messageSignals, looksLikeMessage, invoiceFromText, signInfo, signQuestion, classifyText, normText } = await import('../core/vision-text.js');
const V = await import('../public/js/vision.js');
const { wallet, checkWallet } = await import('../public/js/invoice-wallet.js');
const { parseIntent } = await import('../core/agent/demo-intent.js');
const { busStopOf } = await import('../core/agent/demo-intent.js');
const { callTool } = await import('../core/tools/index.js');
const { createServices } = await import('../core/index.js');
const svc = createServices({ forceMock: true });
const call = (name, args) => callTool(svc, name, args);

beforeEach(() => store.clear());

const SMS = '【台灣郵政】您的包裹因地址不全無法投遞，請於24小時內點擊 https://post-tw-delivery.cc/a 更新資料，逾期將退回。';
const SIGN = [
  { text: '307', box: { x: 0.1, y: 0.05, w: 0.2, h: 0.06 } },
  { text: '敦化市場', box: { x: 0.1, y: 0.15, w: 0.6, h: 0.14 } },
  { text: 'Dunhua Market', box: { x: 0.1, y: 0.31, w: 0.5, h: 0.04 } },
  { text: '307 262 藍15', box: { x: 0.1, y: 0.5, w: 0.6, h: 0.05 } },
  { text: '往 板橋', box: { x: 0.1, y: 0.6, w: 0.3, h: 0.04 } },
  { text: '申訴專線 1999', box: { x: 0.1, y: 0.9, w: 0.3, h: 0.02 } },
];
const LEFT_QR = 'AB54348835115080312340000006400000069000000001234567800000000000000000000000:**********:1:1:1:咖啡:1:65';

test('normText：全形數字與冒號換半形、空白縮成一個', () => {
  assert.equal(normText('　３０７　 往　板橋：'), '307 往 板橋:');
});

test('可疑訊息：驗證碼、轉帳單獨就算；只有電話或只有「繳費」不算', () => {
  assert.ok(looksLikeMessage(SMS));
  assert.deepEqual(messageSignals(SMS).signals.sort(), ['click', 'lure', 'urgent', 'url']);
  assert.ok(looksLikeMessage('您的驗證碼是 123456，請勿告訴他人'));
  assert.ok(looksLikeMessage('客服通知：請至 ATM 解除分期付款設定'));
  assert.ok(looksLikeMessage('加我 LINE 好友，老師帶你投資飆股')); // 兩個以上弱訊號
  assert.ok(!looksLikeMessage('申訴專線 1999'));
  assert.ok(!looksLikeMessage('本月電費繳費收據'));
  assert.ok(!looksLikeMessage('今天晚上吃什麼'));
});

test('發票的字：字軌號碼、期別（單數起始月）、開立日期；沒有號碼回 null', () => {
  assert.deepEqual(invoiceFromText('電子發票證明聯\n115年09-10月\nAB-12345678\n2026-09-15 12:30:01'), { track: 'AB', number: '12345678', proof: true, period: '11509', date: '2026-09-15' });
  assert.deepEqual(invoiceFromText('ＡＢ－１２３４５６７８'), { track: 'AB', number: '12345678', proof: false });
  assert.equal(invoiceFromText('115年10-11月 AB-12345678').period, undefined, '期別一定是單數月開始的兩個月');
  assert.equal(invoiceFromText('電話 0912345678'), null);
  assert.equal(invoiceFromText('ABC12345678'), null, '前面還有英文字母不是字軌');
});

test('站牌：路線、站名（字最大的那行）、往哪；電話專線、英文翻譯不當路線', () => {
  const s = signInfo(SIGN);
  assert.deepEqual(s.routes, ['307', '262', '藍15']);
  assert.equal(s.stop, '敦化市場');
  assert.equal(s.stopSure, true);
  assert.equal(s.toward, '板橋');
  assert.ok(!s.routes.includes('1999'));
  // 只有文字（沒有位置）：「…站」「站名：」字樣算有把握
  assert.deepEqual(signInfo(['公車 307', '捷運市政府站']), { routes: ['307'], stop: '捷運市政府站', stopSure: true, roads: [], toward: null });
  assert.equal(signInfo(['站名：信義路口']).stop, '信義路口');
});

test('路牌：只收中文路名；英文行（Sec. 4）不當路線號碼；門牌、時間、年份不當路線', () => {
  const s = signInfo(['忠孝東路四段', 'Zhongxiao E. Rd. Sec. 4', '← 敦化南路']);
  assert.deepEqual(s.routes, []);
  assert.deepEqual(s.roads, ['忠孝東路四段', '敦化南路']);
  assert.equal(s.stop, null, '路名不當站名');
  assert.deepEqual(signInfo(['2026年', '營業時間 10:00', '電話 02-2345-6789', '12號']).routes, []);
});

test('組問題：路線＋站名、只有站名、只有路名（要補目的地）、英文；什麼都沒有回 null', () => {
  assert.deepEqual(signQuestion(signInfo(SIGN)), { question: '307 公車到「敦化市場」還要多久？', alternatives: ['262 公車到「敦化市場」還要多久？', '藍15 公車到「敦化市場」還要多久？'], kind: 'route-stop', needsMore: false });
  assert.equal(signQuestion({ routes: [], stop: '敦化市場', roads: [] }).question, '我在「敦化市場」站，附近的公車多久來？');
  const road = signQuestion({ routes: [], stop: null, roads: ['忠孝東路四段'] });
  assert.equal(road.question, '我在忠孝東路四段，怎麼去');
  assert.equal(road.needsMore, true);
  assert.equal(signQuestion(signInfo(SIGN), 'en').question, 'How long until bus 307 reaches 敦化市場?');
  assert.equal(signQuestion({ routes: [], stop: null, roads: [] }), null);
});

test('分類：簡訊 → scam、站牌 → sign（有 1999 專線也不是詐騙）、發票字 → invoice、其他 → text、空的 → empty；防詐頁一律 scam', () => {
  assert.equal(classifyText({ text: SMS }).kind, 'scam');
  const sign = classifyText({ lines: SIGN });
  assert.equal(sign.kind, 'sign');
  assert.equal(sign.sign.question, '307 公車到「敦化市場」還要多久？');
  assert.equal(classifyText({ text: '電子發票證明聯\n115年09-10月\nAB-12345678' }).kind, 'invoice');
  assert.equal(classifyText({ text: '今天晚上吃什麼\n滷肉飯 35' }).kind, 'text');
  assert.equal(classifyText({ text: '便利商店' }).kind, 'text', '只有兩個中文字、沒有站字樣：不猜是站牌');
  assert.equal(classifyText({ text: '便利商店' }, { hint: 'sign' }).kind, 'sign', '裝置模型說是站牌時才算');
  assert.equal(classifyText({ text: '  ' }).kind, 'empty');
  assert.equal(classifyText({ text: '今天晚上吃什麼' }, { profile: 'antifraud' }).kind, 'scam');
});

test('網址只有 1 分：站牌上的廣告網址不蓋過站牌、外送通知的短網址不算詐騙；網址＋點擊、急迫才算（審查）', () => {
  const ad = classifyText({ lines: ['307', '敦化市場', '往 板橋', '廣告 www.example.com.tw'] });
  assert.equal(ad.kind, 'sign', '讀到路線：單獨的網址不蓋過站牌');
  assert.equal(ad.sign.question, '307 公車到「敦化市場」還要多久？');
  assert.equal(classifyText({ text: '【Foodpanda】您的訂單已送達，祝您用餐愉快 https://fdp.ly/8kQ2' }).kind, 'text', '外送訂單通知帶短網址：不是詐騙');
  assert.ok(!looksLikeMessage('https://tw388.xyz'), '只有網址：不夠');
  assert.ok(looksLikeMessage('請點擊 https://tw388.xyz 更新資料'), '網址＋點擊');
  assert.ok(looksLikeMessage('最後通知 https://tw388.xyz'), '網址＋急迫');
  assert.equal(classifyText({ lines: ['307', '敦化市場', '您的驗證碼是 123456'] }).kind, 'scam', '驗證碼仍是強訊號，排在站牌前面');
});

test('demo-intent：組出來的站牌問題認得路線與站名（盯那一站）；沒有站名照舊', () => {
  const it = parseIntent('307 公車到「敦化市場」還要多久？', { history: [] });
  assert.equal(it.intent, 'bus_route');
  assert.equal(it.route, '307');
  assert.equal(it.stop, '敦化市場');
  assert.equal(parseIntent('307 公車在市政府站還要多久', { history: [] }).stop, '市政府站');
  assert.equal(parseIntent('307 還要多久', { history: [] }).stop, undefined);
  assert.equal(busStopOf('我在「站」'), null);
  assert.equal(busStopOf('到公車站還要多久'), null);
  assert.equal(parseIntent('307 到哪了？我在臺北車站', { history: [] }).stop, undefined, '我在哪是位置，不是要盯的站');
  assert.equal(parseIntent('我在「敦化市場」站，附近的公車多久來？', { history: [] }).intent, 'nearby_bus');
});

test('bus_route_eta：有站名＋位置、沒給縣市 → 用位置推縣市、盯那一站（不改成最近的站）', async () => {
  const all = await call('bus_route_eta', { city: 'Taipei', routeName: '307' });
  const stop = all.data.directions[0].stops[5].stopName;
  const r = await call('bus_route_eta', { routeName: '307', stop, near: { lat: 25.0478, lon: 121.517 } });
  assert.equal(r.data.focus.stopName, stop);
  assert.ok(!r.data.focus.nearest);
  assert.equal(r.data.cityGuessed, true);
  const miss = await call('bus_route_eta', { routeName: '307', stop: '不存在的站', near: { lat: 25.0478, lon: 121.517 } });
  assert.equal(miss.data.focus, undefined, '找不到那一站：不假裝是最近的站');
  assert.match(miss.text, /沒有「不存在的站」這一站/);
});

test('外掛回報整理：只收認得的引擎與狀態，不補預設', () => {
  assert.deepEqual(V.normalizeVisionInfo({ platform: 'android', camera: true, photos: true, cameraPermission: 'prompt', text: { available: true, engine: 'mlkit-text-chinese' }, barcode: { available: true, engine: 'mlkit-barcode' }, describe: { engine: 'gemini-nano', state: 'untested' } }),
    { where: 'app', text: true, barcode: true, camera: true, photos: true, textEngine: 'mlkit-text-chinese', barcodeEngine: 'mlkit-barcode', describe: { engine: 'gemini-nano', state: 'untested' }, cameraPermission: 'prompt' });
  assert.deepEqual(V.normalizeVisionInfo({ text: { available: true, engine: 'made-up' }, describe: { engine: 'gpt', state: 'supported' } }), { where: 'app', text: true, barcode: false, camera: false, photos: false });
  assert.deepEqual(V.normalizeVisionInfo(null), { where: 'app', text: false, barcode: false, camera: false, photos: false });
});

test('讀到的整理：行、區塊、條碼、影像理解提示；奇怪的欄位丟掉', () => {
  const r = V.normalizeReading({ engine: 'mlkit', ms: 420, text: { full: 'A\nB', lines: [{ text: 'A', box: { x: 0, y: 0, w: 1, h: 0.1 } }, { text: '' }, { text: 'B', box: { x: 'bad' } }], blocks: [{ text: 'A\nB' }] }, barcodes: [{ format: 'qr_code', raw: LEFT_QR }, { raw: '' }], describe: { kind: 'hack' } });
  assert.equal(r.text, 'A\nB');
  assert.deepEqual(r.lines, [{ text: 'A', box: { x: 0, y: 0, w: 1, h: 0.1 } }, { text: 'B', box: null }]);
  assert.equal(r.barcodes.length, 1);
  assert.equal(r.describe, undefined);
  assert.equal(V.normalizeReading({ describe: { kind: 'sign' } }).describe.kind, 'sign');
  assert.equal(V.normalizeReading({ text: { lines: [{ text: 'x' }, { text: 'y' }] } }).text, 'x\ny', '沒有 full 時用行組');
});

test('interpret：發票左邊 QR 先看；只有右邊 QR 提示拍左邊；簡訊、站牌照字分類；防詐頁不看發票', () => {
  const inv = V.interpret({ text: '', barcodes: [{ raw: '**咖啡:1:65' }, { raw: LEFT_QR }] });
  assert.equal(inv.kind, 'invoice');
  assert.deepEqual(inv.invoice, { track: 'AB', number: '54348835', date: '2026-08-03' });
  assert.equal(V.interpret({ text: '', barcodes: [{ raw: '**咖啡:1:65' }] }).kind, 'invoice-right');
  assert.equal(V.interpret({ text: SMS, barcodes: [] }).kind, 'scam');
  assert.equal(V.interpret({ text: SIGN.map((l) => l.text).join('\n'), lines: SIGN, barcodes: [] }).kind, 'sign');
  assert.equal(V.interpret({ text: SMS, barcodes: [{ raw: LEFT_QR }] }, { profile: 'antifraud' }).kind, 'scam');
  assert.equal(V.interpret({ text: '今天天氣', barcodes: [] }, { only: 'invoice' }).kind, 'empty', '發票頁只認發票');
  assert.equal(V.interpret({ text: 'AB-12345678', barcodes: [] }, { only: 'invoice' }).kind, 'invoice');
});

test('發票 QR → 存進我的發票 → 馬上對獎（示範資料 11507 頭獎）', async () => {
  const x = V.interpret({ text: '', barcodes: [{ raw: LEFT_QR }] });
  wallet.add(x.invoice);
  await checkWallet(call, { all: true });
  const item = wallet.list()[0];
  assert.equal(item.number, '54348835');
  assert.equal(item.status, 'won');
  assert.match(V.invoiceResultText(item), /中獎了！頭獎/);
  assert.match(V.invoiceResultText({ status: 'pending', drawDate: '2026-11-25' }), /11\/25 開獎/);
  assert.match(V.invoiceResultText({ status: 'lost' }, V.visionT('en')), /No prize/);
});

test('個資：找出手機、身分證、卡號、帳號；遮起來（發票 8 碼不遮）', () => {
  const s = '王小明 A123456789 手機 0912-345-678 卡號 4111 1111 1111 1111 帳號：00123456789012 發票 AB-12345678';
  assert.deepEqual(V.privateKinds(s), ['phone', 'id', 'card', 'account']);
  const m = V.maskReading(s);
  for (const raw of ['A123456789', '0912-345-678', '4111 1111 1111 1111', '00123456789012']) assert.ok(!m.includes(raw), raw);
  assert.match(m, /帳號：●+/);
  assert.match(m, /AB-12345678/);
  assert.deepEqual(V.privateKinds(SMS), []);
});

test('轉到防詐頁：只在記憶體、只給指定的頁、只取一次、最多 500 字、30 秒內有效', () => {
  V.handOff('antifraud', 'x'.repeat(800));
  assert.equal(V.takeHandoff('life'), null);
  assert.equal(V.takeHandoff('antifraud').length, V.VISION_MAX);
  assert.equal(V.takeHandoff('antifraud'), null);
  // 切頁失敗、之後才打開防詐頁：超過 30 秒就丟掉，不自動送出
  V.handOff('antifraud', '可疑訊息', 1000);
  assert.equal(V.takeHandoff('antifraud', 1000 + V.HANDOFF_TTL_MS + 1), null);
  assert.equal(V.takeHandoff('antifraud', 1000 + V.HANDOFF_TTL_MS + 2), null, '過期的也清掉');
  V.handOff('antifraud', '可疑訊息', 1000);
  assert.equal(V.takeHandoff('antifraud', 1000 + V.HANDOFF_TTL_MS), '可疑訊息');
});

test('設定開關：預設開、關掉記在本機', () => {
  assert.equal(V.visionEnabled(), true);
  V.setVisionEnabled(false);
  assert.equal(store.get(V.VISION_KEY), 'off');
  assert.equal(V.visionEnabled(), false);
  V.setVisionEnabled(true);
  assert.equal(V.visionEnabled(), true);
});

test('網頁版（沒有外掛）：沒有本機辨識就什麼都不提供；只有 BarcodeDetector 時只能讀發票', async () => {
  assert.deepEqual(await V.visionStatus(), { where: 'web', text: false, barcode: false, camera: false, photos: false });
  globalThis.BarcodeDetector = class {};
  try {
    const s = await V.visionStatus();
    assert.equal(s.barcode, true);
    assert.equal(s.text, false);
  } finally { delete globalThis.BarcodeDetector; }
});

test('字典：中英鍵相同、英文沒有中文、佔位符替換', () => {
  assert.deepEqual(Object.keys(V.VEN).sort(), Object.keys(V.VZH).sort());
  assert.doesNotMatch(Object.values(V.VEN).join('\n'), /[一-鿿]/);
  assert.equal(V.visionT(null)('truncated', { n: 500 }), '文字很長，只送前 500 字。');
  assert.equal(V.visionT('en')('nope'), 'nope');
});
