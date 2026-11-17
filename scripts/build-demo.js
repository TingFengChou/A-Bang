// 產生單一 HTML 的離線 Demo（dist/demo.html），可直接開啟或分享，不需後端與金鑰
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const r = await build({
  stdin: { contents: "import './scripts/demo-setup.js'; import './public/js/app.js';", resolveDir: root.pathname, loader: 'js' },
  bundle: true, minify: true, format: 'esm', write: false, target: 'es2020',
});
const mascot = Buffer.from(await readFile(new URL('public/brand/abang-default.svg', root))).toString('base64');
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script').replaceAll('/brand/abang-default.svg', `data:image/svg+xml;base64,${mascot}`);
const css = await readFile(new URL('public/css/app.css', root), 'utf8');
const icon = Buffer.from(await readFile(new URL('public/icons/icon.svg', root))).toString('base64');
const html = (await readFile(new URL('public/index.html', root), 'utf8'))
  .replace(/<link rel="(manifest|apple-touch-icon)"[^>]*>\n?\s*/g, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${icon}">`)
  .replace(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`)
  .replace(/<script type="module" src="[^"]*"><\/script>/, `<script type="module">${js}</script>`)
  .replace('<title>阿幫</title>', '<title>阿幫（Demo）</title>');
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/demo.html', root), html);
console.log(`dist/demo.html  ${(html.length / 1024).toFixed(1)} KB`);
