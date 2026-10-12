// Deterministic elapsed-time context for a new semantic turn.
// No inference about where the user was or whether a planned action happened.
const DAY_MS = 86_400_000;
const MIN_VALID_TS = Date.UTC(2020, 0, 1);
const MAX_FUTURE_MS = 2 * 60_000;
const CALLBACK = /(?:^|[\s,.!?])(?:продолжим|верн[её]мся|вернись|на\s+ч[её]м\s+(?:мы\s+)?остановились|как\s+(?:мы|ты)\s+(?:говорили|обсуждали)|помнишь|насч[её]т|к\s+тому\s+разговору|про\s+тот\s+разговор|обещал(?:а)?\s+(?:тебе|мне)|как\s+и\s+договаривались)(?=$|[\s,.!?])/iu;

function validTs(value, now) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts >= MIN_VALID_TS && ts <= now + MAX_FUTURE_MS ? ts : null;
}
function localParts(ts, timezone) {
  if (ts == null) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(ts);
    const obj = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const hour = Number(obj.hour);
    return { date: `${obj.year}-${obj.month}-${obj.day}`, at: `${obj.year}-${obj.month}-${obj.day} ${obj.hour}:${obj.minute}`,
      period: hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 23 ? 'evening' : 'night' };
  } catch {
    if (timezone !== 'Europe/Moscow') return localParts(ts, 'Europe/Moscow');
    return null; // Unavailable ICU timezone data: do not fabricate a local timestamp.
  }
}

export function formatRinEventTime(ts, timezone = 'Europe/Moscow') {
  const valid = validTs(ts, Date.now());
  return valid == null ? null : localParts(valid, timezone)?.at || null;
}

export const isTemporalCallback = (text = '') => CALLBACK.test(String(text || ''));

export function inspectTemporalContinuity({ history = [], requestId = '', now = Date.now(), timezone = 'Europe/Moscow', userText = '' } = {}) {
  const currentTime = validTs(now, now) || Date.now();
  const entries = (Array.isArray(history) ? history : [])
    .filter(item => ['assistant', 'user'].includes(item?.role))
    .filter(item => ['complete', 'sent'].includes(item?.status || 'complete'))
    .filter(item => !(requestId && item?.role === 'user' && item?.requestId === requestId))
    .map(item => ({ role: item.role, ts: validTs(item.ts, currentTime) }))
    .filter(item => item.ts != null && item.ts <= currentTime)
    .sort((a, b) => a.ts - b.ts);
  const last = entries.at(-1) || null;
  const lastUser = [...entries].reverse().find(item => item.role === 'user') || null;
  const lastRin = [...entries].reverse().find(item => item.role === 'assistant') || null;
  const minutesSince = item => item ? Math.max(0, Math.floor((currentTime - item.ts) / 60_000)) : null;
  const gapMinutes = minutesSince(last);
  const current = localParts(currentTime, timezone);
  const previous = localParts(last?.ts ?? null, timezone);
  const dayChanged = Boolean(previous && current && previous.date !== current.date);
  const periodShift = previous && current && previous.period !== current.period ? `${previous.period}->${current.period}` : 'none';
  const resumed = gapMinutes != null && gapMinutes >= 45;
  const tier = dayChanged ? 'new_day' : gapMinutes == null ? 'unknown' : gapMinutes >= 120 ? 'long' : resumed ? 'pause' : 'continuous';
  return {
    gapMinutes, userGapMinutes: minutesSince(lastUser), rinGapMinutes: minutesSince(lastRin),
    resumed, tier, dayChanged, periodShift, nowLocal: current?.at || null,
    lastLocal: previous?.at || null, lastRole: last?.role || null,
    explicitCallback: isTemporalCallback(userText)
  };
}

export function temporalSceneWeight(messageTs, nowTs) {
  const time = validTs(nowTs, nowTs);
  const event = time == null ? null : validTs(messageTs, time);
  if (time == null || event == null || event > time) return 1;
  const hours = Math.max(0, (time - event) / (60 * 60_000));
  return hours < 0.5 ? 1 : Math.max(0.16, 1 / (1 + (hours - 0.5) * 0.32));
}
