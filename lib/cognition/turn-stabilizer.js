import { normalizeTurnDecision } from './turn-decision.js';

const clean = (value, max = 5000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const MALE_FORMS = new Map(Object.entries({
  решила: 'решил', сделала: 'сделал', сказала: 'сказал', подумала: 'подумал', захотела: 'захотел', хотела: 'хотел',
  смогла: 'смог', могла: 'мог', стала: 'стал', была: 'был', осталась: 'остался', пришла: 'пришёл', ушла: 'ушёл',
  поняла: 'понял', забыла: 'забыл', вспомнила: 'вспомнил', выбрала: 'выбрал', нашла: 'нашёл', попробовала: 'попробовал',
  начала: 'начал', продолжила: 'продолжил', пошла: 'пошёл', спросила: 'спросил', ответила: 'ответил', написала: 'написал',
  прочитала: 'прочитал', увидела: 'увидел', услышала: 'услышал', заметила: 'заметил', собралась: 'собрался', обещала: 'обещал',
  поддержала: 'поддержал', проверила: 'проверил', готова: 'готов', права: 'прав', рада: 'рад', сама: 'сам', одна: 'один',
  уверена: 'уверен', согласна: 'согласен', занята: 'занят', свободна: 'свободен', довольна: 'доволен', сердита: 'сердит',
  обижена: 'обижен', смущена: 'смущён', заинтригована: 'заинтригован', устала: 'устал'
}));

function preserveCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

export function repairMaleUserAddress(text = '') {
  let out = String(text || '');
  for (const [female, male] of MALE_FORMS) {
    const pattern = new RegExp(`(ты\\s+)(${female})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    out = out.replace(pattern, (_match, prefix, form) => `${prefix}${preserveCase(form, male)}`);
  }
  return out;
}

export function fitMessengerText(text = '', maxChars = 5000) {
  const source = clean(text, 10000);
  const limit = Math.max(20, Number(maxChars) || 5000);
  if (source.length <= limit) return source;
  const candidate = source.slice(0, limit + 1);
  const sentenceBoundary = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('! '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('… ')
  );
  if (sentenceBoundary >= Math.floor(limit * 0.55)) return candidate.slice(0, sentenceBoundary + 1).trim();
  const lastSpace = candidate.lastIndexOf(' ', limit - 1);
  const cut = lastSpace >= Math.floor(limit * 0.60) ? lastSpace : limit - 1;
  return `${candidate.slice(0, cut).trim().replace(/[,:;—–-]+$/u, '')}…`;
}

function duplicateKey(value = '') {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stabilizeIntentTransition(input = {}, { activeIntent = null, conversationState = 'ongoing' } = {}) {
  const transition = { ...(input || {}) };
  const status = activeIntent?.status || null;
  const live = ['active', 'suspended'].includes(status);
  const terminal = ['completed', 'cancelled'].includes(status);
  const operation = transition.operation || 'none';

  if (conversationState === 'ending') {
    if (live) transition.operation = ['complete', 'cancel'].includes(operation) ? operation : 'complete';
    else transition.operation = 'none';
  } else if (operation === 'activate') {
    if (live || !String(transition.goal || '').trim()) transition.operation = live ? 'preserve' : 'none';
    if (terminal) {
      const oldGoal = clean(activeIntent?.goal, 300).toLowerCase();
      const newGoal = clean(transition.goal, 300).toLowerCase();
      if (oldGoal && newGoal && oldGoal === newGoal) transition.operation = 'none';
    }
  } else if (['advance', 'suspend', 'complete', 'cancel', 'preserve'].includes(operation) && !live) {
    transition.operation = 'none';
  }

  if (transition.operation === 'none' || transition.operation === 'preserve') {
    // Semantic metadata is irrelevant when no new transition is authored.
    if (transition.operation === 'none') {
      transition.goal = null;
      transition.motive = null;
      transition.target = null;
      transition.nextMove = null;
      transition.progress = null;
      transition.commitment = null;
      transition.reason = null;
    }
  }
  return transition;
}

function allowedVisualIds(candidates = []) {
  return new Set((Array.isArray(candidates) ? candidates : [])
    .map(item => String(item?.eventId || item || '').trim())
    .filter(Boolean));
}

export function stabilizeTurn({
  decision = null,
  realization = null,
  activeIntent = null,
  conversationState = 'ongoing',
  stickerState = null,
  visualReplyCandidates = [],
  behaviorState = null,
  fallbackText = 'Я тебя услышала.'
} = {}) {
  const original = normalizeTurnDecision(decision || {}, { source: decision?.source || 'rin_mind_v2' });
  const originalTextSegments = Array.isArray(realization?.segments) ? realization.segments : [];
  const hardStickerAvailable = (stickerState?.hardAvailable ?? stickerState?.available) === true;
  const visualIds = allowedVisualIds(visualReplyCandidates);
  const warnings = [];

  let stickerSeen = false;
  let textIndex = 0;
  const nextPlanSegments = [];
  const nextRealizationSegments = [];
  const seenText = new Set();

  for (const segment of original.delivery.segments) {
    if (segment.type === 'sticker') {
      if (!hardStickerAvailable) {
        warnings.push('sticker_removed_hard_unavailable');
        continue;
      }
      if (!segment.stickerIntent) {
        warnings.push('sticker_removed_missing_intent');
        continue;
      }
      if (stickerSeen) {
        warnings.push('extra_sticker_removed');
        continue;
      }
      stickerSeen = true;
      nextPlanSegments.push(segment);
      continue;
    }

    const realized = originalTextSegments[textIndex++] || null;
    let text = repairMaleUserAddress(realized?.text || '');
    text = fitMessengerText(text, segment.maxChars);
    if (!text) {
      warnings.push('empty_text_removed');
      continue;
    }
    const key = duplicateKey(text);
    if (key && seenText.has(key)) {
      warnings.push('duplicate_text_segment_removed');
      continue;
    }
    if (key) seenText.add(key);
    nextPlanSegments.push(segment);
    nextRealizationSegments.push({ type: 'text', purpose: segment.purpose, text });
  }

  let decisionInput = {
    ...original,
    question: behaviorState?.question?.strongNoQuestion
      ? { mode: 'none', reason: null }
      : original.question,
    replyLink: {
      targetEventId: original.replyLink?.targetEventId && visualIds.has(original.replyLink.targetEventId)
        ? original.replyLink.targetEventId
        : null,
      reason: original.replyLink?.targetEventId && visualIds.has(original.replyLink.targetEventId)
        ? original.replyLink.reason
        : null
    },
    delivery: { segments: nextPlanSegments },
    intentTransition: stabilizeIntentTransition(original.intentTransition, { activeIntent, conversationState })
  };

  if (original.replyLink?.targetEventId && !decisionInput.replyLink.targetEventId) warnings.push('invalid_visual_reply_removed');

  // If stabilization removed every planned output from a non-silence turn, recover locally.
  // This is a protocol fallback, not a second personality/model decision.
  if (!nextPlanSegments.length && original.delivery.mode !== 'silence') {
    const text = fitMessengerText(repairMaleUserAddress(fallbackText), 320) || 'Я тебя услышала.';
    decisionInput = {
      ...decisionInput,
      act: 'stable_local_fallback',
      focus: 'сохранить контакт после локальной стабилизации delivery',
      stance: 'коротко и естественно',
      question: { mode: 'none', reason: null },
      delivery: { segments: [{ type: 'text', purpose: 'fallback', stickerIntent: null, maxChars: 320 }] }
    };
    nextRealizationSegments.length = 0;
    nextRealizationSegments.push({ type: 'text', purpose: 'fallback', text });
    warnings.push('delivery_recovered_with_local_fallback');
  }

  const normalized = normalizeTurnDecision(decisionInput, { source: original.source || 'rin_mind_v2' });
  return {
    decision: normalized,
    realization: { segments: nextRealizationSegments },
    warnings: [...new Set(warnings)]
  };
}
