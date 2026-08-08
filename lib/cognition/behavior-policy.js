import { cleanText, stableHash } from './cognitive-contract.js';
import { deriveCharacterIntent } from '../personality/character-intent-engine.js';
import { deriveRelationshipIntent } from '../personality/relationship-engine.js';
import { directConversation } from './conversation-director.js';
import { detectInitiativeHandoff } from './initiative-handoff.js';

const HEAVY_SCENES = new Set(['emotional_support', 'conflict_repair', 'farewell', 'medical', 'legal', 'financial', 'crisis']);
const PLAYFUL_SCENES = new Set(['romance', 'playful_flirt']);
const AGENCY_ACTS = new Set(['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'carry_playful_tension']);
const EMOTION_QUESTION = /(ревну|ревность|обидел|обиделась|злишь|сердишь|раздраж|расстро|смути|что чувствуешь|что ты чувствуешь|тебя задел)/iu;
const CONCRETE_DETAIL = /(сегодня|вчера|завтра|вечер|утро|работ|проект|встреч|девуш|друг|книг|фильм|музык|песн|игр|машин|поезд|город|купил|сделал|решил|планир|хочу|нравит|люблю)/iu;

function clamp(value, min = 0, max = 100, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function relationshipSnapshot(memory = null, affectiveTurn = null) {
  const relationship = affectiveTurn?.relationshipState || memory?.relationship || {};
  const mood = affectiveTurn?.moodState || memory?.mood || {};
  const trust = Number(relationship.trust) || 0;
  const closeness = Number(relationship.closeness) || 0;
  const playfulness = Number(relationship.playfulness) || 0;
  const affection = Number(mood.affection) || 0;
  const familiar = trust >= 50 && closeness >= 38;
  return {
    trust,
    closeness,
    playfulness,
    attraction: Number(relationship.attraction) || 0,
    vulnerability: Number(relationship.vulnerability) || 0,
    affection,
    familiar,
    close: trust >= 62 && closeness >= 55,
    playfulReady: familiar && (playfulness >= 42 || affection >= 64)
  };
}

function dialogueState(cognition = null, brain = null) {
  return cognition?.dialogueState || {
    scene: brain?.activeScene?.type || 'everyday',
    sceneGoal: brain?.activeScene?.goal || null,
    openHook: brain?.activeScene?.openHook || null,
    reactiveStreak: brain?.activeScene?.reactiveStreak || 0,
    questionStreak: brain?.activeScene?.questionStreak || 0,
    topicDrift: Boolean(brain?.activeScene?.topicDrift)
  };
}

function recentAssistantQuestionCount(history = [], limit = 3) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item?.role === 'assistant' && item?.kind !== 'silence')
    .slice(-limit)
    .filter(item => /\?/u.test(String(item?.content || '')))
    .length;
}

function isExplicitInitiativeHandoff(text, hidden, { scene = '', previousAssistant = '', recentText = '' } = {}) {
  if (hidden === 'invite_rin_initiative') return true;
  return detectInitiativeHandoff(text, { scene, previousAssistant, recentText }).active;
}

function chooseResponseAct({ brain, state, relation, userText, inputReplyTarget, emotionalState, affectiveSignal }) {
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';
  const hidden = brain?.hiddenIntent?.type || 'none';
  const literal = brain?.literalIntent || 'statement';
  const text = cleanText(userText, 1800).toLowerCase();
  const activeEmotion = emotionalState?.primary?.type || null;
  const momentum = emotionalState?.momentum?.direction || 'steady';

  if (inputReplyTarget?.kind === 'sticker' && hidden === 'ask_about_previous_nonverbal') return 'explain_previous_nonverbal';
  if (inputReplyTarget) return 'answer_selected_message';
  const initiativeHandoff = isExplicitInitiativeHandoff(text, hidden, {
    scene,
    previousAssistant: state?.lastRinAction?.meaning || '',
    recentText: [state?.sceneAnchor?.excerpt, state?.openHook?.excerpt].filter(Boolean).join(' ')
  });
  // A tease reveal such as “это была шутка, проверял тебя на ревность” is
  // semantically a relationship move, even if lexical markers like “вообще-то”
  // also look like a factual correction. Preserve the emotional scene first.
  if (affectiveSignal?.type === 'tease_reveal' && momentum === 'playful') return 'carry_playful_tension';
  if (brain?.ambiguity?.shouldClarify) return 'clarify_critical_ambiguity';
  if (brain?.relation?.type === 'correction') return 'acknowledge_correction';
  if (/(?:не отвлекаю|не мешаю|тебе не мешает|ты не занята|ты занята)/iu.test(text)) return 'reassure_with_boundary';
  // Explicit handoff/follow-through outranks a generic follow-up relation. The user is
  // not asking Rin to explain the promise to act; they are asking her to perform it now.
  if (initiativeHandoff) return 'take_lead';
  if (brain?.relation?.type === 'follow_up_on_rin_statement') return 'clarify_self';
  if (literal === 'farewell') return 'close_warmly';
  if (HEAVY_SCENES.has(scene)) return scene === 'conflict_repair' ? 'repair_connection' : 'be_present';


  if (literal === 'question' && activeEmotion && activeEmotion !== 'neutral' && EMOTION_QUESTION.test(text)) {
    return 'name_emotion_if_asked';
  }

  if (affectiveSignal?.type === 'romantic_rival' && activeEmotion === 'jealousy') return 'contained_jealousy';
  if (momentum === 'repairing') return 'soften_after_repair';

  // Active playful momentum is a conversational state, not a question-answering mode.
  // A teasing/challenging question should keep the game alive instead of collapsing
  // into the generic `answer_directly` branch.
  if (momentum === 'playful' && ['playful_irritation', 'playfulness', 'shyness', 'jealousy'].includes(activeEmotion)
      && (affectiveSignal?.type === 'playful_challenge' || hidden === 'continue_playful_tension' || literal === 'short_confirmation'
        || text.length <= 42 || /(?:смуща|попробуй|ну и где|давай|хорошо|иногда хочется|ого|не знаю)/iu.test(text))) {
    return 'carry_playful_tension';
  }

  if (literal === 'question' && !['reclaim_playful_scene', 'continue_playful_tension'].includes(hidden)) return 'answer_directly';

  if (['hurt', 'irritation', 'disappointment'].includes(activeEmotion) && ['tense', 'cooling'].includes(momentum)) {
    return 'hold_emotional_boundary';
  }

  if (scene === 'playful_flirt') {
    if (hidden === 'reclaim_playful_scene' || state?.topicDrift || /(флирт.*(?:философ|уш[её]л|перет[её]к)|мы же играем|подурач)/iu.test(text)) return 'reclaim_scene';
    if (hidden === 'continue_playful_tension') return 'tease_and_advance';
    if (literal === 'short_confirmation' || text.length <= 24) return 'advance_play';
    if ((state?.reactiveStreak || 0) >= 2) return 'take_lead';
    return relation?.playfulReady ? 'playful_stance' : 'warm_playful_reply';
  }

  if (scene === 'romance') {
    if (hidden === 'seek_closeness' || literal === 'affection') return 'reciprocate_closeness';
    return 'personal_closeness';
  }

  if (brain?.relation?.type === 'answers_previous_question' || literal === 'short_confirmation') return 'continue_dependency';
  if (scene === 'reflective') return 'state_personal_view';
  if (literal === 'gratitude') return 'accept_warmly';
  if (literal === 'statement' && text.length >= 28) return 'specific_personal_reaction';
  return 'direct_response';
}

function actionForAct(responseAct) {
  if (responseAct === 'intentional_silence') return 'silence';
  if (['answer_directly', 'answer_selected_message', 'explain_previous_nonverbal', 'acknowledge_correction'].includes(responseAct)) return 'answer';
  if (responseAct === 'clarify_critical_ambiguity') return 'clarify';
  if (['clarify_self', 'name_emotion_if_asked'].includes(responseAct)) return 'disclose';
  if (['repair_connection', 'soften_after_repair'].includes(responseAct)) return 'repair';
  if (['be_present', 'reciprocate_closeness', 'personal_closeness', 'accept_warmly'].includes(responseAct)) return 'react';
  if (['contained_jealousy', 'playful_stance', 'warm_playful_reply'].includes(responseAct)) return 'tease';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'carry_playful_tension'].includes(responseAct)) return 'continue_scene';
  if (responseAct === 'hold_emotional_boundary') return 'boundary';
  if (responseAct === 'specific_personal_reaction' || responseAct === 'state_personal_view') return 'disclose';
  if (responseAct === 'continue_dependency') return 'continue_scene';
  if (responseAct === 'close_warmly') return 'close';
  return 'react';
}

function chooseInitiative({ responseAct, brain, cognition, relation, userText, history, state, emotionalState }) {
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';
  if (AGENCY_ACTS.has(responseAct)) return { mode: responseAct, strength: 90, reason: 'самостоятельный ход уже обязателен по текущей сцене' };
  if (responseAct === 'contained_jealousy') return { mode: 'emotional_stance', strength: 76, reason: 'Рин должна показать собственную реакцию, а не интервьюировать пользователя' };
  if (responseAct === 'hold_emotional_boundary') return { mode: 'emotional_stance', strength: 70, reason: 'активная граница требует собственной позиции' };
  if (responseAct === 'clarify_critical_ambiguity') return { mode: 'none', strength: 0, reason: 'уточнение должно быть единственным действием этого хода' };
  if (['name_emotion_if_asked', 'clarify_self', 'reassure_with_boundary', 'explain_previous_nonverbal'].includes(responseAct)) {
    return { mode: 'personal_disclosure', strength: 68, reason: 'нужен личный ответ Рин от первого лица' };
  }
  if (HEAVY_SCENES.has(scene) || brain?.literalIntent === 'question' || brain?.relation?.type === 'correction') {
    return { mode: 'none', strength: 0, reason: 'прямое смысловое обязательство важнее дополнительной инициативы' };
  }

  const turns = (Array.isArray(history) ? history : []).filter(item => item?.role === 'assistant').length;
  const roll = Number.parseInt(stableHash(`${userText}|${turns}|behavior-policy`).slice(-4), 36) % 100;
  const recentQuestions = recentAssistantQuestionCount(history, 3);
  const emotionallyActive = Boolean(emotionalState?.primary && emotionalState.primary.type !== 'neutral' && emotionalState.primary.intensity >= 35);

  if (cognition?.openLoops?.callback && ((state?.reactiveStreak || 0) >= 2 || (turns >= 5 && roll < 12))) {
    return { mode: 'return_to_open_loop', strength: 72, reason: 'есть релевантная незавершённая деталь, к которой Рин может вернуться сама' };
  }
  if ((state?.reactiveStreak || 0) >= 2 && relation.familiar) {
    return { mode: 'personal_observation', strength: 74, reason: 'Рин слишком долго только отражала пользователя' };
  }
  if (relation.familiar && turns >= 3 && roll >= 12 && roll < 25) {
    return { mode: 'personal_observation', strength: 58, reason: 'редкая собственная деталь Рин внутри текущей темы' };
  }
  if (relation.close && turns >= 5 && recentQuestions === 0 && (state?.questionStreak || 0) === 0
      && !emotionallyActive && cleanText(userText, 1800).length >= 28 && CONCRETE_DETAIL.test(userText) && roll < 7) {
    return { mode: 'specific_personal_question', strength: 52, reason: 'редкий конкретный вопрос из собственного интереса Рин' };
  }
  return { mode: 'none', strength: 0, reason: 'дополнительная инициатива не нужна; собственная позиция остаётся внутри ответа' };
}

function questionPolicy({ brain, state, responseAct, initiative, history }) {
  if (responseAct === 'intentional_silence') return { budget: 0, reason: 'молчание не содержит вопроса' };
  if (responseAct === 'clarify_critical_ambiguity') return { budget: 1, reason: 'один вопрос нужен только для критической неоднозначности' };
  if ((state?.questionStreak || 0) >= 1 || recentAssistantQuestionCount(history, 3) >= 1) {
    return { budget: 0, reason: 'недавний вопрос уже был; новый вопрос превратит разговор в интервью' };
  }
  if (initiative.mode === 'specific_personal_question') return { budget: 1, reason: initiative.reason };
  return { budget: 0, reason: 'ход должен завершаться собственной реакцией или действием Рин, а не встречным вопросом' };
}

function expressionFor({ responseAct, emotionalState }) {
  const type = emotionalState?.primary?.type || 'neutral';
  if (responseAct === 'name_emotion_if_asked') return 'direct_if_asked';
  if (responseAct === 'contained_jealousy' || type === 'jealousy') return 'indirect';
  if (['hold_emotional_boundary', 'repair_connection'].includes(responseAct)) return 'clear_restrained';
  if (['carry_playful_tension', 'take_lead', 'tease_and_advance', 'advance_play', 'playful_stance'].includes(responseAct)) return 'behavior_first';
  return type === 'neutral' ? 'natural' : 'behavior_first';
}

function toneFor({ scene, responseAct, relation }) {
  if (scene === 'emotional_support') return 'supportive_present';
  if (scene === 'conflict_repair') return 'honest_repair';
  if (scene === 'practical_task') return 'focused_competent';
  if (scene === 'farewell') return 'warm_closing';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'carry_playful_tension'].includes(responseAct)) return 'warm_bold_playful';
  if (responseAct === 'contained_jealousy') return 'contained_jealous';
  if (responseAct === 'hold_emotional_boundary') return 'contained_tense';
  if (responseAct === 'soften_after_repair') return 'soft_repair';
  if (PLAYFUL_SCENES.has(scene) && (relation.playfulReady || relation.close)) return 'warm_bold_playful';
  return 'calm_personal';
}

function directnessFor({ scene, responseAct, relation, relationType }) {
  if (relationType === 'correction' || responseAct === 'acknowledge_correction') return 'direct_accountable';
  if (HEAVY_SCENES.has(scene)) return 'gentle_clear';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'carry_playful_tension', 'contained_jealousy'].includes(responseAct)) return 'confident_playful';
  if (responseAct === 'hold_emotional_boundary') return 'direct_personal_boundary';
  if (responseAct === 'soften_after_repair') return 'gentle_clear';
  if (relation.familiar && PLAYFUL_SCENES.has(scene)) return 'confident_playful';
  return relation.familiar ? 'clear_personal' : 'balanced';
}

export function deriveBehaviorPolicy({ cognition = null, brain = null, coreDecision = null, memory = null, userText = '', history = [] } = {}) {
  const affectiveTurn = coreDecision?.affectiveTurn || null;
  const emotionalState = affectiveTurn?.emotionalState || memory?.conversationState?.emotionalState || null;
  const state = dialogueState(cognition, brain);
  const relation = relationshipSnapshot(memory, affectiveTurn);
  const inputReplyTarget = state?.explicitReplyTarget || null;
  const characterIntent = deriveCharacterIntent({ userText, dialogueState: state, brain, memory, affectiveTurn });
  const relationshipIntent = deriveRelationshipIntent({ memory, history, dialogueState: state, affectiveTurn });
  const director = directConversation({ userText, brain, dialogueState: state, history, explicitReplyTarget: inputReplyTarget, characterIntent, relationshipIntent });
  const responseAct = director.delivery === 'silence'
    ? 'intentional_silence'
    : chooseResponseAct({ brain, state, relation, userText, inputReplyTarget, emotionalState, affectiveSignal: affectiveTurn?.signal });
  const initiative = director.delivery === 'silence'
    ? { mode: 'none', strength: 0, reason: 'выбрано осознанное молчание' }
    : chooseInitiative({ responseAct, brain, cognition, relation, userText, history, state, emotionalState });
  const question = questionPolicy({ brain, state, responseAct, initiative, history });
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';
  const action = actionForAct(responseAct);
  const emotionalExpression = expressionFor({ responseAct, emotionalState });
  const topicHold = state?.topicDrift ? 'reclaim' : state?.openHook ? 'hold_open_hook' : 'hold_scene';
  const distance = ['contained_jealousy', 'hold_emotional_boundary'].includes(responseAct) ? 'slightly_withdrawn'
    : ['reciprocate_closeness', 'personal_closeness', 'soften_after_repair'].includes(responseAct) ? 'closer'
      : 'stable';
  const playfulness = ['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'warm_playful_reply', 'carry_playful_tension'].includes(responseAct)
    ? clamp(Math.max(60, relation.playfulness), 0, 100, 60)
    : responseAct === 'contained_jealousy' ? clamp(Math.max(42, relation.playfulness), 0, 100, 42)
      : clamp(relation.playfulness, 0, 100, 0);

  return {
    version: 'rin-behavior-policy-v1.1-agency-follow-through',
    action,
    responseAct,
    initiative: initiative.mode,
    initiativeStrength: initiative.strength,
    questionBudget: question.budget,
    questionReason: question.reason,
    emotionalExpression,
    topicHold,
    distance,
    playfulness,
    directness: directnessFor({ scene, responseAct, relation, relationType: brain?.relation?.type }),
    tone: toneFor({ scene, responseAct, relation }),
    delivery: director.delivery,
    relationship: relation,
    director,
    characterIntent,
    relationshipIntent,
    reasons: [
      `action:${action}`,
      `act:${responseAct}`,
      `initiative:${initiative.mode}`,
      `initiativeReason:${initiative.reason}`,
      `questionBudget:${question.budget}`,
      `questionReason:${question.reason}`,
      `emotionExpression:${emotionalExpression}`,
      `topicHold:${topicHold}`,
      `distance:${distance}`
    ]
  };
}

export function behaviorPolicyInstruction(policy = {}) {
  return [
    'BEHAVIOR POLICY v1.1 — ЕДИНСТВЕННЫЙ ИСТОЧНИК ДИАЛОГОВОГО ДЕЙСТВИЯ',
    `Действие: ${policy.action || 'react'}; речевой акт: ${policy.responseAct || 'direct_response'}.`,
    `Инициатива: ${policy.initiative || 'none'} (${Number(policy.initiativeStrength) || 0}/100).`,
    `Бюджет вопросов: ${Number(policy.questionBudget) || 0}. Причина: ${policy.questionReason || 'вопрос не нужен'}.`,
    `Выражение эмоции: ${policy.emotionalExpression || 'natural'}; дистанция: ${policy.distance || 'stable'}; удержание темы: ${policy.topicHold || 'hold_scene'}.`,
    'Не меняй действие на встречный вопрос, мета-комментарий или нейтральное одобрение. Если бюджет вопросов 0 — в реплике не должно быть вопросительного предложения.'
  ].join('\n');
}
