// iPhone 開發版安裝腳本的純函式（實際安裝不在 CI）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lanAddress, firstDevice } from '../scripts/ios-dev-install.js';

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
