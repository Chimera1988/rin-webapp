import { assistantTurns, hashText } from './utils.js';
import { chooseThreadCallback } from '../memory/conversation-threads.js';

const HEAVY_INTENTS = new Set(['support', 'comfort', 'repair', 'farewell']);
const QUESTION_LITERALS = new Set(['question']);

export function chooseInitiative({ userText = '', history = [], intent = 'connection', conversationBrain = null, rhythm = null, seed = '' } = {}) {
  const literal = conversationBrain?.literalIntent;
  const text = String(userText || '').trim();
  if (HEAVY_INTENTS.has(intent) || QUESTION_LITERALS.has(literal) || text.length < 2) {
    return { mode: 'none', reason: 'ответ пользователю важнее инициативы', instruction: 'Не открывай новую тему.' };
  }
  if (rhythm?.recommendation === 'no_question') {
    return { mode: 'none', reason: 'в недавнем ритме уже много вопросов', instruction: 'Не открывай новую тему и не задавай дополнительный вопрос.' };
  }

  const turnCount = assistantTurns(history).length;
  const roll = hashText(`${seed}:initiative`) % 100;
  const callback = chooseThreadCallback(history);

  if (callback && turnCount >= 8 && roll < 18) {
    return {
      mode: 'callback',
      thread: callback,
      reason: 'созрела незавершённая тема',
      instruction: `Можно одной короткой фразой естественно вернуться к незавершённой теме: «${callback.summary}». Не говори, что это память или сохранённая тема. Не возвращайся к ней, если текущая реплика требует прямого ответа.`
    };
  }

  if (turnCount >= 6 && roll >= 18 && roll < 28) {
    return {
      mode: 'small_observation',
      reason: 'редкая собственная инициатива',
      instruction: 'После ответа допустимо добавить один короткий след текущей жизни Рин из блока «Внутренняя жизнь»: незавершённое действие, сенсорную деталь или мимолётную мысль. Не придумывай новое событие и не задавай вопрос автоматически.'
    };
  }

  if (turnCount >= 10 && roll >= 28 && roll < 35) {
    return {
      mode: 'personal_question',
      reason: 'редкий личный интерес',
      instruction: 'После содержательного ответа можно задать один личный, но ненавязчивый вопрос, который не повторяет слова пользователя и не превращает разговор в интервью.'
    };
  }

  return { mode: 'none', reason: 'инициатива не нужна на этом ходу', instruction: 'Не добавляй новую тему ради разнообразия.' };
}
