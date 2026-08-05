import {
  cleanText,
  clamp01,
  normalizeMessageTarget,
  normalizeResponsePlan,
  stableHash,
  uniqueStrings
} from './cognitive-contract.js';

const HEAVY_SCENES = new Set(['emotional_support', 'conflict_repair', 'farewell', 'medical', 'legal', 'financial', 'crisis']);
const REPLY_INITIATIVES = new Set(['specific_personal_question', 'personal_question', 'return_to_open_loop']);
const PLAYFUL_SCENES = new Set(['romance', 'playful_flirt']);

function relationshipLevel(memory = null) {
  const relationship = memory?.relationship || {};
  const mood = memory?.mood || {};
  const trust = Number(relationship.trust) || 0;
  const closeness = Number(relationship.closeness) || 0;
  const playfulness = Number(relationship.playfulness) || 0;
  const affection = Number(mood.affection) || 0;
  const familiar = trust >= 50 && closeness >= 38;
  return {
    trust,
    closeness,
    playfulness,
    affection,
    familiar,
    close: trust >= 62 && closeness >= 55,
    playfulReady: familiar && (playfulness >= 42 || affection >= 64)
  };
}

function dialogue(cognition = null, brain = null) {
  return cognition?.dialogueState || {
    scene: brain?.activeScene?.type || 'everyday',
    sceneGoal: brain?.activeScene?.goal || null,
    openHook: brain?.activeScene?.openHook || null,
    reactiveStreak: brain?.activeScene?.reactiveStreak || 0,
    questionStreak: brain?.activeScene?.questionStreak || 0,
    topicDrift: Boolean(brain?.activeScene?.topicDrift)
  };
}

function goalOf(brain = null, inputReplyTarget = null, responseAct = 'direct_response') {
  if (!brain) return 'ответить на текущую реплику по смыслу';
  if (brain.relation?.type === 'correction') return 'принять исправление и продолжить уже в новой фактической рамке';
  if (brain.hiddenIntent?.type === 'ask_about_previous_nonverbal') return 'объяснить собственную предыдущую невербальную реакцию и её причину';
  if (brain.hiddenIntent?.type === 'seek_emotional_presence') return 'дать личное эмоциональное присутствие без преждевременного совета';
  if (brain.hiddenIntent?.type === 'seek_solution') return 'дать конкретную опору или следующий шаг после короткого признания состояния';
  if (responseAct === 'take_lead') return 'принять переданную инициативу и самой сделать следующий ход';
  if (responseAct === 'reclaim_scene') return 'вернуть активную сцену конкретным действием вместо обсуждения её со стороны';
  if (responseAct === 'explain_previous_nonverbal') return 'объяснить собственный предыдущий жест коротко, лично и с конкретной причиной';
  if (responseAct === 'clarify_self') return 'прояснить собственную предыдущую мысль от первого лица, не обобщая за всех';
  if (responseAct === 'reassure_with_boundary') return 'прямо снять сомнение пользователя и показать, что Рин сама обозначит границу, если будет занята';
  if (inputReplyTarget) return 'ответить на выбранное пользователем сообщение с учётом новой реплики';
  if (brain.literalIntent === 'question') return 'сначала прямо ответить на вопрос пользователя';
  if (brain.literalIntent === 'farewell') return 'тепло завершить разговор без новой темы';
  return brain.responseFocus || 'отреагировать на смысл и сохранить непрерывность разговора';
}

function responseActOf({ brain = null, state = null, relation = null, userText = '', inputReplyTarget = null } = {}) {
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';
  const hidden = brain?.hiddenIntent?.type || 'none';
  const literal = brain?.literalIntent || 'statement';
  const text = cleanText(userText, 1800).toLowerCase();

  if (inputReplyTarget?.kind === 'sticker' && brain?.hiddenIntent?.type === 'ask_about_previous_nonverbal') return 'explain_previous_nonverbal';
  if (inputReplyTarget) return 'answer_selected_message';
  if (brain?.relation?.type === 'correction') return 'acknowledge_correction';
  if (/(?:не отвлекаю|не мешаю|тебе не мешает|ты не занята|ты занята)/iu.test(text)) return 'reassure_with_boundary';
  if (brain?.relation?.type === 'follow_up_on_rin_statement') return 'clarify_self';
  if (literal === 'farewell') return 'close_warmly';
  if (HEAVY_SCENES.has(scene)) return scene === 'conflict_repair' ? 'repair_connection' : 'be_present';
  if (literal === 'question' && !['invite_rin_initiative', 'reclaim_playful_scene'].includes(hidden)) return 'answer_directly';

  if (scene === 'playful_flirt') {
    if (hidden === 'invite_rin_initiative' || /(можешь начинать|начинай|весь в нетерпении|твоя очередь|поприста|пристава)/iu.test(text)) return 'take_lead';
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

function directnessOf(brain, relation, coreDecision, responseAct) {
  const scene = brain?.activeScene?.type || 'everyday';
  if (HEAVY_SCENES.has(scene)) return 'gentle_clear';
  if (brain?.relation?.type === 'correction') return 'direct_accountable';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance'].includes(responseAct)) return 'confident_playful';
  if (relation.familiar && PLAYFUL_SCENES.has(scene)) return 'confident_playful';
  if (relation.close && coreDecision?.mode === 'bold_playful') return 'confident_playful';
  return relation.familiar ? 'clear_personal' : 'balanced';
}

function toneOf(brain, relation, coreDecision, responseAct) {
  const scene = brain?.activeScene?.type || 'everyday';
  if (scene === 'emotional_support') return 'supportive_present';
  if (scene === 'conflict_repair') return 'honest_repair';
  if (scene === 'practical_task') return 'focused_competent';
  if (scene === 'farewell') return 'warm_closing';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance'].includes(responseAct)) return 'warm_bold_playful';
  if (PLAYFUL_SCENES.has(scene) && (relation.playfulReady || relation.close)) return 'warm_bold_playful';
  return cleanText(coreDecision?.mode, 100) || 'calm_personal';
}

function initiativeOf({ brain, loops, coreDecision, relation, userText, history, state, responseAct }) {
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play'].includes(responseAct)) return responseAct;
  if (HEAVY_SCENES.has(scene) || brain?.literalIntent === 'question' || brain?.relation?.type === 'correction') return 'none';
  if (loops?.callback && coreDecision?.initiative?.mode === 'callback') return 'return_to_open_loop';
  if (coreDecision?.initiative?.mode && coreDecision.initiative.mode !== 'none') return coreDecision.initiative.mode;

  const turnCount = Array.isArray(history) ? history.filter(item => item?.role === 'assistant').length : 0;
  const roll = Number.parseInt(stableHash(`${userText}|${turnCount}|initiative`).slice(-4), 36) % 100;
  if ((state?.reactiveStreak || 0) >= 2 && relation.familiar) return 'personal_observation';
  if (relation.close && turnCount >= 5 && roll < 12) return 'specific_personal_question';
  if (relation.familiar && turnCount >= 3 && roll >= 12 && roll < 26) return 'personal_observation';
  return 'none';
}

function shouldAskQuestion({ brain, initiative, responseAct, state }) {
  if (brain?.ambiguity?.shouldClarify) return true;
  if ((state?.questionStreak || 0) >= 1) return false;
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'reciprocate_closeness', 'clarify_self', 'reassure_with_boundary', 'explain_previous_nonverbal'].includes(responseAct)) return false;
  return initiative === 'specific_personal_question' || initiative === 'personal_question';
}

function lengthOf(coreDecision = null, isLong = false, responseAct = 'direct_response') {
  if (isLong) return 'long';
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play', 'playful_stance', 'reciprocate_closeness', 'clarify_self', 'reassure_with_boundary', 'explain_previous_nonverbal', 'accept_warmly'].includes(responseAct)) return 'very_short';
  const target = String(coreDecision?.targetLength || coreDecision?.replyStyle || '').toLowerCase();
  if (/long|длин|развёр/.test(target)) return 'medium';
  if (/tiny|very_short|корот|one_line/.test(target)) return 'very_short';
  return 'short';
}

function targetFromMessage(message, reason, confidence = 0.82) {
  if (!message?.id || message.role !== 'user') return null;
  const kind = message.kind === 'sticker' || message.sticker?.src
    ? 'sticker'
    : message.kind === 'voice' ? 'voice' : 'text';
  const excerpt = kind === 'sticker'
    ? cleanText(message.sticker?.utterance, 240) || 'Стикер'
    : kind === 'voice'
      ? cleanText(message.content, 360) || 'Голосовое сообщение'
      : cleanText(message.content, 360);
  return normalizeMessageTarget({
    messageId: message.id,
    role: 'user',
    kind,
    excerpt,
    stickerSrc: message.sticker?.src || null,
    stickerId: message.sticker?.id || null,
    reason,
    confidence
  });
}

function words(value = '') {
  return cleanText(value, 1200).toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length >= 4);
}

function candidateScore(message, index, callbackText = '') {
  const text = cleanText(message?.content, 1200);
  if (!text || /^(привет|спасибо|ага|да|нет|ок(?:ей)?|понятно|хорошо|ладно)[.!… ]*$/iu.test(text)) return -100;
  let score = Math.max(0, 18 - index * 2);
  if (text.length >= 35 && text.length <= 420) score += 18;
  if (/(люблю|нравится|слушаю|смотрю|читаю|думаю|планирую|хочу|решил|работаю|проект|музык|песня|книг|фильм|поездк|встреч)/iu.test(text)) score += 20;
  if (/[А-ЯЁA-Z][\p{L}\d_-]{2,}/u.test(text)) score += 7;
  if (callbackText) {
    const callbackWords = words(callbackText);
    const overlap = words(text).filter(word => callbackWords.includes(word)).length;
    score += overlap * 15;
  }
  return score;
}

function chooseRinReplyTarget({ history = [], initiative = 'none', brain = null, cognition = null, userText = '' } = {}) {
  if (!REPLY_INITIATIVES.has(initiative)) return null;
  if (cognition?.dialogueState?.explicitReplyTarget) return null;
  const scene = cognition?.dialogueState?.scene || brain?.activeScene?.type || 'everyday';
  if (HEAVY_SCENES.has(scene) || brain?.literalIntent === 'question' || brain?.relation?.type === 'correction') return null;

  const turns = Array.isArray(history) ? history : [];
  const currentUser = [...turns].reverse().find(item => item?.role === 'user');
  const alreadyQuoted = new Set(turns
    .filter(item => item?.role === 'assistant' && item?.replySnapshot && item?.inReplyTo)
    .map(item => item.inReplyTo));
  const callbackText = cognition?.openLoops?.callback?.subject || cognition?.openLoops?.callback?.text || '';
  const candidates = turns.slice(-16).reverse()
    .filter(item => item?.role === 'user' && item?.id && item.id !== currentUser?.id && !alreadyQuoted.has(item.id))
    .map((item, index) => ({ item, score: candidateScore(item, index, initiative === 'return_to_open_loop' ? callbackText : '') }))
    .filter(entry => entry.score >= 30)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;

  const roll = Number.parseInt(stableHash(`${userText}|${currentUser?.id || ''}|reply-target`).slice(-4), 36) % 100;
  if (initiative !== 'return_to_open_loop' && roll >= 42) return null;
  const chosen = candidates[0].item;
  const reason = initiative === 'return_to_open_loop'
    ? 'возврат к конкретной незавершённой детали'
    : 'редкий точный вопрос к ранее упомянутой детали';
  return targetFromMessage(chosen, reason, initiative === 'return_to_open_loop' ? 0.9 : 0.8);
}

function forbiddenPatterns({ responseAct, state, scene }) {
  const out = [
    'Не пересказывать реплику пользователя другими словами.',
    'Не давать общую оценку разговора, настроения или «интересности» момента.',
    'Не использовать схему «одобрение → пересказ → встречный вопрос».',
    'Не добавлять универсальную мудрость, мораль или совет без запроса.'
  ];
  if (PLAYFUL_SCENES.has(scene)) {
    out.push('Не просить разрешения флиртовать и не говорить «если хочешь, могу», «как тебе это», «не находишь?».');
    out.push('Не описывать флирт со стороны словами «это подогревает интерес», «разговор становится интереснее» — участвуй в нём.');
  }
  if (['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play'].includes(responseAct)) {
    out.push('Не перекладывать инициативу обратно на пользователя вопросом.');
  }
  if (['clarify_self', 'state_personal_view', 'specific_personal_reaction', 'reassure_with_boundary', 'explain_previous_nonverbal'].includes(responseAct)) {
    out.push('Не заменять личный ответ общим рассуждением «иногда бывает», «это помогает», «главное» или выводом о людях вообще.');
  }
  if (state?.topicDrift) out.push('Не продолжать философию, историю или новую тему вместо возврата к активной сцене.');
  return uniqueStrings(out, 10, 500);
}

export function planResponse({ cognition = null, brain = null, coreDecision = null, memory = null, userText = '', history = [], isLong = false } = {}) {
  const relation = relationshipLevel(memory);
  const state = dialogue(cognition, brain);
  const inputReplyTarget = state?.explicitReplyTarget || null;
  const responseAct = responseActOf({ brain, state, relation, userText, inputReplyTarget });
  const initiative = initiativeOf({ brain, loops: cognition?.openLoops, coreDecision, relation, userText, history, state, responseAct });
  const replyTarget = chooseRinReplyTarget({ history, initiative, brain, cognition, userText });
  const mustAddress = uniqueStrings([
    brain?.responseFocus,
    ...(brain?.obligations || []),
    state?.sceneGoal ? `Сохранить цель активной сцены: ${state.sceneGoal}.` : '',
    state?.openHook ? `Продвинуть или осознанно закрыть крючок: «${state.openHook.excerpt}».` : '',
    state?.reactiveStreak >= 2 ? 'Сделать собственный содержательный ход Рин, а не ещё одно отражение пользователя.' : '',
    brain?.relation?.type === 'follow_up_on_rin_statement' && state?.lastRinAction?.meaning
      ? `Пояснить предыдущую мысль Рин: «${state.lastRinAction.meaning}».`
      : '',
    inputReplyTarget ? `Текущая реплика пользователя относится к выбранному сообщению: «${inputReplyTarget.excerpt}». Ответ должен опираться именно на него.` : '',
    cognition?.dialogueState?.corrections?.length ? 'Использовать последнюю коррекцию пользователя вместо прежней трактовки.' : '',
    brain?.hiddenIntent?.type === 'ask_about_previous_nonverbal' ? 'Назвать эмоцию Рин и конкретную причину предыдущего жеста.' : '',
    replyTarget ? `Собственный дополнительный интерес Рин относится к более ранней фразе: «${replyTarget.excerpt}».` : ''
  ], 10, 500);
  const factsToUse = cognition?.beliefModel?.factsToUse || [];
  const factsToAvoid = cognition?.beliefModel?.factsToAvoid || [];
  const directness = directnessOf(brain, relation, coreDecision, responseAct);
  const tone = toneOf(brain, relation, coreDecision, responseAct);
  const question = shouldAskQuestion({ brain, initiative, responseAct, state });
  const confidence = clamp01(((Number(brain?.activeScene?.confidence) || 65) / 100 + (state?.confidence || 0.7)) / 2, 0.7);
  const scene = state?.scene || brain?.activeScene?.type || 'everyday';

  return normalizeResponsePlan({
    goal: goalOf(brain, inputReplyTarget, responseAct),
    mustAddress,
    factsToUse,
    factsToAvoid,
    stance: directness === 'confident_playful'
      ? 'У Рин есть собственная позиция и темп: она может взять инициативу, добавить короткий подкол, слегка поддеть или поставить условие без грубости и контроля.'
      : 'Говорить от собственной позиции Рин, не зеркалить пользователя автоматически и не быть услужливой.',
    tone,
    directness,
    initiative,
    initiativeStrength: ['take_lead', 'reclaim_scene', 'tease_and_advance', 'advance_play'].includes(initiative) ? 90 : initiative === 'none' ? 0 : 55,
    responseAct,
    sceneGoal: state?.sceneGoal || null,
    threadPolicy: state?.openHook
      ? `Активный крючок «${state.openHook.excerpt}» остаётся приоритетным до продвижения, явного закрытия или содержательной смены темы.`
      : 'Сохранять текущую сцену до явного содержательного перехода.',
    mustNot: forbiddenPatterns({ responseAct, state, scene }),
    inputReplyTarget,
    replyTarget,
    delivery: coreDecision?.nonverbalAction?.delivery || 'text',
    length: lengthOf(coreDecision, isLong, responseAct),
    shouldAskQuestion: question,
    uncertaintyPolicy: brain?.ambiguity?.shouldClarify
      ? 'Уточнить только критически важную неоднозначность.'
      : 'Не угадывать. При недостатке данных честно обозначить сомнение, но не задавать лишний вопрос.',
    confidence,
    reasons: [
      `scene:${scene}`,
      `sceneSource:${state?.sceneSource || brain?.activeScene?.source || 'unknown'}`,
      `sceneStrength:${state?.continuityStrength || brain?.activeScene?.continuityStrength || 0}`,
      `responseAct:${responseAct}`,
      `relation:${brain?.relation?.type || 'unknown'}`,
      `closeness:${relation.closeness}`,
      `trust:${relation.trust}`,
      `playfulness:${relation.playfulness}`,
      `initiative:${initiative}`,
      `reactiveStreak:${state?.reactiveStreak || 0}`,
      `inputReply:${inputReplyTarget ? inputReplyTarget.messageId : 'none'}`,
      `replyTarget:${replyTarget ? replyTarget.messageId : 'none'}`,
      `core:${coreDecision?.mode || 'none'}`
    ]
  });
}

function actInstruction(act = 'direct_response') {
  const map = {
    take_lead: 'Пользователь передал инициативу. Рин сама делает один конкретный игровой ход: дразнит, задаёт лёгкое условие, сокращает дистанцию или уверенно направляет момент. Не спрашивает разрешения и не объясняет, что сейчас будет флиртовать.',
    reclaim_scene: 'Разговор отклонился. Коротко верни активную сцену действием. Допустима одна самоироничная фраза, затем сразу дразнилка, условие или приглашение; никакой новой философии.',
    tease_and_advance: 'Поддержи напряжение короткой уверенной дразнилкой и продвинь игру на шаг. Не анализируй состояние пользователя.',
    advance_play: 'Короткое подтверждение пользователя — это не новая тема. Продолжи игру сама одной законченной репликой без встречного вопроса.',
    playful_stance: 'Ответь с собственной игривой позицией. Не соглашайся автоматически и не комментируй разговор со стороны.',
    warm_playful_reply: 'Подхвати игру мягко, но конкретно. Одна дразнилка или условие лучше нейтрального одобрения.',
    reciprocate_closeness: 'Ответь на жест близости собственным жестом или прямой личной реакцией. Не объясняй, почему это приятно.',
    state_personal_view: 'Скажи одну конкретную мысль Рин от первого лица. Не превращай её в афоризм и не говори за всех.',
    specific_personal_reaction: 'Выбери конкретную деталь из сообщения пользователя и отреагируй на неё от себя. Не пересказывай весь текст.',
    continue_dependency: 'Свяжи короткую реплику с предыдущим ходом и продвинь его. Не создавай новую тему.',
    answer_directly: 'Сначала дай прямой ответ. Характер добавляется одной личной формулировкой, а не встречным вопросом.',
    answer_selected_message: 'Ответ должен реально относиться к выбранной цитате, а не только визуально ссылаться на неё.',
    explain_previous_nonverbal: 'Назови собственную эмоцию или намерение предыдущего жеста и конкретную причину. Не говори «наверное», не рассуждай о разговоре со стороны и не задавай вопрос.',
    clarify_self: 'Поясни именно свою предыдущую мысль от первого лица. Одна конкретная причина или деталь лучше общего рассуждения о людях, понимании или жизни.',
    reassure_with_boundary: 'Ответь прямо, что пользователь не мешает, если это так, и уверенно обозначь: Рин сама скажет, когда будет занята. Не объясняй общую ценность общения.',
    accept_warmly: 'Прими тепло коротко и лично, без формальной благодарственной формулы.',
    acknowledge_correction: 'Прими исправление без защиты прежней версии и продолжи из новой рамки.',
    be_present: 'Ответь на конкретное чувство и останься рядом. Не переходи к лекции или готовой жизненной формуле.',
    repair_connection: 'Признай напряжение и восстанови контакт одной честной фразой.',
    close_warmly: 'Коротко и тепло заверши разговор, не открывая новую тему.',
    direct_response: 'Ответь по смыслу конкретно и от собственной позиции Рин.'
  };
  return map[act] || map.direct_response;
}

export function responsePlanInstruction(plan = {}) {
  const must = plan.mustAddress?.length ? plan.mustAddress.map(item => `- ${item}`).join('\n') : '- Ответить на явный смысл реплики.';
  const facts = plan.factsToUse?.length ? plan.factsToUse.map(item => `- ${item}`).join('\n') : '- Нет обязательных фактов.';
  const avoid = plan.factsToAvoid?.length ? plan.factsToAvoid.map(item => `- ${item}`).join('\n') : '- Не выдумывать отсутствующие данные.';
  const mustNot = plan.mustNot?.length ? plan.mustNot.map(item => `- ${item}`).join('\n') : '- Не использовать ассистентские шаблоны.';
  const initiative = {
    take_lead: 'Возьми локальную инициативу внутри текущей сцены и сделай один ход сама.',
    reclaim_scene: 'Верни сцену действием, а не объяснением.',
    tease_and_advance: 'Продвинь игру короткой дразнилкой.',
    advance_play: 'Продолжи игру после короткого подтверждения пользователя.',
    return_to_open_loop: 'После прямого ответа можно одной короткой фразой вернуться к релевантной незавершённой линии.',
    personal_observation: 'После ответа допустима одна собственная конкретная мысль или деталь Рин, связанная с темой.',
    small_observation: 'После ответа допустимо одно короткое личное наблюдение.',
    specific_personal_question: 'После ответа задай один конкретный вопрос, возникший из реального интереса Рин.',
    personal_question: 'После ответа допустим один конкретный личный вопрос.',
    none: 'Не добавляй новую тему и не задавай вопрос ради поддержания разговора.'
  }[plan.initiative] || 'Не добавляй инициативу без причины.';
  const inputReply = plan.inputReplyTarget
    ? `Пользователь вручную выбрал сообщение для ответа: «${plan.inputReplyTarget.excerpt}». Интерпретируй текущую реплику прежде всего относительно него.`
    : 'Пользователь не выбирал отдельное сообщение для текущего ответа.';
  const outgoingReply = plan.replyTarget
    ? `Интерфейс покажет ответ Рин как цитату более раннего сообщения: «${plan.replyTarget.excerpt}». Содержание ответа должно действительно уточнять или развивать именно эту фразу. Не упоминай механику цитирования.`
    : 'Не оформляй ответ как возврат к отдельной старой реплике.';

  return `
ПЛАН ОТВЕТА v2 — ЕДИНОЕ РЕШЕНИЕ ТЕКУЩЕГО ХОДА
Цель: ${plan.goal}
Речевой акт: ${plan.responseAct || 'direct_response'} — ${actInstruction(plan.responseAct)}
Позиция: ${plan.stance}
Тон: ${plan.tone}; прямота: ${plan.directness}; длина: ${plan.length}; доставка: ${plan.delivery}.
Цель сцены: ${plan.sceneGoal || 'сохранить текущую смысловую линию'}.
Политика нити: ${plan.threadPolicy || 'не терять активную тему без явного перехода'}.

ЯВНАЯ СВЯЗЬ С СООБЩЕНИЕМ:
${inputReply}
${outgoingReply}

ОБЯЗАТЕЛЬНО ВЫПОЛНИТЬ:
${must}

ФАКТЫ, КОТОРЫЕ МОЖНО ИСПОЛЬЗОВАТЬ:
${facts}

НЕ ИСПОЛЬЗОВАТЬ КАК ФАКТ:
${avoid}

ЗАПРЕЩЁННЫЕ ФОРМЫ ЭТОЙ РЕПЛИКИ:
${mustNot}

Инициатива: ${initiative}
Вопрос в конце: ${plan.shouldAskQuestion ? 'допустим только один конкретный вопрос' : 'не нужен; естественно остановись'}.
Неуверенность: ${plan.uncertaintyPolicy}

ХАРАКТЕР РИН В ЭТОМ ОТВЕТЕ:
Рин умная, тёплая и самостоятельная. Она не стремится быть удобной, может спокойно не согласиться, слегка поддеть, настоять на ясности или первой проявить близость. Её лёгкая наглость — уверенность, ирония и эмоциональная прямота, а не грубость, унижение, контроль или манипуляция.
`.trim();
}
