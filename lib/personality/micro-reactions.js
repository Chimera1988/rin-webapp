import { assistantTurns, pickStable, recentText } from './utils.js';

const SAFE_REACTIONS = {
  calm: ['', '', 'Хм...', 'Понимаю.', 'Вот как.', 'Знаешь...'],
  gentle: ['', '', 'Мм...', 'Знаешь...', 'Это приятно.', 'Почему-то улыбаюсь.'],
  shy_tender: ['', '', 'Ой...', 'Мм...', 'Ну вот...', 'Я даже немного смутилась.'],
  playful: ['', '', 'Хех.', 'Ах вот как.', 'Ну конечно.', 'Серьёзно?'],
  bold_playful: ['', '', 'Смело.', 'Какая уверенность.', 'Не торопись радоваться.'],
  thoughtful: ['', '', 'Хм...', 'Знаешь...', 'Вот сейчас задумалась.', 'Если честно...'],
  tired_warm: ['', '', 'Мм...', 'Подожди...', 'Если честно...', 'Хм...'],
  supportive: ['', '', 'Я рядом.', 'Слышу тебя.', 'Да...', 'Не спеши.']
};

const TEASE_REACTIONS = {
  playful: ['Поймала тебя.', 'Так-так...', 'Вот хитрец.', 'Ну конечно.'],
  bold_playful: ['Попался.', 'Ну-ну.', 'Ишь какой.', 'Ах вот оно что.', 'Не торопись радоваться.']
};

const TEASE_INTENTS = new Set(['teasing', 'banter', 'flirt']);
const NEVER_REACT_INTENTS = new Set(['answer', 'farewell', 'support', 'comfort', 'repair']);

function normalized(value = '') {
  return String(value).toLowerCase().replace(/[.…!?]+$/g, '').trim();
}

function usedRecently(value, history) {
  const needle = normalized(value);
  if (!needle) return false;
  return normalized(recentText(history, 10)).includes(needle);
}

function hasTeaseSignal({ userText = '', userEmotion = '', intent = '', conversationBrain = null } = {}) {
  if (TEASE_INTENTS.has(intent) || ['flirt', 'playful'].includes(userEmotion)) return true;
  const hidden = conversationBrain?.hiddenIntent?.type;
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hidden)) return true;
  return /(?:😉|😏|😘|обольщ|флирт|хитр|поймал|попал|спорим|слабо|только для тебя|нравлюсь|обо мне|ревну|поцел|обним)/i.test(String(userText));
}

function echoesUser(reaction, userText) {
  const reactionWords = normalized(reaction).split(/\s+/).filter(word => word.length > 3);
  const text = normalized(userText);
  return reactionWords.length > 0 && reactionWords.every(word => text.includes(word));
}

export function chooseMicroReaction({
  mode = 'calm',
  intent = 'connection',
  userText = '',
  userEmotion = 'neutral',
  conversationBrain = null,
  history = [],
  seed = ''
} = {}) {
  const turns = assistantTurns(history).length;
  if (turns <= 1 || NEVER_REACT_INTENTS.has(intent) || turns % 4 === 0) return '';

  const teaseAllowed = hasTeaseSignal({ userText, userEmotion, intent, conversationBrain });
  const basePool = SAFE_REACTIONS[mode] || SAFE_REACTIONS.calm;
  const teasePool = teaseAllowed ? (TEASE_REACTIONS[mode] || []) : [];
  const pool = [...basePool, ...teasePool];
  const rotated = pool.map((_, index) => pool[(index + (turns % Math.max(1, pool.length))) % pool.length]);
  const candidates = rotated.filter(value => !usedRecently(value, history) && !echoesUser(value, userText));
  return pickStable(candidates.length ? candidates : [''], `${seed}:micro-reaction`) || '';
}
