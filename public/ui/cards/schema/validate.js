// 卡片資料契約的小型 JSON Schema 驗證器（零依賴，Node 與瀏覽器皆可用；CARDS.md §6）。
// 只支援契約用到的子集：type（含陣列與 integer/null）、enum、const、properties、required、items、
// minimum、maximum、minItems、additionalProperties: false、本檔內 $ref（#/$defs/…）。
// 不支援的關鍵字會被忽略——契約請只用上列關鍵字。

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number' && Number.isFinite(v));

/**
 * @param {object} schema JSON Schema（根）
 * @param {any} value
 * @returns {string[]} 錯誤清單（空陣列＝通過），每筆是「路徑：原因」
 */
export function validate(schema, value) {
  const errors = [];
  const resolve = (s) => {
    if (!s?.$ref) return s;
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    const hit = m && schema.$defs?.[m[1]];
    if (!hit) throw new Error(`不支援的 $ref：${s.$ref}`);
    return resolve(hit);
  };
  const walk = (raw, v, path) => {
    const s = resolve(raw);
    if (!s || typeof s !== 'object') return;
    if (s.type) {
      const types = [].concat(s.type);
      if (!types.some((t) => isType(v, t))) { errors.push(`${path}：應為 ${types.join('|')}，實際是 ${typeOf(v)}`); return; }
    }
    if (s.enum && !s.enum.some((e) => e === v)) errors.push(`${path}：${JSON.stringify(v)} 不在 ${JSON.stringify(s.enum)}`);
    if ('const' in s && s.const !== v) errors.push(`${path}：應為 ${JSON.stringify(s.const)}`);
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errors.push(`${path}：小於 ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errors.push(`${path}：大於 ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errors.push(`${path}：至少 ${s.minItems} 筆`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const k of s.required || []) if (!(k in v) || v[k] === undefined) errors.push(`${path}.${k}：缺少必要欄位`);
      for (const [k, sub] of Object.entries(s.properties || {})) if (v[k] !== undefined) walk(sub, v[k], `${path}.${k}`);
      if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!s.properties?.[k]) errors.push(`${path}.${k}：契約沒有這個欄位`);
    }
  };
  walk(schema, value, '$');
  return errors;
}
