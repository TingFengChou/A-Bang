// TDX 靜態資料存檔（只在伺服器載入，不可被瀏覽器打包路徑 import）：伺服器重啟後先讀檔，不必從冷快取開始。
// 只存服務正規化後的結果（站牌、路線站序、車站、時刻表…）；不存 token、金鑰、網址參數、使用者位置，動態資料（到站、車數）不存。
// 檔名由 key 決定（英數與 - _，其他字元換掉並加短雜湊避免撞名）；寫入先寫暫存檔再改名，寫到一半不會留下壞檔。
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MAX_BYTES = 64 * 1024 * 1024; // 單檔上限（整個縣市的站序約 3～5 MB）
const VERSION = 1; // 正規化格式改版時加一，舊檔就不讀
const MISS_MS = 10 * 60e3; // 讀不到的 key 記 10 分鐘（逐條查的路線很多，別每次都去碰磁碟）

/** key → 安全檔名 */
export function fileNameOf(key) {
  const k = String(key);
  const safe = k.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return safe === k ? `${safe}.json` : `${safe}.${createHash('sha1').update(k).digest('hex').slice(0, 10)}.json`;
}

/**
 * @param {string} dir 存檔目錄（例 .cache/tdx；Docker 用 volume）
 * @param {{ log?: Function, maxBytes?: number }} [opts]
 * @returns {{ dir: string, read(key: string): Promise<{ at: number, data: any } | null>, write(key: string, v: { at: number, data: any }): Promise<void>, check(): Promise<void> }}
 */
export function createFileStore(dir, { log = () => {}, maxBytes = MAX_BYTES } = {}) {
  let ready = null;
  const misses = new Map(); // key -> 讀不到的時間
  const ensure = () => (ready ||= mkdir(dir, { recursive: true, mode: 0o700 }).catch((e) => { ready = null; throw e; }));
  return {
    dir,
    /** 部署檢查：目錄建得起來、寫得進去（唯讀掛載、權限不對時丟錯；P0-2） */
    async check() {
      await ensure();
      const probe = join(dir, `.probe.${process.pid}.${Date.now()}`);
      await writeFile(probe, '', { mode: 0o600 });
      await rm(probe, { force: true });
    },
    async read(key) {
      if (misses.size > 5000) misses.clear();
      const t = misses.get(key);
      if (t && Date.now() - t < MISS_MS) return null;
      const file = join(dir, fileNameOf(key));
      let txt;
      try {
        const st = await stat(file);
        if (!st.isFile() || st.size > maxBytes) { misses.set(key, Date.now()); return null; } // 先看大小再讀，不把超大檔讀進記憶體
        txt = await readFile(file, 'utf8');
      } catch { misses.set(key, Date.now()); return null; }
      try {
        const v = JSON.parse(txt);
        if (v?.v !== VERSION || v.key !== key || !Number.isFinite(v.at)) { misses.set(key, Date.now()); return null; }
        return { at: v.at, data: v.data };
      } catch {
        misses.set(key, Date.now());
        log(`[tdx-store] 壞檔已略過：${fileNameOf(key)}`);
        return null;
      }
    },
    async write(key, { at, data }) {
      const txt = JSON.stringify({ v: VERSION, key, at, data });
      if (txt.length > maxBytes) return;
      await ensure();
      const file = join(dir, fileNameOf(key));
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(tmp, txt, { mode: 0o600 });
        await rename(tmp, file);
        misses.delete(key);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
    },
  };
}
