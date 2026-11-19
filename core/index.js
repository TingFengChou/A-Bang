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
import { createAntifraudServices } from './services/antifraud.js';
import { createMockAntifraudServices } from './services/antifraud-mock.js';
import { createOpenDataClient } from './opendata-client.js';
import { createLifeServices, createLiveLifeFetchers } from './services/life.js';
import { createMockLifeServices, demoLifeFetchersFor } from './services/life-mock.js';

/**
 * @param {{ clientId?: string, clientSecret?: string, cwaKey?: string, moenvKey?: string, openData?: boolean, forceMock?: boolean, log?: Function, demo?: { traffic?: 'smooth'|'jam', weather?: 'clear'|'rain', air?: 'good'|'bad' } }} [opts]
 *   openData：免金鑰的政府開放資料（165 防詐）用真實下載；預設 false（測試不連網），伺服器由 loadEnv 決定
 *   cwaKey：中央氣象署授權碼；沒有時天氣用示範資料（與 TDX 金鑰各自獨立）
 *   demo：示範模式情境（docs/TESTING.md §4），測試以參數注入，手動展示用環境變數
 */
export function createServices({ clientId, clientSecret, cwaKey, moenvKey, openData = false, forceMock = false, log, demo = {} } = {}) {
  const live = Boolean(clientId && clientSecret) && !forceMock;
  const tdx = live ? createTdxClient({ clientId, clientSecret, log }) : null;
  const transit = live ? createTransitServices(tdx) : createMockTransitServices();
  const metro = live ? createMetroServices(tdx) : createMockMetroServices();
  const traffic = live ? createTrafficServices(tdx) : createMockTrafficServices({ scenario: demo.traffic });
  const intercity = live ? createIntercityServices(tdx, traffic) : createMockIntercityServices(traffic);
  const booking = live ? createBookingServices(tdx, transit) : createMockBookingServices(transit);
  const weatherLive = Boolean(cwaKey) && !forceMock;
  const cwa = weatherLive ? createCwaClient({ apiKey: cwaKey }) : null;
  const weather = cwa ? createWeatherServices(cwa) : createMockWeatherServices({ scenario: demo.weather });

  const antifraudLive = openData && !forceMock;
  // 生活服務（M10）：免金鑰的開放資料跟著 openData；空品要環境部金鑰、地震要氣象署授權碼，沒有就用示範片段
  const life = antifraudLive
    ? createLifeServices(createLiveLifeFetchers({ od: createOpenDataClient(), cwa, moenvKey: forceMock ? null : moenvKey, demo: demoLifeFetchersFor({ air: demo.air }) }))
    : createMockLifeServices({ air: demo.air });
  const antifraud = antifraudLive ? createAntifraudServices() : createMockAntifraudServices();

  return {
    mode: live ? 'live' : 'demo',
    weatherMode: weatherLive ? 'live' : 'demo',
    antifraudMode: antifraudLive ? 'live' : 'demo',
    openDataMode: antifraudLive ? 'live' : 'demo', // 免金鑰開放資料（藥局、垃圾車、油價、發票）
    aqiMode: antifraudLive && moenvKey ? 'live' : 'demo',
    quakeMode: antifraudLive && cwa ? 'live' : 'demo',
    ...transit, // bus, bike, rail
    ...metro, // metro
    ...traffic, // traffic
    ...intercity, // intercity（依賴 traffic 算延誤）
    ...weather, // weather（中央氣象署，金鑰獨立）
    places: createPlaceServices(), // 內建地標，live 與示範相同
    ...booking, // booking：導訂票（⛔ 權限前 live 回「尚未開通」）
    ...createRidehailServices(), // ridehail：只產生官方連結，live 與示範相同（ADR-0011）
    ...life, // life：空品、地震、藥局、垃圾車、油價、發票（M10）
    ...antifraud, // antifraud：165 開放資料（免金鑰；DEMO_MODE=1 時用示範片段，M7）
  };
}

/** 讀取 .env（不依賴 dotenv） */
/**
 * 各類資料目前是真實資料還是示範資料（給 /api/v1/status 與網頁標示用；不含金鑰或環境變數名稱）。
 * id 對應首頁格子的 `source`。
 * @param {ReturnType<typeof createServices>} svc
 * @returns {Array<{ id: string, name: string, mode: 'live'|'demo' }>}
 */
export function dataSources(svc) {
  return [
    { id: 'transit', name: '交通', mode: svc.mode }, // 公車、捷運、高鐵、台鐵、YouBike、客運、路況（TDX）
    { id: 'weather', name: '天氣', mode: svc.weatherMode },
    { id: 'aqi', name: '空氣品質', mode: svc.aqiMode },
    { id: 'quake', name: '地震', mode: svc.quakeMode },
    { id: 'opendata', name: '藥局、垃圾車、油價、發票', mode: svc.openDataMode },
    { id: 'antifraud', name: '防詐', mode: svc.antifraudMode },
  ];
}

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
    moenvKey: process.env.MOENV_API_KEY, // 環境部開放資料平臺 api_key（空氣品質）
    openData: process.env.OPEN_DATA !== '0', // 免金鑰開放資料（165 防詐）；OPEN_DATA=0 或 DEMO_MODE=1 時用示範片段
    demo: { traffic: process.env.DEMO_TRAFFIC || undefined, weather: process.env.DEMO_WEATHER || undefined, air: process.env.DEMO_AIR || undefined },
  };
}
