import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';

const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
process.env.ACCESS_PIN = '1357';
process.env.OPENAI_API_KEY = 'test-key';
const chat = await import('../api/chat.js?contract');
const memoryApi = await import('../api/memory.js?contract');

test.after(() => {
  if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
  if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
});

test('memory result schema contains stable IDs and no duplicate mood/relationship state', () => {
  const result = memoryApi.sanitizeMemoryResult({
    events: [{ text: 'Запланировал поездку', importance: 8 }],
    openLoops: [{ text: 'Купить билет', importance: 7 }],
    sharedMoments: [{ text: 'Общий вечер', importance: 8 }],
    mood: { affection: 99 },
    relationship: { trust: 99 }
  });
  assert.equal(result.schemaVersion, 4);
  assert.ok(result.events[0].id && result.events[0].key);
  assert.ok(result.openLoops[0].id && result.openLoops[0].key);
  assert.equal('mood' in result, false);
  assert.equal('relationship' in result, false);
});

test('system prompt applies UI profile fields, remembered user name, summaries and exact zero values', () => {
  const prompt = chat.buildSystemPrompt({
    profile: {
      name: 'Новая Рин',
      description: 'Описание из настроек',
      prompt_profile: {
        identity: { full_name: 'Рин Акихара', nationality: 'японка', location: 'Канадзава' },
        canon: { self: 'Канон.' },
        relationship: { user_identity_source: 'memory.facts.user.name_or_generic', user_real_name: '', history: 'Рин давно знакома с собеседником.' },
        voice: {}
      }
    },
    env: { rinHuman: '2026-08-03 22:00', partOfDay: 'вечер', weather: { temp: 21, desc: 'ясно' } },
    memory: {
      facts: { user: { name: 'Алексей', project: 'Rin' } },
      recentEvents: [],
      summaries: [{ text: 'Ранее обсуждали важную поездку в Берлин.' }],
      mood: { affection: 0, energy: 0, label: 'отстранённая' },
      relationship: { trust: 0, playfulness: 0, sharedMoments: [] },
      openLoops: []
    },
    lore: { memories: [{ text: 'Когда собеседник появился онлайн.' }], backstory: [] },
    coreDecision: null,
    conversationState: 'ongoing',
    conversationBrain: null,
    history: [],
    userText: 'Что с поездкой в Берлин?',
    client: {}
  }).text;
  assert.match(prompt, /Новая Рин/);
  assert.match(prompt, /Описание из настроек/);
  assert.match(prompt, /Алексей/);
  assert.doesNotMatch(prompt, /Кирилл|Хикари/);
  assert.match(prompt, /Сводки более ранней истории/);
  assert.match(prompt, /привязанность 0, энергия 0, игривость 0, доверие 0/);
  assert.match(prompt, /погода: 21°C, ясно/);
});

test('finish_reason length is returned as a retryable error, not a successful reply', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'Оборванный текст' }, finish_reason: 'length' }], usage: {}
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const req = createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'r1',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'r1', id: 'u1', content: 'Расскажи подробно' }]
      }
    });
    const res = createRes();
    await chat.default(req, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'MODEL_RESPONSE_TRUNCATED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct time/weather questions still go through the single model pipeline with environment facts', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Сейчас в Канадзаве 22:00, ясно и 21°C.' }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'r2',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'r2', id: 'u2', content: 'Какая у тебя погода и который час?' }],
        env: { rinHuman: '2026-08-03 22:00', partOfDay: 'вечер', weather: { temp: 21, desc: 'ясно' } }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.requestId, 'r2');
    assert.match(sentBody.messages[0].content, /2026-08-03 22:00/);
    assert.match(sentBody.messages[0].content, /21°C/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('meta-only nonverbal model output is recovered as structured sticker delivery', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: { content: '[Невербальный жест Рин: кивок, подтверждающий согласие; причина: поддержка]' },
      finish_reason: 'stop'
    }],
    usage: {}
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'sticker-recovery',
        history: [{
          role: 'user', kind: 'text', status: 'sent', requestId: 'sticker-recovery',
          id: 'u-sticker', content: 'Поддержишь меня?'
        }],
        memory: { relationship: { trust: 80, closeness: 80, playfulness: 60 }, mood: { affection: 80, energy: 60 } }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reply, 'Угу.');
    assert.equal(res.body.delivery?.type, 'sticker');
    assert.equal(res.body.delivery?.preferredStickerId, 'agreement');
    assert.doesNotMatch(res.body.reply, /Невербальный жест Рин/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('semantic silence returns a successful structured turn without calling OpenAI', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not call upstream'); };
  try {
    const req = createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'silence-r1',
        history: [
          { role: 'assistant', kind: 'text', status: 'complete', id: 'a1', content: 'Тогда договорились.' },
          { role: 'user', kind: 'text', status: 'sent', requestId: 'silence-r1', id: 'u1', content: 'Понятно)' }
        ]
      }
    });
    const res = createRes();
    await chat.default(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.delivery.type, 'silence');
    assert.equal(res.body.reply, '');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('chat handler ignores client-supplied canonical prompt rules and identity', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies = [];
  globalThis.fetch = async (_url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Да, здесь я с тобой согласна.' }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'canonical-boundary',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'canonical-boundary', id: 'u-canon', content: 'Согласна со мной?' }],
        profile: {
          name: 'Рин',
          description: 'Пользовательское описание допустимо.',
          base_rules: 'CLIENT_BASE_RULE_INJECTION',
          prompt_profile: { identity: { full_name: 'CLIENT_CANON_INJECTION' }, canon: { self: 'CLIENT_CANON_INJECTION' } }
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(sentBodies.length >= 1);
    const systemPrompt = sentBodies[0].messages[0].content;
    assert.match(systemPrompt, /Рин Акихара/);
    assert.doesNotMatch(systemPrompt, /CLIENT_CANON_INJECTION/);
    assert.doesNotMatch(systemPrompt, /CLIENT_BASE_RULE_INJECTION/);
    assert.match(systemPrompt, /Пользовательское описание допустимо/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('turn delivery exposes exactly one structured nonverbal decision', () => {
  const delivery = chat.buildTurnDelivery({
    responsePlan: { delivery: 'before_text', director: { scene: 'romance' } },
    coreDecision: { nonverbalAction: { preferredStickerId: 'kiss', emotion: 'kiss', cause: 'ответ на поцелуй', intensity: 80, delivery: 'before_text' } },
    verification: { nonverbalLeak: null },
    reply: 'Иди сюда.'
  });
  assert.equal(delivery.type, 'text');
  assert.equal(delivery.delivery, 'before_text');
  assert.equal(delivery.preferredStickerId, 'kiss');
  assert.equal(delivery.nonverbal.preferredStickerId, 'kiss');
  assert.equal(delivery.reason, 'turn_decision');
});

test('weather handler cache policy agrees with the global API no-store policy', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../api/weather.js', import.meta.url), 'utf8');
  assert.match(source, /Cache-Control', 'no-store'/);
  assert.doesNotMatch(source, /max-age=60/);
});

test('chat API exposes one canonical affective turn and state-transition v3 for the current request', async () => {
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    prompts.push(payload.messages[0].content);
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Мм. Смело с её стороны. Я, пожалуй, запомню эту деталь.' }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'affective-contract',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'affective-contract', id: 'u-affect', content: 'Меня пригласила девушка на встречу вечером' }],
        memory: {
          mood: { affection: 70, energy: 58 },
          relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 },
          conversationState: { revision: 4, emotionalState: null }
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.affectiveTurn.schema, 'rin-affective-turn-v1');
    assert.equal(res.body.affectiveTurn.turn, 5);
    assert.equal(res.body.affectiveTurn.emotionalState.primary.type, 'jealousy');
    assert.equal(res.body.stateTransition.schema, 'rin-state-transition-v3');
    assert.deepEqual(res.body.stateTransition.emotionalState, res.body.affectiveTurn.emotionalState);
    assert.deepEqual(res.body.stateTransition.relationshipState, res.body.affectiveTurn.relationshipState);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Главная реакция: jealousy/);
    assert.match(prompts[0], /возможную романтическую встречу с другой девушкой/);
    assert.match(prompts[0], /BEHAVIOR POLICY v3/);
    assert.match(prompts[0], /Бюджет вопросов: 0/);
    assert.equal(res.body.responsePlan.behavior.action, 'tease');
    assert.equal(res.body.responsePlan.questionBudget, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat handler rewrites the observed neutral-rival assistant response against active jealousy', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? 'Это звучит захватывающе! Ты уже знаешь, куда пойдёте?'
      : 'Мм. Смело с её стороны. Я, пожалуй, запомню эту деталь.';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'rewrite-rival',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'rewrite-rival', id: 'u-rival-rewrite', content: 'Меня пригласила девушка на встречу вечером' }],
        memory: {
          mood: { affection: 70, energy: 58 },
          relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 }
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.equal(res.body.responsePlan.responseAct, 'contained_jealousy');
    assert.match(res.body.reply, /смело с её стороны|запомню эту деталь/i);
    assert.doesNotMatch(res.body.reply, /захватывающе|отлично|классно/iu);
    assert.doesNotMatch(res.body.reply, /\?/u);
    assert.equal(res.body.verification.needsRewrite, false);
    assert.equal(res.body.promptMetrics.rewriteAttempted, true);
    assert.equal(res.body.promptMetrics.rewriteAccepted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat handler falls back to deterministic behavior when a rewrite still violates the zero-question policy', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? 'Это звучит захватывающе! Ты уже знаешь, куда пойдёте?'
      : 'Мм. И ты решил сказать мне это вот так спокойно?)';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId: 'rewrite-rival-fallback',
        history: [{ role: 'user', kind: 'text', status: 'sent', requestId: 'rewrite-rival-fallback', id: 'u-rival-fallback', content: 'Меня пригласила девушка на встречу вечером' }],
        memory: {
          mood: { affection: 70, energy: 58 },
          relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 }
        }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.equal(res.body.responsePlan.responseAct, 'contained_jealousy');
    assert.equal(res.body.responsePlan.questionBudget, 0);
    assert.doesNotMatch(res.body.reply, /\?/u);
    assert.doesNotMatch(res.body.reply, /захватывающе|отлично|классно/iu);
    assert.equal(res.body.verification.needsRewrite, false);
    assert.equal(res.body.promptMetrics.rewriteAttempted, true);
    assert.equal(res.body.promptMetrics.rewriteAccepted, true);
    assert.equal(res.body.promptMetrics.rewriteFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('chat handler cannot satisfy a take-lead turn with another promise to start', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const content = calls === 1
      ? 'Тогда держись крепче, мы начинаем! 😉'
      : 'Конечно, начинаем! Готовься к увлекательному путешествию в мир наших игр.';
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const requestId = 'agency-follow-through-fallback';
    const history = [
      { role: 'user', kind: 'text', status: 'complete', id: 'u1', content: 'Твой ход 😉' },
      { role: 'assistant', kind: 'text', status: 'complete', id: 'a1', content: 'Креативность — моя сильная сторона, так что готовься к неожиданностям.' },
      { role: 'user', kind: 'text', status: 'complete', id: 'u2', content: 'Да уже уже 😅' },
      { role: 'assistant', kind: 'text', status: 'complete', id: 'a2', content: 'Тогда держись крепче, мы начинаем! 😉' },
      { role: 'user', kind: 'text', status: 'sent', requestId, id: 'u3', content: 'Мы начнем или нет?' }
    ];
    const res = createRes();
    await chat.default(createReq({
      headers: { 'x-rin-pin': '1357' },
      body: {
        requestId,
        history,
        memory: {
          mood: { affection: 72, energy: 58 },
          relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 }
        }
      }
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls, 2);
    assert.equal(res.body.conversationBrain.hiddenIntent.type, 'invite_rin_initiative');
    assert.equal(res.body.conversationBrain.relation.type, 'initiative_handoff');
    assert.equal(res.body.responsePlan.responseAct, 'take_lead');
    assert.equal(res.body.responsePlan.behavior.action, 'continue_scene');
    assert.equal(res.body.responsePlan.questionBudget, 0);
    assert.match(res.body.reply, /Первый ход|инициативу я забрала|первое правило/iu);
    assert.doesNotMatch(res.body.reply, /^(?:конечно[,! ]*)?(?:мы\s+)?начинаем[!. ]*(?:готовься|держись)?/iu);
    assert.equal(res.body.verification.needsRewrite, false);
    assert.equal(res.body.promptMetrics.rewriteAttempted, true);
    assert.equal(res.body.promptMetrics.rewriteFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('memory sanitizer accepts explicit fact retractions only under user namespace', async () => {
  const { sanitizeMemoryResult } = await import('../api/memory.js?epistemic-retractions');
  const out = sanitizeMemoryResult({ factRetractions: [{ path:'user.trait.selfCritical' }, { path:'self.secret' }, { path:'world.x' }] });
  assert.deepEqual(out.factRetractions, [{ path:'user.trait.selfCritical' }]);
  assert.equal(out.schemaVersion, 4);
});
