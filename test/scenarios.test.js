// 情境對話測試集（A0，PM 盤點的 S1～S18）：多輪對話在示範模式跑，檢查用了哪些工具、狀態、最佳方案、總結文字。
// 有定位（App 已允許）時的行為；todo 情境是開發目標（標 todo，不算失敗）。模型模式另用 scripts/eval-scenarios.js（不進 CI）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';
import { createJudge } from '../core/agent/judge.js';
import { check } from '../scripts/eval/scenario-check.js';

const load = async (f) => JSON.parse(await readFile(new URL(`./scenarios/${f}`, import.meta.url), 'utf8'));
// life.json（S／P／D／AS／AR…）＋ life-q.json（PM「該問就問、不該問就不問」Q-1～Q-27）；各檔的 here 是那一份的預設定位
const sets = [await load('life.json'), await load('life-q.json')];
const set = sets[0];
const judge = createJudge(); // 規則（CI 不下載嵌入模型）

/** 情境指定時刻（台灣時間 HH:mm，今天）→ 時間戳；沒指定用現在 */
const atTW = (hhmm = '10:00') => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T${hhmm}:00+08:00`); // 沒指定用白天 10:00（結果不受跑測試的時間影響）

/** 跑一輪：回傳這輪的事件（預設帶定位結果＝App 已允許定位；情境 location: false＝拒絕；profileId＝情境的 profile；here＝情境的定位，沒有用整份的；
 *  pendingAsk＝上一輪「阿幫問你」在等的答案（前端在使用者直接打字回答時帶回來，ADR-0016）） */
async function turn(svc, messages, located = true, now = Date.now(), saved = undefined, profileId = 'life', here = set.here, pendingAsk = undefined) {
  const es = [];
  await runDemo(svc, { messages, clientTools: ['device_location'], clientToolResults: [located ? { id: 'loc1', ok: true, result: here } : { id: 'loc1', ok: false }], ...(saved && { savedPlaces: saved }), ...(pendingAsk && { pendingAsk }) }, (e) => es.push(e), { judge, now, profileId });
  return es;
}

for (const sc of sets.flatMap((st) => st.scenarios.map((x) => ({ ...x, here: x.here || st.here })))) {
  test(`${sc.id} ${sc.title}`, { todo: sc.todo || sc.known || false }, async () => { // known：跟其他決定衝突、等產品負責人決定（期望不改）
    const svc = createServices({ forceMock: true, ...(sc.demo && { demo: sc.demo }) });
    const messages = [];
    let pendingAsk;
    for (const [i, t] of sc.turns.entries()) {
      messages.push({ role: 'user', content: t.say });
      const es = await turn(svc, messages, sc.location !== false, atTW(sc.at), sc.saved, sc.profile, sc.here || set.here, pendingAsk); // profile：情境指定的 agent（例 antifraud），沒指定是生活
      const ask = es.find((e) => e.type === 'ask');
      pendingAsk = ask?.pending ? { id: ask.id, ...ask.pending } : undefined;
      const bad = check(es, t.expect);
      assert.deepEqual(bad, [], `第 ${i + 1} 輪「${t.say}」`);
      messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
    }
  });
}
