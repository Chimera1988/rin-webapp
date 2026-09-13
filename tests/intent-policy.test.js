import test from 'node:test';
import assert from 'node:assert/strict';
import { stabilizePersistentIntent } from '../lib/cognition/intent-policy.js';

const none = () => ({
  operation: 'none', goal: null, motive: null, target: null,
  nextMove: null, progress: null, commitment: null, reason: null
});

const maintenance = (overrides = {}) => ({
  schema: 'rin-persistent-intent-v5',
  status: 'active', kind: 'maintenance', phase: 'sustain',
  goal: 'сохранять взаимную игровую близость', motive: 'ей нравится игра',
  target: 'playful_closeness', scene: 'playful_flirt', progress: null,
  commitment: 74, engagement: 78, saturation: 12,
  turnCount: 1, minTurns: 2, maxTurns: 16,
  ...overrides
});

const achievement = (overrides = {}) => ({
  schema: 'rin-persistent-intent-v5',
  status: 'active', kind: 'achievement', phase: 'advancing',
  goal: 'восстановить тёплый контакт после напряжения', motive: 'не оставлять напряжение висеть',
  target: 'relationship_repair', scene: 'conflict_repair', progress: 0.2,
  commitment: 74, turnCount: 1, minTurns: 2, maxTurns: 6,
  ...overrides
});

test('playful multi-turn behavior creates a maintenance intention when drive is strong', () => {
  const result = stabilizePersistentIntent({
    transition: none(),
    decision: { act: 'playful_tease' },
    activeIntent: null,
    conversationState: 'ongoing',
    behaviorState: { space: { strong: false } },
    driveState: { playfulness: 82 }
  });
  assert.equal(result.operation, 'activate');
  assert.equal(result.kind, 'maintenance');
  assert.equal(result.progress, null);
  assert.equal(result.phase, 'started');
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

test('aligned maintenance intention sustains without fake numeric progress', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: maintenance(),
    recentActs: ['flirt_softly'],
    driveState: { playfulness: 80 }, behaviorState: { space: { strong: false }, novelty: { pressure: 0 }, socialMisread: { risk: 0 } },
    scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'preserve');
  assert.equal(result.kind, 'maintenance');
  assert.equal(result.progress, null);
  assert.equal(result.phase, 'sustain');
  assert.match(result.reason, /maintenance_sustain/);
});

test('achievement intention advances on an aligned act even when the model says preserve', () => {
  const result = stabilizePersistentIntent({
    transition: { ...none(), operation: 'preserve' },
    decision: { act: 'repair_connection' },
    activeIntent: achievement(),
    recentActs: ['reassure'],
    driveState: { connection: 82 },
    behaviorState: { space: { strong: false } },
    scene: { type: 'conflict_repair' }
  });
  assert.equal(result.operation, 'advance');
  assert.equal(result.kind, 'achievement');
  assert.equal(result.phase, 'advancing');
  assert.ok(result.progress > 0.2 && result.progress < 1);
  assert.equal(result.reason, 'local_achievement_progress');
});

test('request for space suspends a live intention instead of fighting the user', () => {
  const result = stabilizePersistentIntent({
    transition: { ...none(), operation: 'advance' }, decision: { act: 'seek_closeness' }, activeIntent: maintenance(),
    behaviorState: { space: { strong: true }, novelty: { pressure: 0 }, socialMisread: { risk: 0 } }, driveState: { connection: 90 }, scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'suspend');
  assert.equal(result.phase, 'suspended');
  assert.equal(result.reason, 'user_requested_space');
});

test('maintenance intention is not force-completed merely because its age reaches a horizon', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: maintenance({ turnCount: 16, maxTurns: 16 }),
    recentActs: ['playful_tease', 'playful_tease'],
    behaviorState: { space: { strong: false }, novelty: { pressure: 72 }, socialMisread: { risk: 0 } },
    driveState: { playfulness: 90 }, scene: { type: 'playful_flirt' }
  });
  assert.equal(result.operation, 'preserve');
  assert.equal(result.progress, null);
});

test('achievement horizon still closes a stale goal locally', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'answer_directly' }, activeIntent: achievement({ turnCount: 6, maxTurns: 6 }),
    behaviorState: { space: { strong: false } }, driveState: { connection: 70 }, scene: { type: 'conflict_repair' }
  });
  assert.equal(result.operation, 'complete');
  assert.equal(result.progress, 1);
  assert.equal(result.reason, 'achievement_horizon_reached');
});
