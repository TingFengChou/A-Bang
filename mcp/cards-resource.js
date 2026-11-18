// MCP Apps 卡片資源（M4-06，ADR-0003）：ui://abang/cards.html，MIME text/html;profile=mcp-app。
// 開發環境（有 esbuild）在記憶體內打包，改卡片程式重開伺服器就生效；正式環境（npm ci --omit=dev）讀預先打包的 dist/cards.html。
import { readFile } from 'node:fs/promises';

export const CARDS_URI = 'ui://abang/cards.html';
export const CARDS_MIME = 'text/html;profile=mcp-app';

let cached = null;

/** @returns {Promise<string>} 卡片 HTML；打包工具與 dist 都沒有時丟錯（訊息說明下一步） */
export function cardsHtml() {
  cached ??= load().catch((e) => { cached = null; throw e; });
  return cached;
}

async function load() {
  try {
    const { buildCardsHtml } = await import('../scripts/build-cards.js');
    return await buildCardsHtml();
  } catch {
    try {
      return await readFile(new URL('../dist/cards.html', import.meta.url), 'utf8');
    } catch {
      throw new Error('卡片尚未打包：請執行 npm run build:cards');
    }
  }
}
