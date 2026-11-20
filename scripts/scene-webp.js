// 公車街景 PNG → WebP（Blender 輸出 PNG 後執行；Chromium canvas 編碼、保留透明，約小 70～90%）
/* global Image, document -- 下面 page.evaluate 裡的程式在瀏覽器執行 */
//   Blender --background --factory-startup --python scripts/blender/bus-scene.py -- public/img/scene && node scripts/scene-webp.js
import { chromium } from 'playwright';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/img/scene/', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of ['street', 'bus']) {
  const png = await readFile(`${dir}${name}.png`);
  const url = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.88);
  }, png.toString('base64'));
  await writeFile(`${dir}${name}.webp`, Buffer.from(url.split(',')[1], 'base64'));
  await rm(`${dir}${name}.png`);
}
await browser.close();
console.log('scene webp written');
