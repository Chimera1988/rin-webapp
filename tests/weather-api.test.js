import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';

test('weather rejects missing coordinates before touching the upstream service', async () => {
  const oldPin = process.env.ACCESS_PIN;
  process.env.ACCESS_PIN = '1357';
  try {
    const weather = await import(`../api/weather.js?invalid-coordinates=${Date.now()}`);
    const res = createRes();
    await weather.default(createReq({ method: 'GET', headers: { 'x-rin-pin': '1357' }, query: {} }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVALID_COORDINATES');
  } finally {
    if (oldPin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = oldPin;
  }
});

test('weather forwards only validated lat/lon coordinates to OpenWeather', async () => {
  const oldPin = process.env.ACCESS_PIN;
  const oldKey = process.env.OPENWEATHER_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '1357';
  process.env.OPENWEATHER_API_KEY = 'test-weather-key';
  let upstreamUrl = '';
  globalThis.fetch = async url => {
    upstreamUrl = String(url);
    return new Response(JSON.stringify({
      name: 'Kanazawa', dt: 1, timezone: 32400,
      weather: [{ description: 'ясно', icon: '01d' }],
      main: { temp: 22.4, feels_like: 22.1, humidity: 60 }, wind: { speed: 2.5 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const weather = await import(`../api/weather.js?coordinate-contract=${Date.now()}`);
    const res = createRes();
    await weather.default(createReq({
      method: 'GET', headers: { 'x-rin-pin': '1357' },
      query: { lat: '36.5613', lon: '136.6562', units: 'metric', lang: 'ru', q: 'INJECTED_CITY' }
    }), res);
    assert.equal(res.statusCode, 200);
    const url = new URL(upstreamUrl);
    assert.equal(url.searchParams.get('lat'), '36.5613');
    assert.equal(url.searchParams.get('lon'), '136.6562');
    assert.equal(url.searchParams.get('q'), null);
    assert.equal(res.body.weather, 'ясно');
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = oldPin;
    if (oldKey === undefined) delete process.env.OPENWEATHER_API_KEY; else process.env.OPENWEATHER_API_KEY = oldKey;
  }
});
