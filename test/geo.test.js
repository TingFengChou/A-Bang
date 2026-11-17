// core/geo.js：WKT 解析（Bus Shape）與路徑抽樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWkt, pathFromWkt, thinPath } from '../core/geo.js';

test('LINESTRING：經緯度順序轉成 [lat, lon]', () => {
  assert.deepEqual(parseWkt('LINESTRING(121.517 25.0478, 121.52 25.05)'), [[[25.0478, 121.517], [25.05, 121.52]]]);
  // 帶 SRID 前綴、大小寫、多餘空白
  assert.deepEqual(parseWkt(' SRID=4326;linestring ( 121.5 25.0 ,121.6   25.1 ) '), [[[25.0, 121.5], [25.1, 121.6]]]);
});

test('MULTILINESTRING：依序串接並去掉接點重複', () => {
  const wkt = 'MULTILINESTRING((121.50 25.00, 121.51 25.01), (121.51 25.01, 121.52 25.02))';
  assert.equal(parseWkt(wkt).length, 2);
  assert.deepEqual(pathFromWkt(wkt), [[25.0, 121.5], [25.01, 121.51], [25.02, 121.52]]);
});

test('順序寫反（lat lon）時自動換回', () => {
  assert.deepEqual(pathFromWkt('LINESTRING(25.0 121.5, 25.1 121.6)'), [[25.0, 121.5], [25.1, 121.6]]);
});

test('看不懂的輸入回傳空陣列，不丟例外', () => {
  for (const bad of [null, undefined, '', 'POINT(121.5 25.0)', 'LINESTRING(121.5 25.0)', 'LINESTRING(abc def, 1 2)', 'LINESTRING(121.5 25.0, 999 999)', 42]) {
    assert.deepEqual(parseWkt(bad), [], String(bad));
    assert.deepEqual(pathFromWkt(bad), [], String(bad));
  }
});

test('thinPath：超過上限才抽樣，保留頭尾', () => {
  const pts = Array.from({ length: 1001 }, (_, i) => [25 + i / 1e4, 121.5]);
  const out = thinPath(pts, 100);
  assert.equal(out.length, 100);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out.at(-1), pts.at(-1));
  const few = pts.slice(0, 5);
  assert.equal(thinPath(few, 100), few);
});
