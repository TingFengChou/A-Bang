// App 品牌（Abang）一致性：名稱在各平台一致、圖示檔存在且尺寸正確（App Store／Play 上架規格）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url));
/** PNG 寬高與是否有 alpha（IHDR：寬 16、高 20、color type 25） */
async function png(p) {
  const b = await read(p);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: [4, 6].includes(b[25]) };
}

/** 解開 8 位元 RGBA 的 PNG（Playwright 截圖的格式），回傳每個像素的 alpha */
async function alphaOf(p) {
  const b = await read(p);
  assert.equal(b[24], 8, p); assert.equal(b[25], 6, `${p} 要是 RGBA`);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), idat = [];
  for (let o = 8; o < b.length;) { const len = b.readUInt32BE(o); if (b.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      px[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + pred) & 255;
    }
  }
  return { w, h, alpha: (x, y) => px[y * stride + x * 4 + 3] };
}
/** 不透明像素離畫布中心最遠多少（單位：畫布邊長的比例）、共有幾個 */
async function extent(p) {
  const { w, h, alpha } = await alphaOf(p);
  let far = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(x, y) > 16) { n++; far = Math.max(far, Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2)); }
  return { far: far / w, n, w, h, alpha };
}

test('App 名稱 Abang：Capacitor、Android、iOS、PWA、頁面標題一致', async () => {
  assert.equal(JSON.parse(await read('capacitor.config.json')).appName, 'Abang');
  assert.match(String(await read('android/app/src/main/res/values/strings.xml')), /<string name="app_name">Abang<\/string>/);
  assert.match(String(await read('ios/App/App/Info.plist')), /<key>CFBundleDisplayName<\/key>\s*<string>Abang<\/string>/);
  assert.equal(JSON.parse(await read('public/manifest.webmanifest')).short_name, 'Abang');
  assert.match(String(await read('public/index.html')), /<title>Abang<\/title>/);
});

test('App 圖示：網頁 192／512、iOS 1024 不透明、Android 各密度（含自適應前景、背景、主題單色）', async () => {
  assert.deepEqual(await png('public/icons/icon-192.png'), { w: 192, h: 192, alpha: true });
  assert.deepEqual((await png('public/icons/icon-512.png')).w, 512);
  assert.deepEqual(await png('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), { w: 1024, h: 1024, alpha: false }, 'App Store：1024、不能透明');
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    assert.equal((await png(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`)).w, 48 * k, d);
    for (const layer of ['foreground', 'background', 'monochrome']) assert.equal((await png(`android/app/src/main/res/mipmap-${d}/ic_launcher_${layer}.png`)).w, 108 * k, `${d} ${layer}`);
  }
  assert.match(String(await read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')), /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"\/>/);
});

test('App 圖示是 Λ 標誌（不是藍鵲）：SVG 由 build-brand.py 產生，吉祥物檔案還在', async () => {
  for (const f of ['icon.svg', 'icon-square.svg', 'icon-fg.svg', 'icon-mono.svg']) {
    const svg = String(await read(`public/brand/${f}`));
    assert.match(svg, /<path d="M150 384 L256 136 L362 384"/, `${f} 要有 Λ`);
    assert.doesNotMatch(svg, /#3B82C4|#1F2A44/i, `${f} 不放藍鵲`);
  }
  assert.doesNotMatch(String(await read('public/brand/icon-bg.svg')), /<path|<circle/, '背景只有漸層與光暈');
  assert.doesNotMatch(String(await read('public/brand/icon-mono.svg')), /r="176"|url\(/, '單色圖示只有 Λ 與核心，沒有軌道與漸層');
  assert.equal(String(await read('public/icons/icon.svg')), String(await read('public/brand/icon.svg')), 'favicon 與 brand/icon.svg 同步');
  for (const f of ['abang-default.svg', 'abang-think.svg', 'abang-happy.svg']) assert.match(String(await read(`public/brand/${f}`)), /#3B82C4/, `${f}：App 內的吉祥物仍是藍鵲`);
});

test('Android 自適應圖示：前景與主題單色都在 66dp 安全區內（圓形與各種遮罩裁不到）、背景鋪滿', async () => {
  const SAFE = 33 / 108; // 安全區半徑 33dp／畫布 108dp
  const fg = await extent('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png');
  assert.ok(fg.n > 0 && fg.far < SAFE, `前景最遠 ${(fg.far * 108).toFixed(1)}dp`);
  assert.ok(fg.far > 24 / 108, '前景不能縮得太小');
  const mono = await extent('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_monochrome.png');
  assert.ok(mono.n > 0 && mono.far < SAFE, `單色最遠 ${(mono.far * 108).toFixed(1)}dp`);
  assert.equal(mono.alpha(4, 4), 0, '單色圖示是剪影，四周透明');
  assert.deepEqual(await png('android/app/src/main/res/mipmap-mdpi/ic_launcher_background.png'), { w: 108, h: 108, alpha: false }, '背景整張不透明');
});

test('iOS 18 深色與著色圖示：1024、透明底；網頁 maskable 與 apple-touch-icon 是方形不透明版', async () => {
  for (const f of ['AppIcon-dark.png', 'AppIcon-tinted.png']) {
    const i = await alphaOf(`ios/App/App/Assets.xcassets/AppIcon.appiconset/${f}`);
    assert.deepEqual([i.w, i.h], [1024, 1024], f);
    assert.equal(i.alpha(8, 8), 0, `${f} 四角透明`);
    assert.equal(i.alpha(512, 280), 255, `${f} Λ 的頂端在中間偏上`);
  }
  for (const [f, size] of [['public/icons/icon-maskable-512.png', 512], ['public/icons/apple-touch-icon.png', 180]]) {
    assert.deepEqual(await png(f), { w: size, h: size, alpha: false }, `${f} 整張不透明`);
  }
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  for (const i of manifest.icons) await read(`public${i.src}`);
  assert.equal(manifest.icons.find((i) => i.purpose === 'maskable').src, '/icons/icon-maskable-512.png');
  assert.match(String(await read('public/index.html')), /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
});

test('Android 通知小圖示：設定指到的 ic_stat_abang 各密度都有（24dp、剪影、透明底）', async () => {
  const cfg = JSON.parse(await read('capacitor.config.json')).plugins.LocalNotifications;
  assert.equal(cfg.smallIcon, 'ic_stat_abang');
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const i = await extent(`android/app/src/main/res/drawable-${d}/${cfg.smallIcon}.png`);
    assert.equal(i.w, 24 * k, d);
    assert.ok(i.n > 0 && i.alpha(0, 0) === 0, `${d} 有剪影、角落透明`);
  }
});

test('啟動畫面：各尺寸都有；Android 12+ 的圖示在系統露出的圓內', async () => {
  for (const [d, [w, h]] of Object.entries({ mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] })) {
    assert.deepEqual(await png(`android/app/src/main/res/drawable-port-${d}/splash.png`), { w, h, alpha: false }, d);
    assert.deepEqual(await png(`android/app/src/main/res/drawable-land-${d}/splash.png`), { w: h, h: w, alpha: false }, d);
  }
  assert.equal((await png('ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png')).w, 2732);
  // 288dp 畫布，內容要在系統露出的 192dp 圓內（半徑 96dp）
  const s = await extent('android/app/src/main/res/drawable-mdpi/splash_icon.png');
  assert.equal(s.w, 288);
  assert.ok(s.far < 96 / 288 && s.far > 70 / 288, `splash_icon 最遠 ${(s.far * 288).toFixed(1)}dp`);
});
