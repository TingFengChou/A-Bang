// 阿幫的腦袋「行動」（2026-11-28）：從這一輪的事件推出能幫你做的事；L2 白名單（防詐工具不算）；確認方式對應
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actionsOf, actSummary, ACTION_ORDER } from '../public/js/ai-actions.js';
import { summarizeRun, TRIAL_SECTIONS } from '../public/js/ai-trial.js';
import { TRIAL_ZH, TRIAL_EN } from '../public/js/pages/ai-trial-i18n.js';

const ids = (a) => a.map((x) => `${x.id}:${x.confirm}`);

test('行程卡：導航（按一下）、加到行事曆與分享（系統畫面）；有叫車方案再加叫車（您按確認）', () => {
  assert.deepEqual(ids(actionsOf({ results: [{ tool: 'plan_trip', card: 'trip', data: { options: [{ role: 'metro' }] } }] })), ['nav:tap', 'calendar:system', 'share:system']);
  assert.deepEqual(ids(actionsOf({ results: [{ tool: 'plan_trip', card: 'trip', data: { options: [{ role: 'ridehail' }] } }] })), ['nav:tap', 'calendar:system', 'share:system', 'ride:confirm']);
});

test('診所、藥局、戶政：導航＋撥電話；官方入口要確認；防詐工具標 L2 但不是行動', () => {
  assert.deepEqual(ids(actionsOf({ results: [{ tool: 'clinic_search', card: 'clinic', data: { clinics: [{ phone: '(02)1234' }] } }] })), ['call:tap', 'nav:tap']);
  assert.deepEqual(ids(actionsOf({ results: [{ tool: 'gov_official_link', card: 'gov-links', data: { links: [{ id: 'ticket' }] } }] })), ['gov:confirm']);
  assert.deepEqual(actionsOf({ results: [{ tool: 'gov_official_link', card: 'gov-links', data: { links: [] } }] }), [], '沒有入口就沒有行動');
  assert.deepEqual(actionsOf({ results: [{ tool: 'scam_check_message', card: 'scam-risk', data: {} }] }), []);
  assert.deepEqual(actionsOf({ results: [{ tool: 'weather_now', card: 'weather', data: {} }] }), []);
});

test('阿幫問您的動作選項（到站提醒、加到行事曆）與安全情境的一鍵撥號', () => {
  const run = summarizeRun([
    { type: 'ask', id: 'a', question: '要提醒您嗎？', options: [{ label: '到站前 3 分提醒我', kind: 'action', action: { name: 'watchArrival' } }, { label: '不用', kind: 'dismiss' }] },
    { type: 'guardrail', rule: 'safety:medical', calls: [{ tel: '119' }] },
  ]);
  assert.equal(run.ask.options[0].action, 'watchArrival');
  assert.deepEqual(ids(actionsOf(run)), ['call:tap', 'remind:tap']);
  assert.deepEqual(actSummary(actionsOf({ results: [{ tool: 'plan_trip', card: 'trip', data: { options: [] } }] })), { n: 3, confirm: 2 });
});

test('試判斷第 5 段與字典：每個行動、確認方式、地點中英都有；英文不含中文；Siri 那一句跟 App Shortcuts 的名稱對得上', () => {
  assert.equal(TRIAL_SECTIONS.at(-1), 'act');
  for (const D of [TRIAL_ZH, TRIAL_EN]) {
    for (const id of ACTION_ORDER) assert.ok(D[`act.${id}`], id);
    for (const k of ['tap', 'confirm', 'system']) assert.ok(D[`act.confirm.${k}`], k);
    for (const k of ['phone', 'calendar', 'official']) assert.ok(D[`act.at.${k}`], k);
  }
  for (const [k, v] of Object.entries(TRIAL_EN)) if (k.startsWith('act.')) assert.doesNotMatch(v, /[一-鿿]/, k);
  const swift = readFileSync(new URL('../ios/App/App/AbangIntents.swift', import.meta.url), 'utf8');
  const shorts = [...swift.matchAll(/shortTitle: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(shorts.length >= 3);
  for (const s of shorts) assert.ok(TRIAL_ZH['act.siri'].includes(s), `act.siri 要列出「${s}」`);
});
