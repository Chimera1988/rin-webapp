import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';

const originalEnv = {
  pin: process.env.ACCESS_PIN,
  key: process.env.OPENAI_API_KEY,
  mind: process.env.OPENAI_MIND_MODEL
};
process.env.ACCESS_PIN = '1357';
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_MIND_MODEL = 'gpt-4.1';

const chat = await import('../api/chat.js?rin-mind-v2-contract');

function restoreEnv() {
  if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
  if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
  if (originalEnv.mind === undefined) delete process.env.OPENAI_MIND_MODEL; else process.env.OPENAI_MIND_MODEL = originalEnv.mind;
}

test.after(restoreEnv);

function mindTurn(text, overrides = {}) {
  return {
    act: 'personal_response',
    focus: 'ответить по смыслу как Рин',
    stance: 'личная и естественная',
    question: { mode: 'none', reason: null },
    replyLink: { targetEventId: null, reason: null },
    delivery: {
      segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320, text }]
    },
    intentTransition: {
      operation: 'none', goal: null, motive: null, target: null,
      nextMove: null, progress: null, commitment: null, reason: null
    },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      felt: 'спокойная вовлечённость',
      wants: 'сохранить естественный контакт',
      restraint: null,
      socialIntent: 'respond',
      confidence: 90
    },
    ...overrides
  };
}

function openAiResponse(content, { finishReason = 'stop' } = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    model: 'gpt-4.1-test'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function userRequest({ requestId = 'r1', text = 'Привет', history = null, ...body } = {}) {
  return createReq({
    headers: { 'x-rin-pin': '1357' },
    body: {
      requestId,
      history: history || [{ role: 'user', kind: 'text', status: 'sent', requestId, id: `u-${requestId}`, content: text }],
      client: { sticker: { mode: 'off', probability: 0, safeMode: true } },
      ...body
    }
  });
}

test('normal Rin Mind turn uses one semantic model request', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    bodies.push(body);
    assert.equal(body?.response_format?.json_schema?.name, 'rin_mind_turn_v2');
    return openAiResponse(mindTurn('Угу, я здесь)'));
  };
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'one-call', text: 'Ты тут?' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(bodies.length, 1);
    assert.equal(res.body.reply, 'Угу, я здесь)');
    assert.equal(res.body.promptMetrics.calls.mind, 1);
    assert.equal(res.body.promptMetrics.calls.kernel, 0);
    assert.equal(res.body.promptMetrics.calls.realization, 0);
    assert.equal(res.body.promptMetrics.semanticRetries, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stop-questions boundary cannot become a validation failure or trigger a second semantic call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return openAiResponse(mindTurn('Ладно, отступаю) А что бы ты всё-таки рассказал?', {
      act: 'playful_retreat',
      focus: 'уважить просьбу пользователя прекратить вопросы',
      question: { mode: 'natural', reason: 'curiosity' },
      mind: {
        felt: 'игривое принятие', wants: 'не давить', restraint: 'пользователь попросил без вопросов',
        socialIntent: 'respect_boundary', confidence: 94
      }
    }));
  };
  try {
    const requestId = 'stop-questions';
    const res = createRes();
    await chat.default(userRequest({
      requestId,
      text: 'Хватит вопросов пока)',
      history: [
        { role: 'assistant', kind: 'text', status: 'complete', requestId: 'prev', turnId: 'prev-turn', id: 'a-prev', content: 'А что бы ты рассказал первым?' },
        { role: 'user', kind: 'text', status: 'sent', requestId, id: 'u-stop', content: 'Хватит вопросов пока)' }
      ]
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 1);
    assert.equal(res.body.turnDecision.question.mode, 'none');
    assert.equal(res.body.reply.includes('?'), false);
    assert.match(res.body.reply, /Ладно, отступаю/iu);
    assert.equal(res.body.promptMetrics.semanticRetries, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid structured model output degrades locally instead of making a semantic retry', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return openAiResponse('{definitely-not-json');
  };
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'local-fallback', text: 'Ясно)' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls, 1);
    assert.equal(res.body.promptMetrics.modelFallback, true);
    assert.equal(res.body.promptMetrics.semanticRetries, 0);
    assert.ok(res.body.reply.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
