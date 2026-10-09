const clamp = (value, min, max, fallback = min) => {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, number));
};

const clean = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function hashNumber(value = '') {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

export function clockMinute(value = '') {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function parseRinLocal(env = {}, now = Date.now()) {
  const raw = String(env?.rinHuman || '');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/);
  if (match) {
    const dateKey = match[1];
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return { dateKey, hour, minute, minuteOfDay: hour * 60 + minute, weekday, now };
  }
  const date = new Date(now);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    dateKey,
    hour: date.getHours(),
    minute: date.getMinutes(),
    minuteOfDay: date.getHours() * 60 + date.getMinutes(),
    weekday: date.getDay(),
    now
  };
}

export function shiftDateKey(dateKey, days = 0) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

export function weekdayForDateKey(dateKey) {
  const value = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return Number.isFinite(value) ? value : 1;
}

function normalizeRange(range = {}, fallbackFrom = '00:00', fallbackTo = '00:00') {
  const from = clockMinute(range?.from) ?? clockMinute(fallbackFrom) ?? 0;
  let to = clockMinute(range?.to) ?? clockMinute(fallbackTo) ?? from;
  if (to < from) to += 24 * 60;
  return { from, to };
}

function targetInRange(dateKey, range = {}, seed = '', fallbackFrom = '00:00', fallbackTo = '00:00') {
  const normalized = normalizeRange(range, fallbackFrom, fallbackTo);
  const span = Math.max(0, normalized.to - normalized.from);
  const offset = span ? hashNumber(`${dateKey}|${seed}`) % (span + 1) : 0;
  const totalMinute = normalized.from + offset;
  return {
    dateKey: shiftDateKey(dateKey, Math.floor(totalMinute / (24 * 60))),
    minute: totalMinute % (24 * 60)
  };
}

function dayDistance(fromDateKey, toDateKey) {
  const from = new Date(`${fromDateKey}T00:00:00Z`).getTime();
  const to = new Date(`${toDateKey}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000);
}

function epochForLocalTarget(local, target, now) {
  const diffDays = dayDistance(local.dateKey, target.dateKey);
  const diffMinutes = diffDays * 1440 + target.minute - local.minuteOfDay;
  return now + diffMinutes * 60000;
}

export function dayTypeForWeekday(weekday = 1, policy = {}) {
  const weekend = new Set(Array.isArray(policy?.weeklyRhythm?.weekendDays) ? policy.weeklyRhythm.weekendDays : [0, 6]);
  if (!weekend.has(Number(weekday))) return 'weekday';
  return Number(weekday) === 6 ? 'saturday' : 'sunday';
}

export function dayProfileForDate(dateKey, policy = {}) {
  const weekday = weekdayForDateKey(dateKey);
  const dayType = dayTypeForWeekday(weekday, policy);
  const profiles = policy?.weeklyRhythm?.profiles || {};
  return {
    weekday,
    dayType,
    profile: profiles[dayType] || profiles.weekday || {}
  };
}

export function classifyWeather(weather = null) {
  const desc = clean(weather?.desc, 120).toLowerCase();
  const temp = Number(weather?.temp);
  if (!desc && !Number.isFinite(temp)) return { kind: 'unknown', outdoor: 'unknown', reason: null };
  if (/(гроза|шторм|ураган|ливень|сильн[^ ]*\s+дожд|thunder|storm|heavy rain)/iu.test(desc)) {
    return { kind: 'severe', outdoor: 'avoid', reason: desc || 'непогода' };
  }
  if (/(дожд|морос|снег|метел|rain|drizzle|snow)/iu.test(desc)) {
    return { kind: 'precipitation', outdoor: 'adapt', reason: desc || 'осадки' };
  }
  if (Number.isFinite(temp) && temp >= 32) return { kind: 'hot', outdoor: 'adapt', reason: `${Math.round(temp)}°C` };
  if (Number.isFinite(temp) && temp <= 0) return { kind: 'cold', outdoor: 'adapt', reason: `${Math.round(temp)}°C` };
  return { kind: 'mild', outdoor: 'normal', reason: desc || (Number.isFinite(temp) ? `${Math.round(temp)}°C` : null) };
}

export function resolveDailyRhythm(env = {}, policy = {}, currentInput = {}, now = Date.now(), hasUserMessage = false) {
  const current = currentInput && typeof currentInput === 'object' ? currentInput : {};
  const local = parseRinLocal(env, now);
  const currentDay = dayProfileForDate(local.dateKey, policy);
  const nextCycleDate = local.minuteOfDay >= 18 * 60 ? shiftDateKey(local.dateKey, 1) : local.dateKey;
  const cycleWake = dayProfileForDate(nextCycleDate, policy);
  const cycleSleepDate = shiftDateKey(nextCycleDate, -1);
  const cycleSleep = dayProfileForDate(cycleSleepDate, policy);

  const sleepTarget = targetInRange(cycleSleepDate, cycleSleep.profile?.sleepWindow, 'sleep', '23:30', '00:30');
  const wakeTarget = targetInRange(nextCycleDate, cycleWake.profile?.wakeWindow, 'wake', '06:45', '07:30');
  const plannedSleepAt = epochForLocalTarget(local, sleepTarget, now);
  const plannedWakeAt = epochForLocalTarget(local, wakeTarget, now);
  const sleepCfg = policy?.sleep || {};
  const continuityGraceMinutes = clamp(sleepCfg.continuityGraceMinutes, 10, 120, 30);
  const settleAfterChatMinutes = clamp(sleepCfg.settleAfterChatMinutes, 5, 90, 18);
  const windingDownMinutes = clamp(sleepCfg.windingDownMinutes, 20, 180, 60);
  const drowsyMinutes = clamp(sleepCfg.drowsyMinutes, 5, 90, 20);
  const targetSleepMinutes = clamp(sleepCfg.targetSleepMinutes, 360, 600, 450);
  const maxDebtMinutes = clamp(sleepCfg.maxDebtMinutes, 60, 720, 300);

  const sameCycle = String(current.sleepCycle || '') === nextCycleDate;
  const previousLastUserAt = Number(current.lastUserAt || 0);
  const gapMinutes = previousLastUserAt > 0 ? Math.max(0, now - previousLastUserAt) / 60000 : Infinity;
  const continuousConversation = hasUserMessage && gapMinutes <= continuityGraceMinutes;

  let phase = sameCycle ? clean(current.sleepPhase, 40) || 'awake' : 'awake';
  let sleepStartedAt = sameCycle ? Number(current.sleepStartedAt || 0) : 0;
  let lastWakeAt = Number(current.lastWakeAt || 0);
  let lastSleepMinutes = Number(current.lastSleepMinutes || 0);
  let sleepDebtMinutes = Number(current.sleepDebtMinutes || 0);
  let interruptions = sameCycle ? Math.max(0, Number(current.sleepInterruptions || 0)) : 0;
  let lateConversationMinutes = sameCycle ? Math.max(0, Number(current.lateConversationMinutes || 0)) : 0;
  let wakeReason = sameCycle ? clean(current.wakeReason, 40) || 'routine' : 'routine';

  const inSleepInterval = now >= plannedSleepAt && now < plannedWakeAt;
  const afterWake = now >= plannedWakeAt;
  const beforeSleep = now < plannedSleepAt;
  const previousContactPushedSleep = previousLastUserAt > plannedSleepAt && previousLastUserAt < plannedWakeAt
    ? previousLastUserAt + settleAfterChatMinutes * 60000
    : plannedSleepAt;
  const inferredSleepStart = Math.min(plannedWakeAt, Math.max(plannedSleepAt, previousContactPushedSleep));

  if (inSleepInterval) {
    if (continuousConversation && ['interrupted_sleep', 'drowsy', 'winding_down'].includes(phase)) {
      phase = phase === 'interrupted_sleep' ? 'interrupted_sleep' : 'drowsy';
      lateConversationMinutes = Math.max(lateConversationMinutes, Math.round(Math.max(0, now - plannedSleepAt) / 60000));
    } else if (hasUserMessage) {
      if (!sleepStartedAt) sleepStartedAt = inferredSleepStart;
      const wasAlreadyInterrupted = sameCycle && current.sleepPhase === 'interrupted_sleep' && gapMinutes <= continuityGraceMinutes;
      if (!wasAlreadyInterrupted) interruptions += 1;
      // A fresh/repeated wake-up must reflect the current clock immediately. Previously
      // lateConversationMinutes advanced only on the *next* message because the first
      // interrupted turn took this branch instead of the continuous-conversation branch.
      lateConversationMinutes = Math.max(lateConversationMinutes, Math.round(Math.max(0, now - plannedSleepAt) / 60000));
      phase = 'interrupted_sleep';
      wakeReason = 'kirill_message';
      lastWakeAt = now;
    } else {
      if (!sleepStartedAt) sleepStartedAt = inferredSleepStart;
      phase = 'sleeping';
    }
  } else if (afterWake) {
    if (!sleepStartedAt && plannedSleepAt < plannedWakeAt) sleepStartedAt = inferredSleepStart;
    if (sleepStartedAt > 0 && sleepStartedAt < plannedWakeAt) {
      let awakePenaltyMinutes = 0;
      if (wakeReason === 'kirill_message' && lastWakeAt > sleepStartedAt && lastWakeAt < plannedWakeAt) {
        const latestNightContact = Math.max(lastWakeAt, Math.min(previousLastUserAt || lastWakeAt, plannedWakeAt));
        const resumedSleepAt = Math.min(plannedWakeAt, latestNightContact + settleAfterChatMinutes * 60000);
        awakePenaltyMinutes = Math.max(0, Math.round((resumedSleepAt - lastWakeAt) / 60000));
      }
      const grossSleepMinutes = Math.max(0, Math.round((plannedWakeAt - sleepStartedAt) / 60000));
      lastSleepMinutes = Math.max(0, grossSleepMinutes - awakePenaltyMinutes);
      const deficit = Math.max(0, targetSleepMinutes - lastSleepMinutes);
      sleepDebtMinutes = Math.round(clamp(sleepDebtMinutes * 0.45 + deficit + interruptions * 8, 0, maxDebtMinutes, 0));
    } else {
      sleepDebtMinutes = Math.round(clamp(sleepDebtMinutes * 0.65, 0, maxDebtMinutes, 0));
    }
    if (now - plannedWakeAt <= 35 * 60000) {
      phase = 'waking';
      if (wakeReason !== 'kirill_message') wakeReason = 'routine';
      lastWakeAt = lastWakeAt || plannedWakeAt;
    } else {
      phase = 'awake';
      if (wakeReason !== 'kirill_message' || lastWakeAt < plannedWakeAt - 3 * 3600000) wakeReason = 'routine';
      lastWakeAt = lastWakeAt || plannedWakeAt;
    }
  } else if (beforeSleep) {
    const untilSleepMinutes = Math.round((plannedSleepAt - now) / 60000);
    if (untilSleepMinutes <= drowsyMinutes) phase = 'drowsy';
    else if (untilSleepMinutes <= windingDownMinutes) phase = 'winding_down';
    else phase = 'awake';
  }

  if (hasUserMessage && now >= plannedSleepAt && now < plannedWakeAt && phase === 'drowsy') {
    lateConversationMinutes = Math.max(lateConversationMinutes, Math.round(Math.max(0, now - plannedSleepAt) / 60000));
  }

  const profile = currentDay.profile || {};
  const weather = classifyWeather(env?.weather);
  const workday = currentDay.dayType === 'weekday';
  const workMode = workday ? 'normal' : 'off';
  const sleepCarryover = lateConversationMinutes >= 20
    ? `разговор с Кириллом продолжался примерно на ${lateConversationMinutes} мин позже обычного времени сна; это может ощущаться утром, при этом Рин сама участвовала в решении не заканчивать разговор`
    : interruptions > 0
      ? `ночью сон был прерван сообщением Кирилла; это может ощущаться утром, но не означает желание оттолкнуть его`
      : '';

  return {
    local,
    dayType: currentDay.dayType,
    dayOfWeek: currentDay.weekday,
    workday,
    workMode,
    profile,
    weather,
    sleep: {
      cycle: nextCycleDate,
      phase,
      plannedSleepAt,
      plannedWakeAt,
      sleepStartedAt,
      lastWakeAt,
      lastSleepMinutes,
      sleepDebtMinutes,
      interruptions,
      lateConversationMinutes,
      wakeReason,
      carryover: sleepCarryover,
      continuityGraceMinutes
    }
  };
}

function inClockWindow(minuteOfDay, window = {}) {
  const from = clockMinute(window?.from);
  const to = clockMinute(window?.to);
  if (from == null || to == null) return false;
  return minuteOfDay >= from && minuteOfDay < to;
}

export function activityPeriod(rhythm = {}) {
  const phase = rhythm?.sleep?.phase || 'awake';
  if (phase === 'sleeping') return 'sleeping';
  if (phase === 'interrupted_sleep') return 'interrupted_sleep';
  if (phase === 'waking') return 'waking';
  if (phase === 'winding_down' || phase === 'drowsy') return 'winddown';

  const minute = rhythm?.local?.minuteOfDay ?? 12 * 60;
  const profile = rhythm?.profile || {};
  if (rhythm?.dayType !== 'weekday') {
    if (minute < 11 * 60) return 'weekend_morning';
    if (minute < 18 * 60) return 'weekend_day';
    if (minute < 23 * 60 + 15) return 'weekend_evening';
    return 'winddown';
  }

  if (inClockWindow(minute, profile.workBlocks?.[0])) return 'work_morning';
  if (inClockWindow(minute, profile.middayWindow)) return 'midday';
  if (inClockWindow(minute, profile.workBlocks?.[1])) return 'work_afternoon';
  if (inClockWindow(minute, profile.eveningTransition)) return 'evening_transition';
  if (inClockWindow(minute, profile.freeEvening)) return 'free_evening';
  const morningUntil = clockMinute(profile.morningPersonalUntil || '08:00') ?? 8 * 60;
  if (minute < morningUntil) return 'morning_personal';
  return minute >= 23 * 60 ? 'winddown' : 'free_evening';
}
