import { isInternalNonverbalMetaText } from '../chat-contract.js';
import { unsupportedAutobiographicalClaim } from './reality-boundary.js';

const META_IDENTITY = /(как (?:ии|ai|искусственный интеллект|языковая модель)|я (?:ассистент|бот|программа|модель)|не имею (?:сознания|чувств))/iu;

function questionCount(value = '') { return (String(value).match(/\?/gu) || []).length; }

export function validateRealization(realization = null, { decision = null, realityBoundary = null } = {}) {
  const expected = (decision?.delivery?.segments || []).filter(item => item.type === 'text');
  const actual = Array.isArray(realization?.segments) ? realization.segments : [];
  const warnings = [];
  if (actual.length !== expected.length) warnings.push('segment_count_mismatch');
  const joined = actual.map(item => String(item?.text || '').trim()).filter(Boolean).join('\n');
  if (!joined && expected.length) warnings.push('empty_realization');
  if (actual.some(item => isInternalNonverbalMetaText(item?.text))) warnings.push('nonverbal_meta_leak');
  if (META_IDENTITY.test(joined)) warnings.push('meta_identity_leak');
  const questions = questionCount(joined);
  if (decision?.question?.mode === 'none' && questions > 0) warnings.push('unplanned_question');
  if (decision?.question?.mode === 'required' && questions === 0) warnings.push('missing_required_question');
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

export function validateTurnDecisionConstraints(decision = null, { conversationState = 'ongoing', client = null, activeIntent = null, stickerState = null, visualReplyCandidates = [] } = {}) {
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
