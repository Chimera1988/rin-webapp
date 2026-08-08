export const RIN_INTENT_SCHEMA = 'rin-persistent-intent-v2';
export const RIN_INTENT_STATUSES = new Set(['active', 'completed', 'cancelled', 'suspended']);

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};
const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};
function hash(value = '') {
  let h = 2166136261;
  for (const character of String(value)) {
    h ^= character.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function intentId(input = {}) {
  return `intent-${hash(`${clean(input.goal, 220)}|${clean(input.target, 220)}|${clean(input.scene, 100)}|${Number(input.startedAtTurn) || 0}`)}`;
}

export function normalizeRinIntent(input = null) {
  if (!input || typeof input !== 'object') return null;
  const goal = clean(input.goal, 300);
  if (!goal) return null;
  const status = RIN_INTENT_STATUSES.has(input.status) ? input.status : 'active';
  const startedAtTurn = Math.max(0, Math.round(Number(input.startedAtTurn) || 0));
  const updatedAtTurn = Math.max(startedAtTurn, Math.round(Number(input.updatedAtTurn) || startedAtTurn));
  const minTurns = clamp(input.minTurns, 1, 8, 2);
  const maxTurns = clamp(input.maxTurns, minTurns, 12, Math.max(4, minTurns));
  const turnCount = clamp(input.turnCount, 0, 20, 0);
  return {
    schema: RIN_INTENT_SCHEMA,
    id: clean(input.id, 120) || intentId({ ...input, goal, startedAtTurn }),
    status,
    goal,
    motive: clean(input.motive, 320) || 'собственный локальный интерес Рин',
    target: clean(input.target, 240) || 'current_scene',
    scene: clean(input.scene, 100) || 'everyday',
    priority: clamp(input.priority, 0, 100, 50),
    commitment: clamp(input.commitment, 0, 100, 55),
    progress: clamp01(input.progress, 0),
    nextMove: clean(input.nextMove, 260) || 'respond_personally',
    progressState: clean(input.progressState, 120) || 'started',
    expectedOutcome: clean(input.expectedOutcome, 360) || null,
    semanticKey: clean(input.semanticKey, 220) || clean(`${goal}|${input.target || 'current_scene'}|${input.scene || 'everyday'}`, 220).toLowerCase(),
    completionEvidence: clean(input.completionEvidence, 420) || null,
    completionCondition: clean(input.completionCondition, 420) || 'цель естественно достигнута',
    abandonmentCondition: clean(input.abandonmentCondition, 420) || 'пользователь явно отказался или контекст стал важнее',
    startedAtTurn,
    updatedAtTurn,
    turnCount,
    minTurns,
    maxTurns,
    source: clean(input.source, 100) || 'character_intent',
    reason: clean(input.reason, 420) || null,
    completionReason: clean(input.completionReason, 420) || null,
    replacementOf: clean(input.replacementOf, 120) || null
  };
}

export function isActiveRinIntent(input = null) {
  return normalizeRinIntent(input)?.status === 'active';
}
