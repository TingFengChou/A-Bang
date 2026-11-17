// Tool registry：MCP、REST、網頁 agent 都從這裡取得 tools（ADR-0002）
import { z } from 'zod';
import { UserError } from '../util.js';
import transit from './transit.js';

const ALL = [...transit];
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
    pack: t.pack, tier: t.tier, card: t.card ?? null,
    inputSchema: z.toJSONSchema(t.schema),
  };
}

/**
 * 驗證參數並執行 tool。回傳統一格式；輸入錯誤丟 UserError。
 * @returns {Promise<{ name, card, mode, data, text, speak }>}
 */
export async function callTool(svc, name, args = {}) {
  const t = getTool(name);
  if (!t) throw new UserError(`沒有這個 tool：${name}`);
  const parsed = t.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '參數'}：${i.message}`).join('；');
    throw new UserError(`參數錯誤（${name}）：${msg}`);
  }
  const { data, text } = await t.run(svc, parsed.data);
  // speak：討論串中「工具發言」的一句話，由資料決定（ADR-0009）
  const speak = t.speak ? t.speak(data, parsed.data) : null;
  return { name, card: t.card ?? null, mode: svc.mode, data, text, speak };
}
