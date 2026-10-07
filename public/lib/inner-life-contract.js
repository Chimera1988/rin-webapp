export const INNER_LIFE_SCHEMA = 'rin-inner-life-v5';
export const INNER_LIFE_REALITY_MODES = new Set(['simulated_character_world', 'grounded']);
export const INNER_LIFE_SLEEP_PHASES = new Set(['awake', 'winding_down', 'drowsy', 'sleeping', 'interrupted_sleep', 'waking']);
export const INNER_LIFE_WORK_MODES = new Set(['normal', 'off', 'exception']);
export const INNER_LIFE_ACTIVITY_SETTINGS = new Set(['unknown', 'indoor', 'outdoor', 'mixed']);
export const INNER_LIFE_WAKE_REASONS = new Set(['routine', 'kirill_message', 'natural_early', 'unknown']);

const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 100, fallback = 50) => Math.max(min, Math.min(max, numberOr(value, fallback)));

export function normalizeInnerLife(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const realityMode = INNER_LIFE_REALITY_MODES.has(source.realityMode)
    ? source.realityMode
    : 'simulated_character_world';
  const sleepPhase = INNER_LIFE_SLEEP_PHASES.has(source.sleepPhase) ? source.sleepPhase : 'awake';
  const workMode = INNER_LIFE_WORK_MODES.has(source.workMode) ? source.workMode : 'normal';
  const activitySetting = INNER_LIFE_ACTIVITY_SETTINGS.has(source.activitySetting) ? source.activitySetting : 'unknown';
  const wakeReason = INNER_LIFE_WAKE_REASONS.has(source.wakeReason) ? source.wakeReason : 'unknown';
  return {
    schema: INNER_LIFE_SCHEMA,
    realityMode,
    source: clean(source.source, 80) || 'persisted_simulation',
    sceneId: clean(source.sceneId, 120) || null,
    activity: clean(source.activity, 180),
    trace: clean(source.trace, 220),
    focus: clean(source.focus, 220),
    activityGoal: clean(source.activityGoal, 220),
    part: clean(source.part, 30),
    dayType: clean(source.dayType, 24) || 'weekday',
    dayOfWeek: Math.max(0, Math.min(6, Math.round(numberOr(source.dayOfWeek, 1)))),
    workday: source.workday !== false,
    workMode,
    activitySetting,
    weatherGrounded: source.weatherGrounded === true,
    weatherContext: clean(source.weatherContext, 220),
    energy: clamp(source.energy, 0, 100, 60),
    mentalLoad: clamp(source.mentalLoad, 0, 100, 42),
    needForQuiet: clamp(source.needForQuiet, 0, 100, 35),
    desireToShare: clamp(source.desireToShare, 0, 100, 48),
    unfinishedThought: clean(source.unfinishedThought, 260),
    carryover: clean(source.carryover, 320),
    sleepPhase,
    sleepCycle: clean(source.sleepCycle, 16),
    plannedSleepAt: Math.max(0, numberOr(source.plannedSleepAt, 0)),
    plannedWakeAt: Math.max(0, numberOr(source.plannedWakeAt, 0)),
    sleepStartedAt: Math.max(0, numberOr(source.sleepStartedAt, 0)),
    lastWakeAt: Math.max(0, numberOr(source.lastWakeAt, 0)),
    lastSleepMinutes: Math.max(0, Math.round(numberOr(source.lastSleepMinutes, 0))),
    sleepDebtMinutes: Math.max(0, Math.round(numberOr(source.sleepDebtMinutes, 0))),
    sleepInterruptions: Math.max(0, Math.round(numberOr(source.sleepInterruptions, 0))),
    lateConversationMinutes: Math.max(0, Math.round(numberOr(source.lateConversationMinutes, 0))),
    wakeReason,
    sleepCarryover: clean(source.sleepCarryover, 360),
    startedAt: Math.max(0, numberOr(source.startedAt, 0)),
    expiresAt: Math.max(0, numberOr(source.expiresAt, 0)),
    lastChangedAt: Math.max(0, numberOr(source.lastChangedAt, source.startedAt || 0)),
    lastStateAt: Math.max(0, numberOr(source.lastStateAt, source.lastChangedAt || source.startedAt || 0)),
    lastUserAt: Math.max(0, numberOr(source.lastUserAt, 0)),
    interactionCount: Math.max(0, Math.round(numberOr(source.interactionCount, 0))),
    recentActivities: (Array.isArray(source.recentActivities) ? source.recentActivities : [])
      .map(item => clean(item, 180))
      .filter(Boolean)
      .slice(-8)
  };
}
