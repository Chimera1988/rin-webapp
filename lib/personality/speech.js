import { averageRecentLength, countRecentQuestions, assistantTurns, hashText } from './utils.js';

export function chooseIntent(userText, userEmotion, state, conversationState, brain = null) {
  const text = String(userText || '').toLowerCase();
  const hidden = brain?.hiddenIntent?.type;
  if (hidden === 'seek_solution') return 'support';
  if (hidden === 'seek_emotional_presence') return 'comfort';
  if (['invite_rin_initiative', 'reclaim_playful_scene', 'continue_playful_tension'].includes(hidden)) return 'teasing';
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hidden)) return 'intimate_reflection';
  if (['possible_hurt_or_withdrawal', 'masked_disappointment', 'repair_connection'].includes(hidden)) return 'repair';
  const explicitFarewell = brain?.literalIntent === 'farewell';
  if (conversationState === 'ending' && explicitFarewell) return 'farewell';
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
  if (brain?.literalIntent === 'short_confirmation') {
    return brain?.activeScene?.type === 'playful_flirt' ? 'banter' : 'acknowledgement';
  }
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
  if (['flirt', 'teasing', 'banter'].includes(intent)) return 'react_and_stop';
  if (['answer', 'farewell', 'repair', 'support', 'comfort', 'intimate_reflection'].includes(intent)) return 'answer_or_react_and_stop';
  const recentQuestions = countRecentQuestions(history, 4);
  const questionStreak = consecutiveAssistantQuestions(history);
  const literal = conversationBrain?.literalIntent;
  if (questionStreak >= 2 || recentQuestions >= 2) return 'share_or_observe';
  if (literal === 'question') return 'answer_then_optional_personal_detail';
  const options = ['react_and_stop', 'share_personal_detail', 'brief_observation'];
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
  if (state.fatigue >= 68 || averageRecentLength(history, 3) > 420) return 'short_direct';
  if (discourseMode === 'share_personal_detail') return 'personal_share';
  if (discourseMode === 'brief_observation') return 'brief_observation';
  if (state.emotionality >= 72) return 'emotion_then_reply';
  return 'direct_natural';
}

export function chooseDeliveryStyle({ intent = 'connection', mode = 'calm', discourseMode = '', userText = '', history = [] } = {}) {
  const text = String(userText || '');
  const shortUser = text.replace(/\s+/g, ' ').trim().length <= 55;
  if (['flirt', 'teasing', 'banter'].includes(intent)) return 'playful_spoken';
  if (['tenderness', 'gratitude', 'intimate_reflection'].includes(intent)) return 'tender_spoken';
  if (['comfort', 'support', 'repair'].includes(intent)) return 'quiet_spoken';
  if (intent === 'answer') return 'direct_spoken';
  if (intent === 'personal_reflection' || intent === 'memory') return 'reflective_spoken';
  if (shortUser || discourseMode === 'brief_observation' || discourseMode === 'acknowledge_and_stop') return 'spoken_short';
  return mode === 'thoughtful' ? 'reflective_spoken' : 'spoken_warm';
}

export function deliveryInstruction(style) {
  return ({
    spoken_short: 'Разговорная подача: начни живо и коротко, но не обрывай возникшее чувство. Одной реплики достаточно только когда она эмоционально завершена.',
    spoken_warm: 'Разговорная подача: пиши как в личном чате — простые слова, естественный порядок фраз, одна мысль за раз. Не отвечай канцелярскими «приятно это слышать» и «рада это знать», когда можно отреагировать конкретно.',
    playful_spoken: 'Разговорная подача: короткая дразнилка или уверенная реакция. Не поясняй флирт словами «это мило/заманчиво/приятно» и не подводи итог.',
    tender_spoken: 'Разговорная подача: тепло выражай действием или прямой реакцией. Лучше «Иди сюда 🤗», «Улыбнулась», «Тогда обнимаю» или «Мне приятно», чем формальные оценки и общие выводы.',
    quiet_spoken: 'Разговорная подача: спокойно, лично и без готовых жизненных формул. Назови чувство или присутствие; совет давай только если его попросили.',
    direct_spoken: 'Разговорная подача: сначала конкретный ответ обычными словами. Не добавляй красивый общий вывод и не задавай встречный вопрос по привычке.',
    reflective_spoken: 'Разговорная подача: одна личная мысль Рин простыми словами. Не превращай её в афоризм и не говори от лица всех людей.'
  })[style] || 'Пиши живой разговорной речью.';
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
    playful_short: 'Ответь легко и игриво. Подхвати игру и оставь немного недосказанности; не обрывай её формальным согласием.',
    warm_short: 'Тепло и лично прими благодарность. Короткого ответа достаточно, но формальная вежливость без собственной реакции недостаточна.',
    memory_echo: 'Коротко отзовись на воспоминание, используя только реально известные детали.',
    direct_answer: 'Сначала прямо ответь на вопрос. Затем можно добавить одну конкретную личную деталь Рин. Не задавай встречный вопрос автоматически.',
    personal_share: 'Отреагируй и добавь одну конкретную деталь о Рин. Не задавай вопрос и не пересказывай сообщение пользователя.',
    brief_observation: 'Назови одну конкретную деталь или наблюдение по теме и остановись. Без вопроса и общего вывода.',
    short_direct: 'Ответь прямо и мягко в 1–2 предложениях.',
    emotion_then_reply: 'Начни с живой эмоции, затем дай ей одну конкретную личную мысль или послевкусие. Обычно 2–4 предложения; вопрос не обязателен.',
    direct_natural: 'Ответь естественно и прямо. Закончи не по числу предложений, а когда смысл и эмоциональная реакция прозвучали полностью.'
  })[style] || 'Ответь естественно и лично.';
}

export function targetLength(style, state) {
  if (style === 'expanded') return 'развёрнуто';
  if (style === 'brief_acknowledgement') return '1 короткое предложение';
  if (['brief_observation', 'brief_acknowledgement'].includes(style)) return '1–2 предложения';
  if (['playful_short', 'bold_tease'].includes(style)) return '1–2 коротких предложения';
  if (['warm_short', 'short_direct', 'personal_share', 'emotion_then_reply', 'soft_personal'].includes(style)) return 'обычно 2–3 предложения';
  if (state.fatigue >= 75) return 'обычно 1–3 предложения';
  return 'обычно 2–4 предложения';
}
