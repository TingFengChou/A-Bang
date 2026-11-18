// E2E 用的 MCP Apps host（M4-08，CARDS.md §6）：以 ext-apps 的 AppBridge 扮演 Claude 那一端。
// 經真正的 /mcp 取 tool 結果與 ui://abang/cards.html，放進沙箱 iframe（只允許 script，與正式 host 相同），
// 記錄卡片送出的 openLink、updateModelContext、message，給 scripts/e2e.js 檢查。由 e2e 以 esbuild 打包後注入頁面。
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP = new URLSearchParams(location.search).get('mcp');
const log = { opened: [], context: [], messages: [], calls: [], ready: 0 };
window.__host = log;

/** 掛一張卡片：callTool → 讀 tool 的 _meta.ui.resourceUri → iframe 載入 → 送 tool input／result */
window.mountCard = async (id, name, args) => {
  const client = new Client({ name: 'abang-e2e-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP)));
  const tool = (await client.listTools()).tools.find((t) => t.name === name);
  const html = (await client.readResource({ uri: tool._meta.ui.resourceUri })).contents[0].text;
  const result = await client.callTool({ name, arguments: args });

  const slot = Object.assign(document.createElement('section'), { id });
  const iframe = Object.assign(document.createElement('iframe'), { title: name });
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'width:100%;border:1px solid #ddd;border-radius:12px;height:120px;background:#fff';
  slot.append(iframe);
  document.getElementById('slots').append(slot);

  const bridge = new AppBridge(client, { name: 'abang-e2e-host', version: '1.0.0' },
    { openLinks: {}, serverTools: {}, updateModelContext: { text: {} }, message: { text: {} } },
    { hostContext: { theme: 'light', locale: 'zh-TW' } });
  bridge.onsizechange = ({ height }) => { if (height) iframe.style.height = `${Math.ceil(height) + 2}px`; };
  bridge.onopenlink = async ({ url }) => { log.opened.push(url); return {}; };
  bridge.onupdatemodelcontext = async (p) => { log.context.push(p.content?.[0]?.text); return {}; };
  bridge.onmessage = async (p) => { log.messages.push(p.content?.[0]?.text); return {}; };
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: args });
    await bridge.sendToolResult(result);
    log.ready++;
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  const forward = bridge.oncalltool; // connect 時 AppBridge 把 tools/call 轉給 client；包一層記錄卡片呼叫了哪個 tool
  bridge.oncalltool = async (p, extra) => { log.calls.push(p.name); return forward(p, extra); };
  iframe.srcdoc = html;
};
