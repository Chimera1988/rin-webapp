import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeInitiationWindow,
  canAutoInitiate,
  canGreet,
  initiationWindowKey,
  resolveInitiationPolicy
} from '../public/js/conversation_policy.js';
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
  for (const status of ['pending', 'sent', 'failed']) {
    const history = [createChatMessage({ role: 'user', status, content: 'вопрос' })];
    assert.equal(canAutoInitiate({ history }), false, status);
  }
  const completed = [createChatMessage({ role: 'assistant', status: 'complete', content: 'ответ' })];
  assert.equal(canAutoInitiate({ history: completed }), true);
});

test('schedule is the only initiation-policy source and preserves all configured windows', () => {
  const schedule = {
    timezone: 'Asia/Tokyo',
    windows: [
      { id: 'morning', from: '08:00', to: '10:30', pool: 'morning', probability: 0.55 },
      { id: 'day_ping', from: '13:00', to: '16:30', pool: 'day', probability: 0.28 },
      { id: 'evening', from: '19:30', to: '22:30', pool: 'evening', probability: 0.5 }
    ],
    maxDailyInitiations: 2,
    minimumSilenceMinutes: 45,
    pollIntervalMs: 60_000,
    innerLife: { activityMinMinutes: 35, activityMaxMinutes: 104, continueAcrossMessages: true },
    location: { lat: 36.5613, lon: 136.6562 }
  };
  const policy = resolveInitiationPolicy(schedule);
  assert.equal(policy.timezone, 'Asia/Tokyo');
  assert.equal(policy.maxPerDay, 2);
  assert.equal(policy.minimumSilenceMinutes, 45);
  assert.equal(policy.pollIntervalMs, 60_000);
  assert.deepEqual(policy.windows, schedule.windows);
  assert.deepEqual(policy.innerLife, schedule.innerLife);
  assert.deepEqual(policy.location, schedule.location);
});

test('active initiation window and persisted window key are deterministic', () => {
  const policy = resolveInitiationPolicy({
    timezone: 'Asia/Tokyo',
    windows: [{ id: 'day_ping', from: '13:00', to: '16:30', pool: 'day', probability: 0.28 }],
    maxDailyInitiations: 2,
    minimumSilenceMinutes: 45,
    pollIntervalMs: 60_000
  });
  const local = new Date(2026, 7, 11, 14, 0, 0);
  const active = activeInitiationWindow(local, policy);
  assert.equal(active?.id, 'day_ping');
  assert.equal(initiationWindowKey(active), 'day_ping');
  assert.equal(activeInitiationWindow(new Date(2026, 7, 11, 17, 0, 0), policy), null);
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
