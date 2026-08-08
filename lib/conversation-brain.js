import { conversationEventText, isConversationEvent, isExplicitFarewell } from './chat-contract.js';
import { resolveConversationContinuity } from './conversation-continuity.js';
import { detectInitiativeHandoff } from './cognition/initiative-handoff.js';

/* api/conversation-brain.js — Conversation Brain v1
 * Deterministic context-understanding layer placed before Personality Core.
 * It does not generate text. It describes what is happening in the dialogue
 * so the personality layer can choose a response without losing subtext.
 */

const textOf = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = value => textOf(value).toLowerCase();
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

function recentTurns(history = [], count = 10) {
  return (Array.isArray(history) ? history : [])
    .filter(isConversationEvent)
    .slice(-count)
    .map(item => ({
      id: textOf(item.id).slice(0, 120) || null,
      role: item.role,
      kind: item.kind || 'text',
      content: textOf(conversationEventText(item)).slice(0, 1800),
      inReplyTo: textOf(item.inReplyTo).slice(0, 120) || null,
      replySnapshot: item.replySnapshot || null,
      sticker: item.sticker || null
    }));
}

function previousMessage(turns, role, skipLastMatching = false) {
  let skipped = !skipLastMatching;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role !== role) continue;
    if (!skipped) { skipped = true; continue; }
    return turns[i];
  }
  return null;
}

function detectLiteralIntent(userText) {
  const t = lower(userText);
  if (!t) return 'empty';
  if (/^(привет|доброе утро|добрый день|добрый вечер|здравствуй|хай|hello)\b/i.test(t)) return 'greeting';
  if (isExplicitFarewell(t)) return 'farewell';
  if (/^(спасибо|благодарю|спасибки)\b/i.test(t)) return 'gratitude';
  if (/(прости|извини|виноват|не хотел обидеть)/i.test(t)) return 'apology';
  if (/(помоги|что мне делать|как поступить|дай совет|посоветуй)/i.test(t)) return 'request_advice';
  if (/(расскажи|объясни|опиши|покажи|перечисли|составь|напиши)/i.test(t)) return 'request_content';
  if ((t.length <= 140 && /\?/.test(t)) || /^(кто|что|где|когда|почему|зачем|как|сколько|какой|какая|какие|чей|можно ли|ты|у тебя)\b/i.test(t)) return 'question';
  if (/(я думаю|мне кажется|по-моему|считаю|понимаю|осознал)/i.test(t)) return 'reflection';
  if (/(люблю|скучаю|соскучился|обнимаю|целую|ты мне нравишься|красивая|милая)/i.test(t)) return 'affection';
  if (/(мне плохо|грустно|одиноко|страшно|тревожно|тяжело|я устал|нет сил)/i.test(t)) return 'disclosure';
  if (/^(да|нет|ага|угу|точно|именно|конечно|неа|ладно|хорошо|ок|окей|договорились|понятно)(?:[)\s🙂😊😉.!…]*)$/i.test(t)) return 'short_confirmation';
  return 'statement';
}

function detectHiddenIntent(userText, turns, literalIntent) {
  const t = lower(userText);
  const prevAssistant = previousMessage(turns, 'assistant', false)?.content || '';
  const result = { type: 'none', confidence: 35, evidence: [] };
  const set = (type, confidence, evidence) => ({ type, confidence: clamp(confidence), evidence: evidence.filter(Boolean) });
  const currentUserTurn = [...turns].reverse().find(turn => turn.role === 'user');
  const previousSticker = [...turns].reverse().find(turn => turn.role === 'assistant' && turn.kind === 'sticker');
  const previousSilence = [...turns].reverse().find(turn => turn.role === 'assistant' && turn.kind === 'silence');
  const explicitlySelectedSticker = Boolean(
    currentUserTurn?.replySnapshot?.kind === 'sticker' ||
    (currentUserTurn?.inReplyTo && turns.some(turn => turn.role === 'assistant' && turn.kind === 'sticker' && turn.id === currentUserTurn.inReplyTo))
  );
  const asksAboutGesture = /^(?:ты чего|что|что это|что случилось|в чём дело|почему|обиделась|ревнуешь|ты злишься|смутилась)(?:[)\s🙂😊😉.!…?]*)$/iu.test(t);
  if ((explicitlySelectedSticker && (literalIntent === 'question' || t.length <= 28)) || (previousSticker && asksAboutGesture)) {
    return set('ask_about_previous_nonverbal', explicitlySelectedSticker ? 99 : 96, [
      explicitlySelectedSticker ? 'пользователь явно ответил на выбранный стикер Рин' : 'пользователь спрашивает о последнем невербальном жесте Рин'
    ]);
  }
  const asksAboutSilence = /^(?:ты чего|почему молчишь|чего молчишь|обиделась|ты обиделась|злишься|ты злишься|всё нормально|что случилось)(?:[)\s🙂😊😉.!…?]*)$/iu.test(t);
  if (previousSilence && asksAboutSilence) {
    return set('ask_about_previous_nonverbal', 98, ['пользователь спрашивает о предыдущем осознанном молчании Рин']);
  }

  if (/(ты меня (любишь|ценишь|помнишь)|я тебе (нужен|дорог)|между нами|мы с тобой)/i.test(t)) {
    return set('relationship_reassurance', 91, ['проверка значимости отношений']);
  }
  if (/(не скучала|не ревнуешь|тебе всё равно|не заметила|забыла меня)/i.test(t)) {
    return set('bid_for_reassurance', 88, ['отрицательная форма скрывает просьбу о тепле']);
  }
  if (literalIntent !== 'short_confirmation' && /(ну да|конечно|как скажешь|понятно|ясно)[.!…]*$/i.test(t) && !/\?/.test(t)) {
    return set('possible_hurt_or_withdrawal', 70, ['короткое закрывающее согласие']);
  }
  if (/^(а я\?|а мне\?|и всё\?|только это\?|серьёзно\?)$/i.test(t)) {
    return set('request_more_emotional_response', 90, ['ответ требует не факта, а эмоционального подтверждения']);
  }
  if (literalIntent === 'affection') {
    return set('seek_closeness', 86, ['прямой жест близости']);
  }
  if (literalIntent === 'request_advice') {
    return set('seek_solution', 88, ['явная просьба о помощи или следующем шаге']);
  }
  if (literalIntent === 'disclosure') {
    return set(/что делать|помоги|совет/i.test(t) ? 'seek_solution' : 'seek_emotional_presence', 86, ['личное уязвимое сообщение']);
  }
  if (literalIntent === 'apology') {
    return set('repair_connection', 88, ['попытка восстановить контакт']);
  }
  if (literalIntent === 'gratitude') {
    return set('acknowledge_connection', 72, ['закрепление тёплого контакта']);
  }
  if (literalIntent === 'short_confirmation') {
    return set(/\?/.test(prevAssistant) ? 'answer_previous_question' : 'acknowledge_previous_proposal', 88, ['короткое подтверждение зависит от предыдущей реплики Рин']);
  }
  if (/(как хочешь|делай что хочешь|мне без разницы)/i.test(t)) {
    return set('masked_disappointment', 77, ['формальное безразличие может скрывать разочарование']);
  }
  if (/(шучу|да ладно|не воспринимай серьёзно)/i.test(t)) {
    return set('soften_previous_message', 69, ['смягчение или отступление после эмоциональной реплики']);
  }
  const initiativeHandoff = detectInitiativeHandoff(t, {
    previousAssistant: prevAssistant,
    recentText: turns.slice(-8).map(turn => turn.content).join(' ')
  });
  if (initiativeHandoff.active) {
    return set('invite_rin_initiative', initiativeHandoff.confidence, [initiativeHandoff.reason]);
  }
  if (/(мы же играем|подурач|флирт.*(?:уш[её]л|перет[её]к|преврат)|верн(?:и|ёмся).*флирт)/i.test(t)) {
    return set('reclaim_playful_scene', 91, ['пользователь замечает дрейф и просит вернуть игру']);
  }
  if (/(весь в нетерпении|жду,? когда|ну же|давай уже)/i.test(t)) {
    return set('continue_playful_tension', 86, ['пользователь ждёт следующего хода Рин']);
  }
  return result;
}

function detectRelation(userText, turns, literalIntent) {
  const t = lower(userText);
  const prevAssistant = previousMessage(turns, 'assistant', false)?.content || '';
  const initiativeHandoff = detectInitiativeHandoff(t, {
    previousAssistant: prevAssistant,
    recentText: turns.slice(-8).map(turn => turn.content).join(' ')
  });

  if (initiativeHandoff.active) {
    return { type: 'initiative_handoff', confidence: initiativeHandoff.confidence };
  }

  if (/^(?:нет[, ]+я|точнее|не так|так а? я же|я же не|вообще-то|на самом деле|я имел в виду|я про(?:\s|$))/i.test(t)) {
    return { type: 'correction', confidence: 94 };
  }
  if (literalIntent === 'short_confirmation') {
    return { type: /\?/.test(prevAssistant) ? 'answers_previous_question' : 'acknowledges_previous_turn', confidence: 94 };
  }
  if (/^(да|нет|ага|угу|неа|точно|именно|конечно|наверное|возможно|не знаю)(?:\s|[,.!…]|$)/i.test(t) && /\?/.test(prevAssistant)) {
    return { type: 'answers_previous_question', confidence: 92 };
  }
  if (/^(а ты|а у тебя|а тебе|а сама|а как ты)/i.test(t)) {
    return { type: 'reciprocal_turn', confidence: 91 };
  }
  if (/^(почему|зачем|а как|а если|и что|то есть|в смысле|правда|что именно|как так|серь[её]зно)(?:\s|[,.!?…]|$)/i.test(t)) {
    return { type: 'follow_up_on_rin_statement', confidence: 90 };
  }
  const meaningfulWords = t.split(/[^\p{L}\p{N}_-]+/u).filter(word => word.length >= 3);
  const startsLikeNewQuestion = /^(?:кто|где|когда|сколько|какой|какая|какие|чей|чья|чьи|у тебя|ты)(?=$|[^\p{L}\p{N}_])/iu.test(t);
  if (literalIntent === 'question' && prevAssistant && !startsLikeNewQuestion && t.length <= 72 && meaningfulWords.length <= 3) {
    return { type: 'follow_up_on_rin_statement', confidence: 82 };
  }
  if (literalIntent === 'question' && prevAssistant) return { type: 'new_or_followup_question', confidence: 58 };
  if (turns.length <= 1) return { type: 'conversation_opening', confidence: 95 };
  return { type: 'continuation', confidence: 56 };
}

function hasUnicodeToken(text, alternatives) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${alternatives})(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
}

function detectReferents(userText) {
  const t = lower(userText);
  const refs = [];
  if (hasUnicodeToken(t, 'это|такое|так|там|тогда|тот|та|те|этот|эта|эти|он|она|они|его|её|их|него|неё|них')) refs.push('context_dependent_reference');
  if (hasUnicodeToken(t, 'ты|тебя|тебе|тобой|твоя|твой|твои|рин')) refs.push('rin');
  if (hasUnicodeToken(t, 'я|меня|мне|мой|моя|мои')) refs.push('user');
  if (hasUnicodeToken(t, 'мы|нас|нам|наши|между\\s+нами|вместе')) refs.push('relationship');
  return [...new Set(refs)];
}

function detectScene(turns, userText) {
  const t = lower(userText);
  const recent = turns.slice(-4);
  const recentText = lower(recent.map(turn => turn.content).join(' '));
  const previousText = lower(recent.slice(0, -1).map(turn => turn.content).join(' '));
  const scores = {
    everyday: 28,
    emotional_support: 0,
    romance: 0,
    playful_flirt: 0,
    conflict_repair: 0,
    reflective: 0,
    practical_task: 0,
    farewell: 0
  };

  const add = (key, points) => { scores[key] += points; };
  const scoreSignals = (text, weight = 1) => {
    if (/(груст|плохо|тяжело|тревог|страшно|одинок|больно|нет сил|я устал|я устала)/i.test(text)) add('emotional_support', 62 * weight);
    if (/(люблю|скуч|обним|поцел|рядом|между нами|дорог|нежн)/i.test(text)) add('romance', 54 * weight);
    if (/(флирт|красивая|милая|хех|ахах|😉|😏|дразн|шут|обольст)/i.test(text)) add('playful_flirt', 50 * weight);
    if (/(прости|извини|обид|злишься|ссор|не понял|не так поняла)/i.test(text)) add('conflict_repair', 60 * weight);
    if (/(смысл|жизн|отношени|почему люди|думаю|кажется|вспоминаю|прошл)/i.test(text)) add('reflective', 45 * weight);
  };

  // Текущая реплика определяет сцену. Старый контекст только слегка поддерживает её.
  scoreSignals(t, 1);
  scoreSignals(previousText, 0.18);

  const explicitTask = /(?:^|[.!?]\s*)(?:пожалуйста,?\s*)?(?:сделай|исправь|измени|перепиши|проверь|создай|собери|дай|подготовь|объясни|напиши|удали|добавь|проанализируй)(?=\s|[,.!?;:]|$)/i;
  const taskObject = /(?:^|\s)(?:код|архив|файл|проект|ошибк|инструкц|рефакторинг|тест|промпт|prompt)/i;
  const merelyDiscussingWork = /(?:^|\s)(?:работаю|занимаюсь|буду работать|проектом|над текстом|переводом)/i;

  if (explicitTask.test(t) || (taskObject.test(t) && /(?:^|\s)(?:нужно|надо|можешь|помоги|как)(?=\s|[,.!?;:]|$)/i.test(t))) {
    add('practical_task', 82);
  } else if (merelyDiscussingWork.test(t)) {
    // Разговор о работе — обычная бытовая тема, а не команда модели.
    add('everyday', 16);
    add('practical_task', 8);
  } else if (taskObject.test(recentText)) {
    add('practical_task', 5);
  }

  if (isExplicitFarewell(t)) add('farewell', 100);

  const [type, rawScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const score = Math.round(rawScore);
  return { type, confidence: clamp(Math.max(45, score)), scores };
}

function detectEmotionalDirection(userText) {
  const t = lower(userText);
  if (/(не хочу говорить|оставь|отстань|мне нужно побыть одному|не хочу сейчас общаться)/i.test(t)) return 'withdraw';
  if (/(прости|извини|давай мириться|не хочу ссориться)/i.test(t)) return 'repair';
  if (/(обними|будь рядом|скучаю|люблю|целую|мне тебя не хватает)/i.test(t)) return 'approach';
  if (/(помоги|скажи честно|мне важно|расскажу тебе)/i.test(t)) return 'open_up';
  return 'steady';
}

function responseObligations({ literalIntent, hiddenIntent, relation, scene, referents }) {
  const obligations = [];
  if (relation.type === 'answers_previous_question') obligations.push('Свяжи короткий ответ с предыдущим вопросом Рин; не трактуй его изолированно.');
  if (relation.type === 'acknowledges_previous_turn') obligations.push('Пойми, с каким предложением или мыслью Рин пользователь согласился, и коротко закрепи договорённость. Не добавляй случайную оценку вроде «Смело».');
  if (relation.type === 'correction') obligations.push('Прими исправление и перестрой понимание; не защищай прежнюю трактовку.');
  if (relation.type === 'follow_up_on_rin_statement') obligations.push('Ответь именно на смысл предыдущей реплики Рин и поясни собственную мысль от первого лица; не уходи в общий ответ о людях или жизни.');
  if (relation.type === 'initiative_handoff') obligations.push('Предыдущая реплика Рин уже создала ожидание действия: не объясняй её и не обещай начать позже — выполни следующий ход сейчас.');
  if (referents.includes('context_dependent_reference')) obligations.push('Разреши указательные слова через ближайший релевантный контекст.');
  if (hiddenIntent.type === 'relationship_reassurance' || hiddenIntent.type === 'bid_for_reassurance') obligations.push('Ответь на эмоциональную проверку прямо и лично, а не формально.');
  if (hiddenIntent.type === 'possible_hurt_or_withdrawal' || hiddenIntent.type === 'masked_disappointment') obligations.push('Сначала мягко признай возможную обиду; не усиливай дистанцию и не шути поверх неё.');
  if (hiddenIntent.type === 'seek_emotional_presence') obligations.push('Не переходи сразу к советам: сначала побудь рядом и признай состояние.');
  if (hiddenIntent.type === 'seek_solution') obligations.push('После короткого признания состояния дай одну конкретную опору или следующий шаг.');
  if (hiddenIntent.type === 'request_more_emotional_response') obligations.push('Дай более явную личную эмоцию; сухого уточнения недостаточно.');
  if (hiddenIntent.type === 'repair_connection') obligations.push('Поддержи восстановление контакта без морализаторства.');
  if (hiddenIntent.type === 'invite_rin_initiative') obligations.push('Пользователь передал инициативу Рин: не проси разрешения и не обсуждай намерение флиртовать — сделай один уверенный игровой ход.');
  if (hiddenIntent.type === 'reclaim_playful_scene') obligations.push('Верни игривую сцену действием: короткой дразнилкой, условием или вызовом; не продолжай философское мета-обсуждение.');
  if (hiddenIntent.type === 'continue_playful_tension') obligations.push('Продвинь игру сама и оставь небольшое напряжение; не отвечай общим комментарием о настроении пользователя.');
  if (scene.type === 'practical_task') obligations.push('Сохрани фактическую точность и выполни задачу, не заменяя результат атмосферной беседой.');
  if (literalIntent === 'question' && hiddenIntent.type !== 'invite_rin_initiative') obligations.push('Сначала ответь на поставленный вопрос, затем добавляй характер Рин.');
  if (literalIntent === 'short_confirmation') obligations.push('Это зависимое короткое подтверждение: не интерпретируй его как новую самостоятельную тему.');
  if (literalIntent === 'farewell') obligations.push('Не открывай новую тему и не задавай вопрос.');
  return [...new Set(obligations)].slice(0, 6);
}

function inferTopic(userText, turns) {
  const t = textOf(userText);
  if (t.length >= 18 && !/^(да|нет|ага|угу|точно|именно|а ты|почему|зачем)/i.test(t)) return t.slice(0, 160);
  const prevAssistant = previousMessage(turns, 'assistant', false)?.content;
  const prevUser = previousMessage(turns, 'user', true)?.content;
  return textOf(prevAssistant || prevUser || t).slice(0, 160) || 'текущий контакт';
}

function ambiguityScore({ referents = [], relation = null, turns = [], continuity = null } = {}) {
  if (!referents.includes('context_dependent_reference')) return 20;
  const currentUser = [...turns].reverse().find(turn => turn.role === 'user');
  if (currentUser?.inReplyTo || currentUser?.replySnapshot) return 18;
  if (['answers_previous_question', 'acknowledges_previous_turn', 'follow_up_on_rin_statement', 'correction'].includes(relation?.type)) return 36;

  // A strong scene plus a reciprocal/continuing turn gives pronouns a natural
  // nearest antecedent. Do not ask a clarification question merely because the
  // utterance contains “это/её/он” when continuity already resolves it.
  const continuityStrength = Number(continuity?.continuityStrength) || 0;
  if (continuityStrength >= 0.75 && ['reciprocal_turn', 'continuation'].includes(relation?.type)) return 42;

  const prior = turns.slice(0, -1).filter(turn => turn.content).slice(-4);
  if (!prior.length) return 90;
  const distinct = new Set(prior.map(turn => textOf(turn.content).toLowerCase().slice(0, 80))).size;
  if (relation?.type === 'continuation' && distinct <= 2) return 52;
  return distinct >= 3 ? 78 : 64;
}

export function analyzeConversation({ userText = '', history = [], conversationState = 'ongoing' } = {}) {
  const turns = recentTurns(history, 12);
  const literalIntent = detectLiteralIntent(userText);
  const hiddenIntent = detectHiddenIntent(userText, turns, literalIntent);
  const relation = detectRelation(userText, turns, literalIntent);
  const referents = detectReferents(userText);
  const rawScene = detectScene(turns, userText);
  const continuity = resolveConversationContinuity({ history, userText, rawScene, conversationState });
  const scene = {
    ...rawScene,
    type: conversationState === 'ending' ? 'farewell' : continuity.scene,
    confidence: Math.max(rawScene.confidence, Math.round(continuity.continuityStrength * 100)),
    continuity
  };
  const emotionalDirection = detectEmotionalDirection(userText);
  const obligations = responseObligations({ literalIntent, hiddenIntent, relation, scene, referents });
  const ambiguity = ambiguityScore({ referents, relation, turns, continuity });

  return {
    version: 'conversation-brain-v2-continuity',
    literalIntent,
    hiddenIntent,
    relation,
    activeScene: {
      type: scene.type,
      confidence: scene.confidence,
      topic: inferTopic(userText, turns),
      emotionalDirection,
      participants: ['user', 'rin'],
      goal: continuity.sceneGoal,
      anchor: continuity.anchor,
      openHook: continuity.openHook,
      source: continuity.source,
      turnsInScene: continuity.turnsInScene,
      continuityStrength: continuity.continuityStrength,
      reactiveStreak: continuity.reactiveStreak,
      questionStreak: continuity.questionStreak,
      topicDrift: continuity.topicDrift
    },
    referents,
    ambiguity: {
      level: clamp(ambiguity),
      shouldClarify: ambiguity >= 75,
      rule: ambiguity >= 75 ? 'Уточни только если ошибка понимания существенно изменит ответ.' : 'Не задавай уточняющий вопрос без необходимости.'
    },
    obligations,
    responseFocus: obligations[0] || 'Ответь на явный смысл реплики, сохраняя непрерывность текущей сцены.',
    summary: [
      `явное намерение: ${literalIntent}`,
      `скрытое намерение: ${hiddenIntent.type} (${hiddenIntent.confidence}%)`,
      `связь: ${relation.type}`,
      `сцена: ${scene.type}`,
      `направление: ${emotionalDirection}`
    ].join('; ')
  };
}

export function conversationBrainInstruction(brain) {
  if (!brain) return '';
  const uniqueObligations = [...new Set(brain.obligations || [])]
    .filter(item => item && item !== brain.responseFocus);
  const obligations = uniqueObligations.length
    ? uniqueObligations.map(item => `- ${item}`).join('\n')
    : '- Дополнительных обязательств нет.';

  return `
CONVERSATION BRAIN v2 — СМЫСЛ И НЕПРЕРЫВНОСТЬ ТЕКУЩЕГО ХОДА
Сцена: ${brain.activeScene.type}; цель сцены: ${brain.activeScene.goal || 'продолжить текущую линию'}; тема: ${brain.activeScene.topic}; явное намерение: ${brain.literalIntent}; подтекст: ${brain.hiddenIntent.type} (${brain.hiddenIntent.confidence}%); связь: ${brain.relation.type}; направление: ${brain.activeScene.emotionalDirection}.
Фокус: ${brain.responseFocus}

ОБЯЗАТЕЛЬСТВА:
${obligations}

Короткая реплика не обнуляет активную сцену. Сначала выполни эти смысловые обязательства и продвинь незавершённый крючок, затем применяй Personality Core. Учитывай предыдущую реплику при зависимом ответе; не придумывай конфликт при низкой уверенности и не раскрывай анализ пользователю.
`.trim();
}
