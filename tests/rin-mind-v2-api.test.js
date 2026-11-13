import { enableTestSecurity } from './helpers/security.js';
const releaseSecurity = enableTestSecurity();
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
process.env.OPENAI_MIND_MODEL = 'gpt-6-luna';

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
      responseDepth: 'normal',
      messageShape: 'single',
      segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320, text }]
    },
    intentTransition: {
      operation: 'none', goal: null, motive: null, target: null,
      nextMove: null, progress: null, commitment: null, reason: null
    },
    openLoops: { open: [], resolveIds: [] },
    realityMode: 'grounded',
    mind: {
      sceneMotif: 'direct_exchange',
      lifeDomain: 'none',
      lifeMotif: null,
      frameAlignment: 'aligned',
      literalCorrection: 'none',
      referenceAnchor: null,
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
    assert.equal(body?.model, 'gpt-6-luna');
    assert.equal(body?.reasoning_effort, 'none');
    assert.equal(body?.temperature, 0.58);
    assert.equal(body?.max_completion_tokens, 1200);
    assert.equal('max_tokens' in body, false);
    assert.deepEqual(body?.prompt_cache_options, { mode: 'explicit', ttl: '30m' });
    assert.equal(body?.messages?.length, 2);
    assert.equal(body.messages[0].role, 'developer');
    assert.ok(Array.isArray(body.messages[0].content));
    assert.equal(body.messages[0].content.length, 1);
    assert.deepEqual(body.messages[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
    assert.doesNotMatch(body.messages[0].content[0].text, /Ты тут\?/u);
    assert.equal(body.messages[1].role, 'developer');
    assert.match(String(body.messages[1].content), /Ты тут\?/u);
    assert.match(String(body.prompt_cache_key || ''), /^rin-mind-[a-f0-9]{40}$/u);
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
    assert.match(res.body.reply, /сбоя/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('GPT-6 request compatibility removes temperature above none reasoning', async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (_url, options = {}) => {
    captured = JSON.parse(options.body || '{}');
    return openAiResponse(mindTurn('ok'));
  };
  try {
    await chat.openaiChat({
      model: 'gpt-6-luna',
      messages: [{ role: 'system', content: 'x' }],
      temperature: 0.58,
      max_tokens: 1200,
      reasoning_effort: 'low'
    });
    assert.equal(captured.model, 'gpt-6-luna');
    assert.equal(captured.reasoning_effort, 'low');
    assert.equal(captured.max_completion_tokens, 1200);
    assert.equal('max_tokens' in captured, false);
    assert.equal('temperature' in captured, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('explicit prompt caching is enabled only for GPT-5.6+ and keeps rollback models plain', () => {
  const prompt = { system: 'stable\n\ndynamic', stableSystem: 'stable', dynamicSystem: 'dynamic' };
  const luna = chat.buildMindMessages(prompt, 'gpt-6-luna');
  assert.ok(Array.isArray(luna[0].content));
  assert.deepEqual(luna[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
  assert.equal(chat.supportsExplicitPromptCache('gpt-6-luna'), true);
  assert.equal(chat.supportsExplicitPromptCache('gpt-5.6-luna'), true);
  assert.equal(chat.supportsExplicitPromptCache('gpt-5.4-mini'), false);
  assert.equal(chat.supportsExplicitPromptCache('gpt-4.1'), false);

  const rollback = chat.buildMindMessages(prompt, 'gpt-4.1');
  assert.deepEqual(rollback, [{ role: 'system', content: 'stable\n\ndynamic' }]);
});

test('full long current turn and code line breaks reach the model through the HTTP handler', async () => {
  const previous=globalThis.fetch;
  const text='Разбери этот код:\nconst answer = 42;\n'+ 'Деталь '.repeat(900)+'ФИНАЛЬНЫЙ_ВОПРОС';
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    const dynamic=body.messages.at(-1).content;
    assert.ok(dynamic.includes('ФИНАЛЬНЫЙ_ВОПРОС'));
    assert.ok(dynamic.includes('код:\\nconst answer = 42;\\n'));
    return openAiResponse(mindTurn('Сначала посмотрю на условие.'));
  };
  try {
    const res=createRes();await chat.default(userRequest({requestId:'audit-long',text}),res);
    assert.equal(res.statusCode,200);assert.equal(calls,1);
  } finally {globalThis.fetch=previous;}
});

test('honest identity statements without punctuation do not trigger paid repair or fallback', async () => {
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return openAiResponse(mindTurn('Я программа, а Рин — мой образ для общения.'));};
  try {
    for(const text of ['Расскажи честно, кто ты','Ты бот?','Не притворяйся человеком']) {
      const res=createRes();await chat.default(userRequest({requestId:`audit-truth-${calls}`,text}),res);
      assert.equal(res.statusCode,200);
      assert.equal(res.body.promptMetrics.semanticRetries,0);
      assert.equal(res.body.promptMetrics.modelFallback,false);
      assert.match(res.body.reply,/Я программа/u);
    }
    assert.equal(calls,3);
  } finally {globalThis.fetch=previous;}
});

test('memory queue and extraction preserve a correction at the end of a long user turn', async () => {
  const {MemoryStorage}=await import('./helpers/runtime.js');
  const {enqueueMemoryJob,loadMemoryJobs}=await import('../public/js/memory_job_queue.js');
  const memory=await import('../api/memory.js?audit-long-memory');
  const storage=new MemoryStorage();
  const userText='Описание дня. '.repeat(450)+'Поправка: я теперь живу в Казани.';
  enqueueMemoryJob({id:'long-correction',userText,assistantText:'Запомнила поправку.'},storage);
  const job=loadMemoryJobs(storage)[0];
  assert.ok(job.userText.endsWith('живу в Казани.'));
  const previous=globalThis.fetch;
  let observed='';
  globalThis.fetch=async(_url,options)=>{
    observed=JSON.parse(options.body).messages.at(-1).content;
    return openAiResponse({facts:[{path:'user.city',value:'Казань',confidence:1}]});
  };
  try {
    const res=createRes();
    await memory.default(createReq({headers:{'x-rin-pin':'1357'},body:job}),res);
    assert.equal(res.statusCode,200);
    assert.ok(observed.includes('Поправка: я теперь живу в Казани.'));
    assert.equal(res.body.facts[0].value,'Казань');
  } finally {globalThis.fetch=previous;}
});
