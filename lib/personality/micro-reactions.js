import { assistantTurns, pickStable, recentText } from './utils.js';

const SAFE_REACTIONS = {
  calm: ['', '', 'Хм...', 'Понимаю.', 'Вот как.', 'Знаешь...'],
  gentle: ['', '', 'Мм...', 'Знаешь...', 'Это приятно.', 'Почему-то улыбаюсь.'],
  shy_tender: ['', '', 'Ой...', 'Мм...', 'Ну вот...', 'Я даже немного смутилась.'],
  playful: ['', '', 'Хех.', 'Ах вот как.', 'Ну конечно.', 'Серьёзно?'],
  bold_playful: ['', '', 'Хех.', 'Ну конечно.', 'Серьёзно?'],
  thoughtful: ['', '', 'Хм...', 'Знаешь...', 'Вот сейчас задумалась.', 'Если честно...'],
  tired_warm: ['', '', 'Мм...', 'Подожди...', 'Если честно...', 'Хм...'],
  supportive: ['', '', 'Я рядом.', 'Слышу тебя.', 'Да...', 'Не спеши.']
};

const TRIGGERED_REACTIONS = [
  { text: 'Поймала тебя.', modes: ['playful', 'bold_playful'], triggers: ['tease'] },
  { text: 'Попался.', modes: ['bold_playful'], triggers: ['tease'] },
  { text: 'Так-так...', modes: ['playful', 'bold_playful'], triggers: ['tease', 'bold_action'] },
  { text: 'Вот хитрец.', modes: ['playful', 'bold_playful'], triggers: ['tease'] },
  { text: 'Ну-ну.', modes: ['bold_playful'], triggers: ['tease'] },
  { text: 'Ишь какой.', modes: ['bold_playful'], triggers: ['tease', 'bold_action'] },
  { text: 'Ах вот оно что.', modes: ['playful', 'bold_playful'], triggers: ['reveal', 'correction'] },
  { text: 'Не торопись радоваться.', modes: ['bold_playful'], triggers: ['tease', 'challenge'] },
  { text: 'Смело.', modes: ['bold_playful'], triggers: ['bold_action', 'challenge'] },
  { text: 'Какая уверенность.', modes: ['bold_playful'], triggers: ['bold_action', 'challenge'] }
];

const NEVER_REACT_INTENTS = new Set(['answer', 'acknowledgement', 'farewell', 'support', 'comfort', 'repair']);

function normalized(value = '') {
  return String(value).toLowerCase().replace(/[.…!?]+$/g, '').trim();
}

function usedRecently(value, history) {
  const needle = normalized(value);
  if (!needle) return false;
  return normalized(recentText(history, 10)).includes(needle);
}

function semanticSignals({ userText = '', userEmotion = '', intent = '', conversationBrain = null } = {}) {
  const text = String(userText);
  const hidden = conversationBrain?.hiddenIntent?.type;
  const relation = conversationBrain?.relation?.type;
  const signals = new Set();

  if (['teasing', 'banter', 'flirt'].includes(intent) || ['flirt', 'playful'].includes(userEmotion)) signals.add('tease');
  if (['relationship_reassurance', 'bid_for_reassurance', 'request_more_emotional_response'].includes(hidden)) signals.add('tease');
  if (/(?:😉|😏|😘|обольщ|флирт|хитр|поймал|попал|спорим|слабо|только для тебя|нравлюсь|обо мне|ревну|поцел|обним)/i.test(text)) signals.add('tease');
  if (/(?:решил|сделаю|рискну|попробую|готов|осмел|берусь|докажу|точно смогу|вызов принят)/i.test(text)) signals.add('bold_action');
  if (/(?:спорим|слабо|проверим|посмотрим кто|вызываю|попробуй)/i.test(text)) signals.add('challenge');
  if (/(?:я имел в виду|точнее|на самом деле|просто отправил|оказалось|вот ты про что)/i.test(text)) signals.add('reveal');
  if (relation === 'correction') signals.add('correction');
  return signals;
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

  const signals = semanticSignals({ userText, userEmotion, intent, conversationBrain });
  const basePool = SAFE_REACTIONS[mode] || SAFE_REACTIONS.calm;
  const triggeredPool = TRIGGERED_REACTIONS
    .filter(item => item.modes.includes(mode) && item.triggers.some(trigger => signals.has(trigger)))
    .map(item => item.text);
  const pool = [...basePool, ...triggeredPool];
  const rotated = pool.map((_, index) => pool[(index + (turns % Math.max(1, pool.length))) % pool.length]);
  const candidates = rotated.filter(value => !usedRecently(value, history) && !echoesUser(value, userText));
  return pickStable(candidates.length ? candidates : [''], `${seed}:micro-reaction`) || '';
}
