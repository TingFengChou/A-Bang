// 回答也在手機上寫（ADR-0017）：給手機模型的精簡事實清單。只放這一輪的結論、方案、時間、費用、提醒、示範標記與小幫手的一句話；
// 不放座標、不放起訖點（可能是常用地點或現在位置）、不放使用者的句子。數字都直接來自工具資料（ADR-0009）。
import { speakEn } from '../tools/speak-en.js';

const MAX_POINTS = 6;
const MODE_ZH = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' };
/** 「25.0430, 121.5070」這類座標拿掉（有些地點名稱就是座標） */
const noCoords = (s) => String(s ?? '').replace(/-?\d{1,3}\.\d{3,}\s*[,，]\s*-?\d{1,3}\.\d{3,}/g, '').replace(/\s{2,}/g, ' ').trim();

/**
 * @param {object} it 規則判斷的意圖（parseIntent）
 * @param {Record<string, object[]>} results 這一輪工具結果（tool 名稱 → callTool 結果）
 * @param {{ lang?: 'zh'|'en' }} [o]
 * @returns {{ intent: string, lang: 'zh'|'en', demo: boolean, points: string[], trip?: object }}
 */
export function answerFacts(it, results = {}, { lang = 'zh' } = {}) {
  const en = lang === 'en';
  const all = Object.entries(results).flatMap(([name, rs]) => rs.map((r) => ({ name, r })));
  const demo = all.some(({ r }) => r?.mode === 'demo' || r?.data?.demo === true);
  const points = [];
  for (const { name, r } of all) {
    if (name === 'find_place') continue; // 地點查詢只是找座標
    const s = noCoords(en ? speakEn(name, r.data, r.args) ?? r.speak : r.speak);
    if (s && !points.includes(s)) points.push(s.slice(0, 140));
    if (points.length >= MAX_POINTS) break;
  }
  const out = { intent: it?.intent || 'unknown', lang: en ? 'en' : 'zh', demo, points };
  const trip = results.plan_trip?.[0]?.data;
  if (trip?.options?.length) {
    const opt = (o) => ({ name: o.name, minutes: o.minutes, cost: o.cost, arriveAt: o.arriveAt });
    const best = trip.options.find((o) => o.id === trip.best);
    const ranked = (trip.ranking?.ranked || []).map((r) => trip.options.find((o) => o.id === r.id)).filter((o) => o && o.id !== trip.best);
    out.trip = {
      departAt: trip.departAt,
      ...(best && { best: opt(best) }),
      others: ranked.slice(0, 3).map(opt),
      ...(trip.arriveBy && { arriveBy: trip.arriveBy }),
      ...(trip.ranking?.reason && { reason: noCoords(trip.ranking.reason).slice(0, 140) }),
      ...(trip.tips?.length && { tips: trip.tips.map((t) => noCoords(t.text)).slice(0, 3) }),
      // 沒列入的方式與原因（含今天不會來的那條公車：盯到站後重排的結果也在這裡，手機改寫才不會推不會來的那班）
      ...(trip.missing?.length && { notIncluded: trip.missing.slice(0, 4).map((m) => (en ? `${m.route ? `Bus ${m.route}` : m.role}: ${m.whyEn || m.why}` : `${m.route ? `公車 ${m.route}` : MODE_ZH[m.role] || m.role}：${m.why}`)) }),
    };
  }
  return out;
}
