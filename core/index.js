// 核心入口：依是否有 TDX 金鑰，回傳真實或示範資料的服務。
// App 的 HTTP API 與 MCP Server 都只依賴這裡，新增資料領域時在此註冊即可。
import { createTdxClient } from './tdx-client.js';
import { createTransitServices } from './services/transit.js';
import { createMockTransitServices } from './services/transit-mock.js';
import { createPlaceServices } from './services/places.js';

export function createServices({ clientId, clientSecret, forceMock = false, log } = {}) {
  const live = Boolean(clientId && clientSecret) && !forceMock;
  const transit = live
    ? createTransitServices(createTdxClient({ clientId, clientSecret, log }))
    : createMockTransitServices();

  return {
    mode: live ? 'live' : 'demo',
    ...transit, // bus, bike, rail
    places: createPlaceServices(), // 內建地標，live 與示範相同
    // 之後的領域在這裡加入，例如：
    // weather: createWeatherServices(cwaKey),   // 中央氣象署 opendata.cwa.gov.tw
    // env:     createAqiServices(moenvKey),     // 環境部 AQI
    // health:  createPharmacyServices(),        // 健保特約藥局
  };
}

/** 讀取 .env（不依賴 dotenv） */
export async function loadEnv(path = new URL('../.env', import.meta.url)) {
  try {
    const { readFile } = await import('node:fs/promises');
    const txt = await readFile(path, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* 沒有 .env 就略過 */ }
  return {
    clientId: process.env.TDX_CLIENT_ID,
    clientSecret: process.env.TDX_CLIENT_SECRET,
    forceMock: process.env.DEMO_MODE === '1',
  };
}
