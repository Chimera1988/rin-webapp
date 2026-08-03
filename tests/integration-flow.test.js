import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatMessage,
  createSerialQueue,
  toApiHistory,
  updateMessage
} from '../public/js/chat_store.js';
import { MemoryStorage, createReq, createRes, sleep } from './helpers/runtime.js';

test('two rapid sends, failure isolation, retry and next-request context form one consistent lifecycle', async () => {
  const history = [];
  const first = createChatMessage({ role: 'user', status: 'pending', requestId: 'r1', id: 'u1', content: 'первый' });
  const second = createChatMessage({ role: 'user', status: 'pending', requestId: 'r2', id: 'u2', content: 'второй' });
  history.push(first, second);
  const snapshots = [];
  const queue = createSerialQueue(async id => {
    const message = history.find(item => item.id === id);
    updateMessage(history, id, { status: 'sent' });
    snapshots.push(toApiHistory(history, message.requestId).map(item => item.content));
    if (id === 'u1') {
      await sleep(10);
      updateMessage(history, id, { status: 'failed' });
      return;
    }
    updateMessage(history, id, { status: 'complete' });
    history.push(createChatMessage({ role: 'assistant', status: 'complete', requestId: 'r2', inReplyTo: 'u2', id: 'a2', content: 'ответ на второй' }));
  });
  await Promise.all([queue.enqueue('u1'), queue.enqueue('u2')]);
  assert.deepEqual(snapshots, [['первый'], ['второй']]);
  assert.equal(history.find(item => item.id === 'u1').status, 'failed');

  updateMessage(history, 'u1', { status: 'sent', requestId: 'retry-r1' });
  const retrySnapshot = toApiHistory(history, 'retry-r1');
  assert.equal(retrySnapshot.at(-1).content, 'первый');
  assert.deepEqual(retrySnapshot.map(item => item.content), ['второй', 'ответ на второй', 'первый']);
});

test('login → chat → memory → next chat carries persisted semantic memory', async () => {
  const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '9999';
  process.env.OPENAI_API_KEY = 'integration-key';
  const login = (await import('../api/login.js?integration')).default;
  const chat = (await import('../api/chat.js?integration')).default;
  const memoryApi = (await import('../api/memory.js?integration')).default;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?integration');

  try {
    const loginRes = createRes();
    await login(createReq({ headers: { 'x-rin-pin': '9999' } }), loginRes);
    assert.equal(loginRes.statusCode, 200);

    let phase = 'chat1';
    let secondSystemPrompt = '';
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      if (phase === 'chat1') {
        phase = 'memory';
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Запомнила твой проект Rin.' }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
      }
      if (phase === 'memory') {
        phase = 'chat2';
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts: [{ path: 'user.project', value: 'Rin', confidence: 0.95 }], events: [], openLoops: [], resolvedLoops: [], sharedMoments: [] }) }, finish_reason: 'stop' }] }), { status: 200 });
      }
      secondSystemPrompt = payload.messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Да, помню проект Rin.' }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
    };

    const firstHistory = [{ role: 'user', kind: 'text', status: 'sent', requestId: 'r1', id: 'u1', content: 'Я делаю проект Rin' }];
    const firstRes = createRes();
    await chat(createReq({ headers: { 'x-rin-pin': '9999' }, body: { requestId: 'r1', history: firstHistory } }), firstRes);
    assert.equal(firstRes.statusCode, 200);

    const memoryRes = createRes();
    await memoryApi(createReq({ headers: { 'x-rin-pin': '9999' }, body: { userText: 'Я делаю проект Rin', assistantText: firstRes.body.reply, existingMemory: {} } }), memoryRes);
    assert.equal(memoryRes.statusCode, 200);
    for (const fact of memoryRes.body.facts) await memoryStore.upsertFact(fact.path, fact.value);
    const diary = await memoryStore.loadDiary();
    assert.equal(diary.facts.user.project, 'Rin');

    const secondHistory = [
      { role: 'user', kind: 'text', status: 'complete', requestId: 'r1', id: 'u1', content: 'Я делаю проект Rin' },
      { role: 'assistant', kind: 'text', status: 'complete', requestId: 'r1', id: 'a1', content: firstRes.body.reply },
      { role: 'user', kind: 'text', status: 'sent', requestId: 'r2', id: 'u2', content: 'Как называется мой проект?' }
    ];
    const secondRes = createRes();
    await chat(createReq({
      headers: { 'x-rin-pin': '9999' },
      body: { requestId: 'r2', history: secondHistory, memory: { facts: diary.facts, recentEvents: diary.events, summaries: diary.summaries, mood: diary.mood, relationship: diary.relationship, openLoops: diary.openLoops } }
    }), secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.match(secondSystemPrompt, /user\.project: Rin/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  }
});
