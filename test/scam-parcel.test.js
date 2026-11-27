// 包裹、罰單釣魚簡訊（規則庫 2026.11.27-1）：典型寫法要到高風險；正常的取貨、出貨、帳單、開徵通知不能變成高風險
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRules, riskLevel, RULES_VERSION } from '../core/scam-check.js';

const judge = (s) => {
  const f = matchRules(s);
  const score = f.reduce((n, x) => n + x.weight, 0);
  return { level: riskLevel(score, false), ids: f.map((x) => x.id) };
};

test('典型包裹、罰單釣魚簡訊：地址有誤＋限時＋附連結要你處理 → 高風險', () => {
  assert.equal(RULES_VERSION, '2026.11.27-1');
  for (const s of [
    '【中華郵政】您的包裹因地址不完整無法投遞，請於24小時內更新地址：https://post-tw.cc/a',
    '【黑貓宅急便】您的包裹已到達配送站，因地址資訊有誤暫停配送，請於24小時內點擊更新 https://t-cat.top/x',
    '中華郵政：你有一個包裹待領取，需支付運費 25 元，請在今日內完成付款 https://xx.cn/p',
    'DHL: Your parcel is on hold due to unpaid customs fee. Pay within 24 hours: https://dhl-tw.top',
    '【監理站】您有一筆交通罰鍰未繳，請於今日內繳納以免吊銷駕照 https://mvdis-tw.cc',
  ]) {
    const r = judge(s);
    assert.equal(r.level, 'high', s);
    assert.ok(r.ids.includes('click-link') && r.ids.includes('urgent'), s);
  }
});

test('只有部分特徵：到店＋限時確認＋連結是中風險（提醒小心），不是高風險', () => {
  assert.equal(judge('【7-11】您的訂單包裹已到店，請在24小時內確認收件資訊，逾期將退回 https://711-tw.vip/k').level, 'medium');
});

test('誤判反例：正常的取貨、出貨、帳單、開徵、會議連結、聊天都不是中高風險', () => {
  for (const s of [
    '【7-ELEVEN】您的包裹已到店，請於7天內至門市取件，逾期將退回寄件人',
    '【蝦皮】您的訂單已出貨，物流進度查詢 https://shopee.tw/o/123',
    '【台電】您的電子帳單已寄出，本期應繳 1,234 元，查詢 https://www.taipower.com.tw',
    '【財政部】115年牌照稅開徵，請於11/30前繳納，可至 https://www.etax.nat.gov.tw 線上繳稅',
    '【中華郵政】您的掛號郵件已投遞，簽收人本人。',
    '黑貓宅急便：您的包裹預計今日送達，配送員 0912345678',
    '會議連結在這：https://meet.google.com/abc-defg-hij 點此加入',
    '今天晚上要不要一起吃飯？我在 https://maps.app.goo.gl/xyz',
    '你好，請在24小時內確認一下會議時間',
    '包裹到了，我放在管理室',
    '【黑貓宅急便】因颱風影響，今日部分地區暫停配送，造成不便敬請見諒',
    '雙11 滿千免付運費，點此逛逛 https://shop.example.com/sale',
    '演唱會晚上7點入場，記得帶票',
    'Free delivery fee on orders over $50. Display your code at checkout https://shop.example.com/',
  ]) assert.equal(judge(s).level, 'low', s);
});
