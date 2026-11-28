// 產生 core/data/towns.json（行政區名稱與代表點；2026-11-28 第十一輪）：find_place、規則模式認得「去新莊」「汐止會下雨嗎」。
// 資料：內政部戶政事務所據點（開放資料，M16-04b 已在用）——各區戶政事務所的座標當那一區的代表點，跟預設地區（T-HOMEAREA）同一套。
// 用法：node scripts/build-towns.js（要連網；結果進 repo，執行時不再下載）
import { writeFile } from 'node:fs/promises';
import { createOpenDataClient } from '../core/opendata-client.js';
import { createLiveGovOfficeFetchers, areasOf } from '../core/services/govoffice.js';
import { resolveCity } from '../core/cities.js';

const offices = await createLiveGovOfficeFetchers({ od: createOpenDataClient() }).offices();
const areas = areasOf(offices);
const items = areas.flatMap((c) => c.towns.map((t) => ({ county: c.county, town: t.town, city: resolveCity(c.county)?.city || null, lat: t.lat, lon: t.lon })));
const out = { version: 1, source: '內政部戶政事務所據點（開放資料）；各區戶政事務所座標當代表點（不是區的中心）', updated: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), items };
await writeFile(new URL('../core/data/towns.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{')}\n`);
console.log(`towns.json：${items.length} 區`);
