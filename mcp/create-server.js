// 由 tool registry 建立 MCP server（stdio 與 HTTP 共用；ADR-0002、ADR-0006）
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listTools, callTool } from '../core/tools/index.js';
import { UserError, publicMessage } from '../core/util.js';

export const SERVER_INFO = { name: 'abang', version: '0.2.0' };

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
      _meta: { 'abang/pack': t.pack, 'abang/tier': t.tier, ...(t.card && { 'abang/card': t.card }) },
    }, async (args) => {
      try {
        const r = await callTool(svc, t.name, args);
        const note = r.mode === 'demo' && !t.static ? `${t.demoNote}\n` : '';
        return {
          content: [{ type: 'text', text: note + r.text + `\n\n資料來源：${t.source}` }],
          structuredContent: { card: r.card, mode: r.mode, speak: r.speak, data: r.data },
          _meta: { 'abang/metrics': r.metrics }, // 計量放 _meta：每次不同（耗時），不混進結構化資料
        };
      } catch (e) {
        if (!(e instanceof UserError)) console.error(e); // stdio 模式 stderr 不影響協定；細節不回給 client
        return { isError: true, content: [{ type: 'text', text: publicMessage(e) }] };
      }
    });
  }
  return server;
}
