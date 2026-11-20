// S12c：英文提問的討論串說明用英文（@角色 標籤保留給畫面對應頭像）；接下來可以用英文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enNote } from '../core/agent/en-notes.js';
import { nextSteps } from '../public/js/agent/next-steps.js';
import { runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';

test('enNote：常見說明換英文、@標籤保留、對不上照原文', () => {
  assert.equal(enNote('@地點 先確認「臺北車站」和「台北101」在哪'), '@地點 finding where 臺北車站 and 台北101 are');
  assert.equal(enNote('@天氣 @空品 @路況 看一下外面的狀況'), '@天氣 @空品 @路況 checking weather, air and traffic');
  assert.equal(enNote('@行程 幫你比較幾種走法'), '@行程 comparing ways to get there');
  assert.equal(enNote('@公車 307 現在到哪了'), '@公車 where bus 307 is now');
  assert.equal(enNote('@高鐵 台北到左營的班次'), '@高鐵 trains from 台北 to 左營');
  assert.equal(enNote('@股市 看一下大盤收盤'), '@股市 看一下大盤收盤', '沒有英文規則的照原文');
});

test('英文提問：討論串說明英文、不說中文的「聽懂了」；接下來可以英文', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: 'How do I get to Taipei 101?' }] }, (e) => es.push(e));
  const notes = es.filter((e) => e.type === 'agent_note').map((e) => e.text);
  assert.ok(notes.length >= 2);
  for (const n of notes) assert.doesNotMatch(n.replace(/@\S+/g, '').replace(/「.+?」|臺北車站|台北101/g, ''), /[一-鿿]/, n);
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  const steps = nextSteps([{ tool: 'plan_trip', data: trip.data }], null, { lang: 'en' });
  assert.ok(steps.length >= 1 && steps.every((s) => !/[一-鿿]/.test(s.label)), steps.map((s) => s.label).join('|'));
  assert.ok(!steps.some((s) => s.kind === 'ask'), '英文不給會變成中文問句的建議');
});

test('S12d：英文那一輪的工具回報是英文（數字來自資料）、不附中文的「→ 影響」', async () => {
  const { speakEn, SPEAK_EN } = await import('../core/tools/speak-en.js');
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: 'How do I get to Taipei 101?' }] }, (e) => es.push(e));
  const results = es.filter((e) => e.type === 'tool_result' && e.ok);
  assert.ok(results.length >= 3);
  for (const r of results) {
    if (SPEAK_EN[r.tool]) assert.match(r.speak, /^[A-Z]/, `${r.tool}: ${r.speak}`); // 英文句子（地名可以是中文）
    assert.equal(r.impact, undefined, `${r.tool} 不附中文影響`);
  }
  assert.equal(speakEn('no_such_tool', {}), null);
  assert.equal(speakEn('weather_now', { rainMm1h: 2, pop3h: 80 }), "It's raining now, 80% chance of rain in the next 3 hours.");
  assert.match(speakEn('plan_trip', { best: 'a', options: [{ id: 'a', role: 'metro', minutes: 23 }, { id: 'b' }] }), /best is MRT \(23 min\)/);
  // 中文那一輪照舊
  const zh = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從臺北車站去台北101' }] }, (e) => zh.push(e));
  assert.ok(zh.filter((e) => e.type === 'tool_result' && e.ok).some((r) => /[一-鿿]/.test(r.speak || '')));
});
