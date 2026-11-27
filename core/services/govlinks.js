// 去政府辦事的官方入口（M16-04d）：罰單、報稅、地方稅、健保、勞保、謄本、護照預約、TW FidO…
// 內建清單（core/data/gov-links.json），只收政府網域的 https 網址；要身分驗證的事只給連結，使用者確認後自己開（ADR-0011）。
import { readFileSync } from 'node:fs';

/** 只收這些政府網域（含子網域） */
const GOV_HOSTS = /(?:^|\.)(?:gov\.tw|nat\.gov\.tw|gov\.taipei)$/;
export const isGovUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && GOV_HOSTS.test(x.hostname); } catch { return false; } };

let list = null;
/** 內建清單（不合格的網址整筆拿掉） */
export function govLinks() {
  list ||= JSON.parse(readFileSync(new URL('../data/gov-links.json', import.meta.url), 'utf8')).links.filter((l) => isGovUrl(l.url));
  return list;
}

/**
 * 使用者的問法 → 對應的官方入口（關鍵字比對，長的關鍵字先算；最多 3 個）。
 * @param {string} text
 */
export function findGovLinks(text, links = govLinks()) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '').replace(/台/g, '臺');
  const norm = (k) => k.toLowerCase().replace(/台/g, '臺');
  return links.map((l) => ({ l, score: Math.max(0, ...l.keys.filter((k) => s.includes(norm(k))).map((k) => k.length)) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.l);
}
