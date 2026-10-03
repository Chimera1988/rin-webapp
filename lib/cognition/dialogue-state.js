import { cleanText, normalizeDialogueState, normalizeMessageTarget, uniqueStrings } from './cognitive-contract.js';
import { conversationEventText, isConversationEvent } from '../chat-contract.js';

function usableTurns(history = [], max = 18) {
  return (Array.isArray(history) ? history : [])
    .filter(isConversationEvent)
    .slice(-max)
    .map(item => ({
      id: cleanText(item.id, 120),
      role: item.role,
      kind: item.kind || 'text',
      content: cleanText(conversationEventText(item), 1800),
      sticker: item.sticker || null,
      silence: item.silence || null,
      inReplyTo: cleanText(item.inReplyTo, 120) || null,
      replySnapshot: item.replySnapshot || null,
      ts: Number(item.ts) || null
    }));
}

function words(value = '') {
  return cleanText(value, 1800)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(item => item.length >= 4);
}

function extractEntities(userText = '', brain = null) {
  const text = cleanText(userText, 1800);
  const entities = [...(brain?.referents || [])];
  const capitalized = text.match(/(?:^|\s)([А-ЯЁA-Z][\p{L}-]{2,})/gu) || [];
  entities.push(...capitalized.map(item => item.trim().toLowerCase()));
  if (/(девушк|женщин|редактор|коллег|друг|подруг|заказчик|клиент)/i.test(text)) entities.push('other_person');
  if (/(письм|проект|перевод|работ|текст|фраз|книг|поездк|встреч)/i.test(text)) entities.push('active_subject');
  return uniqueStrings(entities, 12, 180);
}

function lastRinAction(turns = []) {
  const last = [...turns].reverse().find(item => item.role === 'assistant');
  if (!last) return null;
  const replyCause = last.replySnapshot
    ? `ответ на выбранное сообщение ${last.replySnapshot.role === 'user' ? 'пользователя' : 'Рин'}: «${cleanText(last.replySnapshot.excerpt, 260)}»`
    : '';
  if (last.kind === 'sticker' || last.sticker) {
    return {
      kind: 'sticker',
      meaning: cleanText(last.sticker?.meaning || last.sticker?.emotion || last.content, 420),
      cause: cleanText([last.sticker?.cause, replyCause].filter(Boolean).join('; '), 420)
    };
  }
  if (last.kind === 'silence') {
    return {
      kind: 'silence',
      meaning: cleanText(last.content || 'Рин осознанно промолчала', 420),
      cause: cleanText(last.silence?.reason || replyCause, 420)
    };
  }
  return { kind: last.kind === 'voice' ? 'voice' : 'text', meaning: cleanText(last.content, 420), cause: replyCause };
}

function unansweredQuestions(turns = []) {
  const out = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.role !== 'assistant' || !/\?/.test(turn.content)) continue;
    const laterUser = turns.slice(index + 1).find(item => item.role === 'user');
    if (!laterUser) out.push(turn.content);
  }
  return uniqueStrings(out, 4, 420);
}

function agreements(turns = []) {
  return uniqueStrings(turns
    .filter(item => item.role === 'user' && /^(да|ага|угу|ладно|хорошо|договорились|точно|согласен)[.!… ]*$/i.test(item.content))
    .map(item => item.content), 5, 220);
}

const EXPLICIT_CORRECTION_RE = /^(?:нет(?:[, ]+|$)|точнее|не так|вообще-то|на самом деле|я\s+(?:имел\s+в\s+виду|спрашивал|говорил)\s+(?:про|о)|я\s+же\s+про|так\s+это\s+же\s+я\s+про|это\s+же\s+я\s+про|так\s+я\s+же\s+про)/iu;

function corrections(turns = [], brain = null, userText = '') {
  const out = [];
  if (brain?.relation?.type === 'correction' || EXPLICIT_CORRECTION_RE.test(cleanText(userText, 900))) out.push(cleanText(userText, 420));
  for (const turn of turns.slice(-8)) {
    if (turn.role === 'user' && EXPLICIT_CORRECTION_RE.test(turn.content)) out.push(turn.content);
  }
  return uniqueStrings(out, 5, 420);
}

const POSSESSIVE_RE = /(?:^|[^\p{L}\p{N}_])((?:тво(?:й|я|ё|е|и|ю|его|ему|им|их|ей|ими)|мо(?:й|я|ё|е|и|ю|его|ему|им|их|ей|ими)))\s+([\p{L}-]{3,})(?:\s+([\p{L}-]{3,}))?/giu;
const ANCHOR_STOP = new Set(['будет', 'было', 'была', 'были', 'есть', 'тоже', 'очень', 'просто', 'снова', 'сейчас', 'потом', 'туда', 'сюда']);

function possessiveAnchors(text = '', role = 'user', source = 'dialogue') {
  const out = [];
  const value = cleanText(text, 1800);
  for (const match of value.matchAll(POSSESSIVE_RE)) {
    const possessive = String(match[1] || '').toLowerCase();
    const words = [match[2], match[3]].map(item => cleanText(item, 60).toLowerCase()).filter(Boolean);
    if (!words.length) continue;
    if (words.length > 1 && ANCHOR_STOP.has(words[1])) words.pop();
    const referent = words.at(-1);
    if (!referent || ANCHOR_STOP.has(referent)) continue;
    const owner = possessive.startsWith('тво')
      ? (role === 'user' ? 'rin' : 'user')
      : (role === 'user' ? 'user' : 'rin');
    out.push({
      referent,
      label: words.join(' '),
      owner,
      source,
      evidence: cleanText(match[0], 180)
    });
  }
  return out;
}

function discourseAnchors(turns = [], userText = '', previousState = null) {
  const prior = Array.isArray(previousState?.discourseAnchors) ? previousState.discourseAnchors : [];
  const candidates = [...prior];
  for (const turn of turns.slice(-6)) {
    if (!['user', 'assistant'].includes(turn.role) || !turn.content) continue;
    candidates.push(...possessiveAnchors(turn.content, turn.role, 'recent_history'));
  }
  candidates.push(...possessiveAnchors(userText, 'user', 'current_user'));

  // Newer explicit ownership wins for the same referent. Keep the map ordered by
  // the latest evidence so the most useful anchors survive compact-state limits.
  const byReferent = new Map();
  for (const anchor of candidates) {
    const key = cleanText(anchor?.referent, 100).toLowerCase();
    if (!key) continue;
    if (byReferent.has(key)) byReferent.delete(key);
    byReferent.set(key, anchor);
  }
  return [...byReferent.values()].slice(-8);
}

function topicConfidence(userText = '', brain = null, turns = []) {
  const brainConfidence = Number(brain?.activeScene?.confidence) || 0;
  const lexical = words(userText);
  const prior = words(turns.slice(-4).map(item => item.content).join(' '));
  const overlap = lexical.filter(item => prior.includes(item)).length;
  return Math.max(0.45, Math.min(0.98, brainConfidence / 100 * 0.75 + Math.min(0.2, overlap * 0.04)));
}

export function buildDialogueState({ history = [], userText = '', brain = null, explicitReply = null, previousState = null } = {}) {
  const turns = usableTurns(history);
  const prior = previousState && typeof previousState === 'object' ? normalizeDialogueState(previousState) : null;
  const hasPriorAssistantContext = turns.some(item => item.role === 'assistant');
  const currentScene = brain?.activeScene?.type || 'everyday';
  const terminalScene = currentScene === 'farewell';
  const preservePriorBinding = Boolean(prior && prior.scene === currentScene && !brain?.activeScene?.topicDrift && brain?.relation?.type !== 'correction');
  const currentEntities = extractEntities(userText, brain);
  const currentCorrections = corrections(turns, brain, userText);
  const currentLastRinAction = lastRinAction(turns);
  return normalizeDialogueState({
    topic: brain?.activeScene?.topic || cleanText(userText, 500),
    scene: currentScene,
    sceneSource: brain?.activeScene?.source || null,
    sceneAnchor: terminalScene ? null : brain?.activeScene?.anchor ? normalizeMessageTarget({
      messageId: brain.activeScene.anchor.messageId,
      role: 'user',
      kind: 'text',
      excerpt: brain.activeScene.anchor.excerpt,
      reason: 'опорная реплика активной сцены',
      confidence: brain.activeScene.continuityStrength || 0.8
    }) : (preservePriorBinding ? prior?.sceneAnchor || null : (!hasPriorAssistantContext ? prior?.sceneAnchor || null : null)),
    openHook: terminalScene ? null : brain?.activeScene?.openHook ? normalizeMessageTarget({
      messageId: brain.activeScene.openHook.messageId,
      role: 'user',
      kind: 'text',
      excerpt: brain.activeScene.openHook.excerpt,
      reason: 'незавершённый крючок активной сцены',
      confidence: brain.activeScene.continuityStrength || 0.8
    }) : (preservePriorBinding ? prior?.openHook || null : (!hasPriorAssistantContext ? prior?.openHook || null : null)),
    turnsInScene: brain?.activeScene?.turnsInScene || 1,
    continuityStrength: brain?.activeScene?.continuityStrength || 0.6,
    reactiveStreak: brain?.activeScene?.reactiveStreak || 0,
    questionStreak: brain?.activeScene?.questionStreak || 0,
    topicDrift: Boolean(brain?.activeScene?.topicDrift),
    relationToPreviousTurn: brain?.relation?.type || 'continuation',
    recentActs: Array.isArray(prior?.recentActs) ? prior.recentActs.slice(-8) : [],
    recentMotifs: Array.isArray(prior?.recentMotifs) ? prior.recentMotifs.slice(-8) : [],
    lastFrameAlignment: cleanText(prior?.lastFrameAlignment, 40) || null,
    explicitReplyTarget: normalizeMessageTarget(explicitReply),
    entities: terminalScene ? [] : uniqueStrings([...(prior?.entities || []), ...currentEntities], 12, 180),
    discourseAnchors: terminalScene ? [] : discourseAnchors(turns, userText, prior),
    unresolvedQuestions: terminalScene ? [] : unansweredQuestions(turns),
    agreements: agreements(turns),
    corrections: uniqueStrings([...(prior?.corrections || []), ...currentCorrections], 6, 420),
    lastRinAction: currentLastRinAction || prior?.lastRinAction || null,
    confidence: topicConfidence(userText, brain, turns)
  });
}
