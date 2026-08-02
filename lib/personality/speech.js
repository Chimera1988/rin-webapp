import { averageRecentLength, countRecentQuestions, assistantTurns, hashText } from './utils.js';

export function chooseIntent(userText, userEmotion, state, conversationState, brain = null) {
  const text = String(userText || '').toLowerCase();
  const hidden = brain?.hiddenIntent?.type;
  if (hidden === 'seek_solution') return 'support';
  if (hidden === 'seek_emotional_presence') return 'comfort';
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hidden)) return 'intimate_reflection';
  if (['possible_hurt_or_withdrawal', 'masked_disappointment', 'repair_connection'].includes(hidden)) return 'repair';
  const explicitFarewell = brain?.literalIntent === 'farewell' || /(?:^|\s)(?:пока|до встречи|до завтра|спокойной ночи|доброй ночи|увидимся|бай|bye)(?:[.!…\s]|$)/i.test(text);
  if ((conversationState === 'ending' && explicitFarewell) || explicitFarewell) return 'farewell';
  if (userEmotion === 'distress') return /помоги|совет|что делать/i.test(text) ? 'support' : 'comfort';
  if (userEmotion === 'anger') return 'support';
  if (userEmotion === 'gratitude') return 'gratitude';
  if (userEmotion === 'closeness') return 'intimate_reflection';
  if (userEmotion === 'reflection') return 'personal_reflection';
  if (userEmotion === 'flirt' && state.desireToFlirt >= 48) return state.playfulness >= 65 ? 'teasing' : 'flirt';
  if (userEmotion === 'playful') return 'banter';
  if (userEmotion === 'care') return 'tenderness';
  if (userEmotion === 'joy') return 'celebration';
  if (/помнишь|вспомни|мы тогда|раньше/i.test(text)) return 'memory';
  if (/как думаешь|твоё мнение|что ты думаешь/i.test(text)) return 'personal_reflection';
  if (/согласна|правда ведь|ведь так/i.test(text)) return 'agreement';
  if (brain?.literalIntent === 'short_confirmation') return 'acknowledgement';
  if (userEmotion === 'curiosity') return 'answer';
  return 'connection';
}

function consecutiveAssistantQuestions(history = []) {
  let count = 0;
  for (const item of assistantTurns(history).slice().reverse()) {
    if (/\?\s*$/.test(String(item?.content || '').trim())) count += 1;
    else break;
  }
  return count;
}

export function chooseDiscourseMode({ intent, history = [], seed = '', conversationBrain = null } = {}) {
  if (intent === 'acknowledgement') return 'acknowledge_and_stop';
  if (['answer', 'farewell', 'repair', 'support', 'comfort', 'intimate_reflection'].includes(intent)) return 'answer_or_react_and_stop';
  const recentQuestions = countRecentQuestions(history, 4);
  const questionStreak = consecutiveAssistantQuestions(history);
  const literal = conversationBrain?.literalIntent;
  if (questionStreak >= 2 || recentQuestions >= 2) return 'share_or_observe';
  if (literal === 'question') return 'answer_then_optional_personal_detail';
  const options = ['react_and_stop', 'share_personal_detail', 'brief_observation', 'ask_one_specific_question'];
  return options[hashText(`${seed}:discourse`) % options.length];
}

export function chooseReplyStyle(intent, state, history = [], isLong = false, mode = 'calm', discourseMode = '') {
  if (isLong) return 'expanded';
  if (intent === 'farewell') return 'warm_close';
  if (intent === 'acknowledgement') return 'brief_acknowledgement';
  if (intent === 'repair') return 'gentle_repair';
  if (['comfort', 'support'].includes(intent)) return state.fatigue > 65 ? 'short_support' : 'gentle_support';
  if (intent === 'intimate_reflection') return 'soft_personal';
  if (intent === 'personal_reflection') return 'personal_opinion';
  if (['flirt', 'teasing', 'banter'].includes(intent)) return mode === 'bold_playful' ? 'bold_tease' : 'playful_short';
  if (intent === 'gratitude') return 'warm_short';
  if (intent === 'memory') return 'memory_echo';
  if (intent === 'answer') return 'direct_answer';
  if (discourseMode === 'ask_one_specific_question' && state.curiosity >= 68) return 'reply_with_question';
  if (state.fatigue >= 68 || averageRecentLength(history, 3) > 420) return 'short_direct';
  if (discourseMode === 'share_personal_detail') return 'personal_share';
  if (discourseMode === 'brief_observation') return 'brief_observation';
  if (state.emotionality >= 72) return 'emotion_then_reply';
  return 'direct_natural';
}

export function styleInstruction(style) {
  return ({
    expanded: 'Дай цельный развёрнутый ответ, но сохрани голос личной переписки и собственное мнение Рин.',
    warm_close: 'Тепло попрощайся, не начиная новую тему.',
    brief_acknowledgement: 'Пойми, с чем именно пользователь согласился, и коротко закрепи это. Не переосмысливай реплику, не хвали и не открывай новую тему.',
    gentle_repair: 'Сначала мягко признай возможную обиду или напряжение, затем восстанови контакт одной личной фразой. Не спорь и не морализируй.',
    short_support: 'Ответь коротко, спокойно и конкретно. Никакой лекции.',
    gentle_support: 'Признай чувство, затем дай одну конкретную опору. Максимум 3 предложения.',
    soft_personal: 'Сначала личная реакция Рин, затем одна мысль о вас или теме. Без общего вывода и без вопроса.',
    personal_opinion: 'Скажи именно мнение Рин от первого лица. Одна мысль, 2–3 предложения, без универсальной мудрости.',
    bold_tease: 'Ответь уверенно и кокетливо, с короткой дразнилкой. Не объясняй шутку и не становись грубой.',
    playful_short: 'Ответь легко и игриво, 1–3 коротких предложения. Оставь немного недосказанности.',
    warm_short: 'Тепло прими благодарность в 1–2 предложениях. Не прощайся и не предлагай помощь снова.',
    memory_echo: 'Коротко отзовись на воспоминание, используя только реально известные детали.',
    direct_answer: 'Сначала прямо ответь на вопрос. Затем можно добавить одну конкретную личную деталь Рин. Не задавай встречный вопрос автоматически.',
    reply_with_question: 'Ответь по существу и задай один конкретный естественный вопрос. Не более 3 предложений.',
    personal_share: 'Отреагируй и добавь одну конкретную деталь о Рин. Не задавай вопрос и не пересказывай сообщение пользователя.',
    brief_observation: 'Назови одну конкретную деталь или наблюдение по теме и остановись. Без вопроса и общего вывода.',
    short_direct: 'Ответь прямо и мягко в 1–2 предложениях.',
    emotion_then_reply: 'Начни с короткой живой эмоции, затем скажи одну новую мысль. Максимум 3 предложения; вопрос не обязателен.',
    direct_natural: 'Ответь естественно и прямо, 1–3 предложения. Заверши утверждением, эмоцией или паузой.'
  })[style] || 'Ответь естественно и лично.';
}

export function targetLength(style, state) {
  if (style === 'expanded') return 'развёрнуто';
  if (style === 'brief_acknowledgement') return '1 короткое предложение';
  if (['warm_short', 'short_direct', 'playful_short', 'bold_tease', 'personal_share', 'brief_observation'].includes(style)) return '1–2 предложения';
  if (state.fatigue >= 65) return '1–2 предложения';
  return '2–3 предложения';
}
