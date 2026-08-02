/*
 * TurnPlan v2 — единый слой понимания текущей реплики.
 *
 * Важное отличие от прежней версии: здесь нет ASCII-границ \b для русских
 * слов. Сначала текст разбирается Unicode-токенизатором, а затем решения
 * принимаются по словам, фразам и ближайшему контексту.
 */

const textOf = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = value => textOf(value).toLowerCase().replace(/ё/g, 'е');
const clamp = (value, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const tokenList = value =>
  normalize(value).match(/[\p{L}\p{N}]+/gu) || [];

const tokenSet = value => new Set(tokenList(value));

const startsWithAny = (text, phrases) =>
  phrases.some(phrase => text === phrase || text.startsWith(`${phrase} `));

const includesAny = (text, phrases) =>
  phrases.some(phrase => text.includes(phrase));

const hasRoot = (tokens, roots) =>
  [...tokens].some(token => roots.some(root => token.startsWith(root)));

function recentTurns(history = [], count = 12) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
    .slice(-count)
    .map(item => ({
      role: item.role,
      content: textOf(item.content).slice(0, 1800)
    }));
}

function previousTurn(turns, role, skipCurrentUser = false) {
  let skippedCurrent = !skipCurrentUser;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== role) continue;
    if (!skippedCurrent) {
      skippedCurrent = true;
      continue;
    }
    return turn;
  }
  return null;
}

function isFarewell(text) {
  const value = normalize(text);
  return includesAny(value, [
    'пока', 'до встречи', 'до завтра', 'до связи', 'спокойной ночи',
    'доброй ночи', 'увидимся', 'бай', 'bye'
  ]);
}

function detectLiteralIntent(userText) {
  const text = normalize(userText);
  const tokens = tokenSet(text);
  const words = tokenList(text);
  if (!text) return 'empty';

  if (
    words.length <= 5 &&
    (
      ['привет', 'здравствуй', 'хай', 'hello'].includes(words[0]) ||
      startsWithAny(text.replace(/[^\p{L}\p{N}\s]/gu, ' '), [
        'доброе утро', 'добрый день', 'добрый вечер'
      ])
    )
  ) return 'greeting';

  if (isFarewell(text)) return 'farewell';
  if (startsWithAny(text, ['спасибо', 'благодарю', 'спасибки'])) return 'gratitude';
  if (includesAny(text, ['прости', 'извини', 'виноват', 'не хотел обидеть'])) return 'apology';

  if (includesAny(text, [
    'люблю тебя', 'ты мне нравишься', 'мне тебя не хватает', 'скучаю по тебе',
    'соскучился', 'обнимаю', 'целую', 'ты красивая', 'ты милая',
    'хочу тебя обнять', 'хочу тебя поцеловать'
  ])) return 'affection';

  if (includesAny(text, [
    'помоги', 'что мне делать', 'как поступить', 'дай совет', 'посоветуй'
  ])) return 'request_advice';

  if (includesAny(text, [
    'мне плохо', 'мне грустно', 'мне одиноко', 'мне страшно',
    'мне тревожно', 'мне тяжело', 'я устал', 'нет сил', 'я расстроен'
  ])) return 'disclosure';

  if (startsWithAny(text, [
    'расскажи', 'объясни', 'опиши', 'покажи', 'перечисли',
    'составь', 'напиши', 'разбери', 'сравни'
  ])) return 'request_content';

  const confirmations = new Set([
    'да', 'нет', 'ага', 'угу', 'точно', 'именно', 'конечно', 'неа',
    'ладно', 'хорошо', 'ок', 'окей', 'договорились', 'понятно', 'ясно'
  ]);
  const compact = text.replace(/[\s🙂😊😉.!…]+$/gu, '').trim();
  if (confirmations.has(compact)) return 'short_confirmation';

  const questionStarts = new Set([
    'кто', 'что', 'где', 'когда', 'почему', 'зачем', 'как', 'сколько',
    'какой', 'какая', 'какие', 'чей', 'чья', 'можно'
  ]);
  const first = words[0] || '';
  if (
    text.includes('?') ||
    questionStarts.has(first) ||
    startsWithAny(text, ['как дела', 'у тебя', 'а ты', 'ты когда', 'ты где'])
  ) return 'question';

  if (includesAny(text, [
    'я думаю', 'мне кажется', 'по-моему', 'я считаю',
    'я понял', 'я осознал', 'иногда думаю'
  ])) return 'reflection';

  if (tokens.size <= 2 && includesAny(text, ['может быть', 'не знаю'])) {
    return 'short_confirmation';
  }

  return 'statement';
}

function detectHiddenIntent(userText, turns, literalIntent) {
  const text = normalize(userText);
  const previousAssistant = normalize(previousTurn(turns, 'assistant')?.content || '');
  const result = { type: 'none', confidence: 30, evidence: [] };
  const make = (type, confidence, evidence) => ({
    type,
    confidence: clamp(confidence),
    evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : []
  });

  if (includesAny(text, [
    'ты меня любишь', 'ты меня ценишь', 'я тебе нужен', 'я тебе дорог',
    'что между нами', 'мы с тобой кто'
  ])) {
    return make('relationship_reassurance', 92, ['проверка значимости отношений']);
  }
  if (includesAny(text, [
    'не скучала', 'не ревнуешь', 'тебе все равно', 'не заметила', 'забыла меня'
  ])) {
    return make('bid_for_reassurance', 88, ['отрицательная форма скрывает просьбу о тепле']);
  }
  if (['а я?', 'а мне?', 'и все?', 'только это?', 'серьезно?'].includes(text)) {
    return make('request_more_emotional_response', 90, ['нужен более личный эмоциональный отклик']);
  }
  if (literalIntent === 'affection') {
    return make('seek_closeness', 88, ['прямой жест близости']);
  }
  if (literalIntent === 'request_advice') {
    return make('seek_solution', 91, ['явная просьба о следующем шаге']);
  }
  if (literalIntent === 'disclosure') {
    return make(
      includesAny(text, ['что делать', 'помоги', 'совет'])
        ? 'seek_solution'
        : 'seek_emotional_presence',
      88,
      ['личное уязвимое сообщение']
    );
  }
  if (literalIntent === 'apology') {
    return make('repair_connection', 90, ['попытка восстановить контакт']);
  }
  if (literalIntent === 'gratitude') {
    return make('acknowledge_connection', 72, ['закрепление контакта']);
  }
  if (literalIntent === 'short_confirmation') {
    return make(
      previousAssistant.includes('?')
        ? 'answer_previous_question'
        : 'acknowledge_previous_proposal',
      91,
      ['короткая реплика зависит от предыдущего сообщения Рин']
    );
  }
  if (includesAny(text, ['как хочешь', 'делай что хочешь', 'мне без разницы'])) {
    return make('masked_disappointment', 76, ['формальное безразличие может скрывать разочарование']);
  }
  if (
    literalIntent !== 'short_confirmation' &&
    ['ну да', 'конечно', 'как скажешь', 'понятно', 'ясно'].some(value => text.endsWith(value)) &&
    !text.includes('?')
  ) {
    return make('possible_hurt_or_withdrawal', 68, ['короткое закрывающее согласие']);
  }
  if (includesAny(text, ['шучу', 'да ладно', 'не воспринимай серьезно'])) {
    return make('soften_previous_message', 68, ['смягчение предыдущей реплики']);
  }
  return result;
}

function detectRelation(userText, turns, literalIntent) {
  const text = normalize(userText);
  const previousAssistant = normalize(previousTurn(turns, 'assistant')?.content || '');

  if (startsWithAny(text, ['я про', 'я имел в виду', 'точнее', 'не так', 'нет, я'])) {
    return { type: 'correction', confidence: 95 };
  }
  if (literalIntent === 'short_confirmation') {
    return {
      type: previousAssistant.includes('?')
        ? 'answers_previous_question'
        : 'acknowledges_previous_turn',
      confidence: 95
    };
  }
  if (startsWithAny(text, ['почему', 'зачем', 'а как', 'а если', 'и что', 'то есть', 'в смысле', 'правда'])) {
    return { type: 'follow_up', confidence: 88 };
  }
  if (startsWithAny(text, ['а ты', 'а у тебя', 'а тебе', 'а сама', 'а как ты'])) {
    return { type: 'reciprocal_turn', confidence: 93 };
  }
  if (literalIntent === 'question' && previousAssistant) {
    return { type: 'new_or_followup_question', confidence: 66 };
  }
  if (turns.length <= 1) return { type: 'conversation_opening', confidence: 96 };
  return { type: 'continuation', confidence: 62 };
}

function detectReferents(userText) {
  const tokens = tokenSet(userText);
  const referents = [];
  const intersects = words => words.some(word => tokens.has(word));

  if (intersects(['это', 'такое', 'так', 'там', 'тогда', 'тот', 'та', 'те', 'этот', 'эта', 'эти', 'он', 'она', 'они', 'его', 'ее', 'их'])) {
    referents.push('context_dependent_reference');
  }
  if (intersects(['ты', 'тебя', 'тебе', 'тобой', 'твоя', 'твой', 'твои', 'рин'])) {
    referents.push('rin');
  }
  if (intersects(['я', 'меня', 'мне', 'мой', 'моя', 'мои'])) {
    referents.push('kirill');
  }
  if (intersects(['мы', 'нас', 'нам', 'наши', 'вместе'])) {
    referents.push('relationship');
  }
  return referents;
}

function sceneSignals(text) {
  const value = normalize(text);
  const tokens = tokenSet(value);
  const scores = {
    everyday: 1,
    emotional_support: 0,
    romance: 0,
    playful_flirt: 0,
    conflict_repair: 0,
    reflective: 0,
    practical_task: 0,
    farewell: 0
  };

  if (hasRoot(tokens, ['груст', 'плох', 'тяжел', 'тревог', 'страш', 'одинок', 'устал', 'бол', 'проблем'])) scores.emotional_support += 9;
  if (hasRoot(tokens, ['люб', 'скуч', 'обним', 'цел', 'нежн', 'дорог', 'близ'])) scores.romance += 8;
  if (hasRoot(tokens, ['флирт', 'красив', 'мил', 'дразн', 'подкол', 'шут'])) scores.playful_flirt += 7;
  if (includesAny(value, ['😉', '😏', '😘'])) scores.playful_flirt += 7;
  if (hasRoot(tokens, ['прост', 'извин', 'обид', 'зл', 'ссор'])) scores.conflict_repair += 9;
  if (hasRoot(tokens, ['смысл', 'жизн', 'отнош', 'вспомин', 'прошл', 'дума'])) scores.reflective += 6;
  if (hasRoot(tokens, ['сдел', 'напиш', 'код', 'архив', 'файл', 'ошиб', 'проект', 'объясн', 'инструк', 'сравн'])) scores.practical_task += 8;
  if (isFarewell(value)) scores.farewell += 12;
  return scores;
}

function detectScene(turns, userText) {
  const current = sceneSignals(userText);
  let best = Object.entries(current).sort((a, b) => b[1] - a[1])[0];
  if (best[0] !== 'everyday' && best[1] >= 6) {
    return { type: best[0], confidence: clamp(48 + best[1] * 5), scores: current };
  }

  const previous = turns
    .slice(0, -1)
    .reverse()
    .slice(0, 4);
  const carried = { ...current };
  const weights = [0.5, 0.3, 0.16, 0.08];
  previous.forEach((turn, index) => {
    const signals = sceneSignals(turn.content);
    for (const key of Object.keys(carried)) {
      if (key === 'farewell' || key === 'practical_task') continue;
      carried[key] += (signals[key] || 0) * weights[index];
    }
  });
  best = Object.entries(carried).sort((a, b) => b[1] - a[1])[0];
  if (best[0] !== 'everyday' && best[1] >= 4.5) {
    return { type: best[0], confidence: clamp(45 + best[1] * 6), scores: carried };
  }
  return { type: 'everyday', confidence: 66, scores: carried };
}

function detectEmotionalDirection(userText) {
  const text = normalize(userText);
  if (includesAny(text, ['не хочу говорить', 'оставь', 'отстань', 'мне нужно побыть одному'])) return 'withdraw';
  if (includesAny(text, ['прости', 'извини', 'давай мириться', 'не хочу ссориться'])) return 'repair';
  if (includesAny(text, ['обними', 'будь рядом', 'скучаю', 'люблю', 'целую', 'не хватает тебя'])) return 'approach';
  if (includesAny(text, ['помоги', 'скажи честно', 'мне важно', 'расскажу тебе'])) return 'open_up';
  return 'steady';
}

function inferTopic(userText, turns) {
  const text = textOf(userText);
  if (text.length >= 14 && !startsWithAny(normalize(text), ['да', 'нет', 'ага', 'угу', 'а ты'])) {
    return text.slice(0, 180);
  }
  return textOf(previousTurn(turns, 'assistant')?.content || text).slice(0, 180) || 'текущий контакт';
}

function chooseResponseKind(literalIntent, hiddenIntent, scene) {
  if (literalIntent === 'farewell') return 'farewell';
  if (literalIntent === 'greeting') return 'greeting';
  if (literalIntent === 'gratitude') return 'warm_acknowledgement';
  if (literalIntent === 'short_confirmation') return 'contextual_acknowledgement';
  if (hiddenIntent === 'seek_solution') return 'support_with_step';
  if (hiddenIntent === 'seek_emotional_presence') return 'emotional_presence';
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response', 'seek_closeness'].includes(hiddenIntent)) return 'personal_closeness';
  if (['repair_connection', 'possible_hurt_or_withdrawal', 'masked_disappointment'].includes(hiddenIntent)) return 'relationship_repair';
  if (literalIntent === 'question' || literalIntent === 'request_content') return 'direct_answer';
  if (scene === 'practical_task') return 'task_answer';
  if (scene === 'playful_flirt' || scene === 'romance') return 'playful_or_warm';
  if (scene === 'reflective') return 'personal_reflection';
  return 'natural_connection';
}

function buildObligations({ literalIntent, hiddenIntent, relation, scene, referents, ambiguity }) {
  const obligations = [];
  if (relation === 'answers_previous_question') obligations.push('Связать ответ с предыдущим вопросом Рин.');
  if (relation === 'acknowledges_previous_turn') obligations.push('Коротко закрепить конкретную договоренность или мысль.');
  if (relation === 'correction') obligations.push('Принять исправление без защиты прежней трактовки.');
  if (referents.includes('context_dependent_reference')) obligations.push('Разрешить местоимения через ближайший релевантный контекст.');
  if (ambiguity.shouldClarify) obligations.push('Задать одно короткое уточнение, потому что ошибка существенно изменит ответ.');
  if (['relationship_reassurance', 'bid_for_reassurance'].includes(hiddenIntent)) obligations.push('Ответить на эмоциональную проверку прямо и лично.');
  if (['possible_hurt_or_withdrawal', 'masked_disappointment'].includes(hiddenIntent)) obligations.push('Сначала признать возможную обиду; не шутить поверх нее.');
  if (hiddenIntent === 'seek_emotional_presence') obligations.push('Сначала побыть рядом; не переходить автоматически к совету.');
  if (hiddenIntent === 'seek_solution') obligations.push('После короткого признания состояния дать один конкретный следующий шаг.');
  if (scene === 'practical_task') obligations.push('Выполнить задачу точно, не заменяя результат атмосферной беседой.');
  if (literalIntent === 'question') obligations.push('Сначала ответить на поставленный вопрос.');
  if (literalIntent === 'farewell') obligations.push('Не открывать новую тему и не задавать вопрос.');
  return [...new Set(obligations)].slice(0, 6);
}

function needsMemory(userText, literalIntent) {
  const text = normalize(userText);
  if (includesAny(text, ['помнишь', 'вспомни', 'мы тогда', 'раньше', 'ты знаешь обо мне'])) return 'explicit';
  if (['short_confirmation', 'greeting', 'gratitude', 'farewell', 'empty'].includes(literalIntent)) return 'none';
  return 'topic_if_relevant';
}

export function analyzeConversation({ userText = '', history = [], conversationState = 'ongoing' } = {}) {
  const turns = recentTurns(history, 12);
  const literalIntent = detectLiteralIntent(userText);
  const hidden = detectHiddenIntent(userText, turns, literalIntent);
  const relation = detectRelation(userText, turns, literalIntent);
  const referents = detectReferents(userText);
  const scene = detectScene(turns, userText);
  const previousAssistant = previousTurn(turns, 'assistant')?.content || '';
  const contextDependent = referents.includes('context_dependent_reference');
  const ambiguityLevel = contextDependent
    ? (previousAssistant ? 54 : 84)
    : 20;
  const ambiguity = {
    level: ambiguityLevel,
    shouldClarify: ambiguityLevel >= 75,
    rule: ambiguityLevel >= 75
      ? 'Уточни только недостающий референт одним коротким вопросом.'
      : 'Не задавай уточняющий вопрос без необходимости.'
  };
  const activeScene = conversationState === 'ending' ? 'farewell' : scene.type;
  const responseKind = chooseResponseKind(literalIntent, hidden.type, activeScene);
  const obligations = buildObligations({
    literalIntent,
    hiddenIntent: hidden.type,
    relation: relation.type,
    scene: activeScene,
    referents,
    ambiguity
  });

  return {
    version: 'turn-plan-v2.0',
    literalIntent,
    hiddenIntent: hidden,
    relation,
    activeScene: {
      type: activeScene,
      confidence: scene.confidence,
      topic: inferTopic(userText, turns),
      emotionalDirection: detectEmotionalDirection(userText),
      participants: ['kirill', 'rin']
    },
    referents,
    ambiguity,
    responseKind,
    memoryNeed: needsMemory(userText, literalIntent),
    questionPolicy: ambiguity.shouldClarify
      ? 'clarify_once'
      : (responseKind === 'natural_connection' ? 'optional_if_genuine' : 'no_automatic_question'),
    obligations,
    responseFocus: obligations[0] || 'Ответить на явный смысл и сохранить непрерывность текущей сцены.',
    summary: [
      `смысл=${literalIntent}`,
      `подтекст=${hidden.type}`,
      `связь=${relation.type}`,
      `сцена=${activeScene}`,
      `ответ=${responseKind}`
    ].join('; ')
  };
}

export function conversationBrainInstruction(plan) {
  if (!plan) return '';
  const obligations = plan.obligations?.length
    ? plan.obligations.map(item => `- ${item}`).join('\n')
    : '- Ответить на явный смысл текущей реплики.';
  return `
ПЛАН ТЕКУЩЕГО ОТВЕТА
Сцена: ${plan.activeScene.type}.
Связь с предыдущей репликой: ${plan.relation.type}.
Предполагаемый тип ответа: ${plan.responseKind}.
Нужна память: ${plan.memoryNeed}.
Политика вопроса: ${plan.questionPolicy}.

Обязательства:
${obligations}

Этот план — подсказка по смыслу, а не текст для пересказа. Не называй его и не раскрывай внутренний анализ.
`.trim();
}

export const __test = {
  normalize,
  tokenList,
  detectLiteralIntent,
  detectReferents,
  sceneSignals
};
