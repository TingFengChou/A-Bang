// Agent profile（M5-01 🧩，ADR-0005、ADR-0007）：agent 設定是 JSON，以 zod 驗證；工具與工具包必須存在於 registry。
import { z } from 'zod';
import { getTool, listPacks } from '../tools/index.js';
import life from './life.json' with { type: 'json' };
import antifraud from './antifraud.json' with { type: 'json' };

const L10n = z.object({ 'zh-TW': z.string().min(1) }).catchall(z.string());

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().positive(),
  name: L10n,
  model: z.string().min(1),
  packs: z.array(z.string()).min(1),
  tools: z.array(z.string()).min(1),
  persona: z.string().min(10),
  rules: z.array(z.string().min(1)).default([]),
  suggestions: z.array(z.string().min(1).max(40)).min(1).max(8),
  disclaimer: z.string().min(1),
}).strict();

/**
 * 驗證 profile：格式（zod）＋每個工具都在 registry、工具的 pack 必須列在 packs。
 * @returns {z.infer<typeof ProfileSchema>}
 */
export function validateProfile(raw) {
  const p = ProfileSchema.parse(raw);
  const packs = new Set(listPacks());
  for (const k of p.packs) if (!packs.has(k)) throw new Error(`profile ${p.id}：沒有這個工具包 ${k}`);
  for (const name of p.tools) {
    const t = getTool(name);
    if (!t) throw new Error(`profile ${p.id}：沒有這個 tool ${name}`);
    if (!p.packs.includes(t.pack)) throw new Error(`profile ${p.id}：tool ${name} 的工具包 ${t.pack} 不在 packs`);
  }
  if (new Set(p.tools).size !== p.tools.length) throw new Error(`profile ${p.id}：tools 重複`);
  return p;
}

export const PROFILES = Object.freeze({ life: validateProfile(life), antifraud: validateProfile(antifraud) });

/** 有這個 agent 嗎（路由用；id 來自網址） */
export const hasProfile = (id) => Object.hasOwn(PROFILES, id);

/** @param {string} id */
export function getProfile(id = 'life') {
  const p = PROFILES[id];
  if (!p) throw new Error(`沒有這個 agent：${id}`);
  return p;
}
