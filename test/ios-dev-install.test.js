// iPhone 開發版安裝腳本的純函式（實際安裝不在 CI）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddress, firstDevice, isLocked, healthKitUnsupported, NO_HEALTHKIT } from '../scripts/ios-dev-install.js';

test('lanAddress：取第一個不是內部的 IPv4', () => {
  assert.equal(lanAddress({ lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.1.20' }] }), '192.168.1.20');
  assert.equal(lanAddress({ lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }), null);
});

test('firstDevice：只挑接上的實體裝置，不挑模擬器', () => {
  const listing = `Name     Hostname   Identifier                                    State                Model          Reality
My Phone            00008150-0014391834E2401C (UDID)              available (paired)   iPhone 17 Pro   physical
iPhone 18 Pro       9ECECB57-E60B-42D8-8566-5BDEE87A65D5 (UDID)   connected            iPhone 18 Pro   simulated`;
  assert.equal(firstDevice(listing), '00008150-0014391834E2401C');
  assert.equal(firstDevice('iPhone 18 Pro   9ECECB57-E60B-42D8-8566-5BDEE87A65D5 (UDID)   connected   iPhone 18 Pro   simulated'), null);
});

test('isLocked：iPhone 鎖著時開不了 App，不算安裝失敗', () => {
  assert.ok(isLocked('NSLocalizedFailureReason = Unable to launch tw.abang.app because the device was not, or could not be, unlocked.\n BSErrorCodeDescription = Locked'));
  assert.ok(!isLocked('error: The application could not be found'));
});

test('healthKitUnsupported：個人開發團隊不能簽 HealthKit 時改用不含 entitlement 的建置（ADR-0018）', () => {
  assert.ok(healthKitUnsupported('error: Personal development teams, including "Austin Chou", do not support the HealthKit capability. (in target \'App\')'));
  assert.ok(healthKitUnsupported('error: Provisioning profile "iOS Team Provisioning Profile: tw.abang.app" doesn\'t include the com.apple.developer.healthkit entitlement.'));
  assert.ok(!healthKitUnsupported('error: No account for team "796XALWJ7W".'));
  assert.ok(!healthKitUnsupported('ProcessProductPackaging App.app.xcent\n    "com.apple.developer.healthkit" => 1\nerror: cannot find \'Foo\' in scope'), '只看錯誤行');
  assert.deepEqual(NO_HEALTHKIT, ['CODE_SIGN_ENTITLEMENTS=', 'ABANG_HEALTHKIT=NO']);
});
