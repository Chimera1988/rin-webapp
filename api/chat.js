import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState, compactKernelState } from '../lib/cognition/kernel-state.js';
import { buildKernelPrompt, parseKernelDecision } from '../lib/cognition/cognitive-kernel.js';
import { buildDecisionStateTransition } from '../lib/cognition/turn-decision.js';
import { validateRealization, validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import { buildRealityBoundary } from '../lib/cognition/reality-boundary.js';
import { isStickerIntentResolvable, selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { buildStickerState } from '../lib/cognition/sticker-state.js';
import { buildRealizationPrompt, buildRealizationRetryInstruction, parseRealization } from '../lib/personality/rin-realization.js';
import {
  cleanInlineText,
  currentUserTurn,
  isExplicitFarewell,
  normalizeReplySnapshot,
  pruneModelHistory,
  replySnapshotFromMessage,
  selectModelHistory
} from '../lib/chat-contract.js';
import { fetchWithTimeout, publicError, readJsonBody, requireMethod, requirePin } from '../lib/server/http.js';
import { buildServerProfile } from '../lib/server/canonical-profile.js';
import { retrieveCanonicalLore } from '../lib/server/canon-retrieval.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KERNEL_MODEL = process.env.OPENAI_DECISION_MODEL || 'gpt-4.1';
const REALIZATION_MODEL = process.env.OPENAI_REALIZATION_MODEL || 'gpt-4.1';
const KERNEL_PARAMS = { temperature: 0.28, max_tokens: 1100 };
const REALIZATION_PARAMS = { temperature: 0.72, max_tokens: 760 };
const LONG_REALIZATION_PARAMS = { temperature: 0.72, max_tokens: 1800 };

const normalize = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function detectLongMode(userText) {
  const text = normalize(userText, 4000).toLowerCase();
  return /(подробно|очень подробно|развернуто|развёрнуто|во всех деталях|полный разбор|объясни пошагово|расскажи подробнее|продолжай|расскажи ещё|можешь продолжить|сравни|проанализируй|составь план|пошаговая инструкция|технически объясни|разбери по пунктам)/iu.test(text);
}

export function detectConversationState(history = []) {
  const last = [...history].reverse().find(item => item?.role === 'user');
  return isExplicitFarewell(last?.content) ? 'ending' : last ? 'ongoing' : 'new';
}

const PROACTIVE_TYPES = new Set(['greeting', 'scheduled', 'manual']);
export function normalizeProactiveTrigger(input = null) {
  if (!input || typeof input !== 'object') return null;
  const type = normalize(input.type, 40);
  if (!PROACTIVE_TYPES.has(type)) return null;
  return {
    type,
    reason: normalize(input.reason, 300) || (type === 'greeting' ? 'новый контакт' : 'самостоятельная инициатива Рин')
  };
}

export function buildProactiveBrain({ trigger = null, memory = null } = {}) {
  const prior = memory?.conversationState?.dialogueState || null;
  const canContinue = Boolean(prior && prior.scene && prior.scene !== 'farewell');
  const scene = canContinue ? prior.scene : 'everyday';
  const topic = canContinue ? normalize(prior.topic, 500) : 'самостоятельный контакт Рин';
  return {
    version: 'rin-perception-proactive-v2',
    literalIntent: 'proactive_trigger',
    hiddenIntent: { type: 'proactive_contact_opportunity', confidence: 100, evidence: [normalize(trigger?.reason, 300)].filter(Boolean) },
    relation: { type: 'proactive', confidence: 100 },
    referents: [],
    ambiguity: { level: 0 },
    activeScene: {
      type: scene, topic, confidence: canContinue ? 82 : 74, source: 'proactive_state',
      anchor: null, openHook: canContinue ? prior?.openHook || null : null,
      turnsInScene: canContinue ? Number(prior?.turnsInScene || 1) : 1,
      continuityStrength: canContinue ? Number(prior?.continuityStrength || 0.7) : 0.55,
      reactiveStreak: 0, questionStreak: 0, topicDrift: false, emotionalDirection: 'steady'
    },
    summary: `proactive trigger=${trigger?.type || 'manual'}; priorScene=${scene}; hasOpenHook=${Boolean(prior?.openHook)}`
  };
}

function currentUserGroup(history = [], requestId = '') {
  const wanted = normalize(requestId, 100);
  if (!wanted) return [];
  return (Array.isArray(history) ? history : []).filter(item => item?.role === 'user' && item?.requestId === wanted);
}

function groupUserText(group = []) {
  return group.map(item => normalize(item?.content, 2000)).filter(Boolean).join('\n');
}

function explicitReplyFromGroup(group = [], history = []) {
  const turn = [...group].reverse().find(item => item?.inReplyTo && item?.replySnapshot) || null;
  if (!turn) return null;
  const source = (Array.isArray(history) ? history : []).find(item => item?.id === turn.inReplyTo) || null;
  const snapshot = normalizeReplySnapshot(turn.replySnapshot) || replySnapshotFromMessage(source);
  if (!snapshot) return null;
  return {
    messageId: normalize(turn.inReplyTo, 120),
    role: source?.role || snapshot.role,
    kind: source?.kind || snapshot.kind,
    excerpt: source?.kind === 'sticker'
      ? normalize(source?.sticker?.meaning || source?.sticker?.emotion || snapshot.excerpt, 360)
      : normalize(source?.content || snapshot.excerpt, 360),
    stickerSrc: snapshot.stickerSrc || source?.sticker?.src || null,
    stickerId: snapshot.stickerId || source?.sticker?.id || null,
    reason: 'пользователь вручную выбрал это сообщение для ответа',
    confidence: 1
  };
}

function visualReplyFromDecision(decision = null, group = []) {
  const targetEventId = normalize(decision?.replyLink?.targetEventId, 120);
  if (!targetEventId) return null;
  const source = (Array.isArray(group) ? group : []).find(item => item?.role === 'user' && item?.id === targetEventId) || null;
  if (!source) return null;
  const snapshot = replySnapshotFromMessage(source);
  if (!snapshot) return null;
  return {
    messageId: targetEventId,
    role: 'user',
    kind: source.kind === 'voice' ? 'voice' : 'text',
    excerpt: normalize(source.content, 360),
    reason: normalize(decision?.replyLink?.reason, 260) || 'смысловая привязка к более ранней реплике текущего user turn',
    confidence: 1
  };
}


const RETRYABLE_OPENAI_STATUSES = new Set([429, 500, 502, 503, 504]);
const OPENAI_RETRY_DELAY_MS = 180;

function upstreamCodeForStatus(status = 0) {
  if (Number(status) === 429) return 'UPSTREAM_RATE_LIMITED';
  if (Number(status) >= 500) return 'UPSTREAM_UNAVAILABLE';
  return 'UPSTREAM_REJECTED';
}

function upstreamError(message, code, status = null) {
  return Object.assign(new Error(message), { code, upstreamStatus: status });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function openaiChat({ model, messages, temperature, max_tokens, response_format = null }) {
  const body = { model, temperature, max_tokens, messages };
  if (response_format) body.response_format = response_format;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, 45_000);
    } catch (error) {
      if (error?.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('timeout')) throw error;
      if (attempt === 0) {
        await wait(OPENAI_RETRY_DELAY_MS);
        continue;
      }
      throw upstreamError('OpenAI network request failed', 'UPSTREAM_NETWORK_ERROR');
    }

    const raw = await response.text();
    if (!response.ok) {
      const status = Number(response.status) || 0;
      if (attempt === 0 && RETRYABLE_OPENAI_STATUSES.has(status)) {
        const retryAfterSeconds = Number(response.headers?.get?.('retry-after'));
        const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(1000, retryAfterSeconds * 1000)
          : OPENAI_RETRY_DELAY_MS;
        await wait(retryDelay);
        continue;
      }
      throw upstreamError(`OpenAI ${status}`, upstreamCodeForStatus(status), status);
    }

    let data;
    try { data = JSON.parse(raw); }
    catch { throw upstreamError('OpenAI returned invalid JSON', 'UPSTREAM_UNAVAILABLE', Number(response.status) || 502); }
    const choice = data?.choices?.[0] || {};
    return {
      content: choice?.message?.content?.trim() || '',
      finishReason: choice?.finish_reason || null,
      usage: data?.usage || null,
      model: data?.model || model
    };
  }
  throw upstreamError('OpenAI request failed', 'UPSTREAM_UNAVAILABLE');
}

function mergeUsage(...usages) {
  const out = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  for (const usage of usages) {
    if (!usage) continue;
    out.prompt_tokens += Number(usage.prompt_tokens) || 0;
    out.completion_tokens += Number(usage.completion_tokens) || 0;
    out.total_tokens += Number(usage.total_tokens) || 0;
  }
  return out;
}

const MAX_REALIZATION_REWRITES = 2;

function realizationFailure(validation = null, attempts = 1, phase = 'validation_failed') {
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  return Object.assign(new Error(`Realization validation failed: ${warnings.join(',')}`), {
    code: 'REALIZATION_VALIDATION_FAILED',
    warnings,
    hardWarnings: Array.isArray(validation?.hardWarnings) ? validation.hardWarnings : [],
    rewriteableWarnings: Array.isArray(validation?.rewriteableWarnings) ? validation.rewriteableWarnings : [],
    validationClass: phase,
    attempts
  });
}

function parseRealizationOrThrow(content = '', decision = null, attempts = 1) {
  try { return parseRealization(content, decision); }
  catch (error) {
    throw Object.assign(new Error('Realization returned invalid structured output'), {
      code: 'REALIZATION_PARSE_FAILED',
      validationClass: 'hard_parse_failure',
      attempts,
      cause: error
    });
  }
}

async function realizeDecision({ profile, state, decision, realityBoundary, isLong = false }) {
  const textSegments = decision.delivery.segments.filter(item => item.type === 'text');
  if (!textSegments.length) {
    return {
      realization: { segments: [] },
      validation: {
        version: 'rin-turn-validator-v2', passed: true, retryable: false,
        warnings: [], hardWarnings: [], rewriteableWarnings: [], reply: '',
        attempts: 0, rewrites: 0, trace: []
      },
      usage: null,
      retried: false,
      attempts: 0
    };
  }

  const prompt = buildRealizationPrompt({ profile, state, decision, realityBoundary });
  const params = isLong ? LONG_REALIZATION_PARAMS : REALIZATION_PARAMS;
  const trace = [];
  let usage = null;
  let previousRealization = null;
  let previousValidation = null;

  for (let rewriteAttempt = 0; rewriteAttempt <= MAX_REALIZATION_REWRITES; rewriteAttempt += 1) {
    const attemptNumber = rewriteAttempt + 1;
    const retryInstruction = rewriteAttempt > 0
      ? buildRealizationRetryInstruction(
          previousValidation?.rewriteableWarnings || previousValidation?.warnings || [],
          decision,
          previousRealization,
          rewriteAttempt
        )
      : '';
    const completion = await openaiChat({
      model: REALIZATION_MODEL,
      messages: [{ role: 'system', content: retryInstruction ? `${prompt.system}\n\n${retryInstruction}` : prompt.system }],
      response_format: prompt.responseFormat,
      ...params
    });
    usage = mergeUsage(usage, completion.usage);
    if (completion.finishReason === 'length' || !completion.content) {
      throw Object.assign(new Error(`Realization attempt ${attemptNumber} incomplete`), {
        code: 'MODEL_RESPONSE_TRUNCATED', attempts: attemptNumber
      });
    }

    const realization = parseRealizationOrThrow(completion.content, decision, attemptNumber);
    const validation = validateRealization(realization, {
      decision,
      realityBoundary,
      recentHistory: state?.recentHistory || [],
      currentUserText: state?.userText || ''
    });
    trace.push({
      attempt: attemptNumber,
      passed: validation.passed,
      warnings: validation.warnings,
      hardWarnings: validation.hardWarnings,
      rewriteableWarnings: validation.rewriteableWarnings
    });

    if (validation.passed) {
      return {
        realization,
        validation: {
          ...validation,
          attempts: attemptNumber,
          rewrites: rewriteAttempt,
          trace
        },
        usage,
        retried: rewriteAttempt > 0,
        attempts: attemptNumber
      };
    }

    if (validation.hardWarnings?.length) {
      console.error('Rin Realization hard validation failure', {
        requestId: state?.requestId || null,
        attempt: attemptNumber,
        warnings: validation.warnings,
        hardWarnings: validation.hardWarnings
      });
      throw realizationFailure(validation, attemptNumber, 'hard_validation_failure');
    }

    if (rewriteAttempt >= MAX_REALIZATION_REWRITES) {
      console.error('Rin Realization rewrite exhausted', {
        requestId: state?.requestId || null,
        attempts: attemptNumber,
        warnings: validation.warnings
      });
      throw realizationFailure(validation, attemptNumber, 'rewrite_exhausted');
    }

    console.warn('Rin Realization rejected; rewriting same TurnDecision', {
      requestId: state?.requestId || null,
      attempt: attemptNumber,
      nextAttempt: attemptNumber + 1,
      warnings: validation.rewriteableWarnings
    });
    previousRealization = realization;
    previousValidation = validation;
  }

  throw realizationFailure(previousValidation, MAX_REALIZATION_REWRITES + 1, 'rewrite_exhausted');
}

export async function buildDeliveryPlan({ requestId, decision, realization, scene = null, stickerState = null } = {}) {
  const turnId = `rin-turn-${normalize(requestId, 80) || Date.now()}`;
  const realizedTexts = Array.isArray(realization?.segments) ? realization.segments : [];
  let textIndex = 0;
  const segments = [];
  const firstTextPlanIndex = decision.delivery.segments.findIndex(item => item?.type === 'text');
  for (let index = 0; index < decision.delivery.segments.length; index += 1) {
    const plan = decision.delivery.segments[index];
    const base = { id: `${turnId}-seg-${index + 1}`, segmentIndex: index, purpose: plan.purpose, type: plan.type };
    if (plan.type === 'text') {
      const text = String(realizedTexts[textIndex++]?.text || '').trim();
      if (text) segments.push({ ...base, text });
      continue;
    }
    const stickerDelivery = firstTextPlanIndex < 0
      ? 'sticker_only'
      : index < firstTextPlanIndex ? 'before_text' : 'after_text';
    const selected = await selectStickerForIntent(plan.stickerIntent, {
      delivery: stickerDelivery,
      scene: scene?.type || '',
      cause: decision.focus,
      intensity: decision.delivery.mode === 'sticker_only' ? 62 : 48,
    });
    if (!selected) throw Object.assign(new Error(`Sticker intent unresolved: ${plan.stickerIntent || '(empty)'}`), { code: 'STICKER_INTENT_UNRESOLVED' });
    segments.push({ ...base, stickerIntent: plan.stickerIntent, sticker: selected.sticker, semantic: selected });
  }
  return {
    schema: 'rin-delivery-plan-v1',
    turnId,
    mode: decision.delivery.mode,
    segments,
    fallbackText: segments.find(item => item.type === 'text')?.text || segments.find(item => item.type === 'sticker')?.sticker?.utterance || 'Мм.'
  };
}



async function validateDecisionResources(decision = null) {
  const warnings = [];
  for (const segment of Array.isArray(decision?.delivery?.segments) ? decision.delivery.segments : []) {
    if (segment?.type !== 'sticker' || !segment?.stickerIntent) continue;
    if (!await isStickerIntentResolvable(segment.stickerIntent)) warnings.push(`unresolved_sticker_intent:${normalize(segment.stickerIntent, 80)}`);
  }
  return warnings;
}

function mergeDecisionValidation(base = null, resourceWarnings = []) {
  const warnings = [...new Set([...(base?.warnings || []), ...(resourceWarnings || [])])];
  return { ...(base || {}), passed: warnings.length === 0, warnings };
}

export default async function handler(req, res) {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const body = await readJsonBody(req);
    if (!requirePin(req, res, body)) return;
    if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Chat service is not configured', code: 'CHAT_NOT_CONFIGURED' });

    const requestId = normalize(body.requestId, 100);
    if (!requestId) return res.status(400).json({ error: 'A request id is required', code: 'INVALID_REQUEST_ID' });
    const trigger = normalizeProactiveTrigger(body.trigger);
    const fullHistory = selectModelHistory(body.history || [], trigger ? {} : { includeRequestId: requestId });
    const history = pruneModelHistory(fullHistory, 48, 16_000);
    const group = trigger ? [] : currentUserGroup(fullHistory, requestId);
    const fallbackCurrent = trigger ? null : currentUserTurn(fullHistory, requestId);
    if (!trigger && !group.length && fallbackCurrent) group.push(fallbackCurrent);
    const userTurn = trigger ? '' : groupUserText(group);
    if (!trigger && !userTurn) return res.status(400).json({ error: 'A user message is required', code: 'INVALID_HISTORY' });

    const profile = await buildServerProfile(body.profile);
    const memory = body.memory && typeof body.memory === 'object' ? body.memory : null;
    const env = body.env && typeof body.env === 'object' ? body.env : null;
    const conversationState = trigger ? (fullHistory.length ? 'ongoing' : 'new') : detectConversationState(fullHistory);
    const explicitReply = trigger ? null : explicitReplyFromGroup(group, fullHistory);
    const isLong = trigger ? false : Boolean(body?.client?.forceLong) || detectLongMode(userTurn);
    const brain = trigger ? buildProactiveBrain({ trigger, memory }) : analyzeConversation({ userText: userTurn, history: fullHistory, conversationState });
    const canonCue = trigger ? [trigger.type, trigger.reason].filter(Boolean).join(' ') : userTurn;
    const lore = await retrieveCanonicalLore(canonCue);
    const affectiveTurn = buildAffectiveTurn({ userText: userTurn, history: fullHistory, memory, brain });
    const stickerState = await buildStickerState({
      history: fullHistory,
      preference: body?.client?.sticker || null,
      scene: brain?.activeScene?.type || 'everyday',
      userText: userTurn
    });
    const kernelState = buildKernelState({ requestId, userText: userTurn, history: fullHistory, memory, brain, affectiveTurn, explicitReply, env, lore, conversationState, stickerState });
    const realityBoundary = buildRealityBoundary({ profile, memory, lore, userText: userTurn, history: fullHistory });

    const kernelPrompt = buildKernelPrompt({
      profile,
      state: kernelState,
      client: { ...(body.client || {}), longRequested: isLong },
      trigger
    });
    const kernelCompletion = await openaiChat({
      model: KERNEL_MODEL,
      messages: [{ role: 'system', content: kernelPrompt.system }],
      response_format: kernelPrompt.responseFormat,
      ...KERNEL_PARAMS
    });
    if (kernelCompletion.finishReason === 'length' || !kernelCompletion.content) {
      return res.status(502).json({ error: 'Decision model response was truncated', code: 'MODEL_RESPONSE_TRUNCATED', requestId });
    }
    let decision;
    try { decision = parseKernelDecision(kernelCompletion.content); }
    catch { return res.status(502).json({ error: 'Decision model returned invalid structured output', code: 'INVALID_TURN_DECISION', requestId }); }

    // Deterministic validation may reject an invalid decision, but it never substitutes
    // a different behavior. The same Cognitive Kernel gets one chance to decide again.
    let decisionUsage = kernelCompletion.usage;
    let decisionValidation = mergeDecisionValidation(
      validateTurnDecisionConstraints(decision, { conversationState, client: body.client || {}, activeIntent: kernelState.activeIntent, stickerState: kernelState.stickerState, visualReplyCandidates: kernelState.visualReplyCandidates, reciprocity: kernelState.reciprocity }),
      await validateDecisionResources(decision)
    );
    if (!decisionValidation.passed) {
      console.warn('Rin TurnDecision rejected; retrying same kernel', { requestId, warnings: decisionValidation.warnings });
      const retryCompletion = await openaiChat({
        model: KERNEL_MODEL,
        messages: [{
          role: 'system',
          content: `${kernelPrompt.system}\n\nПредыдущее TurnDecision нарушило protocol/state invariants: ${decisionValidation.warnings.join(', ')}. Прими решение заново как ТОТ ЖЕ единственный Cognitive Kernel; validator не предлагает альтернативное действие.`
        }],
        response_format: kernelPrompt.responseFormat,
        ...KERNEL_PARAMS
      });
      if (retryCompletion.finishReason === 'length' || !retryCompletion.content) {
        return res.status(502).json({ error: 'Decision model retry was truncated', code: 'MODEL_RESPONSE_TRUNCATED', requestId });
      }
      try { decision = parseKernelDecision(retryCompletion.content); }
      catch { return res.status(502).json({ error: 'Decision model retry returned invalid structured output', code: 'INVALID_TURN_DECISION', requestId }); }
      decisionUsage = mergeUsage(kernelCompletion.usage, retryCompletion.usage);
      decisionValidation = mergeDecisionValidation(
        validateTurnDecisionConstraints(decision, { conversationState, client: body.client || {}, activeIntent: kernelState.activeIntent, stickerState: kernelState.stickerState, visualReplyCandidates: kernelState.visualReplyCandidates, reciprocity: kernelState.reciprocity }),
        await validateDecisionResources(decision)
      );
      if (!decisionValidation.passed) {
        console.error('Rin TurnDecision rejected after retry', { requestId, warnings: decisionValidation.warnings });
        return res.status(502).json({ error: 'Decision model violated protocol/state invariants', code: 'INVALID_TURN_DECISION', requestId, warnings: decisionValidation.warnings });
      }
    }

    const realizationResult = await realizeDecision({ profile, state: kernelState, decision, realityBoundary, isLong });
    const deliveryPlan = await buildDeliveryPlan({ requestId, decision, realization: realizationResult.realization, scene: kernelState.scene, stickerState: kernelState.stickerState });
    const stateTransition = buildDecisionStateTransition({ kernelState, affectiveTurn, decision });
    const visualReply = visualReplyFromDecision(decision, group);
    const reply = deliveryPlan.segments.filter(item => item.type === 'text').map(item => item.text).join('\n\n');
    const usage = mergeUsage(decisionUsage, realizationResult.usage);

    return res.status(200).json({
      requestId,
      turnId: deliveryPlan.turnId,
      reply,
      finishReason: 'stop',
      model: { kernel: kernelCompletion.model || KERNEL_MODEL, realization: REALIZATION_MODEL },
      long: isLong,
      promptMetrics: {
        promptVersion: 'rin-cognitive-kernel-v1',
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        historyItems: history.length
      },
      perception: brain,
      cognition: compactKernelState(kernelState),
      turnDecision: decision,
      visualReply,
      affectiveTurn,
      validation: { decision: decisionValidation, realization: realizationResult.validation },
      deliveryPlan,
      stateTransition,
      trigger
    });
  } catch (error) {
    console.error('Chat error', error);
    const mapped = publicError(error, 'Chat internal error');
    return res.status(mapped.status).json(mapped.body);
  }
}
