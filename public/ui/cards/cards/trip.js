// trip（plan_trip）：建議方案＋分段時間條＋備案（最多 2）＋狀態 chips＋理由句；行動：導航、叫車、訂票、加到行事曆、分享（CARDS.md §4、UX.md §6、ADR-0021）
import { h } from '../dom.js';
import { token, modeSvg, modeOf } from '../mode-icons.js';

/**
 * 可以設定「提醒我出門」嗎：行程是今天、出門時間在 1 分鐘後。
 * leaveAt 與 date 都是台灣時間（伺服器算的），所以一律以台灣時間比較，不看裝置時區。
 * @param {string} leaveAt 'HH:mm'
 * @param {string|undefined} date 'YYYY-MM-DD'（沒有視為今天）
 * @param {number} [now]
 */
export function canRemind(leaveAt, date, now = Date.now()) {
  if (!/^\d{2}:\d{2}$/.test(leaveAt || '')) return false;
  const tw = new Date(now + 8 * 3600e3);
  if (date && date !== tw.toISOString().slice(0, 10)) return false;
  const [hh, mm] = leaveAt.split(':').map(Number);
  const diff = hh * 60 + mm - (tw.getUTCHours() * 60 + tw.getUTCMinutes());
  return diff > 1 && diff < 12 * 60; // 提醒最多排 12 小時內（reminders.js addReminder 同一個上限；前端審查 #3：超過還顯示按鈕、按了說「這個裝置無法設定提醒」）
}

/**
 * 出發倒數（2026-11-28 Claude 與 Antigravity 第十四輪）：照時刻表的方案（台鐵、高鐵、國道客運）有 leaveAt。
 * 今天、還有 90 分鐘以內才顯示；剩幾分（負的＝過了幾分）。台灣時間比較（同 canRemind）。不顯示回 null。
 */
export function leaveCountdown(leaveAt, date, now = Date.now()) {
  if (!/^\d{2}:\d{2}$/.test(leaveAt || '')) return null;
  const tw = new Date(now + 8 * 3600e3);
  if (date && date !== tw.toISOString().slice(0, 10)) return null;
  const [hh, mm] = leaveAt.split(':').map(Number);
  const diff = hh * 60 + mm - (tw.getUTCHours() * 60 + tw.getUTCMinutes());
  if (diff > 90 || diff < -15) return null;
  return { diff, status: diff > 5 ? 'ok' : diff >= 0 ? 'now' : 'late' };
}

/**
 * 出發倒數區塊（建議方案最上面）：時間都是確定的（沒有估算）才跳大字倒數、每 30 秒更新；
 * 有估算（到車站的時間、票價是估的）就只寫「建議最晚 HH:MM 出門」——用猜的倒數會害人遲到（Antigravity）。
 */
function leaveBlock(o, { t, payload }) {
  const date = payload?.data?.date;
  const c0 = leaveCountdown(o.leaveAt, date);
  if (!c0) return null;
  const depart = o.train?.depart || null;
  if (o.estimated) return h('p', { class: 'ab-leave est', role: 'note' }, h('b', {}, t('trip.leaveBy', { time: o.leaveAt })), depart ? h('small', {}, t('trip.leaveFor', { depart })) : null);
  const n = h('b', { class: 'ab-leave-n' });
  const unit = h('span', { class: 'ab-leave-u' });
  const sub = h('small', {});
  const box = h('div', { class: 'ab-leave', role: 'timer', 'aria-live': 'off' }, n, unit, sub);
  const paint = () => {
    const c = leaveCountdown(o.leaveAt, date);
    if (!c) { box.remove(); return false; }
    box.className = `ab-leave ${c.status}`;
    if (c.status === 'ok') { n.textContent = String(c.diff); unit.textContent = t('trip.leaveIn'); }
    else if (c.status === 'now') { n.textContent = ''; unit.textContent = t('trip.leaveNow'); }
    else { n.textContent = ''; unit.textContent = t('trip.leaveLate', { n: -c.diff }); }
    sub.textContent = depart ? t('trip.leaveAtFor', { time: o.leaveAt, depart }) : t('trip.leaveAtOnly', { time: o.leaveAt });
    return true;
  };
  paint();
  const timer = setInterval(() => { if (!box.isConnected && box.dataset.mounted) { clearInterval(timer); return; } if (box.isConnected) box.dataset.mounted = '1'; if (!paint()) clearInterval(timer); }, 30_000);
  return box;
}

/** 重畫後把焦點放回這個按鈕（整張卡重畫，原本按的按鈕會消失） */
const focusLater = (el, want, state) => { if (want && state.remindFocus === want) { state.remindFocus = null; setTimeout(() => el.focus(), 0); } return el; };

/**
 * 「提醒我出門」區塊（放在行動按鈕列下面）：host 支援提醒、裝置能發通知、且 canRemind 才顯示。
 * 第一次要通知權限前先說明為什麼（T7）；設好後可以取消；訊息就寫在這一區（不放到卡片最上面）。
 * 已設定與否從 host 讀（同一段路線一筆）：卡片重畫、重新規劃、在設定頁取消後都一致。
 */
function remindBlock(o, { host, t, state, rerender, payload, say = () => {}, locale = null }) {
  if (!host?.remind || host.canNotify === false || !canRemind(o.leaveAt, payload?.data?.date)) return null;
  const d = payload?.data || {};
  const key = `${d.from?.name || ''}→${d.to?.name || ''}`;
  const cur = host.reminderFor ? host.reminderFor(key) : state.reminded;
  const msg = (text, kind = 'note') => { state.remindMsg = text && { text, kind }; if (text) say(text); };
  const when = host.arrivalNote?.() === 'whenOpenPage' ? t('trip.remindWhenPage') : '';
  const set = async () => {
    state.explain = null; msg(null);
    // 台鐵、高鐵、末班車：記下那一班與上車站（提醒響後問「要我用一次位置幫你看還趕不趕得上嗎？」；public/js/catch-train.js）
    const rl = /^(thsr|tra)$/.test(o.role) && o.train ? o.legs?.find((l) => l.mode === o.role) : null;
    const rail = rl && Number.isFinite(rl.from?.lat) ? { role: o.role, trainNo: o.train.trainNo, depart: o.train.depart, from: o.train.from, to: o.train.to, date: o.train.date, st: { lat: rl.from.lat, lon: rl.from.lon }, ...(o.lastTrain && { last: true }), ...(d.to && Number.isFinite(d.to.lat) && { dest: { name: d.to.name, lat: d.to.lat, lon: d.to.lon } }), ...(locale === 'en' && { lang: 'en' }) } : null;
    const id = await host.remind(o.leaveAt, t('trip.remindText', { name: o.name, time: o.leaveAt }), { key, opt: o.id, ...(locale === 'en' && { lang: 'en' }), ...(rail && { rail }) }).catch(() => false);
    state.reminded = id ? { opt: o.id, id } : null;
    if (id) { msg(t('trip.reminded', { time: o.leaveAt }) + when); state.remindFocus = 'cancel'; }
    else { msg(t(host.remindersFull?.() ? 'trip.remindFull' : (host.notifyState && (await host.notifyState().catch(() => 'prompt')) === 'denied') ? 'trip.remindDenied' : 'trip.remindFailed'), 'err'); state.remindFocus = 'trigger'; } // 已經 5 筆：照實說（前端審查 #3）
    rerender();
  };
  const note = state.remindMsg && h('p', { class: state.remindMsg.kind === 'err' ? 'ab-fail' : 'ab-sub' }, state.remindMsg.text);
  if (cur?.opt === o.id) {
    return h('div', { class: 'ab-remind' },
      h('p', { class: 'ab-sub' }, t('trip.reminded', { time: o.leaveAt }) + when),
      host.cancelRemind && typeof cur.id === 'string' && focusLater(h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => {
        const ok = host.cancelRemind(cur.id);
        state.reminded = null; msg(t(ok === false ? 'trip.remindGone' : 'trip.remindCanceled')); state.remindFocus = 'trigger'; rerender();
      } }, t('trip.remindCancel')), 'cancel', state));
  }
  if (state.explain === o.id) { // 說明為什麼要通知，再跳系統對話框（拒絕過一次就很難再要）
    return h('div', { class: 'ab-remind ab-explain' },
      h('p', { class: 'ab-sub' }, t('trip.remindWhy', { time: o.leaveAt })),
      focusLater(h('button', { type: 'button', class: 'ab-btn ab-primary', onclick: set }, t('trip.remindAllow')), 'allow', state),
      h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.explain = null; msg(null); state.remindFocus = 'trigger'; rerender(); } }, t('trip.remindNotNow')));
  }
  return h('div', { class: 'ab-remind' },
    focusLater(h('button', { type: 'button', class: 'ab-btn', onclick: async () => {
      msg(null);
      const st = host.notifyState ? await host.notifyState().catch(() => 'prompt') : 'granted';
      if (st === 'prompt') { state.explain = o.id; state.remindFocus = 'allow'; rerender(); return; }
      if (st === 'denied' || st === 'unsupported') { msg(t(st === 'denied' ? 'trip.remindDenied' : 'trip.remindFailed'), 'err'); rerender(); return; }
      await set();
    } }, t(cur ? 'trip.remindMove' : 'trip.remind', { time: o.leaveAt })), 'trigger', state),
    note);
}
import { navButton, confirmLinkButton, bookButton } from '../actions.js';
import { calendarFromTrip, shareFromTrip } from '../../../../core/device-actions.js';

/**
 * 加到行事曆、分享（ADR-0021）：只放在建議方案下；host 有這兩個動作才顯示（MCP Apps 沒有）。
 * 內容由程式從這張卡片產生，最後一步在系統畫面（新增行程、分享面板）由使用者確認；結果寫在這一區。
 */
/** @returns {{ buttons: Array<HTMLElement|null>, status: HTMLElement|null }|null} */
function deviceBlock(o, { host, t, state, rerender, payload, locale = null, say = () => {} }) {
  if (!host?.addCalendar && !host?.share) return null;
  const lang = locale === 'en' ? 'en' : null;
  const event = host.addCalendar && calendarFromTrip(payload?.data, { optId: o.id, lang });
  const shared = host.share && shareFromTrip(payload?.data, { optId: o.id, lang });
  if (!event && !shared) return null;
  const run = async (kind) => {
    const r = await (kind === 'addCalendar' ? host.addCalendar(event) : host.share(shared)).catch(() => 'failed');
    const text = t(`device.${kind}.${r}`) === `device.${kind}.${r}` ? t('device.failed') : t(`device.${kind}.${r}`);
    state.device = { text, err: !['saved', 'downloaded', 'shared', 'copied', 'cancelled', 'opened'].includes(r) };
    say(text); rerender();
  };
  // 按鈕併進行程的那一列（設計審查：兩列看起來像兩組不相關的功能）；結果的一句話放在那一列下面
  return {
    buttons: [
      event && h('button', { type: 'button', class: 'ab-btn ab-device-btn', onclick: (e) => { e.stopPropagation(); run('addCalendar'); } }, t('device.addCalendar')),
      shared && h('button', { type: 'button', class: 'ab-btn ab-device-btn', onclick: (e) => { e.stopPropagation(); run('share'); } }, t('device.share')),
    ],
    status: state.device && h('p', { class: state.device.err ? 'ab-fail ab-device-status' : 'ab-sub ab-device-status', role: 'status' }, state.device.text),
  };
}

const MAX_ALT = 2;

/** 按建議方案的導航、叫車、訂票＝選了這種方式：送 abang:choice（網頁 App 的 habits.js 記常選的方式，只有方式；MCP Apps 裡沒人聽） */
const chose = (el, role) => {
  el.addEventListener('click', (e) => { if (e.target?.closest?.('button') && !e.target.closest('.ab-device-btn') && typeof CustomEvent === 'function') globalThis.dispatchEvent?.(new CustomEvent('abang:choice', { detail: { role } })); }, true); // 捕捉階段：按鈕自己 stopPropagation
  return el;
};

/**
 * 每段在分段條上的位置（依真實分鐘比例）；太短的段至少佔 minShare，其餘依比例縮，總和 1。
 * @returns {Array<{ mode: string, minutes: number, from: number, to: number }>}
 */
export function legShares(legs, minShare = 0.06) {
  const total = legs.reduce((n, l) => n + Math.max(0, l.minutes || 0), 0);
  if (!legs.length) return [];
  let raw = legs.map((l) => (total ? Math.max(0, l.minutes || 0) / total : 1 / legs.length));
  const small = raw.map((r) => r < minShare);
  const fixed = small.filter(Boolean).length * minShare;
  const rest = raw.reduce((n, r, i) => n + (small[i] ? 0 : r), 0);
  if (fixed < 1 && rest > 0) raw = raw.map((r, i) => (small[i] ? minShare : (r / rest) * (1 - fixed)));
  let at = 0;
  return legs.map((l, i) => { const from = at; at = i === legs.length - 1 ? 1 : at + raw[i]; return { mode: l.mode, minutes: l.minutes, from: +from.toFixed(4), to: +at.toFixed(4) }; });
}

const RUN_SEC = 3.2;
/**
 * 分段條：每段寬度依真實分鐘比例，有交通方式圖示＋分鐘（夠寬才放字）。
 * 上方的小代幣沿路線跑一趟，每段的時間也依分鐘比例；到轉乘點換成下一段的交通方式（走路 → 公車 → 走路），轉乘點亮一下。
 */
function legsBar(o, t, locale = null) {
  const icon = (mode) => { const i = document.createElement('span'); i.className = 'ab-leg-ic'; i.innerHTML = modeSvg(modeOf(mode) || 'walk'); return i; }; // 常數 SVG
  const sh = legShares(o.legs);
  const runners = sh.map((s, i) => {
    const r = token(s.mode === 'walk' ? 'walk' : (modeOf(s.mode) || o.role), { size: 'sm', cls: `ab-runner${i === sh.length - 1 ? ' last' : ''}` });
    r.style.setProperty('--from', String(s.from));
    r.style.setProperty('--to', String(s.to));
    r.style.setProperty('--d', `${(0.6 + s.from * RUN_SEC).toFixed(2)}s`);
    r.style.setProperty('--t', `${Math.max(0.25, (s.to - s.from) * RUN_SEC).toFixed(2)}s`);
    return r;
  });
  const xfers = sh.slice(1).map((s) => h('span', { class: 'ab-xfer', style: { '--at': String(s.from), '--d': `${(0.6 + s.from * RUN_SEC).toFixed(2)}s` } }));
  return h('div', { class: 'ab-legs-wrap' },
    runners,
    h('div', { class: 'ab-legs', role: 'img', 'aria-label': o.legs.map((l) => `${t(`trip.leg.${l.mode}`)} ${t('common.minutes', { n: l.minutes })}`).join(t('common.listSep')) },
      o.legs.map((l, i) => h('span', { class: `ab-leg ${l.mode}`, style: { flex: `0 0 ${((sh[i].to - sh[i].from) * 100).toFixed(2)}%`, '--i': String(i) }, title: locale === 'en' && l.detailEn ? l.detailEn : l.detail },
        sh[i].to - sh[i].from >= 0.08 && icon(l.mode), sh[i].to - sh[i].from >= 0.2 && h('b', null, `${l.minutes}`)))),
    xfers);
}

/** 方案名稱：英文那一輪用交通方式英文（公車號、捷運線名維持中文：Bus 棕9、MRT 淡水信義線），中文照原名（S12f） */
/** 英文卡片不放只有中文的句子（理由、提醒、不列入的原因；伺服器只產中文）：引號裡的地名、路線名不算（前端審查 #2） */
export const zhOnly = (s, locale) => locale === 'en' && /[\u3400-\u9fff]/.test(String(s || '').replace(/「[^」]*」|（[^）]*）/g, ''));
export function optName(o, t, locale) {
  if (locale !== 'en') return o.name;
  const n = String(o.name || '');
  if (o.role === 'bus') return `Bus ${n.replace(/^公車\s*/, '')}`.trim();
  if (o.role === 'metro') return `MRT ${n.replace(/^捷運\s*/, '')}`.replace(/（/g, ' (').replace(/）/g, ')').replace(/\s+/g, ' ').trim();
  if (o.role === 'intercity') return `Coach ${n.replace(/^國道客運\s*/, '')}`.trim(); // 留路線號
  if (o.role === 'ridehail') { const p = /（(.+?)）/.exec(n)?.[1]; return p ? `Taxi (${p})` : 'Taxi'; } // 留叫車平台
  const k = `trip.leg.${o.role}`;
  return t(k) === k ? n : t(k);
}

function optionBlock(o, ctx, best) {
  let dev = null; // 加到行事曆、分享（併進行程那一列）
  const { host, t } = ctx;
  const name = optName(o, t, ctx.locale);
  const range = o.costRange || [o.cost, o.cost];
  const cost = o.share // 多人叫車：每人分攤（多輛車寫出車數）
    ? `${t('common.pricePerPerson', { low: range[0], high: range[1] })}${o.share.cars > 1 ? t('trip.cars', { n: o.share.cars }) : ''}`
    : o.costRange ? t('common.priceRange', { low: o.costRange[0], high: o.costRange[1] }) : t('common.price', { n: o.cost });
  const ride = o.role === 'ridehail' && o.legs[0]?.url;
  // 備案：「改成這個」＝跟阿幫說改成它（沿用起訖點重算；公車會自動盯到站）
  const pick = !best && host?.ask && h('button', { type: 'button', class: 'ab-btn ab-pick', onclick: () => host.ask(t('trip.pickAsk', { name: t(`trip.leg.${o.role}`) === `trip.leg.${o.role}` ? o.name : t(`trip.leg.${o.role}`) })) } /* 送出的話用交通方式（英文時「Switch to MRT」伺服器聽得懂）；按鈕寫完整名稱 */, t('trip.pickAsk', { name })); // 審查：要像按鈕、≥ 44px、寫出方案名
  return h('div', { class: best ? 'ab-option best' : 'ab-option' },
    h('div', { class: 'ab-row' },
      token(o.role, { size: best ? 'lg' : 'md', go: best, label: name }),
      best && h('span', { class: 'ab-badge ab-best' }, t('trip.best')),
      h('span', { class: 'ab-name' }, name),
      h('span', { class: 'ab-big' }, t('common.minutes', { n: o.minutes })),
      h('span', { class: 'ab-sub' }, t('trip.arrive', { time: o.arriveAt })),
      h('span', { class: 'ab-sub' }, cost, o.estimated ? t('common.estimatedTag') : '')),
    best && leaveBlock(o, ctx),
    best && legsBar(o, t, ctx.locale),
    best && h('ul', { class: 'ab-legs-detail' }, o.legs.map((l) => h('li', {}, token(l.mode, { size: 'xs' }), ctx.locale === 'en' && l.detailEn ? l.detailEn : l.detail))),
    // YouBike 兩端都要看：起點有車、終點有空位；很緊時警告並給備用站
    o.bike && h('div', { class: 'ab-bike-ends' },
      h('span', { class: `ab-chip${o.bike.rent.tight ? ' warn' : ' ok'}` }, t('trip.bikeRent', { name: o.bike.rent.name, n: o.bike.rent.count })),
      h('span', { class: `ab-chip${o.bike.ret.tight ? ' warn' : ' ok'}` }, t('trip.bikeReturn', { name: o.bike.ret.name, n: o.bike.ret.count }))),
    o.bike && (o.bike.rent.tight || o.bike.ret.tight) && h('ul', { class: 'ab-bike-warn' }, o.notes.filter((n) => /可能/.test(n) && !/變動/.test(n) && !zhOnly(n, ctx.locale)).map((n) => h('li', {}, n))),
    best && (dev = deviceBlock(o, ctx), chose(h('div', { class: 'ab-actions' },
      navButton(host, o.legs[0]?.nav),
      ride && confirmLinkButton(host, ride, t('trip.ridehailConfirm'), t('trip.ridehail')),
      o.train && bookButton(host, { system: o.role.toUpperCase(), trainNo: o.train.trainNo, date: o.train.date, from: o.train.from, to: o.train.to }, (m) => { ctx.state.err = m; ctx.rerender(); }),
      ...(dev?.buttons || [])), o.role)),
    best && dev?.status,
    best && remindBlock(o, ctx),
    pick);
}

export default {
  title: (d, { t }) => t('trip.title', { from: d.from.name === '你的位置' ? t('place.here') : d.from.name, to: d.to.name }),
  body(d, ctx) {
    const { t, state } = ctx;
    const byId = new Map(d.options.map((o) => [o.id, o]));
    const best = byId.get(d.best);
    const warnTips = (d.tips || []).filter((x) => x.kind !== 'cost' && !zhOnly(x.text, ctx.locale)); // 時間很緊、帶傘：放在建議方案上面
    const costTips = (d.tips || []).filter((x) => x.kind === 'cost' && !zhOnly(x.text, ctx.locale));
    const alts = d.ranking.ranked.filter((r) => r.id !== d.best).slice(0, MAX_ALT).map((r) => byId.get(r.id)).filter(Boolean);
    const en = ctx.locale === 'en';
    const notIn = d.missing || d.skipped || [];
    const night = d.night && ((en && d.night.textEn) || d.night.text); // 深夜：公車、捷運收班或末班快到了（第一行就說）
    return h('div', { class: 'ab-body' },
      night && h('p', { class: 'ab-night', role: 'note' }, night),
      d.limited && h('p', { class: 'ab-night ab-limited', role: 'note' }, (en && d.limited.textEn) || d.limited.text), // TDX 額度用完：示範班次不推，照實說
      d.states?.length > 0 && h('div', { class: 'ab-chips', 'aria-label': t('trip.states') }, d.states.map((s) => h('span', { class: 'ab-chip', title: s.detail || '' },
        `${t(`trip.stateKey.${s.key}`)}・${t(`trip.state.${s.source}`)}`))),
      state.err && h('p', { class: 'ab-fail', role: 'alert' }, state.err),
      warnTips.length > 0 && h('ul', { class: 'ab-tips warn', 'aria-label': t('trip.tips') }, warnTips.map((x) => h('li', {}, x.text))),
      best ? optionBlock(best, ctx, true) : h('p', { class: 'ab-empty' }, t(!d.ranking.excluded.length ? 'trip.none' : d.ranking.excluded.every((e) => !String(e.why).includes('超過')) ? 'trip.allAvoided' : 'trip.allLate')),
      d.ranking.reason && !zhOnly(d.ranking.reason, ctx.locale) && h('p', { class: 'ab-reason' }, d.ranking.reason),
      costTips.length > 0 && h('ul', { class: 'ab-tips', 'aria-label': t('trip.costTips') }, costTips.map((x) => h('li', {}, x.text))),
      alts.length > 0 && h('div', { class: 'ab-alts' }, h('h4', {}, t('trip.alternatives')), alts.map((o) => optionBlock(o, ctx, false))),
      // 沒列入的方式與原因（missing 已含 skipped；舊資料只有 skipped）：深夜收班、附近沒有站、沒有趕得上的班次…
      notIn.length > 0 && h('ul', { class: 'ab-skipped', 'aria-label': t('trip.missing') }, notIn.map((s) => h('li', { 'data-role': s.role, ...(s.route && { 'data-route': s.route }), ...(s.closed && { class: 'closed' }) }, token(s.role, { size: 'xs' }), t('trip.skipped', { name: s.route ? optName({ role: 'bus', name: `公車 ${s.route}` }, t, ctx.locale) : t(`trip.leg.${s.role}`), why: (en && s.whyEn) || s.why })))), // route：那一條公車今天不會來（「公車 三峽-臺北市信義區沒列入：今天沒有營運」）
      d.ranking.excluded.length > 0 && h('div', { class: 'ab-excluded' }, h('h4', {}, t('trip.excluded')),
        h('ul', { class: 'ab-list' }, d.ranking.excluded.map((e) => h('li', { class: 'ab-row off' }, token(byId.get(e.id)?.role || e.id, { size: 'sm', cls: 'off' }), h('span', { class: 'ab-name' }, e.name || e.id), h('span', { class: 'ab-sub' }, zhOnly(e.why, ctx.locale) ? '' : e.why))))));
  },
};
