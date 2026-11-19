// 最小 CSV 解析（RFC 4180）：引號、引號內換行與逗號、"" 跳脫、BOM、CRLF。政府開放資料 CSV 用（不新增依賴）。

/**
 * @param {string} text
 * @returns {string[][]} 每列的欄位（空白列略過）
 */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/**
 * 依表頭名稱轉成物件；缺必要欄位時丟錯（資料集改欄位時第一時間發現）。
 * @param {string} text
 * @param {string[]} required 必要欄位名稱
 * @returns {Record<string, string>[]}
 */
export function csvObjects(text, required = []) {
  const [head, ...rows] = parseCsv(text);
  const cols = (head || []).map((h) => h.trim());
  const missing = required.filter((k) => !cols.includes(k));
  if (missing.length) throw new Error(`CSV 缺少欄位：${missing.join('、')}`);
  return rows.map((r) => Object.fromEntries(cols.map((k, i) => [k, (r[i] ?? '').trim()])));
}
