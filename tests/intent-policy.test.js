import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizePersistentIntent } from '../lib/cognition/intent-policy.js';

const none = () => ({
  operation: 'none', goal: null, motive: null, target: null,
  nextMove: null, progress: null, commitment: null, reason: null
});

const active = (overrides = {}) => ({
  status: 'active', goal: 'сохранять взаимную игровую близость', motive: 'ей нравится игра',
  target: 'playful_closeness', scene: 'playful_flirt', progress: 0.2,
  commitment: 74, turnCount: 1, minTurns: 2, maxTurns: 6,
  ...overrides
});

test('playful multi-turn behavior can create a persistent intention when drive is strong', () => {
  const result = stabilizePersistentIntent({
    transition: none(),
    decision: { act: 'playful_tease' },
    activeIntent: null,
    conversationState: 'ongoing',
    behaviorState: { space: { strong: false } },
    driveState: { playfulness: 82 }
  });
  assert.equal(result.operation, 'activate');
  assert.match(result.goal, /игров/iu);
  assert.match(result.reason, /local_intent_policy:playful_tease/);
});

test('weak one-off behavior does not manufacture an intention', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'answer_directly' }, activeIntent: null,
    driveState: { curiosity: 90 }, behaviorState: { space: { strong: false } }
  });
  assert.equal(result.operation, 'none');
});

test('live intention is preserved when the model emits no lifecycle operation', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: active(),
    driveState: { playfulness: 80 }, behaviorState: { space: { strong: false } },
    scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'preserve');
  assert.equal(result.reason, 'local_intent_persistence');
});

test('request for space suspends a live intention instead of fighting the user', () => {
  const result = stabilizePersistentIntent({
    transition: { ...none(), operation: 'advance' }, decision: { act: 'seek_closeness' }, activeIntent: active(),
    behaviorState: { space: { strong: true } }, driveState: { connection: 90 }, scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'suspend');
  assert.equal(result.reason, 'user_requested_space');
});

test('intention horizon closes a stale live line locally', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'continue_shared_thread' }, activeIntent: active({ turnCount: 6, maxTurns: 6 }),
    behaviorState: { space: { strong: false } }, driveState: { curiosity: 90 }, scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'complete');
  assert.equal(result.progress, 1);
  assert.equal(result.reason, 'intent_horizon_reached');
});
