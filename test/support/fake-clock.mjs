// 假時鐘（V1-2）：把「現在」挪到台灣時間 FAKE_TW（例 22:30），找出結果會隨跑測試的時間變的測試。
// 用法：FAKE_TW=13:00 node --import=./test/support/fake-clock.mjs --test test/*.test.js（npm run test:clock 一次跑幾個時段）。
// 只改沒有參數的 new Date() 與 Date.now()；時間照常往前走（計時器、逾時不受影響）。
const hhmm = globalThis.process?.env?.FAKE_TW;
if (hhmm && /^\d{2}:\d{2}$/.test(hhmm)) {
  const RealDate = Date;
  const real = RealDate.now();
  const twDay = new RealDate(real + 8 * 3600e3).toISOString().slice(0, 10);
  const off = RealDate.parse(`${twDay}T${hhmm}:00+08:00`) - real;
  globalThis.Date = class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
    static now() { return RealDate.now() + off; }
  };
}
