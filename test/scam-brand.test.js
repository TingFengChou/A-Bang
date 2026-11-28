// 冒用機關或公司名義＋網址不是官方網站（規則庫 2026.11.28-1，PM 審查）；轉述的假檢警說法；有特徵時不說「沒有發現已知特徵」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRules, riskLevel, brandMismatch, checkMessage, NOT_SAFE_NOTE, SOME_SIGNS_NOTE } from '../core/scam-check.js';
import { createServices } from '../core/index.js';

const judge = (s) => { const f = matchRules(s); return { level: riskLevel(f.reduce((n, x) => n + x.weight, 0), false), ids: f.map((x) => x.id) }; };

test('冒用名義＋非官方網址：健保署、監理站、台電、Apple 都到高風險', () => {
  for (const s of [
    '【健保署】您的健保卡已停用，請於今日內點擊 https://nhi-tw.cc 重新認證，逾期將無法就醫',
    '【監理站】您有一筆交通罰單未繳，請點 https://mvdis-gov.top 繳納',
    '【台電】電費逾期未繳，請點擊 https://taipower-tw.cc/pay',
    'Your Apple ID has been locked. Verify now: http://apple-id-verify.com',
  ]) {
    const r = judge(s);
    assert.equal(r.level, 'high', s);
    assert.ok(r.ids.includes('brand-domain'), s);
  }
  assert.deepEqual(brandMismatch('【健保署】請點 https://nhi-tw.cc/x'), { brand: '健保署', host: 'nhi-tw.cc', i: 1, m: '健保署' });
  assert.equal(brandMismatch('【台電】電費逾期，請點 taipower.com.tw.evil.cc/pay')?.host, 'taipower.com.tw.evil.cc', '官方網域放在前面不算');
});

test('官方網址（含子網域、政府網域、短網址白名單）與沒有網址：不加分', () => {
  for (const s of [
    '【中華電信】您的帳單已出帳，查詢請至 https://www.cht.com.tw/bill',
    '【財政部】115年牌照稅開徵，請於11/30前繳納，可至 https://www.etax.nat.gov.tw 線上繳稅',
    '【蝦皮】您的訂單已出貨 https://shp.ee/abc',
    '【健保署】提醒您：健保卡可至 https://www.nhi.gov.tw 查詢',
    '【7-ELEVEN】包裹已到店 https://myship.7-11.com.tw/x',
    '【監理站】請至 https://www.mvdis.gov.tw 查詢',
    '【台電】停電通知：明天上午 9 點到 12 點',
    '網購買了 Apple 耳機 https://24h.pchome.com.tw/x', // 「Apple」單字不是 Apple ID
    '7-11 的 ibon 可以印',
  ]) assert.equal(brandMismatch(s), null, s);
});

test('假檢警的轉述：「說我健保卡被盜用、要我轉給警察」「自稱檢察官、要我把錢領出來交給他」高風險；自己問、日常托付不算', () => {
  assert.equal(judge('有人打電話說我健保卡被盜用要我轉給警察').level, 'high');
  assert.equal(judge('有個自稱檢察官的打給我，要我把錢領出來交給他').level, 'high');
  for (const s of ['我的身分證被冒用怎麼辦', '媽媽要我把便當交給他', '我健保卡不見了怎麼補辦']) assert.equal(judge(s).level, 'low', s);
});

test('低風險但有抓到特徵：說「有一兩個可疑的地方」，不說「沒有發現已知特徵」', async () => {
  const svc = createServices({ forceMock: true });
  const some = await checkMessage(svc, '請點擊連結查看您的包裹進度');
  assert.equal(some.level, 'low');
  assert.ok(some.findings.length);
  assert.ok(some.advice.includes(SOME_SIGNS_NOTE));
  assert.ok(!some.advice.includes(NOT_SAFE_NOTE));
  const none = await checkMessage(svc, '明天中午一起吃飯嗎？');
  assert.ok(none.advice.includes(NOT_SAFE_NOTE));
});
