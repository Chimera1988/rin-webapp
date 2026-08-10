import { normalizeEmotionalState, normalizeRelationshipState } from '../affective-contract.js';
import { normalizeBelief as normalizeEpistemicBelief } from '../epistemic-contract.js';
import { normalizeRinIntent } from '../intent-contract.js';

export const STATE_TRANSITION_SCHEMA = 'rin-state-transition-v4';

export const OPEN_LOOP_STATUSES = new Set([
  'active',
  'waiting_for_user',
  'waiting_for_rin',
  'resolved',
  'cancelled',
  'stale'
]);

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

export function makeStateTransition({
  dialogueState = null,
  beliefs = [],
  openLoops = [],
  resolvedLoops = [],
  emotionalState = null,
  moodState = null,
  relationshipState = null,
  rinIntent = null
} = {}) {
  const normalizedEmotionalState = emotionalState && typeof emotionalState === 'object'
    ? normalizeEmotionalState(emotionalState, { relationship: relationshipState || {}, mood: moodState || {} })
    : null;
  const primary = normalizedEmotionalState?.primary || null;
  return {
    schema: STATE_TRANSITION_SCHEMA,
    dialogueState: dialogueState && typeof dialogueState === 'object' ? normalizeDialogueState(dialogueState) : null,
    beliefUpdates: (Array.isArray(beliefs) ? beliefs : []).map(normalizeEpistemicBelief).slice(0, 8),
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
    rinIntent: normalizeRinIntent(rinIntent)
  };
}
