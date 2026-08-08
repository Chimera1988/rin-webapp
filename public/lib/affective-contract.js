export const AFFECTIVE_STATE_SCHEMA = 'rin-affective-state-v1';
export const AFFECTIVE_TURN_SCHEMA = 'rin-affective-turn-v1';
export const RELATIONSHIP_STATE_SCHEMA = 'rin-relationship-state-v2';

export const EMOTION_TYPES = new Set([
  'neutral', 'interest', 'warmth', 'joy', 'tenderness', 'playfulness', 'shyness',
  'jealousy', 'playful_irritation', 'hurt', 'irritation', 'concern', 'relief',
  'sadness', 'frustration', 'disappointment', 'gratitude', 'hope', 'fatigue'
]);

export const EMOTION_RESOLUTIONS = new Set(['unresolved', 'softening', 'sustained', 'resolved']);
export const EMOTION_TARGETS = new Set(['user', 'relationship', 'self', 'situation', 'other']);
export const MOMENTUM_DIRECTIONS = new Set(['steady', 'warming', 'playful', 'tense', 'cooling', 'repairing']);

export const clampScore = (value, min = 0, max = 100, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

export const cleanAffectiveText = (value, max = 500) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function defaultRelationshipState(now = Date.now()) {
  return {
    schema: RELATIONSHIP_STATE_SCHEMA,
    trust: 55,
    closeness: 42,
    comfort: 52,
    respect: 68,
    playfulness: 45,
    attraction: 34,
    vulnerability: 28,
    stage: 'растущее доверие',
    recentDynamic: {
      lastSignal: 'neutral',
      positiveStreak: 0,
      negativeStreak: 0,
      repairPending: false,
      lastCause: '',
      turn: 0
    },
    sharedMoments: [],
    lastInteractionAt: now,
    updatedAt: now
  };
}

export function relationshipStage(value = {}) {
  const closeness = clampScore(value.closeness, 0, 100, 42);
  const trust = clampScore(value.trust, 0, 100, 55);
  if (closeness >= 82 && trust >= 80) return 'глубокая устойчивая близость';
  if (closeness >= 66 && trust >= 65) return 'сформировавшаяся близость';
  if (closeness >= 48 && trust >= 50) return 'растущее доверие';
  if (closeness >= 30) return 'осторожное сближение';
  return 'начало знакомства';
}

export function normalizeRelationshipState(input = {}, now = Date.now()) {
  const defaults = defaultRelationshipState(now);
  const source = input && typeof input === 'object' ? input : {};
  const dynamic = source.recentDynamic && typeof source.recentDynamic === 'object' ? source.recentDynamic : {};
  const state = {
    ...defaults,
    ...source,
    schema: RELATIONSHIP_STATE_SCHEMA,
    trust: clampScore(source.trust, 0, 100, defaults.trust),
    closeness: clampScore(source.closeness, 0, 100, defaults.closeness),
    comfort: clampScore(source.comfort, 0, 100, defaults.comfort),
    respect: clampScore(source.respect, 0, 100, defaults.respect),
    playfulness: clampScore(source.playfulness, 0, 100, defaults.playfulness),
    attraction: clampScore(source.attraction, 0, 100, defaults.attraction),
    vulnerability: clampScore(source.vulnerability, 0, 100, defaults.vulnerability),
    recentDynamic: {
      lastSignal: cleanAffectiveText(dynamic.lastSignal, 60) || 'neutral',
      positiveStreak: clampScore(dynamic.positiveStreak, 0, 20, 0),
      negativeStreak: clampScore(dynamic.negativeStreak, 0, 20, 0),
      repairPending: Boolean(dynamic.repairPending),
      lastCause: cleanAffectiveText(dynamic.lastCause, 320),
      turn: Math.max(0, Math.round(finite(dynamic.turn, 0)))
    },
    sharedMoments: Array.isArray(source.sharedMoments) ? source.sharedMoments.slice(-20) : [],
    lastInteractionAt: finite(source.lastInteractionAt, now),
    updatedAt: finite(source.updatedAt, now)
  };
  state.stage = cleanAffectiveText(source.stage, 60) || relationshipStage(state);
  return state;
}

export function normalizeEmotionEvent(input = null) {
  if (!input || typeof input !== 'object') return null;
  const rawType = cleanAffectiveText(input.type || input.emotion, 80).toLowerCase();
  const type = EMOTION_TYPES.has(rawType) ? rawType : (rawType ? 'interest' : 'neutral');
  if (type === 'neutral' && !cleanAffectiveText(input.cause, 500)) return null;
  const expiresAfterTurns = clampScore(input.expiresAfterTurns ?? input.remainingTurns ?? 4, 1, 20, 4);
  const remainingTurns = clampScore(input.remainingTurns ?? expiresAfterTurns, 0, 20, expiresAfterTurns);
  const resolution = EMOTION_RESOLUTIONS.has(input.resolution) ? input.resolution : 'unresolved';
  return {
    type,
    cause: cleanAffectiveText(input.cause, 500),
    target: EMOTION_TARGETS.has(input.target) ? input.target : 'situation',
    intensity: clampScore(input.intensity, 0, 100, 40),
    valence: clampScore(input.valence, -100, 100, 0),
    arousal: clampScore(input.arousal, 0, 100, 45),
    startedAtTurn: Math.max(0, Math.round(finite(input.startedAtTurn, 0))),
    expiresAfterTurns,
    remainingTurns,
    resolution,
    source: cleanAffectiveText(input.source, 80) || 'dialogue'
  };
}

export function defaultEmotionalState({ relationship = null, mood = null } = {}) {
  const rel = normalizeRelationshipState(relationship || {}, Date.now());
  const affection = clampScore(mood?.affection, 0, 100, 65);
  return {
    schema: AFFECTIVE_STATE_SCHEMA,
    primary: null,
    secondary: null,
    tension: 0,
    warmth: clampScore(affection * 0.55 + rel.closeness * 0.25 + rel.comfort * 0.2, 0, 100, 55),
    vulnerability: clampScore(rel.vulnerability, 0, 100, 28),
    momentum: { direction: 'steady', strength: 0 },
    lastEvent: null,
    updatedAtTurn: 0
  };
}

export function normalizeEmotionalState(input = {}, context = {}) {
  const defaults = defaultEmotionalState(context);
  const source = input && typeof input === 'object' ? input : {};
  const momentum = source.momentum && typeof source.momentum === 'object' ? source.momentum : {};
  const lastEvent = source.lastEvent && typeof source.lastEvent === 'object' ? source.lastEvent : null;
  return {
    ...defaults,
    ...source,
    schema: AFFECTIVE_STATE_SCHEMA,
    primary: normalizeEmotionEvent(source.primary),
    secondary: normalizeEmotionEvent(source.secondary),
    tension: clampScore(source.tension, 0, 100, defaults.tension),
    warmth: clampScore(source.warmth, 0, 100, defaults.warmth),
    vulnerability: clampScore(source.vulnerability, 0, 100, defaults.vulnerability),
    momentum: {
      direction: MOMENTUM_DIRECTIONS.has(momentum.direction) ? momentum.direction : 'steady',
      strength: clampScore(momentum.strength, 0, 100, 0)
    },
    lastEvent: lastEvent ? {
      type: cleanAffectiveText(lastEvent.type, 80) || 'neutral',
      cause: cleanAffectiveText(lastEvent.cause, 500),
      turn: Math.max(0, Math.round(finite(lastEvent.turn, 0)))
    } : null,
    updatedAtTurn: Math.max(0, Math.round(finite(source.updatedAtTurn, 0)))
  };
}

export function emotionalStateFromLegacyTrace(trace = null, context = {}) {
  if (!trace || typeof trace !== 'object') return normalizeEmotionalState({}, context);
  const map = {
    mild_jealousy: 'jealousy', jealousy: 'jealousy',
    'тёплое смущение': 'shyness', 'тёплая радость': 'joy',
    'близость и ответное тепло': 'tenderness', 'игривое оживление': 'playfulness',
    'внимательное беспокойство о связи': 'concern', 'мягкое тепло': 'warmth',
    disappointment: 'disappointment', annoyance: 'irritation', focused: 'interest'
  };
  const raw = cleanAffectiveText(trace.emotion, 80);
  const type = map[raw] || map[raw.toLowerCase()] || (EMOTION_TYPES.has(raw.toLowerCase()) ? raw.toLowerCase() : 'interest');
  return normalizeEmotionalState({
    primary: {
      type,
      cause: trace.cause,
      intensity: trace.intensity,
      resolution: trace.resolution,
      expiresAfterTurns: trace.expiresAfterTurns,
      remainingTurns: trace.remainingTurns ?? trace.expiresAfterTurns,
      target: type === 'jealousy' || type === 'hurt' ? 'relationship' : 'situation'
    },
    tension: ['jealousy', 'hurt', 'irritation', 'disappointment'].includes(type) ? Math.min(60, Number(trace.intensity) || 35) : 0,
    momentum: { direction: ['jealousy', 'hurt', 'irritation', 'disappointment'].includes(type) ? 'tense' : 'steady', strength: Number(trace.intensity) || 35 }
  }, context);
}
