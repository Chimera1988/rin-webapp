import { hasBlockingTurn } from './chat_store.js';

export function canGreet({ history = [], greetingActive = false, activeRequests = 0 } = {}) {
  return !greetingActive && activeRequests === 0 && history.length === 0;
}

export function canAutoInitiate({ profile = null, history = [], greetingActive = false, activeRequests = 0 } = {}) {
  return Boolean(profile) && !greetingActive && activeRequests === 0 && !hasBlockingTurn(history);
}

export function resolveInitiationPolicy(profile = {}, defaults = {}) {
  const configured = profile?.initiation && typeof profile.initiation === 'object'
    ? profile.initiation
    : null;
  const maxCandidate = configured && Object.hasOwn(configured, 'max_per_day')
    ? Number(configured.max_per_day)
    : Number(defaults?.max_daily_initiations ?? 2);
  return {
    maxPerDay: Math.max(0, Number.isFinite(maxCandidate) ? Math.round(maxCandidate) : 2),
    windows: configured && Array.isArray(configured.windows)
      ? configured.windows
      : Array.isArray(defaults?.windows) ? defaults.windows : [],
    minimumSilenceMinutes: Math.max(15, Number(defaults?.minimum_silence_minutes || 45))
  };
}
