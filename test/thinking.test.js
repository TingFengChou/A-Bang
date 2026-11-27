// 「阿幫在想」（public/js/agent/thinking.js）：事件 → 階段 → 畫面文字；回答上方的手機判斷說明
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinkStart, thinkStep, thinkText, deviceLine } from '../public/js/agent/thinking.js';

const run = (events, s = thinkStart()) => events.reduce(thinkStep, s);

test('送出 → 手機上聽懂了 → 正在查 → 整理答案 → 第一段回答收起', () => {
  let s = thinkStart();
  assert.equal(s.phase, 'think');
  assert.deepEqual(thinkText(s), { title: '阿幫在想…', stage: '', announce: '阿幫在想…' });
  s = thinkStep(s, { type: 'device', result: { intent: 'trip', states: ['rush', 'fly'], engine: 'gemini-nano' } });
  assert.equal(s.phase, 'device');
  assert.deepEqual(thinkText(s), { title: '阿幫在想…', stage: '手機上聽懂了：行程規劃・趕時間', announce: '手機上聽懂了：行程規劃・趕時間' }, '用真實結果，不認得的狀態不顯示');
  s = thinkStep(s, { type: 'status', mode: 'demo' });
  assert.equal(s.phase, 'device', 'status 不換階段');
  s = thinkStep(s, { type: 'agent_note', text: '我先看天氣' });
  assert.equal(s.phase, 'device');
  s = run([{ type: 'tool_start', id: 't1', role: '公車' }, { type: 'tool_start', id: 't2', role: '天氣' }], s);
  assert.deepEqual(thinkText(s), { title: '阿幫在想…', stage: '正在查：公車・天氣', announce: null }, '查資料的過程不另外念（討論串會念）');
  s = thinkStep(s, { type: 'tool_result', id: 't1', ok: true });
  assert.equal(thinkText(s).stage, '正在查：天氣');
  s = thinkStep(s, { type: 'tool_result', id: 't2', ok: false });
  assert.equal(s.phase, 'compose');
  assert.equal(thinkText(s).stage, '整理答案中');
  s = thinkStep(s, { type: 'text', delta: '307 再 3 分鐘到。' });
  assert.equal(s.phase, 'end');
  assert.equal(thinkStep(s, { type: 'tool_start', id: 't3', role: '公車' }).phase, 'end', '收起後不再出現');
});

test('沒有手機上的模型 → 伺服器判斷中；錯誤、done、中斷都收起', () => {
  const s = thinkStep(thinkStart(), { type: 'device', result: null });
  assert.equal(s.phase, 'server');
  assert.deepEqual(thinkText(s), { title: '阿幫在想…', stage: '伺服器判斷中', announce: '伺服器判斷中' });
  assert.equal(thinkStep(thinkStart(), { type: 'device', result: { intent: 'pizza', states: [] } }).phase, 'server', '看不懂的結果當沒有');
  for (const type of ['error', 'done', 'abort']) assert.equal(thinkStep(s, { type }).phase, 'end', type);
});

test('定位、同一個工具重複、超過三個角色、英文', () => {
  let s = run([{ type: 'device', result: null }, { type: 'client_tool_call', id: 'loc' }]);
  assert.equal(thinkText(s).stage, '正在查：定位');
  s = thinkStep(s, { type: 'client_tool_result', id: 'loc', ok: true });
  assert.equal(s.phase, 'compose');
  s = run(['公車', '天氣', '空品', '路況', '公車'].map((role, i) => ({ type: 'tool_start', id: `t${i}`, role })));
  assert.equal(thinkText(s).stage, '正在查：公車・天氣・空品等');
  const en = run([{ type: 'device', result: { intent: 'weather', states: [], engine: 'apple' } }]);
  assert.deepEqual(thinkText(en, 'en'), { title: 'Abang is thinking…', stage: 'Understood on your phone: Weather', announce: 'Understood on your phone: Weather' });
  const tools = run([{ type: 'tool_start', id: 'a', role: '公車' }]);
  assert.equal(thinkText(tools, 'en', (r) => ({ 公車: 'Bus' })[r]).stage, 'Checking: Bus');
  assert.equal(thinkText(thinkStep(thinkStart(), { type: 'device', result: null }), 'en').stage, 'The server is working out what you mean');
  assert.equal(thinkStep(tools, { type: 'device', result: null }).phase, 'tools', '已經在查了：手機結果晚到不倒退');
});

test('回答上方的手機判斷說明：採用時維持原句；伺服器用自己的判斷時照實說；沒有手機判斷就不說', () => {
  assert.equal(deviceLine({ sent: { engine: 'apple' }, judge: { source: 'device', engine: 'apple' } }), '阿幫先在手機上用 Apple Intelligence 聽懂你要做什麼。');
  assert.equal(deviceLine({ sent: { engine: 'gemini-nano' }, judge: { source: 'llm' } }), '手機上的 Gemini Nano 先聽了一遍；這一輪以伺服器的判斷為準。');
  assert.equal(deviceLine({ sent: { engine: 'gemini-nano' }, judge: null }), '手機上的 Gemini Nano 先聽了一遍；這一輪以伺服器的判斷為準。');
  assert.equal(deviceLine({ sent: { engine: 'apple' }, judge: { source: 'rules' } }, 'en'), "Apple Intelligence on your phone listened first; this time the server's own judgment was used.");
  assert.equal(deviceLine({ sent: null, judge: { source: 'embed' } }), null);
  assert.equal(deviceLine({ sent: null, judge: null }), null);
  assert.equal(deviceLine({ sent: { engine: 'other' }, judge: null }), null, '不認得的引擎不說');
});

test('準備行動（2026-11-28）：阿幫問你帶動作選項 → act 階段，寫出動作與確認方式；沒有動作選項不變', async () => {
  const { thinkStart, thinkStep, thinkText } = await import('../public/js/agent/thinking.js');
  let s = thinkStep(thinkStart(), { type: 'tool_start', id: 't1', role: '路線' });
  s = thinkStep(s, { type: 'tool_result', id: 't1' });
  const act = thinkStep(s, { type: 'ask', options: [{ kind: 'action', action: { name: 'addCalendar' } }, { kind: 'dismiss' }] });
  assert.equal(act.phase, 'act');
  assert.equal(thinkText(act).stage, '準備行動：加到行事曆（系統畫面確認）');
  assert.equal(thinkText(act, 'en').stage, 'Getting an action ready: add to calendar (confirmed on the system screen)');
  assert.equal(thinkText(thinkStep(s, { type: 'ask', options: [{ kind: 'action', action: { name: 'watchArrival' } }] })).stage, '準備行動：到站提醒（你按一下）');
  assert.equal(thinkStep(s, { type: 'ask', options: [{ kind: 'reply' }] }).phase, 'compose', '只是問問題：不算行動');
  assert.equal(thinkStep(act, { type: 'text', delta: '…' }).phase, 'end');
});
