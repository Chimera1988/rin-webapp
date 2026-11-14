import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { normalizeTurnDecision } from '../lib/cognition/turn-decision.js';
import { stabilizeTurn } from '../lib/cognition/turn-stabilizer.js';

const evt = (role, content, n) => ({
  role, content, kind: 'text', status: 'complete',
  id: `${role}-${n}`, requestId: `request-${n}`, ts: 1794632400000 + n * 1000
});
const completedProject = [
  evt('user', 'Я его закончил)', 1),
  evt('assistant', 'Отлично, проект завершён.', 2)
];

function outputFor(userText, response, history = []) {
  const behaviorState = buildBehaviorState({ userText, history });
  const decision = normalizeTurnDecision({
    act: 'answer_directly', focus: 'ответ', stance: 'спокойно',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: { mode: 'single_text', responseDepth: 'short',
      segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 300 }] },
    intentTransition: { operation: 'none' },
    openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded'
  });
  const result = stabilizeTurn({ decision, behaviorState,
    realization: { segments: [{ text: response }] }
  });
  return result.realization.segments.map(x => x.text).join(' ');
}

test('closed project remains closed during a directly related follow-up', () => {
  const state = buildBehaviorState({
    userText: 'Ооо, я так целую неделю работал 😅', history: completedProject
  });
  assert.equal(state.topicProgress.completed, true);
});

test('explicitly unfinished work is never marked finished', () => {
  assert.equal(buildBehaviorState({userText:'Я не закончил проект',history:completedProject}).topicProgress.completed, false);
});

test('a new project is not confused with a completed old one', () => {
  const state = buildBehaviorState({
    userText: 'А теперь начал новый проект', history: completedProject
  });
  assert.equal(state.topicProgress.completed, false);
});

test('an unrelated subject does not inherit completion', () => {
  const state = buildBehaviorState({
    userText: 'Хочу посмотреть новый фильм', history: completedProject
  });
  assert.equal(state.topicProgress.completed, false);
});

test('old completion is not carried beyond a short related window', () => {
  const history = [...completedProject,
    evt('user', 'Какая сегодня погода?', 3), evt('assistant', 'Облачно.', 4),
    evt('user', 'Какое кино посмотреть?', 5), evt('assistant', 'Комедию.', 6),
    evt('user', 'Посоветуй книгу', 7), evt('assistant', 'Рассказы.', 8)
  ];
  assert.equal(buildBehaviorState({userText:'Сегодня работал',history}).topicProgress.completed, false);
});

test('explicit no-questions boundary recognizes optional pronoun', () => {
  const state = buildBehaviorState({ userText: 'Не задавай мне вопросов' });
  assert.equal(state.question.strongNoQuestion, true);
});

test('boundary is not triggered by an ordinary question', () => {
  assert.equal(buildBehaviorState({userText: 'Можно задать мне вопрос?'}).question.strongNoQuestion, false);
});

test('explicit question boundary strips the question but keeps a statement', () => {
  const answer = outputFor('Не задавай мне вопросов', 'Я рядом. Что тебя сегодня радует?');
  assert.equal(answer, 'Я рядом.');
});

test('question boundary preserves statements surrounding a stray question', () => {
  const answer = outputFor('Без вопросов', 'Я тут. Что нового? Можем просто поговорить.');
  assert.equal(answer, 'Я тут. Можем просто поговорить.');
});

test('question-only reply gets a harmless short fallback at strong boundary', () => {
  const answer = outputFor('Не задавай мне вопросов', 'Как день?');
  assert.equal(answer, 'Я тебя услышала.');
});

test('without a question boundary Rin may still ask naturally', () => {
  const answer = outputFor('Как дела?', 'Хорошо. А у тебя?');
  assert.equal(answer, 'Хорошо. А у тебя?');
});
