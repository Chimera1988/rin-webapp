import { isInternalNonverbalMetaText } from '../chat-contract.js';
import { unsupportedAutobiographicalClaim } from './reality-boundary.js';

const USER_FEMININE_ADDRESS = [
  /(?:^|[^\p{L}\p{N}_])ты\s+(?:решила|сделала|сказала|подумала|захотела|хотела|смогла|могла|стала|была|осталась|пришла|ушла|поняла|забыла|вспомнила|выбрала|нашла|попробовала|начала|продолжила|пошла|спросила|ответила|написала|прочитала|увидела|услышала|заметила|собралась|обещала|поддержала|проверила)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:^|[^\p{L}\p{N}_])ты\s+(?:готова|права|рада|сама|одна|уверена|согласна|занята|свободна|довольна|сердита|обижена|смущена|заинтригована|устала)(?=$|[^\p{L}\p{N}_])/iu
];

const META_IDENTITY = /(как (?:ии|ai|искусственный интеллект|языковая модель)|я (?:ассистент|бот|программа|модель)|не имею (?:сознания|чувств))/iu;
const USER_REPEAT_REQUEST = /(?:повтори|повторишь|повторить|дословно|скажи\s+(?:это\s+)?(?:ещ[её]\s+раз|снова))/iu;

function questionCount(value = '') { return (String(value).match(/\?/gu) || []).length; }

function duplicateKey(value = '') {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenBigrams(value = '') {
  const words = duplicateKey(value).split(' ').filter(Boolean);
  const out = new Set();
  for (let index = 0; index < words.length - 1; index += 1) out.add(`${words[index]} ${words[index + 1]}`);
  return out;
}

function nearDuplicateScore(left = '', right = '') {
  const a = duplicateKey(left);
  const b = duplicateKey(right);
  if (!a || !b) return 0;
  const aWords = a.split(' ').filter(Boolean);
  const bWords = b.split(' ').filter(Boolean);
  if (Math.min(a.length, b.length) < 60 || Math.min(aWords.length, bWords.length) < 8) return 0;
  if (a === b) return 1;
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lengthRatio < 0.75) return 0;
  const aPairs = tokenBigrams(a);
  const bPairs = tokenBigrams(b);
  if (!aPairs.size || !bPairs.size) return 0;
  let overlap = 0;
  for (const pair of aPairs) if (bPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (aPairs.size + bPairs.size);
}

function duplicateKind(left = '', right = '') {
  const a = duplicateKey(left);
  const b = duplicateKey(right);
  if (!a || !b) return null;
  const minWords = Math.min(a.split(' ').filter(Boolean).length, b.split(' ').filter(Boolean).length);
  if (a === b && (Math.min(a.length, b.length) >= 24 || minWords >= 4)) return 'exact';
  return nearDuplicateScore(left, right) >= 0.84 ? 'near' : null;
}

function recentAssistantTexts(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item?.role === 'assistant' && item?.content && !['sticker', 'silence'].includes(item?.kind || 'text'))
    .slice(-4)
    .map(item => String(item.content || '').trim())
    .filter(Boolean);
}

export function validateRealization(realization = null, { decision = null, realityBoundary = null, recentHistory = [], currentUserText = '' } = {}) {
  const expected = (decision?.delivery?.segments || []).filter(item => item.type === 'text');
  const actual = Array.isArray(realization?.segments) ? realization.segments : [];
  const warnings = [];
  if (actual.length !== expected.length) warnings.push('segment_count_mismatch');
  const joined = actual.map(item => String(item?.text || '').trim()).filter(Boolean).join('\n');
  if (!joined && expected.length) warnings.push('empty_realization');
  if (actual.some(item => isInternalNonverbalMetaText(item?.text))) warnings.push('nonverbal_meta_leak');
  if (META_IDENTITY.test(joined)) warnings.push('meta_identity_leak');
  if (USER_FEMININE_ADDRESS.some(pattern => pattern.test(joined))) warnings.push('user_feminine_address');

  for (let left = 0; left < actual.length; left += 1) {
    for (let right = left + 1; right < actual.length; right += 1) {
      if (duplicateKind(actual[left]?.text, actual[right]?.text)) warnings.push('duplicate_text_segments');
    }
  }

  if (!USER_REPEAT_REQUEST.test(String(currentUserText || ''))) {
    const recentTexts = recentAssistantTexts(recentHistory);
    let exactRecent = false;
    let nearRecent = false;
    for (const segment of actual) {
      for (const previous of recentTexts) {
        const kind = duplicateKind(segment?.text, previous);
        if (kind === 'exact') exactRecent = true;
        if (kind === 'near') nearRecent = true;
      }
    }
    if (exactRecent) warnings.push('recent_assistant_duplicate');
    else if (nearRecent) warnings.push('recent_assistant_near_duplicate');
  }

  const questions = questionCount(joined);
  if (decision?.question?.mode === 'none' && questions > 0) warnings.push('unplanned_question');
  if (decision?.question?.mode === 'required' && questions === 0) warnings.push('missing_required_question');
  if (decision?.question?.mode === 'natural' && questions === 0) warnings.push('missing_natural_question');
  if (questions > 1) warnings.push('too_many_questions');
  for (let index = 0; index < actual.length; index += 1) {
    const maxChars = Number(expected[index]?.maxChars) || 5000;
    if (String(actual[index]?.text || '').length > maxChars) warnings.push(`segment_${index}_too_long`);
  }
  const realityViolation = unsupportedAutobiographicalClaim(joined, realityBoundary || {});
  if (realityViolation) warnings.push(realityViolation.type);
  return {
    version: 'rin-turn-validator-v1',
    passed: warnings.length === 0,
    warnings,
    reply: joined
  };
}

export function validateTurnDecisionConstraints(decision = null, { conversationState = 'ongoing', client = null, activeIntent = null, stickerState = null, visualReplyCandidates = [], reciprocity = null } = {}) {
  const warnings = [];
  const segments = Array.isArray(decision?.delivery?.segments) ? decision.delivery.segments : [];
  const stickerCount = segments.filter(item => item?.type === 'sticker').length;
  const textCount = segments.filter(item => item?.type === 'text').length;
  const hasSticker = stickerCount > 0;
  const hasText = textCount > 0;
  if (segments.some(item => item?.type === 'sticker' && !String(item?.stickerIntent || '').trim())) warnings.push('sticker_segment_requires_intent');
  const mode = decision?.delivery?.mode;
  const questionMode = decision?.question?.mode || 'none';
  const operation = decision?.intentTransition?.operation || 'none';
  const currentStatus = activeIntent?.status || null;
  const hasLiveIntent = ['active', 'suspended'].includes(currentStatus);

  const visualReplyTarget = String(decision?.replyLink?.targetEventId || '').trim();
  const allowedVisualReplyIds = new Set((Array.isArray(visualReplyCandidates) ? visualReplyCandidates : []).map(item => String(item?.eventId || item || '').trim()).filter(Boolean));
  if (visualReplyTarget && !allowedVisualReplyIds.has(visualReplyTarget)) warnings.push('visual_reply_target_not_allowed');

  if (client?.sticker?.mode === 'off' && hasSticker) warnings.push('sticker_disabled_by_user');
  if (stickerState?.available === false && hasSticker) warnings.push('sticker_unavailable_by_state');
  if (stickerCount > 1) warnings.push('max_one_sticker_per_turn');

  if (operation === 'activate' && !String(decision?.intentTransition?.goal || '').trim()) warnings.push('intent_activate_requires_goal');
  if (operation === 'activate' && hasLiveIntent) warnings.push('intent_activate_conflicts_existing');
  if (operation === 'activate' && ['completed', 'cancelled'].includes(currentStatus)) {
    const nextGoal = String(decision?.intentTransition?.goal || '').trim().toLowerCase();
    const oldGoal = String(activeIntent?.goal || '').trim().toLowerCase();
    if (nextGoal && oldGoal && nextGoal === oldGoal) warnings.push('terminal_intent_cannot_reactivate_same_goal');
  }
  if (['advance', 'suspend', 'complete', 'cancel'].includes(operation) && !hasLiveIntent) warnings.push('intent_transition_requires_live_intent');
  if (conversationState === 'ending' && operation === 'activate') warnings.push('farewell_cannot_activate_intent');
  if (conversationState === 'ending' && hasLiveIntent && !['complete', 'cancel'].includes(operation)) warnings.push('farewell_must_close_live_intent');
  if (reciprocity?.reciprocalQuestionExpected && questionMode === 'none') warnings.push('reciprocal_question_expected');

  if (mode === 'silence' && segments.length) warnings.push('silence_must_have_no_segments');
  if (mode === 'silence' && questionMode !== 'none') warnings.push('silence_cannot_have_question');
  if (mode === 'silence' && visualReplyTarget) warnings.push('silence_cannot_have_visual_reply');
  if (mode === 'sticker_only' && !(stickerCount === 1 && textCount === 0 && segments.length === 1)) warnings.push('sticker_only_requires_exactly_one_sticker');
  if (mode === 'single_text' && !(textCount === 1 && stickerCount === 0 && segments.length === 1)) warnings.push('single_text_requires_exactly_one_text');
  if (mode === 'text_plus_sticker' && !(hasText && hasSticker)) warnings.push('text_plus_sticker_requires_both');
  if (mode === 'multi_message' && segments.length < 2) warnings.push('multi_message_requires_multiple_segments');
  if (mode === 'multi_message' && segments.length > 3) warnings.push('multi_message_too_many_segments');

  return {
    version: 'rin-turn-decision-validator-v2',
    passed: warnings.length === 0,
    warnings
  };
}
