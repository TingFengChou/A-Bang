// drama（drama_picks、drama_search、drama_series；ADR-0019）：MyDrama 短劇的排行、搜尋結果、簡介。
// 封面（2026-11-23）：有封面時由阿幫伺服器代抓（host.assetUrl，片庫的圖片伺服器看不到使用者的 IP）；MCP Apps 不載入外部圖片、
// 沒有封面或圖載不到時，用劇名第一個字＋依 id 決定的漸層色當示意（圖載入失敗就拿掉 img，字一直在底下）。
// 看劇：host.openApp（網頁與 App：先開 MyDrama App，沒裝就到商店頁）；MCP Apps 沒有 openApp，只給 https 的商店頁（host.openLink）。
import { h, safeUrl } from '../dom.js';

const TONES = [['#0f766e', '#5eead4'], ['#be185d', '#f9a8d4'], ['#7c3aed', '#c4b5fd'], ['#b45309', '#fcd34d'], ['#1d4ed8', '#93c5fd'], ['#15803d', '#86efac']];
const tone = (id) => TONES[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
/** 商店頁：iPhone／iPad 用 App Store，其他用 Google Play（沒有就用另一個） */
export function storeFor(store, ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  if (!store) return null;
  const ios = /iPhone|iPad|iPod/i.test(ua) || globalThis.Capacitor?.getPlatform?.() === 'ios';
  return safeUrl(ios ? store.ios || store.android : store.android || store.ios);
}

/** 「在 MyDrama 看」按鈕：有 openApp 用它（App 連結＋商店備援）；只有 https 商店頁時用 openLink；都沒有不顯示 */
export function watchButton(host, item, store, t, { primary = true } = {}) {
  const storeUrl = storeFor(store);
  const go = host?.openApp && (item.appLink || storeUrl)
    ? () => host.openApp({ app: item.appLink, store })
    : host?.openLink && storeUrl ? () => host.openLink(storeUrl) : null;
  if (!go) return null;
  const label = item.appLink && host?.openApp ? t('drama.watch') : t('drama.store');
  return h('button', { type: 'button', class: `ab-btn${primary ? ' ab-primary' : ''} ab-drama-watch`, 'aria-label': `${label}：《${item.title}》`, onclick: (e) => { e.stopPropagation(); go(); } }, label);
}

/** 封面圖（伺服器代抓；沒有 assetUrl 或沒有封面回 null）：裝飾用（alt 空、外框 aria-hidden），載不到就拿掉 */
export function coverImg(host, s) {
  const src = s?.cover === true && host?.assetUrl?.(`/api/v1/drama/cover/${encodeURIComponent(s.id)}`);
  return src ? h('img', { class: 'ab-poster-img', src, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.remove() }) : null;
}

const meta = (s, t) => [s.episodes != null && t('drama.eps', { n: s.episodes }), s.freeEpisodes ? t('drama.free', { n: s.freeEpisodes }) : null, t(s.completed ? 'drama.done' : 'drama.ongoing')].filter(Boolean).join('・');

export default {
  title: (d, { t }) => (d.kind === 'series' ? t('drama.titleSeries') : d.kind === 'search' ? t('drama.titleSearch', { q: d.query }) : t('drama.titleList', { name: t(`drama.list.${d.list || 'hot'}`) })),
  body(d, { host, t, state, rerender, payload }) {
    state.open ||= {}; // 展開簡介的劇（刷新、重畫時保留）
    const load = async (name, args) => {
      try {
        Object.assign(payload, await host.callTool(name, args));
        const titles = payload.data.items.slice(0, 3).map((x) => `《${x.title}》`).join('、');
        if (titles) host.setContext?.(t('drama.context', { titles }));
        rerender();
      } catch { /* 查不到就維持原畫面 */ }
    };
    const more = async (s) => { // 簡介：清單裡只有前 160 字，展開時查完整簡介（drama_series）
      state.open[s.id] = !state.open[s.id];
      if (state.open[s.id] && !state.full?.[s.id] && host?.callTool && d.kind !== 'series') {
        try { const r = await host.callTool('drama_series', { id: s.id }); (state.full ||= {})[s.id] = r.data.items[0]?.synopsis || s.synopsis; } catch { /* 用清單裡的簡介 */ }
      }
      rerender();
    };
    const rows = d.items.map((s) => {
      const [a, b] = tone(s.id);
      const open = d.kind === 'series' || state.open[s.id];
      const syn = (open && state.full?.[s.id]) || s.synopsis;
      return h('li', { class: 'ab-drama' },
        h('div', { class: 'ab-poster', 'aria-hidden': 'true', style: { '--pa': a, '--pb': b } },
          h('span', { class: 'ab-poster-ch' }, [...s.title][0]),
          coverImg(host, s),
          s.rank != null && h('span', { class: 'ab-poster-rank' }, s.rank),
          s.isNew && h('span', { class: 'ab-poster-new' }, t('drama.new'))),
        h('div', { class: 'ab-drama-main' },
          h('strong', { class: 'ab-drama-title' }, s.rank != null && h('span', { class: 'ab-sr' }, t('drama.rank', { n: s.rank })), `《${s.title}》`),
          h('p', { class: 'ab-sub ab-drama-meta' }, meta(s, t), s.taiwanOriginal && h('span', { class: 'ab-drama-tw' }, t('drama.tw'))),
          s.tags.length > 0 && h('div', { class: 'ab-chips' }, s.tags.slice(0, 3).map((x) => h('span', { class: 'ab-chip' }, x))),
          syn && h('p', { class: `ab-drama-syn${open ? ' open' : ''}` }, syn),
          h('div', { class: 'ab-drama-acts' },
            watchButton(host, s, d.store, t),
            d.kind !== 'series' && syn && h('button', { type: 'button', class: 'ab-btn ab-link', 'aria-expanded': String(!!open), onclick: () => more(s) }, t(open ? 'drama.less' : 'drama.more')))));
    });
    const empty = d.items.length === 0 && h('div', { class: 'ab-empty', role: 'status' },
      h('p', null, t('drama.empty', { q: d.query || '' })),
      host?.callTool && h('button', { type: 'button', class: 'ab-btn', onclick: () => load('drama_picks', { list: 'hot' }) }, t('drama.tryHot')));
    const kw = d.keywords?.length > 0 && host?.callTool && h('div', { class: 'ab-drama-kw' }, h('span', { class: 'ab-sub' }, t('drama.hot')),
      d.keywords.map((k) => h('button', { type: 'button', class: 'ab-tab', onclick: () => load('drama_search', { query: k }) }, k)));
    return h('div', { class: 'ab-body' },
      d.kind === 'search' && d.total > d.items.length && h('p', { class: 'ab-sub' }, t('drama.count', { n: d.total, m: d.items.length })),
      rows.length > 0 && h('ul', { class: 'ab-list ab-drama-list' }, rows),
      empty, kw,
      h('p', { class: 'ab-foot' }, t('drama.note')));
  },
};
