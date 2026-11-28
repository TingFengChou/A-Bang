// 設計第三輪 #1：決策圖重算後，同一輪的行程卡「建議」、總結、問題跟著換（public/js/agent/regraph.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regraphData, regraphNote, askSettledBy } from '../public/js/agent/regraph.js';

const data = { best: 'metro', options: [{ id: 'metro' }, { id: 'ridehail' }], ranking: { ranked: [{ id: 'metro' }, { id: 'ridehail' }], excluded: [], reason: '選捷運：省錢' }, states: [] };
const x = { changed: true, best: 'ridehail', bestName: '叫車', ranked: [{ id: 'ridehail' }, { id: 'metro' }], excluded: [], reason: '選叫車：帶行李不用轉乘', states: [{ key: 'luggage', source: 'picked' }], labels: ['帶行李'] };

test('regraphData：重算後行程卡的建議、排序、理由、狀況換成圖上的；沒改就還原伺服器的', () => {
  const d = regraphData(data, x);
  assert.equal(d.best, 'ridehail');
  assert.deepEqual(d.ranking.ranked.map((r) => r.id), ['ridehail', 'metro']);
  assert.equal(d.ranking.reason, '選叫車：帶行李不用轉乘');
  assert.deepEqual(d.states, [{ key: 'luggage', source: 'picked' }]);
  assert.equal(d.options, data.options, '方案本身不動');
  assert.equal(regraphData(data, { ...x, changed: false }), data, '切回原樣：用伺服器的');
  assert.equal(regraphData(data, { ...x, best: null }), data, '全部被排除：不動卡片');
});

test('regraphNote：推薦換了才補一句；換回原本的不說', () => {
  assert.equal(regraphNote(x, 'metro'), '依你選的「帶行李」重算，改推「叫車」。');
  assert.equal(regraphNote({ ...x, labels: [] }, 'metro'), '重算後改推「叫車」。');
  assert.equal(regraphNote(x, 'metro', 'en'), 'Recalculated with what you picked: now 叫車.');
  assert.equal(regraphNote({ ...x, best: 'metro' }, 'metro'), null, '還是同一個');
  assert.equal(regraphNote({ ...x, changed: false }, 'metro'), null);
});

test('askSettledBy：開著的問題問的就是剛在圖上選的狀況 → 收起；不相干不動', () => {
  const ask = { options: [{ kind: 'state', state: 'luggage', label: '有帶行李' }, { kind: 'reply', label: '沒有' }] };
  assert.equal(askSettledBy(ask, x.states), '已在決策圖選了「有帶行李」');
  assert.equal(askSettledBy(ask, [{ key: 'rush' }]), null);
  assert.equal(askSettledBy(null, x.states), null);
});
