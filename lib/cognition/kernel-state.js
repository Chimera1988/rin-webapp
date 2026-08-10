import { buildDialogueState } from './dialogue-state.js';
import { buildBeliefModel } from './belief-model.js';
import { retrieveMemory } from './memory-retrieval.js';
import { normalizeRinIntent } from '../intent-contract.js';
import { normalizeInnerLife } from '../inner-life-contract.js';
import { normalizeOpenLoop } from './cognitive-contract.js';

const clean = (value, max = 800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function activeConversationLoops(memory = null) {
  return (Array.isArray(memory?.conversationState?.openLoops) ? memory.conversationState.openLoops : [])
    .map(normalizeOpenLoop)
    .filter(item => item.subject && !['resolved', 'cancelled', 'stale'].includes(item.status))
    .slice(0, 8);
}

function userEventsFromHistory(history = [], requestId = '') {
  const wanted = clean(requestId, 100);
  const all = Array.isArray(history) ? history : [];
  const selected = wanted
    ? all.filter(item => item?.role === 'user' && item?.requestId === wanted && ['sent', 'complete'].includes(item?.status || 'complete'))
    : all.slice(-1).filter(item => item?.role === 'user');
  return selected.map(item => ({
    id: clean(item.id, 120),
    turnId: clean(item.turnId, 120) || null,
    content: clean(item.content, 2000),
    inReplyTo: clean(item.inReplyTo, 120) || null,
    replySnapshot: item.replySnapshot || null,
    ts: Number(item.ts) || null
  })).filter(item => item.content);
}

function relevantHistory(history = []) {
  return (Array.isArray(history) ? history : []).slice(-10).map(item => ({
    id: clean(item.id, 120),
    role: item.role,
    kind: item.kind || 'text',
    content: ['sticker', 'silence'].includes(item.kind) ? null : clean(item.content, 900),
    sticker: item.kind === 'sticker' ? {
      id: clean(item.sticker?.id, 80),
      meaning: clean(item.sticker?.meaning || item.sticker?.emotion, 200),
      cause: clean(item.sticker?.cause, 220)
    } : null
  }));
}

function perceptionSignals(brain = null, explicitReply = null) {
  const literal = clean(brain?.literalIntent, 80) || 'statement';
  const hidden = clean(brain?.hiddenIntent?.type, 100) || 'none';
  const relation = clean(brain?.relation?.type, 100) || 'continuation';
  const signals = [];
  if (literal === 'question') signals.push('direct_question_present');
  if (literal === 'farewell') signals.push('explicit_farewell');
  if (literal === 'request_advice') signals.push('user_requests_advice');
  if (literal === 'request_content') signals.push('user_requests_content');
  if (literal === 'short_confirmation') signals.push('dependent_short_confirmation');
  if (relation === 'correction') signals.push('user_correction_present');
  if (relation === 'initiative_handoff' || hidden === 'invite_rin_initiative') signals.push('user_handed_initiative');
  if (relation === 'follow_up_on_rin_statement') signals.push('follow_up_on_rin_statement');
  if (relation === 'answers_previous_question') signals.push('answers_rin_previous_question');
  if (hidden === 'seek_solution') signals.push('user_seeks_solution');
  if (hidden === 'seek_emotional_presence') signals.push('user_seeks_emotional_presence');
  if (hidden === 'request_more_emotional_response') signals.push('user_requests_more_emotional_response');
  if (hidden === 'possible_hurt_or_withdrawal' || hidden === 'masked_disappointment') signals.push('possible_relational_hurt');
  if (hidden === 'repair_connection') signals.push('repair_attempt');
  if (hidden === 'reclaim_playful_scene') signals.push('user_noticed_scene_drift');
  if (hidden === 'continue_playful_tension') signals.push('playful_tension_continues');
  if (explicitReply?.messageId) signals.push('explicit_reply_target_selected');
  if (Number(brain?.ambiguity?.level) >= 75) signals.push('high_reference_ambiguity');
  return [...new Set(signals)].slice(0, 10);
}

function environmentSnapshot(env = null) {
  if (!env || typeof env !== 'object') return null;
  return {
    rinHuman: clean(env.rinHuman, 40) || null,
    partOfDay: clean(env.partOfDay, 30) || null,
    month: clean(env.month, 30) || null,
    season: clean(env.season, 30) || null,
    userVsRinHoursDiff: Number.isFinite(Number(env.userVsRinHoursDiff)) ? Number(env.userVsRinHoursDiff) : null,
    weather: env.weather && typeof env.weather === 'object' ? {
      temp: Number.isFinite(Number(env.weather.temp)) ? Number(env.weather.temp) : null,
      feels: Number.isFinite(Number(env.weather.feels)) ? Number(env.weather.feels) : null,
      desc: clean(env.weather.desc, 100) || null
    } : null
  };
}

export function buildKernelState({
  requestId = '', userText = '', history = [], memory = null, brain = null, affectiveTurn = null,
  explicitReply = null, env = null, lore = null, conversationState = 'ongoing', stickerState = null
} = {}) {
  const previousDialogueState = memory?.conversationState?.dialogueState || null;
  const dialogueState = buildDialogueState({ history, userText, brain, explicitReply, previousState: previousDialogueState });
  const beliefModel = buildBeliefModel({ memory, userText, brain });
  const openLoops = activeConversationLoops(memory);
  const memoryContext = retrieveMemory({
    memory, userText, history,
    cognition: { openLoops: { active: openLoops, callback: null } }
  });
  const innerLife = normalizeInnerLife(memory?.innerLife || {});
  const activeIntent = normalizeRinIntent(memory?.conversationState?.rinIntent);
  const userEvents = userEventsFromHistory(history, requestId);
  return {
    schema: 'rin-kernel-state-v1',
    requestId: clean(requestId, 100),
    revision: Math.max(0, Number(memory?.conversationState?.revision) || 0),
    conversationState,
    userText: clean(userText, 4000),
    userEvents,
    perception: {
      literalMeaning: brain?.literalIntent || 'statement',
      implicitMeaning: brain?.hiddenIntent?.type || 'none',
      relationToPreviousTurn: brain?.relation?.type || 'continuation',
      signals: perceptionSignals(brain, explicitReply),
      referents: Array.isArray(brain?.referents) ? brain.referents.slice(0, 8) : [],
      ambiguity: brain?.ambiguity && Number.isFinite(Number(brain.ambiguity.level)) ? { level: Number(brain.ambiguity.level) } : null
    },
    scene: {
      type: dialogueState.scene || brain?.activeScene?.type || 'everyday',
      topic: dialogueState.topic || brain?.activeScene?.topic || null,
      continuityStrength: dialogueState.continuityStrength ?? null,
      turnsInScene: dialogueState.turnsInScene ?? 1,
      explicitFarewell: conversationState === 'ending'
    },
    dialogueState,
    beliefModel,
    emotion: affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null,
    relationship: affectiveTurn?.relationshipState || memory?.relationship || null,
    mood: affectiveTurn?.moodState || memory?.mood || null,
    relevantMemory: memoryContext,
    innerLife,
    activeIntent,
    openLoops,
    replyTarget: explicitReply || null,
    environment: environmentSnapshot(env),
    stickerState: stickerState && typeof stickerState === 'object' ? stickerState : null,
    lore: {
      source: lore?.source === 'server_canon_store' ? 'server_canon_store' : null,
      canon: Array.isArray(lore?.canon) ? lore.canon.slice(0, 3) : [],
      memories: Array.isArray(lore?.memories) ? lore.memories.slice(0, 2) : [],
      backstory: Array.isArray(lore?.backstory) ? lore.backstory.slice(0, 2) : []
    },
    recentHistory: relevantHistory(history)
  };
}

export function compactKernelState(state = {}) {
  return {
    schema: state.schema,
    revision: state.revision,
    conversationState: state.conversationState,
    perception: state.perception,
    scene: state.scene,
    emotion: state.emotion,
    relationship: state.relationship,
    mood: state.mood,
    relevantMemory: state.relevantMemory,
    innerLife: state.innerLife,
    activeIntent: state.activeIntent,
    openLoops: state.openLoops,
    replyTarget: state.replyTarget,
    environment: state.environment,
    stickerState: state.stickerState
  };
}
