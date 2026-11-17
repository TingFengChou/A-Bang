#!/usr/bin/env node
// 阿幫 MCP Server（stdio）— Claude Desktop / Claude Code 本機使用
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServices, loadEnv } from '../core/index.js';
import { createMcpServer } from './create-server.js';

const svc = createServices({ ...(await loadEnv()), log: (m) => console.error(m) }); // stdio 模式 log 只能寫 stderr
const packs = process.env.MCP_PACKS ? process.env.MCP_PACKS.split(',') : undefined;
await createMcpServer(svc, { packs }).connect(new StdioServerTransport());
console.error(`[mcp] abang ready (mode=${svc.mode}${packs ? `, packs=${packs}` : ''})`);
