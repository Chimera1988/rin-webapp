import { assistantTurns, pickStable, recentText } from './utils.js';

const OPENINGS = {
  calm: ['', '', 'Хм...', 'Знаешь...'],
  gentle: ['', 'Знаешь...', 'Почему-то...', 'Хм...'],
  shy_tender: ['', '...Знаешь', 'Хм...', 'Вот теперь я немного смутилась...'],
  playful: ['', 'Хех.', 'Ну конечно...', 'Подожди-ка...'],
  bold_playful: ['', 'Хитрый какой.', 'Ну-ну...', 'Смело.'],
  thoughtful: ['', 'Знаешь...', 'Вот сейчас задумалась...', 'Если честно...'],
  tired_warm: ['', 'Хм...', 'Если честно...', 'Я сегодня немного медленная...'],
  supportive: ['', 'Я рядом.', 'Послушай...', 'Хм...']
};

const RHYTHMS = {
  calm: ['plain', 'plain', 'soft_pause'],
  gentle: ['warm_reaction', 'soft_pause', 'plain'],
  shy_tender: ['hesitation', 'warm_reaction', 'soft_pause'],
  playful: ['tease_then_thought', 'short_reaction', 'plain'],
  bold_playful: ['short_tease', 'challenge', 'tease_then_thought'],
  thoughtful: ['pause_then_opinion', 'personal_observation', 'plain'],
  tired_warm: ['short_soft', 'pause_then_thought', 'plain'],
  supportive: ['acknowledge_then_anchor', 'short_support', 'plain']
};

function wasUsedRecently(value, history) {
  if (!value) return false;
  return recentText(history, 7).toLowerCase().includes(value.toLowerCase().replace(/[.…]+$/g, ''));
}

export function chooseHabits({ mode, intent, history = [], seed = '' } = {}) {
  const turn = assistantTurns(history).length;
  const allowOpening = turn > 2 && turn % 3 !== 0 && !['farewell', 'answer'].includes(intent);
  let opening = allowOpening ? pickStable(OPENINGS[mode] || OPENINGS.calm, `${seed}:opening`) : '';
  if (wasUsedRecently(opening, history)) opening = '';

  const rhythm = pickStable(RHYTHMS[mode] || RHYTHMS.calm, `${seed}:rhythm`);
  const fragmentChance = ['playful', 'bold_playful', 'shy_tender'].includes(mode) && turn % 4 === 1;
  const emojiAllowance = ['gentle', 'shy_tender', 'playful', 'bold_playful'].includes(mode) ? 1 : 0;

  return {
    opening,
    rhythm,
    allowFragment: fragmentChance,
    emojiAllowance,
    avoid: recentText(history, 6).slice(-900)
  };
}
