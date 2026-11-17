// 核心入口：依是否有 TDX 金鑰，回傳真實或示範資料的服務。
// App 的 HTTP API 與 MCP Server 都只依賴這裡，新增資料領域時在此註冊即可。
import { createTdxClient } from './tdx-client.js';
import { createTransitServices } from './services/transit.js';
import { createMockTransitServices } from './services/transit-mock.js';
import { createPlaceServices } from './services/places.js';
import { createMetroServices } from './services/metro.js';
import { createMockMetroServices } from './services/metro-mock.js';
import { createTrafficServices } from './services/traffic.js';
import { createMockTrafficServices } from './services/traffic-mock.js';
import { createIntercityServices } from './services/intercity.js';
import { createMockIntercityServices } from './services/intercity-mock.js';
import { createCwaClient } from './cwa-client.js';
import { createWeatherServices } from './services/weather.js';
import { createMockWeatherServices } from './services/weather-mock.js';
import { createRidehailServices } from './providers/ridehail/index.js';
import { createBookingServices } from './services/booking.js';
import { createMockBookingServices } from './services/booking-mock.js';

/**
 * @param {{ clientId?: string, clientSecret?: string, cwaKey?: string, forceMock?: boolean, log?: Function, demo?: { traffic?: 'smooth'|'jam', weather?: 'clear'|'rain' } }} [opts]
 *   cwaKey：中央氣象署授權碼；沒有時天氣用示範資料（與 TDX 金鑰各自獨立）
 *   demo：示範模式情境（docs/TESTING.md §4），測試以參數注入，手動展示用環境變數
 */
export function createServices({ clientId, clientSecret, cwaKey, forceMock = false, log, demo = {} } = {}) {
  const live = Boolean(clientId && clientSecret) && !forceMock;
  const tdx = live ? createTdxClient({ clientId, clientSecret, log }) : null;
  const transit = live ? createTransitServices(tdx) : createMockTransitServices();
  const metro = live ? createMetroServices(tdx) : createMockMetroServices();
  const traffic = live ? createTrafficServices(tdx) : createMockTrafficServices({ scenario: demo.traffic });
  const intercity = live ? createIntercityServices(tdx, traffic) : createMockIntercityServices(traffic);
  const booking = live ? createBookingServices(tdx, transit) : createMockBookingServices(transit);
  const weatherLive = Boolean(cwaKey) && !forceMock;
  const weather = weatherLive ? createWeatherServices(createCwaClient({ apiKey: cwaKey })) : createMockWeatherServices({ scenario: demo.weather });

  return {
    mode: live ? 'live' : 'demo',
    weatherMode: weatherLive ? 'live' : 'demo',
    ...transit, // bus, bike, rail
    ...metro, // metro
    ...traffic, // traffic
    ...intercity, // intercity（依賴 traffic 算延誤）
    ...weather, // weather（中央氣象署，金鑰獨立）
    places: createPlaceServices(), // 內建地標，live 與示範相同
    ...booking, // booking：導訂票（⛔ 權限前 live 回「尚未開通」）
    ...createRidehailServices(), // ridehail：只產生官方連結，live 與示範相同（ADR-0011）
    // 之後的領域在這裡加入，例如：
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
    cwaKey: process.env.CWA_API_KEY,
    demo: { traffic: process.env.DEMO_TRAFFIC || undefined, weather: process.env.DEMO_WEATHER || undefined },
  };
}
