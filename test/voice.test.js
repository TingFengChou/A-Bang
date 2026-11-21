// 語音問阿幫（public/js/voice.js、voice-i18n.js）：狀態機、控制器（停頓自動結束、取消、錯誤、放開送出）、字典、外掛回報整理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceIdle, voiceStep, createVoice, normalizeVoiceInfo, voiceLang, downloadPack, VOICE_ERRORS, VOICE_ENGINES, VOICE_REASONS, SILENCE_MS, FINAL_WAIT_MS, DOWNLOAD_POLL_MS, DOWNLOAD_MAX_MS } from '../public/js/voice.js';
import { ZH, EN, voiceT, voiceText, needsSettings, whyText, downloadText } from '../public/js/voice-i18n.js';

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
  let s = run([{ type: 'start' }, { type: 'ready', onDevice: true, engine: 'ios-speech' }, { type: 'partial', text: '307 到哪了' }, { type: 'stop' }]);
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

test('狀態機：不認得的引擎不顯示（只有手機上／瀏覽器本機的引擎）', () => {
  assert.equal(run([{ type: 'start' }, { type: 'ready', engine: 'cloud-x' }]).engine, null);
  assert.ok(!VOICE_ENGINES.includes('android-system'), '不退回系統／雲端辨識');
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

test('外掛回報整理：只在手機上辨識才算能用；語言包可下載、下載中、不支援（反白）、網頁版不顯示', () => {
  assert.deepEqual(normalizeVoiceInfo({ available: true, onDevice: true, engine: 'android-ondevice', lang: 'zh-TW', permission: 'prompt', osVersion: '16', extra: 'x' }, 'native'),
    { state: 'ready', available: true, platform: 'native', onDevice: true, engine: 'android-ondevice', lang: 'zh-TW', permission: 'prompt', osVersion: '16' });
  assert.deepEqual(normalizeVoiceInfo({ available: true, onDevice: false, engine: 'android-ondevice' }, 'native').state, 'unsupported', '不在手機上就不能用（不退回系統辨識）');
  assert.equal(normalizeVoiceInfo({ available: false, reason: 'language-download', engine: 'android-ondevice', lang: 'zh-TW' }, 'native').state, 'download');
  assert.equal(normalizeVoiceInfo({ available: false, reason: 'downloading', progress: 42 }, 'native').progress, 42);
  assert.equal(normalizeVoiceInfo({ available: false, reason: 'downloading' }, 'native').state, 'downloading');
  for (const reason of ['os', 'no-ondevice', 'language', 'ios-no-ondevice']) assert.equal(normalizeVoiceInfo({ available: false, reason }, 'native').state, 'unsupported', reason);
  assert.equal(normalizeVoiceInfo({ available: false, reason: '???' }, 'native').reason, 'no-ondevice', '不認得的原因');
  assert.equal(normalizeVoiceInfo({ available: false, reason: 'no-plugin' }, 'native').state, 'none', '沒有外掛：不顯示');
  assert.equal(normalizeVoiceInfo({ available: true, onDevice: false, engine: 'web-ondevice' }, 'web').state, 'none', '網頁版不在本機就不顯示（沒有語言包可裝）');
  assert.deepEqual(normalizeVoiceInfo(null, 'web'), { state: 'none', available: false, platform: 'web', reason: 'web-unsupported' });
  assert.equal(normalizeVoiceInfo({ available: true, onDevice: true, engine: 'cloud', lang: '<b>', permission: 'maybe' }, 'native').engine, undefined);
  for (const r of VOICE_REASONS) assert.ok(r);
  assert.equal(voiceLang('en'), 'en-US');
  assert.equal(voiceLang(null), 'zh-TW');
});

test('語言包下載：有進度照進度、系統說好了再確認、Android 13 沒進度就每 3 秒再問；失敗、等太久', async () => {
  const flush = () => new Promise((r) => setImmediate(r));
  const mk = ({ fail = false } = {}) => {
    const timers = [];
    let emit = null;
    const states = [];
    const ups = [];
    const backend = { download: async (lang, on) => { emit = on; if (fail) throw new Error('x'); return { progress: true }; }, unsub: () => { backend.unsubbed = true; } };
    const t = { set: (f, ms) => { const h = { f, ms, on: true }; timers.push(h); return h; }, clear: (h) => { h.on = false; } };
    const fire = async (ms) => { for (const h of timers.filter((x) => x.on && x.ms === ms)) { h.on = false; await h.f(); } await flush(); };
    const stop = downloadPack({ backend, lang: 'zh-TW', timers: t, onUpdate: (u) => ups.push(u), check: async () => ({ state: states.shift() || 'downloading' }) });
    return { emit: (e) => emit(e), fire, ups, states, backend, stop };
  };
  const a = mk();
  await new Promise((r) => setImmediate(r));
  a.emit({ status: 'progress', percent: 41.6 });
  a.emit({ status: 'scheduled' });
  a.states.push('ready');
  a.emit({ status: 'done' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.ups.map((u) => u.status), ['start', 'progress', 'scheduled', 'done']);
  assert.equal(a.ups[1].percent, 42);
  assert.ok(a.backend.unsubbed, '結束時拿掉事件');
  const b = mk(); // 沒有進度事件：每 3 秒再問一次
  await new Promise((r) => setImmediate(r));
  await b.fire(DOWNLOAD_POLL_MS);
  assert.deepEqual(b.ups.map((u) => u.status), ['start'], '還在下載');
  b.states.push('ready');
  await b.fire(DOWNLOAD_POLL_MS);
  assert.deepEqual(b.ups.map((u) => u.status), ['start', 'done']);
  const c = mk({ fail: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(c.ups.map((u) => u.status), ['start', 'fail']);
  const d = mk();
  await new Promise((r) => setImmediate(r));
  await d.fire(DOWNLOAD_MAX_MS);
  assert.deepEqual(d.ups.map((u) => u.status), ['start', 'slow']);
  const e = mk();
  await new Promise((r) => setImmediate(r));
  e.emit({ status: 'error' });
  assert.deepEqual(e.ups.map((u) => u.status), ['start', 'fail']);
});

test('字典：中英鍵相同、每種錯誤都有說明；面板上的字', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  for (const k of VOICE_ERRORS) assert.ok(ZH[`err.${k}`] && EN[`err.${k}`], k);
  assert.deepEqual(VOICE_ENGINES, ['android-ondevice', 'ios-speech', 'web-ondevice']);
  assert.equal(voiceT(null)('announce.sent', { text: '天氣' }), '送出：天氣');
  assert.equal(voiceT('en')('nope'), 'nope', '缺鍵回傳鍵本身');
  const listen = run([{ type: 'start' }, { type: 'ready', onDevice: true }]);
  assert.deepEqual(voiceText(listen), { title: '在聽…', text: '請說，例如：去台北 101 怎麼走', heard: false, hint: '說完停一下就會送出', where: '在手機上轉成文字，語音不離開手機', announce: '開始聽了，請說。' });
  const heard = voiceStep(listen, { type: 'partial', text: '307' });
  assert.equal(voiceText(heard).text, '307');
  assert.equal(voiceText({ ...heard, hold: true }, 'en').hint, 'Let go to send');
  assert.equal(voiceText({ ...heard, onDevice: null }).where, '', '沒有「不是在手機上」的路徑');
  assert.ok(!Object.keys(ZH).includes('where.system'));
  assert.match(whyText({ state: 'unsupported', reason: 'os' }), /Android 12 以上/);
  assert.match(whyText({ state: 'unsupported', reason: 'ios-no-ondevice' }), /設定 → 一般 → 鍵盤.*啟用聽寫.*中文（台灣）/);
  assert.match(whyText({ state: 'unsupported', reason: 'language' }, 'en', 'en-US'), /English/);
  assert.equal(whyText({ state: 'download' }), '', '可下載不是不支援');
  assert.equal(downloadText({ status: 'progress', percent: 30 }), '正在下載中文語音包…30%');
  assert.equal(downloadText({ status: 'done' }, 'en'), 'The Chinese speech pack is ready. You can ask by voice now.');
  for (const k of ['os', 'no-ondevice', 'language', 'ios-no-ondevice']) assert.ok(ZH[`why.${k}`] && EN[`why.${k}`], k);
  for (const k of ['start', 'progress', 'scheduled', 'done', 'fail', 'slow']) assert.ok(ZH[`dl.${k}`] && EN[`dl.${k}`], k);
  assert.equal(voiceText(run([{ type: 'start' }, { type: 'error', code: 'permission' }])).announce, ZH['err.permission']);
  assert.ok(needsSettings('permission') && needsSettings('speech-permission') && !needsSettings('no-speech'));
});
