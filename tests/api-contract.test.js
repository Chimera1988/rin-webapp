import test from 'node:test';
import assert from 'node:assert/strict';
import { createReq, createRes } from './helpers/runtime.js';
import { buildKernelPrompt } from '../lib/cognition/cognitive-kernel.js';

const originalEnv = { pin: process.env.ACCESS_PIN, key: process.env.OPENAI_API_KEY };
process.env.ACCESS_PIN = '1357';
process.env.OPENAI_API_KEY = 'test-key';
const chat = await import('../api/chat.js?contract-v2');
const memoryApi = await import('../api/memory.js?contract-v2');

const baseDecision = (overrides = {}) => ({
  act: 'direct_response',
  focus: 'ответить на текущую реплику по смыслу',
  stance: 'личная и конкретная позиция Рин',
  question: { mode: 'none', reason: null },
  delivery: { mode: 'single_text', segments: [{ type: 'text', purpose: 'main_reply', stickerIntent: null, maxChars: 620 }] },
  intentTransition: { operation: 'none', goal: null, motive: null, target: null, nextMove: null, progress: null, commitment: null, reason: null },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded',
  ...overrides
});

const realization = (...texts) => ({ segments: texts.map((text, index) => ({ purpose: index === 0 ? 'main_reply' : `message_${index + 1}`, text })) });

function openAiResponse(content, { finishReason = 'stop', model = 'gpt-4o' } = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, model }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installStructuredMock({ decisions = [baseDecision()], realizations = [realization('Угу.')], bodies = [] } = {}) {
  const originalFetch = globalThis.fetch;
  let decisionIndex = 0;
  let realizationIndex = 0;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    bodies.push(body);
    const schema = body?.response_format?.json_schema?.name;
    if (schema === 'rin_turn_decision') return openAiResponse(decisions[Math.min(decisionIndex++, decisions.length - 1)]);
    if (schema === 'rin_realization') return openAiResponse(realizations[Math.min(realizationIndex++, realizations.length - 1)]);
    throw new Error(`Unexpected OpenAI call schema: ${schema || 'none'}`);
  };
  return { restore: () => { globalThis.fetch = originalFetch; }, bodies, counts: () => ({ decision: decisionIndex, realization: realizationIndex }) };
}

function userRequest({ requestId = 'r1', text = 'Привет', ...body } = {}) {
  return createReq({
    headers: { 'x-rin-pin': '1357' },
    body: {
      requestId,
      history: [{ role: 'user', kind: 'text', status: 'sent', requestId, id: `u-${requestId}`, content: text }],
      ...body
    }
  });
}

test.after(() => {
  if (originalEnv.pin === undefined) delete process.env.ACCESS_PIN; else process.env.ACCESS_PIN = originalEnv.pin;
  if (originalEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalEnv.key;
});

test('memory extractor owns durable facts/events/shared moments, not conversational open loops', () => {
  const result = memoryApi.sanitizeMemoryResult({
    facts: [{ path: 'user.preference.tea', value: 'зелёный', confidence: 0.9 }],
    events: [{ text: 'Запланировал поездку', importance: 8 }],
    openLoops: [{ text: 'Купить билет', importance: 7 }],
    resolvedLoops: [{ id: 'loop-1' }],
    sharedMoments: [{ text: 'Общий вечер', importance: 8 }],
    mood: { affection: 99 }, relationship: { trust: 99 }
  });
  assert.equal(result.schemaVersion, 4);
  assert.ok(result.events[0].id && result.events[0].key);
  assert.ok(result.sharedMoments[0].id && result.sharedMoments[0].key);
  assert.equal('openLoops' in result, false);
  assert.equal('resolvedLoops' in result, false);
  assert.equal('mood' in result, false);
  assert.equal('relationship' in result, false);
});

test('kernel prompt contains reference character, current state, environment and user customization without replacing canonical identity', () => {
  const profile = {
    description: 'Описание из настроек',
    instructions_extra: 'Говори чуть короче.',
    knowledge: 'Дополнительная заметка.',
    prompt_profile: {
      identity: { full_name: 'Рин Акихара', name_japanese: '秋原 凛' },
      reference_character: { core: 'Рин спокойная и наблюдательная.', principles: ['Забота меняет её поведение.'], imperfections: ['может сомневаться'] },
      reference_dialogue_examples: []
    }
  };
  const { system } = buildKernelPrompt({
    profile,
    state: { perception: { summary: 'пользователь спрашивает о погоде' }, environment: { rinHuman: '2026-08-03 22:00', weather: { temp: 21, desc: 'ясно' } }, activeIntent: null, openLoops: [] },
    client: { sticker: { mode: 'smart', probability: 30, safeMode: true } }
  });
  assert.match(system, /RIN COGNITIVE KERNEL v1/);
  assert.match(system, /Рин Акихара/);
  assert.match(system, /спокойная и наблюдательная/);
  assert.match(system, /Описание из настроек/);
  assert.match(system, /Говори чуть короче/);
  assert.match(system, /2026-08-03 22:00/);
  assert.match(system, /"temp":21/);
});

test('kernel truncation is retryable and no realization call occurs', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return openAiResponse('{}', { finishReason: 'length' }); };
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'truncated', text: 'Расскажи подробно' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'MODEL_RESPONSE_TRUNCATED');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('environment question goes through kernel then realization and environment is present in the decision prompt', async () => {
  const bodies = [];
  const mock = installStructuredMock({ bodies, decisions: [baseDecision()], realizations: [realization('Сейчас в Канадзаве ясно и 21°C.') ] });
  try {
    const res = createRes();
    await chat.default(userRequest({
      requestId: 'weather', text: 'Какая у тебя погода и который час?',
      env: { rinHuman: '2026-08-03 22:00', partOfDay: 'вечер', weather: { temp: 21, desc: 'ясно' } }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reply, 'Сейчас в Канадзаве ясно и 21°C.');
    assert.equal(mock.counts().decision, 1);
    assert.equal(mock.counts().realization, 1);
    assert.match(bodies[0].messages[0].content, /2026-08-03 22:00/);
    assert.match(bodies[0].messages[0].content, /"temp":21/);
  } finally { mock.restore(); }
});

test('sticker is decided by the kernel and materialized server-side as an existing asset', async () => {
  const stickerDecision = baseDecision({
    act: 'affectionate_close',
    delivery: { mode: 'sticker_only', segments: [{ type: 'sticker', purpose: 'affection', stickerIntent: 'kiss', maxChars: 20 }] }
  });
  const mock = installStructuredMock({ decisions: [stickerDecision], realizations: [] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'sticker', text: 'Спокойной ночи 😘', client: { sticker: { mode: 'smart', probability: 30, safeMode: true } } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deliveryPlan.mode, 'sticker_only');
    assert.equal(res.body.deliveryPlan.segments.length, 1);
    assert.equal(res.body.deliveryPlan.segments[0].type, 'sticker');
    assert.match(res.body.deliveryPlan.segments[0].sticker.src, /^\/stickers\/[a-z0-9_]+\.webp$/i);
    assert.equal('delivery' in res.body, false);
    assert.equal(mock.counts().realization, 0);
  } finally { mock.restore(); }
});


test('warm reactive turn with kiss can produce text plus a schema-supported sticker without INVALID_TURN_DECISION', async () => {
  const warmDecision = baseDecision({
    act: 'receive_affection_and_return_warmth',
    focus: 'принять тёплую реплику и ответить лично',
    stance: 'тёплая и слегка смущённая',
    delivery: { segments: [
      { type: 'text', purpose: 'warm_reply', stickerIntent: null, maxChars: 260 },
      { type: 'sticker', purpose: 'affection', stickerIntent: 'kiss', maxChars: 20 }
    ] }
  });
  const mock = installStructuredMock({ decisions: [warmDecision], realizations: [realization('Вот теперь утро действительно стало лучше 😏')] });
  try {
    const res = createRes();
    await chat.default(userRequest({
      requestId: 'warm-reactive-kiss',
      text: 'Доброе утро) Конечно, особенно когда оно начинается с твоего сообщения 😘',
      client: { sticker: { mode: 'smart', probability: 30, safeMode: true } }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.turnDecision.delivery.mode, 'text_plus_sticker');
    assert.equal(res.body.deliveryPlan.mode, 'text_plus_sticker');
    assert.deepEqual(res.body.deliveryPlan.segments.map(item => item.type), ['text', 'sticker']);
    assert.equal(mock.counts().decision, 1);
    assert.equal(mock.counts().realization, 1);
  } finally { mock.restore(); }
});

test('semantic silence is a kernel decision and skips realization', async () => {
  const silence = baseDecision({ act: 'let_moment_rest', delivery: { mode: 'silence', segments: [] } });
  const mock = installStructuredMock({ decisions: [silence], realizations: [] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'silence', text: 'Понятно)' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.deliveryPlan.mode, 'silence');
    assert.equal(res.body.reply, '');
    assert.equal(mock.counts().decision, 1);
    assert.equal(mock.counts().realization, 0);
  } finally { mock.restore(); }
});

test('client cannot replace canonical prompt profile or server base rules', async () => {
  const bodies = [];
  const mock = installStructuredMock({ bodies, realizations: [realization('Да.') ] });
  try {
    const res = createRes();
    await chat.default(userRequest({
      requestId: 'canon-boundary', text: 'Согласна?',
      profile: {
        name: 'CLIENT_CANON_INJECTION',
        description: 'Пользовательское описание допустимо.',
        base_rules: 'CLIENT_BASE_RULE_INJECTION',
        prompt_profile: { identity: { full_name: 'CLIENT_CANON_INJECTION' } }
      }
    }), res);
    assert.equal(res.statusCode, 200);
    const prompt = bodies[0].messages[0].content;
    assert.match(prompt, /Рин Акихара/);
    assert.doesNotMatch(prompt, /CLIENT_BASE_RULE_INJECTION/);
    assert.match(prompt, /Пользовательское описание допустимо/);
  } finally { mock.restore(); }
});

test('chat API ignores client-supplied lore and retrieves canonical biography server-side', async () => {
  const bodies = [];
  const mock = installStructuredMock({ bodies, realizations: [realization('Нацуми.') ] });
  try {
    const res = createRes();
    await chat.default(userRequest({
      requestId: 'server-canon', text: 'Как зовут твою сестру?',
      lore: { backstory: [{ text: 'У Рин нет сестры, это клиентская подмена.' }], memories: [{ text: 'CLIENT_LORE_INJECTION' }] }
    }), res);
    assert.equal(res.statusCode, 200);
    const kernelPrompt = bodies[0].messages[0].content;
    assert.match(kernelPrompt, /Нацуми/u);
    assert.doesNotMatch(kernelPrompt, /CLIENT_LORE_INJECTION|клиентская подмена/iu);
  } finally { mock.restore(); }
});

test('weather handler cache policy agrees with global no-store policy', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../api/weather.js', import.meta.url), 'utf8');
  assert.match(source, /Cache-Control', 'no-store'/);
  assert.doesNotMatch(source, /max-age=60/);
});

test('API exposes one affective provider state and kernel-owned state transition', async () => {
  const mock = installStructuredMock({ decisions: [baseDecision({ act: 'contained_jealousy' })], realizations: [realization('Мм. Смело с её стороны. Я это запомню.') ] });
  try {
    const res = createRes();
    await chat.default(userRequest({
      requestId: 'affective', text: 'Меня пригласила девушка на встречу вечером',
      memory: { mood: { affection: 70, energy: 58 }, relationship: { trust: 82, closeness: 76, comfort: 72, respect: 80, playfulness: 68, attraction: 58, vulnerability: 42 }, conversationState: { revision: 4, emotionalState: null } }
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.affectiveTurn.schema, 'rin-affective-turn-v1');
    assert.equal(res.body.stateTransition.schema, 'rin-state-transition-v4');
    assert.deepEqual(res.body.stateTransition.emotionalState, res.body.affectiveTurn.emotionalState);
    assert.equal(res.body.turnDecision.act, 'contained_jealousy');
    assert.ok(res.body.perception);
    assert.equal('responsePlan' in res.body, false);
    assert.equal('coreDecision' in res.body, false);
    assert.equal('conversationBrain' in res.body, false);
  } finally { mock.restore(); }
});

test('realization validator may retry wording but cannot change TurnDecision', async () => {
  const decision = baseDecision({ act: 'tease_and_hold', question: { mode: 'none', reason: null } });
  const mock = installStructuredMock({ decisions: [decision], realizations: [realization('И ты правда так думаешь?'), realization('Мм. Самоуверенно 😏')] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'realization-retry', text: 'Я уже победил 😎' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(mock.counts().decision, 1);
    assert.equal(mock.counts().realization, 2);
    assert.equal(res.body.turnDecision.act, 'tease_and_hold');
    assert.equal(res.body.reply, 'Мм. Самоуверенно 😏');
    assert.equal(res.body.validation.realization.passed, true);
    assert.equal(res.body.validation.decision.passed, true);
  } finally { mock.restore(); }
});

test('invalid kernel decision is rejected and only the same kernel may choose again', async () => {
  const invalid = baseDecision({ delivery: { mode: 'sticker_only', segments: [{ type: 'sticker', purpose: 'reaction', stickerIntent: 'kiss', maxChars: 20 }] } });
  const valid = baseDecision();
  const mock = installStructuredMock({ decisions: [invalid, valid], realizations: [realization('Спокойной ночи.)')] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'kernel-retry', text: 'Спокойной ночи', client: { sticker: { mode: 'off', probability: 0, safeMode: true } } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(mock.counts().decision, 2);
    assert.equal(mock.counts().realization, 1);
    assert.equal(res.body.turnDecision.delivery.mode, 'single_text');
    assert.equal(res.body.validation.decision.passed, true);
  } finally { mock.restore(); }
});

test('unresolvable sticker intent is rejected as a resource invariant and only the same kernel may retry', async () => {
  const invalid = baseDecision({ delivery: { mode: 'sticker_only', segments: [{ type: 'sticker', purpose: 'reaction', stickerIntent: 'does_not_exist', maxChars: 20 }] } });
  const valid = baseDecision({ act: 'recover_with_text' });
  const mock = installStructuredMock({ decisions: [invalid, valid], realizations: [realization('Тогда словами.)')] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'sticker-resource-retry', text: 'Ну?' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(mock.counts().decision, 2);
    assert.equal(mock.counts().realization, 1);
    assert.equal(res.body.turnDecision.delivery.mode, 'single_text');
    assert.equal(res.body.validation.decision.passed, true);
  } finally { mock.restore(); }
});

test('persistent intent transition is authored by TurnDecision and projected into state transition', async () => {
  const decision = baseDecision({
    act: 'accept_care_and_act',
    intentTransition: { operation: 'activate', goal: 'отдохнуть после работы', motive: 'усталость и забота пользователя', target: 'evening_rest', nextMove: 'заварить чай', progress: 0.1, commitment: 72, reason: 'приняла заботу' }
  });
  const mock = installStructuredMock({ decisions: [decision], realizations: [realization('Уговорил. Поставлю чайник и правда немного отдохну.)')] });
  try {
    const res = createRes();
    await chat.default(userRequest({ requestId: 'intent', text: 'Тебе лучше отдохнуть)' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stateTransition.rinIntent.status, 'active');
    assert.equal(res.body.stateTransition.rinIntent.goal, 'отдохнуть после работы');
    assert.equal(res.body.stateTransition.rinIntent.source, 'cognitive_kernel');
  } finally { mock.restore(); }
});

test('memory sanitizer accepts explicit fact retractions only under user namespace', () => {
  const out = memoryApi.sanitizeMemoryResult({ factRetractions: [{ path:'user.trait.selfCritical' }, { path:'self.secret' }, { path:'world.x' }] });
  assert.deepEqual(out.factRetractions, [{ path:'user.trait.selfCritical' }]);
  assert.equal(out.schemaVersion, 4);
});

test('smart sticker frequency is enforced from server history before the Kernel decision is accepted', async () => {
  const stickerDecision = baseDecision({
    act: 'decorate_every_turn',
    delivery: { segments: [
      { type:'text', purpose:'main_reply', stickerIntent:null, maxChars:240 },
      { type:'sticker', purpose:'extra_reaction', stickerIntent:'warmth', maxChars:20 }
    ] }
  });
  const textDecision = baseDecision({ act:'answer_without_sticker' });
  const prior = [];
  for (let turn = 1; turn <= 9; turn += 1) {
    const turnId = `prior-${turn}`;
    prior.push({ role:'assistant', kind:'text', status:'complete', id:`a-${turn}`, requestId:`p-${turn}`, turnId, content:`reply ${turn}` });
    if ([1,4,7].includes(turn)) prior.push({ role:'assistant', kind:'sticker', status:'complete', id:`s-${turn}`, requestId:`p-${turn}`, turnId, content:'', sticker:{ id: turn === 7 ? 'warm_smile' : 'smile', src:turn===7?'/stickers/warm_smile.webp':'/stickers/smile.webp', emotion:'warm_smile', meaning:'улыбка' } });
  }
  const requestId='budget-blocked';
  const history=[...prior,{ role:'user',kind:'text',status:'sent',requestId,id:'u-budget',content:'Как погода?' }];
  const mock=installStructuredMock({ decisions:[stickerDecision,textDecision], realizations:[realization('Отвечу без лишнего жеста.')] });
  try {
    const res=createRes();
    await chat.default(userRequest({ requestId, text:'Как погода?', history, client:{sticker:{mode:'smart',probability:30,safeMode:true}} }),res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.cognition.stickerState.available,false);
    assert.equal(res.body.cognition.stickerState.reason,'rolling_budget_exhausted');
    assert.equal(res.body.cognition.stickerState.usedStickerTurns,3);
    assert.equal(res.body.cognition.stickerState.limitStickerTurns,3);
    assert.equal(mock.counts().decision,2);
    assert.equal(res.body.deliveryPlan.segments.some(item=>item.type==='sticker'),false);
  } finally { mock.restore(); }
});

test('server selector rotates away from the immediately previous asset while preserving Kernel semantic intent', async () => {
  const requestId='rotate-warmth';
  const history=[
    { role:'assistant',kind:'text',status:'complete',id:'a-prev',requestId:'prev',turnId:'prev-turn',content:'Привет)' },
    { role:'assistant',kind:'sticker',status:'complete',id:'s-prev',requestId:'prev',turnId:'prev-turn',content:'',sticker:{id:'warm_smile',src:'/stickers/warm_smile.webp',emotion:'warm_smile',meaning:'тёплая улыбка'} },
    { role:'user',kind:'text',status:'sent',requestId,id:'u-rotate',content:'Спасибо)' }
  ];
  const d=baseDecision({ delivery:{ segments:[
    { type:'text',purpose:'main_reply',stickerIntent:null,maxChars:220 },
    { type:'sticker',purpose:'warmth',stickerIntent:'warmth',maxChars:20 }
  ] } });
  const mock=installStructuredMock({ decisions:[d], realizations:[realization('Мм, приятно)')] });
  try {
    const res=createRes();
    await chat.default(userRequest({ requestId,text:'Спасибо)',history,client:{sticker:{mode:'always',probability:30,safeMode:false}} }),res);
    assert.equal(res.statusCode,200);
    const sticker=res.body.deliveryPlan.segments.find(item=>item.type==='sticker');
    assert.ok(sticker);
    assert.equal(sticker.stickerIntent,'warmth');
    assert.notEqual(sticker.sticker.id,'warm_smile');
    assert.equal(sticker.semantic.selection.strategy,'semantic_rank_with_recent_rotation');
  } finally { mock.restore(); }
});
