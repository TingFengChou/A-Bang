// 生活服務頁（首頁格子 → #/s/:id）：每個服務＝一個 tool＋一種卡片，畫面由同一份卡片程式渲染（CARDS.md、ADR-0003）。
// 資料一律經 /api/v1/tools/:name（金鑰只在伺服器）；需要位置的服務先定位（拒絕時用預設位置並說明）。
import { renderCard } from '../../ui/cards/index.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { loading, errorBox, locate, FALLBACK, prefs } from '../ui.js';
import { locationNotice } from '../location-help.js';
import { icons } from '../icons.js';
import { renderWallet } from '../invoice-wallet.js';

const METRO = [['TRTC', '台北捷運'], ['TYMC', '桃園機場捷運'], ['TMRT', '台中捷運'], ['KRTC', '高雄捷運']];

/**
 * 服務設定：title、tool、where（需要位置）、form（輸入欄位 HTML）、args(form, pos) → tool 參數、auto（進頁就查）、after(el, { callTool, toast })（卡片下方的區塊）
 * 新增服務＝這裡一筆＋registry.js 的格子＋core 的 tool 與卡片。
 */
export const SERVICES = {
  metro: {
    title: '捷運到站', tool: 'metro_live_board', auto: true,
    form: `<div class="row"><select class="field" name="system" aria-label="捷運系統">${METRO.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
      <div class="row"><input class="field" name="station" list="metro-stations" value="台北車站" placeholder="站名，例如 台北車站" aria-label="車站" autocomplete="off"><datalist id="metro-stations"></datalist><button class="btn">查詢</button></div>`,
    args: (f) => ({ system: f.system.value, station: f.station.value.trim() }),
    /** 站名選單：依系統載入 metro_stations */
    async setup(f, callTool) {
      const fill = async () => {
        try {
          const r = await callTool('metro_stations', { system: f.system.value });
          const dl = f.querySelector('#metro-stations');
          dl.replaceChildren(...r.data.map((s) => Object.assign(document.createElement('option'), { value: s.name })));
        } catch { /* 選單只是輔助 */ }
      };
      f.system.addEventListener('change', () => { f.station.value = ''; fill(); });
      await fill();
    },
  },
  weather: { title: '天氣', tool: 'weather_now', where: true, auto: true, args: (_f, p) => ({ lat: p.lat, lon: p.lon }) },
  aqi: { title: '空氣品質', tool: 'aqi_nearby', where: true, auto: true, args: (_f, p) => ({ lat: p.lat, lon: p.lon }) },
  quake: {
    title: '地震', tool: 'earthquake_recent', auto: true,
    form: `<div class="row"><input class="field" name="county" placeholder="看某縣市的震度（選填），例如 臺北市" aria-label="縣市" maxlength="10"><button class="btn">查詢</button></div>`,
    args: (f) => ({ ...(f.county.value.trim() && { county: f.county.value.trim() }), limit: 5 }),
  },
  pharmacy: {
    title: '健保藥局', tool: 'pharmacy_search', auto: true,
    form: `<div class="row"><input class="field" name="area" placeholder="地區，例如 臺北市大安區" aria-label="地區" maxlength="20"></div>
      <div class="row"><input class="field" name="query" placeholder="藥局名稱或路名（選填）" aria-label="藥局名稱或路名" maxlength="20"><button class="btn">搜尋</button></div>`,
    setup(f) { f.area.value = prefs.get('pharmacy:area', '臺北市中正區'); },
    args: (f) => { prefs.set('pharmacy:area', f.area.value.trim()); return { ...(f.area.value.trim() && { area: f.area.value.trim() }), ...(f.query.value.trim() && { query: f.query.value.trim() }) }; },
  },
  garbage: { title: '垃圾車', tool: 'garbage_truck_nearby', where: true, auto: true, args: (_f, p) => ({ lat: p.lat, lon: p.lon }) },
  fuel: { title: '油價', tool: 'fuel_price', auto: true, args: () => ({}) },
  // 卡片下方是「我的發票」（本機保存，開獎後自動對獎）
  invoice: { title: '發票對獎', tool: 'invoice_lottery', auto: true, args: () => ({}), after: renderWallet },
  // 股市收盤行情（證交所、櫃買中心）：記住上次查的股票
  stock: {
    title: '股市行情', tool: 'stock_quote', auto: true,
    form: `<div class="row"><input class="field" name="query" placeholder="代號或名稱，多檔用「、」分隔" aria-label="股票代號或名稱" maxlength="60"><button class="btn">查詢</button></div>`,
    setup(f) { f.query.value = prefs.get('stock:query', '台積電、0050'); },
    args: (f) => { const q = f.query.value.trim(); prefs.set('stock:query', q); return q ? { query: q } : {}; },
  },
};

export default {
  title: '生活服務',
  hero: ({ params: [id] }) => id, // 頁首（page-hero.js）
  async render({ main, params: [id], setTitle, setAction, onCleanup, toast }) {
    const cfg = SERVICES[id];
    if (!cfg) { main.innerHTML = errorBox('沒有這個服務'); return; }
    setTitle(cfg.title);
    if (globalThis.__DEMO_SERVICES__) { main.innerHTML = errorBox('這個服務需要連線到阿幫伺服器（npm start）。'); return; }
    const host = createWebHost({ ask: (q) => { location.hash = `#/agent?q=${encodeURIComponent(q)}`; } });
    const callTool = (name, args) => host.callTool(name, args);
    main.innerHTML = `${cfg.form ? `<form class="form" id="f">${cfg.form}</form>` : ''}<p class="updated" id="where" hidden></p><div id="res"></div>${cfg.after ? '<div id="after"></div>' : ''}`;
    const f = main.querySelector('#f');
    const res = main.querySelector('#res');
    let view = null;
    onCleanup(() => view?.destroy());

    async function run(fresh = false) {
      view?.destroy(); view = null;
      res.innerHTML = loading();
      try {
        let pos = null;
        if (cfg.where) {
          pos = await locate({ fresh });
          const w = main.querySelector('#where');
          w.hidden = false;
          w.textContent = pos === FALLBACK ? `位置：${FALLBACK.label}（沒有取得定位）` : '位置：目前位置附近';
          main.querySelector('.loc-help')?.remove();
          if (pos === FALLBACK) w.after(locationNotice({ retry: () => run(true), onCleanup })); // 說原因與下一步（S1c）
        }
        const payload = await callTool(cfg.tool, cfg.args(f, pos));
        res.replaceChildren();
        const slot = document.createElement('div');
        res.append(slot);
        view = renderCard(slot, { ...payload, tool: payload.name }, host);
      } catch (e) { res.innerHTML = errorBox(e); }
    }
    if (f) f.addEventListener('submit', (e) => { e.preventDefault(); run(); });
    if (cfg.where) setAction(icons.locate, () => run(true), '重新定位');
    if (cfg.setup) await cfg.setup(f, callTool);
    if (cfg.auto) run();
    if (cfg.after) cfg.after(main.querySelector('#after'), { callTool, toast });
  },
};

