// REST 路由表（唯一定義）：server/http.js 用它處理請求，server/openapi.js 用它產生 Swagger 文件。
// PWA 既有頁面使用；新功能請優先走 /api/v1/tools/:name。
import { listTools, listPacks, describeTool, callTool } from '../core/tools/index.js';
import { alightCheck } from '../core/alight.js';
import { getProfile, hasProfile, PROFILES } from '../core/agents/index.js';
import { UserError, isDate } from '../core/util.js';
import { measure } from '../core/metrics.js';
import { dataSources } from '../core/index.js';
import { TOOL_ROLES } from '../core/agent/events.js';
import { remindAside } from '../core/agent/wait-drama.js';

const num = (v) => (v == null || v === '' ? undefined : Number(v));
const q = (name, description, { required = false, type = 'string', format, min, example } = {}) => ({ name, description, required, type, ...(format && { format }), ...(min !== undefined && { minimum: min }), ...(example !== undefined && { example }) });
const CITY = q('city', '縣市，例如 Taipei、台北市', { required: true, example: 'Taipei' });
const LAT = q('lat', '緯度 (WGS84)', { required: true, type: 'number', example: 25.0478 });
const LON = q('lon', '經度 (WGS84)', { required: true, type: 'number', example: 121.517 });
const RADIUS = (d) => q('radius', `搜尋半徑（公尺），預設 ${d}，上限 1000`, { type: 'integer', min: 1 });
const int = (v) => { const n = num(v); return Number.isInteger(n) ? n : undefined; };
const text = (v, max = 40) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined);
const DAY_MS = 86_400_000;
/** /api/v1/bus/alight 的參數（查詢字串都是字串）：不對就 UserError */
function alightParams(p) {
  const now = int(p.now) ?? Date.now();
  const w = {
    city: text(p.city), routeName: text(p.route), direction: int(p.direction), board: text(p.board), boardSeq: int(p.boardSeq), dest: text(p.dest), destSeq: int(p.destSeq),
    plate: text(p.plate, 20) || null, boardAt: int(p.boardAt), rideSec: int(p.rideSec), seen: p.seen === 'true' || p.seen === '1', lang: p.lang === 'en' ? 'en' : null, now,
  };
  if (!w.city || !w.routeName || !w.board || !w.dest) throw new UserError('city、route、board、dest 都要有');
  if (w.direction != null && w.direction !== 0 && w.direction !== 1) throw new UserError('direction 要是 0 或 1');
  if (w.boardAt == null || Math.abs(w.boardAt - now) > DAY_MS) throw new UserError('boardAt 要是上車時間（epoch 毫秒）');
  if (w.rideSec == null || w.rideSec < 0 || w.rideSec > 6 * 3600) throw new UserError('rideSec 要是 0～21600 秒');
  return w;
}
const OD = [q('from', '起站（中文站名或代碼）', { required: true, example: '台北' }), q('to', '訖站', { required: true, example: '左營' }), q('date', '日期 YYYY-MM-DD，預設今天', { format: 'date' })];

const TYPE_HINT = { number: '數字', integer: '整數', boolean: 'true 或 false' };
const typeOk = { number: (v) => Number.isFinite(Number(v)), integer: (v) => Number.isInteger(Number(v)), boolean: (v) => ['true', 'false', '1', '0'].includes(v), string: () => true };

/**
 * 依路由表檢查查詢字串（http.js 每次都先走這裡）：去掉前後空白，空的當沒填；必填、數字、整數、日期不對就 UserError（400），說要加或改哪個參數。
 * 值照樣是字串（handler 自己轉型）。
 * @param {Array<{ name: string, required: boolean, type: string, format?: string, minimum?: number, example?: any }>} params
 * @param {Record<string, string>} raw
 */
export function checkParams(params, raw = {}) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const t = typeof v === 'string' ? v.trim() : v;
    if (t !== '' && t != null) out[k] = t;
  }
  for (const p of params) {
    const v = out[p.name];
    if (v === undefined) {
      if (p.required) throw new UserError(`缺少參數 ${p.name}（${p.description}），請在網址加上 ${p.name}=${p.example ?? '…'}`);
      continue;
    }
    if (!(typeOk[p.type] || typeOk.string)(v)) throw new UserError(`參數 ${p.name} 要是${TYPE_HINT[p.type]}，現在是「${String(v).slice(0, 20)}」`);
    if (p.minimum !== undefined && Number(v) < p.minimum) throw new UserError(`參數 ${p.name} 不能小於 ${p.minimum}`);
    if (p.format === 'date' && !isDate(v)) throw new UserError(`參數 ${p.name} 要是 YYYY-MM-DD 的日期，例如 2026-11-23`);
  }
  return out;
}

/**
 * 執行一條 REST 路由：先檢查參數，再在計量範圍內執行（與 tool 相同，core/metrics.js）。
 * TDX 額度用完改用了示範資料（withTdxFallback）時照實標 mode: 'demo' 與 fallback，不把示範資料標成真實的。
 * @returns {Promise<{ mode: 'live'|'demo', fallback?: 'tdx-limit', data: any }>}
 */
export async function runRoute(svc, route, raw) {
  const p = checkParams(route.params, raw);
  const { result: data, metrics } = await measure(() => route.handler(p));
  return metrics.fallback ? { mode: 'demo', fallback: 'tdx-limit', data } : { mode: svc.mode, data };
}

/**
 * @param {object} svc createServices() 的結果
 * @param {{ agentInfo?: () => object|null }} [opts] agentInfo：網頁 agent 用什麼回答（模式、模型名稱、判斷層成員；不含金鑰），放進 /api/v1/status
 * @returns {Record<string, { summary: string, tag: string, params: Array<object>, handler: (p: object) => any }>}
 */
/**
 * 合作 App 的連結（ADR-0019）：MyDrama 運動活動頁與商店頁（伺服器設定，沒設定是 null）。
 * 放在每次開 App 都會查的 /api/v1/status 裡，前端顯示散步建議時不用另外問伺服器（健康資料只在手機，ADR-0018）。
 */
export function partnerLinks(svc) {
  try { return { exercise: svc.drama?.exerciseLink?.() ?? null, store: svc.drama?.store?.() ?? null }; } catch { return { exercise: null, store: null }; }
}

export function restRoutes(svc, { agentInfo = null } = {}) {
  return {
    '/api/v1/status': { summary: '服務狀態（live／demo、各類資料是真實或示範、工具包、agent 用什麼回答）', tag: 'PWA', params: [], handler: () => { const agent = agentInfo?.(); return { mode: svc.mode, weatherMode: svc.weatherMode, sources: dataSources(svc), time: new Date().toISOString(), packs: listPacks(), partner: partnerLinks(svc), ...(agent && { agent }) }; } },
    '/api/v1/bus/routes': { summary: '搜尋公車路線', tag: 'PWA', params: [CITY, q('keyword', '路線關鍵字', { example: '307' })], handler: (p) => svc.bus.searchRoutes({ city: p.city, keyword: p.keyword || '' }) },
    '/api/v1/bus/eta': { summary: '公車路線即時到站', tag: 'PWA', params: [CITY, q('route', '完整路線名稱', { required: true, example: '307' })], handler: (p) => svc.bus.routeEta({ city: p.city, routeName: p.route }) },
    '/api/v1/bus/alight': {
      summary: '下車提醒：我這台到下車站還要多久、該不該提醒（Android 常駐服務每 20 秒問一次；判斷同 core/alight.js）', tag: 'PWA',
      params: [
        CITY, q('route', '完整路線名稱', { required: true, example: '307' }), q('direction', '去程 0、返程 1', { type: 'integer', example: 0 }),
        q('board', '上車站名', { required: true, example: '西門' }), q('boardSeq', '上車站站序', { type: 'integer' }),
        q('dest', '下車站名', { required: true, example: '市政府' }), q('destSeq', '下車站站序', { type: 'integer' }),
        q('plate', '設定時看到的車牌（選填）'), q('boardAt', '上車時間（epoch 毫秒；車正要進站時是未來）', { required: true, type: 'integer' }),
        q('rideSec', '設定時估的坐車秒數', { required: true, type: 'integer' }), q('seen', '上次回傳的 seen（看過我這台在路上）', { type: 'boolean' }),
        q('now', '手機現在的時間（epoch 毫秒；跟 boardAt 同一個時鐘）', { type: 'integer' }), q('lang', 'en＝英文文字'),
      ],
      handler: async (p) => {
        const w = alightParams(p);
        const r = await callTool(svc, 'bus_route_eta', { city: w.city, routeName: w.routeName, ...(w.direction != null && { direction: w.direction }) });
        const dirs = r?.data?.directions || [];
        const dir = dirs.find((x) => x.direction === w.direction) || (w.direction == null ? dirs[0] : null); // 方向對不上：不猜，照設定時的估計
        return alightCheck(w, dir?.stops || [], w.now);
      },
    },
    '/api/v1/bus/nearby': { summary: '附近公車站', tag: 'PWA', params: [LAT, LON, RADIUS(400)], handler: (p) => svc.bus.nearbyStations({ lat: num(p.lat), lon: num(p.lon), radius: num(p.radius) }) },
    '/api/v1/bus/station-eta': { summary: '站位所有路線到站', tag: 'PWA', params: [CITY, q('station', '站位 ID', { required: true })], handler: (p) => svc.bus.stationEta({ city: p.city, stationId: p.station }) },
    '/api/v1/bike/nearby': { summary: '附近 YouBike', tag: 'PWA', params: [LAT, LON, RADIUS(500)], handler: (p) => svc.bike.nearby({ lat: num(p.lat), lon: num(p.lon), radius: num(p.radius) }) },
    '/api/v1/thsr/stations': { summary: '高鐵車站', tag: 'PWA', params: [], handler: () => svc.rail.thsrStations() },
    '/api/v1/thsr/timetable': { summary: '高鐵時刻表', tag: 'PWA', params: OD, handler: (p) => svc.rail.thsrTimetable(p) },
    '/api/v1/tra/stations': { summary: '台鐵車站', tag: 'PWA', params: [], handler: () => svc.rail.traStations() },
    '/api/v1/tra/timetable': { summary: '台鐵時刻表', tag: 'PWA', params: OD, handler: (p) => svc.rail.traTimetable(p) },
    '/api/v1/drama/wait': {
      summary: '設了到站提醒、還要等一段時間時推一集短劇（MyDrama；等 5～40 分才推，沒有回 aside: null）', tag: 'PWA',
      params: [q('min', '還要等幾分鐘', { required: true, type: 'number', example: 12 })],
      handler: async (p) => {
        const m = num(p.min);
        if (!Number.isFinite(m) || m < 0 || m > 180) throw new UserError('min 要是 0～180 的分鐘數');
        return { aside: await remindAside(svc, { waitMin: m }) };
      },
    },
    '/api/v1/agent/profile': {
      summary: '網頁 agent 設定（名稱、建議問題、免責、小幫手角色）', tag: 'Agent',
      params: [q('id', `agent id：${Object.keys(PROFILES).join('、')}；預設 life`, { example: 'antifraud' })],
      handler: (p) => {
        const id = p.id || 'life';
        if (!hasProfile(id)) throw new UserError(`沒有這個 agent：${id}`);
        const a = getProfile(id);
        return { id: a.id, name: a.name, suggestions: a.suggestions, disclaimer: a.disclaimer, roles: Object.fromEntries(a.tools.map((t) => [t, TOOL_ROLES[t]])) };
      },
    },
    '/api/v1/tools': { summary: '列出 tools（名稱、說明、工具包、輸入 JSON Schema）', tag: 'Tools', params: [q('pack', '只列這些工具包，逗號分隔，例如 transit,weather')], handler: (p) => listTools({ packs: p.pack ? p.pack.split(',') : undefined }).map(describeTool) },
  };
}
