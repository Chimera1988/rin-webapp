import { fetchWithTimeout, publicError, requireMethod, requirePin } from '../lib/server/http.js';

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;
const ALLOWED_UNITS = new Set(['metric']);
const ALLOWED_LANGS = new Set(['ru']);

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? String(number) : null;
}

export default async function handler(req, res) {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    if (!requirePin(req, res, {})) return;

    const query = req.query || {};
    const units = ALLOWED_UNITS.has(String(query.units)) ? String(query.units) : 'metric';
    const lang = ALLOWED_LANGS.has(String(query.lang)) ? String(query.lang) : 'ru';
    const lat = finiteCoordinate(query.lat, -90, 90);
    const lon = finiteCoordinate(query.lon, -180, 180);
    if (!lat || !lon) return res.status(400).json({ error: 'Valid coordinates are required', code: 'INVALID_COORDINATES' });
    if (!OPENWEATHER_KEY) return res.status(503).json({ error: 'Weather is not configured', code: 'WEATHER_NOT_CONFIGURED' });

    const params = new URLSearchParams({ appid: OPENWEATHER_KEY, units, lang, lat, lon });

    const upstream = await fetchWithTimeout(`https://api.openweathermap.org/data/2.5/weather?${params}`, {}, 10_000);
    if (!upstream.ok) {
      console.error('Weather upstream failed', upstream.status, (await upstream.text().catch(() => '')).slice(0, 500));
      return res.status(502).json({ error: 'Weather upstream failed', code: 'WEATHER_UPSTREAM_ERROR' });
    }
    const data = await upstream.json();
    const out = {
      name: data.name || '',
      dt: Number(data.dt) || null,
      tz: Number(data.timezone) || 0,
      weather: data.weather?.[0]?.description || '',
      icon: data.weather?.[0]?.icon || '',
      temp: Number.isFinite(data.main?.temp) ? data.main.temp : null,
      feels_like: Number.isFinite(data.main?.feels_like) ? data.main.feels_like : null,
      humidity: Number.isFinite(data.main?.humidity) ? data.main.humidity : null,
      wind: Number.isFinite(data.wind?.speed) ? data.wind.speed : null
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (error) {
    console.error('Weather proxy error', error);
    const mapped = publicError(error, 'Weather proxy error');
    return res.status(mapped.status).json(mapped.body);
  }
}
