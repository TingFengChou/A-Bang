// Siri、捷徑、Spotlight 交給 App 的事（M16-02，ADR-0021 第 1 階段）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { intentHash, startAppIntents, INTENT_PAGES } from '../public/js/app-intents.js';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('交來的事 → App 內頁面：問阿幫、查詐騙帶到防詐、只開列出來的頁面', () => {
  assert.equal(intentHash({ kind: 'ask', text: '台北101附近有 YouBike 嗎' }), `#/agent?q=${encodeURIComponent('台北101附近有 YouBike 嗎')}`);
  assert.equal(intentHash({ kind: 'scam', text: '點擊 http://bit.ly/x' }), `#/agent/antifraud?q=${encodeURIComponent('點擊 http://bit.ly/x')}`);
  assert.equal(intentHash({ kind: 'page', text: 'weather' }), '#/s/weather');
  assert.equal(intentHash({ kind: 'page', text: 'settings' }), null, '沒列的頁面不開');
  assert.equal(intentHash({ kind: 'page', text: 'toString' }), null);
  assert.equal(intentHash({ kind: 'open', text: '#/x' }), null, '不認得的種類');
  assert.equal(intentHash({ kind: 'ask', text: '  ' }), null);
  assert.equal(intentHash(null), null);
  assert.equal(decodeURIComponent(intentHash({ kind: 'ask', text: `a‮b\nc` }).split('q=')[1]), 'a b c', '控制與雙向字元拿掉');
  assert.equal([...decodeURIComponent(intentHash({ kind: 'ask', text: '問'.repeat(900) }).split('q=')[1])].length, 500, '問題最多 500 字');
  for (const h of Object.values(INTENT_PAGES)) assert.match(h, /^#\/[a-z/]+$/);
});

test('只有 iOS App 才接；拿到就開頁面；舊版 App 沒有方法時不出錯', async () => {
  const calls = [];
  const fake = (platform, result, { fail = false } = {}) => ({
    isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => true,
    nativePromise: async (p, m) => { calls.push(`${p}.${m}`); if (fail) throw Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }); return result; },
    addListener: () => {},
  });
  const went = [];
  const doc = { addEventListener: () => {}, visibilityState: 'visible' };
  assert.equal(await startAppIntents({ c: fake('android', { kind: 'ask', text: 'x' }), go: (h) => went.push(h), doc }), null);
  assert.equal(calls.length, 0, 'Android 不問');
  assert.equal(await startAppIntents({ c: null, go: (h) => went.push(h), doc }), null, '網頁');
  assert.equal(await startAppIntents({ c: fake('ios', { kind: 'page', text: 'reminders' }), go: (h) => went.push(h), doc }), '#/reminders');
  assert.deepEqual(went, ['#/reminders']);
  assert.equal(await startAppIntents({ c: fake('ios', {}), go: (h) => went.push(h), doc }), null, '沒有交來的事');
  assert.equal(await startAppIntents({ c: fake('ios', null, { fail: true }), go: (h) => went.push(h), doc }), null, '舊版 App');
  assert.deepEqual(went, ['#/reminders']);
});

test('原生端：三個 Intent、捷徑說法、收件匣、外掛方法、Xcode 專案與繁體中文', async () => {
  const swift = await read('ios/App/App/AbangIntents.swift');
  for (const n of ['AskAbangIntent', 'CheckScamIntent', 'OpenAbangPageIntent', 'AbangShortcuts']) assert.match(swift, new RegExp(`struct ${n}`));
  assert.match(swift, /"問\\\(\.applicationName\)"/);
  assert.match(swift, /openAppWhenRun: Bool = true/);
  assert.doesNotMatch(swift, /URLSession|http/, '原生端不打 API：交給 App 照原本流程查');
  const cases = /enum AbangPage: String, AppEnum \{\s*case ([^\n]+)/.exec(swift)[1].split(',').map((x) => x.trim());
  assert.deepEqual(cases.sort(), Object.keys(INTENT_PAGES).sort(), 'Swift 的頁面與前端一致');
  const plugin = await read('ios/App/App/AbangSystemPlugin.swift');
  assert.match(plugin, /CAPPluginMethod\(name: "takeIntent"/);
  assert.match(plugin, /notifyListeners\("intent"/);
  const pbx = await read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /AbangIntents\.swift in Sources \*\/,/);
  assert.match(pbx, /developmentRegion = "zh-Hant";/);
  assert.match(await read('ios/App/App/Info.plist'), /<key>CFBundleDevelopmentRegion<\/key>\s*<string>zh-Hant<\/string>/);
  assert.match(await read('public/js/app.js'), /startAppIntents\(\)/);
  assert.match(await read('ios/App/App/Info.plist'), /<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>zh-Hant<\/string>\s*<string>en<\/string>/, '英文手機的系統畫面仍是英文');
  assert.equal([...decodeURIComponent(intentHash({ kind: 'scam', text: '詐'.repeat(900) }).split('q=')[1])].length, 500, '與問阿幫一輪的上限相同');
});
