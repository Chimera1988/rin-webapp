import { normalizeEmotionalState, normalizeRelationshipState } from '../affective-contract.js';
import { normalizeBelief as normalizeEpistemicBelief } from '../epistemic-contract.js';
import { normalizeRinIntent } from '../intent-contract.js';
import { normalizeLifeBeat } from './life-texture.js';

export const STATE_TRANSITION_SCHEMA = 'rin-state-transition-v5';


export const SCENE_COMMITMENT_STATUSES = new Set([
  'active',
  'contested',
  'fulfilled',
  'broken',
  'released'
]);

export const SCENE_COMMITMENT_OWNERS = new Set(['rin', 'user', 'shared']);
export const SCENE_COMMITMENT_HORIZONS = new Set([
  'open_ended',
  'until_sleep',
  'until_tomorrow',
  'until_end_of_day',
  'until_event',
  'until_task_done'
]);
export const SCENE_COMMITMENT_ACTIONS = new Set([
  'none',
  'establish',
  'honor',
  'renegotiate',
  'compromise',
  'insist',
  'break',
  'fulfill',
  'release'
]);

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

export function inferSceneCommitmentHorizon(subject = '') {
  const text = cleanText(subject, 500).toLowerCase();
  if (!text) return 'open_ended';
  if (/(?:до\s+сна|перед\s+сном|до\s+того,?\s+как\s+(?:лечь|пойти)\s+спать|пока\s+не\s+(?:ляжем|лягу|пойд[её]м)\s+спать)/iu.test(text)) return 'until_sleep';
  if (/(?:до\s+завтра|до\s+утра|на\s+сегодня\s+до\s+утра)/iu.test(text)) return 'until_tomorrow';
  if (/(?:до\s+конца\s+(?:дня|вечера)|сегодня\s+до\s+(?:конца\s+дня|полуночи))/iu.test(text)) return 'until_end_of_day';
  if (/(?:пока\s+не\s+(?:закончим|сделаем|решим|дойд[её]м|верн[её]мся)|до\s+тех\s+пор,?\s+пока)/iu.test(text)) return 'until_event';
  if (/(?:пока\s+не\s+закончу|до\s+завершения|пока\s+не\s+доделаю)/iu.test(text)) return 'until_task_done';
  return 'open_ended';
}

export function normalizeSceneCommitment(input = {}) {
  const subject = cleanText(input.subject, 320);
  if (!subject) return null;
  const owner = SCENE_COMMITMENT_OWNERS.has(input.owner) ? input.owner : 'shared';
  const status = SCENE_COMMITMENT_STATUSES.has(input.status) ? input.status : 'active';
  const action = SCENE_COMMITMENT_ACTIONS.has(input.lastAction) ? input.lastAction : 'establish';
  const inferredHorizon = inferSceneCommitmentHorizon(subject);
  const horizon = SCENE_COMMITMENT_HORIZONS.has(input.horizon) ? input.horizon : inferredHorizon;
  const terminal = ['fulfilled', 'broken', 'released'].includes(status);
  return {
    id: cleanText(input.id, 120) || cognitiveId('commit', `${owner}:${subject}`),
    subject,
    owner,
    status,
    horizon,
    strength: clamp(input.strength, 0, 100, 65),
    source: cleanText(input.source, 80) || 'dialogue',
    rationale: cleanText(input.rationale, 320) || null,
    lastAction: action,
    terminalReason: terminal ? (cleanText(input.terminalReason, 220) || null) : null,
    terminalAtTurn: terminal && Number.isFinite(Number(input.terminalAtTurn))
      ? clamp(input.terminalAtTurn, 0, 1000000, 0)
      : null,
    createdAtTurn: clamp(input.createdAtTurn, 0, 1000000, 0),
    updatedAtTurn: clamp(input.updatedAtTurn, 0, 1000000, 0)
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


export function normalizeDiscourseAnchor(input = {}) {
  const referent = cleanText(input.referent || input.key, 100).toLowerCase();
  if (!referent) return null;
  const owner = ['rin', 'user', 'shared', 'other', 'unknown'].includes(input.owner) ? input.owner : 'unknown';
  return {
    referent,
    label: cleanText(input.label || referent, 180) || referent,
    owner,
    source: cleanText(input.source, 60) || 'dialogue',
    evidence: cleanText(input.evidence, 260) || null
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
    discourseAnchors: (Array.isArray(input.discourseAnchors) ? input.discourseAnchors : [])
      .map(normalizeDiscourseAnchor)
      .filter(Boolean)
      .slice(-8),
    recentActs: (Array.isArray(input.recentActs) ? input.recentActs : []).map(item => cleanText(item, 80)).filter(Boolean).slice(-8),
    recentMotifs: (Array.isArray(input.recentMotifs) ? input.recentMotifs : []).map(item => cleanText(item, 80)).filter(Boolean).slice(-8),
    recentMessageShapes: (Array.isArray(input.recentMessageShapes) ? input.recentMessageShapes : []).map(item => cleanText(item, 20)).filter(item => ['single', 'split'].includes(item)).slice(-8),
    recentResponseDepths: (Array.isArray(input.recentResponseDepths) ? input.recentResponseDepths : []).map(item => cleanText(item, 20)).filter(item => ['micro', 'short', 'normal', 'extended'].includes(item)).slice(-8),
    recentLifeBeats: (Array.isArray(input.recentLifeBeats) ? input.recentLifeBeats : [])
      .map(normalizeLifeBeat)
      .filter(Boolean)
      .slice(-16),
    recentSharedSymbols: (Array.isArray(input.recentSharedSymbols) ? input.recentSharedSymbols : [])
      .map(item => ({
        id: cleanText(item?.id, 80).toLowerCase(),
        expression: ['subtle', 'explicit', 'evolve'].includes(item?.expression) ? item.expression : 'subtle'
      }))
      .filter(item => item.id)
      .slice(-8),
    sceneCommitments: (Array.isArray(input.sceneCommitments) ? input.sceneCommitments : [])
      .map(normalizeSceneCommitment)
      .filter(Boolean)
      .slice(-6),
    lastFrameAlignment: cleanText(input.lastFrameAlignment, 40) || null,
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
