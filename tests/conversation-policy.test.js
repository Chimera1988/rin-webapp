import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutoInitiate, canGreet, resolveInitiationPolicy } from '../public/js/conversation_policy.js';
import { environmentIntent, shouldRefreshEnvironment } from '../public/js/environment_intent.js';
import { createChatMessage } from '../public/js/chat_store.js';
import { analyzeConversation } from '../lib/conversation-brain.js';

test('greeting only starts with an empty non-busy conversation', () => {
  assert.equal(canGreet({ history: [], greetingActive: false, activeRequests: 0 }), true);
  assert.equal(canGreet({ history: [createChatMessage({ role: 'assistant', content: 'привет' })] }), false);
  assert.equal(canGreet({ history: [], greetingActive: true }), false);
  assert.equal(canGreet({ history: [], activeRequests: 1 }), false);
});

test('auto initiation is blocked by pending, sent and failed latest user turns', () => {
  const profile = {};
  for (const status of ['pending', 'sent', 'failed']) {
    const history = [createChatMessage({ role: 'user', status, content: 'вопрос' })];
    assert.equal(canAutoInitiate({ profile, history }), false, status);
  }
  const completed = [createChatMessage({ role: 'assistant', status: 'complete', content: 'ответ' })];
  assert.equal(canAutoInitiate({ profile, history: completed }), true);
});

test('explicit user initiation settings override schedule defaults including zero and empty windows', () => {
  const policy = resolveInitiationPolicy({ initiation: { max_per_day: 0, windows: [] } }, {
    max_daily_initiations: 3,
    windows: [{ from: '08:00', to: '09:00' }],
    minimum_silence_minutes: 60
  });
  assert.equal(policy.maxPerDay, 0);
  assert.deepEqual(policy.windows, []);
  assert.equal(policy.minimumSilenceMinutes, 60);
});

test('initiation policy owns timing only and has no content-selector API', async () => {
  const policy = await import('../public/js/conversation_policy.js');
  assert.equal(typeof policy.chooseConfiguredStarter, 'undefined');
  assert.equal(typeof policy.canAutoInitiate, 'function');
});

test('time and weather only refresh facts and do not select a separate reply engine', () => {
  assert.equal(environmentIntent('Сколько у тебя времени?'), 'time');
  assert.equal(environmentIntent('Какая у тебя погода?'), 'weather');
  assert.equal(environmentIntent('Я пока работаю'), null);
  assert.equal(shouldRefreshEnvironment('Который час в Канадзаве?'), true);
});

test('perception distinguishes temporal пока from explicit farewell without prescribing a response', () => {
  for (const text of ['Я пока не знаю', 'Пока думаю', 'Пока работаю']) {
    const perception = analyzeConversation({ userText: text, history: [], conversationState: 'ongoing' });
    assert.notEqual(perception.literalIntent, 'farewell', text);
    assert.equal('responseFocus' in perception, false);
    assert.equal('obligations' in perception, false);
  }
  const farewell = analyzeConversation({ userText: 'Ну пока', history: [], conversationState: 'ending' });
  assert.equal(farewell.literalIntent, 'farewell');
  assert.equal(farewell.activeScene.type, 'farewell');
  assert.equal('goal' in farewell.activeScene, false);
});
