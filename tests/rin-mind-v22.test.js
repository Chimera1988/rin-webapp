import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBehaviorState, normalizeMaleUserSelfReference } from '../lib/cognition/behavior-state.js';
import { stabilizePersistentIntent, intentSimilarity } from '../lib/cognition/intent-policy.js';
import { buildRinMindPrompt } from '../lib/cognition/rin-mind.js';

const none = () => ({
  operation: 'none', goal: null, motive: null, target: null,
  nextMove: null, progress: null, commitment: null, reason: null
});

const activePlay = (overrides = {}) => ({
  schema: 'rin-persistent-intent-v5', status: 'active', kind: 'maintenance', phase: 'sustain',
  goal: 'сохранять взаимную игровую близость, пока она остаётся приятной обоим',
  motive: 'Рин нравится игра', target: 'playful_closeness', scene: 'playful_flirt',
  progress: null, engagement: 80, saturation: 0, commitment: 78, turnCount: 1, minTurns: 2, maxTurns: 16, ...overrides
});

const completedPlay = (overrides = {}) => ({
  ...activePlay(), status: 'completed', phase: 'completed', progress: null, terminalAtTurn: 10, cooldownUntilTurn: 20, ...overrides
});

test('isolated feminine first-person inflection is normalized as a likely typo for the known male user', () => {
  assert.equal(normalizeMaleUserSelfReference('Может я в чем то не права, то скажи тогда'), 'Может я в чем то не прав, то скажи тогда');
  assert.equal(normalizeMaleUserSelfReference('Я не уверена, что правильно понял'), 'Я не уверен, что правильно понял');
  assert.equal(normalizeMaleUserSelfReference('Я думаю, она была права'), 'Я думаю, она была права');
});

test('behavior state exposes gender-stability and soft novelty pressure without forcing a scene change', () => {
  const state = buildBehaviorState({
    userText: 'Может я в чем то не права',
    recentActs: ['playful_tease', 'playful_tease', 'playful_tease']
  });
  assert.equal(state.userGender.known, 'male');
  assert.equal(state.userGender.likelyInflectionTypo, true);
  assert.match(state.userGender.modelUserText, /не прав$/u);
  assert.equal(state.novelty.streak, 3);
  assert.ok(state.novelty.pressure >= 40);
  assert.match(state.novelty.guidance, /не ломать|другим/iu);
});

test('aligned playful maintenance intention sustains without pretending closeness is a progress bar', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: activePlay(),
    recentActs: ['flirt_softly'], driveState: { playfulness: 82 },
    behaviorState: { space: { strong: false }, novelty: { pressure: 0 }, socialMisread: { risk: 0 } },
    scene: { type: 'playful_flirt' }, revision: 4
  });
  assert.equal(result.operation, 'preserve');
  assert.equal(result.kind, 'maintenance');
  assert.equal(result.progress, null);
  assert.equal(result.phase, 'sustain');
  assert.match(result.reason, /maintenance_sustain/);
});

test('recently completed semantically identical intention cannot immediately resurrect through local inference', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: null,
    recentIntents: [completedPlay()], revision: 11,
    driveState: { playfulness: 90 }, behaviorState: { space: { strong: false } }, conversationState: 'ongoing'
  });
  assert.equal(result.operation, 'none');
  assert.equal(result.reason, 'recent_intent_cooldown');
});

test('completed intent may become available again after its cooldown expires', () => {
  const result = stabilizePersistentIntent({
    transition: none(), decision: { act: 'playful_tease' }, activeIntent: null,
    recentIntents: [completedPlay({ cooldownUntilTurn: 12 })], revision: 20,
    driveState: { playfulness: 90 }, behaviorState: { space: { strong: false } }, conversationState: 'ongoing'
  });
  assert.equal(result.operation, 'activate');
});

test('intent similarity recognizes the same goal even when lifecycle metadata differs', () => {
  assert.equal(intentSimilarity(activePlay(), completedPlay()), 1);
});

test('Rin Mind prompt preserves long playful scenes but asks for readable mock-offense and normalized gender interpretation', () => {
  const behaviorState = buildBehaviorState({
    userText: 'Может я в чем то не права',
    recentActs: ['playful_tease', 'playful_tease', 'playful_tease']
  });
  const { system } = buildRinMindPrompt({
    profile: { prompt_profile: { identity: { full_name: 'Рин Акихара' } }, base_rules: '' },
    state: {
      userText: 'Может я в чем то не права', behaviorState,
      driveState: { curiosity: 50, connection: 70, playfulness: 80, autonomy: 60, selfRespect: 70, needForSpace: 0, questionImpulse: 20 },
      scene: { type: 'playful_flirt', topic: 'игра', turnsInScene: 5, continuityStrength: 0.9 },
      stickerState: { mode: 'always', available: true, hardAvailable: true, propensity: 1, desireModifier: 1 },
      recentHistory: [], recentIntents: [completedPlay()], openLoops: [], stickerCandidates: []
    }
  });
  assert.match(system, /Может я в чем то не прав/u);
  assert.match(system, /playful_mock_offense/u);
  assert.match(system, /тонкий маркер игры/u);
  assert.match(system, /длинный удачный флирт/u);
  assert.match(system, /recentIntents/u);
});
