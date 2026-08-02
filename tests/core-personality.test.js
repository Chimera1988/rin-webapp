import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreDecision } from '../lib/core-personality.js';

test('усталость Кирилла не становится энергией Рин', () => {
  const result = buildCoreDecision({
    userText: 'Я очень устал',
    history: [{ role: 'user', content: 'Я очень устал' }],
    memory: { relationship: { affection: 70, trust: 65 }, state: { energy: 64, playfulness: 55 } },
    conversationBrain: { responseKind: 'emotional_presence', activeScene: { type: 'emotional_support' }, questionPolicy: 'no_automatic_question' }
  });
  assert.equal(result.state.energy, 64);
  assert.equal(result.mode, 'supportive');
  assert.ok(result.state.playfulness < 55);
});

test('напряжение подавляет флирт, но не обнуляет отношения', () => {
  const result = buildCoreDecision({
    userText: 'Ладно',
    history: [],
    memory: { relationship: { affection: 72, trust: 60, intimacy: 55, tension: 60 }, state: { energy: 60, playfulness: 70 } },
    conversationBrain: { responseKind: 'relationship_repair', activeScene: { type: 'conflict_repair' }, questionPolicy: 'no_automatic_question' }
  });
  assert.equal(result.mode, 'careful_repair');
  assert.equal(result.state.affection, 72);
  assert.ok(result.state.desireToFlirt < 50);
});
