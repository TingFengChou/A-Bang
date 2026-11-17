// 卡片文字字典（M4-03）：佔位符、缺鍵、用語（繁體、台灣用語）、不含簡體常見字
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, MESSAGES, LOCALE } from '../public/ui/cards/i18n/zh-TW.js';

test('t：帶入佔位符；缺值保留佔位符；缺鍵回傳鍵', () => {
  assert.equal(LOCALE, 'zh-TW');
  assert.equal(t('common.priceRange', { low: 220, high: 290 }), '220～290 元');
  assert.equal(t('metro.toward', {}), '往 {dest}');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('字典：每則都是非空字串，佔位符成對，用台灣繁體（不出現常見簡體字）', () => {
  const simplified = /[这为们车时间个对说发开关现与东网线点购费门]/;
  for (const [k, v] of Object.entries(MESSAGES)) {
    assert.ok(typeof v === 'string' && v.trim(), k);
    assert.equal((v.match(/\{/g) || []).length, (v.match(/\}/g) || []).length, k);
    assert.doesNotMatch(v, simplified, k);
  }
});

test('每種卡片與 L2 確認視窗都有標題或必要文字', () => {
  for (const k of ['busRoute.title', 'busStation.title', 'nearby.title', 'youbike.title', 'metro.title', 'timetable.title.THSR', 'timetable.title.TRA', 'timetable.title.BUS', 'trip.title', 'confirm.go', 'confirm.payNote', 'common.demo']) {
    assert.ok(MESSAGES[k], k);
  }
});
