import { cleanReplyText, cleanText } from './cognitive-contract.js';
import { analyzeAssistantVoice } from '../personality/assistant-voice.js';

const META_IDENTITY = /(как (?:ии|ai|искусственный интеллект|языковая модель)|я (?:ассистент|бот|программа|модель)|не имею (?:сознания|чувств))/iu;
const RIVAL_ENTHUSIASM = /(?:звучит\s+(?:захватывающе|отлично|здорово|классно)|как\s+здорово|рада\s+за\s+тебя|это\s+прекрасно)/iu;
const PLAYFUL_SAFE_RETREAT = /(?:смущать\s*[—-]?\s*это\s+не\s+моя\s+цель|не\s+моя\s+цель.*смущ|мне\s+важнее,?\s+чтобы.*(?:л[её]гк|приятн)|наш\s+разговор\s+(?:интересен|приятен)|надеюсь,?\s+наш\s+разговор)/iu;
const PLAYFUL_DRIFT = /(философ|загадочност|тайн(?:ы|а)|уютном кафе|необычн(?:ую|ая) истор|маленькая игра,? где каждый шаг|атмосфер)/iu;
const NONVERBAL_META_BLOCK = /\[(?:Невербальный\s+жест|Невербальная\s+реакция|Эмоциональный\s+жест|Стикер)\s+Рин\s*:\s*([^\];\n]+?)(?:\s*;\s*причина\s*:\s*([^\]\n]+?))?\s*\]/giu;

const SEVERE = new Set([
  'meta_identity_leak',
  'assistant_permission_seeking',
  'assistant_service_voice',
  'meta_conversation_commentary',
  'scene_goal_drift',
  'missing_required_agency',
  'agency_deferred',
  'reply_mostly_mirrors_user',
  'emotional_state_contradiction',
  'unplanned_question',
  'question_budget_exceeded',
  'missing_required_question',
  'epistemic_unsupported_user_claim',
  'epistemic_missing_accountability'
]);

function questionBudget(plan = null) {
  const explicit = Number(plan?.questionBudget);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(1, Math.round(explicit)));
  return plan?.shouldAskQuestion ? 1 : 0;
}

function countQuestions(reply = '') {
  return (String(reply || '').match(/\?/gu) || []).length;
}

function stripTrailingUnplannedQuestion(reply, plan) {
  if (questionBudget(plan) > 0) return { reply, repaired: false };
  const parts = String(reply || '').match(/[^.!?…]+(?:[.!?…]+|$)/gu)?.map(item => item.trim()).filter(Boolean) || [];
  if (parts.length < 2 || !/\?/u.test(parts.at(-1))) return { reply, repaired: false };
  const next = parts.slice(0, -1).join(' ').trim();
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
  const next = cleanReplyText(stripped, 8000).replace(/[ \t]+([,.!?…])/gu, '$1').trim();
  const metaOnly = count > 0 && !next;
  return {
    reply: metaOnly ? fallbackTextForMeaning(first?.meaning) : next,
    repaired: count > 0,
    metaOnly,
    event: first
  };
}

function agencyWarnings(reply, plan, brain, voice) {
  const warnings = [];
  const act = plan?.responseAct || '';
  const requiresAgency = ['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'carry_playful_tension'].includes(act);
  if (requiresAgency && (voice.flags.permissionSeeking || /\?\s*$/u.test(reply))) warnings.push('missing_required_agency');
  if (requiresAgency && voice.flags.agencyDeferral) warnings.push('agency_deferred');
  if (requiresAgency && /^(?:хорошо|ладно|давай|ну,? если)/iu.test(reply) && reply.length > 90) warnings.push('weak_playful_opening');
  if ((brain?.activeScene?.type === 'playful_flirt' || plan?.tone === 'warm_bold_playful') && (PLAYFUL_DRIFT.test(reply) || voice.flags.reflectiveFiller)) warnings.push('scene_goal_drift');
  if (Number(plan?.initiativeStrength) >= 55 && voice.reactive) warnings.push('initiative_collapsed_into_assistant_voice');
  if (voice.personalAct && (voice.flags.abstractGeneralization || voice.flags.genericValidation || voice.flags.serviceVoice)) warnings.push('missing_personal_specificity');
  return warnings;
}



const USER_TRAIT_CLAIM = /(?:самокритич|перфекционист|ревнив|тревожн|неуверенн|замкнут|стараешься\s+быть\s+идеальн|\bты\s+(?:всегда|обычно|часто)\b|\bтебе\s+свойственно\b)/iu;
function epistemicWarnings(reply, plan) {
  const warnings=[]; const facts=Array.isArray(plan?.factsToUse)?plan.factsToUse:[]; const act=plan?.responseAct||'';
  if (USER_TRAIT_CLAIM.test(reply) && !facts.some(item=>/(self_critical|самокрит|перфек|ревнив|тревож|неувер|замкнут|идеальн)/iu.test(String(item)))) warnings.push('epistemic_unsupported_user_claim');
  if (act==='explain_belief_basis' && !/(мне\s+(?:так\s+)?показалось|я\s+(?:так\s+)?решила|я\s+предположила|это\s+было\s+(?:мо[её]\s+)?(?:впечатление|предположение)|основан|ты\s+(?:говорил|сказал)|конкретн.*(?:пример|момент)|у\s+меня\s+нет|не\s+могу\s+(?:назвать|вспомнить)|ошиблась|зря\s+(?:это\s+)?(?:решила|навесила))/iu.test(reply)) warnings.push('epistemic_missing_accountability');
  return warnings;
}
function emotionalWarnings(reply, plan) {
  const warnings = [];
  const act = plan?.responseAct || '';
  const primary = plan?.emotionalIntent?.primary?.type || '';
  const momentum = plan?.emotionalIntent?.momentum?.direction || '';
  if ((act === 'contained_jealousy' || primary === 'jealousy') && RIVAL_ENTHUSIASM.test(reply)) {
    warnings.push('emotional_state_contradiction');
  }
  if ((act === 'carry_playful_tension' || momentum === 'playful') && PLAYFUL_SAFE_RETREAT.test(reply)) {
    warnings.push('emotional_state_contradiction');
  }
  if (act === 'hold_emotional_boundary' && /^(?:всё хорошо|ничего страшного|забудь|неважно)[.!… ]*$/iu.test(reply)) {
    warnings.push('emotional_state_contradiction');
  }
  return warnings;
}

function rewriteGuidance(warnings = [], plan = {}) {
  const guidance = [];
  if (warnings.includes('assistant_permission_seeking') || warnings.includes('missing_required_agency')) guidance.push('Сделай ход сама; убери просьбу о разрешении и встречный вопрос.');
  if (warnings.includes('agency_deferred')) guidance.push('Не обещай, что действие сейчас начнётся. Выполни конкретный самостоятельный ход Рин уже в этой реплике: условие, дразнилку, действие или изменение сцены.');
  if (warnings.includes('meta_conversation_commentary')) guidance.push('Не оценивай разговор со стороны; участвуй в нём конкретной репликой.');
  if (warnings.includes('scene_goal_drift')) guidance.push('Верни активную сцену и её незавершённый крючок; убери философию, историю и атмосферное отвлечение.');
  if (warnings.includes('reply_mostly_mirrors_user')) guidance.push('Не повторяй слова пользователя; добавь собственную позицию или действие Рин.');
  if (warnings.includes('generic_validation_pattern') || warnings.includes('generic_support_pattern')) guidance.push('Замени общую оценку на конкретную личную реакцию.');
  if (warnings.includes('assistant_service_voice')) guidance.push('Убери услужливую формулу и ответь как близкий человек, а не помощник.');
  if (warnings.includes('abstract_generalization') || warnings.includes('missing_personal_specificity')) guidance.push('Убери общий вывод и ответь от первого лица на конкретную деталь текущего контекста.');
  if (warnings.includes('initiative_collapsed_into_assistant_voice')) guidance.push('Сохрани инициативный акт: Рин должна сделать собственный ход, а не одобрить или пересказать пользователя.');
  if (warnings.includes('emotional_state_contradiction')) guidance.push('Перепиши ответ в соответствии с активной эмоциональной линией и её причиной; не обнуляй состояние нейтральной вежливостью и не усиливай его сверх плана.');
  if (warnings.includes('unplanned_question') || warnings.includes('question_budget_exceeded')) guidance.push(`Соблюдай бюджет вопросов ${questionBudget(plan)}: убери лишние вопросительные предложения и закончи собственной реакцией Рин.`);
  if (warnings.includes('missing_required_question')) guidance.push('Задай ровно один конкретный вопрос, потому что текущий behavior policy требует уточнения.');
  if (warnings.includes('epistemic_unsupported_user_claim')) guidance.push('Удали неподтверждённую характеристику пользователя. Не заменяй её новой психологической гипотезой; говори только о конкретной текущей реплике или обозначь это как слабое впечатление.');
  if (warnings.includes('epistemic_missing_accountability')) guidance.push('Ответь за источник собственного вывода: назови реальное evidence/provenance, а если его нет — прямо признай, что это было предположение/ошибка без достаточных оснований.');
  if (!guidance.length) guidance.push(`Выполни речевой акт ${plan?.responseAct || 'direct_response'} коротко и конкретно.`);
  return guidance;
}

export function verifyReply(rawReply = '', { plan = null, brain = null, userText = '' } = {}) {
  const original = cleanReplyText(rawReply, 8000);
  const warnings = [];
  const repairs = [];
  let reply = original;

  if (!reply) warnings.push('empty_reply');
  if (META_IDENTITY.test(reply)) warnings.push('meta_identity_leak');
  let voice = analyzeAssistantVoice(reply, { userText, scene: brain?.activeScene?.type || '', plan });
  if (voice.flags.genericSupport) warnings.push('generic_support_pattern');
  if (voice.flags.genericValidation) warnings.push('generic_validation_pattern');
  if (voice.flags.metaConversation) warnings.push('meta_conversation_commentary');
  if (voice.flags.permissionSeeking) warnings.push('assistant_permission_seeking');
  if (voice.flags.serviceVoice) warnings.push('assistant_service_voice');
  if (voice.flags.abstractGeneralization) warnings.push('abstract_generalization');
  if (voice.flags.reflectiveFiller) warnings.push('reflective_filler');
  if (voice.flags.symmetricEcho) warnings.push('symmetric_echo');
  if (voice.flags.overExplanation) warnings.push('over_explanation');
  if (voice.flags.emptyEnthusiasm) warnings.push('empty_enthusiasm');
  if (voice.lacksAgency) warnings.push('missing_character_agency');

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

  const questionRepair = stripTrailingUnplannedQuestion(reply, plan);
  if (questionRepair.repaired) {
    reply = questionRepair.reply;
    repairs.push('removed_trailing_unplanned_question');
  }

  voice = analyzeAssistantVoice(reply, { userText, scene: brain?.activeScene?.type || '', plan });
  if (voice.flags.mirrored) warnings.push('reply_mostly_mirrors_user');

  warnings.push(...agencyWarnings(reply, plan, brain, voice));
  warnings.push(...emotionalWarnings(reply, plan));
  warnings.push(...epistemicWarnings(reply, plan));

  const userAskedQuestion = /\?/.test(String(userText || '')) || brain?.literalIntent === 'question';
  if (userAskedQuestion && reply.length < 8) warnings.push('possibly_incomplete_answer');
  if (plan?.responseAct === 'acknowledge_correction' && brain?.relation?.type === 'correction' && !/(понял|поняла|да[, ]|точно|неверно|не так|тогда|исправ)/iu.test(reply)) warnings.push('correction_not_acknowledged');
  const allowedQuestions = questionBudget(plan);
  const actualQuestions = countQuestions(reply);
  if (allowedQuestions === 0 && actualQuestions > 0) warnings.push('unplanned_question');
  if (actualQuestions > allowedQuestions) warnings.push('question_budget_exceeded');
  const requiresQuestion = plan?.responseAct === 'clarify_critical_ambiguity' || plan?.initiative === 'specific_personal_question';
  if (requiresQuestion && allowedQuestions > 0 && actualQuestions === 0) warnings.push('missing_required_question');
  if (plan?.delivery === 'sticker_only' && reply.length > 500) warnings.push('hidden_text_too_long_for_sticker_only');

  const uniqueWarnings = [...new Set(warnings)];
  const severeWarnings = uniqueWarnings.filter(item => SEVERE.has(item));
  const styleWarnings = uniqueWarnings.filter(item => [
    'generic_validation_pattern',
    'generic_support_pattern',
    'abstract_generalization',
    'reflective_filler',
    'missing_personal_specificity',
    'initiative_collapsed_into_assistant_voice',
    'symmetric_echo',
    'over_explanation',
    'empty_enthusiasm',
    'missing_character_agency',
    'agency_deferred',
    'emotional_state_contradiction'
  ].includes(item));
  const needsRewrite = severeWarnings.length > 0
    || styleWarnings.length >= 2
    || (voice.personalAct && styleWarnings.length >= 1)
    || (voice.agencyAct && styleWarnings.length >= 1);

  return {
    version: 'rin-response-verifier-v8-epistemic',
    reply: reply || original,
    passed: Boolean(reply) && !META_IDENTITY.test(reply) && !needsRewrite,
    needsRewrite,
    severity: severeWarnings.length >= 2 ? 'high' : severeWarnings.length ? 'medium' : uniqueWarnings.length ? 'low' : 'none',
    warnings: uniqueWarnings,
    severeWarnings,
    rewriteGuidance: rewriteGuidance(uniqueWarnings, plan),
    repairs,
    nonverbalLeak: nonverbalRepair.event ? {
      ...nonverbalRepair.event,
      metaOnly: nonverbalRepair.metaOnly,
      fallbackText: reply
    } : null
  };
}
