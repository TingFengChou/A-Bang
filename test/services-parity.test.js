// 架構規則 3「Mock 對等」：真實與示範的 createServices() 方法要一樣（架構第三輪 #4）。
// 少一個方法時，withTdxFallback 額度用完改用示範資料會找不到方法，畫面直接出錯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../core/index.js';

/** 服務的方法清單（「transit.busEta」）：只看函式，往下一層 */
function methods(svc) {
  const out = [];
  for (const [k, v] of Object.entries(svc)) {
    if (typeof v === 'function') out.push(k);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'function') out.push(`${k}.${k2}`);
  }
  return out.sort();
}

/** 只有真實資料才有的背景預熱（呼叫端都用 ?. 防護，示範模式不需要） */
const LIVE_ONLY = ['parking.warm', 'tdxPrewarm'];

test('真實與示範的服務方法一樣（只差背景預熱）', () => {
  // 假金鑰只用來走「真實」那條建構路徑；建構時不連網
  const live = methods(createServices({ clientId: 'x', clientSecret: 'y', cwaKey: 'k', moenvKey: 'm', openData: true, drama: { apiBase: 'https://api.example.com' } }));
  const mock = methods(createServices({ forceMock: true }));
  assert.deepEqual(mock.filter((m) => !live.includes(m)), [], '示範有、真實沒有的方法');
  assert.deepEqual(live.filter((m) => !mock.includes(m)), LIVE_ONLY, '真實有、示範沒有的方法（新增的要補到示範，或確定是預熱再列進 LIVE_ONLY）');
  assert.ok(mock.length > 40, `方法數 ${mock.length}`);
});
