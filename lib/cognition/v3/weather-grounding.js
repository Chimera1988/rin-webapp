/** Current API-weather evidence: factual normalization, not behavioral policy. */
const WEATHER_MAX_AGE_MS = 25 * 60_000;

const measure = (value) => value == null || value === '' || !Number.isFinite(Number(value))
  ? null : Number(value);

export function groundCurrentWeather(environment = null, rawEnv = null, now = Date.now()) {
  if (!environment || typeof environment !== 'object') return environment;
  const stamp = measure(rawEnv?._weatherTs);
  const age = stamp == null ? Infinity : now - stamp;
  // Never trust a current-weather claim from an untimestamped or stale sample.
  const recent = stamp != null && stamp > 0 && age >= -60_000 && age <= WEATHER_MAX_AGE_MS;
  const original = environment.weather;
  const weather = original && rawEnv?.weather && typeof original === 'object'
    ? {
        ...original,
        desc: String(rawEnv.weather.desc || '').trim().slice(0, 100) || null,
        temp: measure(rawEnv.weather.temp),
        feels: measure(rawEnv.weather.feels),
        wind: measure(rawEnv.weather.wind)
      }
    : null;
  const observed = weather && (Boolean(String(weather.desc || '').trim()) ||
    weather.temp != null || weather.wind != null);
  const fresh = Boolean(recent && observed);
  return {
    ...environment,
    weatherFresh: fresh,
    weatherObservedAt: fresh ? stamp : null,
    weather: fresh ? weather : null
  };
}
