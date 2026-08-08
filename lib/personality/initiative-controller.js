import { assistantTurns, hashText } from './utils.js';

const HEAVY_INTENTS = new Set(['support', 'comfort', 'repair', 'farewell']);

export function chooseInitiative({ userText = '', history = [], intent = 'connection', conversationBrain = null, rhythm = null, seed = '' } = {}) {
  const literal = conversationBrain?.literalIntent;
  const hidden = conversationBrain?.hiddenIntent?.type || 'none';
  const scene = conversationBrain?.activeScene?.type || 'everyday';
  const reactiveStreak = Number(conversationBrain?.activeScene?.reactiveStreak) || 0;
  const text = String(userText || '').trim();

  if (hidden === 'invite_rin_initiative') {
    return {
      mode: 'take_lead',
      reason: 'пользователь прямо передал инициативу Рин',
      instruction: 'Сама сделай следующий игровой ход. Не спрашивай разрешения, не говори «могу немного пофлиртовать» и не возвращай выбор пользователю.'
    };
  }
  if (hidden === 'reclaim_playful_scene' || (scene === 'playful_flirt' && conversationBrain?.activeScene?.topicDrift)) {
    return {
      mode: 'reclaim_scene',
      reason: 'игривая сцена ушла в мета-разговор',
      instruction: 'Коротко верни игру действием: дразнилкой, условием или уверенным приглашением. Не продолжай философское обсуждение флирта.'
    };
  }
  if (hidden === 'continue_playful_tension') {
    return {
      mode: 'tease_and_advance',
      reason: 'пользователь ждёт следующего хода Рин',
      instruction: 'Продвинь игру сама и оставь лёгкое напряжение. Не анализируй нетерпение пользователя со стороны.'
    };
  }
  if (scene === 'playful_flirt' && reactiveStreak >= 2) {
    return {
      mode: 'take_lead',
      reason: 'Рин слишком долго только отражала пользователя',
      instruction: 'На этом ходу Рин должна сделать собственный игровой ход без встречного вопроса.'
    };
  }

  if (HEAVY_INTENTS.has(intent) || (literal === 'question' && scene !== 'playful_flirt') || text.length < 2) {
    return { mode: 'none', reason: 'прямой ответ пользователю важнее дополнительной инициативы', instruction: 'Не открывай новую тему.' };
  }
  if (rhythm?.recommendation === 'no_question') {
    return { mode: 'none', reason: 'в недавнем ритме уже много вопросов', instruction: 'Не открывай новую тему и не задавай дополнительный вопрос.' };
  }

  const turnCount = assistantTurns(history).length;
  const roll = hashText(`${seed}:initiative`) % 100;
  if (turnCount >= 5 && roll >= 14 && roll < 30) {
    return {
      mode: 'small_observation',
      reason: 'собственная реакция Рин внутри текущей темы',
      instruction: 'После ответа добавь одну конкретную собственную мысль, предпочтение или маленькую деталь Рин, связанную с темой. Не открывай случайную новую тему и не задавай вопрос автоматически.'
    };
  }

  if (turnCount >= 9 && roll >= 30 && roll < 37) {
    return {
      mode: 'personal_question',
      reason: 'редкий личный интерес',
      instruction: 'После содержательного ответа можно задать один конкретный личный вопрос, который не повторяет слова пользователя и не превращает разговор в интервью.'
    };
  }

  return { mode: 'none', reason: 'дополнительная инициатива не нужна на этом ходу', instruction: 'Не добавляй новую тему ради разнообразия. Локальная позиция Рин внутри текущей сцены всё равно обязательна.' };
}
