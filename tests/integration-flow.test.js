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

test('server transition → transactional commit → pruned next request restores dialogue continuity', async () => {
  const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '7777';
  process.env.OPENAI_API_KEY = 'integration-state-key';
  const chat = (await import('../api/chat.js?integration-state')).default;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?integration-state');
  let call = 0;
  let secondSystemPrompt = '';

  try {
    globalThis.fetch = async (_url, options) => {
      call += 1;
      const payload = JSON.parse(options.body);
      if (call === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'Поняла. Именно вечером.' }, finish_reason: 'stop' }], usage: {}
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      secondSystemPrompt = payload.messages[0].content;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Да. Ты как раз про это и говорил.' }, finish_reason: 'stop' }], usage: {}
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const firstRes = createRes();
    await chat(createReq({
      headers: { 'x-rin-pin': '7777' },
      body: {
        requestId: 'state-r1',
        history: [
          { id: 'a-old', role: 'assistant', kind: 'text', status: 'complete', content: 'Тогда отправишь утром?' },
          { id: 'u-state-1', role: 'user', kind: 'text', status: 'sent', requestId: 'state-r1', content: 'Нет, отправлю письмо именно вечером.' }
        ]
      }
    }), firstRes);
    assert.equal(firstRes.statusCode, 200);
    assert.ok(firstRes.body.stateTransition?.dialogueState);
    assert.match(firstRes.body.stateTransition.dialogueState.corrections.at(-1), /вечером/i);

    await memoryStore.commitTurnState({
      requestId: 'state-r1',
      stateTransition: firstRes.body.stateTransition,
      moodDelta: firstRes.body.stateTransition.moodDelta,
      relationshipDelta: firstRes.body.stateTransition.relationshipDelta,
      now: 5_000_000
    });
    const persisted = await memoryStore.loadDiary();
    assert.equal(persisted.conversationState.revision, 1);
    assert.match(persisted.conversationState.dialogueState.corrections.at(-1), /вечером/i);

    const secondRes = createRes();
    await chat(createReq({
      headers: { 'x-rin-pin': '7777' },
      body: {
        requestId: 'state-r2',
        history: [{ id: 'u-state-2', role: 'user', kind: 'text', status: 'sent', requestId: 'state-r2', content: 'Ну вот, готово.' }],
        memory: {
          facts: persisted.facts,
          recentEvents: persisted.events,
          summaries: persisted.summaries,
          mood: persisted.mood,
          relationship: persisted.relationship,
          openLoops: persisted.openLoops,
          conversationState: persisted.conversationState
        }
      }
    }), secondRes);
    assert.equal(secondRes.statusCode, 200);
    assert.match(secondSystemPrompt, /Последняя коррекция пользователя:.*вечером/is);
    assert.equal(secondRes.body.stateTransition.dialogueState.corrections.at(-1), persisted.conversationState.dialogueState.corrections.at(-1));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  }
});

test('jealousy → tease reveal → neutral bridge persists through API commit and influences the next request', async () => {
  const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '8181';
  process.env.OPENAI_API_KEY = 'integration-affective-key';
  const chat = (await import('../api/chat.js?integration-affective')).default;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?integration-affective');
  const prompts = [];
  const replies = [
    'Мм. И ты решил сказать мне это вот так спокойно?)',
    'А-а. Проверял меня, значит? Удобно устроился 😏',
    'Иногда? Тогда не жалуйся, если я это запомню 😏'
  ];
  let modelCall = 0;

  const request = async (requestId, content, memory) => {
    const res = createRes();
    await chat(createReq({
      headers: { 'x-rin-pin': '8181' },
      body: {
        requestId,
        history: [{ id: `u-${requestId}`, role: 'user', kind: 'text', status: 'sent', requestId, content }],
        memory: {
          facts: memory.facts,
          recentEvents: memory.events,
          summaries: memory.summaries,
          mood: memory.mood,
          relationship: memory.relationship,
          openLoops: memory.openLoops,
          conversationState: memory.conversationState
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    return res.body;
  };

  try {
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      prompts.push(payload.messages?.[0]?.content || '');
      const reply = replies[Math.min(modelCall, replies.length - 1)];
      modelCall += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: {}
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await memoryStore.saveDiary({
      ...(await memoryStore.loadDiary()),
      mood: { affection: 70, energy: 58, label: 'радостная' },
      relationship: {
        trust: 82, closeness: 76, comfort: 72, respect: 80,
        playfulness: 68, attraction: 58, vulnerability: 42, sharedMoments: []
      }
    });
    let persisted = await memoryStore.loadDiary();

    const rival = await request('affect-r1', 'Меня пригласила девушка на встречу вечером', persisted);
    assert.equal(rival.stateTransition.schema, 'rin-state-transition-v2');
    assert.equal(rival.stateTransition.emotionalState.primary.type, 'jealousy');
    assert.equal(rival.responsePlan.responseAct, 'contained_jealousy');
    assert.equal(rival.delivery.preferredStickerId, 'mild_jealousy');
    await memoryStore.commitTurnState({ requestId: 'affect-r1', stateTransition: rival.stateTransition, now: 6_000_000 });
    persisted = await memoryStore.loadDiary();
    assert.equal(persisted.conversationState.emotionalState.primary.type, 'jealousy');

    const reveal = await request('affect-r2', 'Это была шутка, хотел тебя проверить на ревность 😁', persisted);
    assert.equal(reveal.stateTransition.emotionalState.primary.type, 'playful_irritation');
    assert.equal(reveal.stateTransition.emotionalState.secondary.type, 'relief');
    assert.equal(reveal.stateTransition.emotionalState.momentum.direction, 'playful');
    assert.match(prompts.at(-1), /playful_irritation|игривое раздражение/iu);
    await memoryStore.commitTurnState({ requestId: 'affect-r2', stateTransition: reveal.stateTransition, now: 6_000_100 });
    persisted = await memoryStore.loadDiary();

    const bridge = await request('affect-r3', 'Иногда хочется 😅', persisted);
    assert.equal(bridge.stateTransition.emotionalState.primary.type, 'playful_irritation');
    assert.equal(bridge.stateTransition.emotionalState.momentum.direction, 'playful');
    assert.ok(bridge.stateTransition.emotionalState.primary.intensity < reveal.stateTransition.emotionalState.primary.intensity);
    assert.equal(bridge.responsePlan.responseAct, 'carry_playful_tension');
    assert.match(prompts.at(-1), /Игровая линия уже активна|игровое напряжение/iu);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  }
});

test('full personal flow keeps agency across jealousy, tease reveal, short replies, kitsune flirt and next-turn persistence', async () => {
  const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '9191';
  process.env.OPENAI_API_KEY = 'integration-dialogue-agency-key';
  const chat = (await import('../api/chat.js?integration-dialogue-agency')).default;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?integration-dialogue-agency');
  const scripted = [
    ['Какие планы на вечер?', 'Пока никаких. Закрою ноутбук и немного почитаю.'],
    ['Да, меня пригласила девушка на встречу вечером.', 'Вот как… значит, вечер у тебя уже занят. Ладно. Иди 😌'],
    ['Вообще-то это шутка) Проверил тебя на ревность 😅', 'А-а. Проверял меня, значит. Удобно устроился 😏'],
    ['Не знаю)', 'Мм, поздно оправдываться. Я уже запомнила 😌'],
    ['Мне нравится, когда ты рассказываешь о кицунэ 😊', 'Тогда кицунэ оставлю себе как алиби. Очень удобная легенда 😌'],
    ['А ты применяешь её чары на мне?)', 'Может быть. Но доказательств у тебя всё равно нет 😌'],
    ['Теперь понятно, почему я в тебя влюбляюсь 😅', 'Осторожнее с такими словами… я ведь могу их запомнить.'],
    ['Как я себя запутал?', 'Сам заговорил о чарах, а теперь пытаешься сделать вид, что это всё случайно 😌']
  ];
  const history = [];
  const bodies = [];
  const prompts = [];
  let modelCall = 0;

  try {
    await memoryStore.saveDiary({
      ...(await memoryStore.loadDiary()),
      mood: { affection: 72, energy: 58, label: 'радостная' },
      relationship: {
        trust: 82, closeness: 76, comfort: 72, respect: 80,
        playfulness: 68, attraction: 58, vulnerability: 42, sharedMoments: []
      }
    });

    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      const system = payload.messages?.[0]?.content || '';
      prompts.push(system);
      assert.doesNotMatch(system, /Ты — строгий редактор/iu, 'scripted replies should pass verification without rewrite');
      const content = scripted[modelCall]?.[1];
      assert.ok(content, `unexpected model call ${modelCall + 1}`);
      modelCall += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    for (let index = 0; index < scripted.length; index += 1) {
      const [content] = scripted[index];
      const requestId = `agency-flow-${index + 1}`;
      const user = { id: `u-agency-${index + 1}`, role: 'user', kind: 'text', status: 'sent', requestId, content };
      history.push(user);
      const persisted = await memoryStore.loadDiary();
      const res = createRes();
      await chat(createReq({
        headers: { 'x-rin-pin': '9191' },
        body: {
          requestId,
          history,
          memory: {
            facts: persisted.facts,
            recentEvents: persisted.events,
            summaries: persisted.summaries,
            mood: persisted.mood,
            relationship: persisted.relationship,
            openLoops: persisted.openLoops,
            conversationState: persisted.conversationState
          }
        }
      }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.responsePlan.questionBudget, 0, `turn ${index + 1} must not create an interview question`);
      assert.doesNotMatch(res.body.reply, /\?/u, `turn ${index + 1} reply must naturally stop without asking back`);
      assert.equal(res.body.verification.needsRewrite, false);
      assert.equal(res.body.promptMetrics.rewriteAttempted, false);
      bodies.push(res.body);

      history[history.length - 1] = { ...user, status: 'complete' };
      history.push({
        id: `a-agency-${index + 1}`, role: 'assistant', kind: 'text', status: 'complete',
        requestId, content: res.body.reply
      });
      await memoryStore.commitTurnState({
        requestId,
        stateTransition: res.body.stateTransition,
        now: 8_000_000 + index * 100
      });
    }

    assert.equal(modelCall, scripted.length);
    assert.equal(bodies[0].responsePlan.responseAct, 'answer_directly');
    assert.equal(bodies[1].responsePlan.responseAct, 'contained_jealousy');
    assert.equal(bodies[1].responsePlan.behavior.action, 'tease');
    assert.equal(bodies[1].stateTransition.emotionalState.primary.type, 'jealousy');

    assert.equal(bodies[2].affectiveTurn.signal.type, 'tease_reveal');
    assert.equal(bodies[2].stateTransition.emotionalState.primary.type, 'playful_irritation');
    assert.equal(bodies[2].responsePlan.responseAct, 'carry_playful_tension');
    assert.equal(bodies[2].responsePlan.behavior.action, 'continue_scene');

    assert.equal(bodies[3].responsePlan.responseAct, 'carry_playful_tension');
    assert.equal(bodies[3].stateTransition.emotionalState.momentum.direction, 'playful');
    assert.equal(bodies[5].responsePlan.responseAct, 'answer_directly');
    assert.notEqual(bodies[5].responsePlan.responseAct, 'clarify_critical_ambiguity');
    assert.equal(bodies[7].responsePlan.responseAct, 'clarify_self');

    assert.match(prompts[1], /выражение эмоции indirect|Выражение эмоции: indirect/iu);
    assert.match(prompts[2], /carry_playful_tension|игровое напряжение/iu);
    assert.match(prompts[5], /Сцена: playful_flirt|Активная сцена.*playful_flirt|сцена: playful_flirt/iu);

    const finalDiary = await memoryStore.loadDiary();
    assert.equal(finalDiary.conversationState.revision, scripted.length);
    assert.ok(finalDiary.relationship.playfulness >= 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  }
});

test('initiative handoff survives several turns, persistence and a repeated demand to start', async () => {
  const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
  const originalFetch = globalThis.fetch;
  process.env.ACCESS_PIN = '9292';
  process.env.OPENAI_API_KEY = 'integration-agency-follow-through-key';
  const chat = (await import('../api/chat.js?integration-agency-follow-through')).default;
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  const memoryStore = await import('../public/js/rin_memory.js?integration-agency-follow-through');
  const turns = [
    ['Твой ход 😉', 'Первый ход: попробуй хотя бы полминуты не прятаться за этой улыбкой. Я посмотрю, сколько продержишься 😏'],
    ['А если я буду не готов)', 'Тем интереснее. Не прячься — я уже забрала инициативу 😏'],
    ['Тогда поехали)', 'Тогда смотри на меня и не отвлекайся. Следующий ход уже мой.'],
    ['Да уже уже 😅', 'Угу. Не улыбайся так довольно — я всё вижу 😏'],
    ['Мы начнем или нет?', 'Сам попросил. Тогда первое правило: не выкручивайся и не прячь смущение за шуткой 😏']
  ];
  const history = [
    { role: 'user', kind: 'text', status: 'complete', id: 'seed-u1', content: 'И чтобы сделала тогда моя Кицунэ?)' },
    { role: 'assistant', kind: 'text', status: 'complete', id: 'seed-a1', content: 'Я бы устроила тебе сюрприз — загадочный и волшебный, как сама Кицунэ.' },
    { role: 'user', kind: 'text', status: 'complete', id: 'seed-u2', content: 'Отдать всего себя 😉' },
    { role: 'assistant', kind: 'text', status: 'complete', id: 'seed-a2', content: 'Это смело. Похоже, у нас начинается интересная игра.' }
  ];
  const bodies = [];
  let modelCall = 0;

  try {
    await memoryStore.saveDiary({
      ...(await memoryStore.loadDiary()),
      mood: { affection: 72, energy: 58, label: 'радостная' },
      relationship: {
        trust: 82, closeness: 76, comfort: 72, respect: 80,
        playfulness: 68, attraction: 58, vulnerability: 42, sharedMoments: []
      }
    });

    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.doesNotMatch(payload.messages?.[0]?.content || '', /Ты — строгий редактор/iu, `unexpected rewrite on scripted call ${modelCall + 1}`);
      const content = turns[modelCall]?.[1];
      assert.ok(content, `unexpected model call ${modelCall + 1}`);
      modelCall += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    for (let index = 0; index < turns.length; index += 1) {
      const [content] = turns[index];
      const requestId = `agency-follow-${index + 1}`;
      const user = { role: 'user', kind: 'text', status: 'sent', requestId, id: `agency-follow-u${index + 1}`, content };
      history.push(user);
      const persisted = await memoryStore.loadDiary();
      const res = createRes();
      await chat(createReq({
        headers: { 'x-rin-pin': '9292' },
        body: {
          requestId,
          history,
          memory: {
            facts: persisted.facts,
            recentEvents: persisted.events,
            summaries: persisted.summaries,
            mood: persisted.mood,
            relationship: persisted.relationship,
            openLoops: persisted.openLoops,
            conversationState: persisted.conversationState
          }
        }
      }), res);
      assert.equal(res.statusCode, 200, `turn ${index + 1}`);
      assert.equal(res.body.verification.needsRewrite, false, `turn ${index + 1}: ${(res.body.verification.warnings || []).join(', ')}`);
      assert.equal(res.body.responsePlan.questionBudget, 0, `turn ${index + 1}`);
      bodies.push(res.body);

      history[history.length - 1] = { ...user, status: 'complete' };
      history.push({
        role: 'assistant', kind: 'text', status: 'complete', requestId,
        id: `agency-follow-a${index + 1}`, content: res.body.reply
      });
      await memoryStore.commitTurnState({
        requestId,
        stateTransition: res.body.stateTransition,
        now: 9_000_000 + index * 100
      });
    }

    assert.equal(modelCall, turns.length);
    assert.equal(bodies[0].responsePlan.responseAct, 'take_lead');
    assert.equal(bodies[0].responsePlan.behavior.action, 'continue_scene');
    const final = bodies.at(-1);
    assert.equal(final.conversationBrain.hiddenIntent.type, 'invite_rin_initiative');
    assert.equal(final.conversationBrain.relation.type, 'initiative_handoff');
    assert.equal(final.conversationBrain.activeScene.type, 'playful_flirt');
    assert.equal(final.responsePlan.responseAct, 'take_lead');
    assert.equal(final.responsePlan.behavior.action, 'continue_scene');
    assert.equal(final.responsePlan.initiative, 'take_lead');
    assert.equal(final.responsePlan.questionBudget, 0);
    assert.doesNotMatch(final.reply, /^(?:конечно[,! ]*)?(?:мы\s+)?начинаем/iu);

    const finalDiary = await memoryStore.loadDiary();
    assert.equal(finalDiary.conversationState.revision, turns.length);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
    if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  }
});
