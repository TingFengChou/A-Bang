// OpenAPI 3.1 文件（Swagger）：由 REST 路由表與 tool registry 自動產生，不手寫、不會與實作脫節。
import { STATES } from '../core/decide.js';
import { readFileSync } from 'node:fs';
import { listTools, describeTool } from '../core/tools/index.js';
import { restRoutes } from './rest.js';
import { PROFILES } from '../core/agents/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ERR = { $ref: '#/components/schemas/Error' };
const errors = {
  400: { description: '參數錯誤（訊息為繁體中文，說明怎麼改）', content: { 'application/json': { schema: ERR } } },
  429: { description: '請求太頻繁（見 retry-after）', content: { 'application/json': { schema: ERR } } },
  502: { description: '上游資料來源錯誤（TDX／氣象署）', content: { 'application/json': { schema: ERR } } },
};

/** @param {object} svc createServices() 的結果（只用來取路由表，不會呼叫服務） */
export function buildOpenApi(svc) {
  const paths = {};
  for (const [path, r] of Object.entries(restRoutes(svc))) {
    paths[path] = {
      get: {
        tags: [r.tag], summary: r.summary, operationId: `get${path.replace(/\/api\/v1|[^a-z0-9]/gi, ' ').replace(/ (\w)/g, (_, c) => c.toUpperCase()).replace(/ /g, '')}`,
        parameters: r.params.map((p) => ({ name: p.name, in: 'query', required: p.required, description: p.description, schema: { type: p.type, ...(p.example !== undefined && { example: p.example }) } })),
        responses: { 200: { description: '成功', content: { 'application/json': { schema: { type: 'object', properties: { mode: { enum: ['live', 'demo'] }, data: {} } } } } }, ...errors },
      },
    };
  }
  for (const t of listTools()) {
    const d = describeTool(t);
    const { $schema: _schema, ...input } = d.inputSchema; // 2020-12 與 OpenAPI 3.1 相容，去掉 $schema 避免 UI 警告
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        tags: [`Tools: ${t.pack}`], summary: `${t.title}（${t.name}）`, operationId: t.name,
        description: `${t.description}\n\n風險分級 ${t.tier}${t.card ? `；卡片 \`${t.card}\`` : ''}；資料來源：${t.source}`,
        requestBody: { required: true, content: { 'application/json': { schema: input } } },
        responses: { 200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResult' } } } }, 405: { description: '只接受 POST' }, ...errors },
      },
    };
  }
  paths['/api/v1/agent'] = {
    post: {
      tags: ['Agent'], summary: '網頁 agent（NDJSON 事件串流）', operationId: 'postAgent',
      description: '回應 `application/x-ndjson`，每行一個事件（status、agent_note、tool_start、tool_result、discussion_end、decision、ask、guardrail、client_tool_call、text、done、error），格式見 docs/AGENT.md §3。模式：Claude／地端模型／示範（ADR-0012）。只給本站網頁使用（無 CORS）；每 IP 每分鐘與每日限流。',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', required: ['messages'],
        properties: {
          messages: { type: 'array', maxItems: 10, items: { type: 'object', required: ['role', 'content'], properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string', maxLength: 500 } } } },
          userState: { type: 'object', properties: { picked: { type: 'array', items: { enum: Object.keys(STATES) } } } },
          context: { type: 'string', maxLength: 200 },
        },
        example: { messages: [{ role: 'user', content: '從西門町到台北 101 怎麼去？' }] },
      } } } },
      responses: { 200: { description: 'NDJSON 事件串流', content: { 'application/x-ndjson': { schema: { type: 'string' } } } }, 405: { description: '只接受 POST' }, ...errors },
    },
  };
  // 其他 agent（ADR-0005）：同一個請求格式，例 /api/v1/agent/antifraud（阿幫・防詐）
  paths['/api/v1/agent/{id}'] = {
    post: {
      ...paths['/api/v1/agent'].post, operationId: 'postAgentById', summary: '指定 agent（例：antifraud 防詐）',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', enum: Object.keys(PROFILES) }, example: 'antifraud' }],
      responses: { ...paths['/api/v1/agent'].post.responses, 404: { description: '沒有這個 agent' } },
    },
  };
  paths['/mcp'] = {
    post: {
      tags: ['MCP'], summary: '遠端 MCP（Streamable HTTP，stateless）',
      description: '給 Claude 等 MCP client 的連接器端點，以 JSON-RPC 呼叫，與 /api/v1/tools 同一套 tools。`/mcp/{pack}` 只列出該工具包。',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', example: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } } } },
      responses: { 200: { description: 'JSON-RPC 回應' }, 405: { description: '只接受 POST' } },
    },
  };
  return {
    openapi: '3.1.0',
    info: { title: '阿幫 A-Bang API', version: pkg.version || '0.0.0', description: '台灣政府開放資料的交通、天氣 tools。沒有金鑰時為示範模式（mode=demo，非真實資訊）。金鑰只在伺服器端。' },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        ToolResult: {
          type: 'object',
          properties: {
            name: { type: 'string' }, card: { type: ['string', 'null'] }, v: { type: 'integer', description: '卡片資料契約版本（有卡片時）' }, mode: { enum: ['live', 'demo'] },
            args: { type: 'object', description: '驗證後的參數（卡片刷新用）' },
            data: { description: '正規化資料，格式見 docs/MCP_TOOLS.md' }, text: { type: 'string', description: '給模型看的摘要（≤ 1500 字）' },
            speak: { type: ['string', 'null'], description: '討論串的一句話（由資料產生）' },
            metrics: {
              type: 'object', description: '本次呼叫的計量（示範模式 calls／scanned 為 0）',
              properties: { calls: { type: 'integer', description: '上游資料取用次數（含快取）' }, cacheHits: { type: 'integer' }, cacheHit: { type: 'boolean', description: '全部由快取取得' }, scanned: { type: 'integer', description: '上游回應資料筆數' }, ms: { type: 'integer', description: '耗時（毫秒）' } },
            },
          },
        },
      },
    },
  };
}
