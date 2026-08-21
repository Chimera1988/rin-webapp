const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const QUESTION_BOUNDARY_RE = /(?:хватит|довольно|не надо|не нужно|перестань|не задавай|без|поменьше|меньше|давай без|оставь)\s+(?:этих\s+|столько\s+|пока\s+)?вопрос(?:ов|ы|ами)?|(?:вопрос(?:ов|ы|ами)?)\s+(?:хватит|довольно|не надо|не нужно|поменьше|меньше)|(?:не\s+расспрашивай|не\s+допрашивай|без\s+допроса)/iu;
const QUESTION_RESUME_RE = /(?:можешь\s+(?:снова\s+)?спрашивать|задавай\s+вопросы|спрашивай\s+(?:что\s+хочешь|дальше|меня)|можешь\s+задавать\s+вопросы)/iu;
const SPACE_RE = /(?:оставь\s+меня\s+на\s+время|хочу\s+побыть\s+один|мне\s+нужно\s+пространство|давай\s+помолчим|не\s+хочу\s+сейчас\s+говорить)/iu;
const KEEP_TALKING_RE = /(?:не\s+молчи|поговори\s+со\s+мной|продолжай\s+говорить|давай\s+пообщаемся)/iu;

function isAssistantQuestionTurn(messages = []) {
  return messages.some(message => /\?/u.test(String(message?.content || '')));
}

function assistantTurns(history = []) {
  const turns = [];
  const byKey = new Map();
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== 'assistant') continue;
    const key = clean(message.turnId || message.requestId || message.id, 140) || `assistant-${turns.length}`;
    let turn = byKey.get(key);
    if (!turn) {
      turn = { key, messages: [] };
      byKey.set(key, turn);
      turns.push(turn);
    }
    turn.messages.push(message);
  }
  return turns;
}

function recentBoundary(history = [], currentUserText = '') {
  const events = [];
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== 'user' || !message?.content) continue;
    const text = clean(message.content, 1200);
    if (QUESTION_BOUNDARY_RE.test(text)) events.push({ type: 'question_stop', id: message.id || null });
    if (QUESTION_RESUME_RE.test(text)) events.push({ type: 'question_resume', id: message.id || null });
    if (SPACE_RE.test(text)) events.push({ type: 'space', id: message.id || null });
    if (KEEP_TALKING_RE.test(text)) events.push({ type: 'contact', id: message.id || null });
  }
  const current = clean(currentUserText, 1200);
  if (current) {
    if (QUESTION_BOUNDARY_RE.test(current)) events.push({ type: 'question_stop', id: '__current__' });
    if (QUESTION_RESUME_RE.test(current)) events.push({ type: 'question_resume', id: '__current__' });
    if (SPACE_RE.test(current)) events.push({ type: 'space', id: '__current__' });
    if (KEEP_TALKING_RE.test(current)) events.push({ type: 'contact', id: '__current__' });
  }
  return events.at(-1) || null;
}

function questionFatigue(history = []) {
  const turns = assistantTurns(history).slice(-7);
  if (!turns.length) return { score: 0, streak: 0, recentQuestionTurns: 0, sampleTurns: 0 };
  const flags = turns.map(turn => isAssistantQuestionTurn(turn.messages));
  let streak = 0;
  for (let index = flags.length - 1; index >= 0 && flags[index]; index -= 1) streak += 1;
  const recentQuestionTurns = flags.filter(Boolean).length;
  const ratio = recentQuestionTurns / flags.length;
  const score = clamp(ratio * 58 + streak * 14, 0, 100);
  return { score, streak, recentQuestionTurns, sampleTurns: flags.length };
}

function turnsSinceBoundary(history = [], boundaryType = 'question_stop') {
  const list = Array.isArray(history) ? history : [];
  let markerIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role !== 'user') continue;
    const text = String(message?.content || '');
    const matches = boundaryType === 'question_stop' ? QUESTION_BOUNDARY_RE.test(text) : SPACE_RE.test(text);
    if (matches) { markerIndex = index; break; }
  }
  if (markerIndex < 0) return null;
  const seen = new Set();
  for (let index = markerIndex + 1; index < list.length; index += 1) {
    const message = list[index];
    if (message?.role !== 'assistant') continue;
    seen.add(clean(message.turnId || message.requestId || message.id, 140) || `idx-${index}`);
  }
  return seen.size;
}

export function buildBehaviorState({ userText = '', history = [], brain = null } = {}) {
  const text = clean(userText, 1600);
  const fatigue = questionFatigue(history);
  const latestBoundary = recentBoundary(history, text);
  const currentQuestionBoundary = QUESTION_BOUNDARY_RE.test(text);
  const currentResume = QUESTION_RESUME_RE.test(text);
  const currentSpace = SPACE_RE.test(text);
  const currentContact = KEEP_TALKING_RE.test(text);

  const sinceQuestionStop = turnsSinceBoundary(history, 'question_stop');
  const sinceSpace = turnsSinceBoundary(history, 'space');
  const inheritedQuestionBoundary = !currentResume
    && latestBoundary?.type === 'question_stop'
    && sinceQuestionStop != null
    && sinceQuestionStop <= 4;
  const inheritedSpace = !currentContact
    && latestBoundary?.type === 'space'
    && sinceSpace != null
    && sinceSpace <= 2;

  const boundaryPressure = currentQuestionBoundary
    ? 100
    : inheritedQuestionBoundary
      ? clamp(88 - (sinceQuestionStop || 0) * 18, 28, 88)
      : 0;
  const questionRestraint = currentResume ? 0 : clamp(Math.max(fatigue.score, boundaryPressure));
  const noQuestionStrong = currentQuestionBoundary || boundaryPressure >= 72;
  const spacePressure = currentSpace
    ? 100
    : inheritedSpace
      ? clamp(80 - (sinceSpace || 0) * 28, 20, 80)
      : 0;

  return {
    schema: 'rin-behavior-state-v1',
    explicitBoundary: {
      noQuestions: currentQuestionBoundary,
      resumeQuestions: currentResume,
      wantsSpace: currentSpace,
      wantsContact: currentContact
    },
    question: {
      fatigue: fatigue.score,
      recentQuestionTurns: fatigue.recentQuestionTurns,
      sampleTurns: fatigue.sampleTurns,
      streak: fatigue.streak,
      boundaryPressure,
      restraint: questionRestraint,
      strongNoQuestion: noQuestionStrong,
      guidance: noQuestionStrong
        ? 'Не инициировать сбор новой информации. Можно реагировать, шутить, делиться или завершить ход без вопроса.'
        : questionRestraint >= 55
          ? 'Снизить частоту вопросов; вопрос только при реальном личном интересе и хорошем якоре.'
          : 'Вопрос допустим только если он естественно следует из интереса Рин, а не ради поддержания диалога.'
    },
    space: {
      pressure: spacePressure,
      strong: spacePressure >= 72,
      guidance: spacePressure >= 72
        ? 'Уважить запрос на пространство: короткий ненавязчивый ответ или осознанная пауза предпочтительнее продолжения темы.'
        : 'Обычный уровень контакта.'
    },
    relationSignal: clean(brain?.relation?.type, 100) || null,
    hiddenIntent: clean(brain?.hiddenIntent?.type, 100) || null
  };
}

export const behaviorPatterns = Object.freeze({
  QUESTION_BOUNDARY_RE,
  QUESTION_RESUME_RE,
  SPACE_RE,
  KEEP_TALKING_RE
});
