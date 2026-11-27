// 藥局、診所共用的純函式（架構審查 2026-11-28）：時段邊界（伺服器與卡片同一份）、同名區跨縣市、藥局不提早停
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodAt, weekSlots, dayPeriods, normAddr, twDow, twYmd, cityOf, pickCity } from '../core/nhi-hours.js';
import { periodNow } from '../public/ui/cards/cards/pharmacy.js';
import { pharmacySearch } from '../core/services/life.js';

const at = (hm) => Date.parse(`2026-11-27T${hm}:00+08:00`);

test('時段邊界：8:00、12:00、18:00、22:00；卡片與伺服器同一份', () => {
  for (const [hm, want] of [['07:59', null], ['08:00', '上午'], ['11:59', '上午'], ['12:00', '下午'], ['17:59', '下午'], ['18:00', '晚上'], ['21:59', '晚上'], ['22:00', null]]) {
    assert.equal(periodAt(at(hm)), want, hm);
    assert.equal(periodNow(at(hm)), want, `卡片 ${hm}`);
  }
});

test('時段解析、地址正規化、台灣日期與星期', () => {
  assert.deepEqual(dayPeriods('星期五上午看診、星期五下午休診、星期五晚上看診', 5), ['上午', '晚上']);
  assert.equal(dayPeriods('', 5), null);
  assert.equal(weekSlots('星期日上午看診')[0][0], true);
  assert.equal(normAddr('台中市 １０號'), '臺中市10號');
  assert.equal(twDow(Date.parse('2026-11-27T23:30:00+08:00')), 5);
  assert.equal(twYmd(Date.parse('2026-11-27T23:30:00+08:00')), '20261127');
  assert.equal(twYmd(Date.parse('2026-11-27T16:30:00Z')), '20261128', 'UTC 16:30 已經是台灣隔天');
  assert.equal(cityOf('基隆市中正區義一路'), '基隆市');
});

test('同名區：只列一個縣市、說還有哪些；有優先縣市就用它；說了縣市不處理', () => {
  const list = [{ address: '臺北市中正區A' }, { address: '基隆市中正區B' }, { address: '臺北市中正區C' }];
  assert.deepEqual(pickCity(list, '中正區'), { list: [list[0], list[2]], city: '臺北市', otherCities: ['基隆市'] });
  assert.equal(pickCity(list, '中正區', '基隆市').city, '基隆市');
  assert.equal(pickCity(list, '臺北市中正區').list.length, 3);
});

test('藥局不提早停：前面 70 家臺北市中正區，後面的基隆市也看得到', () => {
  const row = (city, i) => ({ 醫事機構代碼: `${i}`, 醫事機構名稱: `藥局${i}`, 地址: `${city}中正區路${i}號`, 固定看診時段: '', 終止合約或歇業日期: '' });
  const rows = [...Array.from({ length: 70 }, (_, i) => row('臺北市', i)), row('基隆市', 99)];
  const d = pharmacySearch(rows, { area: '中正區', now: at('10:00') });
  assert.equal(d.city, '臺北市');
  assert.deepEqual(d.otherCities, ['基隆市']);
  assert.equal(d.pharmacies.length, 20);
});
