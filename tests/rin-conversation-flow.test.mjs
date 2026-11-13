import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBehaviorState } from '../lib/cognition/behavior-state.js';
import { computeHumanReadDelay, computeHumanComposeDelay } from '../public/js/delivery_scheduler.js';

const history = [
  { role: 'user', content: 'Проект закончил', requestId: 'u1' },
  { role: 'assistant', content: 'Тогда наливаю чай в обе чашки.', requestId: 'r1' }
];

test('explicitly finished work is never interpreted as still pending', () => {
  const state = buildBehaviorState({ userText: 'Я его закончил)', history });
  assert.equal(state.topicProgress.completed, true);
  assert.equal(state.topicProgress.reasserted, false);
  assert.equal(buildBehaviorState({ userText: 'Я не закончил проект', history }).topicProgress.completed, false);
});

test('repeated correction is retained as a strong task-closure signal', () => {
  const state = buildBehaviorState({ userText: 'Я же говорю, что закончил его', history });
  assert.equal(state.topicProgress.completed, true);
  assert.equal(state.topicProgress.reasserted, true);
});

test('short acknowledgement carries previous action without inventing a new request', () => {
  const state = buildBehaviorState({ userText: 'Хорошо)', history });
  assert.equal(state.topicProgress.acknowledgementOnly, true);
  assert.match(state.topicProgress.previousAssistant, /наливаю чай/u);
});

test('post-generation pacing is bounded and quicker while retaining presence phases', () => {
  const high = () => 1;
  assert.ok(computeHumanReadDelay({ userChars: 200, random: high }) <= 2000);
  assert.ok(computeHumanComposeDelay({ chars: 140, random: high }) <= 3400);
  assert.ok(computeHumanComposeDelay({ chars: 300, random: high, denseConversation: true }) <= 4200);
});
