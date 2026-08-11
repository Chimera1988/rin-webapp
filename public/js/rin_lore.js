import { fetchWithTimeout } from './http_client.js';

// Public runtime metadata only. Biography, memories, triggers and prompt profile
// live outside /public and are loaded exclusively by the server Canon Store.
const SCHEDULE_URL = '/data/rin_schedule.json';
const POOLS = new Set(['morning', 'day', 'evening', 'night']);
let cache = null;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max, fallback = min) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function validClock(value = '') {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${match[1]}:${match[2]}` : null;
}

function clockMinute(value = '') {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function validTimeZone(value = '') {
  const timezone = String(value || '').trim();
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return null;
  }
}

export function normalizeScheduleConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  if (source._schema !== 'rin-schedule-v2') throw new Error('INVALID_SCHEDULE_SCHEMA');

  const timezone = validTimeZone(source.timezone);
  if (!timezone) throw new Error('INVALID_SCHEDULE_TIMEZONE');

  const location = source.location && typeof source.location === 'object' ? source.location : {};
  const lat = finite(location.lat, NaN);
  const lon = finite(location.lon, NaN);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('INVALID_SCHEDULE_LOCATION');
  }

  const seenIds = new Set();
  const windows = (Array.isArray(source.windows) ? source.windows : []).map((item, index) => {
    const id = String(item?.id || '').trim().slice(0, 80);
    const from = validClock(item?.from);
    const to = validClock(item?.to);
    const pool = POOLS.has(item?.pool) ? item.pool : null;
    const probability = finite(item?.probability, NaN);
    if (!id || seenIds.has(id) || !from || !to || clockMinute(to) <= clockMinute(from) || !pool || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error(`INVALID_SCHEDULE_WINDOW_${index + 1}`);
    }
    seenIds.add(id);
    return Object.freeze({ id, from, to, pool, probability });
  });
  if (!windows.length) throw new Error('EMPTY_SCHEDULE_WINDOWS');

  if (source.probability_semantics !== 'one_draw_per_window_when_eligible') {
    throw new Error('INVALID_SCHEDULE_PROBABILITY_SEMANTICS');
  }

  const activityMin = Math.round(clamp(source.inner_life?.activity_min_minutes, 5, 24 * 60, 35));
  const activityMax = Math.round(clamp(source.inner_life?.activity_max_minutes, activityMin, 24 * 60, activityMin));

  return Object.freeze({
    schema: 'rin-schedule-v2',
    timezone,
    location: Object.freeze({
      name: String(location.name || '').trim().slice(0, 80),
      country: String(location.country || '').trim().slice(0, 8),
      lat,
      lon
    }),
    windows: Object.freeze(windows),
    probabilitySemantics: 'one_draw_per_window_when_eligible',
    pollIntervalMs: Math.round(clamp(source.poll_interval_seconds, 30, 3600, 60) * 1000),
    maxDailyInitiations: Math.round(clamp(source.max_daily_initiations, 0, 10, 2)),
    minimumSilenceMinutes: Math.round(clamp(source.minimum_silence_minutes, 15, 24 * 60, 45)),
    innerLife: Object.freeze({
      activityMinMinutes: activityMin,
      activityMaxMinutes: activityMax,
      continueAcrossMessages: source.inner_life?.continue_across_messages !== false
    })
  });
}

export function resetLoreCache() { cache = null; }

export async function getSchedule() {
  if (cache) return cache;
  const response = await fetchWithTimeout(SCHEDULE_URL, { cache: 'no-store' }, 12_000);
  if (!response.ok) throw new Error(`${SCHEDULE_URL}: HTTP ${response.status}`);
  cache = normalizeScheduleConfig(await response.json());
  return cache;
}
