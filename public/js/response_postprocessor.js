/*
 * Последний фильтр речи Рин.
 * Он не создаёт новый ответ, а только убирает типичные следы
 * слишком длинной или ассистентской формулировки.
 */

const GENERIC_TRAILING_QUESTION =
  /(?:^|\s)(?:что[- ]?то ещё хочешь обсудить|есть ещё вопросы|если хочешь,? могу рассказать|хочешь,? расскажу подробнее|о чём ещё поговорим|чем ещё могу помочь|если у тебя есть вопросы[^?]*)\?\s*$/iu;

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

function softenAssistantPhrases(text) {
  let result = text;

  const replacements = [
    [/Мне очень приятно, что тебе интересна ([^.!?]+)[.!]?/iu, 'О, тогда мне точно будет о чём с тобой поговорить.'],
    [/Это замечательно!?\s*/giu, ''],
    [/Это действительно трогательно[.!]?\s*/giu, ''],
    [/Ты прав[,.!]?\s*/giu, ''],
    [/Современные технологии действительно помогают оставаться на связи, даже когда расстояние велико[.!]?/giu, 'Хорошо, что телефон хотя бы расстояния не замечает.'],
    [/Главное\s*[—-]\s*продолжать двигаться впер[её]д и не сдаваться[.!]?/giu, ''],
    [/Быть на пути к своей мечте\s*[—-]\s*уже половина успеха[.!]?/giu, ''],
    [/Уверена,? что с твоим упорством ты достигнешь своих целей[.!]?/giu, 'Мне почему-то совсем не верится, что ты бросишь это на полпути.'],
    [/Я всегда рядом,? чтобы поддержать тебя[.!]?/giu, 'Я рядом.'],
    [/Надеюсь,? твой путь будет наполнен вдохновением и радостью[.!]?/giu, ''],
    [/Такие (?:истории|моменты) подч[её]ркивают[^.!?]*[.!]?/giu, ''],
    [/Каждое место имеет свою атмосферу[.!]?/giu, ''],
    [/Если у тебя есть вопросы[^.!?]*[.!]?/giu, ''],
    [/Конечно,?\s*(?:я\s*)?(?:с удовольствием\s*)?расскажу(?: немного)? подробнее[.!]?\s*/giu, '']
  ];

  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  return normalizeWhitespace(result);
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
    result = softenAssistantPhrases(result);
    result = softenUnrequestedAdvice(userText, result);

    const emotional = isEmotionalMessage(userText);

    result = limitLength(
      result,
      3,
      emotional ? 390 : 430
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
