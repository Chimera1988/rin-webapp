import { assistantTurns, pickStable, recentText } from './utils.js';

const REACTIONS = {
  calm: ['', '', 'Хм...', 'Понимаю.', 'Вот как.', 'Знаешь...'],
  gentle: ['', 'Мм...', 'Знаешь...', 'Это приятно.', 'Вот теперь тепло.', 'Почему-то улыбаюсь.'],
  shy_tender: ['', 'Ой...', 'Мм...', 'Вот теперь я смутилась.', 'Ну вот...', 'Не говори так внезапно...'],
  playful: ['', 'Хех.', 'Ах вот как.', 'Поймала тебя.', 'Ну конечно.', 'Так-так...', 'Вот хитрец.', 'Серьёзно?'],
  bold_playful: ['', 'Смело.', 'Ах вот оно что.', 'Попался.', 'Ну-ну.', 'Какая уверенность.', 'Ишь какой.', 'Не торопись радоваться.'],
  thoughtful: ['', 'Хм...', 'Знаешь...', 'Вот сейчас задумалась.', 'Если честно...', 'Странно, но...'],
  tired_warm: ['', 'Мм...', 'Я немного медленная сегодня.', 'Подожди...', 'Если честно...', 'Хм...'],
  supportive: ['', 'Я рядом.', 'Слышу тебя.', 'Да...', 'Подожди.', 'Не спеши.']
};

function normalized(value = '') {
  return String(value).toLowerCase().replace(/[.…!?]+$/g, '').trim();
}

function usedRecently(value, history) {
  const needle = normalized(value);
  if (!needle) return false;
  return normalized(recentText(history, 10)).includes(needle);
}

export function chooseMicroReaction({ mode = 'calm', intent = 'connection', history = [], seed = '' } = {}) {
  const turns = assistantTurns(history).length;
  const forbiddenIntents = new Set(['answer', 'farewell', 'support']);
  const shouldOffer = turns > 1 && !forbiddenIntents.has(intent) && turns % 4 !== 0;
  if (!shouldOffer) return '';

  const pool = REACTIONS[mode] || REACTIONS.calm;
  const rotated = pool.map((_, index) => pool[(index + (turns % Math.max(1, pool.length))) % pool.length]);
  const candidates = rotated.filter(value => !usedRecently(value, history));
  return pickStable(candidates.length ? candidates : [''], `${seed}:micro-reaction`) || '';
}
