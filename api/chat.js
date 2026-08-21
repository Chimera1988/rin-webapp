import { analyzeConversation } from '../lib/conversation-brain.js';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState, compactKernelState } from '../lib/cognition/kernel-state.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { validateRealization, validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import { buildRealityBoundary } from '../lib/cognition/reality-boundary.js';
import { isStickerIntentResolvable, selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { buildStickerState } from '../lib/cognition/sticker-state.js';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { buildDriveState } from '../lib/cognition/drive-state.js';
import { stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';
import {
  buildDeterministicConversationFallback,
  buildRinMindPrompt,
  parseRinMind
} from '../lib/cognition/rin-mind.js';
import {
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
const MIND_MODEL = process.env.OPENAI_MIND_MODEL || process.env.OPENAI_DECISION_MODEL || 'gpt-4.1';
const MIND_PARAMS = { temperature: 0.58, max_tokens: 1200 };
const LONG_MIND_PARAMS = { temperature: 0.58, max_tokens: 2200 };

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

// Transport retry is intentionally the only automatic model retry left in the pipeline.
// Semantic/style validation never launches another paid model call.
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
      model: data?.model || model,
      requestAttempts: attempt + 1
    };
  }
  throw upstreamError('OpenAI request failed', 'UPSTREAM_UNAVAILABLE');
}

function usageOrZero(usage = null) {
  return {
    prompt_tokens: Number(usage?.prompt_tokens) || 0,
    completion_tokens: Number(usage?.completion_tokens) || 0,
    total_tokens: Number(usage?.total_tokens) || 0
  };
}

function makeFallbackMindTurn({ userText = '', behaviorState = null } = {}) {
  const text = buildDeterministicConversationFallback({ behaviorState, userText });
  const decision = normalizeTurnDecision({
    act: behaviorState?.question?.strongNoQuestion ? 'respect_user_boundary' : 'minimal_acknowledgment',
    focus: behaviorState?.question?.strongNoQuestion
      ? 'уважить просьбу пользователя не задавать вопросы'
      : 'сохранить устойчивый контакт без технической ошибки',
    stance: 'короткая, спокойная, личная',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { segments: [{ type: 'text', purpose: 'fallback', stickerIntent: null, maxChars: 320 }] },
    intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded'
  }, { source: 'deterministic_fallback' });
  return {
    mind: {
      felt: 'сохраняет контакт после технически неиспользуемого model output',
      wants: 'ответить без повторного платного inference',
      restraint: 'не выдавать внутреннюю ошибку пользователю',
      socialIntent: 'stable_fallback',
      confidence: 100
    },
    decision,
    realization: { segments: [{ type: 'text', purpose: 'fallback', text }] },
    fallback: true
  };
}

async function decisionResourceWarnings(decision = null) {
  const warnings = [];
  for (const segment of Array.isArray(decision?.delivery?.segments) ? decision.delivery.segments : []) {
    if (segment?.type !== 'sticker') continue;
    if (!segment?.stickerIntent || !await isStickerIntentResolvable(segment.stickerIntent)) {
      warnings.push(`unresolved_sticker_intent:${normalize(segment?.stickerIntent, 80) || 'empty'}`);
    }
  }
  return warnings;
}

function advisoryDecisionValidation(decision = null, context = {}, resourceWarnings = []) {
  const base = validateTurnDecisionConstraints(decision, context);
  const warnings = [...new Set([...(base?.warnings || []), ...(resourceWarnings || [])])];
  const hardPrefixes = [
    'unresolved_sticker_intent:',
    'visual_reply_target_not_allowed',
    'sticker_segment_requires_intent',
    'sticker_disabled_by_user',
    'sticker_unavailable_by_state'
  ];
  const hardWarnings = warnings.filter(warning => hardPrefixes.some(prefix => warning === prefix || warning.startsWith(prefix)));
  const softWarnings = warnings.filter(warning => !hardWarnings.includes(warning));
  return {
    version: 'rin-turn-decision-validator-v3-advisory',
    passed: hardWarnings.length === 0,
    accepted: true,
    warnings,
    hardWarnings,
    softWarnings
  };
}

function fallbackOnHardDecision({ mindTurn, validation, userText, behaviorState }) {
  if (!validation?.hardWarnings?.length) return mindTurn;
  // Hard delivery/resource mismatch is recovered locally instead of making another LLM call.
  return makeFallbackMindTurn({ userText, behaviorState });
}

function advisoryRealizationValidation(realization = null, context = {}) {
  const base = validateRealization(realization, context);
  return {
    ...base,
    version: 'rin-turn-validator-v3-advisory',
    // Soft conversational/style warnings never fail the turn.
    passed: !(base?.hardWarnings?.length),
    accepted: !(base?.hardWarnings?.length),
    softWarnings: Array.isArray(base?.rewriteableWarnings) ? base.rewriteableWarnings : [],
    attempts: 1,
    rewrites: 0,
    trace: [{
      attempt: 1,
      passed: base?.warnings?.length === 0,
      warnings: base?.warnings || [],
      hardWarnings: base?.hardWarnings || [],
      rewriteableWarnings: base?.rewriteableWarnings || []
    }]
  };
}

export async function buildDeliveryPlan({ requestId, decision, realization, scene = null, stickerState = null, mind = null } = {}) {
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
      cause: mind?.wants || decision.focus,
      intensity: decision.delivery.mode === 'sticker_only' ? 62 : 48
    });
    if (!selected) continue;
    segments.push({ ...base, stickerIntent: plan.stickerIntent, sticker: selected.sticker, semantic: selected });
  }
  return {
    schema: 'rin-delivery-plan-v2',
    turnId,
    mode: decision.delivery.mode,
    segments,
    fallbackText: segments.find(item => item.type === 'text')?.text || 'Мм.'
  };
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
    // Deterministic cognition may inspect fullHistory, but the model receives a much smaller compact state.
    const history = pruneModelHistory(fullHistory, 28, 10_000);
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
    const behaviorState = buildBehaviorState({ userText: userTurn, history: fullHistory, brain });
    const kernelState = buildKernelState({
      requestId,
      userText: userTurn,
      history: fullHistory,
      memory,
      brain,
      affectiveTurn,
      explicitReply,
      env,
      lore,
      conversationState,
      stickerState
    });
    const realityBoundary = buildRealityBoundary({ profile, memory, lore, userText: userTurn, history: fullHistory });
    const driveState = buildDriveState({ state: kernelState, affectiveTurn, behaviorState, brain });
    const stickerCandidates = (stickerState.hardAvailable ?? stickerState.available) === true
      ? buildStickerCandidates({ userText: userTurn, state: kernelState, brain, affectiveTurn, limit: 12 })
      : [];
    const mindState = { ...kernelState, behaviorState, driveState, realityBoundary, stickerCandidates };
    const prompt = buildRinMindPrompt({
      profile,
      state: mindState,
      client: { ...(body.client || {}), longRequested: isLong },
      trigger
    });

    const completion = await openaiChat({
      model: MIND_MODEL,
      messages: [{ role: 'system', content: prompt.system }],
      response_format: prompt.responseFormat,
      ...(isLong ? LONG_MIND_PARAMS : MIND_PARAMS)
    });

    let mindTurn;
    let modelFallback = false;
    if (completion.finishReason === 'length' || !completion.content) {
      mindTurn = makeFallbackMindTurn({ userText: userTurn, behaviorState });
      modelFallback = true;
    } else {
      try {
        mindTurn = parseRinMind(completion.content, { behaviorState });
      } catch (error) {
        console.warn('Rin Mind structured output unusable; deterministic fallback used', {
          requestId,
          error: error?.message || String(error)
        });
        mindTurn = makeFallbackMindTurn({ userText: userTurn, behaviorState });
        modelFallback = true;
      }
    }

    const stabilized = stabilizeTurn({
      decision: mindTurn.decision,
      realization: mindTurn.realization,
      activeIntent: kernelState.activeIntent,
      conversationState,
      stickerState: kernelState.stickerState,
      visualReplyCandidates: kernelState.visualReplyCandidates,
      behaviorState,
      fallbackText: buildDeterministicConversationFallback({ behaviorState, userText: userTurn })
    });
    mindTurn.decision = stabilized.decision;
    mindTurn.realization = stabilized.realization;

    let resourceWarnings = await decisionResourceWarnings(mindTurn.decision);
    let decisionValidation = advisoryDecisionValidation(mindTurn.decision, {
      conversationState,
      client: body.client || {},
      activeIntent: kernelState.activeIntent,
      stickerState: { ...kernelState.stickerState, available: kernelState.stickerState?.hardAvailable ?? kernelState.stickerState?.available },
      visualReplyCandidates: kernelState.visualReplyCandidates,
      reciprocity: kernelState.reciprocity
    }, resourceWarnings);

    mindTurn = fallbackOnHardDecision({
      mindTurn,
      validation: decisionValidation,
      userText: userTurn,
      behaviorState
    });
    if (decisionValidation.hardWarnings.length) {
      modelFallback = true;
      resourceWarnings = [];
      decisionValidation = advisoryDecisionValidation(mindTurn.decision, {
        conversationState,
        client: body.client || {},
        activeIntent: kernelState.activeIntent,
        stickerState: { ...kernelState.stickerState, available: kernelState.stickerState?.hardAvailable ?? kernelState.stickerState?.available },
        visualReplyCandidates: kernelState.visualReplyCandidates,
        reciprocity: kernelState.reciprocity
      }, []);
    }

    let realizationValidation = advisoryRealizationValidation(mindTurn.realization, {
      decision: mindTurn.decision,
      realityBoundary,
      recentHistory: kernelState?.recentHistory || [],
      currentUserText: kernelState?.userText || ''
    });

    // Truly hard realization violations (metadata leak, unsupported reality claim, etc.)
    // are replaced locally. No second model call, no user-visible validation error.
    if (realizationValidation.hardWarnings?.length) {
      mindTurn = makeFallbackMindTurn({ userText: userTurn, behaviorState });
      modelFallback = true;
      decisionValidation = advisoryDecisionValidation(mindTurn.decision, {
        conversationState,
        client: body.client || {},
        activeIntent: kernelState.activeIntent,
        stickerState: { ...kernelState.stickerState, available: kernelState.stickerState?.hardAvailable ?? kernelState.stickerState?.available },
        visualReplyCandidates: kernelState.visualReplyCandidates,
        reciprocity: kernelState.reciprocity
      }, []);
      realizationValidation = advisoryRealizationValidation(mindTurn.realization, {
        decision: mindTurn.decision,
        realityBoundary,
        recentHistory: kernelState?.recentHistory || [],
        currentUserText: kernelState?.userText || ''
      });
    }

    const deliveryPlan = await buildDeliveryPlan({
      requestId,
      decision: mindTurn.decision,
      realization: mindTurn.realization,
      scene: kernelState.scene,
      stickerState: kernelState.stickerState,
      mind: mindTurn.mind
    });

    // A sticker-only render may theoretically disappear if a catalog asset changed between
    // schema construction and delivery. Recover as text rather than returning a 502.
    if (!deliveryPlan.segments.length && mindTurn.decision.delivery.mode !== 'silence') {
      mindTurn = makeFallbackMindTurn({ userText: userTurn, behaviorState });
      modelFallback = true;
      deliveryPlan.segments = [{
        id: `rin-turn-${normalize(requestId, 80)}-fallback`,
        segmentIndex: 0,
        purpose: 'fallback',
        type: 'text',
        text: mindTurn.realization.segments[0].text
      }];
      deliveryPlan.mode = 'single_text';
      deliveryPlan.fallbackText = mindTurn.realization.segments[0].text;
    }

    const stateTransition = buildDecisionStateTransition({
      kernelState,
      affectiveTurn,
      decision: mindTurn.decision
    });
    const visualReply = visualReplyFromDecision(mindTurn.decision, group);
    const reply = deliveryPlan.segments.filter(item => item.type === 'text').map(item => item.text).join('\n\n');
    const usage = usageOrZero(completion.usage);

    return res.status(200).json({
      requestId,
      turnId: deliveryPlan.turnId,
      reply,
      finishReason: 'stop',
      model: {
        mind: completion.model || MIND_MODEL,
        kernel: 'integrated-in-rin-mind-v2',
        realization: 'integrated-in-rin-mind-v2'
      },
      long: isLong,
      promptMetrics: {
        promptVersion: 'rin-mind-v2',
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        calls: { mind: 1, kernel: 0, realization: 0, transportAttempts: completion.requestAttempts || 1 },
        historyItems: history.length,
        modelFallback,
        semanticRetries: 0
      },
      perception: brain,
      cognition: { ...compactKernelState(kernelState), behaviorState, driveState },
      mind: mindTurn.mind,
      turnDecision: mindTurn.decision,
      visualReply,
      affectiveTurn,
      validation: {
        decision: decisionValidation,
        realization: realizationValidation,
        stabilization: stabilized.warnings,
        policy: 'hard-block-only; soft warnings are advisory; no semantic LLM retries'
      },
      fastPath: false,
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
