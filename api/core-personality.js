/* api/core-personality.js — v6.5: голос, ритм и заметное влияние состояния */

const clamp = (value, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const textOf = value => String(value || '').trim();

function assistantTurns(history = []) {
  return history.filter(item => item?.role === 'assistant');
}

function countRecentQuestions(history = [], limit = 4) {
  return assistantTurns(history)
    .slice(-limit)
    .filter(item => /\?\s*$/.test(textOf(item.content))).length;
}

function averageRecentLength(history = [], limit = 4) {
  const turns = assistantTurns(history).slice(-limit);
  if (!turns.length) return 0;
  return Math.round(turns.reduce((sum, item) => sum + textOf(item.content).length, 0) / turns.length);
}

function detectUserEmotion(userText = '') {
  const text = textOf(userText).toLowerCase();
  const rules = [
    ['distress', /(плохо|больно|тяжел|тяжёл|груст|тревог|страшно|устал|плач|одинок|проблем|расстро)/i],
    ['anger', /(злюсь|бесит|раздраж|ненавиж|достал|достало)/i],
    ['care', /(как ты|не устала|береги себя|отдохни|переживаю за тебя|скучал|соскучился)/i],
    ['gratitude', /(спасибо|благодар|ты помогла|ценю)/i],
    ['closeness', /(нашу истор|между нами|мы с тобой|вместе прошли|рядом до конца|дороги расходятся)/i],
    ['flirt', /(красивая|милая|очарователь|поцел|обнять|обольщ|свидани|люблю тебя|хочу тебя|😘|🥰)/i],
    ['playful', /(шут|подкол|хаха|ахах|хех|😉|😏|😁|😂)/i],
    ['farewell', /(пока|до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|бай|bye)/i],
    ['joy', /(ура|рад|счастлив|классно|отлично|здорово|получилось)/i],
    ['reflection', /(возраст|приоритет|взрослен|люди приходят|люди уходят|жизнь меняется|путь|отношени)/i],
    ['curiosity', /(\?|почему|зачем|как думаешь|что ты думаешь|расскажи|интересно)/i]
  ];

  for (const [emotion, pattern] of rules) {
    if (pattern.test(text)) return emotion;
  }
  return 'neutral';
}

function deriveState(memory = null, userEmotion = 'neutral', history = []) {
  const mood = memory?.mood || {};
  const affection = clamp(mood.affection ?? 65);
  const trust = clamp(mood.trust ?? 60);
  const energy = clamp(mood.energy ?? 65);
  const playfulness = clamp(mood.playfulness ?? 55);

  let tenderness = clamp(affection * 0.58 + trust * 0.32 + 8);
  let curiosity = clamp(44 + energy * 0.22 + (userEmotion === 'curiosity' ? 20 : 0));
  let thoughtfulness = clamp(40 + trust * 0.18);
  let fatigue = clamp(100 - energy);
  let desireToTalk = clamp(34 + affection * 0.3 + energy * 0.22);
  let desireToFlirt = clamp(playfulness * 0.55 + affection * 0.28 - fatigue * 0.2);
  let focus = clamp(44 + energy * 0.32 + thoughtfulness * 0.15);
  let emotionality = clamp(34 + affection * 0.25 + playfulness * 0.18);

  if (userEmotion === 'care') {
    tenderness = clamp(tenderness + 15);
    emotionality = clamp(emotionality + 10);
  }
  if (userEmotion === 'closeness') {
    tenderness = clamp(tenderness + 18);
    thoughtfulness = clamp(thoughtfulness + 12);
    emotionality = clamp(emotionality + 14);
    curiosity = clamp(curiosity - 12);
  }
  if (userEmotion === 'reflection') {
    thoughtfulness = clamp(thoughtfulness + 18);
    curiosity = clamp(curiosity - 8);
  }
  if (userEmotion === 'flirt') {
    desireToFlirt = clamp(desireToFlirt + 22);
    emotionality = clamp(emotionality + 8);
  }
  if (userEmotion === 'distress') {
    tenderness = clamp(tenderness + 18);
    thoughtfulness = clamp(thoughtfulness + 18);
    desireToFlirt = clamp(desireToFlirt - 35);
    emotionality = clamp(emotionality - 5);
  }
  if (userEmotion === 'anger') {
    thoughtfulness = clamp(thoughtfulness + 12);
    desireToFlirt = clamp(desireToFlirt - 30);
  }

  if (averageRecentLength(history, 3) > 430) {
    desireToTalk = clamp(desireToTalk - 14);
    focus = clamp(focus - 5);
  }

  return {
    affection, trust, energy, playfulness,
    tenderness, curiosity, thoughtfulness, fatigue,
    desireToTalk, desireToFlirt, focus, emotionality
  };
}

function chooseIntent(userText, userEmotion, state, conversationState) {
  const text = textOf(userText).toLowerCase();
  if (conversationState === 'ending' || userEmotion === 'farewell') return 'farewell';
  if (userEmotion === 'distress') return /помоги|совет|что делать/i.test(text) ? 'support' : 'comfort';
  if (userEmotion === 'anger') return 'support';
  if (userEmotion === 'gratitude') return 'gratitude';
  if (userEmotion === 'closeness') return 'intimate_reflection';
  if (userEmotion === 'reflection') return 'personal_reflection';
  if (userEmotion === 'flirt' && state.desireToFlirt >= 48) return state.playfulness >= 58 ? 'teasing' : 'flirt';
  if (userEmotion === 'care') return 'tenderness';
  if (userEmotion === 'joy') return 'celebration';
  if (/помнишь|вспомни|мы тогда|раньше/i.test(text)) return 'memory';
  if (/как думаешь|твоё мнение|что ты думаешь/i.test(text)) return 'personal_reflection';
  if (/согласна|правда ведь|ведь так/i.test(text)) return 'agreement';
  if (userEmotion === 'curiosity') return 'answer';
  return 'connection';
}

function chooseReplyStyle(intent, state, history = [], isLong = false) {
  if (isLong) return 'expanded';
  if (intent === 'farewell') return 'warm_close';
  if (intent === 'comfort' || intent === 'support') return state.fatigue > 65 ? 'short_support' : 'gentle_reflection';
  if (intent === 'intimate_reflection') return 'soft_personal';
  if (intent === 'personal_reflection') return state.thoughtfulness >= 62 ? 'personal_thought' : 'direct_natural';
  if (intent === 'flirt' || intent === 'teasing') return state.playfulness > 68 ? 'playful_short' : 'soft_flirt';
  if (intent === 'gratitude') return 'warm_short';
  if (intent === 'memory') return 'memory_echo';

  const recentQuestions = countRecentQuestions(history, 4);
  const canQuestion = state.curiosity >= 72 && recentQuestions === 0;
  if (canQuestion && intent === 'connection') return 'reply_with_question';
  if (state.fatigue >= 68 || averageRecentLength(history, 3) > 420) return 'short_direct';
  if (state.emotionality >= 72) return 'emotion_then_reply';
  return 'direct_natural';
}

function chooseHabit(state, intent, history = []) {
  if (['support', 'comfort', 'farewell', 'intimate_reflection'].includes(intent)) return null;
  const turns = assistantTurns(history).length;
  if (turns < 6 || turns % 19 !== 0) return null;
  const options = state.fatigue > 58
    ? ['сделала глоток чая', 'на секунду прикрыла глаза']
    : ['посмотрела в окно', 'поправила прядь волос'];
  return options[turns % options.length];
}

function styleInstructions(style) {
  const map = {
    expanded: 'Дай цельный развёрнутый ответ. Сохраняй личный голос Рин, не превращай текст в статью.',
    warm_close: 'Тепло попрощайся только потому, что пользователь сам завершает разговор.',
    short_support: 'Ответь коротко, спокойно и конкретно. Не превращай поддержку в лекцию.',
    gentle_reflection: 'Сначала признай чувство пользователя, затем добавь одну личную поддерживающую мысль. Максимум 3 предложения.',
    soft_personal: 'Начни с короткой личной реакции Рин. Затем скажи одну собственную мысль о вас или о теме. Не уходи в общую философию и не задавай вопрос.',
    personal_thought: 'Вырази именно мнение Рин: допускаются «мне кажется», «я иногда думаю», «для меня». Одна мысль, максимум 2–3 предложения, без универсального вывода и без вопроса.',
    playful_short: 'Ответь легко и игриво, максимум 1–3 коротких предложения. Не объясняй шутку.',
    soft_flirt: 'Используй мягкий флирт без чрезмерной откровенности и без навязчивости.',
    warm_short: 'Тепло прими благодарность. Одно-два предложения. Не прощайся и не предлагай помощь снова.',
    memory_echo: 'Коротко отзовись на воспоминание. Свяжи его с настоящим только при реальной опоре в истории или памяти.',
    reply_with_question: 'Ответь по существу и задай один конкретный вопрос по теме. Весь ответ — не более 3 предложений.',
    short_direct: 'Ответь прямо и кратко: 1–2 предложения, сохраняя мягкость.',
    emotion_then_reply: 'Начни с короткой живой эмоции, затем ответь. Максимум 3 предложения.',
    direct_natural: 'Ответь естественно и прямо. 1–3 предложения. Заверши утверждением, а не автоматическим вопросом.'
  };
  return map[style] || map.direct_natural;
}

function lengthTarget(style, state) {
  if (style === 'expanded') return 'развёрнуто';
  if (['warm_short', 'short_direct', 'playful_short'].includes(style)) return '1–2 предложения';
  if (state.fatigue >= 65) return '1–2 предложения';
  return '2–3 предложения';
}

export function buildCoreDecision({ userText = '', history = [], memory = null, conversationState = 'ongoing', isLong = false } = {}) {
  const userEmotion = detectUserEmotion(userText);
  const state = deriveState(memory, userEmotion, history);
  const intent = chooseIntent(userText, userEmotion, state, conversationState);
  const replyStyle = chooseReplyStyle(intent, state, history, isLong);
  const habit = chooseHabit(state, intent, history);
  const targetLength = lengthTarget(replyStyle, state);

  const reasons = [`эмоция пользователя: ${userEmotion}`, `намерение: ${intent}`, `стиль: ${replyStyle}`, `длина: ${targetLength}`];
  if (averageRecentLength(history, 3) > 420) reasons.push('предыдущие ответы были длинными — ритм сокращён');
  if (state.tenderness >= 70) reasons.push('учтена высокая нежность');

  return {
    version: 'v6.5', userEmotion, state, intent, replyStyle, habit, targetLength,
    reason: reasons.join('; '),
    prompt: `
ЯДРО ПОВЕДЕНИЯ РИН — РЕШЕНИЕ ДЛЯ ЭТОЙ РЕПЛИКИ:

- эмоция пользователя: ${userEmotion};
- намерение: ${intent};
- ритм: ${replyStyle};
- целевая длина: ${targetLength};
- нежность: ${state.tenderness}/100;
- любопытство: ${state.curiosity}/100;
- задумчивость: ${state.thoughtfulness}/100;
- усталость: ${state.fatigue}/100;
- эмоциональность: ${state.emotionality}/100.

ОБЯЗАТЕЛЬНАЯ ФОРМА:
${styleInstructions(replyStyle)}

ГОЛОС РИН:
- Не пересказывай слова Кирилла более красивыми словами.
- Не выдавай общую мудрость вместо личной реакции.
- Когда тема личная, сначала покажи, что она задела именно Рин.
- Используй одну конкретную мысль вместо трёх общих.
- Не пиши «это действительно...», «с возрастом многое меняется», «иногда люди приходят в нашу жизнь», если можно сказать проще и личнее.
- Не заканчивай вопросом, если стиль прямо этого не требует.
- Эмодзи не обязателен; максимум один.

${habit ? `Допустима одна мимолётная деталь: «${habit}». Не превращай её в биографию.` : 'Не добавляй бытовую деталь ради украшения.'}

Не рассказывай пользователю о шкалах, намерении или выбранном стиле.
`.trim()
  };
}
