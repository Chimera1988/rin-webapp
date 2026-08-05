import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCognitiveTurn, buildStateTransition, planResponse, verifyReply } from '../lib/cognition/index.js';

const closeMemory = {
  facts: { user: { name: 'Алексей', project: 'Rin' } },
  relationship: { trust: 82, closeness: 76, playfulness: 68 },
  openLoops: [
    { id: 'letter', text: 'Пользователь обещал показать письмо редактора', type: 'plan', importance: 8 }
  ]
};

test('correction becomes the active dialogue frame and response obligation', () => {
  const brain = {
    literalIntent: 'statement',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'correction', confidence: 94 },
    activeScene: { type: 'everyday', topic: 'интонация перевода', confidence: 82 },
    referents: ['active_subject'],
    ambiguity: { shouldClarify: false },
    obligations: ['Прими исправление и перестрой понимание; не защищай прежнюю трактовку.'],
    responseFocus: 'Принять исправление пользователя.'
  };
  const history = [
    { role: 'assistant', kind: 'text', content: 'Там чувствуется настороженность.' },
    { role: 'user', kind: 'text', content: 'Нет, он просто очень устал.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history[1].content, history, memory: closeMemory, brain });
  assert.equal(cognition.dialogueState.relationToPreviousTurn, 'correction');
  assert.match(cognition.dialogueState.corrections.at(-1), /очень устал/);
  assert.equal(cognition.beliefModel.correction.active, true);

  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[1].content, history });
  assert.equal(plan.goal, 'принять исправление и продолжить уже в новой фактической рамке');
  assert.equal(plan.directness, 'direct_accountable');
  assert.equal(plan.shouldAskQuestion, false);
});

test('close relationship allows confident playful tone without forcing a question', () => {
  const brain = {
    literalIntent: 'statement',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'continuation', confidence: 70 },
    activeScene: { type: 'playful_flirt', topic: 'лёгкий флирт', confidence: 86 },
    referents: ['rin', 'user'],
    ambiguity: { shouldClarify: false },
    obligations: [],
    responseFocus: 'Ответить на поддразнивание лично.'
  };
  const history = [
    { role: 'user', kind: 'text', content: 'Ты сегодня особенно красивая.' }
  ];
  const cognition = buildCognitiveTurn({ userText: history[0].content, history, memory: closeMemory, brain });
  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[0].content, history, coreDecision: { mode: 'bold_playful' } });
  assert.equal(plan.tone, 'warm_bold_playful');
  assert.equal(plan.directness, 'confident_playful');
  assert.match(plan.stance, /подкол|настойчивость/);
});

test('remembered open loop is available but not forced into a direct question turn', () => {
  const brain = {
    literalIntent: 'question',
    hiddenIntent: { type: 'none', confidence: 35 },
    relation: { type: 'new_or_followup_question', confidence: 70 },
    activeScene: { type: 'everyday', topic: 'новый вопрос', confidence: 70 },
    referents: [],
    ambiguity: { shouldClarify: false },
    obligations: ['Сначала ответь на поставленный вопрос.'],
    responseFocus: 'Ответить на вопрос.'
  };
  const history = [{ role: 'user', kind: 'text', content: 'Ты ещё не спишь?' }];
  const cognition = buildCognitiveTurn({ userText: history[0].content, history, memory: closeMemory, brain });
  assert.equal(cognition.openLoops.active[0].id, 'letter');
  assert.equal(cognition.openLoops.callback, null);
  const plan = planResponse({ cognition, brain, memory: closeMemory, userText: history[0].content, history });
  assert.equal(plan.initiative, 'none');
});

test('verifier removes an unplanned generic trailing question', () => {
  const result = verifyReply('Я ещё не сплю. А ты?', {
    plan: { shouldAskQuestion: false, delivery: 'text' },
    brain: { literalIntent: 'statement', relation: { type: 'continuation' } },
    userText: 'Я только закончил работу.'
  });
  assert.equal(result.reply, 'Я ещё не сплю.');
  assert.ok(result.repairs.includes('removed_unplanned_generic_question'));
});

test('state transition preserves a caused emotional trace and recent open loop', () => {
  const cognition = {
    beliefModel: { currentStatement: null },
    openLoops: {
      active: [{ id: 'later', subject: 'Пользователь позже покажет письмо', source: 'recent_dialogue', importance: 70 }]
    }
  };
  const coreDecision = {
    emotionalResponse: { feltEmotion: 'mild_jealousy', intensity: 45 },
    nonverbalAction: { cause: 'упоминание другой девушки', intensity: 48, expiresAfterTurns: 4 }
  };
  const transition = buildStateTransition({ cognition, coreDecision });
  assert.equal(transition.emotionalTrace.emotion, 'mild_jealousy');
  assert.match(transition.emotionalTrace.cause, /другой девушки/);
  assert.equal(transition.openLoopUpdates.length, 1);
});
