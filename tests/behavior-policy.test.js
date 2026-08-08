import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBehaviorPolicy } from '../lib/cognition/behavior-policy.js';
import { buildAffectiveTurn } from '../lib/cognition/emotional-state.js';

function closeMemory(overrides = {}) {
  return {
    mood: { affection: 72, energy: 58, label: 'радостная' },
    relationship: {
      trust: 82, closeness: 76, comfort: 72, respect: 80,
      playfulness: 68, attraction: 58, vulnerability: 42,
      recentDynamic: { lastSignal: 'neutral', positiveStreak: 0, negativeStreak: 0, repairPending: false, lastCause: '', turn: 0 }
    },
    conversationState: { revision: 0, emotionalState: null },
    openLoops: [],
    ...overrides
  };
}

function brain({ scene = 'everyday', hidden = 'none', literal = 'statement', relation = 'continuation', ambiguity = false } = {}) {
  return {
    literalIntent: literal,
    hiddenIntent: { type: hidden, confidence: 84 },
    relation: { type: relation, confidence: 82 },
    activeScene: { type: scene, topic: 'текущая личная тема', confidence: 86, goal: 'сохранить текущую линию' },
    ambiguity: { shouldClarify: ambiguity, level: ambiguity ? 90 : 0 },
    obligations: [],
    responseFocus: 'Ответить лично и сохранить текущую линию.'
  };
}

function cognition({ scene = 'everyday', reactiveStreak = 0, questionStreak = 0, turnsInScene = 4, callback = null } = {}) {
  return {
    dialogueState: {
      scene, sceneGoal: 'сохранить текущую линию', continuityStrength: 0.9,
      reactiveStreak, questionStreak, turnsInScene, topicDrift: false,
      explicitReplyTarget: null, openHook: null
    },
    openLoops: { active: callback ? [callback] : [], callback },
    beliefModel: { factsToUse: [], factsToAvoid: [] }
  };
}

function withAffective(memory, turn) {
  return {
    ...memory,
    mood: turn.moodState,
    relationship: turn.relationshipState,
    conversationState: {
      ...(memory.conversationState || {}),
      revision: turn.turn,
      emotionalState: turn.emotionalState
    }
  };
}

test('romantic rival becomes indirect jealousy with a zero question budget', () => {
  const memory = closeMemory();
  const b = brain({ scene: 'romance' });
  const text = 'Меня пригласила девушка на встречу вечером';
  const affectiveTurn = buildAffectiveTurn({ userText: text, memory, brain: b });
  const policy = deriveBehaviorPolicy({
    cognition: cognition({ scene: 'romance' }), brain: b, memory, userText: text, history: [],
    coreDecision: { affectiveTurn, initiative: { mode: 'personal_question' } }
  });

  assert.equal(policy.responseAct, 'contained_jealousy');
  assert.equal(policy.action, 'tease');
  assert.equal(policy.emotionalExpression, 'indirect');
  assert.equal(policy.distance, 'slightly_withdrawn');
  assert.equal(policy.questionBudget, 0);
  assert.equal(policy.initiative, 'emotional_stance');
  assert.notEqual(policy.initiative, 'personal_question');
});

test('direct question about Rin emotion names the active emotion without asking back', () => {
  let memory = closeMemory();
  const rivalBrain = brain({ scene: 'romance' });
  const rival = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: rivalBrain });
  memory = withAffective(memory, rival);

  const text = 'Ты ревнуешь?';
  const b = brain({ scene: 'romance', literal: 'question' });
  const turn = buildAffectiveTurn({ userText: text, memory, brain: b });
  const policy = deriveBehaviorPolicy({
    cognition: cognition({ scene: 'romance' }), brain: b, memory, userText: text, history: [],
    coreDecision: { affectiveTurn: turn }
  });

  assert.equal(policy.responseAct, 'name_emotion_if_asked');
  assert.equal(policy.action, 'disclose');
  assert.equal(policy.emotionalExpression, 'direct_if_asked');
  assert.equal(policy.questionBudget, 0);
});

test('tease reveal outranks lexical correction markers and keeps the emotional game active', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: brain({ scene: 'romance' }) });
  memory = withAffective(memory, rival);
  const text = 'Вообще-то это была шутка) Проверил тебя на ревность 😅';
  const b = brain({ scene: 'playful_flirt', relation: 'correction' });
  const reveal = buildAffectiveTurn({ userText: text, memory, brain: b });
  const policy = deriveBehaviorPolicy({
    cognition: cognition({ scene: 'playful_flirt' }), brain: b, memory, userText: text,
    history: [], coreDecision: { affectiveTurn: reveal }
  });

  assert.equal(reveal.signal.type, 'tease_reveal');
  assert.equal(reveal.emotionalState.primary.type, 'playful_irritation');
  assert.equal(policy.responseAct, 'carry_playful_tension');
  assert.equal(policy.action, 'continue_scene');
  assert.equal(policy.questionBudget, 0);
});

test('playful challenge stays in the scene instead of collapsing into generic question-answering', () => {
  let memory = closeMemory();
  const rival = buildAffectiveTurn({ userText: 'Меня пригласила девушка на встречу вечером', memory, brain: brain({ scene: 'romance' }) });
  memory = withAffective(memory, rival);
  const reveal = buildAffectiveTurn({ userText: 'Шутка, хотел проверить тебя на ревность 😁', memory, brain: brain({ scene: 'playful_flirt', hidden: 'continue_playful_tension' }) });
  memory = withAffective(memory, reveal);
  const challengeText = 'Ну и где?) Ты будешь меня смущать???)';
  const b = brain({ scene: 'playful_flirt', literal: 'question' });
  const challenge = buildAffectiveTurn({ userText: challengeText, memory, brain: b });
  const policy = deriveBehaviorPolicy({
    cognition: cognition({ scene: 'playful_flirt' }), brain: b, memory, userText: challengeText,
    history: [], coreDecision: { affectiveTurn: challenge }
  });

  assert.equal(challenge.signal.type, 'playful_challenge');
  assert.equal(policy.responseAct, 'carry_playful_tension');
  assert.equal(policy.action, 'continue_scene');
  assert.equal(policy.initiative, 'carry_playful_tension');
  assert.equal(policy.questionBudget, 0);
});

test('critical ambiguity is the only ordinary path that requires a clarification question', () => {
  const memory = closeMemory();
  const text = 'Это связано с ним.';
  const b = brain({ ambiguity: true });
  const policy = deriveBehaviorPolicy({ cognition: cognition(), brain: b, memory, userText: text, history: [] });
  assert.equal(policy.responseAct, 'clarify_critical_ambiguity');
  assert.equal(policy.action, 'clarify');
  assert.equal(policy.questionBudget, 1);
  assert.equal(policy.initiative, 'none');
});

test('reactive streak makes Rin contribute something of her own without converting it into a question', () => {
  const memory = closeMemory();
  const text = 'Сегодня наконец закончил сложный кусок проекта и выдохнул.';
  const b = brain();
  const policy = deriveBehaviorPolicy({
    cognition: cognition({ reactiveStreak: 3, turnsInScene: 6 }), brain: b, memory, userText: text,
    history: [
      { role: 'assistant', kind: 'text', content: 'Поняла.' },
      { role: 'assistant', kind: 'text', content: 'Угу.' }
    ]
  });
  assert.equal(policy.initiative, 'personal_observation');
  assert.ok(policy.initiativeStrength >= 70);
  assert.equal(policy.questionBudget, 0);
});

test('rare personal question is deterministic and is suppressed by a recent assistant question', () => {
  const memory = closeMemory();
  const baseHistory = Array.from({ length: 5 }, (_, index) => ({ role: 'assistant', kind: 'text', content: `Личная реплика ${index}.` }));
  const b = brain();
  let found = null;
  for (let index = 0; index < 500; index += 1) {
    const text = `Сегодня закончил важную часть проекта и выбрал следующий шаг номер ${index}.`;
    const policy = deriveBehaviorPolicy({ cognition: cognition({ turnsInScene: 6 }), brain: b, memory, userText: text, history: baseHistory });
    if (policy.initiative === 'specific_personal_question') {
      found = { text, policy };
      break;
    }
  }
  assert.ok(found, 'deterministic rare-question branch should be reachable');
  assert.equal(found.policy.questionBudget, 1);

  const withRecentQuestion = baseHistory.map((item, index) => index === baseHistory.length - 1
    ? { ...item, content: 'И что ты решил?' }
    : item);
  const suppressed = deriveBehaviorPolicy({
    cognition: cognition({ turnsInScene: 6 }), brain: b, memory, userText: found.text, history: withRecentQuestion
  });
  assert.equal(suppressed.questionBudget, 0);
  assert.notEqual(suppressed.initiative, 'specific_personal_question');
});

test('a 24-turn ordinary sequence cannot degenerate into a question-after-every-answer loop', () => {
  const memory = closeMemory();
  const b = brain();
  const history = [];
  let questionTurns = 0;
  let previousWasQuestion = false;

  for (let index = 0; index < 24; index += 1) {
    const text = `Сегодня разбирался с проектом, заметил интересную деталь и закончил этап номер ${index}.`;
    history.push({ role: 'user', kind: 'text', content: text, id: `u${index}` });
    const policy = deriveBehaviorPolicy({
      cognition: cognition({ turnsInScene: Math.min(9, index + 1) }), brain: b, memory, userText: text, history
    });
    if (policy.questionBudget > 0) {
      questionTurns += 1;
      assert.equal(previousWasQuestion, false, 'question policy must not schedule consecutive assistant questions');
      previousWasQuestion = true;
      history.push({ role: 'assistant', kind: 'text', content: 'Какую именно деталь ты решил оставить?', id: `a${index}` });
    } else {
      previousWasQuestion = false;
      history.push({ role: 'assistant', kind: 'text', content: 'Мм. Это уже похоже на нормальный прогресс.', id: `a${index}` });
    }
  }

  assert.ok(questionTurns <= 4, `expected sparse questions, got ${questionTurns}/24`);
});
