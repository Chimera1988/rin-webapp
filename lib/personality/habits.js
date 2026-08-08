import { assistantTurns, pickStable, recentText } from './utils.js';

const OPENINGS = {
  calm: ['', '', 'Хм...', 'Знаешь...', 'Вот как.', 'Может быть...'],
  gentle: ['', '', 'Знаешь...', 'Почему-то...', 'Мм...', 'Ну вот...', 'Мне нравится.'],
  shy_tender: ['', '', '...Знаешь', 'Хм...', 'Ой...', 'Ну вот...', 'Я даже немного смутилась.'],
  playful: ['', '', 'Хех.', 'Ну конечно.', 'Подожди-ка...', 'Ах вот как.', 'Так-так...', 'Поймала тебя.'],
  bold_playful: ['', '', 'Смело.', 'Ну-ну.', 'Ах вот оно что.', 'Попался.', 'Ишь какой.', 'Какая уверенность.'],
  thoughtful: ['', '', 'Знаешь...', 'Вот сейчас задумалась...', 'Если честно...', 'Странно, но...', 'Почему-то вспомнилось...'],
  tired_warm: ['', '', 'Хм...', 'Если честно...', 'Мм...', 'Подожди...', 'Я сегодня немного медленная...'],
  supportive: ['', '', 'Я рядом.', 'Послушай...', 'Слышу тебя.', 'Да...', 'Не спеши.']
};

const RHYTHMS = {
  calm: ['plain', 'plain', 'soft_pause', 'reaction_then_plain'],
  gentle: ['warm_reaction', 'soft_pause', 'plain', 'simple_closeness'],
  shy_tender: ['hesitation', 'warm_reaction', 'soft_pause', 'fragment_then_accept'],
  playful: ['tease_then_thought', 'short_reaction', 'plain', 'reaction_then_tease'],
  bold_playful: ['short_tease', 'challenge', 'tease_then_thought', 'confident_pause'],
  thoughtful: ['pause_then_opinion', 'personal_observation', 'plain', 'self_correction'],
  tired_warm: ['short_soft', 'pause_then_thought', 'plain', 'unfinished_soft'],
  supportive: ['acknowledge_then_anchor', 'short_support', 'plain', 'quiet_presence']
};

function normalize(value = '') {
  return String(value).toLowerCase().replace(/[.…!?]+$/g, '').trim();
}

function wasUsedRecently(value, history) {
  if (!value) return false;
  return normalize(recentText(history, 10)).includes(normalize(value));
}

function chooseFresh(pool, history, seed) {
  const fresh = pool.filter(value => !value || !wasUsedRecently(value, history));
  return pickStable(fresh.length ? fresh : [''], seed) || '';
}

export function chooseHabits({ mode, intent, userEmotion = 'neutral', history = [], seed = '' } = {}) {
  const turn = assistantTurns(history).length;
  const playfulIntent = ['teasing', 'banter', 'flirt'].includes(intent) || ['flirt', 'playful'].includes(userEmotion);
  const effectiveMode = ['playful', 'bold_playful'].includes(mode) && !playfulIntent ? 'calm' : mode;
  const allowOpening = turn > 2 && turn % 3 !== 0 && !['farewell', 'answer'].includes(intent);
  const opening = allowOpening ? chooseFresh(OPENINGS[effectiveMode] || OPENINGS.calm, history, `${seed}:opening`) : '';
  const rhythm = pickStable(RHYTHMS[effectiveMode] || RHYTHMS.calm, `${seed}:rhythm`);
  const fragmentChance = ['playful', 'bold_playful', 'shy_tender', 'thoughtful'].includes(effectiveMode) && turn % 4 === 1;
  const emojiAllowance = ['gentle', 'shy_tender', 'playful', 'bold_playful'].includes(effectiveMode) ? 1 : 0;

  return {
    opening,
    rhythm,
    effectiveMode,
    allowFragment: fragmentChance,
    emojiAllowance,
    avoid: recentText(history, 10).slice(-1400)
  };
}
