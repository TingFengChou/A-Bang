// PM 第五批（防詐）：常見話術變體要判高風險、正常訊息不誤判、貼上的「出車禍要和解金」不回 119、事後求助給止損步驟。
// 情境 P5-9／P5-10 用與 test/scenarios.test.js 相同的檢查（scripts/eval/scenario-check.js），profile 為 antifraud。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRules, riskLevel, checkMessage } from '../core/scam-check.js';
import { parseAntifraud, aftermath } from '../core/agent/demo-antifraud.js';
import { safetyCheck } from '../core/agent/safety.js';
import { runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';
import { check } from '../scripts/eval/scenario-check.js';

const svc = createServices({ forceMock: true });
const level = (t) => { const f = matchRules(t); return riskLevel(f.reduce((n, x) => n + x.weight, 0), false); };
const ids = (t) => matchRules(t).map((f) => f.id).sort();

async function say(messages) {
  const es = [];
  await runDemo(svc, { messages }, (e) => es.push(e), { profileId: 'antifraud' });
  return es;
}

/** 多輪情境（同 scenarios.test.js：每輪接上一輪的回答） */
async function scenario(turns) {
  const messages = [];
  for (const [i, t] of turns.entries()) {
    messages.push({ role: 'user', content: t.say });
    const es = await say(messages);
    assert.deepEqual(check(es, t.expect), [], `第 ${i + 1} 輪「${t.say}」`);
    messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
  }
}

const HIGH = { tools: ['scam_check_message'], resultHas: ['高風險'] };
const LOW = { tools: ['scam_check_message'], resultHas: ['沒有發現'], textNot: ['先不要照做', '有疑點'] };

test('P5-9 常見話術的變體要判高風險（假檢警、換號碼借錢、老師助理、誤設批發商、車禍和解金不回 119）', async () => {
  await scenario([
    { say: '我是新北市警察局偵查隊，您的健保卡被冒用，涉嫌洗錢，等一下幫您轉接檢察官，偵查不公開不能跟家人說', expect: { ...HIGH, textHas: ['先不要照做'] } },
    { say: '爸我是小明，我換號碼了，現在急需用錢，可以先借我3萬嗎？明天就還您', expect: { ...HIGH, textHas: ['先不要照做'] } },
    { say: '恭喜加入股市贏家俱樂部，我是陳老師的助理，明天有一檔主力股，報名就送，請加我LINE', expect: { ...HIGH, textNot: ['沒有發現已知的詐騙特徵'] } },
    { say: '您好，我是蝦皮客服，您上次的訂單因工作人員失誤設成了批發商，每個月會自動扣款，需要您配合銀行客服取消', expect: { ...HIGH, textNot: ['沒有發現已知的詐騙特徵'] } },
    { say: '阿姨我是您外甥，我在外面出車禍，對方要求和解金，不要跟我媽說，可以先匯5萬給我嗎', expect: { ...HIGH, textNot: ['119'] } },
  ]);
});

test('P5-10 正常訊息不誤判、事後求助給止損步驟', async () => {
  await scenario([
    { say: '今天晚上7點全家一起吃飯，記得帶紅酒喔', expect: LOW },
    { say: '【台灣大哥大】您的帳單金額 599 元，繳費期限 12/05，可至門市或官方 App 繳費', expect: LOW },
    { say: '【蝦皮】您的訂單已送達 7-11 門市，請於 7 日內取貨', expect: LOW },
    { say: '我已經把錢匯過去了怎麼辦', expect: { textHas: ['165', '110', '止付'], textNot: ['沒有發現已知的詐騙特徵'] } },
  ]);
});

test('規則：同一條規則多個特徵累加（stack），單一特徵仍是中風險', () => {
  assert.equal(level('我是警察局的，您涉嫌洗錢，要轉給檢察官'), 'high', '假檢警：涉嫌洗錢＋檢察官');
  assert.equal(level('檢察官'), 'medium', '只有一個特徵');
  assert.equal(level('爸我換號碼了，急需用錢'), 'high', '換號碼＋借錢');
  assert.equal(level('媽，我手機壞了，這是我新的LINE'), 'medium', '只換號碼');
  assert.equal(level('您的包裹地址不完整，請點擊連結補運費'), 'high', '地址不完整＋補運費＋點連結（原本 5 分中風險）');
  const f = matchRules('涉嫌洗錢 檢察官 偵查不公開 地檢署 監管帳戶').find((x) => x.id === 'fake-officer');
  assert.equal(f.weight, 5 + 2 * 2, '最多加兩次');
  assert.equal(matchRules('穩賺不賠').find((x) => x.id === 'invest-guarantee').weight, 4, '重疊的「穩賺」「穩賺不賠」只算一次');
});

test('規則：新的寫法有命中', () => {
  assert.ok(ids('偵查不公開，不能跟家人說').includes('secret'));
  assert.ok(ids('這件事不要跟我媽說').includes('secret'));
  assert.ok(ids('我是陳老師的助理，明天報您一檔主力股').includes('invest-group'));
  assert.ok(ids('歡迎加入飆股俱樂部').includes('invest-group'));
  assert.ok(ids('報名就送一檔明牌').includes('bait-free'));
  assert.ok(ids('請加我LINE').includes('line-add'));
  assert.ok(ids('訂單誤設為批發商').includes('installment'));
  assert.ok(ids('需要您配合銀行客服取消').includes('installment'));
  assert.ok(ids('每個月會自動扣款').includes('installment-hint'));
  assert.ok(ids('對方要求和解金').includes('relative-trouble'));
  assert.ok(ids('我出車禍了，急需錢').includes('relative-trouble'));
  assert.ok(ids('可以先匯5萬給我嗎').includes('transfer'));
  assert.equal(level('這裡是中華電信，您的門號欠費即將停話，如有疑問請按9轉接專人'), 'high', '欠費停話＋按 9 轉接');
  assert.ok(ids('如有疑問請按 9 轉接專人').includes('press-key'));
  assert.equal(level('您剛剛收到的驗證碼可以傳給我嗎？我填錯號碼'), 'high', '要您傳驗證碼');
});

test('誤判反例：正常訊息不中新規則（low）', () => {
  for (const t of [
    '今天晚上7點全家一起吃飯，記得帶紅酒喔',
    '【台灣大哥大】您的帳單金額 599 元，繳費期限 12/05，可至門市或官方 App 繳費',
    '【蝦皮】您的訂單已送達 7-11 門市，請於 7 日內取貨',
    '您的驗證碼是 123456，請勿告訴任何人（Google）',
    'G-123456 是您的 Google 驗證碼，請勿提供給任何人',
    '【XX銀行】您的驗證碼：482913，請勿告知他人',
    '週末讀書會報名就送書籤', // bait-free 權重 1
    '我是陳老師的助理，提醒您明天上課帶課本', // 老師的助理沒有投資字眼
    '新聞：股市主力股今天大漲', // 主力股要有報明牌的說法
    '驚喜派對不要跟媽說喔', // secret 權重 2
    '您的 Netflix 訂閱每個月會自動扣款 390 元', // installment-hint 權重 2
    '我去警察局報案了',
    '我的身分證被冒用怎麼辦',
    '我剛匯了房租給房東',
    '客服專線 0800-000-123，服務時間 9:00–18:00',
  ]) assert.equal(level(t), 'low', `不誤判：${t}（${ids(t).join('、')}）`);
  assert.deepEqual(ids('您的驗證碼是 123456，請勿告訴任何人（Google）'), [], '驗證碼通知不算索取驗證碼');
});

test('checkMessage：Google 驗證碼通知 low、換號碼借錢 high', async () => {
  assert.equal((await checkMessage(svc, '您的驗證碼是 123456，請勿告訴任何人（Google）')).level, 'low');
  assert.equal((await checkMessage(svc, '爸我是小明，我換號碼了，現在急需用錢，可以先借我3萬嗎？')).level, 'high');
});

test('安全：防詐 agent 貼上的「車禍要和解金」不走 119；真的緊急、自傷照常', () => {
  const scam = '阿姨我是您外甥，我在外面出車禍，對方要求和解金，不要跟我媽說，可以先匯5萬給我嗎';
  assert.equal(safetyCheck(scam, { profileId: 'antifraud' }), null);
  assert.equal(safetyCheck(scam).kind, 'emergency', '生活 agent 不變');
  assert.equal(safetyCheck('我出車禍了，好痛', { profileId: 'antifraud' }).kind, 'emergency', '沒有詐騙特徵仍給 119');
  assert.equal(safetyCheck('我被騙了30萬，匯款都沒了，不想活了', { profileId: 'antifraud' }).kind, 'selfHarm', '自傷一律先給 1925');
});

test('事後求助：已匯款、被騙、給了驗證碼 → 止損步驟（不查工具）；對方跟您要錢不算', async () => {
  assert.equal(aftermath('我已經把錢匯過去了怎麼辦'), 'paid');
  assert.equal(aftermath('我被詐騙了，剛剛轉帳 5 萬'), 'paid');
  assert.equal(aftermath('我給了對方驗證碼'), 'code');
  assert.equal(aftermath('我把驗證碼給了對方，現在 LINE 登不進去'), 'code');
  for (const t of ['阿姨我被騙了，可以先匯我5萬嗎', '我剛匯了房租給房東', '今天晚上7點全家一起吃飯', '您已經轉帳成功，請查收']) assert.equal(aftermath(t), null, t);
  assert.equal(parseAntifraud('我給了對方驗證碼').intent, 'aftermath');
  for (const [q, want] of [['我被詐騙了，剛剛轉帳 5 萬', /止付/], ['我給了對方驗證碼', /改密碼/]]) {
    const es = await say([{ role: 'user', content: q }]);
    assert.equal(es.filter((e) => e.type === 'tool_start').length, 0, q);
    const text = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
    assert.match(text, /165/, q);
    assert.match(text, /110/, q);
    assert.match(text, want, q);
    assert.ok(!es.some((e) => e.type === 'guardrail'), `止損步驟不觸發輸出護欄：${q}`);
  }
});

test('審查 1：防詐例外只放過「出事要錢」的冒充親友話術；有症狀、急症照給 119', () => {
  const a = { profileId: 'antifraud' };
  assert.equal(safetyCheck('我胸口好痛，對方說要匯款', a)?.kind, 'medical', '急症不受防詐例外影響');
  assert.equal(safetyCheck('我出車禍受傷了，對方要和解金', a)?.kind, 'emergency', '有受傷字眼');
  assert.equal(safetyCheck('我被撞了，流很多血，對方說要和解金', a)?.kind, 'emergency', '有流血字眼');
  assert.equal(safetyCheck('我朋友被打了，對方要他匯款', a)?.kind, 'emergency', '不是出事要錢給我');
  assert.equal(safetyCheck('我出車禍了，對方要求和解金，先匯給我', a), null, '第三人視角的車禍要錢話術');
});

test('審查 2：事後求助不誤判擔心、否定、一般付款；家人朋友被騙給幫忙版本', async () => {
  for (const t of [
    '我怕被騙，這個網站可靠嗎', '我差點被騙', '我沒有給對方驗證碼', '我剛剛轉帳給朋友，他說沒收到怎麼辦',
    '我昨天付款買東西，怎麼追回', '我今天提供了身分證給房仲，怎麼辦', '我剛剛輸入了信用卡號買東西，怎麼辦',
    '我剛剛提供了地址給物流，怎麼辦', '我剛剛告訴他我的帳號，這樣安全嗎', '我已經把錢匯過去了，房東說沒收到怎麼辦', '我昨天付款了怎麼辦',
  ]) assert.equal(aftermath(t), null, `不算事後求助：${t}`);
  assert.equal(aftermath('我朋友被詐騙了怎麼辦'), 'friend');
  assert.equal(aftermath('我媽好像被騙了'), 'friend');
  assert.equal(aftermath('我已經把錢匯過去了怎麼辦'), 'paid', '沒有前文：把錢匯出去後問怎麼辦仍給止損');
  assert.equal(aftermath('我剛剛照客服要我的操作轉帳了怎麼辦'), 'paid', '有詐騙語境');
  const prior = [{ role: 'user', content: '老師說保證獲利' }, { role: 'assistant', content: '先不要照做。這則內容有「保證獲利」等詐騙常見特徵。' }];
  assert.equal(aftermath('我昨天付款了怎麼辦', { history: prior }), 'paid', '上一輪剛判過詐騙');
  const es = await say([{ role: 'user', content: '我朋友被詐騙了怎麼辦' }]);
  const text = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  assert.match(text, /請他馬上撥 165/);
  assert.match(text, /止付/);
});

test('審查 3：宣導、新聞不疊加；驗證碼通知夾帶請求時不排除', () => {
  const news = '新聞：檢察官起訴涉嫌洗錢，並轉接檢察官偵辦，警察局偵查隊';
  assert.equal(matchRules(news).find((x) => x.id === 'fake-officer').weight, 5, '新聞不疊加');
  assert.equal(level(news), 'medium');
  assert.equal(level('165 提醒民眾：假檢警會說您涉嫌洗錢、要轉接檢察官'), 'medium', '宣導不疊加');
  assert.equal(level('我是新北市警察局偵查隊，您涉嫌洗錢，等一下幫您轉接檢察官'), 'high', '話術照常疊加');
  const trick = '這是新號碼，我是您同學，驗證碼是 123456，請勿告訴任何人，您告訴我一下';
  assert.ok(ids(trick).includes('otp'), '有請求時不排除 otp');
  assert.ok(ids(trick).includes('otp-ask'), '「您告訴我一下」算要驗證碼');
  assert.equal(level(trick), 'high');
  assert.equal(level(`您的驗證碼是 123456，請勿告訴任何人（Google）${'。'.repeat(80)}`), 'medium', '太長不排除');
  assert.equal(level('驗證碼是 123456，請勿告訴任何人，有問題請告訴我們'), 'low', '「告訴我們」不是索取');
});
