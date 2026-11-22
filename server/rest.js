// REST 路由表（唯一定義）：server/http.js 用它處理請求，server/openapi.js 用它產生 Swagger 文件。
// PWA 既有頁面使用；新功能請優先走 /api/v1/tools/:name。
import { listTools, listPacks, describeTool } from '../core/tools/index.js';
import { getProfile, hasProfile, PROFILES } from '../core/agents/index.js';
import { UserError } from '../core/util.js';
import { dataSources } from '../core/index.js';
import { TOOL_ROLES } from '../core/agent/events.js';
import { remindAside } from '../core/agent/wait-drama.js';

const num = (v) => (v == null || v === '' ? undefined : Number(v));
const q = (name, description, { required = false, type = 'string', example } = {}) => ({ name, description, required, type, ...(example !== undefined && { example }) });
const CITY = q('city', '縣市，例如 Taipei、台北市', { required: true, example: 'Taipei' });
const LAT = q('lat', '緯度 (WGS84)', { required: true, type: 'number', example: 25.0478 });
const LON = q('lon', '經度 (WGS84)', { required: true, type: 'number', example: 121.517 });
const RADIUS = (d) => q('radius', `搜尋半徑（公尺），預設 ${d}，上限 1000`, { type: 'integer' });
const OD = [q('from', '起站（中文站名或代碼）', { required: true, example: '台北' }), q('to', '訖站', { required: true, example: '左營' }), q('date', '日期 YYYY-MM-DD，預設今天')];

/**
 * @param {object} svc createServices() 的結果
 * @param {{ agentInfo?: () => object|null }} [opts] agentInfo：網頁 agent 用什麼回答（模式、模型名稱、判斷層成員；不含金鑰），放進 /api/v1/status
 * @returns {Record<string, { summary: string, tag: string, params: Array<object>, handler: (p: object) => any }>}
 */
export function restRoutes(svc, { agentInfo = null } = {}) {
  return {
    '/api/v1/status': { summary: '服務狀態（live／demo、各類資料是真實或示範、工具包、agent 用什麼回答）', tag: 'PWA', params: [], handler: () => { const agent = agentInfo?.(); return { mode: svc.mode, weatherMode: svc.weatherMode, sources: dataSources(svc), time: new Date().toISOString(), packs: listPacks(), ...(agent && { agent }) }; } },
    '/api/v1/bus/routes': { summary: '搜尋公車路線', tag: 'PWA', params: [CITY, q('keyword', '路線關鍵字', { example: '307' })], handler: (p) => svc.bus.searchRoutes({ city: p.city, keyword: p.keyword || '' }) },
    '/api/v1/bus/eta': { summary: '公車路線即時到站', tag: 'PWA', params: [CITY, q('route', '完整路線名稱', { required: true, example: '307' })], handler: (p) => svc.bus.routeEta({ city: p.city, routeName: p.route }) },
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
