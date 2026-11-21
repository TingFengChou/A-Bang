// Tool registry：MCP、REST、網頁 agent 都從這裡取得 tools（ADR-0002）
import { z } from 'zod';
import { UserError } from '../util.js';
import { measure } from '../metrics.js';
import transit from './transit.js';
import metro from './metro.js';
import traffic from './traffic.js';
import intercity from './intercity.js';
import weather from './weather.js';
import ridehail from './ridehail.js';
import trip from './trip.js';
import booking from './booking.js';
import antifraud from './antifraud.js';
import life from './life.js';
import finance from './finance.js';

/** 卡片資料契約版本（public/ui/cards/schema/<card>.v1.json） */
export const CARD_VERSION = 1;

const ALL = [...transit, ...metro, ...traffic, ...intercity, ...weather, ...ridehail, ...trip, ...booking, ...antifraud, ...life, ...finance];
const byName = new Map(ALL.map((t) => [t.name, t]));
if (byName.size !== ALL.length) throw new Error('tool 名稱重複');

/** 列出 tools；可依工具包過濾 */
export function listTools({ packs } = {}) {
  return packs?.length ? ALL.filter((t) => packs.includes(t.pack)) : ALL;
}

export function getTool(name) {
  return byName.get(name) || null;
}

export function listPacks() {
  return [...new Set(ALL.map((t) => t.pack))];
}

/** tool 的公開描述（給 REST 列表、Claude API tools、文件） */
export function describeTool(t) {
  return {
    name: t.name, title: t.title, description: t.description,
    pack: t.pack, tier: t.tier, card: t.card ?? null, source: t.source,
    inputSchema: z.toJSONSchema(t.schema),
  };
}

/**
 * 驗證參數並執行 tool。回傳統一格式；輸入錯誤丟 UserError。
 * metrics：本次呼叫的上游呼叫數、快取命中、掃描筆數、耗時（core/metrics.js；示範模式 calls／scanned 為 0）
 * 有卡片時另帶 v（契約版本）；args 為驗證後的參數，卡片刷新時用（CARDS.md §2）
 * @returns {Promise<{ name, card, v?, mode, data, text, speak, args, metrics }>}
 */
export async function callTool(svc, name, args = {}) {
  const t = getTool(name);
  if (!t) throw new UserError(`沒有這個 tool：${name}`);
  const parsed = t.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '參數'}：${i.message}`).join('；');
    throw new UserError(`參數錯誤（${name}）：${msg}`);
  }
  const { result: { data, text }, metrics } = await measure(() => t.run(svc, parsed.data));
  // speak：討論串中「工具發言」的一句話，由資料決定（ADR-0009）
  const said = t.speak ? t.speak(data, parsed.data) : null;
  const speak = said && metrics?.fallback && !/TDX/.test(said) ? `${said}（TDX 每分鐘的查詢額度用完，這次先用示範資料）` : said;
  return { name, card: t.card ?? null, ...(t.card && { v: CARD_VERSION }), mode: metrics?.fallback ? 'demo' : t.modeOf ? t.modeOf(svc) : svc.mode, ...(metrics?.fallback && { fallback: 'tdx-limit' }), data, text, speak, args: parsed.data, metrics };
}
