// App 圖示 PNG（Abang）：把 scripts/build-brand.py 產生的 SVG 轉成網頁、Android、iOS 需要的尺寸。
// 用 Playwright 的 Chromium 算圖（已是 devDependency，不加新套件）。改圖示：先 python3 scripts/build-brand.py，再 node scripts/build-icons.js。
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const svgOf = (name) => readFile(root(`public/brand/${name}`), 'utf8');
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** @returns {Promise<Buffer>} */
async function render(page, svg, size, { round = false, mono = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${round ? 'border-radius:50%;overflow:hidden;' : ''}${mono ? 'filter:brightness(0);' : ''}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const out = async (path, buf) => { await mkdir(root(path).replace(/\/[^/]+$/, ''), { recursive: true }); await writeFile(root(path), buf); };

const browser = await chromium.launch();
const page = await browser.newPage();
const [icon, square, fg, bg] = await Promise.all(['icon.svg', 'icon-square.svg', 'icon-fg.svg', 'icon-bg.svg'].map(svgOf));
await out('public/icons/icon-192.png', await render(page, icon, 192));
await out('public/icons/icon-512.png', await render(page, icon, 512));
await out('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await render(page, square, 1024)); // iOS：方形、不透明
for (const [d, k] of Object.entries(DENSITY)) {
  const dir = `android/app/src/main/res/mipmap-${d}`;
  await out(`${dir}/ic_launcher.png`, await render(page, icon, 48 * k));
  await out(`${dir}/ic_launcher_round.png`, await render(page, square, 48 * k, { round: true }));
  await out(`${dir}/ic_launcher_foreground.png`, await render(page, fg, 108 * k));
  await out(`${dir}/ic_launcher_background.png`, await render(page, bg, 108 * k));
  await out(`${dir}/ic_launcher_monochrome.png`, await render(page, fg, 108 * k, { mono: true })); // Android 13+ 主題圖示（單色剪影）
}
await browser.close();
console.log('icons written');
