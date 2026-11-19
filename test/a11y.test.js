// 無障礙（M6-04）：到站播報句、播報節流（第一次不念、相同不重念）、色彩對比 ≥ 4.5（WCAG AA）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { t } from '../public/ui/cards/i18n/zh-TW.js';
import busRoute from '../public/ui/cards/cards/bus-route.js';
import busStation from '../public/ui/cards/cards/bus-station.js';
import metro from '../public/ui/cards/cards/metro.js';
import { announcer } from '../public/js/pages/bus.js';

const stop = (seq, stopName, etaSec, statusText) => ({ seq, stopName, etaSec, status: 0, statusText });
const route = { routeName: '307', directions: [{ stops: [stop(1, '撫遠街', 90, '即將進站'), stop(2, '民權二段', 400, '7 分'), stop(3, '敦化市場', 60, '進站中')] }] };

test('卡片播報句：公車路線（點開的站優先、否則即將進站）、站牌、捷運', () => {
  assert.equal(busRoute.announce(route, { t, state: {} }), '307 即將進站：撫遠街、敦化市場');
  assert.equal(busRoute.announce(route, { t, state: { stop: 2 } }), '307「民權二段」：7 分');
  assert.equal(busRoute.announce({ routeName: '307', directions: [] }, { t, state: {} }), null);
  assert.equal(busStation.announce({ name: '臺北車站', arrivals: [{ routeName: '307', statusText: '3 分' }, { routeName: '藍15', statusText: '即將進站' }] }, { t }), '臺北車站：307 3 分；藍15 即將進站');
  assert.equal(busStation.announce({ arrivals: [] }, { t }), null);
  assert.equal(metro.announce({ trains: [{ line: '板南線', destination: '南港展覽館', status: '1 分' }] }, { t }), '板南線 往 南港展覽館 1 分');
});

test('PWA 播報：第一次載入不念、文字沒變不重念、空字串不清掉', () => {
  const el = { textContent: '' };
  const say = announcer(el);
  say('307 即將進站：撫遠街');
  assert.equal(el.textContent, '');
  say('307 即將進站：撫遠街');
  assert.equal(el.textContent, '');
  say('307 即將進站：敦化市場');
  assert.equal(el.textContent, '307 即將進站：敦化市場');
  say('');
  assert.equal(el.textContent, '307 即將進站：敦化市場');
});

function contrast(a, b) {
  const full = (h) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h);
  const lum = (h0) => {
    const h = full(h0);
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('色彩對比：文字色在底色上 ≥ 4.5（淺色與深色主題）', async () => {
  const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/(--bg:[^}]*)/g)].map((m) => Object.fromEntries([...m[1].matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map((x) => [x[1], x[2]])));
  assert.ok(blocks.length >= 2, '淺色與深色兩組變數');
  for (const v of blocks) {
    for (const fg of ['text', 'muted', 'off']) {
      for (const bg of ['bg', 'card']) assert.ok(contrast(v[fg], v[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(v[fg], v[bg]).toFixed(2)}`);
    }
    assert.ok(contrast(v.off, v['off-soft']) >= 4.5, `off on off-soft: ${contrast(v.off, v['off-soft']).toFixed(2)}`);
  }
  const cards = await readFile(new URL('../public/ui/cards/cards.css', import.meta.url), 'utf8');
  const cv = Object.fromEntries([...cards.matchAll(/--(ab-[a-z-]+):\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map((x) => [x[1], x[2]]));
  for (const fg of ['ab-text', 'ab-muted', 'ab-off', 'ab-brand', 'ab-ok', 'ab-warn', 'ab-bad']) assert.ok(contrast(cv[fg], cv['ab-bg']) >= 4.5, `${fg}: ${contrast(cv[fg], cv['ab-bg']).toFixed(2)}`);
});
