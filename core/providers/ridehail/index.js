// 叫車 providers（ADR-0011）：介面 { id, name, link({ from, to }) }；估價需業者合作，之前由 estimateFare() 以距離估算並標 estimated。
// 不呼叫外部 API，live 與示範模式共用。
import { distanceM, UserError } from '../../util.js';
import { uber } from './uber.js';

export const PROVIDERS = { uber };
export const DEFAULT_PROVIDER = 'uber';

// 估價依據：臺北市計程車費率（起跳 85 元含 1.25 公里，續程每 200 公尺 5 元）；道路距離以直線 × 1.3 估算。
// 上限 ×1.3 涵蓋塞車、夜間加成與平台浮動；不是業者報價。
export const FARE = { baseTWD: 85, baseKm: 1.25, stepKm: 0.2, stepTWD: 5, roadFactor: 1.3, highFactor: 1.3 };
export const FARE_BASIS = '依臺北市計程車費率與道路距離（直線 × 1.3）估算，實際以叫車 App 報價為準';

/** 距離 → 車資估算區間 { low, high, distanceKm, currency, estimated, basis } */
export function estimateFare(straightM) {
  const km = (straightM / 1000) * FARE.roadFactor;
  // 先以公尺整數計算，避免浮點誤差在跳表邊界多算一跳
  const steps = Math.max(0, Math.ceil(Math.round((km - FARE.baseKm) * 1000) / Math.round(FARE.stepKm * 1000)));
  const low = FARE.baseTWD + steps * FARE.stepTWD;
  const high = Math.ceil((low * FARE.highFactor) / 5) * 5;
  return { low, high, distanceKm: +km.toFixed(1), currency: 'TWD', estimated: true, basis: FARE_BASIS };
}

export function createRidehailServices() {
  return {
    ridehail: {
      /**
       * @param {{ provider?: string, from?: { lat, lon, name? } | null, to: { lat, lon, name? } }} p
       */
      async link({ provider = DEFAULT_PROVIDER, from = null, to }) {
        const pv = PROVIDERS[provider];
        if (!pv) throw new UserError(`不支援的叫車服務「${provider}」，可用：${Object.values(PROVIDERS).map((x) => x.name).join('、')}`);
        return {
          provider: pv.id, providerName: pv.name,
          url: pv.link({ from, to }),
          // 沒有上車座標時無法估距離，不估價
          estimate: from ? estimateFare(distanceM(from.lat, from.lon, to.lat, to.lon)) : null,
        };
      },
    },
  };
}
