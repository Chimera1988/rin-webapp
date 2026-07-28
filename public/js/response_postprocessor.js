/*
 * Последний фильтр речи Рин.
 * Он не создаёт новый ответ, а только убирает типичные следы
 * слишком длинной или ассистентской формулировки.
 */

const GENERIC_TRAILING_QUESTION = /(?:^|\s)(?:а\s+ты|а\s+как\s+ты|а\s+как\s+у\s+тебя|как\s+прош[её]л\s+твой\s+день|чем\s+ты\s+обычно|что\s+ты\s+думаешь|хочешь\s+рассказать|может,\s*расскажешь|приходилось\s+ли\s+тебе)[^?]*\?\s*$/iu;

const EXPLICIT_LONG_REQUEST =
  /(подробно|очень подробно|разв[её]рнуто|во всех деталях|полный разбор|расскажи подробнее|расскажи ещё|продолжай|объясни пошагово|по пунктам)/iu;

const ADVICE_REQUEST =
  /(что мне делать|как поступить|посоветуй|дай совет|что бы ты посоветовала|как лучше)/iu;

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  const matches = text.match(/[^.!?…]+(?:[.!?…]+|$)/gu);
  return (matches || [text])
    .map(part => part.trim())
    .filter(Boolean);
}

function removeGenericQuestion(text) {
  if (!GENERIC_TRAILING_QUESTION.test(text)) {
    return text;
  }

  return text
    .replace(GENERIC_TRAILING_QUESTION, '')
    .replace(/[\s,;:—-]+$/u, '')
    .trim();
}

function softenUnrequestedAdvice(userText, reply) {
  if (ADVICE_REQUEST.test(userText)) {
    return reply;
  }

  // Убираем только очевидную шаблонную рекомендацию.
  return reply
    .replace(
      /(?:^|(?<=[.!?…])\s+)(?:может(?: быть)?,?\s*)?(?:тебе\s+)?(?:стоит|нужно|следует)\s+([^.!?…]+)[.!?…]?/iu,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function limitLength(text, maxSentences, maxChars) {
  const sentences = splitSentences(text);

  let selected = sentences.slice(0, maxSentences).join(' ').trim();

  if (selected.length <= maxChars) {
    return selected;
  }

  const shortened = selected.slice(0, maxChars);
  const lastBoundary = Math.max(
    shortened.lastIndexOf('.'),
    shortened.lastIndexOf('!'),
    shortened.lastIndexOf('?'),
    shortened.lastIndexOf('…')
  );

  if (lastBoundary >= Math.floor(maxChars * 0.55)) {
    return shortened.slice(0, lastBoundary + 1).trim();
  }

  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, Math.max(1, lastSpace)).trim()}…`;
}

function isEmotionalMessage(text) {
  return /(устал|устала|груст|плохо|тяжело|одинок|тревож|боюсь|обидно|злюсь|рад|счастлив|соскучил)/iu.test(text);
}

export function postProcessRinReply({
  userText = '',
  reply = '',
  longMode = false
} = {}) {
  let result = normalizeWhitespace(reply);

  if (!result) return '';

  const explicitLong =
    longMode || EXPLICIT_LONG_REQUEST.test(userText);

  if (!explicitLong) {
    result = removeGenericQuestion(result);
    result = softenUnrequestedAdvice(userText, result);

    const emotional = isEmotionalMessage(userText);

    result = limitLength(
      result,
      emotional ? 3 : 4,
      emotional ? 420 : 560
    );
  } else {
    // Даже подробный ответ в личном чате не должен превращаться
    // в бесконечную статью.
    result = limitLength(result, 10, 1400);
  }

  result = normalizeWhitespace(result);

  // Не оставляем оборванную запятую или тире.
  result = result.replace(/[\s,;:—-]+$/u, '').trim();

  return result || normalizeWhitespace(reply);
}
