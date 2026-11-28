// S16 藥局定位轉行政區（2026-11-21）：「附近的藥局」用位置推估縣市＋鄉鎮區（真實：最近氣象站；示範：內建大約中心），並說明是推估
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherServices } from '../core/services/weather.js';
import { createMockWeatherServices } from '../core/services/weather-mock.js';
import { createCwaClient } from '../core/cwa-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { runModel, prefetchCalls } from '../core/agent/model-loop.js';

const DAAN = { lat: 25.0265, lon: 121.5436 };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const STATIONS = { records: { Station: [
  { StationName: '大安森林', GeoInfo: { CountyName: '臺北市', TownName: '大安區', Coordinates: [{ CoordinateName: 'WGS84', StationLatitude: 25.0300, StationLongitude: 121.5355 }] }, ObsTime: { DateTime: '2026-11-21T10:00:00+08:00' }, WeatherElement: { AirTemperature: 24 } },
  { StationName: '信義', GeoInfo: { CountyName: '臺北市', TownName: '信義區', Coordinates: [{ CoordinateName: 'WGS84', StationLatitude: 25.0377, StationLongitude: 121.5649 }] }, ObsTime: { DateTime: '2026-11-21T10:00:00+08:00' }, WeatherElement: { AirTemperature: 24 } },
] } };

test('weather.district：真實只查觀測站（不抓雨量與預報）、附測站與距離；示範用內建中心、6 公里外沒有', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return ok(String(url).includes('O-A0001-001') ? STATIONS : { records: { Station: [] } }); };
  const live = createWeatherServices(createCwaClient({ apiKey: 'K', fetchImpl })).weather;
  const d = await live.district(DAAN);
  assert.deepEqual([d.area, d.station, d.demo], ['臺北市大安區', '大安森林', false]);
  assert.ok(d.distanceM > 0 && d.distanceM < 2000);
  assert.ok(!urls.some((u) => /O-A0002|F-D0047/.test(u)), '不抓雨量站與預報');
  const mock = createMockWeatherServices().weather;
  assert.equal((await mock.district(DAAN)).area, '臺北市大安區');
  assert.equal((await mock.district({ lat: 25.0614, lon: 121.4880 })).area, '新北市三重區');
  assert.equal(await mock.district({ lat: 23.5, lon: 121.0 }), null);
});

test('pharmacy_search：座標推估行政區並說明；有 query 也用位置；只給一個座標、推估不出都請使用者說', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'pharmacy_search', DAAN);
  assert.equal(r.data.area, '臺北市大安區');
  assert.deepEqual(r.data.areaFrom, { by: 'location', station: '示範', distanceM: r.data.areaFrom.distanceM, demo: true });
  assert.match(r.text, /^依位置推估在「臺北市大安區」（示範），不對請說哪一區。/);
  assert.equal((await callTool(svc, 'pharmacy_search', { query: '健康', ...DAAN })).data.area, '臺北市大安區', '附近的某某藥局：也限在這一區');
  assert.equal((await callTool(svc, 'pharmacy_search', { area: '臺北市信義區', ...DAAN })).data.area, '臺北市信義區', '說了地區就用說的');
  await assert.rejects(callTool(svc, 'pharmacy_search', { lat: 23.5, lon: 121.0 }), /請說縣市和鄉鎮區/);
  await assert.rejects(callTool(svc, 'pharmacy_search', { lat: 25.03 }), /同時給緯度和經度/);
});

test('示範模式：附近的藥局先定位；說了地標用地標推估；「附近的社區藥局」不是行政區', async () => {
  const svc = createServices({ forceMock: true });
  const run = async (content, extra = {}) => { const es = []; await runDemo(svc, { messages: [{ role: 'user', content }], clientTools: ['device_location'], ...extra }, (e) => es.push(e)); return es; };
  const es = await run('附近的藥局', { clientToolResults: [{ id: 'loc1', ok: true, result: DAAN }] });
  assert.deepEqual(es.find((e) => e.type === 'tool_start' && e.name === 'pharmacy_search').input, DAAN);
  assert.match(es.find((e) => e.type === 'text').delta, /依[你您]的位置推估在「臺北市大安區」，不對請說哪一區/);
  assert.ok((await run('附近的藥局')).some((e) => e.type === 'client_tool_call'), '先請 App 定位');
  const named = await run('板橋車站附近的藥局');
  assert.ok(!named.some((e) => e.type === 'client_tool_call'), '說了地標不用定位');
  assert.match(named.find((e) => e.type === 'text').delta, /依「板橋車站」的位置推估在「新北市板橋區」/);
  assert.ok((await run('附近的社區藥局')).some((e) => e.type === 'client_tool_call'), '「社區」不是行政區');
  const noLoc = await run('附近的藥局', { clientToolResults: [{ id: 'loc1', ok: false }] });
  assert.match(noLoc.find((e) => e.type === 'text').delta, /沒拿到[你您]的位置，我先查「臺北市中正區」/);
});

test('模型模式：說了哪一區不要位置、直接查那一區；沒說就依位置預先查', async () => {
  const svc = createServices({ forceMock: true });
  const es = [];
  const provider = { mode: 'local', model: 'fake', start() { return { next: async () => ({ text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  await runModel(svc, { messages: [{ role: 'user', content: '大安區的藥局' }], clientTools: ['device_location'] }, (e) => es.push(e), { provider, judge: async () => ({ intent: 'pharmacy', states: [], confidence: 0.9, source: 'embed' }) });
  assert.ok(!es.some((e) => e.type === 'client_tool_call'), '不問位置');
  assert.deepEqual(es.find((e) => e.type === 'tool_start')?.input, { area: '大安區' });
  assert.deepEqual(prefetchCalls({ intent: 'pharmacy', places: [], states: [] }, null, { ...DAAN, name: '您的位置' }), [{ name: 'pharmacy_search', args: DAAN }]);
});
