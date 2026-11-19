// 掃發票：條碼文字解析（左邊 QR、右邊 QR、一維條碼）、不支援時的判斷、一維條碼的期別能直接對獎
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceCode, scanSupported } from '../public/js/invoice-qr.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

// 左邊 QR 前 77 碼：字軌號碼 10、民國日期 7、隨機碼 4、未稅與總計（16 進位）各 8、買方與賣方統編各 8、驗證資訊 24；之後是「:」分隔的自用區與品項
const LEFT_QR = 'AB54348835115080312340000006400000069000000001234567800000000000000000000000:**********:1:1:1:咖啡:1:65';

test('左邊 QR：字軌、號碼、民國日期轉西元；不取統編與金額', () => {
  assert.deepEqual(parseInvoiceCode(LEFT_QR), { track: 'AB', number: '54348835', date: '2026-08-03' });
  assert.deepEqual(parseInvoiceCode(`  ${LEFT_QR}\n`).number, '54348835');
});

test('右邊 QR（** 開頭）提示掃左邊；一維條碼回期別（雙數月 → 單數起始月）', () => {
  assert.deepEqual(parseInvoiceCode('**咖啡:1:65:蛋糕:1:80'), { side: 'right' });
  assert.deepEqual(parseInvoiceCode('11508AB543488351234'), { track: 'AB', number: '54348835', period: '11507' });
  assert.deepEqual(parseInvoiceCode('11512XY123456780000').period, '11511');
});

test('不是發票：亂碼、網址、月份或日期不合理、一維條碼單數月', () => {
  for (const s of ['', 'hello', 'https://example.com/AB12345678', 'AB54348835115130312340000', 'AB54348835115083212340000', '11507AB543488351234', null]) {
    assert.equal(parseInvoiceCode(s), null, String(s));
  }
});

test('Node 沒有 BarcodeDetector：不支援掃描', () => {
  assert.equal(scanSupported(), false);
});

test('掃到的期別（一維條碼）可以直接批次對獎', async () => {
  const code = parseInvoiceCode('11508AB543488351234');
  const r = await callTool(createServices({ forceMock: true }), 'invoice_check_batch', { items: [{ number: code.number, period: code.period }] });
  assert.equal(r.data.results[0].status, 'won');
  assert.equal(r.data.results[0].prize, '頭獎');
});
