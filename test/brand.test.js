// App 品牌（Abang）一致性：名稱在各平台一致、圖示檔存在且尺寸正確（App Store／Play 上架規格）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url));
/** PNG 寬高與是否有 alpha（IHDR：寬 16、高 20、color type 25） */
async function png(p) {
  const b = await read(p);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: [4, 6].includes(b[25]) };
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
