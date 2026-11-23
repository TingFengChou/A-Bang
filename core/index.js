// 核心入口：依是否有 TDX 金鑰，回傳真實或示範資料的服務。
// App 的 HTTP API 與 MCP Server 都只依賴這裡，新增資料領域時在此註冊即可。
import { createTdxClient, TDX_LIMIT } from './tdx-client.js';
import { createFileStore } from './tdx-store.js';
import { startTdxPrewarm } from './tdx-prewarm.js';
import { INDEX_CITIES, transitWarmSteps } from './services/transit-data.js';
import { railWarmSteps } from './services/transit.js';
import { metroWarmSteps } from './services/metro.js';
import { fileURLToPath } from 'node:url';
import { resolveCity } from './cities.js';
import { markFallback } from './metrics.js';
import { createTransitServices } from './services/transit.js';
import { createMockTransitServices } from './services/transit-mock.js';
import { createPlaceServices } from './services/places.js';
import { createMetroServices } from './services/metro.js';
import { createMockMetroServices } from './services/metro-mock.js';
import { createTrafficServices } from './services/traffic.js';
import { createMockTrafficServices } from './services/traffic-mock.js';
import { createParkingServices } from './services/parking.js';
import { createMockParkingServices } from './services/parking-mock.js';
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
import { createStockServices, createLiveStockFetchers } from './services/stock.js';
import { createMockStockServices } from './services/stock-mock.js';
import { createDramaServices, createLiveDramaFetchers } from './services/drama.js';
import { createMockDramaServices } from './services/drama-mock.js';

/**
 * @param {{ clientId?: string, clientSecret?: string, cwaKey?: string, moenvKey?: string, openData?: boolean, forceMock?: boolean, log?: Function, demo?: { traffic?: 'smooth'|'jam', weather?: 'clear'|'rain', air?: 'good'|'bad', bus?: 'off'|'offLive' }, drama?: { apiBase?: string, links?: object } }} [opts]
 *   drama：MyDrama 短劇（ADR-0019）；apiBase 沒設定時用虛構的示範片庫；links＝深層連結與商店頁範本（環境變數）
 *   openData：免金鑰的政府開放資料（165 防詐）用真實下載；預設 false（測試不連網），伺服器由 loadEnv 決定
 *   cwaKey：中央氣象署授權碼；沒有時天氣用示範資料（與 TDX 金鑰各自獨立）
 *   demo：示範模式情境（docs/TESTING.md §4），測試以參數注入，手動展示用環境變數
 */
/**
 * TDX 額度用完（429）時，這一次改用示範資料，不讓整個查詢失敗（2026-11-21：Austin 先不申請加值應用，新帳號每分鐘只有 5 次）。
 * 只包會回 Promise 的方法；工具結果會標成示範資料（metrics.fallback → mode: 'demo'）。
 */
export function withTdxFallback(live, mock, quota = null, path = '') {
  return new Proxy(live, {
    get(target, key) {
      const v = target[key];
      // 服務是分層的（transit.bus.routeEta、metro.metro.liveBoard）：子物件也包起來
      if (v && typeof v === 'object' && mock?.[key] && typeof mock[key] === 'object') return withTdxFallback(v, mock[key], quota, `${path}${String(key)}.`); // path：哪個服務的方法（bus.directTrips、rail.thsrTimetable），plan_trip 判斷哪些方案是示範資料
      if (typeof v !== 'function' || typeof mock?.[key] !== 'function') return v;
      return (...args) => {
        const out = v.apply(target, args);
        if (!out || typeof out.then !== 'function') return out;
        return out.catch((e) => {
          if (e?.name !== 'TdxError' || e.status !== 429) throw e;
          markFallback(key, `${path}${String(key)}`);
          if (quota && !e.yielded) quota.at = Date.now(); // 背景讓位（TdxYield）不是額度用完；「阿幫的腦袋」試判斷：資料來源照實說「TDX 額度剛用完，改用示範」（core/agent/trial.js）
          return mock[key](...args);
        });
      };
    },
  });
}

/**
 * TDX 額度（docs/DATA_SOURCES.md §1.1）：tdx.perMinute 每分鐘上限（預設 5，TDX 回應標頭會校正）；tdx.cacheDir 靜態資料存檔目錄（沒有就只放記憶體）；
 * tdx.cities 預熱與本機查附近站牌的縣市。預熱由伺服器呼叫 svc.tdxPrewarm() 開始（測試與 MCP stdio 不預熱）。
 */
export function createServices({ clientId, clientSecret, cwaKey, moenvKey, openData = false, forceMock = false, log, demo = {}, drama: dramaCfg = {}, tdx: tdxCfg = {} } = {}) {
  const live = Boolean(clientId && clientSecret) && !forceMock;
  const picked = (tdxCfg.cities || []).map((c) => resolveCity(c)?.city).filter(Boolean); // 只收認得的縣市（會放進 TDX 網址路徑）
  const cities = picked.length ? [...new Set(picked)] : INDEX_CITIES;
  const tdx = live ? createTdxClient({
    clientId, clientSecret, log,
    limit: { ...TDX_LIMIT, perMinute: tdxCfg.perMinute > 0 ? tdxCfg.perMinute : 5 },
    store: tdxCfg.cacheDir ? createFileStore(tdxCfg.cacheDir, { log }) : null,
  }) : null;
  const quota = { at: 0 }; // 最近一次 TDX 額度用完（429）的時間
  const transit = live ? withTdxFallback(createTransitServices(tdx, { cities }), createMockTransitServices(), quota) : createMockTransitServices({ bus: demo.bus });
  const metro = live ? withTdxFallback(createMetroServices(tdx), createMockMetroServices(), quota) : createMockMetroServices();
  const traffic = live ? withTdxFallback(createTrafficServices(tdx), createMockTrafficServices({ scenario: demo.traffic }), quota) : createMockTrafficServices({ scenario: demo.traffic });
  const antifraudLive = openData && !forceMock;
  // 生活服務（M10）：免金鑰的開放資料跟著 openData；空品要環境部金鑰、地震要氣象署授權碼，沒有就用示範片段
  const od = antifraudLive ? createOpenDataClient() : null;
  // 停車場：其他縣市走 TDX；台北市、新北市的停車場座標用市府開放資料（od，跟著 openData）
  const parking = live ? withTdxFallback(createParkingServices(tdx, { od }), createMockParkingServices(), quota) : createMockParkingServices();
  const intercity = live ? withTdxFallback(createIntercityServices(tdx, traffic), createMockIntercityServices(traffic), quota) : createMockIntercityServices(traffic);
  const booking = live ? createBookingServices(tdx, transit) : createMockBookingServices(transit);
  const weatherLive = Boolean(cwaKey) && !forceMock;
  const cwa = weatherLive ? createCwaClient({ apiKey: cwaKey }) : null;
  const weather = cwa ? createWeatherServices(cwa) : createMockWeatherServices({ scenario: demo.weather });

  const life = od
    ? createLifeServices(createLiveLifeFetchers({ od, cwa, moenvKey: forceMock ? null : moenvKey, demo: demoLifeFetchersFor({ air: demo.air }) }))
    : createMockLifeServices({ air: demo.air });
  const stock = od ? createStockServices(createLiveStockFetchers({ od })) : createMockStockServices(); // 股市收盤（證交所、櫃買中心，免金鑰）
  const antifraud = antifraudLive ? createAntifraudServices() : createMockAntifraudServices();
  // 短劇（ADR-0019）：MyDrama 公開讀取端點，網址只在環境變數；沒設定（或 DEMO_MODE=1）用虛構示範片庫
  const dramaFx = dramaCfg.apiBase && !forceMock ? createLiveDramaFetchers({ od: createOpenDataClient(), base: dramaCfg.apiBase }) : null;
  const drama = dramaFx ? createDramaServices(dramaFx, { links: dramaCfg.links }) : createMockDramaServices({ links: dramaCfg.links });

  return {
    mode: live ? 'live' : 'demo',
    weatherMode: weatherLive ? 'live' : 'demo',
    antifraudMode: antifraudLive ? 'live' : 'demo',
    openDataMode: antifraudLive ? 'live' : 'demo', // 免金鑰開放資料（藥局、垃圾車、油價、發票、股市）
    aqiMode: antifraudLive && moenvKey ? 'live' : 'demo',
    quakeMode: antifraudLive && cwa ? 'live' : 'demo',
    dramaMode: dramaFx ? 'live' : 'demo', // 短劇（MyDrama 公開片庫）
    demoForced: Boolean(forceMock), // 伺服器設定成只用示範資料（DEMO_MODE）：試判斷說明為什麼是示範資料
    tdxLimitedAt: () => quota.at || null, // 最近一次 TDX 額度用完（改用示範）的時間；沒有回 null
    // TDX 背景預熱（伺服器啟動後呼叫；示範模式為 null）：先台北的公車與 YouBike、北捷車站，再新北、桃園、台鐵高鐵
    tdxPrewarm: live ? (opts = {}) => {
      // 每分鐘上限 ≤ 2：預熱要留 2 次給使用者，等於永遠輪不到，直接停用並說清楚
      const per = tdxCfg.perMinute > 0 ? tdxCfg.perMinute : 5;
      if (per <= 2) { (opts.log || log || (() => {}))(`[tdx] 每分鐘上限 ${per} 次（≤ 2），背景預熱停用（要留 2 次給使用者）`); return null; }
      return startTdxPrewarm(tdx, prewarmSteps(tdx, cities), opts);
    } : null,
    tdxStats: () => (tdx ? { ...tdx.stats(), quota: tdx.quota() } : null), // 除錯：累計上游次數（只有端點類別）與這分鐘的額度
    ...transit, // bus, bike, rail
    ...metro, // metro
    ...traffic, // traffic
    ...intercity, // intercity（依賴 traffic 算延誤）
    ...parking, // parking（自己開車時目的地附近的停車場）
    ...weather, // weather（中央氣象署，金鑰獨立）
    places: createPlaceServices(), // 內建地標，live 與示範相同
    ...booking, // booking：導訂票（⛔ 權限前 live 回「尚未開通」）
    ...createRidehailServices(), // ridehail：只產生官方連結，live 與示範相同（ADR-0011）
    ...life, // life：空品、地震、藥局、垃圾車、油價、發票（M10）
    ...stock, // stock：上市櫃收盤行情與指數（finance 工具包）
    ...antifraud, // antifraud：165 開放資料（免金鑰；DEMO_MODE=1 時用示範片段，M7）
    ...drama, // drama：MyDrama 短劇排行、搜尋、簡介（ADR-0019）
  };
}

/** 預熱順序：第一個縣市的公車站牌、站序、YouBike 與北捷車站最先（最常用），路線起訖名稱與其他系統最後 */
function prewarmSteps(tdx, cities) {
  const t = transitWarmSteps(tdx, cities);
  const metro = metroWarmSteps(tdx);
  const main = t.filter((s) => !s.key.startsWith('bus-route-meta-'));
  const meta = t.filter((s) => s.key.startsWith('bus-route-meta-'));
  return [...main.slice(0, 3), metro[0], ...main.slice(3), ...railWarmSteps(tdx), ...metro.slice(1), ...meta];
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
    { id: 'opendata', name: '藥局、垃圾車、油價、發票、股市', mode: svc.openDataMode },
    { id: 'antifraud', name: '防詐', mode: svc.antifraudMode },
    { id: 'drama', name: '短劇（MyDrama）', mode: svc.dramaMode },
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
    // TDX 額度與快取（docs/DATA_SOURCES.md §1.1）：每分鐘上限、靜態資料存檔目錄（TDX_CACHE_DIR=off 不存檔）、預熱縣市
    tdx: {
      perMinute: Number(process.env.TDX_PER_MINUTE) || 5,
      cacheDir: process.env.TDX_CACHE_DIR === 'off' ? null : process.env.TDX_CACHE_DIR || fileURLToPath(new URL('../.cache/tdx/', import.meta.url)),
      cities: (process.env.TDX_PREWARM_CITIES || '').split(',').map((x) => x.trim()).filter(Boolean),
    },
    demo: { traffic: process.env.DEMO_TRAFFIC || undefined, weather: process.env.DEMO_WEATHER || undefined, air: process.env.DEMO_AIR || undefined, bus: process.env.DEMO_BUS || undefined },
    // MyDrama 短劇（ADR-0019）：網址、深層連結、商店頁都只放 .env（repo 是公開的）
    drama: {
      apiBase: process.env.MYDRAMA_API_BASE || undefined,
      links: { episode: process.env.MYDRAMA_LINK_EPISODE, exercise: process.env.MYDRAMA_LINK_EXERCISE, storeIos: process.env.MYDRAMA_STORE_IOS, storeAndroid: process.env.MYDRAMA_STORE_ANDROID },
    },
  };
}
