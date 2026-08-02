import { assistantTurns, hashText } from './utils.js';

function count(items, re) {
  return items.reduce((n, item) => n + (re.test(String(item?.content || '')) ? 1 : 0), 0);
}

export function analyzeRecentRhythm(history = [], seed = '') {
  const recent = assistantTurns(history).slice(-8);
  const texts = recent.map(x => String(x?.content || '').trim()).filter(Boolean);
  const questions = count(recent, /\?/);
  const longReplies = texts.filter(t => t.length > 220).length;
  const shortReplies = texts.filter(t => t.length <= 55).length;
  const poeticReplies = texts.filter(t => /лун|зв[её]зд|ш[её]пот|атмосфер|волшеб|магическ|душ[ае]|момент|судьб/i.test(t)).length;
  const openings = texts.map(t => (t.split(/[.!?…]/)[0] || '').toLowerCase().slice(0, 40));
  const repeatedOpenings = openings.length - new Set(openings).size;
  const seedNumber = hashText(`${seed}:rhythm`);

  let recommendation = 'balanced';
  if (questions >= 3) recommendation = 'no_question';
  else if (longReplies >= 4) recommendation = 'short_plain';
  else if (poeticReplies >= 2) recommendation = 'casual_concrete';
  else if (shortReplies >= 5) recommendation = 'one_personal_detail';
  else if (repeatedOpenings >= 2) recommendation = 'fresh_opening';
  else if (seedNumber % 7 === 0) recommendation = 'brief_spontaneous';

  const instructions = {
    balanced: 'Сохрани естественный ритм текущей сцены.',
    no_question: 'В последних ответах было много вопросов. Сейчас не задавай вопрос; отреагируй, поделись деталью или мягко остановись.',
    short_plain: 'Последние ответы были длинными. Ответь короче и бытовее, максимум двумя предложениями.',
    casual_concrete: 'Недавно было достаточно красивых формулировок. Сейчас используй простые конкретные слова без метафор.',
    one_personal_detail: 'Последние ответы были слишком короткими. Добавь одну маленькую личную деталь Рин, но не лекцию.',
    fresh_opening: 'Не повторяй привычное начало. Начни сразу с сути или с новой естественной реакции.',
    brief_spontaneous: 'Допустима короткая спонтанная реакция или небольшое наблюдение, будто оно возникло прямо сейчас.'
  };

  return {
    questions,
    longReplies,
    shortReplies,
    poeticReplies,
    repeatedOpenings,
    recommendation,
    instruction: instructions[recommendation]
  };
}
