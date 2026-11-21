// S12g 公車頁英文：網址帶 lang=en 時阿幫自己寫的字用英文（字典、到站文字、方向、街景、下車提醒通知、導頁網址）；沒帶 lang 不變
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZH, EN, busT, pageLang } from '../public/js/pages/bus-i18n.js';
import { busLabels, busRoute } from '../public/js/pages/bus.js';
import { sceneSay } from '../public/ui/cards/bus-scene.js';
import { alightText } from '../public/js/alight.js';
import { tripOf } from '../public/js/trip-bar.js';
import { nextSteps } from '../public/js/agent/next-steps.js';

const HAN = /[一-鿿]/;
const ph = (v) => [...new Set(v.match(/\{\w+\}/g) || [])].sort();

test('公車頁字典：每個中文鍵都有英文、佔位符相同、英文不含中文', () => {
  const base = Object.keys(EN).filter((k) => !k.endsWith('.one'));
  assert.deepEqual(base.sort(), Object.keys(ZH).sort());
  for (const [k, v] of Object.entries(ZH)) {
    assert.ok(typeof EN[k] === 'string' && EN[k].trim(), k);
    assert.deepEqual(ph(EN[k]), ph(v), k);
    assert.doesNotMatch(EN[k], HAN, k);
  }
});

test('busT／pageLang：只認 lang=en；中文跟改版前一樣；缺鍵回傳鍵', () => {
  assert.equal(pageLang({ lang: 'en' }), 'en');
  assert.equal(pageLang({ lang: 'fr' }), null);
  assert.equal(pageLang({}), null);
  const zh = busT(null), en = busT('en');
  assert.equal(zh('title', { route: '307' }), '307 公車');
  assert.equal(zh('alertBtn', { n: 3 }), '到站前 3 分提醒我');
  assert.equal(zh('updated', { time: '14:05:00' }), '更新於 14:05:00・每 20 秒自動更新');
  assert.equal(en('title', { route: '307' }), 'Bus 307');
  assert.equal(en('alertBtn', { n: 3 }), 'Remind me 3 min before');
  assert.equal(en('focusAt', { stop: '敦化市場' }), 'At 敦化市場', '站名照原文');
  assert.equal(en('rideLeftMin', { n: 6, stop: '市府' }), '6 min to 市府');
  assert.equal(en('no.such'), 'no.such');
});

test('英文到站文字與方向：依狀態與秒數說英文；中文照資料', () => {
  const en = busLabels('en'), zh = busLabels(null);
  assert.equal(en.eta({ status: 0, etaSec: 400, statusText: '6 分' }), '6 min');
  assert.equal(en.eta({ status: 0, etaSec: 30, statusText: '進站中' }), 'Arriving');
  assert.equal(en.eta({ status: 0, etaSec: 120, statusText: '即將進站' }), 'Arriving soon');
  assert.equal(en.eta({ status: 1, etaSec: null, statusText: '尚未發車' }), 'Not departed yet');
  assert.equal(en.eta({ status: 3, etaSec: null, statusText: '末班車已過' }), 'Last bus has left');
  assert.equal(en.dir('往 松山機場'), 'To 松山機場');
  assert.equal(zh.eta({ status: 0, etaSec: 400, statusText: '6 分' }), '6 分');
  assert.equal(zh.dir('往 松山機場'), '往 松山機場');
});

test('街景說明：英文版；中文不變', () => {
  assert.deepEqual(sceneSay({ routeName: '307', away: 2, etaSec: 400, etaText: '6 min', lang: 'en' }), { head: '307 · 2 stops away', eta: '6 min', near: false });
  assert.equal(sceneSay({ routeName: '307', away: 1, etaSec: 200, etaText: '3 min', lang: 'en' }).head, '307 · 1 stop away');
  assert.equal(sceneSay({ routeName: '307', away: 0, etaSec: 30, etaText: 'Arriving', lang: 'en' }).head, '307 · at your stop');
  assert.equal(sceneSay({ routeName: '307', away: 0, etaSec: 30, etaText: 'Arriving', riding: true, lang: 'en' }).head, '307 · almost there, get ready to get off');
  assert.equal(sceneSay({ routeName: '307', away: 2, etaSec: 400, etaText: '6 分' }).head, '307・還有 2 站');
  assert.equal(sceneSay({ routeName: '307', away: 0, etaSec: 30, etaText: '進站中' }).head, '307・就在你這站');
});

test('下車提醒通知文字：英文頁設的用英文', () => {
  assert.equal(alightText('市府', 120, 'en'), 'About 2 min to 市府. Get ready to get off.');
  assert.equal(alightText('市府', 30, 'en'), 'Almost at 市府. Get ready to get off!');
  assert.equal(alightText('市府', 120), '約 2 分後到「市府」，準備下車');
});

test('導到公車頁的網址：英文帶 lang=en（接下來可以、進行中列）；中文不帶', () => {
  const results = [{ tool: 'bus_route_eta', data: { city: 'Taipei', routeName: '307', focus: { stopName: '敦化市場', direction: 0, status: 0, etaSec: 400 } } }];
  const en = nextSteps(results, null, { lang: 'en' });
  const nav = en.find((s) => s.kind === 'navigate');
  assert.match(nav.payload, /^#\/bus\/Taipei\/307\?stop=.+&dir=0&lang=en&alight=1$/);
  assert.equal(en.find((s) => s.kind === 'remind').payload.lang, 'en');
  const open = nextSteps(results, null, { lang: 'en', riding: { dest: 'x' } }).find((s) => s.kind === 'navigate');
  assert.equal(open.label, 'Open bus page');
  assert.match(open.payload, /&lang=en$/);
  assert.doesNotMatch(nextSteps(results, null).find((s) => s.kind === 'navigate').payload, /lang=/);
  assert.equal(nextSteps([{ tool: 'bus_route_eta', data: { city: 'Taipei', routeName: '307' } }], null, { lang: 'en' })[0].payload, '#/bus/Taipei/307?lang=en');
  const arrival = { city: 'Taipei', routeName: '307', stop: '敦化市場', direction: 0, minutes: 3 };
  assert.match(tripOf({ arrival: { ...arrival, lang: 'en' } }).href, /&lang=en$/);
  assert.doesNotMatch(tripOf({ arrival }).href, /lang=/);
  // 進行中列的文字也跟著提醒的語言（PR 審查）
  assert.equal(tripOf({ arrival: { ...arrival, lang: 'en' } }).text, '307 from 敦化市場 · reminder 3 min before');
  assert.equal(tripOf({ arrival }).text, '307 在「敦化市場」上車・到站前 3 分提醒你', '中文不變');
  assert.match(tripOf({ alight: { city: 'Taipei', routeName: '307', board: '敦化市場', dest: '市府', direction: 0, lang: 'en' } }).text, /^307 on board · (?:to|almost at|\d+ min to) 市府$/);
});

test('浮動阿幫在英文公車頁：建議問題用英文', () => {
  const h = busRoute.askHint({ params: ['Taipei', '307'], query: { stop: '敦化市場', lang: 'en' } });
  assert.deepEqual(h.chips, ["Where is bus 307? I'm at 敦化市場"]);
  assert.doesNotMatch(h.context.replace('敦化市場', ''), HAN);
  assert.deepEqual(busRoute.askHint({ params: ['Taipei', '307'], query: { stop: '敦化市場' } }).chips, ['307 到哪了？我在敦化市場'], '沒帶 lang 不變');
});
