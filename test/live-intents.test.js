// 真實資料健檢（2026-11-22）：意圖判斷與工具參數的修正（judge 組合、公車跨縣市、捷運系統、國道路況、末班車、詐騙簡訊、地名裡的火車站）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJudge, UNSURE_FLOOR } from '../core/agent/judge.js';
import { parseIntent, localStations, hasShortStation, modeOf, looksScamPaste, isTrafficAsk, metroSystemOf } from '../core/agent/demo-intent.js';
import { slotAsk, resolvePending } from '../core/agent/ask.js';
import { scamPasteAsk } from '../core/agent/clarify.js';
import { dropStrayOffers } from '../core/agent/model-loop.js';
import { runDemo } from '../core/agent/run.js';
import { callTool } from '../core/tools/index.js';
import { neighborCity } from '../core/tools/transit.js';
import { systemOfStation } from '../core/tools/metro.js';
import { lastFromTimetable } from '../core/services/metro.js';
import { createServices } from '../core/index.js';
import { UserError } from '../core/util.js';

const fake = (out) => async () => out;
const SCAM = '【中華郵政】您的包裹地址不全無法投遞，請於24小時內點擊 http://post-tw.cc/x 更新資料';

test('S3 判斷層：沒有模型、嵌入沒把握時，規則的明確意圖優先；規則聽不懂、嵌入又太沒把握就是 unknown', async () => {
  const j = (a) => createJudge({ embed: fake({ ...a, states: [] }) });
  for (const [text, a, want] of [
    ['從板橋到台北車站', { intent: 'rail', confidence: 0.57 }, 'trip'],
    ['高雄車站到駁二', { intent: 'rail', confidence: 0.59 }, 'trip'],
    ['從桃園火車站到台北101', { intent: 'rail', confidence: 0.45 }, 'trip'],
    ['國道塞車嗎 台北到新竹', { intent: 'rail', confidence: 0.74 }, 'traffic'],
    ['我在等939', { intent: 'unknown', confidence: 0.27 }, 'bus_route'],
    [SCAM, { intent: 'bus_route', confidence: 0.42 }, 'scam'], // 規則是防詐（2026-11-25 起判斷層有 scam 這個意圖）：照規則，不亂選
  ]) {
    const r = await j(a)(text);
    assert.equal(r.intent, want, text);
  }
  assert.equal((await j({ intent: 'weather', confidence: 0.62 })('嗯嗯哼哼')).intent, 'weather', '規則聽不懂、嵌入 ≥ 0.5：用嵌入');
  assert.equal((await j({ intent: 'weather', confidence: UNSURE_FLOOR - 0.01 })('嗯嗯哼哼')).intent, 'unknown');
  assert.equal((await j({ intent: 'rail', confidence: 0.92 })('從板橋到台北車站')).source, 'embed', '嵌入有把握照舊用嵌入');
  const withLlm = await createJudge({ embed: fake({ intent: 'rail', confidence: 0.5, states: [] }), llm: fake({ intent: 'metro', states: [] }) })('從板橋到台北車站');
  assert.equal(withLlm.intent, 'metro', '有模型時照舊問模型');
  assert.equal((await j({ intent: 'rail', confidence: 0.57 })('從板橋到台北車站')).source, 'rules');
});

test('S3 判斷層指定意圖抽參數：沒有高鐵台鐵字眼、迄站不是車站、有起訖的捷運句子都交回規則', () => {
  assert.equal(parseIntent('從板橋到台北車站', { intent: 'rail' }), null);
  assert.equal(parseIntent('高雄車站到駁二', { intent: 'rail' }), null);
  assert.equal(parseIntent('台鐵高雄到駁二', { intent: 'rail' }), null, '駁二不是車站');
  assert.equal(parseIntent('從板橋坐捷運到台北車站', { intent: 'metro' }), null);
  assert.equal(parseIntent(SCAM, { intent: 'bus_route' }), null, '「24小時內」不是公車 24');
  assert.equal(parseIntent('高鐵台北到台中', { intent: 'rail' }).to, '台中');
  const t = parseIntent('到台北101，從西門町出發', { intent: 'trip' });
  assert.deepEqual([t.from, t.to], ['西門町', '台北101'], '判斷層說行程：起訖照「從／到」排');
});

test('S10 地名裡的「火車站」「高鐵站」不是交通方式；「坐火車」才是', () => {
  assert.equal(modeOf('從桃園火車站去台北101'), null);
  assert.equal(modeOf('從高鐵桃園站去台北101'), null);
  assert.equal(modeOf('坐火車去桃園火車站'), 'tra');
  const it = parseIntent('從桃園火車站到台北101');
  assert.deepEqual([it.intent, it.from, it.to, it.mode], ['trip', '桃園車站', '台北101', undefined]);
});

test('S5／S6 捷運：系統照句子說的、站名不預設台北；有起訖的是行程', () => {
  assert.equal(metroSystemOf('高雄捷運美麗島站下一班'), 'KRTC');
  assert.equal(metroSystemOf('機捷下一班'), 'TYMC');
  assert.equal(metroSystemOf('中捷市政府站'), 'TMRT');
  for (const [text, st, sys] of [['高雄捷運美麗島站下一班', '美麗島', 'KRTC'], ['高雄捷運美麗島下一班', '美麗島', 'KRTC'], ['高雄捷運巨蛋下一班', '巨蛋', 'KRTC'], ['台中捷運市政府站下一班', '市政府', 'TMRT'], ['中山站下一班', '中山', undefined]]) {
    const it = parseIntent(text);
    assert.deepEqual([it.intent, it.station, it.system], ['metro', st, sys], text);
  }
  const k = parseIntent('高雄捷運下一班');
  assert.deepEqual([k.intent, k.station, k.system], ['metro', null, 'KRTC']);
  const tpe = parseIntent('台北車站捷運下一班');
  assert.deepEqual([tpe.station, tpe.near], [null, '臺北車站']);
  const od = parseIntent('從板橋坐捷運到台北車站');
  assert.deepEqual([od.intent, od.from, od.to, od.mode], ['trip', '板橋車站', '臺北車站', 'metro']);
});

test('S5 metro_live_board：只給站名時在各系統找（美麗島＝高雄捷運）；同名站有位置看近的；都找不到照實說', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_live_board', { station: '美麗島' });
  assert.equal(r.data.system, 'KRTC');
  await assert.rejects(callTool(svc, 'metro_live_board', { system: 'TRTC', station: '美麗島' }), /台北捷運找不到/);
  assert.equal(await systemOfStation(svc, '市政府'), 'TRTC', '同名：台北優先');
  assert.equal(await systemOfStation(svc, '市政府', { lat: 24.16, lon: 120.65 }), 'TMRT', '人在台中：台中捷運');
  await assert.rejects(systemOfStation(svc, '不存在站'), (e) => e instanceof UserError && /都找不到/.test(e.message));
  const last = await callTool(svc, 'metro_live_board', { station: '美麗島', last: true });
  assert.ok(last.data.lastTrains.length >= 2 && last.data.lastTrains.every((x) => /^\d\d:\d\d$/.test(x.time)));
  assert.match(last.speak, /末班車/);
});

test('末班車：時刻表取今天各方向最後一班（凌晨看前一天的營運日）', () => {
  const all = [true, true, true, true, true, true, true];
  const table = [{ lineId: 'BL', direction: 0, dest: '南港展覽館', days: all, times: ['06:00', '23:40', '00:12'] }, { lineId: 'BL', direction: 1, dest: '頂埔', days: all, times: ['06:02', '23:55'] }];
  const noon = Date.parse('2026-11-23T12:00:00+08:00');
  assert.deepEqual(lastFromTimetable(table, noon).map((x) => [x.destination, x.time]), [['頂埔', '23:55'], ['南港展覽館', '00:12']]);
  assert.equal(lastFromTimetable(table, Date.parse('2026-11-24T00:30:00+08:00')).length, 2, '凌晨：前一天的營運日');
});

test('S4 公車：所在縣市找不到這條路線時，用預熱的路線清單看相鄰縣市（不多打 TDX）', async () => {
  const calls = [];
  const bus = {
    routeCities: async (name) => (name === '307' ? ['Taipei'] : []),
    routeEta: async ({ city, routeName }) => {
      calls.push(city);
      if (city !== 'Taipei') throw new UserError(`新北市找不到路線「${routeName}」`);
      return { city, routeName, updatedAt: 'x', directions: [{ direction: 0, label: '往 板橋', stops: [{ seq: 1, stopName: '板橋站', lat: 25.0141, lon: 121.4637, etaSec: 300, status: 0, statusText: '約 5 分' }] }] };
    },
  };
  const svc = { ...createServices({ forceMock: true }), bus };
  const r = await callTool(svc, 'bus_route_eta', { routeName: '307', near: { lat: 25.014, lon: 121.4637 } });
  assert.deepEqual(calls, ['NewTaipei', 'Taipei']);
  assert.equal(r.data.city, 'Taipei');
  assert.match(r.speak, /新北市沒有 307，這是臺北市的 307/);
  await assert.rejects(callTool(svc, 'bus_route_eta', { routeName: '9999', city: 'NewTaipei' }), /找不到路線/, '相鄰縣市也沒有：照原本的錯誤');
  assert.equal(await neighborCity({ bus: {} }, 'NewTaipei', '307'), null, '沒有路線清單：不猜');
  assert.equal(await neighborCity(svc, 'Taoyuan', '307'), 'Taipei');
  assert.deepEqual(await createServices({ forceMock: true }).bus.routeCities('藍15'), ['NewTaipei'], '示範資料也有同樣的介面');
});

test('S7 國道路況：有起訖查 traffic_status；只說國道幾號先問從哪到哪；工具拒絕同一個點', async () => {
  assert.ok(isTrafficAsk('國道一號現在塞車嗎') && isTrafficAsk('國道塞車嗎 台北到新竹'));
  assert.ok(!isTrafficAsk('台北到台中國道客運') && !isTrafficAsk('我怕塞車，從西門町去101'));
  const a = parseIntent('國道塞車嗎 台北到新竹');
  assert.deepEqual([a.intent, a.from, a.to], ['traffic', '臺北車站', '新竹車站']);
  const b = parseIntent('國道一號現在塞車嗎');
  assert.deepEqual([b.intent, b.needs, b.freeway], ['traffic', 'od', '國道一號']);
  const ask = slotAsk(b);
  assert.equal(ask.ask.about, 'slot:od');
  assert.match(ask.ask.question, /從哪裡到哪裡/);
  assert.ok(!/\d/.test(ask.ask.question));
  assert.equal(resolvePending({ slot: 'od' }, '台北到新竹'), '台北到新竹國道塞車嗎？');
  assert.equal(resolvePending({ slot: 'od' }, '新竹'), null, '只有一個地名：不當答案');
  assert.equal(parseIntent(resolvePending({ slot: 'od' }, '從桃園到台中')).intent, 'traffic');
  const svc = createServices({ forceMock: true });
  await assert.rejects(callTool(svc, 'traffic_status', { from: { lat: 25.0478, lon: 121.517 }, to: { lat: 25.0478, lon: 121.517 } }), (e) => e instanceof UserError && /從哪裡到哪裡|同一個地方/.test(e.message));
});

test('S7 示範行程：起訖不到 1 公里不查國道（不讓工具說起訖太近）', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從台北車站去北門' }] }, (e) => es.push(e));
  const tools = es.filter((e) => e.type === 'tool_start').map((e) => e.name);
  assert.ok(tools.includes('plan_trip') && !tools.includes('traffic_status'), tools.join());
  assert.ok(!es.some((e) => e.type === 'tool_result' && !e.ok));
});

test('S8 在等某一路公車；末班車：有路線就查、沒路線就問', () => {
  for (const t of ['我在等939', '等 939', '等 939 公車', '我還在等307']) assert.equal(parseIntent(t).route, t.match(/\d+/)[0], t);
  for (const t of ['等20分鐘了', '等 3 個人', '等一下']) assert.notEqual(parseIntent(t).intent, 'bus_route', t);
  const l = parseIntent('307 末班車幾點');
  assert.deepEqual([l.intent, l.route, l.last], ['bus_route', '307', true]);
  const n = parseIntent('末班車幾點');
  assert.deepEqual([n.intent, n.needs, n.last], ['bus_route', 'route', true]);
  const a = slotAsk(n);
  assert.match(a.ask.question, /末班車/);
  assert.ok(a.ask.options.some((o) => o.say === '捷運末班車幾點？'));
  assert.equal(resolvePending(a.ask.pending, '307'), '307 公車末班車幾點？');
  assert.equal(parseIntent('307 公車末班車幾點？').last, true);
  const m = parseIntent('捷運末班車幾點');
  assert.deepEqual([m.intent, m.station, m.last], ['metro', null, true]);
  assert.equal(parseIntent('末班車幾點', { history: [{ role: 'user', content: '307 到哪了' }, { role: 'assistant', content: '好' }] }).route, '307', '接著上一輪的公車');
  assert.equal(parseIntent('最後一班垃圾車幾點').intent, 'garbage', '別的生活服務不搶');
});

test('貼上的詐騙樣式簡訊：轉防詐（帶著這一句），不拿裡面的數字查公車', async () => {
  assert.ok(looksScamPaste(SCAM));
  assert.ok(!looksScamPaste('307 還要多久'));
  assert.ok(!looksScamPaste('看一下 https://abang.tw 的說明'), '沒有催促、沒有要你做事');
  const it = parseIntent(SCAM);
  assert.deepEqual([it.intent, it.pasted], ['scamAsk', true]);
  const ask = scamPasteAsk('life', null, SCAM, { pasted: true });
  assert.equal(ask.options[0].action.name, 'handOff');
  assert.equal(ask.options[0].action.text, SCAM);
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: SCAM }] }, (e) => es.push(e));
  assert.ok(!es.some((e) => e.type === 'tool_start'));
  assert.equal(es.find((e) => e.type === 'ask').options[0].action.name, 'handOff');
  assert.match(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /詐騙/);
});

test('「桃園」人在桃園市區＝桃園車站；在台北照舊；說了全名不改；要定位才知道', () => {
  const it = parseIntent('桃園到台北101');
  assert.equal(it.from, '高鐵桃園站');
  assert.ok(hasShortStation(it, '桃園到台北101'));
  localStations(it, '桃園到台北101', { lat: 24.993, lon: 121.301 });
  assert.equal(it.from, '桃園車站');
  const far = parseIntent('桃園到台北101');
  localStations(far, '桃園到台北101', { lat: 25.0478, lon: 121.517 });
  assert.equal(far.from, '高鐵桃園站', '人不在桃園：不改');
  const full = parseIntent('高鐵桃園站到台北101');
  assert.ok(!hasShortStation(full, '高鐵桃園站到台北101'));
  localStations(full, '高鐵桃園站到台北101', { lat: 24.993, lon: 121.301 });
  assert.equal(full.from, '高鐵桃園站');
});

test('地端模型亂加的「要幫你叫車嗎」「要幫你訂票嗎」：不相關就拿掉', () => {
  assert.equal(dropStrayOffers('最近有車的是臺中車站，還有 35 台。要幫你叫車嗎？', null, { intent: 'youbike' }), '最近有車的是臺中車站，還有 35 台。');
  assert.equal(dropStrayOffers('下一班 14:08 出發。要幫你訂票嗎？', null, { intent: 'rail' }), '下一班 14:08 出發。');
  assert.equal(dropStrayOffers('下一班 14:08 出發。要幫你訂票嗎？', null, { intent: 'rail', book: true }), '下一班 14:08 出發。要幫你訂票嗎？', '使用者要訂票');
  const trip = { best: 'r', options: [{ id: 'r', role: 'ridehail' }] };
  assert.match(dropStrayOffers('建議叫車。需要我幫你叫車嗎？', trip, { intent: 'trip' }), /叫車嗎/, '建議就是叫車');
  assert.equal(dropStrayOffers('要幫你叫車嗎？', null, { intent: 'youbike' }), '要幫你叫車嗎？', '整段都是追問：不動');
});

test('m01／n02 總結：捷運兩個方向都說；附近站牌列出路線', async () => {
  const say = async (content) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content }] }, (e) => es.push(e)); return es.filter((e) => e.type === 'text').map((e) => e.delta).join(''); };
  assert.match(await say('台北車站捷運下一班'), /其他方向：往/);
  assert.match(await say('附近的公車站有哪些車'), /」有 \S+/);
});

// ───── PR #127 獨立審查（3959 句對照）後的修正 ─────
const runOne = async (content, extra = {}) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content }], ...extra }, (e) => es.push(e)); return es; };
const textOf = (es) => es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
const used = (es, name) => es.some((e) => e.type === 'tool_start' && e.name === name);

test('審查必修 1：路況不搶公車與行程；手機的判斷可以更正規則的路況', async () => {
  for (const t of ['307 公車路況', '307 路況']) assert.deepEqual([parseIntent(t).intent, parseIntent(t).route], ['bus_route', '307'], t);
  const tr = parseIntent('從板橋去台北車站坐公車會不會塞車');
  assert.deepEqual([tr.intent, tr.from, tr.to, tr.mode, tr.roadAsk], ['trip', '板橋車站', '臺北車站', 'bus', true]);
  assert.equal(parseIntent('國3路況').intent, 'traffic', '國道 3 號不是公車 3');
  assert.equal(parseIntent('從台北去台中開車會塞嗎').intent, 'traffic', '開車還是問路況');
  assert.ok(used(await runOne('從台北去台中開車會塞嗎', { deviceJudge: { intent: 'trip', states: [], engine: 'gemini-nano' } }), 'plan_trip'), '手機說是行程：照行程');
  assert.ok(used(await runOne('從台北去台中開車會塞嗎', { deviceJudge: { intent: 'unknown', states: [], engine: 'gemini-nano' } }), 'traffic_status'), '手機說聽不懂不算更正');
  const bus = await runOne('從板橋去台北車站坐公車會不會塞車');
  assert.ok(used(bus, 'plan_trip'));
  assert.match(textOf(bus), /市區道路塞不塞.*查不到/);
});

test('審查必修 2：帶網址的一般問題不送防詐；官方網域、有起訖、問怎麼去、提到地名都不算', async () => {
  for (const t of ['LINE 群組說 https://forms.gle/x 今天內填寫，從板橋到西門町', '明天去高雄，車票連結 https://www.thsrc.com.tw 盡快訂', '我要立即繳費 www.etax.nat.gov.tw 怎麼去國稅局', '請立即點擊 https://www.railway.gov.tw 登入補繳']) {
    assert.ok(!looksScamPaste(t), t);
    assert.notEqual(parseIntent(t).intent, 'scamAsk', t);
  }
  assert.equal(parseIntent('LINE 群組說 https://forms.gle/x 今天內填寫，從板橋到西門町').intent, 'trip');
  assert.ok(looksScamPaste('【台電】電費逾期未繳，今日內未處理將停電，請點擊 https://eincioiice-tw-nat-gov.com/pay'));
  assert.ok(!looksScamPaste('請於24小時內點擊 http://x.cc/a'), '沒有金錢或冒名特徵');
  const kept = await runOne(SCAM, { deviceJudge: { intent: 'unknown', states: [], engine: 'apple' } });
  assert.equal(kept.find((e) => e.type === 'ask')?.options[0].action.name, 'handOff', '手機說聽不懂：照規則帶到防詐');
  const fixed = await runOne(SCAM, { deviceJudge: { intent: 'weather', states: [], engine: 'apple' } });
  assert.ok(!fixed.some((e) => e.type === 'ask' && e.about === 'scam:paste') || used(fixed, 'weather_now'), '手機判斷別的意圖：可以更正');
});

test('審查建議：發票號碼、單句油價、改去、捷運誤點、國道有車禍、等 N 號、市區路況、YouBike 末班、判斷層的接著問', async () => {
  assert.deepEqual([parseIntent('12345678 有中嗎').intent, parseIntent('12345678 有中嗎').number], ['invoice', '12345678']);
  assert.deepEqual([parseIntent('那95呢').intent, parseIntent('那95呢').grade], ['fuel', '95']);
  assert.equal(parseIntent('那 95 呢', { history: [{ role: 'user', content: '307 到哪了' }, { role: 'assistant', content: '好' }] }).intent, 'bus_route', '前一句問公車：還是公車');
  assert.equal(parseIntent('改去松山機常').to, '臺北松山機場');
  assert.deepEqual([parseIntent('文湖線現在有沒有誤點').intent, parseIntent('文湖線現在有沒有誤點').line], ['metro', '文湖線']);
  for (const t of ['國道有車禍嗎', '國道一號']) { // 判斷層有把握說路況、句子提到國道：問起訖
    const r = parseIntent(t, { intent: 'traffic' });
    assert.deepEqual([r.intent, r.needs], ['traffic', 'od'], t);
  }
  assert.equal(parseIntent('國道客運幾點', { intent: 'traffic' }), null);
  for (const t of ['我等3號發薪再去台北101', '等 5 號再說', '我在等2號窗口']) assert.notEqual(parseIntent(t).intent, 'bus_route', t);
  for (const t of ['我在台北車站等307', '在公車站等307']) assert.equal(parseIntent(t).route, '307', t);
  for (const t of ['信義區車多不多', '台北市區路況如何', '淡水的路況']) {
    const r = parseIntent(t);
    assert.deepEqual([r.intent, r.cityOnly, r.needs], ['traffic', true, undefined], t);
  }
  const city = await runOne('信義區車多不多', { clientTools: ['device_location'] });
  assert.ok(!city.some((e) => ['ask', 'client_tool_call', 'tool_start'].includes(e.type)), '不問、不定位、不亂查');
  assert.match(textOf(city), /只有國道/);
  assert.notEqual(parseIntent('YouBike 最後一班').intent, 'bus_route');
  assert.deepEqual([parseIntent('坐火車去桃園').to, parseIntent('坐高鐵去桃園').to], ['桃園車站', '高鐵桃園站'], '指定系統：用那個系統的站');
  const j = createJudge({ embed: fake({ intent: 'trip', confidence: 0.99, states: [] }) }); // 接著上一輪只有改行程才標 trip
  assert.equal((await j('那 262 呢', ['307 到哪了'])).intent, 'bus_route');
  assert.equal((await j('改坐公車', ['從西門町去台北101'])).intent, 'trip');
});

test('審查建議 9：英文的國道路況與起訖回答用英文句', () => {
  const r = parseIntent('Is the freeway jammed from Taipei to Hsinchu?');
  assert.deepEqual([r.intent, r.from, r.to, r.lang], ['traffic', '臺北車站', '新竹車站', 'en']);
  const n = parseIntent('Is the freeway jammed?');
  assert.deepEqual([n.intent, n.needs], ['traffic', 'od']);
  assert.match(slotAsk(n).ask.question, /From where to where/);
  const say = resolvePending({ slot: 'od', lang: 'en' }, 'Taipei to Hsinchu');
  assert.match(say, /^Is the freeway jammed from .+ to .+\?$/);
  assert.equal(parseIntent(say).intent, 'traffic');
});
