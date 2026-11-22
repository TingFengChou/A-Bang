// 到站提醒常駐服務（Android 外掛 AbangWatch）：網頁與沒有外掛時不啟動，照原本方式提醒
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('網頁（沒有 Capacitor）：不用常駐服務，start 回 false、status 回 null', async () => {
  const m = await import('../public/js/native-watch.js');
  assert.equal(m.hasWatchService(), false);
  assert.equal(await m.startWatchService({ routeName: '307', stop: '臺北車站', minutes: 3 }), false);
  assert.equal(await m.watchServiceStatus(), null);
});

test('原生：服務是前景服務（dataSync）、常駐通知有「停止」、只送路線站名方向給阿幫伺服器', () => {
  const svc = readFileSync(new URL('../android/app/src/main/java/tw/abang/app/AbangWatchService.java', import.meta.url), 'utf8');
  const mf = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(mf, /AbangWatchService[^>]+foregroundServiceType="dataSync"/);
  assert.match(mf, /FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(svc, /setOngoing\(true\)/);
  assert.match(svc, /"停止"/);
  assert.match(svc, /\/api\/v1\/tools\/bus_route_eta/);
  assert.doesNotMatch(svc, /body.put("(lat|lon|near)"/, '不送位置');
  assert.match(readFileSync(new URL('../android/app/src/main/java/tw/abang/app/MainActivity.java', import.meta.url), 'utf8'), /registerPlugin\(AbangWatchPlugin\.class\)/);
});
