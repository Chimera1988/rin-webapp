export const RIN_INTENT_SCHEMA = 'rin-persistent-intent-v5';
export const RIN_INTENT_STATUSES = new Set(['active', 'completed', 'cancelled', 'suspended']);
export const RIN_INTENT_KINDS = new Set(['achievement', 'maintenance']);
export const RIN_INTENT_PHASES = new Set(['started', 'advancing', 'sustain', 'wind_down', 'suspended', 'completed', 'cancelled']);

const MAINTENANCE_TARGETS = new Set([
  'playful_closeness',
  'mutual_flirt',
  'emotional_closeness',
  'warm_connection'
]);

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
  for (const character of String(value)) { h ^= character.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export function inferRinIntentKind(input = {}) {
  const explicit = clean(input?.kind, 40);
  if (RIN_INTENT_KINDS.has(explicit)) return explicit;
  const target = clean(input?.target, 160).toLowerCase();
  if (MAINTENANCE_TARGETS.has(target)) return 'maintenance';
  return 'achievement';
}

export function intentId(input = {}) {
  return `intent-${hash(`${clean(input.goal, 220)}|${clean(input.target, 220)}|${clean(input.scene, 100)}|${Number(input.startedAtTurn) || 0}`)}`;
}

function normalizedPhase(input = {}, { kind, status, progress, turnCount }) {
  const explicit = clean(input?.phase, 40);
  if (RIN_INTENT_PHASES.has(explicit)) return explicit;
  if (status === 'suspended') return 'suspended';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (kind === 'maintenance') return turnCount > 1 ? 'sustain' : 'started';
  if (Number(progress || 0) > 0.12) return 'advancing';
  return 'started';
}

export function normalizeRinIntent(input = null) {
  if (!input || typeof input !== 'object') return null;
  const goal = clean(input.goal, 300);
  if (!goal) return null;
  const status = RIN_INTENT_STATUSES.has(input.status) ? input.status : 'active';
  const kind = inferRinIntentKind(input);
  const startedAtTurn = Math.max(0, Math.round(Number(input.startedAtTurn) || 0));
  const updatedAtTurn = Math.max(startedAtTurn, Math.round(Number(input.updatedAtTurn) || startedAtTurn));
  const isTerminal = status === 'completed' || status === 'cancelled';
  const terminalAtTurn = Math.max(0, Math.round(Number(input.terminalAtTurn) || (isTerminal ? updatedAtTurn : 0)));
  const cooldownUntilTurn = Math.max(0, Math.round(Number(input.cooldownUntilTurn) || (terminalAtTurn ? terminalAtTurn + 10 : 0)));
  const minTurns = clamp(input.minTurns, 1, 8, 2);
  const legacyMaintenance = kind === 'maintenance' && clean(input.schema, 80) !== RIN_INTENT_SCHEMA;
  const defaultMaxTurns = kind === 'maintenance' ? 16 : Math.max(6, minTurns);
  let maxTurns = clamp(input.maxTurns, minTurns, 24, defaultMaxTurns);
  if (legacyMaintenance) maxTurns = Math.max(14, maxTurns);
  const turnCount = clamp(input.turnCount, 0, 40, 0);
  const progress = kind === 'maintenance'
    ? null
    : clamp01(input.progress, status === 'completed' ? 1 : 0);
  const engagement = clamp(input.engagement, 0, 100, clamp(input.commitment, 0, 100, 55));
  const saturation = clamp(input.saturation, 0, 100, 0);
  const phase = normalizedPhase(input, { kind, status, progress, turnCount });
  const id = clean(input.id, 120) || intentId({ ...input, goal, startedAtTurn });
  return {
    schema: RIN_INTENT_SCHEMA,
    id,
    rootId: clean(input.rootId, 120) || id,
    status,
    kind,
    phase,
    goal,
    motive: clean(input.motive, 320) || 'собственный локальный интерес Рин',
    target: clean(input.target, 240) || 'current_scene',
    sceneBinding: input.sceneBinding && typeof input.sceneBinding === 'object' ? {
      key: clean(input.sceneBinding.key, 220) || null,
      kind: clean(input.sceneBinding.kind, 100) || null,
      subject: clean(input.sceneBinding.subject, 320) || null,
      anchor: clean(input.sceneBinding.anchor, 420) || null,
      source: clean(input.sceneBinding.source, 100) || null
    } : null,
    scene: clean(input.scene, 100) || 'everyday',
    priority: clamp(input.priority, 0, 100, 50),
    commitment: clamp(input.commitment, 0, 100, 55),
    progress,
    engagement,
    saturation,
    nextMove: clean(input.nextMove, 260) || 'respond_personally',
    progressState: clean(input.progressState, 120) || (kind === 'maintenance' ? 'sustained' : 'started'),
    expectedOutcome: clean(input.expectedOutcome, 360) || null,
    semanticKey: clean(input.semanticKey, 220) || clean(`${goal}|${input.target || 'current_scene'}|${input.scene || 'everyday'}`, 220).toLowerCase(),
    completionEvidence: clean(input.completionEvidence, 420) || null,
    completionCondition: clean(input.completionCondition, 420) || (kind === 'maintenance'
      ? 'сцена естественно сменилась, взаимность снизилась или линия завершилась сама'
      : 'цель естественно достигнута'),
    abandonmentCondition: clean(input.abandonmentCondition, 420) || 'пользователь явно отказался или контекст стал важнее',
    startedAtTurn,
    updatedAtTurn,
    terminalAtTurn,
    cooldownUntilTurn,
    turnCount,
    minTurns,
    maxTurns,
    source: clean(input.source, 100) || 'rin_mind_v2',
    reason: clean(input.reason, 420) || null,
    completionReason: clean(input.completionReason, 420) || null,
    replacementOf: clean(input.replacementOf, 120) || null
  };
}

export function isActiveRinIntent(input = null) { return normalizeRinIntent(input)?.status === 'active'; }
export function isTerminalRinIntent(input = null) { return ['completed', 'cancelled'].includes(normalizeRinIntent(input)?.status); }
