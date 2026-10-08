import { inferRinIntentKind, normalizeRinIntent } from '../intent-contract.js';
import { cleanText, clamp, clamp01, cognitiveId, inferSceneCommitmentHorizon, makeStateTransition, normalizeOpenLoop, normalizeSceneCommitment } from './cognitive-contract.js';
import { STICKER_INTENT_VALUES } from './sticker-catalog.js';
import { normalizeLifeBeat, normalizeLifeDomain, normalizeLifeMotif } from './life-texture.js';
import { detectUserFutureCallback, explicitFutureCallbackFulfillment, fulfillUserFutureCommitment, futureCallbackOpenLoop, upsertUserFutureCommitment } from './future-callbacks.js';

export const TURN_DECISION_SCHEMA = 'rin-turn-decision-v1';
export const DELIVERY_PLAN_SCHEMA = 'rin-delivery-plan-v1';
export const DELIVERY_MODES = new Set(['single_text', 'multi_message', 'text_plus_sticker', 'sticker_only', 'silence']);
export const QUESTION_MODES = new Set(['none', 'natural', 'required']);
export const INTENT_OPERATIONS = new Set(['none', 'preserve', 'activate', 'advance', 'suspend', 'complete', 'cancel']);
export const REALITY_MODES = new Set(['grounded', 'explicit_fiction', 'simulated_scene']);
export const SEGMENT_TYPES = new Set(['text', 'sticker']);
export const MESSAGE_SHAPES = new Set(['single', 'split']);
export const RESPONSE_DEPTHS = new Set(['micro', 'short', 'normal', 'extended']);

export const RESPONSE_DEPTH_BUDGETS = Object.freeze({
  micro: { soft: 80, hard: 180 },
  short: { soft: 170, hard: 340 },
  normal: { soft: 320, hard: 640 },
  extended: { soft: 720, hard: 1600 }
});

export function responseDepthBudget(depth = 'normal', { longRequested = false } = {}) {
  const key = RESPONSE_DEPTHS.has(depth) ? depth : 'normal';
  const budget = RESPONSE_DEPTH_BUDGETS[key] || RESPONSE_DEPTH_BUDGETS.normal;
  if (key === 'extended' && longRequested) return { ...budget, hard: 2400 };
  return { ...budget };
}

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

export function buildTurnDecisionJsonSchema({ activeIntent = null, conversationState = 'ongoing', allowStickers = true, replyCandidateIds = [], staticContract = false } = {}) {
  // Rin Mind uses staticContract=true so Structured Outputs stays byte-stable for
  // prompt caching. Legacy callers keep their narrower dynamic schemas. All
  // dynamic availability is still re-checked by the deterministic validator.
  const intentOperations = staticContract
    ? [...INTENT_OPERATIONS]
    : allowedIntentOperations({ activeIntent, conversationState });
  const segmentTypes = staticContract ? ['text', 'sticker'] : (allowStickers ? ['text', 'sticker'] : ['text']);
  const stickerIntents = staticContract ? [null, ...STICKER_INTENT_VALUES] : (allowStickers ? [null, ...STICKER_INTENT_VALUES] : [null]);
  const visualReplyIds = [...new Set((Array.isArray(replyCandidateIds) ? replyCandidateIds : []).map(item => cleanText(item, 120)).filter(Boolean))].slice(0, 4);
  return {
    name: 'rin_turn_decision',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['act', 'focus', 'stance', 'question', 'replyLink', 'delivery', 'intentTransition', 'openLoops', 'realityMode'],
      properties: {
        act: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z][a-z0-9_]{0,63}$' },
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
            targetEventId: staticContract
              ? { type: ['string', 'null'], maxLength: 120 }
              : { type: ['string', 'null'], enum: [null, ...visualReplyIds] },
            reason: { type: ['string', 'null'], maxLength: 260 }
          }
        },
        delivery: {
          type: 'object', additionalProperties: false,
          required: ['responseDepth', 'messageShape', 'segments'],
          properties: {
            responseDepth: { type: 'string', enum: ['micro', 'short', 'normal', 'extended'] },
            messageShape: { type: 'string', enum: ['single', 'split'] },
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
    // A text beat may still be very short, but its budget must not be so tiny
    // that Voice Realization is forced into brittle character clipping.
    maxChars: type === 'text' ? clamp(segment?.maxChars, 80, 5000, 420) : clamp(segment?.maxChars, 20, 20, 20)
  };
}

function normalizeSegments(_mode, segments = []) {
  // Normalization is deliberately non-semantic. It never invents a missing
  // conversational beat or sticker intent; TurnValidator rejects inconsistent
  // mode/segment combinations and the same cognitive owner may decide again.
  return (Array.isArray(segments) ? segments : []).map(normalizeSegment).slice(0, 3);
}

export function normalizeActCode(value = '') {
  const raw = cleanText(value, 160).toLowerCase();
  if (/^[a-z][a-z0-9_]{0,63}$/u.test(raw)) return raw;
  return 'respond_personally';
}

export function normalizeTurnDecision(input = {}, context = {}) {
  const questionMode = QUESTION_MODES.has(input?.question?.mode) ? input.question.mode : 'none';
  const operation = INTENT_OPERATIONS.has(input?.intentTransition?.operation) ? input.intentTransition.operation : 'none';
  const realityMode = REALITY_MODES.has(input?.realityMode) ? input.realityMode : 'grounded';
  const segments = normalizeSegments(null, input?.delivery?.segments);
  const mode = deriveDeliveryMode(segments);
  const textSegmentCount = segments.filter(item => item?.type === 'text').length;
  const inferredShape = textSegmentCount >= 2 ? 'split' : 'single';
  const messageShape = MESSAGE_SHAPES.has(input?.delivery?.messageShape) ? input.delivery.messageShape : inferredShape;
  const responseDepth = RESPONSE_DEPTHS.has(input?.delivery?.responseDepth) ? input.delivery.responseDepth : 'normal';
  return {
    schema: TURN_DECISION_SCHEMA,
    act: normalizeActCode(input?.act),
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
    delivery: { mode, responseDepth, messageShape, segments },
    intentTransition: {
      operation,
      goal: cleanText(input?.intentTransition?.goal, 300) || null,
      motive: cleanText(input?.intentTransition?.motive, 320) || null,
      target: cleanText(input?.intentTransition?.target, 240) || null,
      nextMove: cleanText(input?.intentTransition?.nextMove, 260) || null,
      progress: input?.intentTransition?.progress == null ? null : clamp01(input.intentTransition.progress, 0),
      commitment: input?.intentTransition?.commitment == null ? null : clamp(input.intentTransition.commitment, 0, 100, 55),
      reason: cleanText(input?.intentTransition?.reason, 320) || null,
      // Internal deterministic lifecycle metadata. These fields are not requested
      // from the model schema; intent-policy adds them after semantic inference.
      kind: ['achievement', 'maintenance'].includes(input?.intentTransition?.kind) ? input.intentTransition.kind : null,
      phase: cleanText(input?.intentTransition?.phase, 40) || null,
      engagement: input?.intentTransition?.engagement == null ? null : clamp(input.intentTransition.engagement, 0, 100, 55),
      saturation: input?.intentTransition?.saturation == null ? null : clamp(input.intentTransition.saturation, 0, 100, 0)
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
    source: context.source || 'rin_mind_v2'
  };
}

export function applyIntentTransition(currentInput = null, decisionInput = null, { revision = 0, scene = 'everyday' } = {}) {
  const current = normalizeRinIntent(currentInput);
  const transition = normalizeTurnDecision(decisionInput || {}).intentTransition;
  const turn = Math.max(1, Math.round(Number(revision) || 0) + 1);
  const operation = transition.operation;

  if (operation === 'none') return current;
  if (operation === 'activate') {
    if (!transition.goal) return current;
    const commitment = transition.commitment ?? 62;
    const kind = transition.kind || inferRinIntentKind({ target: transition.target, goal: transition.goal });
    const maxTurns = kind === 'maintenance'
      ? Math.max(14, Math.min(22, 14 + Math.floor(Math.max(0, commitment - 60) / 8)))
      : Math.max(6, Math.min(10, 6 + Math.floor(Math.max(0, commitment - 60) / 10)));
    return normalizeRinIntent({
      status: 'active',
      kind,
      phase: transition.phase || 'started',
      goal: transition.goal,
      motive: transition.motive || 'собственный локальный интерес Рин',
      target: transition.target || 'current_scene',
      scene,
      priority: 60,
      commitment,
      progress: kind === 'maintenance' ? null : (transition.progress ?? 0.05),
      engagement: kind === 'maintenance' ? (transition.engagement ?? commitment) : null,
      saturation: kind === 'maintenance' ? (transition.saturation ?? 0) : null,
      nextMove: transition.nextMove || 'continue_naturally',
      progressState: kind === 'maintenance' ? 'sustained' : 'started',
      startedAtTurn: turn,
      updatedAtTurn: turn,
      turnCount: 1,
      minTurns: 2,
      maxTurns,
      source: decisionInput?.source === 'rin-cognitive-turn-plan-v3' ? 'rin_turn_plan_v3' : 'rin_mind_v2',
      reason: transition.reason || null
    });
  }
  if (!current) return null;

  if (operation === 'preserve') {
    const maintenance = current.kind === 'maintenance';
    return normalizeRinIntent({
      ...current,
      status: current.status === 'suspended' ? 'active' : current.status,
      phase: maintenance ? (transition.phase || 'sustain') : (transition.phase || current.phase),
      engagement: maintenance ? (transition.engagement ?? current.engagement) : current.engagement,
      saturation: maintenance ? (transition.saturation ?? current.saturation) : current.saturation,
      updatedAtTurn: turn,
      turnCount: Number(current.turnCount || 0) + 1,
      progressState: maintenance ? 'sustained' : (current.status === 'suspended' ? 'resumed' : 'preserved'),
      reason: transition.reason || current.reason
    });
  }
  if (operation === 'advance') {
    const maintenance = current.kind === 'maintenance';
    return normalizeRinIntent({
      ...current,
      status: 'active',
      phase: maintenance ? (transition.phase || 'sustain') : 'advancing',
      progress: maintenance ? null : (transition.progress ?? Math.min(0.95, Number(current.progress || 0) + 0.18)),
      engagement: maintenance ? (transition.engagement ?? current.engagement) : current.engagement,
      saturation: maintenance ? (transition.saturation ?? current.saturation) : current.saturation,
      commitment: transition.commitment ?? current.commitment,
      nextMove: transition.nextMove || current.nextMove,
      turnCount: Number(current.turnCount || 0) + 1,
      updatedAtTurn: turn,
      progressState: maintenance ? 'sustained' : 'advanced',
      reason: transition.reason || current.reason
    });
  }
  if (operation === 'suspend') {
    return normalizeRinIntent({
      ...current,
      status: 'suspended',
      phase: 'suspended',
      updatedAtTurn: turn,
      turnCount: Number(current.turnCount || 0) + 1,
      terminalAtTurn: 0,
      progressState: 'suspended',
      completionReason: null,
      reason: transition.reason || current.reason
    });
  }
  if (operation === 'complete') {
    return normalizeRinIntent({
      ...current,
      status: 'completed',
      phase: 'completed',
      progress: current.kind === 'maintenance' ? null : 1,
      updatedAtTurn: turn,
      turnCount: Number(current.turnCount || 0) + 1,
      terminalAtTurn: turn,
      progressState: 'completed',
      completionReason: transition.reason || 'цель естественно завершена'
    });
  }
  if (operation === 'cancel') {
    return normalizeRinIntent({
      ...current,
      status: 'cancelled',
      phase: 'cancelled',
      updatedAtTurn: turn,
      turnCount: Number(current.turnCount || 0) + 1,
      terminalAtTurn: turn,
      progressState: 'cancelled',
      completionReason: transition.reason || 'линия отменена'
    });
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
    source: 'rin_mind_v2'
  }));
  return { open, resolveIds: decision.openLoops.resolveIds };
}

function commitmentSubjectKey(value = '') {
  return cleanText(value, 320).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function commitmentOverlap(a = '', b = '') {
  const left = new Set(commitmentSubjectKey(a).split(/\s+/u).filter(item => item.length >= 3));
  const right = new Set(commitmentSubjectKey(b).split(/\s+/u).filter(item => item.length >= 3));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

const LIVE_COMMITMENT_STATUSES = new Set(['active', 'contested']);
const TERMINAL_COMMITMENT_STATUSES = new Set(['fulfilled', 'broken', 'released']);

function sleepBoundaryReached({ userText = '', scene = '', mind = null, decision = null, conversationState = 'ongoing' } = {}) {
  const text = cleanText(userText, 1800).toLowerCase();
  if (!text) return false;
  const strongSleepCue = /(?:спокойной\s+ночи|пойд[её]м\s+спать|пойду\s+спать|иду\s+спать|ложусь\s+спать|ложимся\s+спать|под\s+одеяло|пора\s+спать|засыпаю)/iu.test(text);
  const negatedGoodnight = /(?:не|без)\s+(?:буду\s+)?(?:говорить\s+)?спокойной\s+ночи/iu.test(text);
  if (strongSleepCue && !negatedGoodnight) return true;
  const softSleepCue = /(?:до\s+завтра|на\s+сегодня\s+вс[её]|вечер\s+закончен)/iu.test(text);
  const farewellContext = scene === 'farewell'
    || cleanText(mind?.sceneMotif, 80) === 'farewell'
    || cleanText(decision?.act, 80) === 'say_goodbye'
    || conversationState === 'ending';
  return softSleepCue && farewellContext;
}

function commitmentBoundaryReached(commitment = null, context = {}) {
  if (!commitment || !LIVE_COMMITMENT_STATUSES.has(commitment.status)) return false;
  if (commitment.horizon === 'until_sleep') return sleepBoundaryReached(context);
  return false;
}

function updateCommitmentAt(current = [], targetIndex = -1, patch = {}) {
  if (targetIndex < 0 || targetIndex >= current.length) return current;
  const next = normalizeSceneCommitment({ ...current[targetIndex], ...patch });
  if (!next) return current;
  const out = current.filter((_, index) => index !== targetIndex);
  out.push(next);
  return out.slice(-6);
}

function finalizeReachedCommitmentHorizons(currentInput = [], context = {}, turn = 0) {
  let current = (Array.isArray(currentInput) ? currentInput : []).map(normalizeSceneCommitment).filter(Boolean).slice(-6);
  for (const item of [...current]) {
    if (!commitmentBoundaryReached(item, context)) continue;
    const index = current.findIndex(candidate => candidate.id === item.id);
    current = updateCommitmentAt(current, index, {
      status: 'fulfilled',
      lastAction: 'fulfill',
      terminalReason: `horizon_reached:${item.horizon}`,
      terminalAtTurn: turn,
      updatedAtTurn: turn
    });
  }
  return current;
}

function applySceneCommitmentAction(currentInput = [], mind = null, {
  revision = 0,
  userText = '',
  scene = '',
  decision = null,
  conversationState = 'ongoing'
} = {}) {
  let current = (Array.isArray(currentInput) ? currentInput : []).map(normalizeSceneCommitment).filter(Boolean).slice(-6);
  const action = String(mind?.commitmentAction || 'none');
  const subject = cleanText(mind?.commitmentSubject, 320) || null;
  const owner = ['rin', 'user', 'shared'].includes(mind?.commitmentOwner) ? mind.commitmentOwner : 'shared';
  const strength = clamp(mind?.commitmentStrength, 0, 100, 65);
  const rationale = cleanText(mind?.commitmentReason, 320) || null;
  const targetId = cleanText(mind?.commitmentTargetId, 120) || null;
  const turn = Math.max(1, Math.round(Number(revision) || 0) + 1);
  const context = { userText, scene, mind, decision, conversationState };

  if (action === 'establish') {
    if (subject) {
      const id = cognitiveId('commit', `${owner}:${subject}`);
      const existingIndex = current.findIndex(item => item.id === id || (LIVE_COMMITMENT_STATUSES.has(item.status) && commitmentOverlap(item.subject, subject) >= 0.82));
      const next = normalizeSceneCommitment({
        ...(existingIndex >= 0 ? current[existingIndex] : {}),
        id: existingIndex >= 0 ? current[existingIndex].id : id,
        subject,
        owner,
        status: 'active',
        horizon: inferSceneCommitmentHorizon(subject),
        strength,
        source: decision?.source === 'rin-cognitive-turn-plan-v3' ? 'rin_turn_plan_v3' : 'rin_mind_v2',
        rationale,
        lastAction: 'establish',
        terminalReason: null,
        terminalAtTurn: null,
        createdAtTurn: existingIndex >= 0 ? current[existingIndex].createdAtTurn : turn,
        updatedAtTurn: turn
      });
      if (next) {
        const out = current.filter((_, index) => index !== existingIndex);
        out.push(next);
        current = out.slice(-6);
      }
    }
    return finalizeReachedCommitmentHorizons(current, context, turn);
  }

  if (action !== 'none') {
    let targetIndex = targetId ? current.findIndex(item => item.id === targetId) : -1;
    if (targetIndex < 0 && subject) {
      let best = -1;
      let bestScore = 0;
      current.forEach((item, index) => {
        if (!LIVE_COMMITMENT_STATUSES.has(item.status)) return;
        const score = commitmentOverlap(item.subject, subject);
        if (score > bestScore) { best = index; bestScore = score; }
      });
      if (bestScore >= 0.34) targetIndex = best;
    }

    if (targetIndex >= 0) {
      const target = current[targetIndex];
      if (!TERMINAL_COMMITMENT_STATUSES.has(target.status)) {
        const statusByAction = {
          honor: 'active',
          renegotiate: 'active',
          compromise: 'active',
          insist: 'contested',
          break: 'broken',
          fulfill: 'fulfilled',
          release: 'released'
        };
        let appliedAction = action;
        let nextStatus = statusByAction[action] || target.status;
        let terminalReason = target.terminalReason || null;
        let terminalAtTurn = target.terminalAtTurn ?? null;

        if (action === 'fulfill' && target.horizon !== 'open_ended' && !commitmentBoundaryReached(target, context)) {
          appliedAction = 'honor';
          nextStatus = 'active';
          terminalReason = null;
          terminalAtTurn = null;
        } else if (['break', 'fulfill', 'release'].includes(action)) {
          terminalReason = rationale || `model_${action}`;
          terminalAtTurn = turn;
        }

        current = updateCommitmentAt(current, targetIndex, {
          status: nextStatus,
          strength: mind?.commitmentStrength == null ? target.strength : strength,
          rationale: rationale || target.rationale,
          lastAction: appliedAction,
          terminalReason,
          terminalAtTurn,
          updatedAtTurn: turn
        });
      }
    }
  }

  return finalizeReachedCommitmentHorizons(current, context, turn);
}

export function buildDecisionStateTransition({ kernelState = null, affectiveTurn = null, decision = null, mind = null, userText = '', now = Date.now() } = {}) {
  const state = kernelState || {};
  const currentStatement = state?.beliefModel?.currentStatement || null;
  const correction = state?.beliefModel?.correction || null;
  const storedBeliefs = state?.beliefModel?.beliefs || [];
  const rejectionUpdates = (correction?.active ? correction.rejectIds : []).map(id => {
    const previous = storedBeliefs.find(item => item.id === id);
    return previous ? { ...previous, status: 'rejected', correctedBy: currentStatement?.id || null } : null;
  }).filter(Boolean);
  const loops = decisionOpenLoopUpdates(decision, { revision: state.revision, now });
  const userFutureCallback = detectUserFutureCallback(userText || state?.userText || '');
  const deterministicCallbackLoop = futureCallbackOpenLoop(userFutureCallback, now);
  if (deterministicCallbackLoop && !loops.open.some(item => item.id === deterministicCallbackLoop.id)) loops.open.push(deterministicCallbackLoop);
  const fulfilledCallbackId = explicitFutureCallbackFulfillment(userText || state?.userText || '', state?.openLoops || []);
  const resolvedLoopIds = uniq([...(loops.resolveIds || []), ...(fulfilledCallbackId ? [fulfilledCallbackId] : [])], 8);
  const rinIntent = applyIntentTransition(state.activeIntent, decision, { revision: state.revision, scene: state.scene?.type || 'everyday' });
  const priorActs = Array.isArray(state?.dialogueState?.recentActs) ? state.dialogueState.recentActs : [];
  const priorMotifs = Array.isArray(state?.dialogueState?.recentMotifs) ? state.dialogueState.recentMotifs : [];
  const currentAct = cleanText(decision?.act, 80);
  const currentMotif = cleanText(mind?.sceneMotif, 80);
  const frameAlignment = cleanText(mind?.frameAlignment, 40);
  const priorMessageShapes = Array.isArray(state?.dialogueState?.recentMessageShapes) ? state.dialogueState.recentMessageShapes : [];
  const priorResponseDepths = Array.isArray(state?.dialogueState?.recentResponseDepths) ? state.dialogueState.recentResponseDepths : [];
  const priorLifeBeats = Array.isArray(state?.dialogueState?.recentLifeBeats) ? state.dialogueState.recentLifeBeats : [];
  const priorSharedSymbols = Array.isArray(state?.dialogueState?.recentSharedSymbols) ? state.dialogueState.recentSharedSymbols : [];
  const priorSceneCommitments = Array.isArray(state?.dialogueState?.sceneCommitments) ? state.dialogueState.sceneCommitments : [];
  const currentLifeBeat = normalizeLifeBeat({
    domain: normalizeLifeDomain(mind?.lifeDomain),
    motif: normalizeLifeMotif(mind?.lifeMotif)
  });
  const sharedSymbolExpression = ['subtle', 'explicit', 'evolve'].includes(mind?.sharedSymbolExpression)
    ? mind.sharedSymbolExpression
    : 'none';
  const currentSharedSymbol = sharedSymbolExpression !== 'none' && cleanText(mind?.sharedSymbolId, 80)
    ? { id: cleanText(mind.sharedSymbolId, 80).toLowerCase(), expression: sharedSymbolExpression }
    : null;
  const currentMessageShape = MESSAGE_SHAPES.has(decision?.delivery?.messageShape)
    ? decision.delivery.messageShape
    : ((decision?.delivery?.segments || []).filter(item => item?.type === 'text').length >= 2 ? 'split' : 'single');
  const currentResponseDepth = RESPONSE_DEPTHS.has(decision?.delivery?.responseDepth) ? decision.delivery.responseDepth : 'normal';
  let sceneCommitments = applySceneCommitmentAction(priorSceneCommitments, mind, {
    revision: state.revision,
    userText: userText || state?.userText || '',
    scene: state?.scene?.type || 'everyday',
    decision,
    conversationState: state?.conversationState || 'ongoing'
  });
  const turn = Math.max(1, Math.round(Number(state.revision) || 0) + 1);
  if (userFutureCallback) sceneCommitments = upsertUserFutureCommitment(sceneCommitments, userFutureCallback, { turn });
  if (fulfilledCallbackId) sceneCommitments = fulfillUserFutureCommitment(sceneCommitments, fulfilledCallbackId, { turn });
  const dialogueState = state.dialogueState && typeof state.dialogueState === 'object'
    ? {
        ...state.dialogueState,
        recentActs: [...priorActs, ...(currentAct ? [currentAct] : [])].slice(-8),
        recentMotifs: [...priorMotifs, ...(currentMotif ? [currentMotif] : [])].slice(-8),
        recentMessageShapes: [...priorMessageShapes, currentMessageShape].slice(-8),
        recentResponseDepths: [...priorResponseDepths, currentResponseDepth].slice(-8),
        recentLifeBeats: [...priorLifeBeats, ...(currentLifeBeat ? [currentLifeBeat] : [])].slice(-16),
        recentSharedSymbols: [...priorSharedSymbols, ...(currentSharedSymbol ? [currentSharedSymbol] : [])].slice(-8),
        sceneCommitments,
        lastFrameAlignment: frameAlignment || state.dialogueState.lastFrameAlignment || null
      }
    : (currentAct || currentMotif || frameAlignment
      ? {
          recentActs: currentAct ? [currentAct] : [],
          recentMotifs: currentMotif ? [currentMotif] : [],
          recentMessageShapes: [currentMessageShape],
          recentResponseDepths: [currentResponseDepth],
          recentLifeBeats: currentLifeBeat ? [currentLifeBeat] : [],
          recentSharedSymbols: currentSharedSymbol ? [currentSharedSymbol] : [],
          sceneCommitments,
          lastFrameAlignment: frameAlignment || null
        }
      : null);
  return makeStateTransition({
    dialogueState,
    beliefs: [...(currentStatement ? [currentStatement] : []), ...rejectionUpdates],
    openLoops: loops.open,
    resolvedLoops: resolvedLoopIds,
    moodState: affectiveTurn?.moodState || null,
    relationshipState: affectiveTurn?.relationshipState || null,
    emotionalState: affectiveTurn?.emotionalState || null,
    rinIntent
  });
}
