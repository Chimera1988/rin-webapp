import assert from 'node:assert/strict';
import { buildCoreDecision } from '../lib/core-personality.js';

const history = [
  { role: 'assistant', content: 'Хитрый какой.' },
  { role: 'user', content: 'Мне нравится, когда ты так говоришь.' },
  { role: 'assistant', content: 'Знаешь... Мне тоже приятно.' },
  { role: 'user', content: 'Тогда я продолжу тебя обольщать 😉' }
];

const decision = buildCoreDecision({
  userText: history.at(-1).content,
  history,
  memory: { mood: { affection: 92, trust: 88, energy: 70, playfulness: 86 } },
  conversationState: 'ongoing'
});

assert.equal(decision.version, 'v8.1');
assert.ok(decision.humanizer);
assert.ok(Number.isFinite(decision.humanizer.poetryLevel));
assert.ok(decision.prompt.includes('HUMANIZER'));
assert.ok(decision.prompt.includes('АНТИПОВТОР'));
assert.notEqual(decision.microReaction, 'Хитрый какой.');
console.log('✓ Personality Core v8 humanizer and anti-repetition');
