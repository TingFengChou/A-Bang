// 卡片一致性（設計審查 2026-11-28）：電話顯示格式統一；戶政英文日期不混中文星期；護照據點英文名
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtTel } from '../public/ui/cards/dom.js';
import { taipeiDay, workdayOf } from '../core/services/govoffice.js';
import { parsePassportWait } from '../core/services/passport.js';

test('電話：市話、手機、短區碼、0800、分機；看不出格式照原樣', () => {
  assert.equal(fmtTel('(02)23038125'), '02-2303-8125');
  assert.equal(fmtTel('02-23948838'), '02-2394-8838');
  assert.equal(fmtTel('0912345678'), '0912-345-678');
  assert.equal(fmtTel('(037)123456'), '037-123456');
  assert.equal(fmtTel('(04)2345678'), '04-234-5678');
  assert.equal(fmtTel('(07)23456789'), '07-2345-6789');
  assert.equal(fmtTel('0800-000-123'), '0800-000-123');
  assert.equal(fmtTel('(02)23038125#123'), '02-2303-8125 #123');
  assert.equal(fmtTel('02-23948838轉101'), '02-2394-8838 轉101');
  assert.equal(fmtTel('1999'), '1999');
  assert.equal(fmtTel(null), '');
});

test('戶政日期帶 M/D 與星期數字（英文卡片自己組，不混中文星期）', () => {
  const now = Date.parse('2026-11-28T10:00:00+08:00');
  assert.deepEqual([taipeiDay(now).md, taipeiDay(now).dow], ['11/28', 6]);
  const w = workdayOf(null, now);
  assert.deepEqual([w.date, w.md, w.dow], ['11/28（六）', '11/28', 6]);
});

test('護照據點英文名', () => {
  const d = parsePassportWait('<rss><channel><item><location>外交部領事事務局</location><AP_GeneralWaitingPersonCount>1</AP_GeneralWaitingPersonCount></item></channel></rss>');
  assert.equal(d.offices[0].shortEn, 'BOCA (Taipei)');
});
