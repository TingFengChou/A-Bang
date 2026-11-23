// 短劇（MyDrama，ADR-0019）：adapter 防禦解析與正規化、Mock 對等、連結檢查、工具與卡片、等車推劇（門檻、一輪一次、關掉、英文不推）、
// 找劇意圖、開 App 的備援、運動建議提示句，以及 repo 裡沒有 MyDrama 網址（公開 repo）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normSeries, normList, normKeywords, dramaLinks, dramaQuery, createDramaServices, createLiveDramaFetchers, pickForWait, parseList, isAdult, DRAMA_TTL, LIST_MAX } from '../core/services/drama.js';
import { createMockDramaServices, demoDramaFetchers } from '../core/services/drama-mock.js';
import { isAppLink, isStoreLink, linkFrom, waitHint, exerciseNudge, WAIT_MIN } from '../core/drama-say.js';
import { waitMinutes, waitDrama } from '../core/agent/wait-drama.js';
import { createOpenDataClient } from '../core/opendata-client.js';
import { createServices } from '../core/index.js';
import { callTool } from '../core/tools/index.js';
import { runDemo, execTools, asideState, validateRequest } from '../core/agent/run.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { ev } from '../core/agent/events.js';
import { getProfile } from '../core/agents/index.js';
import { UserError } from '../core/util.js';

// 測試用的連結範本：明顯虛構（example），不是 MyDrama 的真實格式
const LINKS = { episode: 'example-drama://watch/{id}/{ep}', exercise: 'example-drama://unlock', storeIos: 'https://example.com/ios', storeAndroid: 'https://example.com/android' };

test('normSeries：只留阿幫的欄位、限制級與不合格的 id 丟掉、數字防禦、簡介截斷', () => {
  const raw = { id: 's1', title: '  夜班  公車 ', tags: ['甜寵', '甜寵', '', 3, '都市', 'a', 'b', 'c'], episodes: '60', freeEpisodes: 99, category: '愛情', taiwanOriginal: 'true', newRelease: false, completed: true, heat: 12.7, contentRating: 'GENERAL', synopsis: '一'.repeat(400), cover: 'https://cdn.example.com/x.jpg', price: 30, extra: 5, flag: true, media: { url: 'x' }, availableEpisodes: 20 };
  const s = normSeries(raw);
  assert.deepEqual(Object.keys(s).sort(), ['_cover', 'completed', 'episodes', 'freeEpisodes', 'genre', 'heat', 'id', 'isNew', 'ready', 'synopsis', 'tags', 'taiwanOriginal', 'title'].sort(), '其他欄位（價格…）不往上傳；封面網址只留在伺服器（_cover）');
  assert.equal(s._cover, 'https://cdn.example.com/x.jpg');
  assert.equal(s.title, '夜班 公車');
  assert.deepEqual(s.tags, ['甜寵', '都市', 'a', 'b', 'c']);
  assert.equal(s.episodes, 60);
  assert.equal(s.freeEpisodes, 60, '免費集數不超過總集數');
  assert.equal(s.heat, 12);
  assert.equal(s.taiwanOriginal, true);
  assert.equal(s.synopsis.length, 160);
  for (const bad of [null, 'x', {}, { id: '../login', title: 'x' }, { id: 's1?ep=9', title: 'x' }, { id: 'x'.repeat(65), title: 'x' }, { id: 's2' }, { id: 's3', title: '   ' }]) assert.equal(normSeries(bad), null, JSON.stringify(bad));
  // 分級：限制級（中文或英文代碼）、缺分級、不是字串都不推薦；一般、保護、輔12、輔15 照常
  for (const r of ['限制級', 'RESTRICTED', 'restricted', 'R18', 'R 18', 'R-18', '18+', '18', '成人', 'ADULT']) assert.equal(normSeries({ id: 'a', title: 'x', contentRating: r }), null, r);
  for (const r of [undefined, null, 18, {}, ['GENERAL'], '', '  ']) assert.equal(normSeries({ id: 'a', title: 'x', contentRating: r }), null, `分級 ${JSON.stringify(r)} 當限制級`);
  for (const r of ['GENERAL', 'PG', 'R12', 'R15', '普遍級', '保護級', '輔12級', '輔15級']) assert.equal(normSeries({ id: 'a', title: 'x', contentRating: r })?.title, 'x', r);
  assert.equal(isAdult('R15'), false);
  const n = normSeries({ id: 'a', title: 'x', contentRating: 'PG', episodes: -1, freeEpisodes: 'abc', heat: null });
  assert.deepEqual([n.episodes, n.freeEpisodes, n.heat, n.synopsis, n.genre], [null, null, null, null, null]);
});

test('normList／normKeywords／dramaQuery：不是陣列回空、去重、關鍵字上限；搜尋詞去掉套話', () => {
  assert.deepEqual(normList({ items: [] }), []);
  assert.deepEqual(normList([{ id: 'a', title: 'A', contentRating: 'GENERAL' }, { id: 'a', title: 'A2', contentRating: 'GENERAL' }, null, { id: 'b', title: 'B', contentRating: 'RESTRICTED' }]).map((s) => s.title), ['A']);
  // 一次最多留 50 部，只留正規化後的欄位（快取的就是這個）
  const many = parseList(Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, title: `劇${i}`, contentRating: 'GENERAL', cover: 'x', price: 9 })));
  assert.equal(many.length, LIST_MAX);
  assert.ok(many.every((x) => !('cover' in x) && !('price' in x)));
  assert.throws(() => parseList({ items: [] }), /不是清單/);
  assert.deepEqual(normKeywords(['甜寵', '甜寵', '', 1, ...'abcdefghij'.split('')]).length, 8);
  assert.deepEqual(normKeywords('x'), []);
  assert.equal(dramaQuery('有沒有甜寵的短劇？'), '甜寵');
  assert.equal(dramaQuery('《捷運末班車》'), '捷運末班車');
  assert.equal(dramaQuery('推薦一部短劇'), '');
  assert.equal(dramaQuery('總裁的便當外送員'), '總裁的便當外送員', '劇名中間的字不動');
  assert.equal(dramaQuery('甜寵劇'), '甜寵');
});

test('連結：只收安全的 App 連結與 https 商店頁；範本代入 id 與集數會檢查', () => {
  for (const ok of ['example-drama://watch/a/1', 'https://example.com/w/a']) assert.ok(isAppLink(ok), ok);
  for (const bad of ['javascript://%0aalert(1)', 'javascript:alert(1)', 'data://x', 'file:///etc/passwd', 'http://example.com', 'intent://x', 'example://a b', 'example://a"b', '', null, `x://${'a'.repeat(300)}`]) assert.ok(!isAppLink(bad), String(bad));
  assert.ok(isStoreLink('https://example.com/store'));
  assert.ok(!isStoreLink('http://example.com/store'));
  assert.equal(linkFrom(LINKS.episode, { id: 'demo-1', ep: 1 }), 'example-drama://watch/demo-1/1');
  assert.equal(linkFrom(LINKS.episode, { id: '../x', ep: 1 }), null);
  assert.equal(linkFrom(LINKS.episode, { id: 'a', ep: 0 }), null);
  assert.equal(linkFrom(LINKS.episode, { id: 'a', ep: 1.5 }), null);
  assert.equal(linkFrom('javascript://{id}', { id: 'a' }), null);
  const l = dramaLinks(LINKS);
  assert.equal(l.episode('a', 2), 'example-drama://watch/a/2');
  assert.equal(l.exercise(), 'example-drama://unlock');
  assert.deepEqual(l.store(), { ios: 'https://example.com/ios', android: 'https://example.com/android' });
  const none = dramaLinks({ episode: 'javascript://{id}', exercise: 'data://x', storeIos: 'http://x', storeAndroid: 'ftp://x' });
  assert.deepEqual([none.episode('a'), none.exercise(), none.store()], [null, null, null], '不合格的設定當沒設定');
  assert.equal(dramaLinks({ episode: 'example://no-id' }).episode('a'), null, '範本沒有 {id} 不採用');
  assert.equal(dramaLinks().store(), null);
});

test('真實 adapter：網址只從設定來、只打公開讀取路徑、快取時間、不帶授權標頭', async () => {
  assert.equal(createLiveDramaFetchers({ od: {}, base: 'http://api.example.com' }), null, '非本機只能 https');
  assert.equal(createLiveDramaFetchers({ od: {}, base: '' }), null);
  assert.equal(createLiveDramaFetchers({ od: {}, base: 'javascript:alert(1)' }), null);
  const calls = [];
  const od = { get: async (url, o) => { calls.push({ url, ...o }); return o.parse(url.includes('/synopsis') || /series\/[^/]+$/.test(url) ? { id: 'a', title: 'A' } : []); } };
  const fx = createLiveDramaFetchers({ od, base: 'https://api.example.com/v1/' });
  await fx.ranking('hot'); await fx.search('甜 寵&x=1'); await fx.series('a'); await fx.synopsis('a'); await fx.keywords();
  assert.deepEqual(calls.map((c) => c.url), [
    'https://api.example.com/v1/catalog/ranking?type=hot',
    'https://api.example.com/v1/catalog/search?q=%E7%94%9C%20%E5%AF%B5%26x%3D1',
    'https://api.example.com/v1/catalog/series/a',
    'https://api.example.com/v1/series/a/synopsis',
    'https://api.example.com/v1/catalog/hot-keywords',
  ]);
  assert.deepEqual(calls.map((c) => c.ttlSec), [DRAMA_TTL.list, DRAMA_TTL.list, DRAMA_TTL.series, DRAMA_TTL.series, DRAMA_TTL.list]);
  assert.ok(calls.every((c) => !c.headers?.authorization && !c.headers?.Authorization && c.label.startsWith('MyDrama')));
  assert.ok(createLiveDramaFetchers({ od, base: 'http://localhost:3000' }), '本機開發可以用 http');
});

test('真實 adapter＋開放資料 client：找不到是 UserError；上游故障、格式不符是上游錯誤，訊息不含網址', async () => {
  const mk = (handler) => {
    const od = createOpenDataClient({ fetchImpl: async (url) => handler(String(url)) });
    return createDramaServices(createLiveDramaFetchers({ od, base: 'https://secret-host.example.com' }), { links: LINKS });
  };
  const json = (body, status = 200, len = null) => ({ ok: status < 400, status, headers: { get: (k) => (k === 'content-length' ? len : null) }, text: async () => JSON.stringify(body), json: async () => body });
  const gone = mk((u) => (u.includes('/catalog/series/') ? json({}, 410) : json({})));
  await assert.rejects(gone.drama.series({ id: 'zz' }), (e) => e instanceof UserError && /下架/.test(e.message));
  const down = mk(() => json({}, 500));
  await assert.rejects(down.drama.picks({}), (e) => !(e instanceof UserError) && /MyDrama 排行回應錯誤（HTTP 500）/.test(e.message) && !/secret-host/.test(e.message));
  const weird = mk(() => json({ not: 'a list' }));
  await assert.rejects(weird.drama.search({ query: '甜寵' }), (e) => /格式不符預期/.test(e.message) && !/secret-host/.test(e.message));
  const off = mk(() => { throw new Error('ECONNREFUSED secret-host'); });
  await assert.rejects(off.drama.picks({}), (e) => /連線失敗/.test(e.message) && !/secret-host/.test(e.message));
  assert.equal(await off.drama.waitPick(), null, '等車推劇：上游失敗就不推');
  // 正常：簡介端點補完整簡介；熱搜失敗不影響排行
  const ok = mk((u) => (u.includes('hot-keywords') ? json({}, 500) : u.includes('/synopsis') ? json({ seriesId: 'a', synopsis: '完整簡介' }) : u.includes('/catalog/series/') ? json({ id: 'a', title: 'A', synopsis: '短', contentRating: 'GENERAL' }) : json([{ id: 'a', title: 'A', freeEpisodes: 3, contentRating: 'GENERAL' }])));
  assert.equal((await ok.drama.series({ id: 'a' })).items[0].synopsis, '完整簡介');
  const p = await ok.drama.picks({});
  assert.deepEqual([p.items[0].appLink, p.keywords], ['example-drama://watch/a/1', []]);
  await assert.rejects(ok.drama.search({ query: '短劇' }), UserError, '只說「短劇」沒有要找的字');
  // 回應太大：宣告的長度或實際內容超過 2 MB 都不解析
  const huge = mk(() => json([], 200, '9999999'));
  await assert.rejects(huge.drama.picks({}), (e) => /回應太大/.test(e.message));
  const big = mk(() => json([{ id: 'a', title: 'A', synopsis: 'x'.repeat(2_100_000), contentRating: 'GENERAL' }]));
  await assert.rejects(big.drama.search({ query: '甜寵' }), (e) => /回應太大/.test(e.message));
  // 單劇是限制級：當成找不到
  const adult = mk((u) => (u.includes('/catalog/series/') ? json({ id: 'r', title: 'R', contentRating: 'RESTRICTED' }) : json({})));
  await assert.rejects(adult.drama.series({ id: 'r' }), UserError);
});

test('Mock 對等：示範與真實版方法相同、輸出欄位相同；示範資料是虛構的', async () => {
  const mock = createMockDramaServices({ links: LINKS });
  const raw = JSON.parse(await readFile(new URL('../core/data/demo/drama.json', import.meta.url), 'utf8'));
  // 用同一份資料走「真實版」的服務（假的上游）：輸出要一模一樣
  const live = createDramaServices({ ...demoDramaFetchers }, { links: LINKS });
  assert.deepEqual(Object.keys(mock.drama).sort(), Object.keys(live.drama).sort());
  assert.deepEqual(await mock.drama.picks({}), await live.drama.picks({}));
  const keys = (x) => Object.keys(x).sort().join();
  const p = await mock.drama.picks({ list: 'new' });
  assert.ok(p.items.every((s) => s.isNew));
  assert.ok(!(await mock.drama.picks({ limit: 10 })).items.some((s) => s.title === '深夜限定'), '限制級不推薦');
  const s = await mock.drama.search({ query: '甜寵' });
  assert.ok(s.total >= 3 && s.items.every((x) => x.tags.includes('甜寵')));
  assert.equal(keys(s.items[0]), keys(p.items[0]).replace('rank,', ''));
  assert.ok(raw.series.every((x) => x.id.startsWith('demo-')), '示範 id 都是 demo- 開頭（虛構）');
  await assert.rejects(mock.drama.series({ id: 'nope' }), UserError);
  const DAY = Date.parse('2026-11-23T09:00:00+08:00');
  const w = await mock.drama.waitPick({ turn: 1, now: DAY });
  assert.equal(w.ep, 1);
  assert.equal(w.appLink, `example-drama://watch/${w.id}/1`);
  assert.equal(pickForWait([{ id: 'a', title: 'A', freeEpisodes: 0 }, { id: 'b', title: 'B', freeEpisodes: 2, ready: 0 }, { id: 'c', title: 'C', freeEpisodes: 1 }]).id, 'c', '要有免費集數、第 1 集已上架');
  assert.equal(mock.drama.exerciseLink(), 'example-drama://unlock');
  assert.equal(createMockDramaServices().drama.exerciseLink(), null);
});

test('等車推劇輪替：熱門前 5 部裡可看的，依台灣日期＋對話輪次換；同一天同一輪重問是同一部；第 6 名以後不推', async () => {
  const mock = createMockDramaServices({ links: LINKS });
  const DAY = Date.parse('2026-11-23T09:00:00+08:00');
  const top5 = (await mock.drama.picks({ limit: 5 })).items.filter((x) => x.freeEpisodes >= 1).map((x) => x.id);
  const at = async (turn, now = DAY) => (await mock.drama.waitPick({ turn, now })).id;
  assert.equal(await at(1), await at(1), '同一輪重問不換（畫面不閃動）');
  assert.equal(await at(1, DAY + 3600e3 * 10), await at(1), '同一個台灣日期（晚上 7 點）還是同一部');
  const turns = await Promise.all([1, 2, 3, 4, 5].map((t) => at(t)));
  assert.deepEqual([...new Set(turns)].sort(), [...top5].sort(), '連續 5 輪輪過前 5 部');
  assert.notEqual(await at(1, DAY + 864e5), await at(1), '隔天換一部');
  assert.ok(turns.every((id) => top5.includes(id)), '只從前 5 部挑');
  // 前 5 部裡沒有免費集數的跳過；台灣日期用 +8 時區（UTC 16:00 已是隔天）
  const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, title: id, freeEpisodes: i === 1 ? 0 : 1 }));
  for (let t = 0; t < 8; t++) assert.ok(['a', 'c', 'd', 'e'].includes(pickForWait(list, { turn: t, now: DAY }).id));
  assert.notEqual(pickForWait(list, { turn: 0, now: Date.parse('2026-11-23T15:59:00Z') }).id, pickForWait(list, { turn: 0, now: Date.parse('2026-11-23T16:01:00Z') }).id);
  // 問阿幫：同一段對話第幾句（使用者第幾則）決定輪次
  assert.equal(asideState({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }, getProfile('life'), DAY).turn, 2, '沒送輪次：退回用訊息數');
  assert.equal(asideState({ turn: 23, messages: [{ role: 'user', content: 'a' }] }, getProfile('life'), DAY).turn, 23, '手機送的輪次優先（訊息只送最近 10 則）');
  assert.equal(validateRequest({ messages: [{ role: 'user', content: 'a' }], turn: 23 }).turn, 23);
  for (const bad of [0, 1.5, -1, '3']) assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'a' }], turn: bad }), UserError, String(bad));
});

test('等車推劇不拖慢回答：一輪開始就並行拿排行，到站結果出來時直接用；關掉時不拿', async () => {
  const svc = createServices({ forceMock: true, drama: { links: LINKS } });
  let calls = 0;
  const real = svc.drama.waitPick;
  const counted = { ...svc, drama: { ...svc.drama, waitPick: (a) => { calls += 1; return real(a); } } };
  const st = asideState({ messages: [{ role: 'user', content: 'x' }] }, getProfile('life'), Date.now(), counted);
  assert.equal(calls, 1, '一開始就拿');
  assert.ok(st.pick);
  const a = await waitDrama(counted, { tool: 'bus_route_eta', data: { focus: { status: 0, etaSec: 600 } }, parent: 't1' }, st);
  assert.ok(a);
  assert.equal(calls, 1, '到站結果出來時沒有再查一次');
  const off = asideState({ messages: [{ role: 'user', content: 'x' }], userState: { dramaHint: false } }, getProfile('life'), Date.now(), counted);
  assert.equal(off.pick, null);
  assert.equal(calls, 1, '關掉就不拿');
});

test('工具：drama_picks／drama_search／drama_series（示範）；mode 看 MYDRAMA_API_BASE；搜尋沒結果照實說', async () => {
  const svc = createServices({ forceMock: true, drama: { links: LINKS } });
  const p = await callTool(svc, 'drama_picks', {});
  assert.deepEqual([p.card, p.mode, p.data.kind, p.data.list, p.data.items.length], ['drama', 'demo', 'list', 'hot', 5]);
  assert.match(p.speak, /^熱門排行前 3 名：《夜班公車的約定》/);
  assert.match(p.text, /共 60 集・前 10 集免費・已完結/);
  const s = await callTool(svc, 'drama_search', { query: '殭屍' });
  assert.deepEqual([s.data.items.length, s.data.total], [0, 0]);
  assert.match(s.speak, /沒有找到「殭屍」/);
  const d = await callTool(svc, 'drama_series', { id: 'demo-grandma-18' });
  assert.match(d.text, /簡介：七十八歲的阿嬤/);
  await assert.rejects(callTool(svc, 'drama_series', { id: '../x' }), UserError);
  await assert.rejects(callTool(svc, 'drama_picks', { list: 'adult' }), UserError);
  // 有設定 MYDRAMA_API_BASE（DEMO_MODE 沒開）才算真實資料
  assert.equal(createServices({ drama: { apiBase: 'https://api.example.com' } }).dramaMode, 'live');
  assert.equal(createServices({ forceMock: true, drama: { apiBase: 'https://api.example.com' } }).dramaMode, 'demo');
  assert.equal(createServices({ drama: { apiBase: 'http://not-local.example.com' } }).dramaMode, 'demo', '網址不合格就用示範');
});

test('等車時間：公車扣掉走到站牌的時間、捷運取最快的一班；資料不完整回 null', () => {
  assert.equal(waitMinutes('bus_route_eta', { focus: { status: 0, etaSec: 480 } }), 8);
  assert.equal(waitMinutes('bus_route_eta', { focus: { status: 0, etaSec: 480, distanceM: 60 } }), 8, '就在站牌旁邊');
  assert.ok(waitMinutes('bus_route_eta', { focus: { status: 0, etaSec: 480, distanceM: 472 } }) < 2, '走過去要 7 分');
  assert.equal(waitMinutes('bus_route_eta', { focus: { status: 0, etaSec: 600 } }, { walkMin: 3 }), 7, '行程選公車：扣 walkMin');
  assert.equal(waitMinutes('bus_route_eta', { focus: { status: 1, etaSec: null } }), null, '尚未發車不推');
  assert.equal(waitMinutes('bus_route_eta', { directions: [] }), null, '沒盯站不知道等多久');
  assert.equal(waitMinutes('metro_live_board', { trains: [{ etaMin: 9 }, { etaMin: 6 }, { etaMin: null }] }), 6);
  assert.equal(waitMinutes('metro_live_board', { trains: [] }), null);
  // 捷運怎麼坐：知道方向，用第一段往這個方向的下一班（不會抓到反方向的車）；台中捷運只有班距不推
  assert.equal(waitMinutes('metro_route', { next: { etaMin: 8, destination: '頂埔' } }), 8);
  assert.equal(waitMinutes('metro_route', { next: { headway: { min: 9, max: 9 } } }), null);
  assert.equal(waitMinutes('metro_route', {}), null);
  assert.equal(waitMinutes('weather_now', {}), null);
});

test('等車推劇：≥ 5 分才推、一輪一次、關掉不推、英文不推、等太久不推、查不到劇不推、逾時不卡住交通', async () => {
  const svc = createServices({ forceMock: true, drama: { links: LINKS } });
  const bus = (sec) => ({ focus: { status: 0, etaSec: sec } });
  const on = () => ({ on: true, done: false });
  assert.equal(await waitDrama(svc, { tool: 'bus_route_eta', data: bus(299), parent: 't1' }, on()), null, '4 分 59 秒不推');
  const st = on();
  const a = await waitDrama(svc, { tool: 'bus_route_eta', data: bus(300), parent: 't1' }, st);
  assert.match(a.text, /^等車還要 5 分，剛好夠看一集短劇：《.+》第 1 集（前 \d+ 集免費）。$/);
  assert.deepEqual([a.parent, a.kind, a.waitMin, a.mode, a.data.appLink], ['t1', 'drama', 5, 'demo', `example-drama://watch/${a.data.id}/1`]);
  assert.equal(st.done, true);
  assert.equal(await waitDrama(svc, { tool: 'bus_route_eta', data: bus(900), parent: 't2' }, st), null, '一輪最多一次');
  assert.equal(await waitDrama(svc, { tool: 'bus_route_eta', data: bus(900), parent: 't1' }, { on: false, done: false }), null, '設定關掉');
  assert.equal(await waitDrama(svc, { tool: 'bus_route_eta', data: bus(900), parent: 't1', lang: 'en' }, on()), null, '英文提問（片庫是中文）');
  assert.equal(await waitDrama(svc, { tool: 'bus_route_eta', data: bus(45 * 60), parent: 't1' }, on()), null, '等 45 分：該換方式，不是看劇');
  const empty = { ...svc, drama: { ...svc.drama, waitPick: async () => null } };
  assert.equal(await waitDrama(empty, { tool: 'bus_route_eta', data: bus(600), parent: 't1' }, on()), null);
  const slow = { ...svc, drama: { ...svc.drama, waitPick: () => new Promise(() => {}) } };
  const t0 = Date.now();
  assert.equal(await waitDrama(slow, { tool: 'metro_live_board', data: { trains: [{ etaMin: 8 }] }, parent: 't1' }, on()), null);
  assert.ok(Date.now() - t0 < 3000, '最多等 1.5 秒');
  // 沒設定連結（示範）：還是提，前端改給「在演什麼」
  const bare = createServices({ forceMock: true });
  const b = await waitDrama(bare, { tool: 'bus_route_eta', data: bus(600), parent: 't1' }, on());
  assert.deepEqual([b.data.appLink, b.data.store], [null, null]);
  assert.equal(WAIT_MIN, 5);
});

test('aside 事件：只收安全連結、kind 只有 drama、文字截斷', () => {
  const e = ev.aside({ parent: 't1', kind: 'drama', text: 'x'.repeat(300), waitMin: 6, mode: 'live', data: { id: 'a', title: 'A', ep: 1, appLink: 'javascript://alert(1)', store: { ios: 'http://x', android: 'https://example.com/a' } }, labels: { watch: '看這集' } });
  assert.deepEqual([e.type, e.text.length, e.data.appLink, e.data.store], ['aside', 120, null, { ios: null, android: 'https://example.com/a' }]);
  assert.equal(ev.aside({ parent: 't1', kind: 'drama', text: 'x', data: { id: 'a', title: 'A', store: { ios: 'http://x', android: null } } }).data.store, null);
  assert.throws(() => ev.aside({ parent: 't1', kind: 'ad', text: 'x', data: {} }), /kind/);
});

/** 示範服務：公車到站時間固定（示範資料隨時間變，測試要可重現） */
function fixedBus(sec, links = LINKS) {
  const svc = createServices({ forceMock: true, drama: { links } });
  const real = svc.bus.routeEta;
  svc.bus = { ...svc.bus, routeEta: async (a) => { const r = await real(a); for (const d of r.directions) for (const s of d.stops) Object.assign(s, { etaSec: sec, status: 0 }); return r; } };
  return svc;
}
const ask = (q, extra = {}) => ({ messages: [{ role: 'user', content: q }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0478, lon: 121.517 } }], ...extra });
async function run(svc, body) { const es = []; await runDemo(svc, body, (e) => es.push(e), { now: Date.parse('2026-11-23T10:00:00+08:00') }); return es; }

test('問阿幫（示範）：等公車 8 分 → 卡片下方推一集短劇（接在那張卡片、不進回答文字）；3 分不推；關掉不推', async () => {
  const es = await run(fixedBus(480), ask('307 公車到「民權二段」還要多久'));
  const a = es.filter((e) => e.type === 'aside');
  assert.equal(a.length, 1);
  const bus = es.find((e) => e.type === 'tool_result' && e.tool === 'bus_route_eta');
  assert.equal(a[0].parent, bus.id);
  assert.ok(es.indexOf(a[0]) > es.indexOf(bus) && es.indexOf(a[0]) < es.findIndex((e) => e.type === 'text'), '在卡片之後、回答之前');
  assert.doesNotMatch(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /短劇|MyDrama/, '交通回答不被短劇搶走');
  assert.equal((await run(fixedBus(180), ask('307 公車到「民權二段」還要多久'))).filter((e) => e.type === 'aside').length, 0);
  assert.equal((await run(fixedBus(480), ask('307 公車到「民權二段」還要多久', { userState: { dramaHint: false } }))).filter((e) => e.type === 'aside').length, 0);
  assert.equal((await run(fixedBus(480), ask('When is bus 307 coming?'))).filter((e) => e.type === 'aside').length, 0, '英文不推');
});

test('問阿幫（示範）：行程選公車時扣掉走到站牌的時間；同一輪兩條公車只推一次；防詐 agent 不推', async () => {
  // 走到站牌約 3 分（示範直達公車）：車 8 分後到 → 在站牌等 5 分 → 推；車 7 分後到 → 等 4 分 → 不推
  const trip = await run(fixedBus(480), ask('我想省錢，從西門町到台北101怎麼去？'));
  const t = trip.filter((e) => e.type === 'aside');
  assert.equal(t.length, 1);
  assert.equal(t[0].parent, trip.filter((e) => e.type === 'tool_result' && e.tool === 'bus_route_eta').at(-1).id);
  assert.equal((await run(fixedBus(420), ask('我想省錢，從西門町到台北101怎麼去？'))).filter((e) => e.type === 'aside').length, 0);
  // 兩條公車平行查：只推一次
  const svc = fixedBus(600);
  const out = [];
  let n = 0;
  await execTools(svc, [{ name: 'bus_route_eta', args: { city: 'Taipei', routeName: '307', stop: '民權二段' } }, { name: 'bus_route_eta', args: { city: 'Taipei', routeName: '299', stop: '敦化活動中心' } }], (e) => out.push(e), { profile: getProfile('life'), nextId: () => `t${++n}`, aside: asideState({}, getProfile('life')) });
  assert.equal(out.filter((e) => e.type === 'aside').length, 1);
  assert.equal(asideState({}, getProfile('antifraud')).on, false, '防詐 agent 沒有短劇工具包');
  assert.equal(asideState({ userState: { dramaHint: false } }, getProfile('life')).on, false);
});

test('找劇意圖（示範規則）：排行、類型、劇名、劇情、沒找到改熱門；不跟行程、戲劇院搶', async () => {
  const P = (s) => parseIntent(s);
  assert.deepEqual([P('最近有什麼好看的短劇').intent, P('最近有什麼好看的短劇').dramaList], ['drama', 'hot']);
  assert.deepEqual([P('推薦一部短劇').intent, P('推薦一部短劇').dramaList], ['drama', 'hot']);
  assert.equal(P('有沒有甜寵劇').dramaQuery, '甜寵');
  assert.equal(P('有沒有好笑的搞笑短劇').dramaQuery, '喜劇');
  assert.equal(P('有什麼新的短劇').dramaList, 'new');
  assert.equal(P('有沒有完結的短劇可以一次追完').dramaList, 'completed');
  assert.equal(P('台灣自製的短劇').dramaList, 'taiwan');
  assert.deepEqual([P('《捷運末班車》在演什麼').intent, P('《捷運末班車》在演什麼').dramaQuery, P('《捷運末班車》在演什麼').dramaDetail], ['drama', '捷運末班車', true]);
  assert.equal(P('有沒有殭屍的短劇').dramaQuery, '殭屍');
  assert.equal(P('Any good short dramas?').intent, 'drama');
  assert.equal(P('Recommend a romance drama').dramaQuery, '甜寵');
  assert.notEqual(P('去國家戲劇院怎麼走').intent, 'drama');
  for (const s of ['我要去看舞台劇，坐捷運要多久', '明天去看京劇會下雨嗎', '到國家戲劇院看歌劇要搭什麼車', '去新北市藝文中心看兒童劇', '週末想看音樂劇', '帶小孩看布袋戲', '去台北101的路上想看短劇', 'How do I get to the National Theater to see a drama', 'Is there a drama at the theater tonight']) assert.notEqual(P(s).intent, 'drama', s);
  assert.equal(P('等車無聊，推薦短劇').dramaList, 'hot', '「等車」不算問交通');
  assert.equal(P('《捷運末班車》在演什麼').intent, 'drama', '劇名裡的「捷運」不算問交通');
  assert.notEqual(P('307 到哪了？').intent, 'drama');
  assert.notEqual(P('今天會下雨嗎').intent, 'drama');
  const es = await run(createServices({ forceMock: true }), ask('有沒有殭屍的短劇'));
  assert.deepEqual(es.filter((e) => e.type === 'tool_start').map((e) => e.name), ['drama_search', 'drama_picks']);
  assert.match(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /沒有找到「殭屍」的短劇，先給你看熱門的/);
  const noLink = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  assert.doesNotMatch(noLink, /在 MyDrama 看/, '沒設定連結時不叫使用者按不存在的按鈕');
});

test('運動建議提示（只做句子與連結，接線留給運動建議）：天氣好又動得少才說；連結不合格不給按鈕', () => {
  assert.equal(exerciseNudge({ weatherOk: true, movedLittle: false }), null);
  assert.equal(exerciseNudge({ weatherOk: false, movedLittle: true }), null);
  const z = exerciseNudge({ weatherOk: true, movedLittle: true, link: 'example-drama://unlock' });
  assert.match(z.text, /活動頁/);
  assert.deepEqual([z.cta, z.link], ['看 MyDrama 活動頁', 'example-drama://unlock']);
  const bad = exerciseNudge({ weatherOk: true, movedLittle: true, link: 'javascript://x' });
  assert.deepEqual([bad.cta, bad.link], [null, null]);
  assert.match(exerciseNudge({ weatherOk: true, movedLittle: true, lang: 'en' }).text, /^Nice weather/);
  assert.equal(waitHint({ waitMin: 6, pick: null }), null);
  assert.match(waitHint({ waitMin: 6.7, pick: { title: 'A', ep: 1 }, lang: 'en' }).text, /^7 min until it comes/);
});

test('開 App：先開 App 連結，畫面沒離開才開商店頁；不安全的連結不開', async () => {
  const { openApp, storePage } = await import('../public/ui/cards/host-web.js');
  const fake = () => {
    const opened = [], timers = [], handlers = {};
    const win = { location: { href: '' }, open: (u) => opened.push(u), setTimeout: (fn) => timers.push(fn), addEventListener: (k, f) => { handlers[k] = f; }, removeEventListener: () => {} };
    const doc = { visibilityState: 'visible', addEventListener: (k, f) => { handlers[k] = f; }, removeEventListener: () => {} };
    return { win, doc, opened, timers, handlers };
  };
  const store = { ios: 'https://example.com/ios', android: 'https://example.com/android' };
  const a = fake();
  assert.equal(openApp({ app: 'example-drama://watch/a/1', store }, { win: a.win, doc: a.doc }), 'app');
  assert.equal(a.win.location.href, 'example-drama://watch/a/1');
  a.timers[0]();
  assert.deepEqual(a.opened, ['https://example.com/android'], '沒裝 App：開商店頁');
  const b = fake();
  openApp({ app: 'example-drama://watch/a/1', store }, { win: b.win, doc: b.doc });
  b.doc.visibilityState = 'hidden'; b.handlers.visibilitychange();
  b.timers[0]();
  assert.deepEqual(b.opened, [], '開了 App（畫面離開）就不開商店頁');
  const c = fake();
  assert.equal(openApp({ app: 'javascript://alert(1)', store }, { win: c.win, doc: c.doc }), 'store');
  assert.deepEqual([c.win.location.href, c.opened], ['', ['https://example.com/android']]);
  const d = fake();
  assert.equal(openApp({ app: null, store: { ios: 'http://x', android: null } }, { win: d.win, doc: d.doc }), null);
  const e = fake(); e.win.open = () => null; // 彈出視窗被擋：在這一頁開商店頁
  openApp({ app: 'example-drama://watch/a/1', store }, { win: e.win, doc: e.doc }); e.timers[0]();
  assert.equal(e.win.location.href, 'https://example.com/android');
  assert.equal(storePage(store, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'https://example.com/ios');
  assert.equal(storePage({ ios: 'https://example.com/ios', android: null }, 'Android'), 'https://example.com/ios');
});

test('公開 repo：沒有 MyDrama 的網址、網域、深層連結格式、合作方名稱、內部文件或規格複製', () => {
  const root = new URL('..', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n')
    .filter((f) => f && !/^(?:node_modules|dist|test\/screenshots)\//.test(f) && !/\.(?:png|webp|jpg|ico|jar|keystore|mp4|woff2?)$/i.test(f)); // private/ 也掃
  // 樣式用字串拼起來（本檔不會比對到自己）
  const D = ['my', 'drama'].join('');
  const BAD = [
    new RegExp(`${D}:\\/\\/`, 'i'), // App 的自訂 scheme
    new RegExp(`https?:\\/\\/[^\\s'"\`)]*${D}`, 'i'), // 含 mydrama 的網址（API、CDN、商店頁、網站）
    new RegExp(`\\.${D}\\b`, 'i'), // 子網域（某主機點上片庫名稱）
    new RegExp(`\\b${D}\\.(?:com|tw|net|io|app|co|org|dev|cloud|link)\\b`, 'i'), // 不帶協定的網域
    new RegExp(`tw\\.${D}`, 'i'), // App 套件名稱
    new RegExp(['openapi', 'api', 'app'].join('-'), 'i'), // 規格檔名
    new RegExp(`${D}-workpack|bitbucket\\.org`, 'i'), // 內部 repo
    new RegExp(`\\b${D.toUpperCase()}-\\d+\\b`), // Jira 卡號
    new RegExp(['localhost', '8081'].join(':')), // 本機 API 埠號
  ];
  // 合作方公司的英文名稱與內部網域只以雜湊比對，不寫進 repo（中文公司名在防詐情境、規劃文件裡本來就會出現，不算）
  const SECRET = new Set(['b3c4733ebff6cb92b5bd69a6e132d6b98023f8c4551e80961eeeb5e3d949d895']);
  const sha = (x) => createHash('sha256').update(x).digest('hex');
  const secretIn = (text) => {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    for (let i = 0; i < words.length; i++) if (words[i].length >= 6 && (SECRET.has(sha(words[i])) || (i + 1 < words.length && SECRET.has(sha(words[i] + words[i + 1]))))) return true;
    return false;
  };
  const hits = [];
  for (const f of files) {
    let s;
    try { s = readFileSync(new URL(f, root), 'utf8'); } catch { continue; } // 已刪除、目錄（symlink）
    for (const re of BAD) if (re.test(s)) hits.push(`${f}：${re}`);
    if (secretIn(s)) hits.push(`${f}：合作方名稱`);
  }
  assert.ok(files.length > 100, '有讀到 repo 的檔案');
  assert.ok(files.some((f) => f.startsWith('private/')) || !execFileSync('git', ['ls-files', 'private'], { cwd: root, encoding: 'utf8' }).trim(), 'private/ 也有掃');
  const rev = (x) => [...x].reverse().join(''); // 測試用的名稱倒過來寫，本檔不會比對到自己
  assert.ok(secretIn(`${rev('nawiaT')} ${rev('eliboM')}`) && secretIn(`corp.${rev('eliBOMnawiat')}.com`), '雜湊比對有效（英文名稱、網域）');
  assert.deepEqual(hits, []);
});
