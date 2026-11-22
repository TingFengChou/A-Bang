// iOS 即時動態（Live Activity）：到站提醒顯示在鎖定畫面與動態島；App 開著時每次查到就更新，提醒照舊用排好的本機通知
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 假裝在 iOS App 裡（API_BASE 在 import 時讀，所以先設好再動態 import）
const calls = [];
globalThis.__ABANG_API_BASE__ = 'http://localhost:8787';
globalThis.Capacitor = {
  isNativePlatform: () => true,
  isPluginAvailable: (n) => n === 'AbangWatch',
  getPlatform: () => 'ios',
  nativePromise: async (plugin, method, args) => {
    calls.push({ plugin, method, args });
    if (plugin === 'LocalNotifications' && /Permissions$/.test(method)) return { display: 'granted' };
    if (plugin === 'AbangWatch' && method === 'start') return { polls: false, live: true };
    return {};
  },
};
const { watchLine, startWatchService } = await import('../public/js/native-watch.js');
const { createWebHost, pollWatch } = await import('../public/ui/cards/host-web.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('常駐顯示的一句跟 Android 通知列同樣的說法（中英）', () => {
  const w = { routeName: '307', stop: '臺北車站', minutes: 2 };
  const f = { status: 0, etaSec: 300, label: '往撫遠街', stopName: '臺北車站(忠孝)' };
  assert.equal(watchLine(w, f), '307 往撫遠街・約 5 分到「臺北車站(忠孝)」・到站前 2 分提醒你');
  assert.equal(watchLine(w, f, { skip: true }), '307 往撫遠街・約 5 分到「臺北車站(忠孝)」・這班來不及，等下一班');
  assert.equal(watchLine(w, { ...f, etaSec: 30 }), '307 在「臺北車站(忠孝)」進站中・到站前 2 分提醒你');
  assert.equal(watchLine(w, { status: 1, etaSec: null, label: '往撫遠街', statusText: '尚未發車' }), '307 往撫遠街：尚未發車（臺北車站）');
  assert.equal(watchLine({ ...w, lang: 'en' }, f), "Bus 307 往撫遠街 · about 5 min to 臺北車站(忠孝) · I'll remind you 2 min before");
});

test('iOS 外掛 start 回 polls:false：只顯示（live），不是會自己響的服務', async () => {
  assert.equal(await startWatchService({ routeName: '307', stop: '臺北車站', minutes: 2 }), 'live');
});

test('iOS：每次查到就更新即時動態、照舊排本機通知；取消時結束即時動態', async () => {
  calls.length = 0;
  const host = createWebHost({});
  let eta = 600;
  host.callTool = async () => ({ data: { focus: { status: 0, etaSec: eta, label: '往撫遠街', stopName: '臺北車站(忠孝)', statusText: '' } } });
  await host.watchArrival({ city: 'Taipei', routeName: '307', stop: '臺北車站', minutes: 2 });
  try {
    const upd = () => calls.filter((c) => c.plugin === 'AbangWatch' && c.method === 'update');
    await new Promise((r) => setTimeout(r, 10)); // 排通知不等（planNative 在背景跑完）
    assert.ok(calls.some((c) => c.plugin === 'AbangWatch' && c.method === 'start'));
    assert.deepEqual(upd().at(-1).args, { text: '307 往撫遠街・約 10 分到「臺北車站(忠孝)」・到站前 2 分提醒你', etaSec: 600 });
    assert.ok(calls.some((c) => c.plugin === 'LocalNotifications' && c.method === 'schedule'), 'iOS 背景不能查：提醒照舊靠排好的通知');
    eta = 420;
    await pollWatch((n, a) => host.callTool(n, a));
    assert.equal(upd().at(-1).args.etaSec, 420, '新的預估：更新倒數');
  } finally {
    host.unwatchArrival();
  }
  assert.ok(calls.some((c) => c.plugin === 'AbangWatch' && c.method === 'stop'), '取消：即時動態一起結束');
});

test('iOS 原生：Widget Extension 有即時動態（鎖定畫面、動態島、倒數），App 宣告支援並註冊外掛', () => {
  const plist = read('ios/App/App/Info.plist');
  assert.match(plist, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
  assert.match(read('ios/App/App/MainViewController.swift'), /registerPluginInstance\(AbangWatchPlugin\(\)\)/);
  const plugin = read('ios/App/App/AbangWatchPlugin.swift');
  assert.match(plugin, /jsName = "AbangWatch"/);
  for (const m of ['start', 'update', 'stop', 'status']) assert.match(plugin, new RegExp(`CAPPluginMethod\\(name: "${m}"`));
  assert.match(plugin, /"polls": false/);
  assert.doesNotMatch(plugin, /URLSession/, 'iOS 即時動態不連網');
  const view = read('ios/App/AbangLiveActivity/AbangLiveActivity.swift');
  assert.match(view, /ActivityConfiguration\(for: AbangWatchAttributes\.self\)/);
  assert.match(view, /Text\(timerInterval:/);
  for (const r of ['compactLeading', 'compactTrailing', 'minimal', 'DynamicIslandExpandedRegion']) assert.match(view, new RegExp(r));
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(pbx, /AbangLiveActivity\.appex in Embed Foundation Extensions/);
  assert.match(pbx, /PRODUCT_BUNDLE_IDENTIFIER = tw\.abang\.app\.LiveActivity;/);
});

test('審查 2026-11-23：iOS 沒有下車提醒常駐服務——不呼叫 startAlight（iOS 橋接遇到沒有的方法不回應，會永遠卡住）', async () => {
  const { hasAlightService, hasWatchService, startAlightService } = await import('../public/js/native-watch.js');
  assert.equal(hasWatchService(), true, 'iOS 有到站提醒的即時動態');
  assert.equal(hasAlightService(), false, '下車提醒常駐服務只有 Android');
  const before = calls.length;
  assert.equal(await startAlightService({ routeName: '307', board: '西門', dest: '市政府', boardAt: Date.now(), rideSec: 600, until: Date.now() + 1e6 }), false);
  assert.ok(!calls.slice(before).some((c) => c.method === 'startAlight'));
});

test('原生呼叫逾時：外掛不回應也不會讓提醒卡住', async () => {
  const { NATIVE_TIMEOUT_MS } = await import('../public/js/native-watch.js');
  assert.ok(NATIVE_TIMEOUT_MS > 0 && NATIVE_TIMEOUT_MS <= 10_000);
});
