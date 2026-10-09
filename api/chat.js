import { createHash } from 'node:crypto';
import { analyzeConversation } from '../lib/conversation-brain.js';
import { observeAffectiveTurn } from '../lib/cognition/emotional-state.js';
import { buildKernelState, compactKernelState } from '../lib/cognition/kernel-state.js';
import { buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { validateRealization, validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import { buildRealityBoundary } from '../lib/cognition/reality-boundary.js';
import { isStickerIntentResolvable, selectStickerForIntent } from '../lib/cognition/sticker-selector.js';
import { buildStickerState } from '../lib/cognition/sticker-state.js';
import { buildStickerCandidates } from '../lib/cognition/sticker-candidates.js';
import { extractVocativeAddresses, inspectMotifNovelty, inspectSceneClosure } from '../lib/cognition/behavior-state.js';
import { observeTurn } from '../lib/cognition/v3/turn-observations.js';
import { activateAssociations } from '../lib/cognition/v3/associative-memory.js';
import { inspectLifeNovelty } from '../lib/cognition/life-texture.js';
import { repairMaleUserAddress, stripMessengerAsteriskMarkup } from '../lib/cognition/turn-stabilizer.js';
import { inspectIntentLifecycle } from '../lib/cognition/intent-policy.js';
import { mapCognitiveInputs, settleCognitiveGraph } from '../lib/cognition/v3/cognitive-dynamics.js';
import { buildCognitiveTurnPlan } from '../lib/cognition/v3/turn-plan.js';
import { groundCurrentWeather } from '../lib/cognition/v3/weather-grounding.js';
import { buildV3RealizationPrompt, parseV3Realization, v3FallbackRealization, unauthorizedSpeechAct, validateV3LifeRealization } from '../lib/cognition/v3/realization.js';
import { detectExperienceEvidence, updateCognitiveExperience } from '../lib/cognition/v3/experience.js';
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
const MIND_MODEL = process.env.OPENAI_MIND_MODEL || process.env.OPENAI_DECISION_MODEL || 'gpt-6-luna';
const MIND_REASONING_EFFORT = process.env.OPENAI_MIND_REASONING_EFFORT
  || (MIND_MODEL === 'gpt-6-luna' ? 'none' : null);
const MIND_PARAMS = { temperature: 0.58, max_tokens: 1200 };
const LONG_MIND_PARAMS = { temperature: 0.58, max_tokens: 2200 };

const normalize = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function detectLongMode(userText) {
  const text = normalize(userText, 4000).toLowerCase();
  return /(подробно|очень подробно|развернуто|развёрнуто|во всех деталях|полный разбор|объясни пошагово|расскажи подробнее|продолжай|расскажи ещё|можешь продолжить|сравни|проанализируй|составь план|пошаговая инструкция|технически объясни|разбери по пунктам)/iu.test(text);
}

export function detectConversationState(history = []) {
  const last = [...history].reverse().find(item => item?.role === 'user');
  if (!last) return 'new';
  if (isExplicitFarewell(last?.content)) return 'ending';
  return inspectSceneClosure(history, last?.content || '').strong ? 'ending' : 'ongoing';
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

export function supportsExplicitPromptCache(model = '') {
  const value = String(model || '').trim().toLowerCase();
  if (/^gpt-6(?:[.-]|$)/u.test(value)) return true;
  const match = value.match(/^gpt-5\.(\d+)(?:[.-]|$)/u);
  return Boolean(match && Number(match[1]) >= 6);
}

export function buildMindCacheKey(stableSystem = '', model = '', responseFormat = null) {
  const stable = String(stableSystem || '').trim();
  if (!stable || !supportsExplicitPromptCache(model)) return null;
  // Structured-output instructions are rendered before developer content and are
  // therefore part of the reusable prefix. Include the static schema in the
  // accounting key so the debug key tracks the complete stable cache contract.
  const format = responseFormat && typeof responseFormat === 'object' ? JSON.stringify(responseFormat) : '';
  const digest = createHash('sha256').update(`${String(model || '').toLowerCase()}\n${format}\n${stable}`, 'utf8').digest('hex').slice(0, 40);
  return `rin-mind-${digest}`;
}

export function buildMindMessages(prompt = null, model = '') {
  const system = String(prompt?.system || '').trim();
  const stable = String(prompt?.stableSystem || '').trim();
  const dynamic = String(prompt?.dynamicSystem || '').trim();
  if (!supportsExplicitPromptCache(model) || !stable || !dynamic) {
    return [{ role: 'system', content: system }];
  }
  // GPT-5.6+ explicit caching is most predictable when the reusable developer
  // prefix is its own message and the volatile turn state is appended as a new
  // message. Do not extend the cached message with dynamic content.
  return [
    {
      role: 'developer',
      content: [{ type: 'text', text: stable, prompt_cache_breakpoint: { mode: 'explicit' } }]
    },
    { role: 'developer', content: dynamic }
  ];
}

// Transport retry is intentionally the only automatic model retry left in the pipeline.
// Semantic/style validation never launches another paid model call.
export async function openaiChat({ model, messages, temperature, max_tokens, response_format = null, reasoning_effort = null, prompt_cache_options = null, prompt_cache_key = null }) {
  const body = { model, messages };
  const isGpt6 = /^gpt-6(?:[.-]|$)/iu.test(String(model || ''));
  const reasoningEffort = reasoning_effort ? String(reasoning_effort).trim().toLowerCase() : null;

  // GPT-6 Chat Completions uses max_completion_tokens. Keep legacy max_tokens for older models
  // so OPENAI_MIND_MODEL can still be used as a rollback switch during the Luna evaluation.
  if (max_tokens != null) {
    if (isGpt6) body.max_completion_tokens = max_tokens;
    else body.max_tokens = max_tokens;
  }
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  // GPT-6 accepts sampling controls only when reasoning effort is none.
  if (temperature != null && (!isGpt6 || !reasoningEffort || reasoningEffort === 'none')) body.temperature = temperature;
  if (response_format) body.response_format = response_format;
  if (prompt_cache_options && supportsExplicitPromptCache(model)) body.prompt_cache_options = prompt_cache_options;
  if (prompt_cache_key && supportsExplicitPromptCache(model)) body.prompt_cache_key = String(prompt_cache_key).slice(0, 64);

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
    total_tokens: Number(usage?.total_tokens) || 0,
    cached_tokens: Number(usage?.prompt_tokens_details?.cached_tokens) || 0,
    cache_write_tokens: Number(usage?.prompt_tokens_details?.cache_write_tokens) || 0,
    reasoning_tokens: Number(usage?.completion_tokens_details?.reasoning_tokens) || 0
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
  const handlerStartedAt = Date.now();
  let modelStartedAt = 0;
  let modelDurationMs = null;
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
    // One affective state pathway restores v2.5 relationship/mood accumulation; TurnPlan remains the sole behavioral action owner.
    const affectiveTurn = observeAffectiveTurn({userText:userTurn,memory,brain});
    const stickerState = await buildStickerState({
      history: fullHistory,
      preference: body?.client?.sticker || null,
      scene: brain?.activeScene?.type || 'everyday',
      userText: userTurn
    });
    // No legacy behavior-state action computation. Read-only scene/boundary telemetry.
    const turnObservations=observeTurn({userText:userTurn,history:fullHistory,brain,memory});
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
    // Observed API weather is safe to use only when its timestamp is current.
    kernelState.environment = groundCurrentWeather(kernelState.environment, env);
    const realityBoundary = buildRealityBoundary({ profile, memory, lore, userText: userTurn, history: fullHistory });
    const sharedSymbolState = activateAssociations({
      profile,memory,kernelState,saved:memory?.cognitiveState
    });
    const stickerCandidates = stickerState.available === true
      ? buildStickerCandidates({ userText: userTurn, state: kernelState, brain, affectiveTurn, limit: 12 })
      : [];
    // Rin 3: all domain observations enter one recurrent cognitive graph.
    // Luna receives only a resolved TurnPlan and produces LANGUAGE, not decisions.
    const cognitiveInputs = mapCognitiveInputs({kernelState,observations:turnObservations,sharedSymbolState});
    const cognitiveSettled = settleCognitiveGraph({inputs:cognitiveInputs,saved:memory?.cognitiveState});
    const turnPlan = buildCognitiveTurnPlan({
      settled:cognitiveSettled,kernelState,observations:turnObservations,stickerState,stickerCandidates,
      sharedSymbolState,longRequested:isLong,trigger
    });
    const prompt = buildV3RealizationPrompt({
      profile,kernelState,plan:turnPlan,sharedSymbolState,realityBoundary,lore,longRequested:isLong,trigger
    });
    const explicitPromptCache = supportsExplicitPromptCache(MIND_MODEL);
    const promptCacheKey = explicitPromptCache ? buildMindCacheKey(prompt.stableSystem, MIND_MODEL, prompt.responseFormat) : null;
    let completion = {content:'',finishReason:'silence',usage:null,model:MIND_MODEL,requestAttempts:0};
    if(turnPlan.needsVoice){
      modelStartedAt = Date.now();
      completion = await openaiChat({
        model:MIND_MODEL,
        messages:buildMindMessages(prompt,MIND_MODEL),
        response_format:prompt.responseFormat,
        reasoning_effort:MIND_REASONING_EFFORT,
        prompt_cache_options:explicitPromptCache?{mode:'explicit',ttl:'30m'}:null,
        prompt_cache_key:promptCacheKey,
        ...(isLong?LONG_MIND_PARAMS:MIND_PARAMS)
      });
      modelDurationMs = Date.now() - modelStartedAt;
    }
    let modelFallback=false;
    let realization={segments:[]};
    if(turnPlan.needsVoice){
      try{
        if(!completion.content||completion.finishReason==='length')throw new Error('model_response_empty_or_truncated');
        realization=parseV3Realization(completion.content,turnPlan);
      }catch(error){
        modelFallback=true;
        console.warn('Rin v3 Luna realization unusable; local realization used', {requestId,error:error?.message});
        realization=v3FallbackRealization(turnPlan,kernelState);
      }
    }
    // Content-only conformance: no code downstream can reselect the behavioral action.
    const plannedDecision=turnPlan.decision;
    let questionSanitized=false;
    const cleanRealization = original => ({segments:(original?.segments||[]).map(segment=>{
      let text=repairMaleUserAddress(stripMessengerAsteriskMarkup(String(segment.text||'')));
      if(plannedDecision.question.mode==='none' && /\?/u.test(text)){
        questionSanitized=true;
        const without=text.replace(/[.!…)»]\s*[^.!?]*\?/gu,'').replace(/^[^.!?]*\?/u,'').replace(/\s+/g,' ').trim();
        text=without||v3FallbackRealization(turnPlan,kernelState).segments[0]?.text||'Мм.';
      }
      return {...segment,text};
    })});
    realization=cleanRealization(realization);
    // Track content sanitization separately from JSON/model fallback.
    // A required question is a binding obligation of an accepted scene.
    if(plannedDecision.question.mode==='required' &&
      !realization.segments.some(s=>/\?/u.test(s.text||''))){
      modelFallback=true;
      realization=v3FallbackRealization(turnPlan,kernelState);
    }
    const questionWasSanitized=questionSanitized;
    const decisionValidation=advisoryDecisionValidation(plannedDecision,{
      conversationState,client:body.client||{},activeIntent:kernelState.activeIntent,
      stickerState:kernelState.stickerState,
      visualReplyCandidates:kernelState.visualReplyCandidates,
      reciprocity:null
    },await decisionResourceWarnings(plannedDecision));
    let realizationValidation=advisoryRealizationValidation(realization,{
      decision:plannedDecision,realityBoundary,recentHistory:kernelState?.recentHistory||[],currentUserText:userTurn
    });
    const unauthorizedAct=unauthorizedSpeechAct(realization,turnPlan);
    const unsupportedLife=validateV3LifeRealization(realization,turnPlan.life);
    if(unauthorizedAct)realizationValidation.hardWarnings.push(unauthorizedAct);
    if(unsupportedLife)realizationValidation.hardWarnings.push(unsupportedLife);
    if(realizationValidation.hardWarnings?.length){
      modelFallback=true;
      realization=cleanRealization(unsupportedLife?{
        segments:(turnPlan.decision.delivery.segments||[]).filter(s=>s.type==='text').map((s,i)=>({
          text:['reopened_completed_work','unconfirmed_new_work'].includes(unsupportedLife)?
            (i===0?'Ты прав, я уже сказала, что убрала бумаги. Больше не буду их возвращать на стол.':'Теперь могу просто побыть рядом.'):
            unsupportedLife==='unconfirmed_completed_meal'?
              (i===0?'Я пока только собиралась поесть, так что говорить «ужин съеден» рано.':'Сначала надо действительно поужинать.'):
              (i===0?'Пока нет, ещё не выбралась на прогулку. Но хочется немного пройтись.':'Пока только строила планы, а не выбиралась в город.'),purpose:s.purpose
        }))
      }:v3FallbackRealization(turnPlan,kernelState));
      realizationValidation=advisoryRealizationValidation(realization,{
        decision:plannedDecision,realityBoundary,recentHistory:kernelState?.recentHistory||[],currentUserText:userTurn
      });
    }
    const mind={
      felt:`${cognitiveInputs.evidence.primaryEmotion||'спокойная'}; approach=${cognitiveSettled.behavioralState.approach}`,
      wants:plannedDecision.focus,restraint:turnPlan.constraints.depthCap,
      socialIntent:plannedDecision.act,
      sceneMotif:turnPlan.sceneMotif,
      lifeDomain:turnPlan.life.domain,lifeMotif:turnPlan.life.motif,frameAlignment:turnPlan.frameAlignment,literalCorrection:turnObservations?.literalCorrection?.explicit?'explicit':'none',
      referenceAnchor:turnPlan.referenceAnchor,sharedSymbolId:turnPlan.symbolId,sharedSymbolExpression:turnPlan.symbolExpression,
      sharedSymbolReason:turnPlan.symbolId?'associative_cognitive_activation':null,
      contactStance:turnPlan.contactStance,selfStateDisclosure:turnPlan.selfStateDisclosure,selfStateDisclosureReason:'settled_cognition',
      commitmentAction:turnPlan.commitment.action,commitmentConflict:turnPlan.commitment.action==='insist'?'mild':'none',commitmentTargetId:turnPlan.commitment.targetId||null,
      commitmentSubject:turnPlan.commitment.subject,
      commitmentOwner:turnPlan.commitment.owner,commitmentStrength:turnPlan.commitment.strength,
      commitmentReason:turnPlan.commitment.reason,confidence:95
    };
    const mindTurn={mind,decision:plannedDecision,realization};
    turnObservations.frameAlignment=mind.frameAlignment;
    turnObservations.sceneMotif=mind.sceneMotif;
    const deliveryPlan=await buildDeliveryPlan({
      requestId,decision:plannedDecision,realization,scene:kernelState.scene,stickerState:kernelState.stickerState,mind
    });
    if(!deliveryPlan.segments.length&&deliveryPlan.mode!=='silence'){
      modelFallback=true;
      const fallback=cleanRealization(v3FallbackRealization(turnPlan,kernelState));
      deliveryPlan.segments=[{id:`rin-turn-${requestId}-fallback`,segmentIndex:0,purpose:'fallback',type:'text',text:fallback.segments[0]?.text||'Мм.'}];
      deliveryPlan.mode='single_text';deliveryPlan.fallbackText=deliveryPlan.segments[0].text;
    }
    const stateTransition=buildDecisionStateTransition({
      kernelState,affectiveTurn,decision:plannedDecision,mind,userText:userTurn
    });
    const feedback=detectExperienceEvidence(userTurn,fullHistory);
    const cognitiveExperience=updateCognitiveExperience({
      previous:memory?.cognitiveState,settled:cognitiveSettled,plan:turnPlan,
      evidence:feedback,requestId
    });
    stateTransition.cognitiveState=cognitiveExperience.state;
    const visualReply = visualReplyFromDecision(mindTurn.decision, group);
    const reply = deliveryPlan.segments.filter(item => item.type === 'text').map(item => item.text).join('\n\n');
    const realizedVocatives = extractVocativeAddresses(reply);
    const primaryVocative = realizedVocatives[0] || null;
    const usage = usageOrZero(completion.usage);
    const intentTelemetry = inspectIntentLifecycle({
      activeIntent: kernelState.activeIntent,
      recentIntents: kernelState.recentIntents,
      decision: mindTurn.decision,
      revision: kernelState.revision,
      recentActs: kernelState.dialogueState?.recentActs || []
    });
    const motifTelemetry = inspectMotifNovelty(stateTransition?.dialogueState?.recentMotifs || []);
    const lifeTelemetry = inspectLifeNovelty(stateTransition?.dialogueState?.recentLifeBeats || []);
    const currentLifeMotif = mindTurn.mind?.lifeMotif || null;
    const currentLifeAppearances = currentLifeMotif
      ? (lifeTelemetry.recentBeats || []).filter(item => item?.motif === currentLifeMotif).length
      : 0;
    const appliedCommitment = [...(stateTransition?.dialogueState?.sceneCommitments || [])]
      .reverse()
      .find(item => Number(item?.updatedAtTurn) === Number(kernelState.revision || 0) + 1) || null;
    const resolvedLoopIds = new Set(Array.isArray(stateTransition?.resolvedLoopIds) ? stateTransition.resolvedLoopIds : []);
    const callbackLoopMap = new Map();
    for (const loop of Array.isArray(kernelState?.openLoops) ? kernelState.openLoops : []) {
      if (loop?.id && !resolvedLoopIds.has(loop.id)) callbackLoopMap.set(loop.id, loop);
    }
    for (const loop of Array.isArray(stateTransition?.openLoopUpdates) ? stateTransition.openLoopUpdates : []) {
      if (loop?.id && !resolvedLoopIds.has(loop.id)) callbackLoopMap.set(loop.id, loop);
    }
    const activeFutureCallbacks = [...callbackLoopMap.values()].filter(item => item?.type === 'future_callback');
    const detectedFutureCallback = (stateTransition?.openLoopUpdates || []).find(item => item?.type === 'future_callback' && item?.source === 'user_future_callback') || null;
    const resolvedFutureCallback = [...resolvedLoopIds].find(id => (kernelState?.openLoops || []).some(item => item?.id === id && item?.type === 'future_callback')) || null;
    const sharedSymbolCandidate = (sharedSymbolState?.candidates || [])[0] || null;
    const appliedSharedSymbol = (sharedSymbolState?.candidates || [])
      .find(item => item?.id === mindTurn.mind?.sharedSymbolId) || null;
    const sceneControl = {
      sceneMotif: mindTurn.mind?.sceneMotif || 'direct_exchange',
      frameAlignment: mindTurn.mind?.frameAlignment || 'aligned',
      motifRepeat: motifTelemetry.streak || 0,
      motifAppearances: motifTelemetry.appearances || 0,
      motifPressure: motifTelemetry.pressure || 0,
      literalCorrection: turnObservations?.literalCorrection?.explicit ? 'explicit' : (mindTurn.mind?.literalCorrection || 'none'),
      referenceAnchor: mindTurn.mind?.referenceAnchor || null,
      lifeDomain: mindTurn.mind?.lifeDomain || 'none',
      lifeMotif: currentLifeMotif,
      lifeMotifAppearances: currentLifeAppearances,
      lifeNoveltyPressure: Number(lifeTelemetry.pressure || 0),
      lifeEnergy: Number(kernelState?.innerLife?.energy ?? 0),
      mentalLoad: Number(kernelState?.innerLife?.mentalLoad ?? 0),
      needForQuiet: Number(kernelState?.innerLife?.needForQuiet ?? 0),
      desireToShare: Number(kernelState?.innerLife?.desireToShare ?? 0),
      dayType: kernelState?.innerLife?.dayType || 'weekday',
      workMode: kernelState?.innerLife?.workMode || 'normal',
      sleepPhase: kernelState?.innerLife?.sleepPhase || 'awake',
      sleepDebtMinutes: Number(kernelState?.innerLife?.sleepDebtMinutes ?? 0),
      sleepInterruptions: Number(kernelState?.innerLife?.sleepInterruptions ?? 0),
      lateConversationMinutes: Number(kernelState?.innerLife?.lateConversationMinutes ?? 0),
      wakeReason: kernelState?.innerLife?.wakeReason || 'unknown',
      activitySetting: kernelState?.innerLife?.activitySetting || 'unknown',
      weatherGrounded: Boolean(kernelState?.innerLife?.weatherGrounded),
      contactStance: mindTurn.mind?.contactStance || 'open',
      selfStateDisclosure: mindTurn.mind?.selfStateDisclosure || 'none',
      selfStateDisclosureReason: mindTurn.mind?.selfStateDisclosureReason || null,
      relationalSafety: Number(kernelState?.relationalConstancy?.relationalSafety || 0),
      relationalStatePressure: Number(kernelState?.relationalConstancy?.statePressure || 0),
      quietPresencePreferred: Boolean(kernelState?.relationalConstancy?.quietPresencePreferred),
      disclosureOpportunity: Boolean(kernelState?.relationalConstancy?.disclosureOpportunity),
      responseDepth: mindTurn.decision?.delivery?.responseDepth || 'normal',
      responseShortLock: Number(turnObservations?.responseRhythm?.shortLockPressure || 0),
      responseSingleLock: Number(turnObservations?.responseRhythm?.singleLockPressure || 0),
      vocativePressure: Number(turnObservations?.vocative?.pressure || 0),
      vocativeRawPressure: Number(turnObservations?.vocative?.rawPressure || 0),
      vocativeRecentTurns: Number(turnObservations?.vocative?.recentVocativeTurns || 0),
      vocativeRecent6: Number(turnObservations?.vocative?.recent6 || 0),
      vocativeStreak: Number(turnObservations?.vocative?.streak || 0),
      vocativeTurnsSinceAny: Number(turnObservations?.vocative?.turnsSinceAny || 0),
      vocativeLastExact: turnObservations?.vocative?.lastExact || null,
      vocativeLastClass: turnObservations?.vocative?.lastClass || null,
      vocativeExactGapRemaining: Number(turnObservations?.vocative?.exactGapRemaining || 0),
      vocativeClassGapRemaining: Number(turnObservations?.vocative?.classGapRemaining || 0),
      vocativeAnyGapRemaining: Number(turnObservations?.vocative?.anyGapRemaining || 0),
      vocativeStrongAvoid: Boolean(turnObservations?.vocative?.strongAvoid),
      vocativeDirectRequest: Boolean(turnObservations?.vocative?.directRequest),
      vocativeUsed: primaryVocative?.exact || null,
      vocativeUsedClass: primaryVocative?.semanticClass || null,
      vocativeUsedCount: realizedVocatives.length,
      vocativeOverride: Boolean(turnObservations?.vocative?.strongAvoid && realizedVocatives.length > 0),
      commitmentAction: appliedCommitment?.lastAction || mindTurn.mind?.commitmentAction || 'none',
      commitmentRequestedAction: mindTurn.mind?.commitmentAction || 'none',
      commitmentConflict: mindTurn.mind?.commitmentConflict || 'none',
      commitmentTargetId: appliedCommitment?.id || mindTurn.mind?.commitmentTargetId || null,
      commitmentSubject: appliedCommitment?.subject || mindTurn.mind?.commitmentSubject || null,
      commitmentHorizon: appliedCommitment?.horizon || null,
      activeCommitments: (stateTransition?.dialogueState?.sceneCommitments || []).filter(item => ['active', 'contested'].includes(item?.status)).length,
      futureCallbackDetected: Boolean(detectedFutureCallback),
      futureCallbackId: detectedFutureCallback?.id || activeFutureCallbacks[0]?.id || null,
      futureCallbackSubject: detectedFutureCallback?.subject || activeFutureCallbacks[0]?.subject || null,
      futureCallbackCue: detectedFutureCallback?.temporalCue || activeFutureCallbacks[0]?.temporalCue || null,
      futureCallbackActive: activeFutureCallbacks.length,
      futureCallbackResolvedId: resolvedFutureCallback || null,
      sceneClosureStrong: Boolean(turnObservations?.sceneClosure?.strong),
      sceneClosureSoft: Boolean(turnObservations?.sceneClosure?.soft),
      sceneClosureKind: turnObservations?.sceneClosure?.kind || 'none',
      sharedSymbolCandidateId: sharedSymbolCandidate?.id || null,
      sharedSymbolCandidateActivation: Number(sharedSymbolCandidate?.activation || 0),
      sharedSymbolCandidateDirectRecall: Boolean(sharedSymbolCandidate?.directRecall),
      sharedSymbolId: mindTurn.mind?.sharedSymbolId || null,
      sharedSymbolExpression: mindTurn.mind?.sharedSymbolExpression || 'none',
      sharedSymbolActivation: Number(appliedSharedSymbol?.activation || 0),
      sharedSymbolRepetitionPressure: Number((appliedSharedSymbol || sharedSymbolCandidate)?.repetitionPressure || 0)
    };

    return res.status(200).json({
      requestId,
      turnId: deliveryPlan.turnId,
      reply,
      finishReason: 'stop',
      model: {
        mind: completion.model || MIND_MODEL,
        kernel: 'rin-cognitive-dynamics-v3',
        realization: 'gpt-6-luna-voice-v3'
      },
      long: isLong,
      promptMetrics: {
        promptVersion: 'rin-v3.0.2-functional-parity',
        inputTokens: usage.prompt_tokens,
        cachedInputTokens: usage.cached_tokens,
        cacheWriteTokens: usage.cache_write_tokens,
        outputTokens: usage.completion_tokens,
        reasoningTokens: usage.reasoning_tokens,
        totalTokens: usage.total_tokens,
        reasoningEffort: MIND_REASONING_EFFORT || 'default',
        cacheMode: explicitPromptCache ? 'explicit' : 'implicit_or_legacy',
        cacheKey: promptCacheKey || null,
        cachePrefixChars: explicitPromptCache ? String(prompt.stableSystem || '').length : 0,
        serverMs: Date.now() - handlerStartedAt,
        modelMs: Number(modelDurationMs || 0),
        shortTermExchanges: Number(prompt?.shortTermMetrics?.exchanges || 0),
        shortTermSpeakerTurns: Number(prompt?.shortTermMetrics?.speakerTurns || 0),
        shortTermChars: Number(prompt?.shortTermMetrics?.chars || 0),
        calls: { mind: 0, kernel: 0, realization: turnPlan.responseRequired ? 1 : 0, transportAttempts: completion.requestAttempts || 0 },
        historyItems: history.length,
        modelFallback,
        questionSanitized:questionWasSanitized,
        gameTurnDue:Boolean(turnObservations?.sceneContracts?.game?.rinQuestionDue),
        semanticRetries: 0
      },
      perception: brain,
      cognition: { ...compactKernelState(kernelState), observations:turnObservations, behaviorState:turnObservations, intentTelemetry, sceneControl,
        cognitiveDynamics: {schema:cognitiveSettled.schema,behavioralState:cognitiveSettled.behavioralState,
          state:{emotion:cognitiveSettled.nodes.anger,jealousy:cognitiveSettled.nodes.jealousy,trust:cognitiveSettled.nodes.trust,
            fatigue:cognitiveSettled.nodes.fatigue,attachment:cognitiveSettled.nodes.attachment},
          steps:cognitiveSettled.steps,converged:cognitiveSettled.converged,influences:cognitiveSettled.topInfluences,
          evidence:cognitiveInputs.evidence,
          plan:turnPlan.trace,associations:sharedSymbolState.trace,
          plasticity:cognitiveExperience.changes,learnedWeights:cognitiveExperience.state.learnedWeights}},
      mind: mindTurn.mind,
      turnDecision: mindTurn.decision,
      visualReply,
      affectiveTurn,
      validation: {
        decision: decisionValidation,
        realization: realizationValidation,
        stabilization: [],
        policy: 'v3 turn-plan authoritative; Luna text-only; no semantic retries'
      },
      fastPath: turnPlan.responseRequired===false,
      deliveryPlan,
      stateTransition,
      trigger
    });
  } catch (error) {
    console.error('Chat error', error);
    const mapped = publicError(error, 'Chat internal error');
    const elapsed = Date.now() - handlerStartedAt;
    mapped.body.diagnostics = {
      serverMs: elapsed,
      modelMs: modelDurationMs != null ? Number(modelDurationMs) : (modelStartedAt ? Math.max(0, Date.now() - modelStartedAt) : null),
      stage: modelStartedAt ? 'model_or_post_model' : 'pre_model'
    };
    return res.status(mapped.status).json(mapped.body);
  }
}
