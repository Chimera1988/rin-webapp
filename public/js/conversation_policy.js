import { hasBlockingTurn } from './chat_store.js';

export function canGreet({ history = [], greetingActive = false, activeRequests = 0 } = {}) {
  return !greetingActive && activeRequests === 0 && history.length === 0;
}

export function canAutoInitiate({ history = [], greetingActive = false, activeRequests = 0 } = {}) {
  return !greetingActive && activeRequests === 0 && !hasBlockingTurn(history);
}

export function resolveInitiationPolicy(schedule = null) {
  if (!schedule || typeof schedule !== 'object') return null;
  const windows = Array.isArray(schedule.windows) ? schedule.windows : [];
  if (!windows.length || !schedule.timezone) return null;
  return {
    timezone: schedule.timezone,
    windows,
    maxPerDay: Math.max(0, Math.round(Number(schedule.maxDailyInitiations) || 0)),
    minimumSilenceMinutes: Math.max(15, Math.round(Number(schedule.minimumSilenceMinutes) || 45)),
    pollIntervalMs: Math.max(30_000, Math.round(Number(schedule.pollIntervalMs) || 60_000)),
    innerLife: schedule.innerLife || null,
    location: schedule.location || null
  };
}

export function isInsideWindow(localDate, window = {}) {
  if (!(localDate instanceof Date) || Number.isNaN(localDate.getTime())) return false;
  const from = String(window.from || '').split(':').map(Number);
  const to = String(window.to || '').split(':').map(Number);
  if (from.length !== 2 || to.length !== 2 || ![...from, ...to].every(Number.isFinite)) return false;
  const minute = localDate.getHours() * 60 + localDate.getMinutes();
  return minute >= from[0] * 60 + from[1] && minute <= to[0] * 60 + to[1];
}

export function activeInitiationWindow(localDate, policy = null) {
  if (!policy) return null;
  return policy.windows.find(window => isInsideWindow(localDate, window)) || null;
}

export function initiationWindowKey(window = {}) {
  const id = String(window.id || '').trim();
  return id || `${window.from || ''}-${window.to || ''}:${window.pool || 'day'}`;
}
