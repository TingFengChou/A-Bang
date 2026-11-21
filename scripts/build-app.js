// 手機 App 的前端打包（ADR-0013）：把 public/ 原樣複製到 dist/app/，加上伺服器另外提供的檔案（GSAP、共用核心），
// 並在 index.html 注入 API 位址與 App 旗標。之後 `npx cap sync` 會把 dist/app 放進 Android／iOS 專案。
//   ABANG_API_BASE=https://abang.example.tw npm run build:app
// 正式版必須是 https；沒有設定時用開發預設 http://localhost:8787（Android 模擬器先 adb reverse tcp:8787 tcp:8787；WebView 對 localhost 不擋混合內容）。
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const OUT = root('dist/app');
// 與 server/http.js 的白名單相同（/vendor/、/core/）
const VENDOR = ['gsap.min.js', 'MotionPathPlugin.min.js', 'Flip.min.js'];
const CORE = ['decide.js', 'vision-text.js', 'edge-write.js', 'output-guards.js'];

/** 驗證並正規化 API 位址：只收 http(s)、去掉結尾斜線；正式版（APP_RELEASE=1）只收 https */
export function apiBase(raw, { release = false } = {}) {
  const v = String(raw || '').trim().replace(/\/+$/, '');
  if (!v) throw new Error('請設定 ABANG_API_BASE（例：https://abang.example.tw）');
  const u = new URL(v);
  if (!/^https?:$/.test(u.protocol)) throw new Error('ABANG_API_BASE 只能是 http 或 https');
  if (release && u.protocol !== 'https:') throw new Error('正式版的 ABANG_API_BASE 必須是 https');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('ABANG_API_BASE 只填網域（不要路徑或參數）');
  return u.origin;
}

/** 在 </head> 前注入設定（JSON.stringify 後再跳脫 <，避免網址裡的字元結束 script） */
export function injectConfig(html, base) {
  const js = `window.__ABANG_API_BASE__=${JSON.stringify(base).replace(/</g, '\\u003c')};window.__ABANG_APP__=true;`;
  if (!html.includes('</head>')) throw new Error('index.html 找不到 </head>');
  return html.replace('</head>', `  <script>${js}</script>\n</head>`);
}

async function main() {
  const base = apiBase(process.env.ABANG_API_BASE || 'http://localhost:8787', { release: process.env.APP_RELEASE === '1' });
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(root('public'), OUT, { recursive: true });
  await rm(`${OUT}/sw.js`, { force: true }); // App 內不用 service worker
  await mkdir(`${OUT}/vendor`, { recursive: true });
  for (const f of VENDOR) await cp(root(`node_modules/gsap/dist/${f}`), `${OUT}/vendor/${f}`);
  await mkdir(`${OUT}/core`, { recursive: true });
  for (const f of CORE) await cp(root(`core/${f}`), `${OUT}/core/${f}`);
  const html = await readFile(`${OUT}/index.html`, 'utf8');
  await writeFile(`${OUT}/index.html`, injectConfig(html, base));
  console.log(`dist/app 完成（API：${base}）`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
