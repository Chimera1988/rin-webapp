const PREFIXES = [
  /^(Это действительно|Это очень|Это довольно)\s+(важно|интересно|трогательно|замечательно|прекрасно)[.!,:—-]?\s*/i,
  /^(Ты прав|Ты совершенно прав)[.!,:—-]?\s*/i,
  /^(Безусловно|Конечно же)[.!,:—-]?\s*/i,
  /^(Понимаю|Я понимаю)[.!,:—-]?\s*/i
];

const GENERIC_SENTENCE = [
  /^(Иногда|Порой)\s+(люди|мы|человек)\b/i,
  /^(Главное|Важно)\s+[—-]?\s*/i,
  /^(Такие|Подобные)\s+моменты\s+(учат|помогают|создают|напоминают)/i,
  /^(Уютные|Тёплые|Маленькие)\s+мелочи\s+(действительно\s+)?(создают|делают|помогают)/i,
  /^(Это|Такое)\s+(звучит|должно быть)\s+(прекрасно|замечательно|уютно|трогательно)/i,
  /^(Наверное|Возможно),?\s+именно\s+такие\s+моменты/i,
  /^(Прогулка|Разговор|Вечер|Чай|Отдых)\s+с\s+хорошей\s+компанией\s+всегда/i
];

function splitSentences(text) {
  return text.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

function isGeneric(sentence) {
  return GENERIC_SENTENCE.some(rx => rx.test(sentence.trim()));
}

function removeGenericFiller(text, decision) {
  const parts = splitSentences(text);
  if (parts.length <= 1) return text;

  const kept = parts.filter((sentence, index) => {
    if (!isGeneric(sentence)) return true;
    // Не удаляем единственную содержательную первую фразу в поддержке.
    if (index === 0 && ['comfort', 'support'].includes(decision?.intent)) return true;
    return false;
  });
  const onlyQuestionRemains = kept.length === 1 && /\?\s*$/.test(kept[0]) && parts.some(p => !/\?\s*$/.test(p));
  if (onlyQuestionRemains) {
    const statement = parts.find(p => !/\?\s*$/.test(p));
    return statement || kept[0];
  }
  return (kept.length ? kept : parts.slice(0, 1)).join(' ').trim();
}

function removeAutomaticQuestion(text, decision) {
  const stylesThatNeedQuestion = new Set(['reply_with_question']);
  if (stylesThatNeedQuestion.has(decision?.replyStyle)) return text;

  const parts = splitSentences(text);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1];
  const genericQuestion = /\?\s*$/.test(last) && /(а (?:как|что) (?:у тебя|ты)|что думаешь|как считаешь|какой разговор|о ч[её]м|есть что-то|хочешь рассказать|какие воспоминания)/i.test(last);
  if (genericQuestion) return parts.slice(0, -1).join(' ').trim();
  return text;
}

export function polishRinReply(reply = '', decision = null) {
  let text = String(reply || '').trim();
  for (const pattern of PREFIXES) text = text.replace(pattern, '');

  text = text
    .replace(/\?{2,}/g, '?')
    .replace(/!{3,}/g, '!!')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  text = text.replace(/\s*(Если (?:хочешь|будет нужно),? (?:я могу|можем)[^.?!]*[.?!]?)$/i, '').trim();
  text = removeGenericFiller(text, decision);
  text = removeAutomaticQuestion(text, decision);

  if (decision?.targetLength === '1–2 предложения') {
    const parts = splitSentences(text);
    if (parts.length > 2) text = parts.slice(0, 2).join(' ').trim();
  }


  if (decision?.character?.shape === 'one_liner') {
    const parts = splitSentences(text);
    if (parts.length > 1) text = parts[0].trim();
  }

  // Короткая игровая форма не должна заканчиваться объяснением собственной шутки.
  if (['bold_tease', 'playful_short'].includes(decision?.replyStyle)) {
    const parts = splitSentences(text);
    if (parts.length > 2) text = parts.slice(0, 2).join(' ').trim();
  }

  return text || '…';
}
