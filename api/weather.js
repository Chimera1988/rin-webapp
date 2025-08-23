// /api/weather.js
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
    if (!OPENWEATHER_KEY) {
      return res.status(500).json({ error: 'Missing OPENWEATHER_API_KEY' });
    }

    const { lat, lon, q, units = 'metric', lang = 'ru' } = req.query || {};

    // По умолчанию — Канадзава
    const params = new URLSearchParams({
      appid: OPENWEATHER_KEY,
      units,
      lang
    });

    if (lat && lon) {
      params.set('lat', lat);
      params.set('lon', lon);
    } else if (q) {
      params.set('q', q);
    } else {
      // Канадзава (36.5613, 136.6562)
      params.set('lat', '36.5613');
      params.set('lon', '136.6562');
    }

    // Текущая погода + “ощущается как”
    const url = `https://api.openweathermap.org/data/2.5/weather?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Upstream error', detail: txt });
    }
    const data = await r.json();

    // Можно слегка нормализовать поля под фронт
    const out = {
      name: data.name,
      dt: data.dt,
      tz: data.timezone,          // секундный оффсет для локального вычисления
      weather: data.weather?.[0]?.description || '',
      icon: data.weather?.[0]?.icon || '',
      temp: data.main?.temp,
      feels_like: data.main?.feels_like,
      humidity: data.main?.humidity,
      wind: data.wind?.speed
    };

    // кэш на минуту, чтобы не палить квоту
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Weather proxy error', detail: String(e?.message || e) });
  }
}
