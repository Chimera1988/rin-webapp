import { hashText } from './utils.js';

const SIMPLE_STARTS = ['Если честно...', 'Знаешь...', 'Хм...', 'Мм...', 'Почему-то...', 'Ой, кстати...', 'Хотя нет, точнее...'];

const CASUAL_RE = /\b(?:чай|кофе|еда|ужин|завтрак|музык|песн|фильм|сериал|гуля|прогул|устал|работ|сон|погод|книг)\w*/i;

export function deriveHumanizer({ state = {}, mode = 'calm', intent = 'connection', history = [], seed = '', userText = '', rhythm = null } = {}) {
  const recent = history.slice(-8).map(item => String(item?.content || '')).join(' ').toLowerCase();
  const poeticHits = (recent.match(/лун|звезд|ш[её]пот|атмосфер|магическ|волшебн|судьб|душ[ае]|момент/g) || []).length;
  const reflective = ['thoughtful', 'gentle', 'shy_tender'].includes(mode);
  const emotional = Number(state.emotionality || 0);
  const rawPoetry = reflective ? 34 + Math.round(emotional * 0.18) : 18 + Math.round(emotional * 0.1);
  const casualTopic = CASUAL_RE.test(String(userText || ''));
  const rhythmPenalty = rhythm?.recommendation === 'casual_concrete' ? 14 : 0;
  const poetryLevel = Math.max(5, Math.min(55, rawPoetry - poeticHits * 12 - (casualTopic ? 12 : 0) - rhythmPenalty));
  const imperfectionLevel = Math.max(15, Math.min(72, 26 + Math.round(Number(state.shyness || 0) * 0.22) + (mode === 'tired_warm' ? 18 : 0)));
  const seedNumber = hashText(`${seed}:humanizer`);
  const simpleStart = SIMPLE_STARTS[seedNumber % SIMPLE_STARTS.length];

  const speechRegister = poetryLevel < 22 ? 'casual' : poetryLevel < 36 ? 'plain_warm' : 'warm';

  return {
    poetryLevel,
    speechRegister,
    imperfectionLevel,
    simpleStart,
    recentPoetryHits: poeticHits,
    instruction: [
      `Речевой регистр: ${speechRegister}. Уровень поэтичности для этой реплики: ${poetryLevel}/100.`,
      poetryLevel < 30
        ? 'Говори просто и конкретно. Не используй звёзды, лунный свет, шёпот ветра, судьбу и абстрактную магию.'
        : 'Допустим один образ, только если он рождается из конкретной темы; не нанизывай красивые метафоры.',
      `Уровень естественной неровности: ${imperfectionLevel}/100.`,
      'Допустимы короткая пауза, самоисправление, недосказанность или простая бытовая формулировка.',
      casualTopic ? 'Тема бытовая: отвечай как в обычной переписке. Лучше «главное, чтобы не горчил» или «теперь тоже захотелось чая», чем метафора.' : 'Не добавляй бытовую простоту искусственно, если момент эмоционально важный.',
      'Не делай каждое предложение законченным афоризмом. Простая личная фраза предпочтительнее красивого общего вывода.',
      'Не называй эмоцию формально, когда её можно показать реакцией: вместо «это приятно/мило/заманчиво» чаще скажи «улыбнулась», «иди сюда», «мне нравится», «тогда договорились» — только когда это подходит по смыслу.',
      'Не повторяй структуру «оценка ситуации + общий вывод». В коротком чате допустим ответ без объяснения.',
      'Избегай дежурных ответов «приятно это слышать», «рада это знать», «надеюсь, день будет приятным», «такие моменты ценны». Подхвати конкретное слово, жест или настроение пользователя.',
      'Если пользователь дарит поцелуй, объятие или комплимент, отвечай на сам жест, а не описывай, что он приятен.',
      `Начало «${simpleStart}» допустимо, но только если оно не повторялось недавно и действительно подходит.`
    ].join('\n')
  };
}
