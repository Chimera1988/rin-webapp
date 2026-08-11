export const INNER_LIFE_SCHEMA = 'rin-inner-life-v3';
export const INNER_LIFE_REALITY_MODES = new Set(['simulated_character_world', 'grounded']);

const clean = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 100, fallback = 50) => Math.max(min, Math.min(max, numberOr(value, fallback)));

export function normalizeInnerLife(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const realityMode = INNER_LIFE_REALITY_MODES.has(source.realityMode)
    ? source.realityMode
    : 'simulated_character_world';
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
    energy: clamp(source.energy, 0, 100, 60),
    startedAt: Math.max(0, numberOr(source.startedAt, 0)),
    expiresAt: Math.max(0, numberOr(source.expiresAt, 0)),
    lastChangedAt: Math.max(0, numberOr(source.lastChangedAt, source.startedAt || 0)),
    lastUserAt: Math.max(0, numberOr(source.lastUserAt, 0)),
    interactionCount: Math.max(0, Math.round(numberOr(source.interactionCount, 0))),
    recentActivities: (Array.isArray(source.recentActivities) ? source.recentActivities : [])
      .map(item => clean(item, 180))
      .filter(Boolean)
      .slice(-8)
  };
}
