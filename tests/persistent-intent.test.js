import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePersistentIntent } from '../lib/cognition/persistent-intent.js';
import { normalizeRinIntent } from '../lib/intent-contract.js';
import { deriveBehaviorPolicy } from '../lib/cognition/behavior-policy.js';
import { verifyReply } from '../lib/cognition/response-verifier.js';

const playfulCandidate = {
  desire: 'continue_playful_tension',
  move: 'tease_or_advance',
  strength: 86,
  reason: 'игровая линия уже начата'
};
const playfulState = { scene: 'playful_flirt', lastRinAction: { kind: 'text', meaning: 'Не выкручивайся — сам начал.', cause: 'playful' }, reactiveStreak: 0, questionStreak: 0 };
const baseBrain = { literalIntent: 'statement', relation: { type: 'continuation' }, hiddenIntent: { type: 'none' }, activeScene: { type: 'playful_flirt' }, ambiguity: { shouldClarify: false } };

function memoryWith(intent = null, revision = 10) {
  return { conversationState: { revision, rinIntent: intent }, relationship: { trust: 75, closeness: 72, playfulness: 70 }, mood: { affection: 75 } };
}

test('playful candidate becomes a committed multi-turn Rin intent', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  assert.equal(first.status, 'active');
  assert.equal(first.turnCount, 1);
  assert.equal(first.minTurns, 2);
  assert.equal(first.maxTurns, 4);
  assert.match(first.goal, /игровую линию/iu);
  assert.equal(first.nextMove, 'tease_or_advance');
});

test('supportive user turn advances the same intent instead of replacing it', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  const second = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Как же из таких объятий выкручиваться 😏' });
  assert.equal(second.id, first.id);
  assert.equal(second.status, 'active');
  assert.ok(second.progress > first.progress);
  assert.equal(second.turnCount, first.turnCount + 1);
});

test('direct question temporarily takes priority without deleting active intent', () => {
  const first = normalizeRinIntent({ ...advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' }), progress: 0.25 });
  const questionBrain = { ...baseBrain, literalIntent: 'question', relation: { type: 'new_or_followup_question' } };
  const next = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: questionBrain, userText: 'А почему ты так сказала?' });
  assert.equal(next.id, first.id);
  assert.equal(next.status, 'active');
  assert.equal(next.nextMove, 'answer_obligation_then_resume');
});

test('explicit stop cancels the intent and farewell cannot resurrect it', () => {
  const first = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ну и где?)' });
  const cancelled = advancePersistentIntent({ memory: memoryWith(first, 11), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Хватит, давай сменим тему' });
  assert.equal(cancelled.status, 'cancelled');
  const farewell = advancePersistentIntent({ memory: memoryWith(cancelled, 12), characterIntent: playfulCandidate, dialogueState: playfulState, brain: { ...baseBrain, literalIntent: 'farewell' }, userText: 'Спокойной ночи' });
  assert.equal(farewell, null);
});

test('persistent intent expires after bounded number of turns instead of becoming obsessive', () => {
  let intent = advancePersistentIntent({ memory: memoryWith(null), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Давай)' });
  for (let revision = 11; revision <= 15 && intent?.status === 'active'; revision += 1) {
    intent = advancePersistentIntent({ memory: memoryWith(intent, revision), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText: 'Ага 😏' });
  }
  assert.equal(intent.status, 'completed');
  assert.match(intent.completionReason, /достаточно|продвинута/iu);
});

test('behavior policy advances an active intent and keeps question budget at zero', () => {
  const intent = normalizeRinIntent({ goal: 'продвинуть уже начатую игровую линию собственным ходом Рин', motive: 'play', target: 'shared_playful_scene', scene: 'playful_flirt', priority: 86, commitment: 82, progress: .35, nextMove: 'tease_or_advance', startedAtTurn: 10, updatedAtTurn: 10, turnCount: 1, minTurns: 2, maxTurns: 4, status: 'active' });
  const policy = deriveBehaviorPolicy({
    cognition: { dialogueState: playfulState }, brain: baseBrain,
    coreDecision: { affectiveTurn: { emotionalState: { primary: { type: 'playfulness' }, momentum: { direction: 'steady' } }, relationshipState: { trust:75, closeness:72, playfulness:70 }, moodState: { affection:75 } } },
    memory: memoryWith(intent), userText: 'Да я и не собирался выкручиваться)', history: [{ role:'assistant', kind:'text', content:'Не выкручивайся — сам начал.' }, { role:'user', kind:'text', content:'Да я и не собирался выкручиваться)' }]
  });
  assert.ok(['advance_persistent_intent','playful_stance','carry_playful_tension','tease_and_advance','advance_play'].includes(policy.responseAct));
  assert.equal(policy.persistentIntent.status, 'active');
  assert.equal(policy.persistentIntent.id, intent.id);
  assert.ok(policy.persistentIntent.progress > intent.progress);
  assert.equal(policy.questionBudget, 0);
});

test('verifier rejects generic topic handoff while Rin has an unfinished goal', () => {
  const intent = normalizeRinIntent({ goal:'продвинуть игровую линию', scene:'playful_flirt', commitment:80, progress:.4, nextMove:'tease_or_advance', status:'active', startedAtTurn:2, updatedAtTurn:3, turnCount:1, minTurns:2, maxTurns:4 });
  const result = verifyReply('Давай просто поболтаем. О чём хочешь поговорить?', { plan: { responseAct:'advance_persistent_intent', questionBudget:0, rinIntent:intent }, brain: baseBrain, userText:'Ну хорошо)' });
  assert.equal(result.needsRewrite, true);
  assert.ok(result.warnings.includes('persistent_intent_abandoned'));
});


test('completed or cancelled intent does not immediately resurrect from the same scene candidate', () => {
  const completed = normalizeRinIntent({ goal:'продвинуть уже начатую игровую линию собственным ходом Рин', motive:'play', target:'shared_playful_scene', scene:'playful_flirt', priority:86, commitment:80, progress:.9, nextMove:'tease_or_advance', startedAtTurn:8, updatedAtTurn:10, turnCount:4, minTurns:2, maxTurns:4, status:'completed', completionReason:'done' });
  const next = advancePersistentIntent({ memory: memoryWith(completed, 10), characterIntent: playfulCandidate, dialogueState: playfulState, brain: baseBrain, userText:'Ага)' });
  assert.equal(next, null);
});
