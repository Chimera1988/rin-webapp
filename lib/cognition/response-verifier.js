import { cleanText } from './cognitive-contract.js';

const META_IDENTITY = /(как (?:ии|ai|искусственный интеллект|языковая модель)|я (?:ассистент|бот|программа|модель)|не имею (?:сознания|чувств))/iu;
const GENERIC_TRAILING_QUESTION = /(?:\s+|^)(?:А ты\?|Что думаешь\?|Как тебе\?|Хочешь рассказать\?|Как ты себя чувствуешь\?|Чем я могу помочь\?)\s*$/iu;
const GENERIC_SUPPORT = /(каждый человек уникален|важно помнить|главное — продолжать двигаться|всегда рада помочь|обращайся)/iu;
const NONVERBAL_META_BLOCK = /\[(?:Невербальный\s+жест|Невербальная\s+реакция|Эмоциональный\s+жест|Стикер)\s+Рин\s*:\s*([^\];\n]+?)(?:\s*;\s*причина\s*:\s*([^\]\n]+?))?\s*\]/giu;

function trimGenericQuestion(reply, plan) {
  if (plan?.shouldAskQuestion || !GENERIC_TRAILING_QUESTION.test(reply)) return { reply, repaired: false };
  const next = reply.replace(GENERIC_TRAILING_QUESTION, '').trim();
  return { reply: next || reply, repaired: Boolean(next) };
}

function stripMetaPrefix(reply) {
  if (!META_IDENTITY.test(reply)) return { reply, repaired: false };
  const sentences = reply.split(/(?<=[.!?…])\s+/u);
  const kept = sentences.filter(sentence => !META_IDENTITY.test(sentence));
  const next = kept.join(' ').trim();
  return { reply: next || reply, repaired: Boolean(next) };
}

function stickerIdForMeaning(value = '') {
  const text = String(value || '').toLowerCase();
  if (/(кивок|соглас|подтвержд)/u.test(text)) return 'agreement';
  if (/(ревност|приревнов)/u.test(text)) return 'mild_jealousy';
  if (/(поцел|целу|чмок)/u.test(text)) return 'kiss';
  if (/(обним|объят)/u.test(text)) return 'embrace';
  if (/(смущ|застенч|красне)/u.test(text)) return 'shy';
  if (/(удив|неожидан|заинтересован)/u.test(text)) return 'surprise_interest';
  if (/(радост|счаст|восторг)/u.test(text)) return 'joy';
  if (/(тёпл|тепл|нежн)/u.test(text)) return 'warm_smile';
  if (/(улыб)/u.test(text)) return 'smile';
  if (/(задум|размыш|мысл)/u.test(text)) return 'thoughtful';
  return 'neutral';
}

function fallbackTextForMeaning(value = '') {
  const id = stickerIdForMeaning(value);
  const map = {
    agreement: 'Угу.',
    mild_jealousy: 'Немного приревновала.',
    kiss: 'Целую.',
    embrace: 'Иди сюда.',
    shy: 'Немного смутилась.',
    surprise_interest: 'Ого.',
    joy: 'Вот это приятно.',
    warm_smile: 'Мне приятно.',
    smile: 'Мм…',
    thoughtful: 'Задумалась.',
    neutral: 'Мм.'
  };
  return map[id] || map.neutral;
}

function stripNonverbalMeta(reply) {
  let first = null;
  let count = 0;
  const stripped = reply.replace(NONVERBAL_META_BLOCK, (_full, meaning, cause) => {
    count += 1;
    if (!first) {
      const cleanMeaning = cleanText(meaning, 240);
      first = {
        meaning: cleanMeaning,
        cause: cleanText(cause, 280) || null,
        preferredStickerId: stickerIdForMeaning(cleanMeaning)
      };
    }
    return ' ';
  });
  const next = cleanText(stripped, 8000).replace(/\s+([,.!?…])/gu, '$1').trim();
  const metaOnly = count > 0 && !next;
  return {
    reply: metaOnly ? fallbackTextForMeaning(first?.meaning) : next,
    repaired: count > 0,
    metaOnly,
    event: first
  };
}

export function verifyReply(rawReply = '', { plan = null, brain = null, userText = '' } = {}) {
  const original = cleanText(rawReply, 8000);
  const warnings = [];
  const repairs = [];
  let reply = original;

  if (!reply) warnings.push('empty_reply');
  if (META_IDENTITY.test(reply)) warnings.push('meta_identity_leak');
  if (GENERIC_SUPPORT.test(reply)) warnings.push('generic_support_pattern');

  const nonverbalRepair = stripNonverbalMeta(reply);
  if (nonverbalRepair.repaired) {
    reply = nonverbalRepair.reply;
    warnings.push('internal_nonverbal_meta_leak');
    repairs.push(nonverbalRepair.metaOnly ? 'replaced_meta_only_nonverbal_reply' : 'removed_internal_nonverbal_meta');
  }

  const metaRepair = stripMetaPrefix(reply);
  if (metaRepair.repaired) {
    reply = metaRepair.reply;
    repairs.push('removed_meta_identity_sentence');
  }

  const questionRepair = trimGenericQuestion(reply, plan);
  if (questionRepair.repaired) {
    reply = questionRepair.reply;
    repairs.push('removed_unplanned_generic_question');
  }

  const userAskedQuestion = /\?/.test(String(userText || '')) || brain?.literalIntent === 'question';
  if (userAskedQuestion && reply.length < 8) warnings.push('possibly_incomplete_answer');
  if (brain?.relation?.type === 'correction' && !/(понял|поняла|да[, ]|точно|неверно|не так|тогда|исправ)/iu.test(reply)) {
    warnings.push('correction_not_acknowledged');
  }
  if (!plan?.shouldAskQuestion && /\?\s*$/.test(reply)) warnings.push('unplanned_question');
  if (plan?.delivery === 'sticker_only' && reply.length > 500) warnings.push('hidden_text_too_long_for_sticker_only');

  return {
    version: 'rin-response-verifier-v2',
    reply: reply || original,
    passed: Boolean(reply) && !META_IDENTITY.test(reply) && !warnings.includes('internal_nonverbal_meta_unrepaired'),
    warnings,
    repairs,
    nonverbalLeak: nonverbalRepair.event ? {
      ...nonverbalRepair.event,
      metaOnly: nonverbalRepair.metaOnly,
      fallbackText: reply
    } : null
  };
}
