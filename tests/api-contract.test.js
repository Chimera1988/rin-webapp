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
  assert.equal(result.schemaVersion, 3);
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
