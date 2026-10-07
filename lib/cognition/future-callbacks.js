import { cleanText, cognitiveId, normalizeOpenLoop, normalizeSceneCommitment } from './cognitive-contract.js';

const TEMPORAL_RE = /(?:сегодня\s+вечером|завтра\s+утром|после\s+работы|вечером|позже|потом|завтра|утром|сегодня)/iu;
const PROMISE_RE = /(?:расскажу|покажу|скину|пришлю|напишу|сообщу|объясню|скажу|дам\s+знать)/iu;
const EXPLICIT_PROMISE_RE = /(?:обещаю|точно\s+(?:расскажу|покажу|скину|пришлю|напишу|сообщу|объясню|скажу|дам\s+знать))/iu;
const HEDGE_RE = /(?:^|[^\p{L}\p{N}_])(?:может(?:\s+быть)?|возможно|наверное|постараюсь|если\s+(?:получится|успею|не\s+забуду)|как[-\s]?нибудь)(?=$|[^\p{L}\p{N}_])/iu;
const FULFILLMENT_RE = /(?:как\s+(?:и\s+)?обещал|вот\s+(?:то|это),?\s+что\s+обещал|обещал\s+(?:тебе\s+)?(?:рассказать|показать|скинуть|прислать|написать|сообщить|объяснить|сказать))/iu;
const LIVE_STATUSES = new Set(['active', 'contested']);

function sentenceParts(value = '') {
  return String(value || '')
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map(item => cleanText(item, 420))
    .filter(Boolean);
}

function normalizeCue(value = '') {
  const text = cleanText(value, 80).toLowerCase();
  if (/завтра\s+утром/iu.test(text)) return 'tomorrow_morning';
  if (/завтра/iu.test(text)) return 'tomorrow';
  if (/сегодня\s+вечером|вечером/iu.test(text)) return 'evening';
  if (/после\s+работы/iu.test(text)) return 'after_work';
  if (/утром/iu.test(text)) return 'morning';
  if (/сегодня/iu.test(text)) return 'today';
  if (/позже|потом/iu.test(text)) return 'later';
  return 'later';
}

function actionFromSentence(value = '') {
  const text = cleanText(value, 420).toLowerCase();
  if (/расскажу/iu.test(text)) return 'tell';
  if (/покажу/iu.test(text)) return 'show';
  if (/(?:скину|пришлю)/iu.test(text)) return 'send';
  if (/напишу/iu.test(text)) return 'write';
  if (/(?:сообщу|дам\s+знать)/iu.test(text)) return 'update';
  if (/объясню/iu.test(text)) return 'explain';
  if (/скажу/iu.test(text)) return 'say';
  return 'return_to_topic';
}

function horizonForCue(cue = 'later') {
  if (cue === 'tomorrow' || cue === 'tomorrow_morning') return 'until_tomorrow';
  if (cue === 'today' || cue === 'evening' || cue === 'after_work' || cue === 'morning' || cue === 'later') return 'until_event';
  return 'open_ended';
}

function tokenSet(value = '') {
  const stop = new Set(['пользователь', 'обещал', 'вернуться', 'этому', 'позже', 'потом', 'сегодня', 'вечером', 'завтра', 'утром', 'после', 'работы']);
  return new Set(cleanText(value, 600)
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(item => item.length >= 3 && !stop.has(item)));
}

function overlap(a = '', b = '') {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function detectUserFutureCallback(userText = '') {
  const text = cleanText(userText, 2400);
  if (!text) return null;
  for (const sentence of sentenceParts(text)) {
    if (/\?\s*$/u.test(sentence)) continue;
    if (HEDGE_RE.test(sentence)) continue;
    const temporalMatch = sentence.match(TEMPORAL_RE);
    const hasPromiseVerb = PROMISE_RE.test(sentence);
    const explicitPromise = EXPLICIT_PROMISE_RE.test(sentence);
    if (!(hasPromiseVerb && temporalMatch) && !explicitPromise) continue;

    const cue = normalizeCue(temporalMatch?.[0] || 'later');
    const action = actionFromSentence(sentence);
    const originText = cleanText(sentence, 360);
    const subject = cleanText(`Кирилл обещал вернуться к этому: «${originText}»`, 420);
    const key = `${cue}|${action}|${originText.toLowerCase().replace(/ё/gu, 'е')}`;
    return {
      id: cognitiveId('callback', key),
      cue,
      action,
      originText,
      subject,
      horizon: horizonForCue(cue),
      strength: explicitPromise ? 86 : 78
    };
  }
  return null;
}

export function futureCallbackOpenLoop(callback = null, now = Date.now()) {
  if (!callback?.subject) return null;
  return normalizeOpenLoop({
    id: callback.id,
    type: 'future_callback',
    subject: callback.subject,
    status: 'waiting_for_user',
    waitingFor: 'user',
    importance: 78,
    confidence: 0.95,
    createdAt: now,
    updatedAt: now,
    source: 'user_future_callback',
    temporalCue: callback.cue,
    originText: callback.originText
  });
}

export function upsertUserFutureCommitment(currentInput = [], callback = null, { turn = 0 } = {}) {
  let current = (Array.isArray(currentInput) ? currentInput : [])
    .map(normalizeSceneCommitment)
    .filter(Boolean)
    .slice(-6);
  if (!callback?.subject) return current;

  let existingIndex = current.findIndex(item => item.id === callback.id);
  if (existingIndex < 0) {
    let bestIndex = -1;
    let bestScore = 0;
    current.forEach((item, index) => {
      if (item.owner !== 'user' || !LIVE_STATUSES.has(item.status)) return;
      const score = overlap(item.subject, callback.subject);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestScore >= 0.56) existingIndex = bestIndex;
  }

  const next = normalizeSceneCommitment({
    ...(existingIndex >= 0 ? current[existingIndex] : {}),
    id: existingIndex >= 0 ? current[existingIndex].id : callback.id,
    subject: callback.subject,
    owner: 'user',
    status: 'active',
    horizon: callback.horizon,
    strength: callback.strength,
    source: 'user_future_callback',
    rationale: `явное обещание пользователя вернуться к теме (${callback.cue})`,
    lastAction: 'establish',
    terminalReason: null,
    terminalAtTurn: null,
    createdAtTurn: existingIndex >= 0 ? current[existingIndex].createdAtTurn : turn,
    updatedAtTurn: turn
  });
  if (!next) return current;
  const out = current.filter((_, index) => index !== existingIndex);
  out.push(next);
  return out.slice(-6);
}


export function fulfillUserFutureCommitment(currentInput = [], callbackId = null, { turn = 0 } = {}) {
  const wanted = cleanText(callbackId, 120);
  let current = (Array.isArray(currentInput) ? currentInput : [])
    .map(normalizeSceneCommitment)
    .filter(Boolean)
    .slice(-6);
  if (!wanted) return current;
  const index = current.findIndex(item => item.id === wanted && item.owner === 'user' && LIVE_STATUSES.has(item.status));
  if (index < 0) return current;
  const target = current[index];
  const next = normalizeSceneCommitment({
    ...target,
    status: 'fulfilled',
    lastAction: 'fulfill',
    terminalReason: 'user_returned_to_promised_callback',
    terminalAtTurn: turn,
    updatedAtTurn: turn
  });
  const out = current.filter((_, itemIndex) => itemIndex !== index);
  if (next) out.push(next);
  return out.slice(-6);
}

export function explicitFutureCallbackFulfillment(userText = '', openLoops = []) {
  const text = cleanText(userText, 1800);
  if (!text || !FULFILLMENT_RE.test(text)) return null;
  const candidates = (Array.isArray(openLoops) ? openLoops : [])
    .map(normalizeOpenLoop)
    .filter(item => item.type === 'future_callback' && !['resolved', 'cancelled', 'stale'].includes(item.status));
  return candidates.at(-1)?.id || null;
}

export function futureCallbackPatterns() {
  return { TEMPORAL_RE, PROMISE_RE, EXPLICIT_PROMISE_RE, HEDGE_RE, FULFILLMENT_RE };
}
