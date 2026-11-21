// S12g 外殼英文：網址帶 lang=en（或問阿幫最近一輪是英文）時，分頁列、返回、浮動阿幫、底部對話面板、提醒泡泡用英文；其他時候中文且與改版前一字不差
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZH, EN, shellT, shellLang, applyShell, currentShellLang } from '../public/js/shell-i18n.js';

const HAN = /[一-鿿]/;
const ph = (v) => [...new Set(v.match(/\{\w+\}/g) || [])].sort();

test('外殼字典：中英同鍵、佔位符相同、英文不含中文', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  for (const [k, v] of Object.entries(ZH)) {
    assert.ok(typeof EN[k] === 'string' && EN[k].trim(), k);
    assert.deepEqual(ph(EN[k]), ph(v), k);
    assert.doesNotMatch(EN[k], HAN, k);
  }
});

test('外殼中文：與改版前的字一字不差', () => {
  const zh = shellT(null);
  assert.deepEqual(['skip', 'back', 'tab.home', 'tab.nearby', 'tab.bus', 'tab.favs', 'fab', 'fabChat', 'sheetTitle', 'sheetFull', 'sheetClose', 'bubbleOk'].map((k) => zh(k)),
    ['跳到主要內容', '返回', '首頁', '附近', '公車', '收藏', '問阿幫', '打開跟阿幫的對話（對話還在）', '問阿幫', '放大成整頁', '收起對話（對話會保留）', '知道了']);
  assert.equal(zh('liveSays', { text: '307 快到了' }), '阿幫：307 快到了');
  assert.equal(shellT('en')('liveSays', { text: '{x}' }), 'Abang: {x}', '代入的文字不再展開');
  assert.equal(zh('nope'), 'nope', '缺鍵回傳鍵');
});

test('shellLang：只認網址 lang=en；問阿幫（生活）頁看最近一輪', () => {
  assert.equal(shellLang({ query: { lang: 'en' } }), 'en');
  assert.equal(shellLang({ query: { lang: 'fr' } }), null);
  assert.equal(shellLang({ query: {} }), null);
  assert.equal(shellLang(), null);
  assert.equal(shellLang({ query: {}, onLifeAgent: true, agentLang: 'en' }), 'en');
  assert.equal(shellLang({ query: {}, onLifeAgent: true, agentLang: null }), null, '最近一輪是中文');
  assert.equal(shellLang({ query: {}, onLifeAgent: false, agentLang: 'en' }), null, '離開問阿幫頁回中文');
});

/** 極簡假 DOM：只有 applyShell 用到的 */
function fakeDoc() {
  const mk = (data, label = null) => ({ dataset: data, textContent: '', attrs: { ...(label && { 'aria-label': label }) }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
  const texts = ['skip', 'tab.home', 'tab.nearby', 'tab.bus', 'tab.favs', 'sheetTitle', 'sheetFull'].map((k) => mk({ shell: k }));
  const labels = ['back', 'sheetClose'].map((k) => mk({ shellLabel: k }));
  return {
    documentElement: { lang: 'zh-Hant-TW', dataset: {} },
    querySelectorAll: (sel) => (sel === '[data-shell]' ? texts : sel === '[data-shell-label]' ? labels : []),
    texts, labels,
  };
}

test('applyShell：lang=en 時外殼英文、<html lang="en">；回到中文時恢復', () => {
  const doc = fakeDoc();
  applyShell('en', doc);
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(currentShellLang(doc), 'en');
  assert.deepEqual(doc.texts.map((x) => x.textContent), ['Skip to main content', 'Home', 'Nearby', 'Bus', 'Saved', 'Ask Abang', 'Open full page']);
  assert.deepEqual(doc.labels.map((x) => x.attrs['aria-label']), ['Back', 'Minimize chat (it stays here)']);
  applyShell(null, doc);
  assert.equal(doc.documentElement.lang, 'zh-Hant-TW');
  assert.equal(currentShellLang(doc), null);
  assert.deepEqual(doc.texts.map((x) => x.textContent), ['跳到主要內容', '首頁', '附近', '公車', '收藏', '問阿幫', '放大成整頁']);
  assert.deepEqual(doc.labels.map((x) => x.attrs['aria-label']), ['返回', '收起對話（對話會保留）']);
});

test('問阿幫頁英文一輪：外殼英文、元素標 lang="en"，整頁 <html lang> 不變（上面還有中文對話；PR 審查）', () => {
  const doc = fakeDoc();
  applyShell('en', doc, { docLang: null });
  assert.equal(doc.documentElement.lang, 'zh-Hant-TW');
  assert.equal(currentShellLang(doc), 'en');
  assert.equal(doc.texts[1].textContent, 'Home');
  assert.ok(doc.texts.every((x) => x.attrs.lang === 'en') && doc.labels.every((x) => x.attrs.lang === 'en'));
  applyShell(null, doc);
  assert.ok(doc.texts.every((x) => !('lang' in x.attrs)), '回中文拿掉標記');
});

test('app.js 外殼用到的鍵都在字典裡；index.html 預設 zh-Hant-TW', async () => {
  const src = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/data-shell(?:-label)?="([\w.]+)"/g), ...src.matchAll(/zh\('([\w.]+)'\)/g), ...src.matchAll(/'#\/\w*', '(tab\.\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, keys.join(','));
  for (const k of keys) assert.ok(k in ZH, k);
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="zh-Hant-TW">/);
});
