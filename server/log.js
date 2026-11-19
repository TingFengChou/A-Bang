// 結構化 log（M6-02，ARCHITECTURE §7）：一行一個 JSON，欄位相容 Cloud Run／Cloud Logging（severity、message）。
// 🧩 每筆帶 tenantId（第一方 first-party，ADR-0007）；agent 相關帶 agentId。
// 隱私：不記對話內容、不記座標與 query string；錯誤訊息先遮掉金鑰（環境變數的值）。

const SECRET_ENV = ['TDX_CLIENT_ID', 'TDX_CLIENT_SECRET', 'CWA_API_KEY', 'ANTHROPIC_API_KEY', 'LOCAL_LLM_API_KEY'];

/** 把字串裡出現的金鑰值換成 [redacted]（只處理長度 ≥ 8 的值，避免誤遮常見字） */
export function redact(text, env = process.env) {
  let s = String(text ?? '');
  for (const k of SECRET_ENV) {
    const v = env[k];
    if (v && v.length >= 8) s = s.split(v).join('[redacted]');
  }
  return s;
}

/**
 * @param {{ write?: (line: string) => void, env?: Record<string, string|undefined>, now?: () => Date, base?: object }} [opts]
 *   write：預設 stdout（stdio MCP 模式要改 stderr）；base：每筆都帶的欄位
 */
export function createLogger({ write = (l) => process.stdout.write(l), env = process.env, now = () => new Date(), base = {} } = {}) {
  const emit = (severity, message, fields = {}) => {
    const entry = { time: now().toISOString(), severity, message: redact(message, env), tenantId: 'first-party', ...base, ...fields };
    let line;
    try { line = JSON.stringify(entry); } catch { line = JSON.stringify({ time: entry.time, severity, message: entry.message, tenantId: entry.tenantId }); }
    write(line + '\n');
  };
  return {
    info: (message, fields) => emit('INFO', message, fields),
    warn: (message, fields) => emit('WARNING', message, fields),
    /** 錯誤只記類型、狀態碼與遮過金鑰的訊息／堆疊；不記請求內容 */
    error: (message, err, fields) => emit('ERROR', message, {
      ...(err && { error: { name: err.name || 'Error', ...(err.status && { status: err.status }), message: redact(err.message, env), stack: redact(err.stack, env).split('\n').slice(0, 6).join('\n') } }),
      ...fields,
    }),
    child: (more) => createLogger({ write, env, now, base: { ...base, ...more } }),
  };
}

/**
 * 存取 log 用的路徑：去掉 query string（可能有座標），長 id 段落折疊，避免 log 帶使用者資料。
 * /api/v1/tools/bus_route_eta → 原樣；/ui/cards/x.js → 原樣；其他靜態檔 → 原樣（不含 query）
 */
export function routeOf(path) {
  const p = String(path || '/').split('?')[0];
  return p.length > 120 ? `${p.slice(0, 120)}…` : p;
}
