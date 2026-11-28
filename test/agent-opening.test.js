// 問阿幫的開場（Claude 與 Antigravity 第十四輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingModel, CAN_DO, iconOfQ } from '../public/js/agent/opening.js';
import { todayPlan } from '../public/js/today.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { answerable } from '../core/suggest.js';

const TUE_8 = Date.UTC(2026, 11, 1, 0);
const sunny = { tempC: 24, pop3h: 10, raining: false, rainMm1h: 0 };

test('開場接上今天卡：同一句話、同樣的提醒、今天卡的問題（設定頁那個不放）', () => {
  const plan = todayPlan({ now: TUE_8, day: { workday: true, known: true }, weather: { ...sunny, raining: true, pop3h: 80 }, places: { 家: {}, 公司: {} } });
  const m = openingModel({ plan });
  assert.equal(m.say, plan.say);
  assert.match(m.tips[0], /可能會下雨/);
  assert.deepEqual(m.asks.map((a) => a.q), ['去公司怎麼走最快？']);
  assert.equal(m.asks[0].label, '今天怎麼去公司');
  assert.equal(m.asks[0].primary, true);
  const light = openingModel({ plan: todayPlan({ now: TUE_8, weather: sunny }) });
  assert.ok(light.asks.every((a) => !a.q.includes('設定')), '「設家和公司」是設定頁，不當問題送');
});

test('還沒看完使用說明：一般的招呼，不硬塞今天的建議', () => {
  const m = openingModel({ plan: { show: false } });
  assert.match(m.say, /^嗨，我是阿幫/);
  assert.deepEqual([m.tips, m.asks], [[], []]);
});

test('問題最多 4 個、不重複；圖示看問的是什麼', () => {
  const plan = { show: true, say: 'x', tips: [], acts: [{ label: 'A', href: '#/agent?q=%E5%9B%9E%E5%AE%B6%E6%80%8E%E9%BA%BC%E8%B5%B0%EF%BC%9F', primary: true }] };
  const m = openingModel({ plan, asks: [{ q: '回家怎麼走？', ask: { intent: 'trip' } }, { q: '捷運幾點收班？', ask: { intent: 'metro' } }, { q: 'a' }, { q: 'b' }, { q: 'c' }] });
  assert.equal(m.asks.length, 4);
  assert.equal(new Set(m.asks.map((a) => a.q)).size, 4);
  assert.equal(m.asks[1].icon, 'metro');
  assert.deepEqual(['附近有開的診所嗎', '捷運幾點收班？', '今天出門要帶傘嗎？', '回家怎麼走？'].map(iconOfQ), ['pharmacy', 'metro', 'sun', 'route']);
});

test('「我可以幫你」的例句阿幫都查得到（防詐到防詐頁）', () => {
  for (const x of CAN_DO) {
    if (x.href) { assert.equal(x.href, '#/agent/antifraud'); continue; }
    const it = parseIntent(x.q);
    assert.ok(answerable(it) || it.intent === 'gov', `${x.q} → ${it.intent}`);
  }
});
