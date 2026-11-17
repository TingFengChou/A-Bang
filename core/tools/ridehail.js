// 工具包：ridehail（叫車）— 風險分級 L2（ADR-0011：只產生官方連結，產生前需使用者確認）
import { z } from 'zod';
import { defineTool, T } from './define.js';
import { resolvePoint } from '../services/places.js';
import { PROVIDERS, DEFAULT_PROVIDER } from '../providers/ridehail/index.js';

export const ridehailLink = defineTool({
  name: 'ridehail_link',
  title: '叫車連結',
  description: '產生叫車 App（目前 Uber）的官方深層連結，開啟後由使用者在 App 內確認上車點、車種與付款；阿幫不代叫車、不付款。'
    + '【L2：呼叫前必須先向使用者確認目的地與要叫車】from 省略時上車點用 App 的目前位置。'
    + '有 from 時附 estimate（以計程車費率與距離估算的區間，estimated=true，非業者報價）。地名會用 find_place 轉成座標。',
  pack: 'ridehail', tier: 'L2',
  source: '阿幫產生的叫車 App 官方連結（車資為估算）', static: true,
  input: {
    to: T.point('目的地'),
    from: T.point('上車點（可省略，省略時用 App 的目前位置）').optional(),
    provider: z.enum(Object.keys(PROVIDERS)).optional().describe(`叫車服務，預設 ${DEFAULT_PROVIDER}`),
  },
  speak: (d) => `${d.providerName}叫車連結準備好了，到${d.to}${d.estimate ? `，估計 ${d.estimate.low}～${d.estimate.high} 元（估算）` : ''}；開啟後在 App 內確認。`,
  async run(svc, a) {
    const [to, from] = await Promise.all([resolvePoint(svc.places, a.to), a.from ? resolvePoint(svc.places, a.from) : null]);
    const raw = await svc.ridehail.link({ provider: a.provider, from, to });
    const data = {
      ...raw,
      from: from?.name ?? null, to: to.name, fromPoint: from, toPoint: to,
      confirmText: `要開啟 ${raw.providerName} 叫車到「${to.name}」嗎？上車點、車種與付款請在 App 內確認。`,
    };
    const text = [
      `${raw.providerName} 叫車連結：${from ? `${from.name} → ` : '目前位置 → '}${to.name}`,
      raw.url,
      raw.estimate ? `估計車資 ${raw.estimate.low}～${raw.estimate.high} 元、道路距離約 ${raw.estimate.distanceKm} 公里（${raw.estimate.basis}）` : '未提供上車點，不估車資。',
      '開啟前請先向使用者確認；上車點、車種與付款在 App 內完成。',
    ].join('\n');
    return { data, text };
  },
});

export default [ridehailLink];
