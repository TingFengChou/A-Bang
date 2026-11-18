// MCP Apps 卡片單檔（M4-05，ADR-0003）：esbuild 把 public/ui/cards/mcp-app.js（含 ext-apps 的 App）與 cards.css 打包成一個 HTML，
// 零外部資源（iframe CSP 預設拒絕）。`npm run build:cards` 寫入 dist/cards.html；MCP 伺服器也會在記憶體內呼叫 buildCardsHtml()。
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

/** @returns {Promise<string>} 完整 HTML */
export async function buildCardsHtml() {
  const r = await build({
    entryPoints: [fileURLToPath(new URL('public/ui/cards/mcp-app.js', root))],
    bundle: true, minify: true, format: 'esm', write: false, target: 'es2020', legalComments: 'none', logLevel: 'silent',
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = (await readFile(new URL('public/ui/cards/cards.css', root), 'utf8')).replace(/<\/style/gi, '<\\/style');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>阿幫卡片</title>
<style>${css}
html,body{margin:0;background:transparent;font-family:-apple-system,"PingFang TC","Noto Sans TC",sans-serif}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${js}</script>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = await buildCardsHtml();
  await mkdir(new URL('dist/', root), { recursive: true });
  await writeFile(new URL('dist/cards.html', root), html);
  console.log(`dist/cards.html  ${(html.length / 1024).toFixed(1)} KB`);
}
