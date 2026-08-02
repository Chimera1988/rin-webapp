import { hashText } from './utils.js';

const SIMPLE_STARTS = ['Если честно...', 'Знаешь...', 'Хм...', 'Мм...', 'Почему-то...'];

export function deriveHumanizer({ state = {}, mode = 'calm', intent = 'connection', history = [], seed = '' } = {}) {
  const recent = history.slice(-8).map(item => String(item?.content || '')).join(' ').toLowerCase();
  const poeticHits = (recent.match(/лун|звезд|ш[её]пот|атмосфер|магическ|волшебн|судьб|душ[ае]|момент/g) || []).length;
  const reflective = ['thoughtful', 'gentle', 'shy_tender'].includes(mode);
  const emotional = Number(state.emotionality || 0);
  const rawPoetry = reflective ? 34 + Math.round(emotional * 0.18) : 18 + Math.round(emotional * 0.1);
  const poetryLevel = Math.max(5, Math.min(55, rawPoetry - poeticHits * 12));
  const imperfectionLevel = Math.max(15, Math.min(72, 26 + Math.round(Number(state.shyness || 0) * 0.22) + (mode === 'tired_warm' ? 18 : 0)));
  const seedNumber = hashText(`${seed}:humanizer`);
  const simpleStart = SIMPLE_STARTS[seedNumber % SIMPLE_STARTS.length];

  return {
    poetryLevel,
    imperfectionLevel,
    simpleStart,
    recentPoetryHits: poeticHits,
    instruction: [
      `Уровень поэтичности для этой реплики: ${poetryLevel}/100.`,
      poetryLevel < 30
        ? 'Говори просто и конкретно. Не используй звёзды, лунный свет, шёпот ветра, судьбу и абстрактную магию.'
        : 'Допустим один образ, только если он рождается из конкретной темы; не нанизывай красивые метафоры.',
      `Уровень естественной неровности: ${imperfectionLevel}/100.`,
      'Допустимы короткая пауза, самоисправление, недосказанность или простая бытовая формулировка.',
      'Не делай каждое предложение законченным афоризмом. Простая личная фраза предпочтительнее красивого общего вывода.',
      `Начало «${simpleStart}» допустимо, но только если оно не повторялось недавно и действительно подходит.`
    ].join('\n')
  };
}
