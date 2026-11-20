// 模型模式的一輪對話（M5-05，AGENT.md §4、ADR-0012）：Claude 與地端模型共用。
// 模型在呼叫工具前的文字 → agent_note；沒有工具呼叫的那輪文字 → text；工具一律走 execTools（與示範模式相同的事件）。
import { describeTool, getTool } from '../tools/index.js';
import { getProfile } from '../agents/index.js';
import { buildSystemPrompt } from './prompt.js';
import { ev } from './events.js';
import { validateRequest, judgeCalls, execTools, deviceLocation, guardedText, judgeInfo, LOCATION_CALL_ID, MAX_TOOL_ROUNDS } from './run.js';
import { judgeNote, moreStatesNote } from './impact.js';
import { parseIntent, needsLocation } from './demo-intent.js';

/**
 * @typedef {{ name: string, description: string, schema: object }} ToolDef
 * @typedef {{ id: string, name: string, input: object, bad?: string }} ModelCall bad：參數不是有效 JSON（原字串）
 * @typedef {{ text: string, calls: ModelCall[], stop: 'end'|'tool'|'max_tokens'|'refusal'|'other', usage: { input: number, output: number } }} ModelTurn
 * @typedef {{ id: string, content: string, isError?: boolean }} ToolResultMsg
 * @typedef {{ mode: 'claude'|'local', model: string,
 *   start(o: { system: string, tools: ToolDef[], messages: Array<{ role: string, content: string }> }):
 *     { next(): Promise<ModelTurn>, addResults(turn: ModelTurn, results: ToolResultMsg[]): void } }} Provider
 */

/** 裝置端工具（ADR-0008）：客戶端支援時才提供給模型 */
export const DEVICE_LOCATION_TOOL = {
  name: 'device_location',
  description: '取得使用者裝置目前的位置（緯度、經度）。只在需要使用者所在位置、而使用者沒說起點或所在地時使用。',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

export const FALLBACK = {
  rounds: '我查了好幾輪資料，結果都在上面的卡片；想再縮小範圍可以換個問法。',
  truncated: '回答太長被截斷了，換個簡短一點的問法試試看。',
  refusal: '這個問題我沒辦法協助；我可以幫你查公車、捷運、台鐵、高鐵、YouBike，或規劃從 A 到 B 怎麼去。',
  empty: '查好了，結果在上面的卡片。',
  noLocation: '使用者沒有提供位置。請改問使用者從哪裡出發（或人在哪裡），不要猜。',
  sameFromTo: '起點和目的地是同一個地方。使用者沒說從哪出發、也沒提供定位：請問他從哪裡出發，不要把目的地當起點。',
};

/** 有卡片的工具，回給模型的清單最多幾筆（完整結果已在卡片上） */
export const MODEL_LIST_MAX = 6;
const NEARBY_TOOL = { weather: 'weather_now', aqi: 'aqi_nearby', youbike: 'youbike_nearby', nearby_bus: 'bus_nearby_stations', garbage: 'garbage_truck_nearby' };
/** 捷運沒說站：用現在位置找最近的站（metro_live_board 的 near） */
const METRO_NEAR = 'metro_live_board';
/** 有現在位置時由程式先查的工具（見 runModel） */
export function prefetchCalls(it, j, here) {
  const at = { lat: here.lat, lon: here.lon };
  if (it.intent === 'trip' && !it.from && it.to) {
    const prefs = { ...(it.arriveBy && { arriveBy: it.arriveBy }), ...(it.mode && { mode: it.mode }), ...(it.states?.length && { states: it.states }) };
    return [{ name: 'plan_trip', args: { from: { ...at, name: here.name }, to: it.to, ...(Object.keys(prefs).length && { prefs }) } }];
  }
  if (it.intent === 'metro' && !it.station) return [{ name: METRO_NEAR, args: { near: { ...at, name: here.name } } }];
  if (it.places?.length) return [];
  const intent = NEARBY_TOOL[it.intent] ? it.intent : NEARBY_TOOL[j?.intent] ? j.intent : null;
  return intent ? [{ name: NEARBY_TOOL[intent], args: at }] : [];
}

/**
 * 預先查詢的比對鍵：plan_trip 看目的地（去空白）、交通方式、抵達時間（起點一律是現在位置、狀態由判斷層定）；
 * 附近類工具看座標（約 100 公尺內算同一處；模型沒給座標＝現在位置）。其他工具不沿用。
 */
export function callKey(name, args = {}, here = null) {
  if (name === 'plan_trip') {
    const to = typeof args.to === 'string' ? args.to.replace(/\s/g, '') : args.to ? `${(+args.to.lat).toFixed(3)},${(+args.to.lon).toFixed(3)}` : '';
    return `plan_trip|${to}|${args.prefs?.mode || ''}|${args.prefs?.arriveBy || ''}`;
  }
  if (name === METRO_NEAR) { // 沒給站名＝最近的站（看 near，沒給 near＝現在位置）；有站名不沿用
    if (args.station) return null;
    const p = args.near && typeof args.near === 'object' ? args.near : here;
    return p ? `${name}|${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}` : null;
  }
  if (Object.values(NEARBY_TOOL).includes(name)) {
    const lat = args.lat ?? here?.lat, lon = args.lon ?? here?.lon;
    return lat == null ? null : `${name}|${(+lat).toFixed(3)},${(+lon).toFixed(3)}`;
  }
  return null;
}

/**
 * 模型給的 plan_trip prefs → 只留使用者說過的抵達時間與交通方式（規則從這句或前文抽到的；判斷層的 mode）。
 * 狀態另由判斷層決定（execTools 的 judgedStates），這裡不動。
 */
export function groundedPrefs(prefs = {}, it = {}, j = null) {
  const { arriveBy: _arriveBy, mode: _mode, ...rest } = prefs;
  const said = { arriveBy: it.arriveBy || null, mode: it.mode || j?.mode || null };
  return { ...rest, ...(said.arriveBy && { arriveBy: said.arriveBy }), ...(said.mode && { mode: said.mode }) };
}

/** 兩個地點參數是不是同一個字串（「台北101」與「台北 101」視為相同） */
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/\s/g, '') === b.replace(/\s/g, '');

/** 選公車後自動盯的到站結果，接在 plan_trip 結果後面給模型（卡片已顯示；請模型主動問要不要到站提醒） */
export const followUpText = (f, walkMin) => (f ? `\n［內部備註，不要照抄這段文字］上車站即時到站已查好：${f.speak}${walkMin != null ? `從起點走到這個上車站約 ${walkMin} 分（不是全程步行時間）。` : ''}已用公車卡片即時顯示；回答時用自己的話說公車多久到上車站；若走到站牌的時間比車到還久，說這班可能趕不上；並問使用者要不要在卡片上按「到站前 3 分提醒我」。` : '');
const ITEM = /^\s*-\s/;

/**
 * 回填給模型的工具結果文字（AGENT.md §4）：有卡片的工具，清單只留前幾筆並註明「已用卡片顯示」，
 * 讓模型只講重點、不逐條重抄（地端小模型尤其會照抄，回答又長又慢）。沒有卡片的工具照原文。
 * @param {{ text?: string, speak?: string|null, card?: string|null }} result callTool() 的結果
 */
export function modelText(result) {
  const text = result.text || result.speak || FALLBACK.empty;
  if (!result.card || !result.text) return text;
  const lines = text.split('\n');
  const total = lines.filter((l) => ITEM.test(l)).length;
  if (total <= MODEL_LIST_MAX) return `${text}\n（以上已用卡片顯示給使用者；回答只講重點，不要逐條重複）`;
  let kept = 0;
  const out = lines.filter((l) => !ITEM.test(l) || kept++ < MODEL_LIST_MAX);
  return [result.speak, ...out, `…（共 ${total} 筆，這裡只列前 ${MODEL_LIST_MAX} 筆；完整清單已用卡片顯示給使用者，回答不要逐條列出）`].filter(Boolean).join('\n');
}

/** 模型常把沒填的選填欄位送成 null 或空字串（尤其地端小模型）；一律視為沒給，交給 zod 用預設值 */
export function dropNulls(v) {
  const blank = (x) => x === null || (typeof x === 'string' && !x.trim());
  if (Array.isArray(v)) return v.filter((x) => !blank(x)).map(dropNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => !blank(x)).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

/**
 * 判斷層有把握時，地端模型只看這個意圖會用到的工具（實驗：30 個工具小模型容易選錯、提示詞也長）。
 * trip 與 unknown 不縮減。Claude 等大模型照常看全部工具。
 */
export const INTENT_TOOLS = {
  bus_route: ['bus_route_eta', 'bus_search_routes', 'bus_station_eta', 'bus_nearby_stations', 'find_place'],
  youbike: ['youbike_nearby', 'find_place'],
  nearby_bus: ['bus_nearby_stations', 'bus_station_eta', 'find_place'],
  metro: ['metro_live_board', 'metro_stations', 'find_place'],
  rail: ['thsr_timetable', 'tra_timetable', 'rail_stations', 'rail_fare', 'rail_booking_link'],
  weather: ['weather_now', 'find_place'],
  aqi: ['aqi_nearby', 'find_place'],
  quake: ['earthquake_recent'],
  pharmacy: ['pharmacy_search'],
  garbage: ['garbage_truck_nearby', 'find_place'],
  fuel: ['fuel_price'],
  invoice: ['invoice_lottery'],
  stock: ['stock_quote'],
};

/** profile 的工具 → 模型看的工具定義（registry 產生，ADR-0002）；only＝只給這些（判斷層縮減） */
export function toolDefs(profile, { deviceLocation: withLocation = false, only } = {}) {
  const names = only ? profile.tools.filter((n) => only.includes(n)) : profile.tools;
  const defs = (names.length ? names : profile.tools).map((n) => {
    const d = describeTool(getTool(n));
    const { $schema, ...schema } = d.inputSchema; // eslint-disable-line no-unused-vars
    return { name: d.name, description: `${d.title}：${d.description}`, schema };
  });
  return withLocation ? [...defs, DEVICE_LOCATION_TOOL] : defs;
}

/**
 * @param {object} svc createServices() 的結果
 * @param {object} body /api/v1/agent 的請求（會驗證）
 * @param {(e: object) => void} emit
 * @param {{ provider: Provider, profileId?: string, now?: number, onModelCall?: () => void }} opts
 */
export async function runModel(svc, body, emit, { provider, profileId = 'life', now = Date.now(), onModelCall = () => {}, judge }) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const picked = req.userState?.picked || [];
  const canLocate = !!req.clientTools?.includes(DEVICE_LOCATION_TOOL.name);
  // 判斷層：先用快速版（A＋規則，幾毫秒）說聽懂了什麼，不用等 loading；完整版（含模型）定案狀態與工具範圍
  const jc = judgeCalls(judge, req, profile);
  const last = req.messages.at(-1).content;
  const q0 = jc ? await jc.quick() : null;
  emit(ev.status({ mode: provider.mode, model: provider.model, profile: profile.id, judge: judgeInfo(q0) }));
  // 帶定位結果重送的是同一輪（客戶端接在同一個討論串）：「聽懂了什麼」上一次已經說過，不重複
  const heard = q0 && !req.clientToolResults?.length && judgeNote(q0);
  if (heard) emit(ev.agentNote(heard));
  const j = jc ? await jc.full(q0) : null;
  const more = !req.clientToolResults?.length && moreStatesNote(q0, j);
  if (more) emit(ev.agentNote(more));
  const sure = j && (j.source === 'llm' || j.source === 'device' || (j.confidence ?? 0) >= 0.8); // 模型判斷（伺服器 B 或手機上的模型，ADR-0014）或 A 有把握
  // 這句（或接著改的上一輪）沒說起點 → 起點是現在位置（下面呼叫 plan_trip 時由程式帶入）
  const rulesIt = parseIntent(last, { history: req.messages.slice(0, -1) });
  const hereIsOrigin = rulesIt.intent === 'trip' && !rulesIt.from;
  // 需要現在位置（沒說起點的行程、沒說地點的天氣／YouBike／附近公車／垃圾車／公車到站）→ 問模型之前就先請 App 定位，
  // 再把位置直接告訴模型（地端模型常常不呼叫 device_location，直接反問「你在哪裡」）
  const NEARBY_INTENTS = ['weather', 'aqi', 'youbike', 'nearby_bus', 'garbage', 'bus_route'];
  const wantHere = canLocate && (hereIsOrigin || (!rulesIt.places?.length && (needsLocation(rulesIt) || NEARBY_INTENTS.includes(j?.intent) || j?.intent === 'trip')));
  const here = canLocate ? deviceLocation(req) : null;
  if (wantHere && here === undefined) {
    emit(ev.agentNote('@定位 先看看你在哪裡'));
    emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
    emit(ev.done({ modelCalls: 0, inputTokens: 0, outputTokens: 0 }));
    return;
  }
  const locationHint = here ? `使用者現在在 ${here.lat.toFixed(5)}, ${here.lon.toFixed(5)}（手機定位）。使用者沒說起點或地點時就用這個位置：plan_trip 的 from 用 { lat, lon, name: "你的位置" }，天氣、空品、YouBike、附近公車、垃圾車用這個 lat/lon；不要再問他在哪裡。` : '';
  const only = sure && provider.mode === 'local' ? INTENT_TOOLS[j.intent] : undefined;

  let n = 0;
  const nextId = () => `t${++n}`;
  const used = new Set();
  // 有現在位置時，程式先用它查好（不靠模型）：地端模型常常只查了目的地就反問「你從哪裡出發」。
  //   沒說起點的行程 → plan_trip（起點＝現在位置）；沒說地點的天氣／空品／YouBike／附近公車／垃圾車 → 對應工具（現在位置）
  // 結果照常出現在討論串與卡片，再交給模型轉述（AGENT.md §5.2.1）
  const pre = here ? prefetchCalls(rulesIt, j, here) : [];
  let prefetched = '';
  const preDone = new Map(); // 呼叫鍵（工具＋關鍵參數）→ 給模型的文字：模型用相同參數再呼叫時沿用，不重複產生卡片與決策圖；參數不同照常執行
  if (pre.length) {
    const out = await execTools(svc, pre, emit, { profile, nextId, picked, ...(j && { judgedStates: j.states }) });
    const texts = out.map((o, i) => {
      used.add(pre[i].name);
      if (o.followUp) used.add('bus_route_eta');
      // 查詢失敗也告訴模型原因（請照實轉述），模型才不會一直重查同一個工具
      const text = o.ok ? modelText(o.result) + followUpText(o.followUp, o.followWalkMin) : `（${pre[i].name} 查詢失敗：${o.error}。請照實告訴使用者，不要再呼叫同一個工具。）`;
      preDone.set(callKey(pre[i].name, pre[i].args), text);
      return text;
    });
    prefetched = texts.join('\n\n');
  }
  const conv = provider.start({
    system: buildSystemPrompt(profile, { now, context: req.context, picked, locationHint, prefetched }),
    tools: toolDefs(profile, { deviceLocation: canLocate, only }),
    messages: req.messages,
  });
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const finish = (text) => {
    if (used.size) emit(ev.discussionEnd({ tools: [...used] }));
    emit(ev.text(guardedText(profile, text, emit))); // L2 輸出護欄（防詐：不保證安全、固定附 165）
    emit(ev.done(usage));
  };

  for (let round = 0; ; round++) {
    onModelCall();
    const turn = await conv.next();
    usage.modelCalls++;
    usage.inputTokens += turn.usage.input;
    usage.outputTokens += turn.usage.output;
    const text = turn.text.trim();
    if (turn.stop === 'refusal') return finish(FALLBACK.refusal);
    if (!turn.calls.length) {
      if (turn.stop === 'max_tokens') return finish(text ? `${text}…（${FALLBACK.truncated}）` : FALLBACK.truncated);
      return finish(text || FALLBACK.empty);
    }
    if (turn.stop === 'max_tokens') return finish(FALLBACK.truncated); // 工具參數可能被截斷，不執行
    if (round >= MAX_TOOL_ROUNDS) return finish(FALLBACK.rounds); // 第 6 輪還要查 → 不再呼叫工具
    if (text) emit(ev.agentNote(text));

    /** @type {Map<string, { content: string, isError?: boolean }>} */
    const results = new Map();
    // 裝置定位：還沒有結果 → 請客戶端定位後重送（與示範模式相同的協定，AGENT.md §3.4）
    const locCalls = turn.calls.filter((c) => c.name === DEVICE_LOCATION_TOOL.name);
    if (locCalls.length) {
      const loc = canLocate ? deviceLocation(req) : null;
      if (loc === undefined) {
        emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
        emit(ev.done(usage));
        return;
      }
      for (const c of locCalls) results.set(c.id, loc ? { content: JSON.stringify(loc) } : { content: FALLBACK.noLocation, isError: true });
    }
    for (const c of turn.calls) if (!results.has(c.id) && c.bad !== undefined) results.set(c.id, { content: `參數不是有效的 JSON：${c.bad}`, isError: true });

    // 轉述受程式約束（A2）：抵達時間、交通方式只採使用者說過的（規則抽到的），模型自己加的丟掉
    //（地端模型曾自加 arriveBy，結果「所有方式都趕不上指定時間」，2026-11-21 實機）
    for (const c of turn.calls) if (c.name === 'plan_trip' && c.input?.prefs) c.input = { ...c.input, prefs: groundedPrefs(c.input.prefs, rulesIt, j) };

    // 已由程式依現在位置查好的工具：模型再呼叫就沿用結果（避免同一張卡片、決策圖出現兩次）
    for (const c of turn.calls) {
      const k = !results.has(c.id) && callKey(c.name, c.input, here);
      if (k && preDone.has(k)) results.set(c.id, { content: `（已查好，結果同上）\n${preDone.get(k)}` });
    }

    // 起點交給程式（不交給模型）：使用者沒說起點（「去台北 101」、接著改而上一輪也沒說）→ plan_trip 的起點一律是手機定位。
    // 地端小模型常把目的地也填成起點（台北101 → 台北101），這裡直接改掉；還沒定位就先請客戶端定位。
    const trips = turn.calls.filter((c) => c.name === 'plan_trip' && !results.has(c.id));
    if (trips.length && hereIsOrigin) {
      const loc = here;
      if (loc === undefined) {
        emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
        emit(ev.done(usage));
        return;
      }
      for (const c of trips) {
        if (loc) c.input = { ...c.input, from: { lat: loc.lat, lon: loc.lon, name: loc.name } };
        else if (sameText(c.input?.from, c.input?.to)) results.set(c.id, { content: FALLBACK.sameFromTo, isError: true });
      }
    }

    const run = turn.calls.filter((c) => !results.has(c.id));
    const out = await execTools(svc, run.map((c) => ({ name: c.name, args: dropNulls(c.input) })), emit, { profile, nextId, picked, ...(j && { judgedStates: j.states }) });
    run.forEach((c, i) => {
      const o = out[i];
      used.add(c.name);
      if (o.followUp) used.add('bus_route_eta'); // 選公車後自動盯到站也算一個工具
      // 回填模型的只有文字摘要（清單截短），不放整包 data（AGENT.md §4）
      results.set(c.id, o.ok ? { content: modelText(o.result) + followUpText(o.followUp, o.followWalkMin) } : { content: o.error, isError: true });
    });
    conv.addResults(turn, turn.calls.map((c) => ({ id: c.id, ...results.get(c.id) })));
  }
}
