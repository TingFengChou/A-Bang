// 常用地點（S1）：手機端「提到才送」的說法與伺服器的判斷一致、範圍外資料不送（不讓整個請求 400）
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { WORDS, SAVED_KEYS, savePlace, loadPlaces, placesFor } = await import('../public/js/saved-places.js');
const { SAVED_WORDS, savedTrip } = await import('../core/agent/demo-intent.js');

test('手機端與伺服器的常用地點說法相同', () => {
  assert.deepEqual(Object.keys(WORDS), SAVED_KEYS);
  for (const k of SAVED_KEYS) assert.equal(WORDS[k].source, SAVED_WORDS[k].source, k);
});

test('伺服器會用到的地點，手機端一定有送', () => {
  const saved = { 家: { lat: 25.01, lon: 121.46, name: '家' }, 公司: { lat: 25.04, lon: 121.56, name: '公司' }, 學校: { lat: 25.02, lon: 121.54, name: '學校' } };
  for (const [k, p] of Object.entries(saved)) savePlace(k, p);
  for (const s of ['回家', '從公司回家', '我要回去家', '上學', '下班回家', '去學校接小孩']) {
    const it = savedTrip(s, [], saved);
    const sent = placesFor([s]) || {};
    for (const p of [it?.fromSaved, it?.toSaved].filter(Boolean)) assert.ok(sent[p.name], `${s}：${p.name}`);
  }
  assert.equal(placesFor(['台北101怎麼去']), undefined, '沒提到就不送');
});

test('台灣範圍外的不存、舊資料不送', () => {
  assert.equal(savePlace('家', { lat: 37.33, lon: -122.03 }), false, '模擬器預設在美國');
  store.set('abang.places', JSON.stringify({ 家: { lat: 37.33, lon: -122.03, name: '家' }, 宿舍: { lat: 25, lon: 121.5 } }));
  assert.deepEqual(loadPlaces(), {});
  assert.equal(placesFor(['回家']), undefined);
});
