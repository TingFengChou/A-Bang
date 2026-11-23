// T8c iOS 模擬器煙霧測試的 Web Inspector 用戶端：二進位 plist 編解碼、訊息切分、console 錯誤文字（純函式，不需要模擬器）
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBplist, decodeBplist, splitFrames, frame, consoleText } from '../scripts/webinspector.js';

// macOS plutil -convert binary1 產生的 webinspectord 訊息（含中文、整數、負數、浮點、布林、data、巢狀）
const APPLE = 'YnBsaXN0MDDSAQIDGlpfX2FyZ3VtZW50Wl9fc2VsZWN0b3LUBAUGBwgJDg9fEBtXSVJBcHBsaWNhdGlvbklkZW50aWZpZXJLZXlUbGlzdF8QEVdJUk1lc3NhZ2VEYXRhS2V5XVdJUkxpc3RpbmdLZXlZUElEOjE0MDU3pAoLDA0T//////////0SAAERcCM/+AAAAAAAAAhIeyJpZCI6MX3REBFRMdQSExQVFhcYGVtXSVJUaXRsZUtleVlXSVJVUkxLZXlfEBRXSVJQYWdlSWRlbnRpZmllcktleVJva2iWP15rACAAQQBiAGEAbgBnXxBQY2FwYWNpdG9yOi8vbG9jYWxob3N0LyMvYnVzL1RhaXBlaS8zMDc/c3RvcD0lRTYlOTUlQTYlRTUlOEMlOTYlRTUlQjglODIlRTUlQTAlQjQQAQlfEBxfcnBjX2FwcGxpY2F0aW9uU2VudExpc3Rpbmc6AAgADQAYACMALABKAE8AYwBxAHsAgACJAI4AlwCYAKEApACmAK8AuwDFANwA3wDwAUMBRQFGAAAAAAAAAgEAAAAAAAAAGwAAAAAAAAAAAAAAAAAAAWU=';

test('解得開 Apple 產生的二進位 plist', () => {
  const m = decodeBplist(Buffer.from(APPLE, 'base64'));
  assert.equal(m.__selector, '_rpc_applicationSentListing:');
  const a = m.__argument;
  assert.equal(a.WIRApplicationIdentifierKey, 'PID:14057');
  assert.deepEqual(a.list, [-3, 70000, 1.5, false]);
  assert.equal(a.WIRMessageDataKey.toString('utf8'), '{"id":1}');
  const page = a.WIRListingKey['1'];
  assert.equal(page.WIRTitleKey, '阿幫 Abang');
  assert.equal(page.WIRPageIdentifierKey, 1);
  assert.equal(page.ok, true);
  assert.match(page.WIRURLKey, /^capacitor:\/\/localhost\/#\/bus\/Taipei\/307\?stop=/); // 超過 14 個字元的長度標記
});

test('編碼後解回來一樣（多物件、長字串、中文、data、null）', () => {
  const msg = {
    __selector: '_rpc_forwardSocketData:',
    __argument: {
      WIRConnectionIdentifierKey: 'ABCDEF01-2345-6789-ABCD-EF0123456789',
      WIRSocketDataKey: Buffer.from(JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: "location.hash = '#/bus/Taipei/307?stop=敦化市場'" } }), 'utf8'),
      WIRAutomaticallyPause: false,
      n: 1234567890123, neg: -1, f: 0.25, none: null, title: '台灣藍鵲',
      list: Array.from({ length: 300 }, (_, i) => `站${i}`), // 物件超過 255 個：參照要 2 位元組
    },
  };
  const back = decodeBplist(encodeBplist(msg));
  assert.deepEqual({ ...back.__argument, WIRSocketDataKey: undefined }, { ...msg.__argument, WIRSocketDataKey: undefined });
  assert.equal(back.__selector, msg.__selector);
  assert.equal(back.__argument.WIRSocketDataKey.toString('utf8'), msg.__argument.WIRSocketDataKey.toString('utf8'));
});

test('訊息切分：分段收到、一次收到兩則', () => {
  const a = frame({ __selector: 'a' }), b = frame({ __selector: 'b', __argument: { x: 1 } });
  const all = Buffer.concat([a, b]);
  let [msgs, rest] = splitFrames(all.subarray(0, a.length + 3));
  assert.deepEqual(msgs, [{ __selector: 'a' }]);
  assert.equal(rest.length, 3);
  [msgs, rest] = splitFrames(Buffer.concat([rest, all.subarray(a.length + 3)]));
  assert.deepEqual(msgs, [{ __selector: 'b', __argument: { x: 1 } }]);
  assert.equal(rest.length, 0);
});

test('不是 plist 就說清楚', () => {
  assert.throws(() => decodeBplist(Buffer.from('<?xml version="1.0"?>')), /不是二進位 plist/);
});

test('console 錯誤文字：展開物件參數、附來源', () => {
  assert.equal(consoleText({ text: 'boom' }), 'boom');
  assert.equal(consoleText({ text: '[object Object]', parameters: [{ value: '{"message":"background"}' }], url: 'user-script:2', line: 326 }), '{"message":"background"}（user-script:2:326）');
  assert.equal(consoleText({ text: '[object Object]', parameters: [{ type: 'object', preview: { properties: [{ name: 'message', value: 'busy' }] } }] }), '{ message: busy }');
  assert.equal(consoleText({ text: 'TypeError: x', url: 'capacitor://localhost/js/app.js', line: 9 }), 'TypeError: x（/js/app.js:9）');
});
