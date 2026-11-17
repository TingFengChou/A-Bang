// API 文件（Swagger）：OpenAPI 由路由表與 tool registry 自動產生，每個 REST 路由與 tool 都要有文件
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApi } from '../server/openapi.js';
import { restRoutes } from '../server/rest.js';
import { listTools } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const svc = createServices({ forceMock: true });
const spec = buildOpenApi(svc);

test('OpenAPI 3.1 基本結構', () => {
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.info.title && spec.info.version);
  assert.ok(spec.components.schemas.ToolResult && spec.components.schemas.Error);
});

test('每個 REST 路由都有 GET 文件與參數說明', () => {
  for (const [path, r] of Object.entries(restRoutes(svc))) {
    const op = spec.paths[path]?.get;
    assert.ok(op, path);
    assert.deepEqual(op.parameters.map((p) => p.name), r.params.map((p) => p.name), path);
    assert.ok(op.parameters.every((p) => p.in === 'query' && p.description), path);
  }
});

test('每個 tool 都有 POST 文件，request body 就是 tool 的 JSON Schema', () => {
  const ids = new Set();
  for (const t of listTools()) {
    const op = spec.paths[`/api/v1/tools/${t.name}`]?.post;
    assert.ok(op, t.name);
    assert.equal(op.requestBody.content['application/json'].schema.type, 'object', t.name);
    assert.equal(op.requestBody.content['application/json'].schema.$schema, undefined, t.name);
    assert.ok(op.description.includes(t.tier), t.name);
    assert.ok(!ids.has(op.operationId), `operationId 重複：${op.operationId}`);
    ids.add(op.operationId);
  }
  assert.ok(spec.paths['/mcp'].post);
});

test('operationId 全部唯一', () => {
  const all = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId)).filter(Boolean);
  assert.equal(new Set(all).size, all.length);
});
