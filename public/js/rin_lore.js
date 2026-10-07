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

function clockWindow(input = {}, defaults = {}) {
  const from = validClock(input?.from) || validClock(defaults.from);
  const to = validClock(input?.to) || validClock(defaults.to);
  if (!from || !to) throw new Error('INVALID_RHYTHM_CLOCK_WINDOW');
  return Object.freeze({ from, to });
}

function sameDayWindow(input = {}, defaults = {}) {
  const window = clockWindow(input, defaults);
  if (clockMinute(window.to) <= clockMinute(window.from)) throw new Error('INVALID_RHYTHM_SAME_DAY_WINDOW');
  return window;
}

function normalizeDayProfile(source = {}, defaults = {}) {
  const workBlocksSource = Array.isArray(source.work_blocks) ? source.work_blocks : (defaults.work_blocks || []);
  const workBlocks = workBlocksSource.map((item, index) => {
    const fallback = (defaults.work_blocks || [])[index] || {};
    return sameDayWindow(item, fallback);
  }).slice(0, 3);
  return Object.freeze({
    wakeWindow: clockWindow(source.wake_window, defaults.wake_window),
    sleepWindow: clockWindow(source.sleep_window, defaults.sleep_window),
    morningPersonalUntil: validClock(source.morning_personal_until) || validClock(defaults.morning_personal_until) || '08:00',
    workBlocks: Object.freeze(workBlocks),
    middayWindow: sameDayWindow(source.midday_window, defaults.midday_window),
    eveningTransition: sameDayWindow(source.evening_transition, defaults.evening_transition),
    freeEvening: sameDayWindow(source.free_evening, defaults.free_evening),
    workDefault: source.work_default !== undefined ? source.work_default === true : defaults.work_default === true
  });
}

function normalizeWeeklyRhythm(source = {}) {
  const defaults = {
    weekday: {
      wake_window: { from: '06:45', to: '07:30' }, sleep_window: { from: '23:30', to: '00:30' }, morning_personal_until: '08:00',
      work_blocks: [{ from: '08:00', to: '11:30' }, { from: '13:00', to: '17:30' }],
      midday_window: { from: '11:30', to: '13:30' }, evening_transition: { from: '17:30', to: '20:00' }, free_evening: { from: '20:00', to: '23:00' }, work_default: true
    },
    saturday: {
      wake_window: { from: '07:30', to: '09:30' }, sleep_window: { from: '23:50', to: '01:00' }, morning_personal_until: '10:00',
      work_blocks: [], midday_window: { from: '11:30', to: '13:30' }, evening_transition: { from: '17:30', to: '20:00' }, free_evening: { from: '20:00', to: '23:30' }, work_default: false
    },
    sunday: {
      wake_window: { from: '08:00', to: '09:30' }, sleep_window: { from: '23:15', to: '00:15' }, morning_personal_until: '10:00',
      work_blocks: [], midday_window: { from: '11:30', to: '13:30' }, evening_transition: { from: '17:30', to: '20:00' }, free_evening: { from: '20:00', to: '23:00' }, work_default: false
    }
  };
  const workDays = [...new Set((Array.isArray(source.work_days) ? source.work_days : [1, 2, 3, 4, 5]).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
  const weekendDays = [...new Set((Array.isArray(source.weekend_days) ? source.weekend_days : [0, 6]).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
  return Object.freeze({
    workDays: Object.freeze(workDays.length ? workDays : [1, 2, 3, 4, 5]),
    weekendDays: Object.freeze(weekendDays.length ? weekendDays : [0, 6]),
    profiles: Object.freeze({
      weekday: normalizeDayProfile(source.weekday || {}, defaults.weekday),
      saturday: normalizeDayProfile(source.saturday || {}, defaults.saturday),
      sunday: normalizeDayProfile(source.sunday || {}, defaults.sunday)
    }),
    weekendWork: Object.freeze({
      defaultOff: source.weekend_work?.default !== 'on',
      requiresEstablishedReason: source.weekend_work?.requires_established_reason !== false,
      minimumPressure: Math.round(clamp(source.weekend_work?.minimum_pressure, 60, 100, 88))
    })
  });
}

function normalizeSleepPolicy(source = {}) {
  return Object.freeze({
    targetSleepMinutes: Math.round(clamp(source.target_sleep_minutes, 360, 600, 450)),
    settleAfterChatMinutes: Math.round(clamp(source.settle_after_chat_minutes, 5, 90, 18)),
    continuityGraceMinutes: Math.round(clamp(source.continuity_grace_minutes, 10, 120, 30)),
    windingDownMinutes: Math.round(clamp(source.winding_down_minutes, 20, 180, 60)),
    drowsyMinutes: Math.round(clamp(source.drowsy_minutes, 5, 90, 20)),
    maxDebtMinutes: Math.round(clamp(source.max_debt_minutes, 60, 720, 300))
  });
}

function normalizeWeatherGrounding(source = {}) {
  return Object.freeze({
    enabled: source.enabled !== false,
    refreshMaxAgeMinutes: Math.round(clamp(source.refresh_max_age_minutes, 5, 120, 20)),
    outdoorPolicy: String(source.outdoor_policy || 'adapt_or_avoid').trim().slice(0, 40) || 'adapt_or_avoid'
  });
}

export function normalizeScheduleConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  if (!['rin-schedule-v2', 'rin-schedule-v3'].includes(source._schema)) throw new Error('INVALID_SCHEDULE_SCHEMA');

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
  const weeklyRhythm = normalizeWeeklyRhythm(source.weekly_rhythm || {});
  const sleep = normalizeSleepPolicy(source.sleep || {});
  const weatherGrounding = normalizeWeatherGrounding(source.weather_grounding || {});

  return Object.freeze({
    schema: 'rin-schedule-v3',
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
      continueAcrossMessages: source.inner_life?.continue_across_messages !== false,
      weeklyRhythm,
      sleep,
      weatherGrounding
    }),
    weeklyRhythm,
    sleep,
    weatherGrounding
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
