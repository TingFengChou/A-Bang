// PM 盤點 Q-22、Q-23：只問「是不是詐騙」卻沒附內容，不能比對空字串後說「沒有發現詐騙特徵」（錯誤的安心）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAntifraud, antifraudSteps, antifraudSummary, isEmptyAsk } from '../core/agent/demo-antifraud.js';
import { parseIntent, demoSummary } from '../core/agent/demo-intent.js';

test('防詐：沒附內容只問「是不是詐騙」→ 不查工具、請他貼上，並提醒先別點連結匯款', () => {
  for (const t of ['這是詐騙嗎', '我收到一封簡訊，是詐騙嗎？', '幫我看這個', '剛剛接到一通電話是不是詐騙']) {
    const it = parseAntifraud(t);
    assert.equal(it.intent, 'empty', t);
    assert.deepEqual(antifraudSteps(it), [], `${t}：不查工具`);
    const say = antifraudSummary(it, {});
    assert.match(say, /貼給我/);
    assert.match(say, /不要點連結/);
    assert.doesNotMatch(say, /沒有發現/);
  }
  assert.equal(parseAntifraud('Is this a scam?').intent, 'emptyEn');
  assert.match(antifraudSummary({ intent: 'emptyEn' }, {}), /Paste the message/);
});

test('防詐：有內容照常比對（不誤判成沒附內容）', () => {
  for (const [t, want] of [['【台灣大哥大】您的帳單金額 599 元', 'message'], ['中獎了快領，請點 https://x.cc/a', 'message'], ['您好，這裡是購物網客服，因系統疏失將您的訂單設為12期分期付款，是詐騙嗎', 'message'], ['0912345678 這個號碼打來是詐騙嗎', 'sender'], ['我已經把錢匯過去了怎麼辦', 'aftermath']]) {
    assert.equal(parseAntifraud(t).intent, want, t);
  }
  assert.equal(isEmptyAsk('中獎快領'), false, '沒有問法的短訊息不是「沒附內容」');
});

test('生活阿幫被問「這是詐騙嗎」：引導到防詐，不列功能清單', () => {
  for (const t of ['這是詐騙嗎', '我收到一封簡訊，是詐騙嗎？']) {
    const it = parseIntent(t, {});
    assert.equal(it.intent, 'scamAsk', t);
    assert.match(demoSummary(it, {}), /防詐/);
  }
  const en = parseIntent('Is this a scam?', {});
  assert.deepEqual([en.intent, en.lang], ['scamAsk', 'en']);
  assert.match(demoSummary(en, {}), /Anti-fraud/);
  assert.equal(parseIntent('從西門町去台北101', {}).intent, 'trip');
});
