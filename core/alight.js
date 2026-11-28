// 下車提醒的純邏輯（2026-11-21，PLAN「行程中模式、下車提醒」；2026-11-23 搬到 core：畫面與 Android 常駐服務共用）。
// 前端以 /core/alight.js 載入（public/js/alight.js）；伺服器 /api/v1/bus/alight 給 Android 常駐服務（AbangAlightService）每 20 秒問一次，
// 「我這台」的判斷只寫在這裡，Java 不重寫。
// 找「我這台」：每站的到站時間是「下一班」的。沿著站序看，從上車站往後第一個「到站時間變小」的站，就是剛離開上車站那台車的前方
// （上車站之後到那一站之前，下一班都是更後面的車）。目的站在那台車前方、而且中間沒有別台車（沒有再變小）＝目的站的下一班就是我這台。
// 站一律用站序（環狀路線有同名的站）。不 import 任何東西（瀏覽器直接載入）。

/** 到目的站前幾秒提醒下車 */
export const ALIGHT_SEC = 120;
/** 看不出來時每站估幾秒 */
export const SEC_PER_STOP = 90;
/** 最多提醒多久（從上車起算） */
export const ALIGHT_MAX_MS = 3 * 3600e3;

const ok = (s) => s && s.status === 0 && s.etaSec != null;

/** 「約 2 分後到「市府」，準備下車」／「快到「市府」了，準備下車！」；lang＝'en'（英文公車頁設的，S12g）用英文 */
export const alightText = (dest, sec, lang = null) => {
  const near = sec != null && sec < 60, n = Math.max(1, Math.round((sec ?? ALIGHT_SEC) / 60));
  if (lang === 'en') return near ? `Almost at ${dest}. Get ready to get off!` : `About ${n} min to ${dest}. Get ready to get off.`;
  return near ? `快到「${dest}」了，準備下車！` : `約 ${n} 分後到「${dest}」，準備下車`;
};

/**
 * 常駐通知的一句話：「307 坐車中・約 6 分到「市府」・快到時提醒你下車」。
 * 還沒上車（車正要進上車站）說「等車中」；不到 1 分說「快到了」；時間不明只說往哪裡。
 * @param {{ routeName: string, dest: string, lang?: string|null }} w
 * @param {number|null} sec  到目的站還要幾秒
 * @param {boolean} [boarded]
 */
export const alightOngoingText = (w, sec, boarded = true) => {
  const near = sec != null && sec < 60, n = Math.max(1, Math.round((sec ?? 0) / 60));
  if (w.lang === 'en') {
    const where = sec == null ? `heading to ${w.dest}` : near ? `almost at ${w.dest}` : `about ${n} min to ${w.dest}`;
    return `Bus ${w.routeName} · ${boarded ? '' : 'waiting · '}${where} · I'll tell you when to get off`;
  }
  const where = sec == null ? `往「${w.dest}」` : near ? `快到「${w.dest}」了` : `約 ${n} 分到「${w.dest}」`;
  return `${w.routeName} ${boarded ? '坐車中' : '等車中'}・${where}・快到時提醒您下車`;
};

/** 用站序找站（沒有站序時才用站名） */
const indexOf = (stops, seq, name) => { const i = seq != null ? stops.findIndex((s) => s.seq === seq) : -1; return i >= 0 ? i : stops.findIndex((s) => s.stopName === name); };

/**
 * 我這台車到目的站還要多久（從到站時間的順序推）。
 * @returns {{ etaSec: number|null, where: 'ahead'|'passed'|'unknown' }}
 *   ahead：目的站的下一班就是我這台（etaSec 有值）；passed：我這台已經過了目的站；unknown：看不出來（資料不全、中間有別台車）
 */
export function busToDest(stops, bi, di) {
  if (bi < 0 || di <= bi) return { etaSec: null, where: 'unknown' };
  let j = -1;
  for (let k = bi + 1; k < stops.length; k++) if (ok(stops[k]) && ok(stops[k - 1]) && stops[k].etaSec < stops[k - 1].etaSec) { j = k; break; }
  if (j < 0) return { etaSec: null, where: 'unknown' };
  if (j > di) return { etaSec: null, where: 'passed' };
  for (let k = j + 1; k <= di; k++) if (ok(stops[k]) && ok(stops[k - 1]) && stops[k].etaSec < stops[k - 1].etaSec) return { etaSec: null, where: 'unknown' }; // 中間還有別台：目的站的下一班不是我
  return ok(stops[di]) ? { etaSec: stops[di].etaSec, where: 'ahead' } : { etaSec: null, where: 'unknown' };
}

/**
 * 該提醒下車了嗎（純函式）。
 * @param {{ boardSeq?: number, destSeq?: number, board: string, dest: string, plate?: string|null, boardAt: number, rideSec: number, seen?: boolean }} w  seen：看過我這台在前往目的站的路上（會被更新）
 * @returns {{ due: boolean, etaSec: number|null, by: 'bus'|'plate'|'passed'|'time'|null }}
 */
export function alightDue(w, stops, now = Date.now()) {
  const bi = indexOf(stops, w.boardSeq, w.board);
  const di = indexOf(stops, w.destSeq, w.dest);
  const d = stops[di];
  if (w.plate && ok(d) && d.plate === w.plate) return { due: d.etaSec <= ALIGHT_SEC, etaSec: d.etaSec, by: 'plate' };
  if (now < w.boardAt) { // 還沒上車（車正要進上車站）：上車站之後第一台是前一班，不能當我這台；照設定時的估計
    const left = w.rideSec + (w.boardAt - now) / 1000;
    return { due: left <= ALIGHT_SEC, etaSec: Math.round(left), by: left <= ALIGHT_SEC ? 'time' : null };
  }
  const pos = busToDest(stops, bi, di);
  if (pos.where === 'ahead') { w.seen = true; return { due: pos.etaSec <= ALIGHT_SEC, etaSec: pos.etaSec, by: 'bus' }; }
  if (pos.where === 'passed' && w.seen) return { due: true, etaSec: 0, by: 'passed' }; // 看過在路上、現在已經過了目的站：馬上提醒
  const left = w.rideSec - (now - w.boardAt) / 1000; // 看不出來：照設定時估的
  return left <= ALIGHT_SEC ? { due: true, etaSec: Math.max(0, Math.round(left)), by: 'time' } : { due: false, etaSec: Math.round(left), by: null };
}

/**
 * 設定時估「現在起」還要多久到目的站。
 * 公車正要進上車站（≤ 90 秒）：還沒上車，等這台；否則照到站時間的順序找我這台；都看不出來用站數 × 90 秒。
 * @returns {{ rideSec: number, boardAt: number, plate: string|null }|null}
 */
export function rideEstimate(stops, boardSeq, destSeq, now = Date.now()) {
  const bi = indexOf(stops, boardSeq);
  const di = indexOf(stops, destSeq);
  if (bi < 0 || di <= bi) return null;
  const b = stops[bi];
  if (ok(b) && b.etaSec <= 90) { // 車正要進站：上這台
    const d = stops[di];
    const ride = ok(d) && d.etaSec > b.etaSec ? d.etaSec - b.etaSec : (di - bi) * SEC_PER_STOP;
    return { rideSec: ride, boardAt: now + b.etaSec * 1000, plate: b.plate || null };
  }
  const pos = busToDest(stops, bi, di);
  if (pos.where === 'ahead') return { rideSec: pos.etaSec, boardAt: now, plate: stops[di].plate || null };
  return { rideSec: (di - bi) * SEC_PER_STOP, boardAt: now, plate: null };
}

/**
 * 常駐服務每 20 秒問一次的結果（/api/v1/bus/alight）：該不該提醒、還要多久、通知列與響鈴的文字。
 * 方向對不上（資料沒有這個方向）就照設定時的估計（跟畫面上預排的通知一樣）。
 * @param {object} w  同 alightDue 的 w，加上 routeName、lang
 * @param {Array<object>} stops  這個方向的站（bus_route_eta 的 directions[].stops；沒有給空陣列）
 * @returns {{ due: boolean, etaSec: number|null, by: string|null, seen: boolean, ended: boolean, ongoing: string, alert: string }}
 *   seen：要帶回下一次（看過我這台在路上）；ended：超過 3 小時，結束提醒；alert：due 時是這次的響鈴文字，否則是「到點前 2 分」那一句（服務在兩次更新之間到點時用）
 */
export function alightCheck(w, stops, now = Date.now()) {
  if (now - w.boardAt > ALIGHT_MAX_MS) return { due: false, etaSec: null, by: null, seen: Boolean(w.seen), ended: true, ongoing: '', alert: '' };
  const v = { ...w };
  const r = alightDue(v, stops || [], now);
  return {
    ...r, seen: Boolean(v.seen), ended: false,
    ongoing: alightOngoingText(w, r.etaSec, now >= w.boardAt),
    alert: alightText(w.dest, r.due ? r.etaSec : ALIGHT_SEC, w.lang),
  };
}
