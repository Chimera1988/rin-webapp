import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeTurnDecision, applyIntentTransition, buildDecisionStateTransition, buildTurnDecisionJsonSchema } from '../lib/cognition/turn-decision.js';
import { validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildDeliveryPlan } from '../api/chat.js';

const decision = overrides => normalizeTurnDecision({
  act: 'answer_and_continue', focus: 'ответить конкретно', stance: 'спокойная',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: { mode: 'single_text', segments: [{ type: 'text', purpose: 'answer', stickerIntent: null, maxChars: 300 }] },
  intentTransition: { operation: 'none' }, openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded',
  ...(overrides || {})
});


test('strict TurnDecision schema eliminates free-form sticker intents and impossible state transitions before validation', () => {
  const normal = buildTurnDecisionJsonSchema({ activeIntent: null, conversationState: 'ongoing', allowStickers: true });
  const delivery = normal.schema.properties.delivery;
  assert.deepEqual(delivery.required, ['segments']);
  assert.equal('mode' in delivery.properties, false);
  const segment = delivery.properties.segments.items.properties;
  assert.ok(segment.stickerIntent.enum.includes('kiss'));
  assert.ok(segment.stickerIntent.enum.includes('tender'));
  assert.equal(segment.stickerIntent.enum.includes('affectionate_kiss'), false);
  assert.deepEqual(normal.schema.properties.intentTransition.properties.operation.enum, ['none', 'activate']);

  const stickerOff = buildTurnDecisionJsonSchema({ activeIntent: null, conversationState: 'ongoing', allowStickers: false });
  assert.deepEqual(stickerOff.schema.properties.delivery.properties.segments.items.properties.type.enum, ['text']);
  assert.deepEqual(stickerOff.schema.properties.delivery.properties.segments.items.properties.stickerIntent.enum, [null]);

  const endingLive = buildTurnDecisionJsonSchema({ activeIntent: { status: 'active', goal: 'rest' }, conversationState: 'ending', allowStickers: true });
  assert.deepEqual(endingLive.schema.properties.intentTransition.properties.operation.enum, ['complete', 'cancel']);
});

test('TurnDecision is the sole owner of persistent intent lifecycle transitions', () => {
  const activated = applyIntentTransition(null, decision({ intentTransition: {
    operation: 'activate', goal: 'отдохнуть после работы', motive: 'усталость', target: 'rest_after_work', nextMove: 'make_tea', commitment: 76, progress: 0.1, reason: 'приняла заботу'
  }}), { revision: 4, scene: 'evening' });
  assert.equal(activated.status, 'active');
  assert.equal(activated.goal, 'отдохнуть после работы');
  const preserved = applyIntentTransition(activated, decision({ intentTransition: { operation: 'preserve' } }), { revision: 5, scene: 'evening' });
  assert.equal(preserved.id, activated.id);
  const completed = applyIntentTransition(preserved, decision({ intentTransition: { operation: 'complete', reason: 'вечер завершён' } }), { revision: 6, scene: 'farewell' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 1);
});

test('kernel state reads conversational open loops only from ConversationState and protects sticker metadata', () => {
  const state = buildKernelState({
    requestId: 'r1', userText: 'А что это за стикер?',
    history: [
      { id: 's1', role: 'assistant', kind: 'sticker', status: 'complete', content: '[Невербальный жест Рин: поцелуй]', sticker: { id: 'kiss', meaning: 'поцелуй', cause: 'тёплое прощание' } },
      { id: 'u1', role: 'user', kind: 'text', status: 'sent', requestId: 'r1', content: 'А что это за стикер?' }
    ],
    memory: {
      openLoops: [{ id: 'legacy', subject: 'не должен попасть' }],
      conversationState: { revision: 3, openLoops: [{ id: 'loop-1', subject: 'пари о десяти поцелуях', status: 'active', importance: 7 }] }
    },
    brain: { literalIntent: 'question', relation: { type: 'follow_up' }, activeScene: { type: 'playful_flirt', goal: 'продолжить линию' } },
    affectiveTurn: null
  });
  assert.equal(state.openLoops.length, 1);
  assert.match(state.openLoops[0].subject, /поцелу/iu);
  const sticker = state.recentHistory.find(item => item.kind === 'sticker');
  assert.equal(sticker.content, null);
  assert.equal(sticker.sticker.meaning, 'поцелуй');
});

test('decision validator enforces protocol without choosing a replacement behavior', () => {
  const withSticker = decision({ delivery: { mode: 'sticker_only', segments: [{ type: 'sticker', purpose: 'kiss', stickerIntent: 'kiss', maxChars: 20 }] } });
  const blocked = validateTurnDecisionConstraints(withSticker, { client: { sticker: { mode: 'off' } } });
  assert.equal(blocked.passed, false);
  assert.deepEqual(blocked.warnings, ['sticker_disabled_by_user']);

  const farewellActivation = validateTurnDecisionConstraints(decision({ intentTransition: { operation: 'activate', goal: 'новая линия' } }), { conversationState: 'ending' });
  assert.equal(farewellActivation.passed, false);
  assert.ok(farewellActivation.warnings.includes('farewell_cannot_activate_intent'));

  const activeIntent = { status: 'active', goal: 'отдохнуть после работы' };
  const farewellPreserve = validateTurnDecisionConstraints(decision({ intentTransition: { operation: 'preserve' } }), { conversationState: 'ending', activeIntent });
  assert.equal(farewellPreserve.passed, false);
  assert.ok(farewellPreserve.warnings.includes('farewell_must_close_live_intent'));

  const silenceQuestion = validateTurnDecisionConstraints(decision({
    question: { mode: 'natural', reason: 'лишний вопрос' },
    delivery: { mode: 'silence', segments: [] }
  }));
  assert.equal(silenceQuestion.passed, false);
  assert.ok(silenceQuestion.warnings.includes('silence_cannot_have_question'));

  const terminal = { status: 'completed', goal: 'отдохнуть после работы' };
  const resurrect = validateTurnDecisionConstraints(decision({ intentTransition: { operation: 'activate', goal: 'отдохнуть после работы' } }), { activeIntent: terminal });
  assert.equal(resurrect.passed, false);
  assert.ok(resurrect.warnings.includes('terminal_intent_cannot_reactivate_same_goal'));
  assert.equal('replacementDecision' in farewellActivation, false);
});

test('active chat runtime imports one Cognitive Kernel and does not import legacy decision owners', async () => {
  const source = await readFile(new URL('../api/chat.js', import.meta.url), 'utf8');
  assert.match(source, /cognitive-kernel\.js/);
  for (const legacy of ['behavior-policy.js', 'response-planner.js', 'response-verifier.js', 'core-personality.js', 'character-intent-engine.js', 'relationship-engine.js', 'anti-gpt.js']) {
    assert.doesNotMatch(source, new RegExp(legacy.replace('.', '\\.')));
  }
  assert.doesNotMatch(source, /gpt-4o-mini/);
  assert.match(source, /OPENAI_DECISION_MODEL/);
  assert.match(source, /OPENAI_REALIZATION_MODEL/);
});

test('state transition carries only kernel-authored open-loop and intent operations', () => {
  const state = {
    revision: 2, scene: { type: 'evening' }, dialogueState: { schema: 'rin-dialogue-state-v1', scene: 'evening' },
    activeIntent: null, beliefModel: { beliefs: [], currentStatement: null, correction: null }
  };
  const transition = buildDecisionStateTransition({ kernelState: state, decision: decision({
    intentTransition: { operation: 'activate', goal: 'отдохнуть', target: 'rest', nextMove: 'чай' },
    openLoops: { open: [{ subject: 'пари о десяти поцелуях', type: 'shared_joke', importance: 7 }], resolveIds: [] }
  }) });
  assert.equal(transition.rinIntent.status, 'active');
  assert.equal(transition.openLoopUpdates.length, 1);
  assert.equal(transition.openLoopUpdates[0].source, 'cognitive_kernel');
});

test('active Kernel perception consumes semantic signals, not legacy behavior directives', () => {
  const state = buildKernelState({
    requestId: 'r-perception', userText: 'Давай, твоя очередь 😏',
    history: [{ id:'u', role:'user', kind:'text', status:'sent', requestId:'r-perception', content:'Давай, твоя очередь 😏' }],
    memory: { conversationState: { revision: 1, openLoops: [] } },
    brain: {
      literalIntent: 'statement', hiddenIntent: { type:'invite_rin_initiative' }, relation: { type:'initiative_handoff' },
      referents: [], ambiguity: { level: 10, shouldClarify:false },
      obligations: ['Сделай один уверенный игровой ход.'], responseFocus: 'Выполни игровой ход прямо сейчас.',
      activeScene: { type:'playful_flirt', goal:'продолжить игру', confidence:90 }
    }
  });
  assert.ok(state.perception.signals.includes('user_handed_initiative'));
  assert.equal('obligations' in state.perception, false);
  assert.equal('responseFocus' in state.perception, false);
  assert.doesNotMatch(JSON.stringify(state.perception), /уверенный игровой ход|выполни игровой ход/iu);
});

test('TurnDecision normalization derives structural delivery mode but never invents semantic beats or sticker intent', () => {
  const oneBeat = normalizeTurnDecision({
    act:'continue', focus:'continue', stance:'warm', question:{mode:'none',reason:null},
    delivery:{ mode:'multi_message', segments:[{type:'text',purpose:'only',stickerIntent:null,maxChars:120}] },
    intentTransition:{operation:'none'}, openLoops:{open:[],resolveIds:[]}, realityMode:'grounded'
  });
  assert.equal(oneBeat.delivery.segments.length, 1);
  assert.equal(oneBeat.delivery.mode, 'single_text');
  assert.equal(validateTurnDecisionConstraints(oneBeat).passed, true);

  const missingStickerIntent = normalizeTurnDecision({
    act:'gesture', focus:'gesture', stance:'warm', question:{mode:'none',reason:null},
    delivery:{ mode:'sticker_only', segments:[{type:'sticker',purpose:'gesture',stickerIntent:null,maxChars:20}] },
    intentTransition:{operation:'none'}, openLoops:{open:[],resolveIds:[]}, realityMode:'grounded'
  });
  assert.equal(missingStickerIntent.delivery.segments[0].stickerIntent, null);
  assert.ok(validateTurnDecisionConstraints(missingStickerIntent).warnings.includes('sticker_segment_requires_intent'));
});


test('DeliveryPlan sticker metadata follows the kernel-authored segment order', async () => {
  const before = decision({ delivery:{ segments:[
    {type:'sticker',purpose:'gesture',stickerIntent:'kiss',maxChars:20},
    {type:'text',purpose:'reply',stickerIntent:null,maxChars:120}
  ] } });
  const beforePlan = await buildDeliveryPlan({ requestId:'r-before-sticker', decision:before, realization:{ segments:[{text:'Поймала 😏'}] } });
  assert.equal(beforePlan.mode, 'text_plus_sticker');
  assert.equal(beforePlan.segments[0].semantic.delivery, 'before_text');

  const after = decision({ delivery:{ segments:[
    {type:'text',purpose:'reply',stickerIntent:null,maxChars:120},
    {type:'sticker',purpose:'gesture',stickerIntent:'kiss',maxChars:20}
  ] } });
  const afterPlan = await buildDeliveryPlan({ requestId:'r-after-sticker', decision:after, realization:{ segments:[{text:'Поймала 😏'}] } });
  assert.equal(afterPlan.segments[1].semantic.delivery, 'after_text');
});

test('DeliveryPlan binds realized text by segment order even when purposes repeat', async () => {
  const d = decision({ delivery:{ mode:'multi_message', segments:[
    {type:'text',purpose:'beat',stickerIntent:null,maxChars:100},
    {type:'text',purpose:'beat',stickerIntent:null,maxChars:100}
  ] } });
  const plan = await buildDeliveryPlan({ requestId:'r-order', decision:d, realization:{ segments:[
    {type:'text',purpose:'beat',text:'Первый пузырь'},
    {type:'text',purpose:'beat',text:'Второй пузырь'}
  ] } });
  assert.deepEqual(plan.segments.map(item => item.text), ['Первый пузырь', 'Второй пузырь']);
});

test('visual reply is structurally unavailable for ordinary single-message turns and limited to earlier batch events', () => {
  const single = buildTurnDecisionJsonSchema({ replyCandidateIds: [] });
  assert.deepEqual(single.schema.properties.replyLink.properties.targetEventId.enum,[null]);

  const batched = buildTurnDecisionJsonSchema({ replyCandidateIds: ['u-first','u-second'] });
  assert.deepEqual(batched.schema.properties.replyLink.properties.targetEventId.enum,[null,'u-first','u-second']);

  const invalid = decision({ replyLink:{targetEventId:'u-last',reason:'не должен быть разрешён'} });
  const validation = validateTurnDecisionConstraints(invalid,{visualReplyCandidates:[{eventId:'u-first'}]});
  assert.equal(validation.passed,false);
  assert.ok(validation.warnings.includes('visual_reply_target_not_allowed'));
});

test('kernel state observes one-sided questioning without forcing curiosity on an unrelated statement', () => {
  const history = [
    { role:'user', kind:'text', status:'complete', id:'u1', content:'Как твой день?' },
    { role:'assistant', kind:'text', status:'complete', id:'a1', content:'Спокойный, уже выдыхаю.' },
    { role:'user', kind:'text', status:'complete', id:'u2', content:'А настроение как?' },
    { role:'assistant', kind:'text', status:'complete', id:'a2', content:'Ровное. Мне сейчас хорошо.' },
    { role:'user', kind:'text', status:'sent', requestId:'r-curiosity', id:'u3', content:'Я сегодня наконец закончил сложную задачу.' }
  ];
  const state = buildKernelState({
    requestId:'r-curiosity', userText:'Я сегодня наконец закончил сложную задачу.', history,
    memory:{ conversationState:{ revision:3, openLoops:[] } }, conversationState:'ongoing'
  });
  assert.equal(state.reciprocity.userQuestionTurns, 2);
  assert.equal(state.reciprocity.rinQuestionTurns, 0);
  assert.equal(state.reciprocity.oneSidedQuestionPattern, true);
  assert.equal(state.reciprocity.reciprocalQuestionExpected, false);
  assert.equal(state.reciprocity.userTurns, 3);
  assert.equal(state.reciprocity.rinTurns, 2);
});

test('one-sided casual questions create one contextual reciprocal-question invariant, not a timer', () => {
  const history = [
    { role:'user', kind:'text', status:'complete', id:'u1', content:'Как твой день?' },
    { role:'assistant', kind:'text', status:'complete', id:'a1', content:'Спокойный, уже выдыхаю.' },
    { role:'user', kind:'text', status:'complete', id:'u2', content:'А настроение как?' },
    { role:'assistant', kind:'text', status:'complete', id:'a2', content:'Ровное. Мне сейчас хорошо.' },
    { role:'user', kind:'text', status:'sent', requestId:'r3', id:'u3', content:'А ты чем сейчас занимаешься?' }
  ];
  const brain={ literalIntent:'question', activeScene:{type:'everyday'} };
  const state=buildKernelState({requestId:'r3',userText:'А ты чем сейчас занимаешься?',history,brain,memory:{conversationState:{revision:2,openLoops:[]}},conversationState:'ongoing'});
  assert.equal(state.reciprocity.oneSidedQuestionPattern,true);
  assert.equal(state.reciprocity.currentUserQuestion,true);
  assert.equal(state.reciprocity.reciprocalQuestionExpected,true);
  assert.match(state.reciprocity.questionAnchor,/занимаешься/iu);

  const blocked=validateTurnDecisionConstraints(decision(),{conversationState:'ongoing',reciprocity:state.reciprocity});
  assert.equal(blocked.passed,false);
  assert.ok(blocked.warnings.includes('reciprocal_question_expected'));
  const allowed=validateTurnDecisionConstraints(decision({question:{mode:'natural',reason:'встречный интерес'}}),{conversationState:'ongoing',reciprocity:state.reciprocity});
  assert.equal(allowed.passed,true);
});



test('first direct personal question is a reciprocal-curiosity opportunity when Rin has not asked recently', () => {
  const history = [
    { role:'assistant', kind:'text', status:'complete', requestId:'greet', turnId:'rin-greet', id:'a0', content:'Добрый вечер. Я уже выдыхаю.' },
    { role:'user', kind:'text', status:'sent', requestId:'r-day', turnId:'user-r-day', id:'u1', content:'Добрый вечер Рин) Как твой день?' }
  ];
  const brain={ literalIntent:'question', activeScene:{type:'everyday'} };
  const state=buildKernelState({requestId:'r-day',userText:'Добрый вечер Рин) Как твой день?',history,brain,memory:{conversationState:{revision:1,openLoops:[]}},conversationState:'ongoing'});
  assert.equal(state.reciprocity.currentUserPersonalQuestion,true);
  assert.equal(state.reciprocity.rinAskedRecently,false);
  assert.equal(state.reciprocity.reciprocalQuestionExpected,true);
  assert.equal(state.reciprocity.reciprocalQuestionReason,'direct_personal_interest');
  const blocked=validateTurnDecisionConstraints(decision(),{conversationState:'ongoing',reciprocity:state.reciprocity});
  assert.ok(blocked.warnings.includes('reciprocal_question_expected'));
});

test('reciprocity counts multi-message delivery as one assistant turn rather than multiple bubbles', () => {
  const history = [
    { role:'user', kind:'text', status:'complete', requestId:'u-old', turnId:'user-u-old', id:'u1', content:'Как настроение?' },
    { role:'assistant', kind:'text', status:'complete', requestId:'a-old', turnId:'rin-a-old', id:'a1', content:'Спокойное.' },
    { role:'assistant', kind:'text', status:'complete', requestId:'a-old', turnId:'rin-a-old', id:'a2', content:'Немного устала.' },
    { role:'assistant', kind:'text', status:'complete', requestId:'a-old', turnId:'rin-a-old', id:'a3', content:'Но уже отдыхаю.' },
    { role:'user', kind:'text', status:'sent', requestId:'u-now', turnId:'user-u-now', id:'u2', content:'А как твой день?' }
  ];
  const brain={ literalIntent:'question', activeScene:{type:'everyday'} };
  const state=buildKernelState({requestId:'u-now',userText:'А как твой день?',history,brain,memory:{conversationState:{revision:2,openLoops:[]}},conversationState:'ongoing'});
  assert.equal(state.reciprocity.windowTurns,3);
  assert.equal(state.reciprocity.userTurns,2);
  assert.equal(state.reciprocity.rinTurns,1);
  assert.equal(state.reciprocity.userQuestionTurns,2);
  assert.equal(state.reciprocity.reciprocalQuestionExpected,true);
});

test('proactive turns do not inherit a stale personal question as a current reciprocity obligation', () => {
  const history=[
    {role:'user',kind:'text',status:'complete',requestId:'old-user',turnId:'user-old',id:'u1',content:'Как твой день?'},
    {role:'assistant',kind:'text',status:'complete',requestId:'old-rin',turnId:'rin-old',id:'a1',content:'Спокойный, уже отдыхаю.'}
  ];
  const brain={ literalIntent:'proactive_trigger', activeScene:{type:'everyday'} };
  const state=buildKernelState({requestId:'proactive-now',userText:'',history,brain,memory:{conversationState:{revision:2,openLoops:[]}},conversationState:'ongoing'});
  assert.equal(state.reciprocity.currentUserQuestion,false);
  assert.equal(state.reciprocity.currentUserPersonalQuestion,false);
  assert.equal(state.reciprocity.reciprocalQuestionExpected,false);
});

test('reciprocity snapshot stays neutral when Rin has already shown recent curiosity', () => {
  const history = [
    { role:'user', kind:'text', status:'complete', id:'u1', content:'Как настроение?' },
    { role:'assistant', kind:'text', status:'complete', id:'a1', content:'Спокойное. А у тебя день как прошёл?' },
    { role:'user', kind:'text', status:'complete', id:'u2', content:'Неплохо. Ты устала?' },
    { role:'assistant', kind:'text', status:'complete', id:'a2', content:'Немного, но уже отдыхаю.' }
  ];
  const state = buildKernelState({ requestId:'', userText:'', history, memory:{ conversationState:{ revision:4, openLoops:[] } }, conversationState:'ongoing' });
  assert.equal(state.reciprocity.userQuestionTurns, 2);
  assert.equal(state.reciprocity.rinQuestionTurns, 1);
  assert.equal(state.reciprocity.oneSidedQuestionPattern, false);
});
