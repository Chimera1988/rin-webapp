import { normalizeEmotionalState, normalizeRelationshipState } from '../affective-contract.js';
export const COGNITIVE_SCHEMA = 'rin-cognition-v1';
export const RESPONSE_PLAN_SCHEMA = 'rin-response-plan-v1';
export const STATE_TRANSITION_SCHEMA = 'rin-state-transition-v2';

export const BELIEF_KINDS = new Set([
  'fact',
  'user_statement',
  'rin_opinion',
  'hypothesis',
  'temporary_state',
  'unknown'
]);

export const OPEN_LOOP_STATUSES = new Set([
  'active',
  'waiting_for_user',
  'waiting_for_rin',
  'resolved',
  'cancelled',
  'stale'
]);
export const RESPONSE_DELIVERIES = new Set(['text', 'sticker_only', 'before_text', 'after_text', 'silence']);


export const clamp = (value, min = 0, max = 100, fallback = min) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

export const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

export const cleanText = (value, max = 500) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

export const cleanReplyText = (value, max = 8000) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\t\f\v ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, max);

export const uniqueStrings = (value, max = 12, itemMax = 500) => [...new Set(
  (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, itemMax))
    .filter(Boolean)
)].slice(0, max);

export function stableHash(value = '') {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function cognitiveId(prefix, value = '') {
  return `${prefix}-${stableHash(cleanText(value, 1800).toLowerCase())}`;
}

export function normalizeBelief(input = {}) {
  const kind = BELIEF_KINDS.has(input.kind) ? input.kind : 'unknown';
  const subject = cleanText(input.subject, 120) || 'unknown';
  const predicate = cleanText(input.predicate, 160) || 'unknown';
  const value = cleanText(input.value, 700);
  const source = cleanText(input.source, 120) || 'unknown';
  const status = ['current', 'historical', 'superseded', 'uncertain'].includes(input.status)
    ? input.status
    : (kind === 'unknown' ? 'uncertain' : 'current');
  const key = `${subject}:${predicate}:${value}`;
  return {
    id: cleanText(input.id, 120) || cognitiveId('belief', key),
    kind,
    subject,
    predicate,
    value,
    source,
    confidence: clamp01(input.confidence, kind === 'fact' ? 1 : 0.65),
    status,
    validFrom: Number.isFinite(Number(input.validFrom)) ? Number(input.validFrom) : null,
    validUntil: Number.isFinite(Number(input.validUntil)) ? Number(input.validUntil) : null,
    evidence: uniqueStrings(input.evidence, 4, 280)
  };
}

export function normalizeOpenLoop(input = {}) {
  const subject = cleanText(input.subject || input.text, 420);
  const status = OPEN_LOOP_STATUSES.has(input.status) ? input.status : 'active';
  return {
    id: cleanText(input.id, 120) || cognitiveId('loop', subject),
    type: cleanText(input.type, 80) || 'topic',
    subject,
    status,
    waitingFor: cleanText(input.waitingFor, 80) || null,
    importance: clamp(input.importance, 0, 100, 50),
    confidence: clamp01(input.confidence, 0.7),
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : null,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : null,
    source: cleanText(input.source, 120) || 'dialogue'
  };
}


export function normalizeMessageTarget(input = null) {
  if (!input || typeof input !== 'object') return null;
  const messageId = cleanText(input.messageId || input.id, 120);
  const role = ['user', 'assistant'].includes(input.role) ? input.role : null;
  const kind = ['text', 'voice', 'sticker'].includes(input.kind) ? input.kind : null;
  const fallback = kind === 'sticker' ? 'Стикер' : kind === 'voice' ? 'Голосовое сообщение' : '';
  const excerpt = cleanText(input.excerpt || input.text || fallback, 360);
  if (!messageId || !role || !kind || !excerpt) return null;
  return {
    messageId,
    role,
    kind,
    excerpt,
    stickerSrc: kind === 'sticker' && /^\/stickers\/[a-z0-9_]+\.webp$/iu.test(String(input.stickerSrc || ''))
      ? String(input.stickerSrc)
      : null,
    stickerId: kind === 'sticker' ? cleanText(input.stickerId, 80) || null : null,
    reason: cleanText(input.reason, 220) || null,
    confidence: clamp01(input.confidence, 0.8)
  };
}

export function normalizeDialogueState(input = {}) {
  return {
    topic: cleanText(input.topic, 500) || 'текущий контакт',
    scene: cleanText(input.scene, 100) || 'everyday',
    sceneGoal: cleanText(input.sceneGoal, 500) || null,
    sceneSource: cleanText(input.sceneSource, 100) || null,
    sceneAnchor: normalizeMessageTarget(input.sceneAnchor),
    openHook: normalizeMessageTarget(input.openHook),
    turnsInScene: clamp(input.turnsInScene, 1, 40, 1),
    continuityStrength: clamp01(input.continuityStrength, 0.6),
    reactiveStreak: clamp(input.reactiveStreak, 0, 12, 0),
    questionStreak: clamp(input.questionStreak, 0, 12, 0),
    topicDrift: Boolean(input.topicDrift),
    relationToPreviousTurn: cleanText(input.relationToPreviousTurn, 100) || 'continuation',
    explicitReplyTarget: normalizeMessageTarget(input.explicitReplyTarget),
    entities: uniqueStrings(input.entities, 12, 180),
    unresolvedQuestions: uniqueStrings(input.unresolvedQuestions, 6, 420),
    agreements: uniqueStrings(input.agreements, 6, 420),
    corrections: uniqueStrings(input.corrections, 6, 420),
    lastRinAction: input.lastRinAction && typeof input.lastRinAction === 'object'
      ? {
          kind: cleanText(input.lastRinAction.kind, 40) || 'text',
          meaning: cleanText(input.lastRinAction.meaning, 420),
          cause: cleanText(input.lastRinAction.cause, 420)
        }
      : null,
    confidence: clamp01(input.confidence, 0.7)
  };
}

export function normalizeBehaviorPolicy(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    version: cleanText(source.version, 80) || 'rin-behavior-policy-v1',
    action: cleanText(source.action, 80) || 'react',
    responseAct: cleanText(source.responseAct, 100) || 'direct_response',
    initiative: cleanText(source.initiative, 100) || 'none',
    initiativeStrength: clamp(source.initiativeStrength, 0, 100, 0),
    questionBudget: clamp(source.questionBudget, 0, 1, 0),
    questionReason: cleanText(source.questionReason, 320) || null,
    emotionalExpression: cleanText(source.emotionalExpression, 80) || 'natural',
    topicHold: cleanText(source.topicHold, 80) || 'hold_scene',
    distance: cleanText(source.distance, 80) || 'stable',
    playfulness: clamp(source.playfulness, 0, 100, 0),
    directness: cleanText(source.directness, 80) || 'balanced',
    tone: cleanText(source.tone, 120) || 'calm_personal',
    delivery: cleanText(source.delivery, 80) || 'respond',
    reasons: uniqueStrings(source.reasons, 10, 420)
  };
}

export function normalizeResponsePlan(input = {}) {
  const behavior = normalizeBehaviorPolicy(input.behavior || {});
  const questionBudget = input.questionBudget === undefined
    ? clamp(input.shouldAskQuestion ? 1 : behavior.questionBudget, 0, 1, 0)
    : clamp(input.questionBudget, 0, 1, 0);
  return {
    schema: RESPONSE_PLAN_SCHEMA,
    goal: cleanText(input.goal, 500) || 'ответить на текущую реплику по смыслу',
    mustAddress: uniqueStrings(input.mustAddress, 8, 500),
    factsToUse: uniqueStrings(input.factsToUse, 8, 500),
    factsToAvoid: uniqueStrings(input.factsToAvoid, 8, 500),
    stance: cleanText(input.stance, 220) || 'личная и уважительная позиция Рин',
    tone: cleanText(input.tone, 120) || 'calm_personal',
    directness: cleanText(input.directness, 80) || 'balanced',
    initiative: cleanText(input.initiative, 100) || behavior.initiative || 'none',
    initiativeStrength: clamp(input.initiativeStrength, 0, 100, behavior.initiativeStrength),
    responseAct: cleanText(input.responseAct, 100) || behavior.responseAct || 'direct_response',
    behavior,
    sceneGoal: cleanText(input.sceneGoal, 500) || null,
    threadPolicy: cleanText(input.threadPolicy, 500) || null,
    mustNot: uniqueStrings(input.mustNot, 10, 500),
    inputReplyTarget: normalizeMessageTarget(input.inputReplyTarget),
    replyTarget: normalizeMessageTarget(input.replyTarget),
    delivery: RESPONSE_DELIVERIES.has(cleanText(input.delivery, 80)) ? cleanText(input.delivery, 80) : 'text',
    length: cleanText(input.length, 40) || 'short',
    questionBudget,
    shouldAskQuestion: questionBudget > 0,
    uncertaintyPolicy: cleanText(input.uncertaintyPolicy, 220) || 'state_uncertainty',
    confidence: clamp01(input.confidence, 0.7),
    director: input.director && typeof input.director === 'object' ? input.director : null,
    characterIntent: input.characterIntent && typeof input.characterIntent === 'object' ? input.characterIntent : null,
    relationshipIntent: input.relationshipIntent && typeof input.relationshipIntent === 'object' ? input.relationshipIntent : null,
    emotionalIntent: input.emotionalIntent && typeof input.emotionalIntent === 'object' ? input.emotionalIntent : null,
    reasons: uniqueStrings(input.reasons, 12, 420)
  };
}

export function makeStateTransition({
  dialogueState = null,
  beliefs = [],
  openLoops = [],
  resolvedLoops = [],
  emotionalState = null,
  moodState = null,
  relationshipState = null,
  emotionalTrace = null,
  moodDelta = null,
  relationshipDelta = null
} = {}) {
  const normalizedEmotionalState = emotionalState && typeof emotionalState === 'object'
    ? normalizeEmotionalState(emotionalState, { relationship: relationshipState || {}, mood: moodState || {} })
    : null;
  const primary = normalizedEmotionalState?.primary || null;
  return {
    schema: STATE_TRANSITION_SCHEMA,
    dialogueState: dialogueState && typeof dialogueState === 'object' ? normalizeDialogueState(dialogueState) : null,
    beliefUpdates: (Array.isArray(beliefs) ? beliefs : []).map(normalizeBelief).slice(0, 8),
    openLoopUpdates: (Array.isArray(openLoops) ? openLoops : []).map(normalizeOpenLoop).slice(0, 8),
    resolvedLoopIds: uniqueStrings(resolvedLoops, 8, 120),
    moodState: moodState && typeof moodState === 'object'
      ? {
          affection: clamp(moodState.affection, 0, 100, 65),
          energy: clamp(moodState.energy, 0, 100, 65)
        }
      : null,
    relationshipState: relationshipState && typeof relationshipState === 'object'
      ? normalizeRelationshipState(relationshipState)
      : null,
    emotionalState: normalizedEmotionalState,
    // Legacy mirrors remain for one release so old clients/tests can read the transition,
    // but the semantic source is the full state above.
    moodDelta: {
      affection: clamp(moodDelta?.affection, -20, 20, 0),
      energy: clamp(moodDelta?.energy, -20, 20, 0)
    },
    relationshipDelta: Object.fromEntries(
      ['trust', 'closeness', 'comfort', 'respect', 'playfulness', 'attraction', 'vulnerability']
        .map(key => [key, clamp(relationshipDelta?.[key], -20, 20, 0)])
    ),
    emotionalTrace: emotionalTrace && typeof emotionalTrace === 'object'
      ? {
          emotion: cleanText(emotionalTrace.emotion, 80),
          cause: cleanText(emotionalTrace.cause, 500),
          intensity: clamp(emotionalTrace.intensity, 0, 100, 40),
          resolution: cleanText(emotionalTrace.resolution, 80) || 'unresolved',
          expiresAfterTurns: clamp(emotionalTrace.expiresAfterTurns, 1, 20, 4)
        }
      : primary
        ? {
            emotion: primary.type,
            cause: primary.cause,
            intensity: primary.intensity,
            resolution: primary.resolution,
            expiresAfterTurns: primary.expiresAfterTurns
          }
        : null
  };
}
