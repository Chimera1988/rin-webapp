const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const DIRECT_HANDOFF = /(?:можешь\s+начинать|(?:^|[\s,.!?…])начинай(?:[\s,.!?…]|$)|твой\s+ход|твоя\s+очередь|теперь\s+ты|удиви\s+меня|поприста|пристава|давай\s+пофлирт|пофлиртуем)/iu;
const FOLLOW_THROUGH = /(?:мы\s+(?:начн[её]м|начинаем)\s*(?:или\s+нет)?|(?:начн[её]м|начинаем)\s+или\s+нет|ты\s+(?:начн[её]шь|начинаешь)\s*(?:или\s+нет)?|так\s+(?:начинаем|начн[её]м|ты\s+начн[её]шь)|ну\s+(?:начинаем|начинай)|когда\s+(?:начн[её]м|начинаем)|давай\s+уже|ну\s+же|поехали\s+уже)/iu;
const WAITING_FOR_MOVE = /(?:весь\s+в\s+нетерпении|жду,?\s+когда|я\s+жду|ты\s+же\s+обещала|ты\s+обещала)/iu;
const PLAYFUL_CONTEXT = /(?:флирт|игр(?:а|у|ой|ы)|игрив|дразн|смущ|чары|кицунэ|поприста|пристава|твоя\s+очередь|твой\s+ход|можешь\s+начинать|начинай|готовься|приготовься|держись|пристегни\s+ремни|😉|😏)/iu;

function contextIsInteractive({ scene = '', previousAssistant = '', recentText = '' } = {}) {
  if (['playful_flirt', 'romance'].includes(String(scene || ''))) return true;
  return PLAYFUL_CONTEXT.test(`${clean(previousAssistant)} ${clean(recentText)}`);
}

export function detectInitiativeHandoff(value = '', context = {}) {
  const text = clean(value);
  if (!text) return { active: false, kind: 'none', confidence: 0, reason: 'пустая реплика' };

  if (DIRECT_HANDOFF.test(text)) {
    return {
      active: true,
      kind: 'explicit_handoff',
      confidence: 96,
      reason: 'пользователь прямо передаёт следующий ход Рин'
    };
  }

  const interactive = contextIsInteractive(context);
  if (interactive && FOLLOW_THROUGH.test(text)) {
    return {
      active: true,
      kind: 'follow_through',
      confidence: 94,
      reason: 'пользователь требует выполнить уже обещанный или начатый самостоятельный ход'
    };
  }

  if (interactive && WAITING_FOR_MOVE.test(text)) {
    return {
      active: true,
      kind: 'waiting_for_move',
      confidence: 90,
      reason: 'пользователь ждёт конкретного следующего хода Рин, а не объяснения намерения'
    };
  }

  return { active: false, kind: 'none', confidence: 0, reason: 'передача инициативы не обнаружена' };
}

export function isInitiativeHandoff(value = '', context = {}) {
  return detectInitiativeHandoff(value, context).active;
}
