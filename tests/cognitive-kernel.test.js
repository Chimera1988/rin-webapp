import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeTurnDecision, applyIntentTransition, buildDecisionStateTransition } from '../lib/cognition/turn-decision.js';
import { validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildDeliveryPlan } from '../api/chat.js';

const decision = overrides => normalizeTurnDecision({
  act: 'answer_and_continue', focus: 'ответить конкретно', stance: 'спокойная',
  question: { mode: 'none', reason: null },
  delivery: { mode: 'single_text', segments: [{ type: 'text', purpose: 'answer', stickerIntent: null, maxChars: 300 }] },
  intentTransition: { operation: 'none' }, openLoops: { open: [], resolveIds: [] }, realityMode: 'grounded',
  ...(overrides || {})
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

test('TurnDecision normalization never invents missing semantic beats or sticker intent', () => {
  const oneBeat = normalizeTurnDecision({
    act:'continue', focus:'continue', stance:'warm', question:{mode:'none',reason:null},
    delivery:{ mode:'multi_message', segments:[{type:'text',purpose:'only',stickerIntent:null,maxChars:120}] },
    intentTransition:{operation:'none'}, openLoops:{open:[],resolveIds:[]}, realityMode:'grounded'
  });
  assert.equal(oneBeat.delivery.segments.length, 1);
  const invalidMulti = validateTurnDecisionConstraints(oneBeat);
  assert.ok(invalidMulti.warnings.includes('multi_message_requires_multiple_segments'));

  const missingStickerIntent = normalizeTurnDecision({
    act:'gesture', focus:'gesture', stance:'warm', question:{mode:'none',reason:null},
    delivery:{ mode:'sticker_only', segments:[{type:'sticker',purpose:'gesture',stickerIntent:null,maxChars:20}] },
    intentTransition:{operation:'none'}, openLoops:{open:[],resolveIds:[]}, realityMode:'grounded'
  });
  assert.equal(missingStickerIntent.delivery.segments[0].stickerIntent, null);
  assert.ok(validateTurnDecisionConstraints(missingStickerIntent).warnings.includes('sticker_segment_requires_intent'));
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
