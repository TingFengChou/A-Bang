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

/** 啟動畫面（M11-04）：淺色底、藍鵲置中、下方 Abang 字樣；iOS 用 aspect fill 裁切，主體放在中間安全區 */
const SPLASH_BG = '#F4F6F5';
async function renderSplash(page, mascot, w, h) {
  const m = Math.round(Math.min(w, h) * 0.34);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${SPLASH_BG};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,'Noto Sans TC',sans-serif">
    <div style="width:${m}px;height:${m}px">${mascot.replace('<svg ', `<svg width="${m}" height="${m}" `)}</div>
    <div style="margin-top:${Math.round(m * 0.08)}px;font-size:${Math.round(m * 0.2)}px;font-weight:800;color:#0F766E;letter-spacing:.02em">Abang</div></body></html>`);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
}

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
// 啟動畫面：iOS（2732 方形，三種倍率同一張）、Android 舊版（直橫各密度；Android 12+ 用系統啟動畫面：背景色＋圖示，見 styles.xml）
const mascot = await svgOf('abang-default.svg');
const iosSplash = await renderSplash(page, mascot, 2732, 2732);
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await out(`ios/App/App/Assets.xcassets/Splash.imageset/${f}`, iosSplash);
const ANDROID_SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(ANDROID_SPLASH)) {
  await out(`android/app/src/main/res/drawable-port-${d}/splash.png`, await renderSplash(page, mascot, w, h));
  await out(`android/app/src/main/res/drawable-land-${d}/splash.png`, await renderSplash(page, mascot, h, w));
}
await out('android/app/src/main/res/drawable/splash.png', await renderSplash(page, mascot, 480, 320));

await browser.close();
console.log('icons written');