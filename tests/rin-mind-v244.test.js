import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKernelState } from '../lib/cognition/kernel-state.js';
import { buildDriveState } from '../lib/cognition/drive-state.js';
import {
  buildDecisionStateTransition,
  buildTurnDecisionJsonSchema,
  normalizeTurnDecision
} from '../lib/cognition/turn-decision.js';
import { validateTurnDecisionConstraints } from '../lib/cognition/turn-validator.js';
import {
  buildRinMindJsonSchema,
  buildRinMindPrompt,
  parseRinMind
} from '../lib/cognition/rin-mind.js';
import { buildMindCacheKey, buildMindMessages } from '../api/chat.js';

const row = (role, content, id) => ({
  role,
  kind: 'text',
  status: role === 'user' ? 'sent' : 'complete',
  id,
  requestId: id,
  turnId: id,
  content
});

const baseDecision = overrides => ({
  act: 'respond_personally',
  focus: 'ответить по смыслу',
  stance: 'лично и естественно',
  question: { mode: 'none', reason: null },
  replyLink: { targetEventId: null, reason: null },
  delivery: {
    messageShape: 'single',
    segments: [{ type: 'text', purpose: 'reply', stickerIntent: null, maxChars: 320 }]
  },
  intentTransition: {
    operation: 'none', goal: null, motive: null, target: null,
    nextMove: null, progress: null, commitment: null, reason: null
  },
  openLoops: { open: [], resolveIds: [] },
  realityMode: 'grounded',
  ...(overrides || {})
});

const mindJson = delivery => ({
  ...baseDecision({ delivery }),
  mind: {
    felt: 'тепло',
    wants: 'ответить естественно',
    restraint: null,
    socialIntent: 'respond',
    sceneMotif: 'direct_exchange',
    frameAlignment: 'aligned',
    literalCorrection: 'none',
    referenceAnchor: null,
    confidence: 90
  }
});

test('Rin Mind static structured-output contract is byte-stable across dynamic turn conditions', () => {
  const first = buildRinMindJsonSchema({ activeIntent: null, allowStickers: false, replyCandidateIds: [] });
  const second = buildRinMindJsonSchema({
    activeIntent: { status: 'active', goal: 'stay close' },
    allowStickers: true,
    replyCandidateIds: ['a', 'b']
  });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const delivery = first.schema.properties.delivery;
  assert.deepEqual(delivery.required, ['responseDepth', 'messageShape', 'segments']);
  assert.deepEqual(delivery.properties.responseDepth.enum, ['micro', 'short', 'normal', 'extended']);
  assert.deepEqual(delivery.properties.messageShape.enum, ['single', 'split']);
  assert.deepEqual(delivery.properties.segments.items.properties.type.enum, ['text', 'sticker']);
});

test('split is an intentional model-selected messenger rhythm and remains multiple delivery beats', () => {
  const parsed = parseRinMind(mindJson({
    messageShape: 'split',
    segments: [
      { type: 'text', purpose: 'reaction', stickerIntent: null, maxChars: 180, text: 'Вот как.' },
      { type: 'text', purpose: 'afterthought', stickerIntent: null, maxChars: 260, text: 'А мне, между прочим, это нравится.' }
    ]
  }));
  assert.equal(parsed.decision.delivery.messageShape, 'split');
  assert.equal(parsed.decision.delivery.mode, 'multi_message');
  assert.equal(parsed.decision.delivery.segments.length, 2);
  assert.deepEqual(parsed.realization.segments.map(item => item.text), [
    'Вот как.',
    'А мне, между прочим, это нравится.'
  ]);
});

test('messageShape inconsistencies stay soft validator warnings instead of post-hoc text splitting', () => {
  const splitOne = normalizeTurnDecision(baseDecision({
    delivery: {
      messageShape: 'split',
      segments: [{ type: 'text', purpose: 'one', stickerIntent: null, maxChars: 200 }]
    }
  }));
  const warning = validateTurnDecisionConstraints(splitOne);
  assert.equal(warning.passed, false);
  assert.ok(warning.warnings.includes('split_message_shape_requires_multiple_text_beats'));

  const twoBeats = normalizeTurnDecision(baseDecision({
    delivery: {
      messageShape: 'single',
      segments: [
        { type: 'text', purpose: 'one', stickerIntent: null, maxChars: 200 },
        { type: 'text', purpose: 'two', stickerIntent: null, maxChars: 200 }
      ]
    }
  }));
  const secondWarning = validateTurnDecisionConstraints(twoBeats);
  assert.ok(secondWarning.warnings.includes('single_message_shape_conflicts_multiple_text_beats'));
});

test('committed dialogue state remembers recent single/split choices without imposing a quota', () => {
  const decision = normalizeTurnDecision(baseDecision({
    delivery: {
      messageShape: 'split',
      segments: [
        { type: 'text', purpose: 'one', stickerIntent: null, maxChars: 200 },
        { type: 'text', purpose: 'two', stickerIntent: null, maxChars: 200 }
      ]
    }
  }));
  const transition = buildDecisionStateTransition({
    kernelState: { revision: 3, dialogueState: { recentMessageShapes: ['single', 'single'] } },
    decision,
    mind: { sceneMotif: 'playful_roleplay', frameAlignment: 'aligned' }
  });
  assert.deepEqual(transition.dialogueState.recentMessageShapes, ['single', 'single', 'split']);
});

test('reciprocal attention rises from user interest plus a personal disclosure even without a question on the current turn', () => {
  const history = [
    row('assistant', 'Я сегодня разбираю старые заметки.', 'a1'),
    row('user', 'Как у тебя настроение?', 'u1'),
    row('assistant', 'Спокойное. Немного задумалась.', 'a2'),
    row('user', 'Ты не устала?', 'u2'),
    row('assistant', 'Нет, пока нормально.', 'a3'),
    row('user', 'У меня сегодня был довольно тяжёлый день.', 'u3')
  ];
  const state = buildKernelState({
    requestId: 'u3',
    userText: 'У меня сегодня был довольно тяжёлый день.',
    history,
    conversationState: 'ongoing',
    brain: { activeScene: { type: 'everyday' } }
  });
  assert.ok(state.reciprocity.attentionPressure >= 60);
  assert.equal(state.reciprocity.attentionOpportunity, true);
  assert.equal(state.reciprocity.attentionReason, 'current_user_disclosure');
  assert.match(state.reciprocity.attentionAnchor.text, /тяжёлый день/iu);
  assert.equal(state.reciprocity.reciprocalQuestionExpected, false);

  const drives = buildDriveState({ state, behaviorState: { question: { restraint: 0 }, space: { pressure: 0 } } });
  assert.equal(drives.reciprocalAttention, state.reciprocity.attentionPressure);
  assert.ok(drives.questionImpulse > 0);
});

test('recent genuine Rin attention suppresses artificial reciprocity pressure', () => {
  const history = [
    row('assistant', 'А у тебя как прошёл день?', 'a1'),
    row('user', 'У меня сегодня был довольно тяжёлый день.', 'u1')
  ];
  const state = buildKernelState({
    requestId: 'u1',
    userText: 'У меня сегодня был довольно тяжёлый день.',
    history,
    conversationState: 'ongoing',
    brain: { activeScene: { type: 'everyday' } }
  });
  assert.equal(state.reciprocity.rinAttendedRecently, true);
  assert.ok(state.reciprocity.attentionPressure < 42);
  assert.equal(state.reciprocity.attentionOpportunity, false);
});

test('direct personal question still preserves the stronger reciprocal-question invariant', () => {
  const history = [row('user', 'Как у тебя настроение?', 'u1')];
  const state = buildKernelState({
    requestId: 'u1',
    userText: 'Как у тебя настроение?',
    history,
    conversationState: 'ongoing',
    brain: { activeScene: { type: 'everyday' } }
  });
  assert.equal(state.reciprocity.currentUserPersonalQuestion, true);
  assert.equal(state.reciprocity.reciprocalQuestionExpected, true);
  assert.equal(state.reciprocity.reciprocalQuestionReason, 'direct_personal_interest');
});

test('Rin prompt exposes reciprocal attention and treats split as a first-class voluntary shape', () => {
  const { stableSystem, dynamicSystem } = buildRinMindPrompt({
    profile: { prompt_profile: {} },
    state: {
      userText: 'У меня сегодня был тяжёлый день.',
      reciprocity: {
        attentionPressure: 78,
        attentionOpportunity: true,
        attentionReason: 'current_user_disclosure',
        attentionAnchor: { kind: 'work_or_day', text: 'У меня сегодня был тяжёлый день.' },
        attentionAnchors: []
      },
      behaviorState: { question: { restraint: 0, strongNoQuestion: false }, space: { strong: false } },
      stickerState: { available: false }
    }
  });
  assert.match(stableSystem, /delivery\.messageShape/iu);
  assert.match(stableSystem, /messageShape=split/iu);
  assert.match(stableSystem, /reciprocity описывает не только обмен вопросами/iu);
  assert.match(dynamicSystem, /ВЗАИМНОЕ ВНИМАНИЕ/iu);
  assert.match(dynamicSystem, /тяжёлый день/iu);
});

test('GPT-6 explicit cache messages keep a byte-stable developer prefix and volatile state after the breakpoint', () => {
  const profile = { prompt_profile: {}, description: 'stable customization' };
  const common = {
    profile,
    state: {
      behaviorState: { question: { restraint: 0, strongNoQuestion: false }, space: { strong: false } },
      stickerState: { available: false }
    }
  };
  const firstPrompt = buildRinMindPrompt({ ...common, state: { ...common.state, userText: 'Первый ход' } });
  const secondPrompt = buildRinMindPrompt({ ...common, state: { ...common.state, userText: 'Другой ход' } });
  const firstMessages = buildMindMessages(firstPrompt, 'gpt-6-luna');
  const secondMessages = buildMindMessages(secondPrompt, 'gpt-6-luna');

  assert.equal(firstMessages.length, 2);
  assert.equal(firstMessages[0].role, 'developer');
  assert.equal(firstMessages[1].role, 'developer');
  assert.equal(JSON.stringify(firstMessages[0]), JSON.stringify(secondMessages[0]));
  assert.notEqual(JSON.stringify(firstMessages[1]), JSON.stringify(secondMessages[1]));
  assert.deepEqual(firstMessages[0].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
  assert.equal(firstMessages[0].content.length, 1);
  assert.equal(typeof firstMessages[1].content, 'string');
});

test('cache key is stable for an identical reusable contract and changes with prefix or output schema', () => {
  const format = { type: 'json_schema', json_schema: buildRinMindJsonSchema() };
  const a = buildMindCacheKey('same stable prefix', 'gpt-6-luna', format);
  const b = buildMindCacheKey('same stable prefix', 'gpt-6-luna', format);
  const c = buildMindCacheKey('changed stable prefix', 'gpt-6-luna', format);
  const d = buildMindCacheKey('same stable prefix', 'gpt-6-luna', { ...format, marker: 'changed' });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^rin-mind-[a-f0-9]{40}$/u);
});

test('legacy non-explicit models retain a single ordinary system prompt', () => {
  const messages = buildMindMessages({ system: 'stable + dynamic', stableSystem: 'stable', dynamicSystem: 'dynamic' }, 'gpt-4.1');
  assert.deepEqual(messages, [{ role: 'system', content: 'stable + dynamic' }]);
});

test('dynamic TurnDecision callers keep narrow runtime schemas while Rin Mind owns the static cacheable contract', () => {
  const dynamic = buildTurnDecisionJsonSchema({ activeIntent: null, conversationState: 'ongoing', allowStickers: false });
  assert.deepEqual(dynamic.schema.properties.intentTransition.properties.operation.enum, ['none', 'activate']);
  assert.deepEqual(dynamic.schema.properties.delivery.properties.segments.items.properties.type.enum, ['text']);

  const staticSchema = buildTurnDecisionJsonSchema({ staticContract: true, activeIntent: null, allowStickers: false });
  assert.ok(staticSchema.schema.properties.intentTransition.properties.operation.enum.includes('complete'));
  assert.deepEqual(staticSchema.schema.properties.delivery.properties.segments.items.properties.type.enum, ['text', 'sticker']);
});
