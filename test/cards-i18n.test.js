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

// S12b 卡片英文：鍵與佔位符跟中文一樣；英文沒有的鍵退回中文；withLocale 只在同步範圍內有效
test('英文字典：鍵相同、佔位符相同、不含中文', async () => {
  const en = await import('../public/ui/cards/i18n/en.js');
  assert.equal(en.LOCALE, 'en');
  const base = Object.keys(en.MESSAGES).filter((k) => !k.endsWith('.one'));
  assert.deepEqual(base.sort(), Object.keys(MESSAGES).sort());
  for (const k of Object.keys(en.MESSAGES).filter((x) => x.endsWith('.one'))) assert.ok(MESSAGES[k.slice(0, -4)], `${k} 沒有對應的鍵`); // 英文單數
  const ph = (v) => [...new Set(v.match(/\{\w+\}/g) || [])].sort();
  for (const [k, v] of Object.entries(MESSAGES)) {
    assert.deepEqual(ph(en.MESSAGES[k]), ph(v), k);
    assert.doesNotMatch(en.MESSAGES[k], /[一-鿿]/, k);
  }
});

test('i18n runtime：tFor、withLocale、退回中文', async () => {
  const { t: cur, tFor, withLocale, localeOf } = await import('../public/ui/cards/i18n/index.js');
  assert.equal(localeOf('fr'), 'zh-TW');
  assert.equal(tFor('zh-TW')('common.minutes', { n: 3 }), t('common.minutes', { n: 3 }));
  assert.notEqual(tFor('en')('common.minutes', { n: 3 }), t('common.minutes', { n: 3 }));
  assert.equal(withLocale('en', () => cur('common.demo')), tFor('en')('common.demo'));
  assert.equal(cur('common.demo'), t('common.demo'), '離開 withLocale 後還原中文');
  assert.equal(tFor('en')('no.such.key'), 'no.such.key');
  assert.equal(tFor('en')('youbike.rent', { n: 1 }), '1 bike');
  assert.equal(tFor('en')('youbike.rent', { n: 3 }), '3 bikes');
  assert.equal(tFor('zh-TW')('youbike.rent', { n: 1 }), t('youbike.rent', { n: 1 }), '中文沒有單複數');
});

test('卡片程式只用 ctx.t（不直接 import 字典，否則英文卡片會漏中文）', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../public/ui/cards/cards/', import.meta.url);
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.js')) continue;
    assert.doesNotMatch(await readFile(new URL(f, dir), 'utf8'), /from ['"]\.\.\/i18n\//, f);
  }
});
