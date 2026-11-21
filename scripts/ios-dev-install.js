#!/usr/bin/env node
// 把開發版裝到接在這台電腦上的實體 iPhone（不在 CI；對應 Android 的 gradlew installDebug）。
// iPhone 不能像 Android 用 adb reverse 連 localhost，所以打包時把 API 位址設成這台電腦在區域網路上的位址（同一個 Wi-Fi），
// 並且只在這次建置暫時加上「允許本機網路」的設定（NSAllowsLocalNetworking、NSLocalNetworkUsageDescription），建置完還原，不進版控。
// 先決條件：Xcode 已登入 Apple 帳號；iPhone 已配對、解鎖、開啟開發者模式；本機 npm start（8787）。
// 用法：IOS_DEV_TEAM=<Team ID> npm run ios:dev            （裝到第一支接上的 iPhone）
//       IOS_DEV_TEAM=… IOS_DEVICE=<UDID> ABANG_API_BASE=http://192.168.1.10:8787 npm run ios:dev
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opt });
const PLIST = root('ios/App/App/Info.plist');
const BUDDY = '/usr/libexec/PlistBuddy';

/** 這台電腦在區域網路上的 IPv4（第一個不是 127.x 的） */
export function lanAddress(ifs = networkInterfaces()) {
  for (const list of Object.values(ifs)) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

/** devicectl 的裝置清單裡第一支可用的實體 iPhone／iPad 的 UDID */
export function firstDevice(listing) {
  const row = String(listing).split('\n').find((l) => /available|connected/.test(l) && /physical/.test(l));
  return row?.match(/[0-9A-F]{8}-[0-9A-F]{16}|[0-9A-Fa-f-]{36}/)?.[0] || null;
}

function main() {
  const team = process.env.IOS_DEV_TEAM;
  if (!team) throw new Error('請設定 IOS_DEV_TEAM（Apple 開發團隊的 Team ID，在 Xcode → Settings → Accounts 可以看到）');
  const device = process.env.IOS_DEVICE || firstDevice(run('xcrun', ['devicectl', 'list', 'devices']));
  if (!device) throw new Error('找不到接上的 iPhone（要配對、解鎖、開啟開發者模式）');
  const ip = lanAddress();
  const base = process.env.ABANG_API_BASE || (ip && `http://${ip}:8787`);
  if (!base) throw new Error('找不到這台電腦的區域網路位址；請用 ABANG_API_BASE 指定');
  console.log(`裝置 ${device}；App 連 ${base}（iPhone 要和這台電腦在同一個 Wi-Fi）`);

  run('node', [root('scripts/build-app.js')], { env: { ...process.env, ABANG_API_BASE: base } });
  run('npx', ['cap', 'sync', 'ios'], { cwd: root('.') });

  const original = readFileSync(PLIST, 'utf8');
  const dd = process.env.IOS_DERIVED_DATA || `${tmpdir()}/abang-ios-dev`;
  try {
    for (const c of ['Add :NSAppTransportSecurity dict', 'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true', 'Add :NSLocalNetworkUsageDescription string 開發版：連到同一個 Wi-Fi 上的開發伺服器。']) {
      try { run(BUDDY, ['-c', c, PLIST]); } catch { /* 已經有了 */ }
    }
    console.log('建置中（幾分鐘）…');
    run('xcodebuild', ['-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', `id=${device}`, '-derivedDataPath', dd, '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${team}`, 'CODE_SIGN_STYLE=Automatic', 'build'], { cwd: root('ios/App') });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const errs = out.split('\n').filter((l) => /error:/.test(l)).slice(0, 5).join('\n');
    throw new Error(`建置失敗：\n${errs || e.message}`, { cause: e });
  } finally {
    writeFileSync(PLIST, original); // 還原：本機網路設定只給這次的開發版
  }
  const app = `${dd}/Build/Products/Debug-iphoneos/App.app`;
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device, app]);
  run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', device, 'tw.abang.app']);
  console.log('已安裝並啟動。第一次開會問「要尋找並連接本機網路上的裝置嗎」，請按允許。');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
