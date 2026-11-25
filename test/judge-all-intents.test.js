// 意圖判斷 29 類（2026-11-23 產品負責人：阿幫會的每一件事都要有意圖；範圍內的就採用，範圍外的至少了解意圖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJudge, JUDGE_INTENTS, finer } from '../core/agent/judge.js';
import { parseIntent, demoSummary } from '../core/agent/demo-intent.js';
import { runDemo, judgeInfo } from '../core/agent/run.js';
import { INTENT_TOOLS, FIXED_REPLY_INTENTS } from '../core/agent/model-loop.js';
import { cleanTopic } from '../core/topic.js';
import { normalizeJudge, EDGE_INTENTS } from '../public/js/edge-judge.js';
import { intentLabel } from '../public/js/ai-info.js';
import { aiT } from '../public/js/pages/ai-i18n.js';
import { createServices } from '../core/index.js';

const NEW = ['intercity', 'ridehail', 'booking', 'place', 'outing', 'drama', 'exercise', 'scam', 'reminder', 'settings', 'help', 'chat', 'emergency'];

test('29 類：伺服器、手機、iOS（@Generable 選項）、畫面字典同一份', async () => {
  assert.equal(Object.keys(JUDGE_INTENTS).length, 29);
  assert.deepEqual([...EDGE_INTENTS].sort(), Object.keys(JUDGE_INTENTS).sort());
  for (const k of NEW) assert.ok(JUDGE_INTENTS[k], k);
  const swift = await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url), 'utf8');
  const list = /let edgeIntents = \[([^\]]+)\]/.exec(swift)[1].match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(list.sort(), Object.keys(JUDGE_INTENTS).sort());
  for (const lang of ['zh', 'en']) {
    const t = aiT(lang);
    for (const k of Object.keys(JUDGE_INTENTS)) assert.notEqual(t(`intent.${k}`), `intent.${k}`, `${lang} intent.${k}`);
  }
  const prompt = await readFile(new URL('../core/agent/judge-prompt.txt', import.meta.url), 'utf8');
  for (const k of NEW) assert.match(prompt, new RegExp(`- ${k}：`), `judge-prompt.txt 有 ${k}`);
});

test('訓練範例：每個意圖至少 8 句', async () => {
  const items = JSON.parse(await readFile(new URL('../core/data/judge-train.json', import.meta.url), 'utf8')).items;
  for (const k of Object.keys(JUDGE_INTENTS)) assert.ok(items.filter((x) => x.intent === k).length >= 8, k);
});

test('判斷層指定新意圖：接上既有的處理', () => {
  const p = (q, intent) => parseIntent(q, { history: [], intent });
  assert.deepEqual([p('搭客運去台中', 'intercity').intent, p('搭客運去台中', 'intercity').mode], ['trip', 'intercity']);
  assert.equal(p('去陽明山有公車嗎', 'intercity').mode, 'bus', '沒提到客運不限定只查客運');
  assert.deepEqual([p('幫我叫一台車去台北101', 'ridehail').intent, p('幫我叫一台車去台北101', 'ridehail').mode], ['trip', 'ridehail']);
  assert.deepEqual([p('叫車', 'ridehail').needs, p('叫車', 'ridehail').mode], ['to', 'ridehail'], '沒說去哪：先問');
  assert.deepEqual([p('台北101在哪', 'place').intent, p('台北101在哪', 'place').placeAsk], ['trip', true]);
  assert.deepEqual([p('訂明天到台中的高鐵票', 'booking').intent, p('訂明天到台中的高鐵票', 'booking').book], ['rail', true]);
  assert.equal(p('幫我訂票', 'booking').intent, 'limits', '說不出起訖：說明只給官方連結');
  assert.deepEqual([p('今天適合散步嗎', 'exercise').intent, p('今天適合散步嗎', 'exercise').walk], ['outing', true]);
  assert.equal(p('對方要我加他的line', 'scam').intent, 'scamAsk');
  for (const k of ['reminder', 'settings', 'emergency']) assert.equal(p('隨便一句', k).intent, k);
  assert.equal(p('你會做什麼', 'help').help, true);
  assert.equal(p('哈哈', 'chat').chat, true);
});

test('固定回覆：提醒、設定、緊急求助、閒聊（不查資料）', () => {
  assert.match(demoSummary({ intent: 'emergency' }, {}), /119/);
  assert.match(demoSummary({ intent: 'reminder' }, {}), /提醒/);
  assert.match(demoSummary({ intent: 'settings' }, {}), /常用地點/);
  assert.match(demoSummary({ intent: 'unknown', chat: true }, {}), /我是阿幫/);
  assert.deepEqual(FIXED_REPLY_INTENTS, ['scam', 'reminder', 'settings', 'emergency']);
  for (const k of ['intercity', 'ridehail', 'booking', 'place', 'outing', 'exercise']) assert.ok(INTENT_TOOLS[k]?.length, `模型模式 ${k} 有工具`);
});

test('意圖標得更細：規則聽出指定客運／叫車、散步運動', () => {
  assert.equal(finer('trip', { mode: 'intercity' }, '搭客運去台中'), 'intercity');
  assert.equal(finer('trip', { mode: 'ridehail' }, '坐小黃去台北車站'), 'ridehail');
  assert.equal(finer('trip', { mode: 'bus' }, '坐公車去台北車站'), 'trip');
  assert.equal(finer('outing', {}, '天氣不錯適合運動嗎'), 'exercise');
  assert.equal(finer('outing', {}, '出門要注意什麼'), 'outing');
});

test('打招呼是 chat、問能做什麼是 help（以前都是 unknown）', async () => {
  const j = createJudge();
  assert.equal((await j('你好')).intent, 'chat');
  assert.equal((await j('早安阿幫')).intent, 'chat');
  assert.equal((await j('你是誰')).intent, 'help');
});

test('範圍外的主題：整理、擋個資', () => {
  assert.equal(cleanTopic('訂餐廳'), '訂餐廳');
  assert.equal(cleanTopic('「寫信給老闆」。'), '寫信給老闆');
  for (const bad of ['打給 0912345678', '看 a.com', 'https://x.tw', '寄到 x@y.tw', '這是一個非常非常長的句子超過十二個字', 'unknown', '其他', '', '好', null, 3]) assert.equal(cleanTopic(bad), null, String(bad));
});

test('手機的判斷：範圍外（unknown）才帶主題', () => {
  assert.equal(normalizeJudge({ intent: 'unknown', states: [], topic: '訂餐廳' }, 'apple').topic, '訂餐廳');
  assert.equal(normalizeJudge({ intent: 'weather', states: [], topic: '查天氣' }, 'apple').topic, undefined);
  assert.equal(normalizeJudge({ intent: 'unknown', states: [], topic: '打給 0912345678' }, 'apple').topic, undefined);
  assert.equal(normalizeJudge('{"intent":"unknown","states":[],"ask":null,"topic":"查快遞"}', 'gemini-nano').topic, '查快遞');
  assert.equal(normalizeJudge('{"intent":"unknown","states":[],"topic":"查快遞","ask":{"slot":', 'gemini-nano').topic, '查快遞', '截斷的輸出也撈得回主題');
});

test('範圍外：判斷層帶主題、回答說聽懂了什麼；畫面顯示「其他：主題」', async () => {
  const j = createJudge();
  const r = await j('幫我訂一間餐廳', [], { device: { intent: 'unknown', states: [], engine: 'apple', topic: '訂餐廳' } });
  assert.deepEqual([r.intent, r.topic], ['unknown', '訂餐廳']);
  assert.equal(judgeInfo(r).topic, '訂餐廳');
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '幫我訂一間餐廳' }], deviceJudge: { intent: 'unknown', states: [], engine: 'apple', topic: '訂餐廳' } }, (e) => es.push(e), { judge: createJudge() });
  const text = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  assert.match(text, /聽懂了，你想「訂餐廳」/);
  assert.equal(es.find((e) => e.type === 'tool_start'), undefined, '不查工具');
  const t = aiT('zh');
  assert.equal(intentLabel({ intent: 'unknown', topic: '訂餐廳' }, t), '其他：訂餐廳');
  assert.equal(intentLabel({ intent: 'unknown' }, t), '其他');
  assert.equal(intentLabel({ intent: 'scam' }, t), '防詐');
  assert.equal(intentLabel({ intent: 'weather', topic: '不該出現' }, t), '天氣');
});

test('判斷層說新意圖：端到端照新意圖處理（手機判斷，示範模式）', async () => {
  const run = async (q, device) => {
    const es = [];
    await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: q }], deviceJudge: { states: [], engine: 'apple', ...device } }, (e) => es.push(e), { judge: createJudge() });
    return { es, text: es.filter((e) => e.type === 'text').map((e) => e.delta).join('') };
  };
  assert.match((await run('有人一直叫我加他好友', { intent: 'scam' })).text, /防詐/);
  assert.match((await run('等等車到的時候跟我說一聲', { intent: 'reminder' })).text, /提醒/);
  assert.match((await run('有個阿伯倒在路邊', { intent: 'emergency' })).text, /119/);
  assert.match((await run('我想改一下我住的地方', { intent: 'settings' })).text, /常用地點/);
});

test('規則保底（2026-11-25 Gemini Nano 實測不穩的兩類）：加 LINE、投資群組是詐騙；設提醒是提醒，手機說別的也照規則', async () => {
  for (const q of ['加line帳號', '有人叫我加他的賴', '對方給我line ID', '我想加入投資群組']) assert.equal(parseIntent(q, { history: [] }).intent, 'scamAsk', q);
  for (const q of ['公車快到時提醒我', '到站叫我', '取消提醒', '明天八點提醒我出門']) assert.equal(parseIntent(q, { history: [] }).intent, 'reminder', q);
  for (const q of ['line 怎麼更新', '去台北101，出門前提醒我']) assert.notEqual(parseIntent(q, { history: [] }).intent, 'reminder', q);
  assert.notEqual(parseIntent('line 怎麼更新', { history: [] }).intent, 'scamAsk');
  const j = createJudge();
  const r = await j('公車快到時提醒我', [], { device: { intent: 'bus_route', states: [], engine: 'gemini-nano' } });
  assert.deepEqual([r.intent, r.source], ['reminder', 'rules']);
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '加line帳號' }], deviceJudge: { intent: 'chat', states: [], engine: 'gemini-nano' } }, (e) => es.push(e), { judge: createJudge() });
  assert.match(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /防詐/);
});

test('手機的指示：unknown 一定寫主題、不出題；主題在題目前面（iOS 依屬性順序產生、Android JSON 範本）', async () => {
  const { EDGE_INSTRUCTIONS } = await import('../public/js/edge-judge.js');
  const { EDGE_ASK_GUIDE } = await import('../core/edge-ask.js');
  assert.match(EDGE_INSTRUCTIONS, /unknown 時一定要寫 topic/);
  assert.match(EDGE_ASK_GUIDE, /unknown 一律不問/);
  const swift = await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url), 'utf8');
  const st = swift.slice(swift.indexOf('struct EdgeJudgement'));
  assert.ok(st.indexOf('var topic') < st.indexOf('var ask'), 'iOS：topic 在 ask 前面');
  const java = await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url), 'utf8');
  assert.ok(java.indexOf('\\"topic\\"') < java.indexOf('\\"ask\\":null'), 'Android：topic 在 ask 前面');
});

test('設定的規則保底（Apple Intelligence 把「設定我家在板橋」判成找地點）；問怎麼去不算', async () => {
  for (const q of ['設定我家在板橋', '把公司設成常用地點', '我有車', '把語言改成英文', '關掉通知', '常用地點怎麼設']) assert.equal(parseIntent(q, { history: [] }).intent, 'settings', q);
  assert.equal(parseIntent('我家在板橋，怎麼去101', { history: [] }).intent, 'trip');
  assert.notEqual(parseIntent('設定鬧鐘', { history: [] }).intent, 'settings');
  const r = await createJudge()('設定我家在板橋', [], { device: { intent: 'place', states: [], engine: 'apple' } });
  assert.deepEqual([r.intent, r.source], ['settings', 'rules']);
});

test('Apple Intelligence 用精簡的指示：沒有會被安全護欄擋的描述（詐騙、急病、救護車）；Gemini Nano 用完整版', async () => {
  const { EDGE_JUDGE_INSTRUCTIONS, EDGE_JUDGE_INSTRUCTIONS_APPLE, judgeInstructions } = await import('../public/js/edge-judge.js');
  assert.doesNotMatch(EDGE_JUDGE_INSTRUCTIONS_APPLE, /救護車|急病|假冒檢警|詐騙嗎|人名、電話/);
  assert.match(EDGE_JUDGE_INSTRUCTIONS, /scam 可疑簡訊/);
  assert.ok(EDGE_JUDGE_INSTRUCTIONS_APPLE.length < EDGE_JUDGE_INSTRUCTIONS.length);
  assert.match(EDGE_JUDGE_INSTRUCTIONS_APPLE, /unknown 時一定要寫 topic/);
  assert.equal(judgeInstructions({ getPlatform: () => 'ios' }), EDGE_JUDGE_INSTRUCTIONS_APPLE);
  assert.equal(judgeInstructions({ getPlatform: () => 'android' }), EDGE_JUDGE_INSTRUCTIONS);
  assert.equal(judgeInstructions(null), EDGE_JUDGE_INSTRUCTIONS);
});
