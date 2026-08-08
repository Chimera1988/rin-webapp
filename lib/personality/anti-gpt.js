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

function paragraphSentences(text) {
  return String(text || '').split(/\n{2,}/).map(paragraph => splitSentences(paragraph));
}

function joinParagraphSentences(groups) {
  return groups
    .map(parts => parts.filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function removeGenericFiller(text, decision) {
  const groups = paragraphSentences(text);
  const parts = groups.flat();
  if (parts.length <= 1 || !parts.some(isGeneric)) return text;

  let globalIndex = 0;
  const filteredGroups = groups.map(group => group.filter(sentence => {
    const index = globalIndex++;
    if (!isGeneric(sentence)) return true;
    // Не удаляем единственную содержательную первую фразу в поддержке.
    if (index === 0 && ['comfort', 'support'].includes(decision?.intent)) return true;
    return false;
  }));
  const kept = filteredGroups.flat();
  const onlyQuestionRemains = kept.length === 1 && /\?\s*$/.test(kept[0]) && parts.some(p => !/\?\s*$/.test(p));
  if (onlyQuestionRemains) {
    const statement = parts.find(p => !/\?\s*$/.test(p));
    return statement || kept[0];
  }
  return joinParagraphSentences(kept.length ? filteredGroups : [[parts[0]]]);
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


  if (decision?.character?.shape === 'one_liner' && decision?.emotionalResponse?.expansion !== 'developed') {
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
