// 預設地區（T-HOMEAREA，2026-11-28 Claude 與 Antigravity 第八輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, areasOf } from '../core/services/govoffice.js';
import { deviceLocation, withHomeArea, MY_LOCATION, runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';

test('戶政事務所名稱 → 縣市＋區（各種寫法）；六都在最前面', () => {
  assert.deepEqual(areaOf('臺北市大安區戶政事務所'), { county: '臺北市', town: '大安區' });
  assert.deepEqual(areaOf('新北市板橋戶政事務所'), { county: '新北市', town: '板橋區' }, '直轄市沒寫「區」補上');
  assert.deepEqual(areaOf('基隆市七堵戶政事務所暖暖辦公室'), { county: '基隆市', town: '暖暖區' }, '辦公室服務的區');
  assert.deepEqual(areaOf('新北市新店戶政事務所深坑區所'), { county: '新北市', town: '深坑區' });
  assert.deepEqual(areaOf('臺南市府東戶政事務所東區辦公處'), { county: '臺南市', town: '東區' });
  assert.deepEqual(areaOf('高雄市前鎮戶政事務所'), { county: '高雄市', town: '前鎮區' }, '「前鎮」結尾是鎮也要補區');
  assert.deepEqual(areaOf('屏東縣潮州戶政事務所'), { county: '屏東縣', town: '潮州' }, '縣的鄉鎮照名稱');
  assert.equal(areaOf('某某機關'), null);
  const a = areasOf([
    { name: '屏東縣潮州戶政事務所', lat: 22.55, lon: 120.54 },
    { name: '臺北市大安區戶政事務所', lat: 25.02662, lon: 121.53451 },
    { name: '臺北市大安區戶政事務所第二辦公室', lat: 25.0, lon: 121.5 },
    { name: '高雄市苓雅區戶政事務所', lat: 22.62, lon: 120.31 },
  ]);
  assert.deepEqual(a.map((c) => c.county), ['臺北市', '高雄市', '屏東縣']);
  assert.deepEqual(a[0].towns, [{ town: '大安區', lat: 25.0266, lon: 121.5345 }], '同一區只留第一個、座標 4 位小數');
});

test('手機送預設地區：伺服器叫它「預設地區（X）」，不說成您的位置；回答第一句說清楚、可在設定調整', () => {
  const req = (result) => ({ clientToolResults: [{ id: 'loc1', ok: true, result }] });
  assert.deepEqual(deviceLocation(req({ lat: 25.0266, lon: 121.5345, area: '臺北市大安區' })), { name: '預設地區（臺北市大安區）', lat: 25.0266, lon: 121.5345, area: '臺北市大安區' });
  assert.equal(deviceLocation(req({ lat: 25.03, lon: 121.56 })).name, MY_LOCATION);
  assert.equal(deviceLocation(req({ lat: 25.03, lon: 121.56, area: '<b>x</b>' })).name, MY_LOCATION, '只收中文區名');
  assert.equal(withHomeArea('選「捷運」。', '臺北市大安區'), '未取得目前位置，先依您設定的預設地區（臺北市大安區）查詢；隨時可在設定調整。選「捷運」。');
  assert.equal(withHomeArea('（依您設定的預設地區推估在「臺北市大安區」）', '臺北市大安區'), '（依您設定的預設地區推估在「臺北市大安區」）', '已經說了就不重複');
  assert.equal(withHomeArea('選「捷運」。', undefined), '選「捷運」。');
});

test('規則模式：拒絕定位但有預設地區，行程從那一區出發、第一句說是預設地區', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '去台北101' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0266, lon: 121.5345, area: '臺北市大安區' } }] }, (e) => es.push(e), { now: Date.parse('2026-11-28T10:00:00+08:00') });
  const trip = es.find((e) => e.type === 'tool_result' && (e.tool || e.name) === 'plan_trip');
  assert.equal(trip?.data?.from?.name, '預設地區（臺北市大安區）');
  assert.match(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /^未取得目前位置，先依[你您]設定的預設地區（臺北市大安區）查詢/);
});
