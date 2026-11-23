// 由 tool registry 建立 MCP server（stdio 與 HTTP 共用；ADR-0002、ADR-0006）
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listTools, callTool } from '../core/tools/index.js';
import { UserError, publicMessage } from '../core/util.js';
import { CARDS_URI, CARDS_MIME, cardsHtml } from './cards-resource.js';
import { createLogger } from '../server/log.js';

const log = createLogger({ write: (l) => process.stderr.write(l) }); // stdio 模式 stdout 是協定通道，log 一律寫 stderr

export const SERVER_INFO = { name: 'abang', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version };
/** 有金鑰、但這次 TDX 額度用完改用示範資料（callTool 的 fallback）：不要說「尚未設定 TDX 金鑰」 */
export const FALLBACK_NOTE = '【示範資料：TDX 每分鐘的查詢額度用完，這次先用示範資料，以下非真實營運資訊】';

/**
 * @param {object} svc  createServices() 的結果
 * @param {{ packs?: string[] }} [opts]  只註冊指定工具包（例如 /mcp/transit）
 */
export function createMcpServer(svc, { packs } = {}) {
  const server = new McpServer(SERVER_INFO, {
    instructions: '阿幫（A-Bang）：台灣公共資料工具。即時資訊請一律呼叫工具，不要憑記憶回答到站時間、班次或車輛數；回覆時標示資料來源（交通部 TDX）。',
  });

  for (const t of listTools({ packs })) {
    server.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.input,
      annotations: { readOnlyHint: true, openWorldHint: true, title: t.title },
      _meta: {
        'abang/pack': t.pack, 'abang/tier': t.tier,
        // 有卡片的 tool 指向 MCP Apps 資源（M4-06）；ui/resourceUri 為舊版 host 相容鍵
        ...(t.card && { 'abang/card': t.card, ui: { resourceUri: CARDS_URI }, 'ui/resourceUri': CARDS_URI }),
      },
    }, async (args) => {
      try {
        const r = await callTool(svc, t.name, args);
        const note = r.mode === 'demo' && !t.static ? `${r.fallback ? FALLBACK_NOTE : t.demoNote}\n` : '';
        return {
          content: [{ type: 'text', text: note + r.text + `\n\n資料來源：${t.source}` }],
          // CardPayload（CARDS.md §2）：tool／args 給卡片刷新用
          structuredContent: { card: r.card, ...(r.v && { v: r.v }), tool: r.name, args: r.args, mode: r.mode, speak: r.speak, data: r.data },
          _meta: { 'abang/metrics': r.metrics }, // 計量放 _meta：每次不同（耗時），不混進結構化資料
        };
      } catch (e) {
        if (!(e instanceof UserError)) log.error('tool failed', e, { tool: t.name }); // 細節只進 log，不回給 client
        return { isError: true, content: [{ type: 'text', text: publicMessage(e) }] };
      }
    });
  }

  // MCP Apps 卡片（ADR-0003）：單檔 HTML，卡片依 structuredContent 渲染；不支援的 client 仍有 content 文字
  if (listTools({ packs }).some((t) => t.card)) {
    server.registerResource('abang-cards', CARDS_URI, {
      title: '阿幫互動卡片', description: '公車、捷運、YouBike、時刻表、行程等 tool 結果的互動卡片（MCP Apps）', mimeType: CARDS_MIME,
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: CARDS_MIME, text: await cardsHtml() }] }));
  }
  return server;
}
