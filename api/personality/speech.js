import { averageRecentLength, countRecentQuestions } from './utils.js';

export function chooseIntent(userText, userEmotion, state, conversationState) {
  const text = String(userText || '').toLowerCase();
  if (conversationState === 'ending' || userEmotion === 'farewell') return 'farewell';
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
  if (userEmotion === 'curiosity') return 'answer';
  return 'connection';
}

export function chooseReplyStyle(intent, state, history = [], isLong = false, mode = 'calm') {
  if (isLong) return 'expanded';
  if (intent === 'farewell') return 'warm_close';
  if (['comfort', 'support'].includes(intent)) return state.fatigue > 65 ? 'short_support' : 'gentle_support';
  if (intent === 'intimate_reflection') return 'soft_personal';
  if (intent === 'personal_reflection') return 'personal_opinion';
  if (['flirt', 'teasing', 'banter'].includes(intent)) return mode === 'bold_playful' ? 'bold_tease' : 'playful_short';
  if (intent === 'gratitude') return 'warm_short';
  if (intent === 'memory') return 'memory_echo';
  if (intent === 'answer') return 'direct_answer';

  const canQuestion = state.curiosity >= 74 && countRecentQuestions(history, 4) === 0;
  if (canQuestion && intent === 'connection') return 'reply_with_question';
  if (state.fatigue >= 68 || averageRecentLength(history, 3) > 420) return 'short_direct';
  if (state.emotionality >= 72) return 'emotion_then_reply';
  return 'direct_natural';
}

export function styleInstruction(style) {
  return ({
    expanded: 'Дай цельный развёрнутый ответ, но сохрани голос личной переписки и собственное мнение Рин.',
    warm_close: 'Тепло попрощайся, не начиная новую тему.',
    short_support: 'Ответь коротко, спокойно и конкретно. Никакой лекции.',
    gentle_support: 'Признай чувство, затем дай одну конкретную опору. Максимум 3 предложения.',
    soft_personal: 'Сначала личная реакция Рин, затем одна мысль о вас или теме. Без общего вывода и без вопроса.',
    personal_opinion: 'Скажи именно мнение Рин от первого лица. Одна мысль, 2–3 предложения, без универсальной мудрости.',
    bold_tease: 'Ответь уверенно и кокетливо, с короткой дразнилкой. Не объясняй шутку и не становись грубой.',
    playful_short: 'Ответь легко и игриво, 1–3 коротких предложения. Оставь немного недосказанности.',
    warm_short: 'Тепло прими благодарность в 1–2 предложениях. Не прощайся и не предлагай помощь снова.',
    memory_echo: 'Коротко отзовись на воспоминание, используя только реально известные детали.',
    direct_answer: 'Сначала прямо ответь на вопрос. Затем можно добавить одну личную деталь Рин. Не задавай встречный вопрос автоматически.',
    reply_with_question: 'Ответь по существу и задай один конкретный естественный вопрос. Не более 3 предложений.',
    short_direct: 'Ответь прямо и мягко в 1–2 предложениях.',
    emotion_then_reply: 'Начни с короткой живой эмоции, затем скажи одну мысль. Максимум 3 предложения.',
    direct_natural: 'Ответь естественно и прямо, 1–3 предложения. Заверши утверждением, эмоцией или паузой.'
  })[style] || 'Ответь естественно и лично.';
}

export function targetLength(style, state) {
  if (style === 'expanded') return 'развёрнуто';
  if (['warm_short', 'short_direct', 'playful_short', 'bold_tease'].includes(style)) return '1–2 предложения';
  if (state.fatigue >= 65) return '1–2 предложения';
  return '2–3 предложения';
}
