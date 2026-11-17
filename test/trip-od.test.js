// 行程規劃固定 OD（M3-11）：示範模式＋固定時間，斷言第一名、排除與理由句關鍵字。
// 權重（core/decide.js）改變時這裡的結果會變：屬產品決策，改權重要同步更新本檔與 ADR-0010。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip } from '../core/services/trip.js';
import { resolvePoint } from '../core/services/places.js';
import { createServices } from '../core/index.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00'); // 週三

/** [名稱, 起點, 終點, 出發, 示範情境, prefs, 期望 { best（role）, excluded?（role）, reason: RegExp[] }] */
const CASES = [
  ['市區短程（無狀態）', '台北車站', '台北101', '09:00', {}, {}, { best: 'ridehail', roles: ['bike', 'bus', 'ridehail', 'walk'], reason: [/比公車 \S+快 \d+ 分/] }],
  ['市區短程＋下雨（自動）', '台北車站', '台北101', '09:00', { weather: 'rain' }, {}, { best: 'ridehail', auto: ['rain'], reason: [/因為正在下雨/], last: 'walk' }],
  ['市區短程＋想省錢', '台北車站', '台北101', '09:00', {}, { states: ['budget'] }, { best: 'bus', reason: [/因為你想省錢/], last: 'ridehail' }],
  ['市區短程＋帶行李＋少走路', '台北車站', '台北101', '09:00', {}, { states: ['luggage', 'lessWalk'] }, { best: 'ridehail', reason: [/你帶著行李/, /比較輕鬆/], last: 'walk' }],
  ['很近（約 1.5 公里）', '台北車站', '西門町', '09:00', {}, {}, { best: 'ridehail', roles: ['bike', 'bus', 'ridehail', 'walk'], reason: [/^選「叫車/] }],
  ['台中市區＋下雨', '台中車站', '逢甲夜市', '18:00', { weather: 'rain' }, {}, { best: 'ridehail', auto: ['rain'], reason: [/正在下雨/, /比較不會淋雨|只走 0 分/], notFirst: ['bike', 'walk'] }],
  ['跨城（無狀態）', '台北車站', '高雄車站', '09:00', {}, {}, { best: 'tra', roles: ['intercity', 'ridehail', 'thsr', 'tra'], reason: [/省 \d+ 元/] }],
  ['跨城＋塞車（自動）', '台北車站', '高雄車站', '09:00', { traffic: 'jam' }, {}, { best: 'tra', auto: ['traffic'], reason: [/因為路上正在塞車/], last: 'ridehail' }],
  ['跨城＋趕時間＋12:00 前到', '台北車站', '高雄車站', '09:00', {}, { states: ['rush'], arriveBy: '12:00' }, { best: 'thsr', excluded: ['intercity', 'ridehail'], reason: [/你趕時間/, /比台鐵\S+快 \d+ 分/, /會遲到已排除/] }],
  ['中程（新竹）＋想省錢', '台北車站', '新竹車站', '09:00', {}, { states: ['budget'] }, { best: 'intercity', reason: [/你想省錢/, /省 \d+ 元/], last: 'ridehail' }],
];

for (const [name, f, t, departAt, demo, prefs, want] of CASES) {
  test(`OD：${name}`, async () => {
    const svc = createServices({ forceMock: true, demo });
    const [from, to] = await Promise.all([resolvePoint(svc.places, f), resolvePoint(svc.places, t)]);
    const r = await planTrip(svc, { from, to, departAt, prefs, now: NOW });
    const role = (id) => r.options.find((o) => o.id === id)?.role;
    assert.equal(role(r.best), want.best, r.ranking.reason);
    if (want.roles) assert.deepEqual(r.options.map((o) => o.role).sort(), want.roles);
    if (want.auto) assert.deepEqual(r.states.filter((s) => s.source === 'auto').map((s) => s.key), want.auto);
    assert.deepEqual(r.ranking.excluded.map((e) => role(e.id)).sort(), want.excluded || []);
    if (want.last) assert.equal(role(r.ranking.ranked.at(-1).id), want.last);
    for (const nf of want.notFirst || []) assert.notEqual(role(r.ranking.ranked[0].id), nf);
    for (const re of want.reason) assert.match(r.ranking.reason, re);
    // 分數由高到低、每個方案都有抵達時間與分段
    assert.ok(r.ranking.ranked.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
    assert.ok(r.options.every((o) => /^\d{2}:\d{2}$/.test(o.arriveAt) && o.legs.length > 0));
  });
}
