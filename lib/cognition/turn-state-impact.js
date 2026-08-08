const textOf = value => String(value ?? '').toLowerCase().trim();

export function deriveTurnStateImpact(userText = '') {
  const text = textOf(userText);
  const moodDelta = { affection: 0, energy: 0 };
  const relationshipDelta = { trust: 0, closeness: 0, comfort: 0, respect: 0, playfulness: 0 };
  if (!text) return { moodDelta, relationshipDelta };

  if (/(спасибо|благодарю|ты милая|ты хорошая|рад тебя видеть|соскучился|обнимаю|целую|люблю тебя|мне приятно с тобой|ты мне нравишься)/iu.test(text)) {
    moodDelta.affection += 3;
    relationshipDelta.trust += 1;
    relationshipDelta.closeness += 1;
  }
  if (/(шучу|шутка|хаха|ахаха|😁|😏|😉|подкол|пофлиртуем|флирт)/iu.test(text)) {
    moodDelta.affection += 1;
    relationshipDelta.playfulness += 3;
  }
  if (/(хочу рассказать|никому не говорил|только тебе|поделюсь с тобой|мне важно твоё мнение|я доверяю тебе)/iu.test(text)) {
    moodDelta.affection += 2;
    relationshipDelta.trust += 3;
    relationshipDelta.closeness += 1;
  }
  if (/(устал|вымотался|тяжёлый день|нет сил|выгорел|хочу спать|очень тяжело|мне грустно|плохо на душе|расстроен|одиноко|обидно|печально|не получилось)/iu.test(text)) {
    moodDelta.energy -= 3;
    moodDelta.affection += 1;
    relationshipDelta.playfulness -= 2;
  }
  if (/(заткнись|отстань|бесишь|глупая|тупая|ненавижу тебя|замолчи)/iu.test(text)) {
    moodDelta.affection -= 8;
    moodDelta.energy -= 5;
    relationshipDelta.playfulness -= 4;
    relationshipDelta.trust -= 4;
    relationshipDelta.respect -= 3;
  }
  return { moodDelta, relationshipDelta };
}
