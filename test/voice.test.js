// 語音問阿幫（public/js/voice.js、voice-i18n.js）：狀態機、控制器（停頓自動結束、取消、錯誤、放開送出）、字典、外掛回報整理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceIdle, voiceStep, createVoice, normalizeVoiceInfo, voiceLang, VOICE_ERRORS, VOICE_ENGINES, SILENCE_MS, FINAL_WAIT_MS } from '../public/js/voice.js';
import { ZH, EN, voiceT, voiceText, needsSettings } from '../public/js/voice-i18n.js';

const run = (events, s = voiceIdle()) => events.reduce(voiceStep, s);

test('狀態機：idle → starting → listening → partial → final（送出）', () => {
  let s = voiceStep(voiceIdle(), { type: 'start' });
  assert.equal(s.phase, 'starting');
  assert.equal(voiceStep(s, { type: 'partial', text: '早到' }).text, '', '還沒開始聽：部分結果不算');
  s = voiceStep(s, { type: 'ready', onDevice: true, engine: 'android-ondevice' });
  assert.deepEqual([s.phase, s.onDevice, s.engine], ['listening', true, 'android-ondevice']);
  s = run([{ type: 'level', level: 0.7 }, { type: 'partial', text: ' 從西門町 ' }, { type: 'partial', text: '' }], s);
  assert.equal(s.level, 0.7);
  assert.equal(s.text, '從西門町', '去頭尾空白；空的部分結果不蓋掉');
  assert.equal(voiceStep(s, { type: 'level', level: 9 }).level, 1, '音量限制在 0–1');
  s = voiceStep(s, { type: 'final', text: '從西門町到台北101怎麼去' });
  assert.equal(s.phase, 'sent');
  assert.equal(s.sent, '從西門町到台北101怎麼去');
});

test('狀態機：說完了（stop）→ finishing；最後一筆是空的就用聽到的；什麼都沒聽到是 no-speech', () => {
  let s = run([{ type: 'start' }, { type: 'ready', onDevice: false, engine: 'android-system' }, { type: 'partial', text: '307 到哪了' }, { type: 'stop' }]);
  assert.equal(s.phase, 'finishing');
  assert.equal(voiceStep(s, { type: 'level', level: 0.5 }).level, 0, '收尾時不再跟著音量');
  assert.equal(voiceStep(s, { type: 'final', text: '' }).sent, '307 到哪了');
  s = run([{ type: 'start' }, { type: 'ready' }, { type: 'stop' }, { type: 'final', text: '  ' }]);
  assert.deepEqual([s.phase, s.error], ['error', 'no-speech']);
});

test('狀態機：取消、錯誤、晚到的事件', () => {
  let s = run([{ type: 'start' }, { type: 'ready' }, { type: 'partial', text: '天氣' }, { type: 'cancel' }]);
  assert.deepEqual(s, voiceIdle());
  assert.deepEqual(voiceStep(s, { type: 'final', text: '天氣' }), voiceIdle(), '取消後晚到的最後結果不送出');
  s = run([{ type: 'start' }, { type: 'error', code: 'permission' }]);
  assert.deepEqual([s.phase, s.error], ['error', 'permission']);
  assert.equal(voiceStep(s, { type: 'start' }).phase, 'starting', '錯誤後可以再說一次');
  assert.equal(voiceStep(s, { type: 'reset' }).phase, 'idle');
  assert.equal(run([{ type: 'start' }, { type: 'error', code: '奇怪的' }]).error, 'service', '不認得的錯誤歸成 service');
  s = run([{ type: 'start' }, { type: 'ready' }, { type: 'partial', text: '藍15 還要多久' }, { type: 'error', code: 'no-match' }]);
  assert.equal(s.phase, 'sent', '已經聽到字才說沒聽清楚：送出聽到的');
  assert.equal(run([{ type: 'start' }, { type: 'ready' }, { type: 'partial', text: '啊' }, { type: 'error', code: 'audio' }]).phase, 'error', '其他錯誤照實說');
  assert.equal(voiceStep(run([{ type: 'start' }, { type: 'ready' }]), { type: 'start' }).phase, 'listening', '聽的時候再按開始不重來');
});

test('狀態機：長按中央鍵（hold）放開就收尾；還在開麥克風時放開改成停頓自動結束', () => {
  let s = run([{ type: 'start', hold: true }]);
  assert.equal(s.hold, true);
  s = voiceStep(s, { type: 'release' });
  assert.deepEqual([s.phase, s.hold], ['starting', false], '第一次跳權限框時已經放開');
  s = run([{ type: 'start', hold: true }, { type: 'ready' }, { type: 'partial', text: '去板橋' }, { type: 'release' }]);
  assert.equal(s.phase, 'finishing');
  assert.equal(voiceStep(s, { type: 'final', text: '去板橋車站' }).sent, '去板橋車站');
});

test('狀態機：Android 手機上的語言包不能用、改系統辨識（engine 事件）照實更新', () => {
  const s = run([{ type: 'start' }, { type: 'ready', onDevice: true, engine: 'android-ondevice' }, { type: 'engine', onDevice: false, engine: 'android-system' }]);
  assert.deepEqual([s.onDevice, s.engine], [false, 'android-system']);
  assert.equal(run([{ type: 'start' }, { type: 'ready', engine: 'cloud-x' }]).engine, null, '不認得的引擎不顯示');
});

/** 假的計時器與辨識來源 */
function harness({ startFails = null } = {}) {
  const timers = [];
  const calls = [];
  let emit = null;
  const backend = {
    kind: 'native',
    available: async () => ({ available: true }),
    start: async (lang, onEvent) => { calls.push(`start:${lang}`); emit = onEvent; if (startFails) throw Object.assign(new Error('x'), { code: startFails }); return { onDevice: true, engine: 'ios-speech' }; },
    stop: () => { calls.push('stop'); },
    cancel: () => { calls.push('cancel'); },
  };
  const t = {
    set: (f, ms) => { const h = { f, ms, on: true }; timers.push(h); return h; },
    clear: (h) => { h.on = false; },
  };
  const fire = (ms) => { for (const h of timers.filter((x) => x.on && x.ms === ms)) { h.on = false; h.f(); } };
  const sent = [];
  const changes = [];
  const v = createVoice({ backend, timers: t, lang: () => 'en-US', onSend: (x) => sent.push(x), onChange: (s) => changes.push(s.phase) });
  return { v, calls, sent, changes, fire, emit: (e) => emit(e), timers };
}

test('控制器：停頓 1.5 秒自動結束 → 等最後的文字 → 送出', async () => {
  const h = harness();
  await h.v.start();
  assert.deepEqual(h.calls, ['start:en-US']);
  assert.equal(h.v.state.phase, 'listening');
  assert.equal(h.timers.filter((x) => x.on && x.ms === SILENCE_MS).length, 0, '還沒聽到字不算停頓（交給 no-speech）');
  h.emit({ type: 'partial', text: 'how do I get to' });
  h.emit({ type: 'partial', text: 'how do I get to Taipei 101' });
  assert.equal(h.timers.filter((x) => x.on && x.ms === SILENCE_MS).length, 1, '有新字就重新計時');
  h.fire(SILENCE_MS);
  assert.deepEqual(h.calls, ['start:en-US', 'stop']);
  assert.equal(h.v.state.phase, 'finishing');
  h.emit({ type: 'final', text: 'How do I get to Taipei 101?' });
  assert.deepEqual(h.sent, ['How do I get to Taipei 101?']);
  assert.equal(h.v.state.phase, 'idle', '送出後回到沒在聽（畫面交給阿幫在想）');
  assert.ok(h.changes.includes('sent'));
});

test('控制器：說完了但最後的文字沒來（3 秒）→ 送出已經聽到的', async () => {
  const h = harness();
  await h.v.start();
  h.emit({ type: 'partial', text: '明天會下雨嗎' });
  h.v.stop();
  h.fire(FINAL_WAIT_MS);
  assert.deepEqual(h.sent, ['明天會下雨嗎']);
});

test('控制器：取消不送出、晚到的事件不算；長按放開才收尾（不看停頓）', async () => {
  const h = harness();
  await h.v.start();
  h.emit({ type: 'partial', text: '天氣' });
  h.v.cancel();
  assert.equal(h.v.state.phase, 'idle');
  assert.ok(h.calls.includes('cancel'));
  h.emit({ type: 'final', text: '天氣' });
  assert.deepEqual(h.sent, []);
  const g = harness();
  await g.v.start({ hold: true });
  g.emit({ type: 'partial', text: '去板橋' });
  assert.equal(g.timers.filter((x) => x.on && x.ms === SILENCE_MS).length, 0, '長按時不因停頓結束');
  g.v.release();
  assert.ok(g.calls.includes('stop'));
  g.emit({ type: 'final', text: '去板橋車站' });
  assert.deepEqual(g.sent, ['去板橋車站']);
});

test('控制器：權限被拒 → error permission（不送出）；一直沒聽到字 → no-speech', async () => {
  const h = harness({ startFails: 'permission' });
  await h.v.start();
  assert.deepEqual([h.v.state.phase, h.v.state.error], ['error', 'permission']);
  const g = harness();
  await g.v.start();
  g.fire(8000);
  assert.deepEqual([g.v.state.phase, g.v.state.error], ['error', 'no-speech']);
  assert.ok(g.calls.includes('cancel'));
});

test('外掛回報整理：只留認得的欄位；網頁版一定要在本機辨識才算能用', () => {
  assert.deepEqual(normalizeVoiceInfo({ available: true, onDevice: true, engine: 'android-ondevice', lang: 'zh-TW', permission: 'prompt', osVersion: '16', extra: 'x' }, 'native'),
    { available: true, platform: 'native', onDevice: true, engine: 'android-ondevice', lang: 'zh-TW', permission: 'prompt', osVersion: '16' });
  assert.deepEqual(normalizeVoiceInfo({ available: true, onDevice: false, engine: 'ios-speech' }, 'native'), { available: true, platform: 'native', onDevice: false, engine: 'ios-speech' }, 'App：可退回系統辨識（照實標示）');
  assert.equal(normalizeVoiceInfo({ available: true, onDevice: false, engine: 'web-ondevice' }, 'web').available, false, '網頁版不在本機就不用');
  assert.deepEqual(normalizeVoiceInfo(null, 'web'), { available: false, platform: 'web', reason: 'web-unsupported' });
  assert.equal(normalizeVoiceInfo({ available: true, engine: 'cloud', lang: '<b>', permission: 'maybe' }, 'native').engine, undefined);
  assert.equal(voiceLang('en'), 'en-US');
  assert.equal(voiceLang(null), 'zh-TW');
});

test('字典：中英鍵相同、每種錯誤都有說明；面板上的字', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  for (const k of VOICE_ERRORS) assert.ok(ZH[`err.${k}`] && EN[`err.${k}`], k);
  assert.ok(VOICE_ENGINES.length >= 4);
  assert.equal(voiceT(null)('announce.sent', { text: '天氣' }), '送出：天氣');
  assert.equal(voiceT('en')('nope'), 'nope', '缺鍵回傳鍵本身');
  const listen = run([{ type: 'start' }, { type: 'ready', onDevice: true }]);
  assert.deepEqual(voiceText(listen), { title: '在聽…', text: '請說，例如：去台北 101 怎麼走', heard: false, hint: '說完停一下就會送出', where: '在手機上轉成文字，語音不離開手機', announce: '開始聽了，請說。' });
  const heard = voiceStep(listen, { type: 'partial', text: '307' });
  assert.equal(voiceText(heard).text, '307');
  assert.equal(voiceText({ ...heard, hold: true }, 'en').hint, 'Let go to send');
  assert.match(voiceText({ ...heard, onDevice: false }).where, /系統的語音服務/);
  assert.equal(voiceText(run([{ type: 'start' }, { type: 'error', code: 'permission' }])).announce, ZH['err.permission']);
  assert.ok(needsSettings('permission') && needsSettings('speech-permission') && !needsSettings('no-speech'));
});
