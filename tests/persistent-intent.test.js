import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRinIntent } from '../public/lib/intent-contract.js';
import { applyIntentTransition, buildDecisionStateTransition, normalizeTurnDecision } from '../lib/cognition/turn-decision.js';

const decision = (intentTransition) => normalizeTurnDecision({
  act: 'continue_naturally', focus: 'текущая линия', stance: 'лично',
  question: { mode: 'none', reason: null },
  delivery: { mode: 'single_text', segments: [{ type:'text', purpose:'reply', stickerIntent:null, maxChars:300 }] },
  intentTransition,
  openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded'
});

function activeIntent(overrides = {}) {
  return normalizeRinIntent({
    status:'active', goal:'отдохнуть после работы', motive:'усталость', target:'evening_rest', scene:'everyday',
    priority:70, commitment:78, progress:.2, nextMove:'заварить чай', startedAtTurn:1, updatedAtTurn:1,
    turnCount:1, minTurns:1, maxTurns:12, source:'cognitive_kernel', ...overrides
  });
}

test('only TurnDecision activates a persistent intent', () => {
  const next = applyIntentTransition(null, decision({ operation:'activate', goal:'отдохнуть после работы', motive:'усталость', target:'evening_rest', nextMove:'заварить чай', progress:.05, commitment:75, reason:'приняла заботу' }), { revision:0, scene:'everyday' });
  assert.equal(next.status, 'active');
  assert.equal(next.goal, 'отдохнуть после работы');
  assert.equal(next.source, 'cognitive_kernel');
});

test('preserve keeps the exact active intent while an unrelated question is answered', () => {
  const current = activeIntent();
  const next = applyIntentTransition(current, decision({ operation:'preserve', goal:null, motive:null, target:null, nextMove:null, progress:null, commitment:null, reason:'прямой вопрос временно имеет приоритет' }), { revision:3, scene:'everyday' });
  assert.deepEqual(next, current);
});

test('advance updates progress without changing ownership or semantic target', () => {
  const current = activeIntent();
  const next = applyIntentTransition(current, decision({ operation:'advance', goal:null, motive:null, target:null, nextMove:'закрыть ноутбук', progress:.55, commitment:80, reason:'отдых продолжается' }), { revision:3, scene:'everyday' });
  assert.equal(next.status, 'active');
  assert.equal(next.goal, current.goal);
  assert.equal(next.target, current.target);
  assert.equal(next.progress, .55);
  assert.equal(next.nextMove, 'закрыть ноутбук');
});

test('suspend is nonterminal but complete and cancel create terminal tombstones', () => {
  const current = activeIntent();
  const suspended = applyIntentTransition(current, decision({ operation:'suspend', goal:null, motive:null, target:null, nextMove:null, progress:null, commitment:null, reason:'временное отвлечение' }), { revision:4, scene:'everyday' });
  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.terminalAtTurn || 0, 0);

  const completed = applyIntentTransition(current, decision({ operation:'complete', goal:null, motive:null, target:null, nextMove:null, progress:1, commitment:null, reason:'вечер завершён' }), { revision:4, scene:'farewell' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 1);
  assert.ok(completed.terminalAtTurn > 0);

  const cancelled = applyIntentTransition(current, decision({ operation:'cancel', goal:null, motive:null, target:null, nextMove:null, progress:null, commitment:null, reason:'пользователь отказался' }), { revision:4, scene:'everyday' });
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.terminalAtTurn > 0);
});

test('preserve cannot resurrect a terminal intent and activation requires an explicit new goal', () => {
  const terminal = activeIntent({ status:'completed', progress:1, terminalAtTurn:5, completionReason:'done' });
  assert.equal(applyIntentTransition(terminal, decision({ operation:'preserve', goal:null, motive:null, target:null, nextMove:null, progress:null, commitment:null, reason:null }), { revision:6 })?.status, 'completed');
  assert.equal(applyIntentTransition(null, decision({ operation:'activate', goal:null, motive:null, target:null, nextMove:null, progress:null, commitment:null, reason:null }), { revision:6 }), null);
});

test('state transition projects exactly the intent operation authored by TurnDecision', () => {
  const current = activeIntent();
  const kernelState = { revision:7, scene:{type:'everyday'}, dialogueState:null, beliefModel:{beliefs:[]}, activeIntent:current };
  const d = decision({ operation:'complete', goal:null, motive:null, target:null, nextMove:null, progress:1, commitment:null, reason:'закрытие сцены' });
  const transition = buildDecisionStateTransition({ kernelState, decision:d, now:1234 });
  assert.equal(transition.rinIntent.status, 'completed');
  assert.equal(transition.rinIntent.completionReason, 'закрытие сцены');
});
