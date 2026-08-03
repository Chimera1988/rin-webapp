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

export function chooseConfiguredStarter(profile = {}, random = Math.random) {
  const starters = Array.isArray(profile?.starters)
    ? profile.starters.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (!starters.length) return null;
  const index = Math.min(starters.length - 1, Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * starters.length));
  return starters[index];
}
