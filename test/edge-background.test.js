// 手機上的 AI 在背景被擋（Pixel smoke 2026-11-22）：ML Kit GenAiException 30＝BACKGROUND_USE_BLOCKED、27＝PER_APP_BATTERY_USE_QUOTA_EXCEEDED。
// 系統暫時不讓用不是模型壞掉：不跳斷路器、不停掉 suggest，這一題交給伺服器／規則；App 不在前景時乾脆不呼叫。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { edgeJudge, edgeSuggest, edgeCanSuggest, edgeJudgeReady, edgeTrips, edgeTripped, edgeIssue, edgeSoftReason, edgeForeground, _resetEdge } from '../public/js/edge-judge.js';
import { edgeWrite, writeLine } from '../public/js/edge-write.js';
import { runTrial } from '../public/js/ai-trial.js';
import { TRIAL_ZH, TRIAL_EN } from '../public/js/pages/ai-trial-i18n.js';

let calls;
const fake = (impl) => {
  calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: (plugin, method, args) => { calls.push(method); return impl(method, args); } };
};
const setVisible = (v) => { globalThis.document = { visibilityState: v }; };
const ok = (method) => Promise.resolve(method === 'judge' ? { engine: 'gemini-nano', ms: 200, result: '{"intent":"weather","states":[]}' } : method === 'suggest' ? { engine: 'gemini-nano', result: ['明天會下雨嗎？', '附近有 YouBike 嗎？', '現在空氣好嗎？'] } : method === 'write' ? { engine: 'gemini-nano', ms: 300, text: '明天降雨機率 30%。' } : {});
const DRAFT = { text: '明天降雨機率 30%。', facts: { points: ['明天降雨機率 30%'] }, lang: 'zh' };

beforeEach(() => { _resetEdge(); setVisible('visible'); });
afterEach(() => { delete globalThis.Capacitor; delete globalThis.document; _resetEdge(); });

test('錯誤碼：background、battery-quota 不跳斷路器；unavailable 照舊跳', () => {
  assert.equal(edgeTrips('background'), false);
  assert.equal(edgeTrips('battery-quota'), false);
  assert.equal(edgeTrips('unavailable: background'), false, '原生端就算包在 unavailable 裡也不跳');
  assert.equal(edgeTrips('unavailable'), true);
  assert.equal(edgeSoftReason('background'), 'background');
  assert.equal(edgeSoftReason('battery-quota'), 'battery-quota');
  assert.equal(edgeSoftReason('judge failed'), null);
});

test('judge 遇到背景被擋、電量配額：這一題交給伺服器（null），不跳斷路器，下一題照常在手機上', async () => {
  for (const reason of ['background', 'battery-quota']) {
    _resetEdge();
    let n = 0;
    fake((m) => (m === 'judge' && n++ === 0 ? Promise.reject(new Error(reason)) : ok(m)));
    assert.equal(await edgeJudge('明天會下雨嗎'), null, reason);
    await new Promise((r) => setTimeout(r, 0)); // inflight 收尾
    assert.equal(edgeTripped(), false, reason);
    assert.equal(edgeIssue(), reason, '試判斷看得到原因');
    assert.deepEqual(await edgeJudge('明天會下雨嗎'), { intent: 'weather', states: [], engine: 'gemini-nano' }, `${reason}：回來後照常`);
    assert.equal(edgeIssue(), null, '成功後清掉原因');
  }
});

test('write 遇到背景被擋、電量配額：用程式版並照實說原因，不跳斷路器', async () => {
  for (const reason of ['background', 'battery-quota']) {
    _resetEdge();
    fake((m) => (m === 'write' ? Promise.reject(new Error(reason)) : ok(m)));
    const r = await edgeWrite(DRAFT, { engine: 'gemini-nano' });
    assert.deepEqual([r.by, r.reason, r.text], ['program', reason, DRAFT.text]);
    assert.equal(edgeTripped(), false);
    assert.match(writeLine(r, null), reason === 'background' ? /App 在背景時系統不讓 AI 跑/ : /為了省電/);
    assert.match(writeLine(r, 'en'), reason === 'background' ? /background/ : /battery/);
  }
});

test('suggest 遇到背景被擋：這次改用規則，不停掉 suggest（下一次照常猜）', async () => {
  let n = 0;
  fake((m) => (m === 'suggest' && n++ === 0 ? Promise.reject(new Error('background')) : ok(m)));
  assert.equal(await edgeSuggest('現在：平日白天'), null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(edgeCanSuggest(), true, '沒有停掉 suggest');
  assert.deepEqual((await edgeSuggest('現在：平日白天'))?.asks?.length, 3);
});

test('App 不在前景（document hidden）：judge、write、suggest、prewarm 都不呼叫外掛，直接走伺服器／規則；回到前景照常', async () => {
  fake(ok);
  setVisible('hidden');
  assert.equal(edgeForeground(), false);
  assert.equal(edgeJudgeReady(), false);
  assert.equal(edgeCanSuggest(), false);
  assert.equal(await edgeJudge('明天會下雨嗎'), null);
  assert.equal(await edgeSuggest('現在：平日白天'), null);
  const w = await edgeWrite(DRAFT, { engine: 'gemini-nano' });
  assert.deepEqual([w.by, w.reason], ['program', 'hidden']);
  assert.deepEqual(calls, [], '一次都沒有呼叫外掛');
  assert.equal(edgeIssue(), 'hidden');
  assert.equal(edgeTripped(), false);
  setVisible('visible');
  assert.deepEqual(await edgeJudge('明天會下雨嗎'), { intent: 'weather', states: [], engine: 'gemini-nano' });
  assert.equal(edgeCanSuggest(), true);
});

test('試判斷：手機這次沒用上的原因照實說（App 不在前景、背景被擋、電量配額），中英文字典都有', async () => {
  const fakeAgent = () => async (_body, onEvent) => { onEvent({ type: 'status', mode: 'edge', lang: 'zh' }); onEvent({ type: 'trial', intent: 'weather', judge: { intent: 'weather', states: [], source: 'rules' }, slots: [], missing: [], sources: [] }); onEvent({ type: 'text', delta: '好' }); onEvent({ type: 'done' }); };
  for (const why of ['hidden', 'background', 'battery-quota']) {
    const rep = await runTrial('明天會下雨嗎', { device: { active: true, engine: 'gemini-nano', write: false }, judge: async () => null, judgeIssue: () => why, agent: fakeAgent(), write: async () => assert.fail(), suggest: async () => ({ source: 'rules', asks: [], guessed: [], checked: false }) });
    assert.equal(rep.sections.judge.why, why);
    for (const dict of [TRIAL_ZH, TRIAL_EN]) { assert.ok(dict[`trial.why.${why}`], why); assert.ok(dict[`rw.${why}`], why); }
  }
  const plain = await runTrial('明天會下雨嗎', { device: { active: true, engine: 'gemini-nano', write: false }, judge: async () => null, agent: fakeAgent(), write: async () => assert.fail(), suggest: async () => ({ source: 'rules', asks: [], guessed: [], checked: false }) });
  assert.equal(plain.sections.judge.why, 'failed', '沒有原因：照舊說 failed');
});

test('原生端：Android 30／27 不設 10 分鐘暫停、回 background／battery-quota；iOS 不在前景不呼叫、錯誤回 background', async () => {
  const java = await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url), 'utf8');
  assert.match(java, /ErrorCode\.BACKGROUND_USE_BLOCKED\) return "background"/);
  assert.match(java, /ErrorCode\.PER_APP_BATTERY_USE_QUOTA_EXCEEDED\) return "battery-quota"/);
  const errFn = java.slice(java.indexOf('private String errorCode('), java.indexOf('return "GenAiException:"'));
  assert.ok(errFn.indexOf('softReason(') < errFn.indexOf('pausedUntil ='), 'softReason 在設暫停之前就回傳');
  assert.equal((java.match(/rejectMessage\(code, "(?:judge|write) failed"\)/g) || []).length, 2, 'judge、write 都回可辨識的原因');
  assert.match(java, /call\.reject\(soft != null \? soft : "suggest failed"\)/);
  const swift = await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url), 'utf8');
  assert.equal((swift.match(/guard Self\.appActive\(\) else \{ call\.reject\("background"\); return \}/g) || []).length, 3, 'judge、write、suggest 不在前景都不呼叫');
  assert.equal((swift.match(/self\.softReason\(error\) \?\?/g) || []).length, 3);
});
