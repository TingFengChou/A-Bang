// 時間詞（PM 審查 2026-11-28）：診所、戶政問明天、禮拜六、夜間時照那一天那個時段查；「那明天呢」接著查
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whenOf } from '../core/when.js';
import { parseClinics, clinicSearch } from '../core/services/clinic.js';
import { clinicSay } from '../core/tools/life.js';
import { createServices } from '../core/index.js';
import { parseIntent } from '../core/agent/demo-intent.js';

const at = (d, hm) => Date.parse(`2026-11-${d}T${hm}:00+08:00`); // 27＝星期五

test('whenOf：明天、後天、禮拜幾（依今天算，下禮拜加 7）、時段（夜間＝晚上）；沒說回 null', () => {
  const fri = at(27, '15:00');
  assert.deepEqual(whenOf('明天早上哪間診所有開', fri), { dayOffset: 1, period: '上午', label: '明天上午' });
  assert.deepEqual(whenOf('後天', fri), { dayOffset: 2, period: null, label: '後天' });
  assert.equal(whenOf('禮拜天有開的診所', fri).dayOffset, 2);
  assert.equal(whenOf('星期五', fri).dayOffset, 0, '今天就是星期五');
  assert.equal(whenOf('下禮拜一', fri).dayOffset, 10);
  assert.deepEqual(whenOf('附近有夜間看診的小兒科嗎', fri), { dayOffset: 0, period: '晚上', label: '今天晚上' });
  assert.equal(whenOf('附近有開的診所嗎', fri), null);
});

const H = (open) => ['一', '二', '三', '四', '五', '六', '日'].flatMap((w) => ['上午', '下午', '晚上'].map((p) => `星期${w}${p}${open[w]?.includes(p) ? '看診' : '休診'}`)).join('、');
const CSV = ['醫事機構代碼,醫事機構名稱,醫事機構種類,電話,地址,分區業務組,特約類別,服務項目,診療科別,終止合約或歇業日期,固定看診時段,備註,縣市別代碼,合約起日',
  `1,週末診所,西醫診所,(02)1,臺北市大安區A路1號,臺北,4,門診,家醫科,20301231,${H({ 六: ['上午'], 日: ['上午'] })},-,63000,20200101`,
  `2,平日診所,西醫診所,(02)2,臺北市大安區B路2號,臺北,4,門診,家醫科,20301231,${H({ 五: ['上午', '晚上'] })},-,63000,20200101`].join('\n');

test('診所：問別的日子或時段 → planned，照那天那個時段算；深夜補明天上午有幾家', () => {
  const rows = parseClinics(CSV);
  const sat = clinicSearch(rows, { area: '大安區', now: at(27, '15:00'), dayOffset: 1, period: '上午' });
  assert.equal(sat.phase, 'planned');
  assert.equal(sat.weekday, '星期六');
  assert.deepEqual(sat.clinics.filter((c) => c.openNow).map((c) => c.name), ['週末診所']);
  assert.equal(clinicSay(sat), '大安區明天上午有登記看診的西醫診所有 1 家。時段是登記的，出門前先打電話確認。');
  const night = clinicSearch(rows, { area: '大安區', now: at(27, '15:00'), period: '晚上' });
  assert.deepEqual(night.clinics.filter((c) => c.openNow).map((c) => c.name), ['平日診所']);
  assert.match(clinicSay({ ...clinicSearch(rows, { area: '大安區', now: at(27, '23:00') }), tomorrow: { weekday: '星期六', count: 1 } }), /今天都看完了.+119。明天上午這一區有 1 家登記看診。$/);
});

test('戶政：問那一天上不上班（不說「今天」）', async () => {
  const svc = createServices({ forceMock: true });
  const d = await svc.govOffice.nearbyOffices({ lat: 25.0478, lon: 121.517, now: at(27, '15:00'), dayOffset: 1 });
  assert.equal(d.today.dayOffset, 1);
  assert.match(d.today.date, /^11\/28（六）$/);
  assert.equal(d.today.workday, false);
});

test('規則：診所、戶政帶上時間；找診所之後「那明天早上呢」接著查', () => {
  const p = (q, history = []) => parseIntent(q, { history });
  assert.equal(p('明天早上哪間診所有開').when.period, '上午');
  assert.equal(p('戶政事務所禮拜六有開嗎').govOffice, true);
  const f = p('那明天早上呢', [{ role: 'user', content: '附近有開的小兒科嗎' }, { role: 'assistant', content: '……' }]);
  assert.equal(f.intent, 'pharmacy');
  assert.equal(f.clinic, true);
  assert.equal(f.dept, 'peds');
  assert.deepEqual([f.when.dayOffset, f.when.period], [1, '上午']);
  assert.notEqual(p('那明天呢', [{ role: 'user', content: '去台北101' }, { role: 'assistant', content: '……' }]).clinic, true, '前一句不是診所就不接');
});
