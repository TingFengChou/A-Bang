// 叫車 provider：Uber 深層連結（ADR-0011）。只產生官方連結，不代叫車、不付款、不收集個資。
// 連結格式：https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=…（docs/MCP_TOOLS.md §6）

const BASE = 'https://m.uber.com/ul/';
const fix = (n) => Number(n).toFixed(6);
const enc = encodeURIComponent;

/** 某個點的 query 參數：pickup／dropoff 各自的 latitude、longitude、nickname */
function pointParams(key, p) {
  const out = [`${key}[latitude]=${fix(p.lat)}`, `${key}[longitude]=${fix(p.lon)}`];
  if (p.name) out.push(`${key}[nickname]=${enc(p.name)}`);
  return out;
}

export const uber = {
  id: 'uber',
  name: 'Uber',
  /**
   * @param {{ from?: { lat: number, lon: number, name?: string } | null, to: { lat: number, lon: number, name?: string } }} p
   *   from 省略時上車點用 App 的目前位置（pickup=my_location），不需要使用者的座標
   */
  link({ from, to }) {
    const params = ['action=setPickup', ...(from ? pointParams('pickup', from) : ['pickup=my_location']), ...pointParams('dropoff', to)];
    return `${BASE}?${params.join('&')}`;
  },
};
