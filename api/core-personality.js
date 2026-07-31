/* api/core-personality.js — v6: единое ядро принятия решений Рин */

const clamp = (value, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const textOf = value => String(value || '').trim();

function countRecentQuestions(history = [], limit = 4) {
  return history
    .filter(item => item?.role === 'assistant')
    .slice(-limit)
    .filter(item => /\?\s*$/.test(textOf(item.content))).length;
}

function detectUserEmotion(userText = '') {
  const text = textOf(userText).toLowerCase();
  const rules = [
    ['distress', /(плохо|больно|тяжел|тяжёл|груст|тревог|страшно|устал|плач|одинок|проблем)/i],
    ['anger', /(злюсь|бесит|раздраж|ненавиж|достал|достало)/i],
    ['care', /(как ты|не устала|береги себя|отдохни|переживаю за тебя|скучал|соскучился)/i],
    ['gratitude', /(спасибо|благодар|ты помогла|ценю)/i],
    ['flirt', /(красивая|милая|очарователь|поцел|обнять|обольщ|свидани|люблю тебя|хочу тебя)/i],
    ['playful', /(шут|подкол|хаха|ахах|хех|😉|😏|😁|😂)/i],
    ['curiosity', /(\?|почему|зачем|как думаешь|что ты думаешь|расскажи|интересно)/i],
    ['farewell', /(пока|до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|бай|bye)/i],
    ['joy', /(ура|рад|счастлив|классно|отлично|здорово|получилось)/i]
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
  let curiosity = clamp(48 + energy * 0.25 + (userEmotion === 'curiosity' ? 22 : 0));
  let thoughtfulness = clamp(42 + trust * 0.18 + (userEmotion === 'distress' ? 25 : 0));
  let fatigue = clamp(100 - energy);
  let desireToTalk = clamp(35 + affection * 0.3 + energy * 0.25);
  let desireToFlirt = clamp(playfulness * 0.55 + affection * 0.28 - fatigue * 0.2);
  let focus = clamp(44 + energy * 0.35 + thoughtfulness * 0.15);
  let emotionality = clamp(35 + affection * 0.25 + playfulness * 0.2);

  if (userEmotion === 'care') {
    tenderness = clamp(tenderness + 15);
    emotionality = clamp(emotionality + 10);
  }
  if (userEmotion === 'flirt') {
    desireToFlirt = clamp(desireToFlirt + 22);
    playfulness && (emotionality = clamp(emotionality + 8));
  }
  if (userEmotion === 'distress') {
    tenderness = clamp(tenderness + 18);
    thoughtfulness = clamp(thoughtfulness + 18);
    desireToFlirt = clamp(desireToFlirt - 35);
    playfulness && (emotionality = clamp(emotionality - 5));
  }
  if (userEmotion === 'anger') {
    thoughtfulness = clamp(thoughtfulness + 12);
    desireToFlirt = clamp(desireToFlirt - 30);
  }

  const recentAssistant = history.filter(item => item?.role === 'assistant').slice(-3);
  const recentLength = recentAssistant.reduce((sum, item) => sum + textOf(item.content).length, 0);
  if (recentLength > 900) focus = clamp(focus - 8);

  return {
    affection,
    trust,
    energy,
    playfulness,
    tenderness,
    curiosity,
    thoughtfulness,
    fatigue,
    desireToTalk,
    desireToFlirt,
    focus,
    emotionality
  };
}

function chooseIntent(userText, userEmotion, state, conversationState) {
  const text = textOf(userText).toLowerCase();

  if (conversationState === 'ending' || userEmotion === 'farewell') return 'farewell';
  if (userEmotion === 'distress') return /помоги|совет|что делать/i.test(text) ? 'support' : 'comfort';
  if (userEmotion === 'anger') return 'support';
  if (userEmotion === 'gratitude') return 'gratitude';
  if (userEmotion === 'flirt' && state.desireToFlirt >= 48) return state.playfulness >= 58 ? 'teasing' : 'flirt';
  if (userEmotion === 'care') return 'tenderness';
  if (userEmotion === 'joy') return 'celebration';
  if (/помнишь|вспомни|мы тогда|раньше/i.test(text)) return 'memory';
  if (/как думаешь|твоё мнение|что ты думаешь/i.test(text)) return 'reflection';
  if (/согласна|правда ведь|ведь так/i.test(text)) return 'agreement';
  if (userEmotion === 'curiosity') return state.curiosity >= 58 ? 'curiosity' : 'answer';
  return state.thoughtfulness > 68 ? 'reflection' : 'connection';
}

function chooseReplyStyle(intent, state, history = [], isLong = false) {
  if (isLong) return 'expanded';
  if (intent === 'farewell') return 'warm_close';
  if (intent === 'comfort' || intent === 'support') return state.fatigue > 65 ? 'short_support' : 'gentle_reflection';
  if (intent === 'flirt' || intent === 'teasing') return state.playfulness > 68 ? 'playful_short' : 'soft_flirt';
  if (intent === 'gratitude') return 'warm_short';
  if (intent === 'memory') return 'memory_echo';

  const recentQuestions = countRecentQuestions(history, 4);
  const canQuestion = state.curiosity >= 64 && recentQuestions === 0;

  if (canQuestion && ['curiosity', 'connection'].includes(intent)) return 'reply_with_question';
  if (state.fatigue >= 68) return 'short_direct';
  if (state.thoughtfulness >= 70) return 'reflective_pause';
  if (state.emotionality >= 72) return 'emotion_then_reply';
  return 'direct_natural';
}

function chooseHabit(state, intent, history = []) {
  if (['support', 'comfort', 'farewell'].includes(intent)) return null;
  const assistantTurns = history.filter(item => item?.role === 'assistant').length;
  if (assistantTurns < 4 || assistantTurns % 17 !== 0) return null;

  const options = state.fatigue > 58
    ? ['поправила волосы', 'сделала глоток чая', 'на секунду прикрыла глаза']
    : ['посмотрела в окно', 'улыбнулась своим мыслям', 'поправила прядь волос'];

  return options[assistantTurns % options.length];
}

function styleInstructions(style) {
  const map = {
    expanded: 'Дай цельный развёрнутый ответ без искусственного сокращения.',
    warm_close: 'Тепло попрощайся только потому, что пользователь сам завершает разговор.',
    short_support: 'Ответь коротко, спокойно и конкретно. Не превращай поддержку в лекцию.',
    gentle_reflection: 'Сначала признай чувство пользователя, затем добавь одну конкретную поддерживающую мысль.',
    playful_short: 'Ответь легко и игриво, максимум 1–3 коротких предложения. Не объясняй шутку.',
    soft_flirt: 'Используй мягкий флирт без чрезмерной откровенности и без навязчивости.',
    warm_short: 'Тепло прими благодарность. Не прощайся и не предлагай помощь снова.',
    memory_echo: 'Естественно свяжи ответ с подходящим прошлым событием, только если оно реально есть в памяти или истории.',
    reply_with_question: 'Ответь по существу и задай один конкретный вопрос по теме. Не используй вопрос-заглушку.',
    short_direct: 'Ответь прямо и кратко, сохраняя мягкость.',
    reflective_pause: 'Допустима короткая естественная пауза вроде «Хм...» или «Сейчас задумалась», затем содержательный ответ.',
    emotion_then_reply: 'Начни с короткой живой эмоции, затем ответь. Не растягивай объяснение.',
    direct_natural: 'Ответь естественно и прямо. Заверши утверждением, а не автоматическим вопросом.'
  };
  return map[style] || map.direct_natural;
}

export function buildCoreDecision({
  userText = '',
  history = [],
  memory = null,
  conversationState = 'ongoing',
  isLong = false
} = {}) {
  const userEmotion = detectUserEmotion(userText);
  const state = deriveState(memory, userEmotion, history);
  const intent = chooseIntent(userText, userEmotion, state, conversationState);
  const replyStyle = chooseReplyStyle(intent, state, history, isLong);
  const habit = chooseHabit(state, intent, history);

  const reasons = [
    `эмоция пользователя: ${userEmotion}`,
    `намерение: ${intent}`,
    `стиль: ${replyStyle}`
  ];
  if (state.fatigue >= 65) reasons.push('учтена повышенная усталость');
  if (state.tenderness >= 70) reasons.push('учтена высокая нежность');
  if (state.desireToFlirt >= 65 && ['flirt', 'teasing'].includes(intent)) reasons.push('флирт соответствует состоянию');

  return {
    version: 'v6',
    userEmotion,
    state,
    intent,
    replyStyle,
    habit,
    reason: reasons.join('; '),
    prompt: `
ЯДРО ПОВЕДЕНИЯ РИН — РЕШЕНИЕ ДЛЯ ЭТОЙ РЕПЛИКИ:

- распознанная эмоция пользователя: ${userEmotion};
- намерение ответа: ${intent};
- выбранный ритм: ${replyStyle};
- нежность: ${state.tenderness}/100;
- любопытство: ${state.curiosity}/100;
- задумчивость: ${state.thoughtfulness}/100;
- усталость: ${state.fatigue}/100;
- желание общаться: ${state.desireToTalk}/100;
- желание флиртовать: ${state.desireToFlirt}/100;
- сосредоточенность: ${state.focus}/100;
- эмоциональность: ${state.emotionality}/100.

ОБЯЗАТЕЛЬНОЕ УКАЗАНИЕ ПО ФОРМЕ:
${styleInstructions(replyStyle)}

${habit ? `Можно один раз ненавязчиво упомянуть мимолётную бытовую деталь: «${habit}». Не превращай её в новый биографический факт.` : 'Не добавляй бытовую деталь только ради украшения.'}

Не рассказывай пользователю о намерении, стиле, шкалах или внутреннем решении.
`.trim()
  };
}
