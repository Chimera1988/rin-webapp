import { normalizeRinIntent } from '../intent-contract.js';
import { cleanText, clamp, clamp01, cognitiveId, makeStateTransition, normalizeOpenLoop } from './cognitive-contract.js';
import { STICKER_INTENT_VALUES } from './sticker-intents.js';

export const TURN_DECISION_SCHEMA = 'rin-turn-decision-v1';
export const DELIVERY_PLAN_SCHEMA = 'rin-delivery-plan-v1';
export const DELIVERY_MODES = new Set(['single_text', 'multi_message', 'text_plus_sticker', 'sticker_only', 'silence']);
export const QUESTION_MODES = new Set(['none', 'natural', 'required']);
export const INTENT_OPERATIONS = new Set(['none', 'preserve', 'activate', 'advance', 'suspend', 'complete', 'cancel']);
export const REALITY_MODES = new Set(['grounded', 'explicit_fiction', 'simulated_scene']);
export const SEGMENT_TYPES = new Set(['text', 'sticker']);

const uniq = (items = [], max = 8) => [...new Set((Array.isArray(items) ? items : []).map(item => cleanText(item, 120)).filter(Boolean))].slice(0, max);

export function deriveDeliveryMode(segments = []) {
  const normalized = Array.isArray(segments) ? segments : [];
  if (normalized.length === 0) return 'silence';
  if (normalized.length === 1) return normalized[0]?.type === 'sticker' ? 'sticker_only' : 'single_text';
  const textCount = normalized.filter(item => item?.type === 'text').length;
  const stickerCount = normalized.filter(item => item?.type === 'sticker').length;
  if (normalized.length === 2 && textCount === 1 && stickerCount === 1) return 'text_plus_sticker';
  return 'multi_message';
}

function allowedIntentOperations({ activeIntent = null, conversationState = 'ongoing' } = {}) {
  const status = activeIntent?.status || null;
  const live = ['active', 'suspended'].includes(status);
  if (conversationState === 'ending') return live ? ['complete', 'cancel'] : ['none'];
  if (live) return ['none', 'preserve', 'advance', 'suspend', 'complete', 'cancel'];
  return ['none', 'activate'];
}

export function buildTurnDecisionJsonSchema({ activeIntent = null, conversationState = 'ongoing', allowStickers = true, replyCandidateIds = [] } = {}) {
  const intentOperations = allowedIntentOperations({ activeIntent, conversationState });
  const segmentTypes = allowStickers ? ['text', 'sticker'] : ['text'];
  const stickerIntents = allowStickers ? [null, ...STICKER_INTENT_VALUES] : [null];
  const visualReplyIds = [...new Set((Array.isArray(replyCandidateIds) ? replyCandidateIds : []).map(item => cleanText(item, 120)).filter(Boolean))].slice(0, 4);
  return {
    name: 'rin_turn_decision',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['act', 'focus', 'stance', 'question', 'replyLink', 'delivery', 'intentTransition', 'openLoops', 'realityMode'],
      properties: {
        act: { type: 'string', minLength: 1, maxLength: 100 },
        focus: { type: 'string', minLength: 1, maxLength: 500 },
        stance: { type: 'string', minLength: 1, maxLength: 280 },
        question: {
          type: 'object', additionalProperties: false, required: ['mode', 'reason'],
          properties: {
            mode: { type: 'string', enum: ['none', 'natural', 'required'] },
            reason: { type: ['string', 'null'], maxLength: 260 }
          }
        },
        replyLink: {
          type: 'object', additionalProperties: false, required: ['targetEventId', 'reason'],
          properties: {
            targetEventId: { type: ['string', 'null'], enum: [null, ...visualReplyIds] },
            reason: { type: ['string', 'null'], maxLength: 260 }
          }
        },
        delivery: {
          type: 'object', additionalProperties: false,
          required: ['segments'],
          properties: {
            segments: {
              type: 'array', minItems: 0, maxItems: 3,
              items: {
                type: 'object', additionalProperties: false,
                required: ['type', 'purpose', 'stickerIntent', 'maxChars'],
                properties: {
                  type: { type: 'string', enum: segmentTypes },
                  purpose: { type: 'string', minLength: 1, maxLength: 120 },
                  stickerIntent: { type: ['string', 'null'], enum: stickerIntents },
                  maxChars: { type: 'integer', minimum: 20, maximum: 5000 }
                }
              }
            }
          }
        },
        intentTransition: {
          type: 'object', additionalProperties: false,
          required: ['operation', 'goal', 'motive', 'target', 'nextMove', 'progress', 'commitment', 'reason'],
          properties: {
            operation: { type: 'string', enum: intentOperations },
            goal: { type: ['string', 'null'], maxLength: 300 },
            motive: { type: ['string', 'null'], maxLength: 320 },
            target: { type: ['string', 'null'], maxLength: 240 },
            nextMove: { type: ['string', 'null'], maxLength: 260 },
            progress: { type: ['number', 'null'], minimum: 0, maximum: 1 },
            commitment: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
            reason: { type: ['string', 'null'], maxLength: 320 }
          }
        },
        openLoops: {
          type: 'object', additionalProperties: false,
          required: ['open', 'resolveIds'],
          properties: {
            open: {
              type: 'array', maxItems: 4,
              items: {
                type: 'object', additionalProperties: false,
                required: ['subject', 'type', 'importance'],
                properties: {
                  subject: { type: 'string', minLength: 1, maxLength: 420 },
                  type: { type: 'string', minLength: 1, maxLength: 80 },
                  importance: { type: 'integer', minimum: 0, maximum: 100 }
                }
              }
            },
            resolveIds: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 120 } }
          }
        },
        realityMode: { type: 'string', enum: ['grounded', 'explicit_fiction', 'simulated_scene'] }
      }
    }
  };
}

export const TURN_DECISION_JSON_SCHEMA = buildTurnDecisionJsonSchema();

function normalizeSegment(segment = {}, index = 0) {
  const type = SEGMENT_TYPES.has(segment?.type) ? segment.type : 'text';
  return {
    type,
    purpose: cleanText(segment?.purpose, 120) || (type === 'sticker' ? 'nonverbal_reaction' : `message_${index + 1}`),
    stickerIntent: type === 'sticker' ? cleanText(segment?.stickerIntent, 80) || null : null,
    maxChars: clamp(segment?.maxChars, 20, 5000, type === 'text' ? 420 : 20)
  };
}

function normalizeSegments(_mode, segments = []) {
  // Normalization is deliberately non-semantic. It never invents a missing
  // conversational beat or sticker intent; TurnValidator rejects inconsistent
  // mode/segment combinations and the same Cognitive Kernel may decide again.
  return (Array.isArray(segments) ? segments : []).map(normalizeSegment).slice(0, 3);
}

export function normalizeTurnDecision(input = {}, context = {}) {
  const questionMode = QUESTION_MODES.has(input?.question?.mode) ? input.question.mode : 'none';
  const operation = INTENT_OPERATIONS.has(input?.intentTransition?.operation) ? input.intentTransition.operation : 'none';
  const realityMode = REALITY_MODES.has(input?.realityMode) ? input.realityMode : 'grounded';
  const segments = normalizeSegments(null, input?.delivery?.segments);
  const mode = deriveDeliveryMode(segments);
  return {
    schema: TURN_DECISION_SCHEMA,
    act: cleanText(input?.act, 100) || 'direct_response',
    focus: cleanText(input?.focus, 500) || 'ответить на текущую реплику по смыслу',
    stance: cleanText(input?.stance, 280) || 'личная, конкретная позиция Рин',
    question: {
      mode: questionMode,
      reason: cleanText(input?.question?.reason, 260) || null
    },
    replyLink: {
      targetEventId: cleanText(input?.replyLink?.targetEventId, 120) || null,
      reason: cleanText(input?.replyLink?.reason, 260) || null
    },
    delivery: { mode, segments },
    intentTransition: {
      operation,
      goal: cleanText(input?.intentTransition?.goal, 300) || null,
      motive: cleanText(input?.intentTransition?.motive, 320) || null,
      target: cleanText(input?.intentTransition?.target, 240) || null,
      nextMove: cleanText(input?.intentTransition?.nextMove, 260) || null,
      progress: input?.intentTransition?.progress == null ? null : clamp01(input.intentTransition.progress, 0),
      commitment: input?.intentTransition?.commitment == null ? null : clamp(input.intentTransition.commitment, 0, 100, 55),
      reason: cleanText(input?.intentTransition?.reason, 320) || null
    },
    openLoops: {
      open: (Array.isArray(input?.openLoops?.open) ? input.openLoops.open : []).slice(0, 4).map(item => ({
        subject: cleanText(item?.subject, 420),
        type: cleanText(item?.type, 80) || 'topic',
        importance: clamp(item?.importance, 0, 100, 55)
      })).filter(item => item.subject),
      resolveIds: uniq(input?.openLoops?.resolveIds, 8)
    },
    realityMode,
    source: context.source || 'cognitive_kernel'
  };
}

export function applyIntentTransition(currentInput = null, decisionInput = null, { revision = 0, scene = 'everyday' } = {}) {
  const current = normalizeRinIntent(currentInput);
  const transition = normalizeTurnDecision(decisionInput || {}).intentTransition;
  const turn = Math.max(1, Math.round(Number(revision) || 0) + 1);
  const operation = transition.operation;

  if (operation === 'none' || operation === 'preserve') return current;
  if (operation === 'activate') {
    if (!transition.goal) return current;
    return normalizeRinIntent({
      status: 'active',
      goal: transition.goal,
      motive: transition.motive || 'собственный локальный интерес Рин',
      target: transition.target || 'current_scene',
      scene,
      priority: 60,
      commitment: transition.commitment ?? 62,
      progress: transition.progress ?? 0.05,
      nextMove: transition.nextMove || 'continue_naturally',
      progressState: 'started',
      startedAtTurn: turn,
      updatedAtTurn: turn,
      minTurns: 1,
      maxTurns: 12,
      source: 'cognitive_kernel',
      reason: transition.reason || null
    });
  }
  if (!current) return null;

  if (operation === 'advance') {
    return normalizeRinIntent({
      ...current,
      status: 'active',
      progress: transition.progress ?? Math.min(0.95, Number(current.progress || 0) + 0.18),
      commitment: transition.commitment ?? current.commitment,
      nextMove: transition.nextMove || current.nextMove,
      turnCount: Number(current.turnCount || 0) + 1,
      updatedAtTurn: turn,
      progressState: 'advanced',
      reason: transition.reason || current.reason
    });
  }
  if (operation === 'suspend') {
    return normalizeRinIntent({ ...current, status: 'suspended', updatedAtTurn: turn, terminalAtTurn: 0, completionReason: transition.reason || 'временно отложено контекстом' });
  }
  if (operation === 'complete') {
    return normalizeRinIntent({ ...current, status: 'completed', progress: 1, updatedAtTurn: turn, terminalAtTurn: turn, completionReason: transition.reason || 'цель естественно завершена' });
  }
  if (operation === 'cancel') {
    return normalizeRinIntent({ ...current, status: 'cancelled', updatedAtTurn: turn, terminalAtTurn: turn, completionReason: transition.reason || 'линия отменена' });
  }
  return current;
}

export function decisionOpenLoopUpdates(decisionInput = null, { revision = 0, now = Date.now() } = {}) {
  const decision = normalizeTurnDecision(decisionInput || {});
  const open = decision.openLoops.open.map(item => normalizeOpenLoop({
    id: cognitiveId('loop', item.subject),
    type: item.type,
    subject: item.subject,
    status: 'active',
    importance: item.importance,
    confidence: 0.86,
    createdAt: now,
    updatedAt: now,
    source: 'cognitive_kernel'
  }));
  return { open, resolveIds: decision.openLoops.resolveIds };
}

export function buildDecisionStateTransition({ kernelState = null, affectiveTurn = null, decision = null, now = Date.now() } = {}) {
  const state = kernelState || {};
  const currentStatement = state?.beliefModel?.currentStatement || null;
  const correction = state?.beliefModel?.correction || null;
  const storedBeliefs = state?.beliefModel?.beliefs || [];
  const rejectionUpdates = (correction?.active ? correction.rejectIds : []).map(id => {
    const previous = storedBeliefs.find(item => item.id === id);
    return previous ? { ...previous, status: 'rejected', correctedBy: currentStatement?.id || null } : null;
  }).filter(Boolean);
  const loops = decisionOpenLoopUpdates(decision, { revision: state.revision, now });
  const rinIntent = applyIntentTransition(state.activeIntent, decision, { revision: state.revision, scene: state.scene?.type || 'everyday' });
  return makeStateTransition({
    dialogueState: state.dialogueState || null,
    beliefs: [...(currentStatement ? [currentStatement] : []), ...rejectionUpdates],
    openLoops: loops.open,
    resolvedLoops: loops.resolveIds,
    moodState: affectiveTurn?.moodState || null,
    relationshipState: affectiveTurn?.relationshipState || null,
    emotionalState: affectiveTurn?.emotionalState || null,
    rinIntent
  });
}
