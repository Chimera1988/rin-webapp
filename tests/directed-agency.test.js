import test from 'node:test';
import assert from 'node:assert/strict';
import { directConversation } from '../lib/cognition/conversation-director.js';
import { deriveCharacterIntent } from '../lib/personality/character-intent-engine.js';
import { analyzeAssistantVoice } from '../lib/personality/assistant-voice.js';
import { createChatMessage, normalizeStoredHistory, toApiHistory, CHAT_SCHEMA_VERSION } from '../public/js/chat_store.js';

const baseBrain = { activeScene: { type: 'everyday' }, obligations: [], ambiguity: { shouldClarify: false } };

test('semantic acknowledgement may end with intentional silence', () => {
  const result = directConversation({
    userText: 'Понятно)', brain: baseBrain,
    dialogueState: { scene: 'everyday', continuityStrength: 0.4, reactiveStreak: 0 },
    history: [{ role: 'assistant', kind: 'text', content: 'Тогда договорились.', status: 'complete' }],
    characterIntent: { strength: 48 }
  });
  assert.equal(result.delivery, 'silence');
});

test('questions and vulnerable messages can never be silently ignored', () => {
  for (const userText of ['Ты где?', 'Мне сейчас очень грустно', 'Пока, до завтра']) {
    const result = directConversation({ userText, brain: baseBrain, dialogueState: { scene: 'everyday' }, history: [], characterIntent: { strength: 20 } });
    assert.equal(result.delivery, 'respond', userText);
  }
});

test('playful handoff creates strong character intent rather than silence', () => {
  const intent = deriveCharacterIntent({
    userText: 'Твоя очередь, можешь начинать',
    dialogueState: { scene: 'playful_flirt', reactiveStreak: 1 },
    brain: { activeScene: { type: 'playful_flirt' } },
    memory: { mood: { affection: 72 }, relationship: { closeness: 60, trust: 60, playfulness: 55 } }
  });
  assert.equal(intent.move, 'take_control');
  assert.ok(intent.strength >= 80);
});

test('voice guard detects symmetric echo and empty assistant enthusiasm', () => {
  const echo = analyzeAssistantVoice('Тогда вот и я 😘', { userText: 'Тогда ещё вот 😘', plan: { responseAct: 'take_lead' } });
  assert.equal(echo.flags.symmetricEcho, true);
  const filler = analyzeAssistantVoice('Отлично! Это делает разговор ещё интереснее.', { userText: 'Ну да)' });
  assert.equal(filler.flags.emptyEnthusiasm, true);
});

test('silence event is stored invisibly and sent to API history', () => {
  const msg = createChatMessage({ role: 'assistant', kind: 'silence', content: '', silence: { reason: 'микросцена завершена', scene: 'everyday' } });
  assert.equal(CHAT_SCHEMA_VERSION, 5);
  const stored = normalizeStoredHistory([msg]);
  assert.equal(stored[0].kind, 'silence');
  assert.equal(toApiHistory(stored, null)[0].silence.reason, 'микросцена завершена');
});
