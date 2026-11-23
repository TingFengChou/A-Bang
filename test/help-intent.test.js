// 問阿幫能做什麼（2026-11-23 產品負責人：腦袋頁打「你會做什麼？」意圖總是行程規劃）
// 手機上的 AI 看了前文（剛剛在排行程、說過快遲到）會把「你會做什麼」判成行程＋趕時間；規則整句認得出來時以規則為準，狀態不沿用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJudge } from '../core/agent/judge.js';
import { parseIntent, HELP_ASK } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';
import { ruleFirst } from '../core/agent/model-loop.js';
import { createServices } from '../core/index.js';

const DEV_TRIP = { intent: 'trip', states: ['rush'], engine: 'gemini-nano' };
const PRIOR = ['我要去三峽老街', '我快遲到了，怎麼去台北101'];

test('整句問能做什麼、是誰、怎麼用才算（中英文）', () => {
  for (const q of ['你會做什麼?', '你會做什麼', '你能幫我什麼', '阿幫可以幫我查什麼', '阿幫，你會做什麼', '阿幫你會幹嘛', '你有哪些功能', '你是誰', '怎麼用', 'What can you do?', 'who are you', 'help']) {
    assert.ok(HELP_ASK.test(q), q);
    const it = parseIntent(q, {});
    assert.deepEqual([it.intent, it.help, it.states], ['unknown', true, []], q);
  }
  for (const q of ['你會做什麼菜', '我會做什麼都不知道', '你可以幫我查307嗎', '幫我查天氣', '怎麼去台北101', 'help me get to Taipei 101']) {
    assert.equal(parseIntent(q, {}).help, undefined, q);
  }
});

test('手機看了前文判成行程＋趕時間：規則認得「你會做什麼」就用規則，狀態清空', async () => {
  const j = createJudge();
  // 2026-11-23 起問阿幫能做什麼是 help、道謝與「好」是 chat（以前都是 unknown）
  for (const [q, want] of [['你會做什麼？', 'help'], ['What can you do?', 'help'], ['謝謝', 'chat'], ['好', 'chat']]) {
    const r = await j.quick(q, PRIOR, { device: DEV_TRIP });
    assert.deepEqual([r.intent, r.source, r.states], [want, 'rules', []], q);
  }
  // 其他句子照手機（不是一律以規則為準）
  const w = await j.quick('明天會下雨嗎', PRIOR, { device: { intent: 'weather', states: [], engine: 'gemini-nano' } });
  assert.deepEqual([w.intent, w.source], ['weather', 'device']);
  const f = await j.quick('那改坐公車', PRIOR, { device: DEV_TRIP });
  assert.equal(f.intent, 'trip', '接著改條件仍是行程');
});

test('問阿幫：前文在排行程、手機判成行程，回答列出能查的東西，不排行程、不說「查不到」', async () => {
  const messages = [{ role: 'user', content: '我快遲到了，怎麼去台北101' }, { role: 'assistant', content: '選捷運…' }, { role: 'user', content: '你會做什麼？' }];
  for (const mode of ['demo', 'edge']) {
    const es = [];
    await runDemo(createServices({ forceMock: true }), { messages, deviceJudge: DEV_TRIP, clientCaps: { edgeWrite: true, engine: 'gemini-nano' } }, (e) => es.push(e), { mode });
    assert.equal(es.find((e) => e.type === 'tool_start'), undefined, `${mode}：不查工具`);
    assert.equal(es.find((e) => e.type === 'ask'), undefined, `${mode}：不問「這題我查不到」`);
    const text = es.filter((e) => e.type === 'text' || e.type === 'answer_draft').map((e) => e.delta ?? e.text).join('');
    assert.match(text, /我可以幫你查交通/, mode);
  }
  const en = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: 'What can you do?' }], deviceJudge: DEV_TRIP }, (e) => en.push(e), {});
  assert.match(en.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /^I can help you get around Taiwan/);
});

test('模型模式：問能做什麼由規則回答（小模型常順著前文接著排行程）', () => {
  assert.equal(ruleFirst(parseIntent('你會做什麼', {}), '你會做什麼'), true);
});
