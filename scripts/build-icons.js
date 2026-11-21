// App 圖示 PNG（Abang）：把 scripts/build-brand.py 產生的 SVG 轉成網頁、Android、iOS 需要的尺寸。
// 圖示是 Λ 標誌（青綠漸層底、亮白薄荷色的 Λ、琥珀色核心、一圈軌道）；藍鵲是 App 內的吉祥物，不在圖示與啟動畫面上。
// 用 Playwright 的 Chromium 算圖（已是 devDependency，不加新套件）。改圖示：先 python3 scripts/build-brand.py，再 node scripts/build-icons.js。
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const svgOf = (name) => readFile(root(`public/brand/${name}`), 'utf8');
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const sized = (svg) => svg.replace('<svg ', '<svg width="100%" height="100%" style="display:block" ');

/**
 * 把一張 SVG 畫成 size×size 的 PNG（透明底）。
 * @param {{ round?: boolean, scale?: number, filter?: string }} [o] round：裁成圓形；scale：以中心放大（超出畫布的裁掉）；filter：CSS 濾鏡
 * @returns {Promise<Buffer>}
 */
async function render(page, svg, size, { round = false, scale = 1, filter = '' } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;overflow:hidden;${round ? 'border-radius:50%;' : ''}">
    <div style="width:100%;height:100%;${scale === 1 ? '' : `transform:scale(${scale});`}${filter ? `filter:${filter};` : ''}">${sized(svg)}</div></div></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const out = async (path, buf) => { await mkdir(root(path).replace(/\/[^/]+$/, ''), { recursive: true }); await writeFile(root(path), buf); };

/** 啟動畫面（M11-04）：淺色底、圓角圖示置中、下方 Abang 字樣（與桌面圖示一致，不放藍鵲）；iOS 用 aspect fill 裁切，主體放在中間安全區 */
const SPLASH_BG = '#F4F6F5';
async function renderSplash(page, logo, w, h) {
  const m = Math.round(Math.min(w, h) * (w === h ? 0.15 : 0.28)); // iOS 方形圖 aspect fill（手機只露出中間約 46% 寬）：主體小一點
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;background:${SPLASH_BG};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,'Noto Sans TC',sans-serif">
    <div style="width:${m}px;height:${m}px;filter:drop-shadow(0 ${Math.round(m * 0.05)}px ${Math.round(m * 0.1)}px rgba(11,59,57,.22))">${sized(logo)}</div>
    <div style="margin-top:${Math.round(m * 0.16)}px;font-size:${Math.round(m * 0.27)}px;font-weight:800;color:#0F766E;letter-spacing:.02em">Abang</div></body></html>`);
  return page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
}

/** 透明畫布正中央放一張比較小的圖（Android 12+ 系統啟動畫面圖示） */
async function renderCentered(page, svg, size, ratio) {
  const m = Math.round(size * ratio);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;background:transparent;display:flex;align-items:center;justify-content:center"><div style="width:${m}px;height:${m}px">${sized(svg)}</div></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const browser = await chromium.launch();
const page = await browser.newPage();
const [icon, square, fg, bg, mono] = await Promise.all(['icon.svg', 'icon-square.svg', 'icon-fg.svg', 'icon-bg.svg', 'icon-mono.svg'].map(svgOf));

// 網頁：圓角圖示 192／512；maskable（Android 主畫面自己套遮罩）與 apple-touch-icon（iOS 自己套圓角，透明的角會變黑）用方形不透明版
await out('public/icons/icon-192.png', await render(page, icon, 192));
await out('public/icons/icon-512.png', await render(page, icon, 512));
await out('public/icons/icon-maskable-512.png', await render(page, square, 512));
await out('public/icons/apple-touch-icon.png', await render(page, square, 180));

// iOS：方形、不透明。iOS 18 深色與著色圖示（T6）：透明背景（系統補深色底），只放 Λ、核心與軌道。
// 前景圖是 Android 自適應圖示的大小（縮成 2/3）：放大 1.5 倍就和淺色圖示的位置、大小完全一樣。
// 深色：標誌本來就是亮色（白薄荷 Λ、琥珀核心），不必換色；著色：灰階（Λ 最亮、核心次之、軌道最淡），系統依使用者選的顏色上色。
const IOS = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
const IOS_FG = 1.5;
await out(`${IOS}/AppIcon-512@2x.png`, await render(page, square, 1024));
await out(`${IOS}/AppIcon-dark.png`, await render(page, fg, 1024, { scale: IOS_FG }));
await out(`${IOS}/AppIcon-tinted.png`, await render(page, fg, 1024, { scale: IOS_FG, filter: 'grayscale(1)' }));

// Android：舊版圖示（圓角、圓形）＋自適應圖示（前景、背景）＋ Android 13+ 主題圖示（單色剪影：Λ＋核心，系統只看透明度）
for (const [d, k] of Object.entries(DENSITY)) {
  const dir = `android/app/src/main/res/mipmap-${d}`;
  await out(`${dir}/ic_launcher.png`, await render(page, icon, 48 * k));
  await out(`${dir}/ic_launcher_round.png`, await render(page, square, 48 * k, { round: true }));
  await out(`${dir}/ic_launcher_foreground.png`, await render(page, fg, 108 * k));
  await out(`${dir}/ic_launcher_background.png`, await render(page, bg, 108 * k));
  await out(`${dir}/ic_launcher_monochrome.png`, await render(page, mono, 108 * k));
  // 通知小圖示（狀態列，24dp）：白色 Λ＋核心剪影，四周留約 2dp；capacitor.config.json 的 LocalNotifications.smallIcon 指到這張
  await out(`android/app/src/main/res/drawable-${d}/ic_stat_abang.png`, await render(page, mono, 24 * k, { scale: 2, filter: 'invert(1)' }));
}

// 啟動畫面：iOS（2732 方形，三種倍率同一張）、Android 舊版（直橫各密度；Android 12+ 用系統啟動畫面：背景色＋圖示，見 styles.xml）
const iosSplash = await renderSplash(page, icon, 2732, 2732);
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) await out(`ios/App/App/Assets.xcassets/Splash.imageset/${f}`, iosSplash);
const ANDROID_SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(ANDROID_SPLASH)) {
  await out(`android/app/src/main/res/drawable-port-${d}/splash.png`, await renderSplash(page, icon, w, h));
  await out(`android/app/src/main/res/drawable-land-${d}/splash.png`, await renderSplash(page, icon, h, w));
}
await out('android/app/src/main/res/drawable/splash.png', await renderSplash(page, icon, 480, 320));
// Android 12+ 系統啟動畫面圖示：288dp 透明畫布，系統只露出中間直徑 192dp 的圓。底色是淺色，白色的 Λ 單獨放會看不到，
// 所以放整個圓角圖示（邊長 150dp，四個角離中心約 93dp，在 96dp 半徑內）
for (const [d, k] of Object.entries(DENSITY)) await out(`android/app/src/main/res/drawable-${d}/splash_icon.png`, await renderCentered(page, icon, Math.round(288 * k), 150 / 288));

await browser.close();
console.log('icons written');
