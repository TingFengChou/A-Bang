// TDX 背景預熱（只在伺服器載入）：啟動後在額度內慢慢下載台北、新北、桃園的靜態資料（站牌、站序、YouBike 站點、捷運與台鐵高鐵車站）。
// 每分鐘最多用 3 次、留 2 次給使用者（tdx-client 的 backgroundPerMinute）；有使用者請求在排隊時先讓。
// 已存檔且新鮮的直接跳過（重啟後通常幾乎不用打 TDX）；之後每 6 小時再檢查一次，過期的才重抓。
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * @param {{ fresh(key: string, ttl: number): Promise<boolean>, backgroundOk(): boolean }} tdx core/tdx-client.js
 * @param {Array<{ key: string, ttl: number, run(o: { background: true }): Promise<any> }>} steps 依序執行
 * @param {{ log?: Function, pollMs?: number, everyMs?: number, maxTries?: number }} [opts]
 * @returns {{ stop(): void, done: Promise<{ downloaded: number, cached: number, failed: number }> }} done：第一輪完成
 */
export function startTdxPrewarm(tdx, steps, { log = () => {}, pollMs = 2000, everyMs = 6 * 3600e3, maxTries = 5 } = {}) {
  let stopped = false;

  async function round() {
    const pending = steps.map((s) => ({ ...s, tries: 0 }));
    const n = { downloaded: 0, cached: 0, failed: 0 };
    while (pending.length && !stopped) {
      const step = pending.shift();
      if (await tdx.fresh(step.key, step.ttl).catch(() => false)) { n.cached++; continue; }
      while (!stopped && !tdx.backgroundOk()) await sleep(pollMs); // 等額度有餘、沒有使用者在排隊
      if (stopped) break;
      try {
        await step.run({ background: true });
        n.downloaded++;
        log(`[tdx] prewarm ${step.key}`);
      } catch (e) {
        // 額度被使用者用掉（或 TDX 擋）、逾時、上游 5xx、網路錯誤：排到最後再試；其他錯誤（4xx）記下來，這一輪不再試
        const retry = e?.status == null || e.status === 429 || e.status >= 500;
        if (retry && ++step.tries < maxTries) { pending.push(step); log(`[tdx] prewarm retry later ${step.key}: ${e?.status || e?.name || ''}`); }
        else { n.failed++; log(`[tdx] prewarm skipped ${step.key}: ${e?.status || ''} ${String(e?.message || e).slice(0, 80)}`); }
      }
    }
    return n;
  }

  const done = round().then((n) => { log(`[tdx] prewarm: ${n.downloaded} downloaded, ${n.cached} from cache, ${n.failed} failed`); return n; });
  (async () => {
    await done.catch(() => {});
    while (!stopped) {
      await sleep(everyMs);
      if (!stopped) await round().catch(() => {});
    }
  })();
  return { stop() { stopped = true; }, done };
}
