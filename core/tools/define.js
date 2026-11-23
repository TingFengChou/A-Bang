// Tool 定義與共用型別（ADR-0002：tool 只定義一次）
import { z } from 'zod';
import { isDate } from '../util.js';

/**
 * @typedef {object} ToolDef
 * @property {string} name        MCP tool 名稱（snake_case）
 * @property {string} title       顯示名稱
 * @property {string} description 給模型看的描述（同時用於 MCP 與 Claude API）
 * @property {string} pack        工具包 id，例如 'transit'（ADR-0007）
 * @property {'L1'|'L2'|'L3'} tier 風險分級（docs/PLATFORM.md §5.3）
 * @property {string} [card]      互動卡片種類（M4 起使用），沒有卡片則省略
 * @property {Record<string, import('zod').ZodTypeAny>} input  zod raw shape
 * @property {(svc: any, args: any) => Promise<{ data: any, text: string }>} run
 * @property {(data: any, args: any) => string} [speak]  討論串中工具的一句話發言（由資料決定，不經模型；ADR-0009）
 * @property {string} [source]   資料來源標示，預設 TDX（DEFAULT_SOURCE）
 * @property {boolean} [static]   資料不依賴 TDX 金鑰（內建資料），示範模式也不加「示範資料」提示
 * @property {(svc: any) => 'live'|'demo'} [modeOf]  資料來源不是 TDX 時，自己判斷 live／demo（例：天氣看 CWA 授權碼）
 * @property {string} [demoNote]  示範模式提示，預設說明 TDX 金鑰（DEFAULT_DEMO_NOTE）
 * @property {boolean} [fallbackSafe]  TDX 額度用完改用的示範資料不會出現在結果裡（plan_trip 把那些方案排除並照實說）：mode 照真實、speak 不加「這次先用示範資料」
 */

const TIERS = ['L1', 'L2', 'L3'];
export const DEFAULT_SOURCE = '交通部 TDX 運輸資料流通服務';
export const DEFAULT_DEMO_NOTE = '【示範資料：尚未設定 TDX 金鑰，以下非真實營運資訊】';

/** @param {ToolDef} def */
export function defineTool(def) {
  for (const k of ['name', 'title', 'description', 'pack', 'tier', 'input', 'run']) {
    if (def[k] == null) throw new Error(`defineTool(${def.name}): 缺少 ${k}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(def.name)) throw new Error(`tool 名稱需為 snake_case：${def.name}`);
  if (!TIERS.includes(def.tier)) throw new Error(`tool ${def.name} 的 tier 必須是 L1/L2/L3`);
  return Object.freeze({ source: DEFAULT_SOURCE, static: false, demoNote: DEFAULT_DEMO_NOTE, ...def, schema: z.object(def.input) });
}

// ── 共用輸入型別 ──
export const T = {
  lat: z.number().min(21).max(27).describe('緯度 (WGS84)，例如台北車站 25.0478'),
  lon: z.number().min(118).max(123).describe('經度 (WGS84)，例如台北車站 121.5170'),
  city: z.string().min(1).describe('縣市，可用 Taipei / NewTaipei / Taichung / Kaohsiung… 或中文「台北市」'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD').refine(isDate, '日期不存在，請用 YYYY-MM-DD，例如 2026-11-23').optional().describe('乘車日期 YYYY-MM-DD，預設今天（台灣時間）'),
  /** 座標或地名（tool 內用 resolvePoint 轉成座標） */
  point: (label) => z.union([
    z.object({ lat: z.number().min(21).max(27), lon: z.number().min(118).max(123), name: z.string().trim().min(1).max(30).optional() }),
    z.string().trim().min(1).max(50),
  ]).describe(`${label}：座標 { lat, lon } 或地名（例如「台北車站」，會用 find_place 轉成座標）`),
  radius: (def, max = 1000) => z.number().int().min(50).max(max).optional().describe(`搜尋半徑（公尺），預設 ${def}，上限 ${max}`),
};

/** 文字摘要長度上限（MCP_TOOLS.md：≤ 1500 字） */
export function clip(lines, max = 1500) {
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > max) { out += '\n…（其餘省略，完整資料見結構化結果）'; break; }
    out += (out ? '\n' : '') + l;
  }
  return out;
}
