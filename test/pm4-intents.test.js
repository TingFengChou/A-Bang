// PM 第四批（P4）探查到的錯：情境集以外的說法（回歸測試）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../core/agent/demo-intent.js';
import { getTool } from '../core/tools/index.js';

const h = (...said) => said.flatMap((t) => [{ role: 'user', content: t }, { role: 'assistant', content: '好' }]);

test('P4 探查：股名不混進連接詞、「捷運哪一站」不是站名、電梯照實說、代付各種說法', () => {
  assert.equal(parseIntent('所以該不該買聯發科', { history: h('台積電收盤多少') }).query, '聯發科');
  assert.equal(parseIntent('那該不該買', { history: h('台積電今天收多少') }).query, '台積電', '沿用上一句的股票');
  assert.notEqual(parseIntent('我坐輪椅，捷運哪一站有電梯').station, '哪一');
  assert.equal(parseIntent('台北車站有電梯嗎').intent, 'access');
  assert.equal(parseIntent('我坐輪椅，從北車坐捷運去101方便嗎').intent, 'trip', '有起訖是行程');
  for (const t of ['您可以幫我刷卡買高鐵票嗎', '幫我付計程車錢', '幫我把錢轉給司機']) assert.equal(parseIntent(t).intent, 'limits', t);
  assert.equal(parseIntent('捷運最近的站下一班').intent, 'metro');
  assert.equal(parseIntent('捷運還有車ㄇ').intent, 'metro', '注音文句尾');
  assert.deepEqual([parseIntent('92 一公升多少').intent, parseIntent('92 一公升多少').grade], ['fuel', '92']);
  assert.equal(parseIntent('晚上要不要去跑步').intent, 'outing');
});

test('地震：問某縣市時講那個縣市有感的那次（P4-4）', () => {
  const speak = getTool('earthquake_recent').speak;
  const quakes = [
    { time: '2026-11-18T10:00:00', magnitude: 3.5, location: '臺南市政府東北方 10 公里', maxIntensity: '2級', countyIntensity: null },
    { time: '2026-11-17T08:12:00', magnitude: 4.8, location: '臺東縣近海', maxIntensity: '3級', countyIntensity: '2級' },
  ];
  assert.match(speak({ county: '花蓮縣', quakes }), /^花蓮縣最近一次有感：11-17 08:12.+花蓮縣震度 2級/);
  assert.match(speak({ county: '花蓮縣', quakes: [quakes[0]] }), /沒有列出花蓮縣的震度/);
  assert.match(speak({ quakes }), /^最近一次：11-18/);
});

test('PR 審查：防詐不擋貼上的號碼、急症常見說法、地名不誤判、垃圾車不是股市', async () => {
  const { safetyCheck } = await import('../core/agent/safety.js');
  assert.equal(safetyCheck('簡訊說驗證碼：123456請提供身分證 A123456789', { profileId: 'antifraud' }), null, '防詐照常判斷');
  assert.equal(safetyCheck('我的身分證是 A123456789').kind, 'privacy');
  for (const t of ['胸口悶悶的', '胸悶', '心悸', '爸爸中風了']) assert.equal(safetyCheck(t)?.kind, 'medical', t);
  for (const t of ['我要去中風復健中心', '密碼是什麼意思', '卡號 1234 5678 的悠遊卡', '台大醫院掛哪科要搭幾號公車', '我感冒了要不要看醫生，附近有診所嗎']) assert.equal(safetyCheck(t), null, t);
  assert.equal(parseIntent('垃圾車今天收幾點').intent, 'garbage');
  assert.equal(parseIntent('那斯達克今天收盤').query, '那斯達克');
  assert.notEqual(parseIntent('307 和 95 多少錢').intent, 'fuel');
  assert.notEqual(parseIntent('要不要散步到101').intent, 'outing');
});
