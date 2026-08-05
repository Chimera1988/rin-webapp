import { cleanText } from './cognitive-contract.js';

const META_IDENTITY = /(как (?:ии|ai|искусственный интеллект|языковая модель)|я (?:ассистент|бот|программа|модель)|не имею (?:сознания|чувств))/iu;
const GENERIC_TRAILING_QUESTION = /(?:\s+|^)(?:А ты\?|Что думаешь\?|Как тебе\?|Хочешь рассказать\?|Как ты себя чувствуешь\?|Чем я могу помочь\?)\s*$/iu;
const GENERIC_SUPPORT = /(каждый человек уникален|важно помнить|главное — продолжать двигаться|всегда рада помочь|обращайся)/iu;

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

export function verifyReply(rawReply = '', { plan = null, brain = null, userText = '' } = {}) {
  const original = cleanText(rawReply, 8000);
  const warnings = [];
  const repairs = [];
  let reply = original;

  if (!reply) warnings.push('empty_reply');
  if (META_IDENTITY.test(reply)) warnings.push('meta_identity_leak');
  if (GENERIC_SUPPORT.test(reply)) warnings.push('generic_support_pattern');

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
    version: 'rin-response-verifier-v1',
    reply: reply || original,
    passed: !warnings.includes('empty_reply') && !warnings.includes('meta_identity_leak'),
    warnings,
    repairs
  };
}
